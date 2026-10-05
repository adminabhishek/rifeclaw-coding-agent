import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import type { AgentConfig, ActionLog } from "./types";
import { ActionTracker } from "./action-tracker";
import {
  FileSystemError,
  OperationError,
  ErrorCode,
  RifeClawError,
} from "../../src/errors/error-system.ts";

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".mdx",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".txt",
]);

const MAX_BATCH_READ_FILES = 8;
const MAX_BATCH_READ_FILE_BYTES = 24_000;
const MAX_BATCH_READ_CHARS = 48_000;
const MAX_TOOL_RESULT_ITEMS = 500;
const MAX_TOOL_RESULT_CHARS = 24_000;

interface TreeSnapshot {
  files: string[];
  directories: string[];
}

function isProbablyTextFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXT.has(ext) || ext === "";
}

function assertSafeShellCommand(command: string): void {
  const normalized = command.trim().toLowerCase();
  if (!normalized) {
    throw new OperationError(
      "execute_shell: command is required",
      ErrorCode.SHELL_COMMAND_REQUIRED,
      { context: { command } }
    );
  }
  if (/[\r\n]/.test(command)) {
    throw new OperationError(
      "execute_shell: multi-line commands are not allowed",
      ErrorCode.MULTILINE_COMMAND_BLOCKED,
      { context: { command } }
    );
  }

  const blocked = [
    /\brm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\b/,
    /\brmdir\s+\/s\b/,
    /\bdel\s+\/[fsq]\b/,
    /\bformat\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+-[^\s]*f\b/,
  ];

  if (blocked.some((pattern) => pattern.test(normalized))) {
    throw new OperationError(
      `execute_shell: command blocked by safety policy: ${command}`,
      ErrorCode.SHELL_COMMAND_BLOCKED,
      { context: { command } }
    );
  }
}

export class ToolExecutor {
  private overlay = new Map<string, string>();
  private deleted = new Set<string>();
  private readonly treeSnapshots = new Map<string, TreeSnapshot>();
  private readonly norm = (rel: string) =>
    path.posix.normalize(rel.split(path.sep).join("/")).replace(/^\.\//, "");

  constructor(
    private readonly tracker: ActionTracker,
    private readonly config: AgentConfig,
  ) {}

  private resolveSafe(rel: string): string {
    const abs = path.resolve(this.config.codebasePath, rel);
    const root = path.resolve(this.config.codebasePath);
    const relCheck = path.relative(root, abs);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      throw new FileSystemError(`Path escapes workspace: ${rel}`, ErrorCode.PATH_ESCAPE, { context: { rel } });
    }
    return abs;
  }

  private excluded(relPath: string): boolean {
    const norm = this.norm(relPath);
    const segments = norm.split("/");
    const base = segments[segments.length - 1] ?? "";

    for (const pat of this.config.excludePatterns) {
      if (pat === "*.log" && base.endsWith(".log")) return true;
      if (pat === ".env*" && base.startsWith(".env")) return true;
      if (pat.includes("*")) continue;
      if (segments.includes(pat) || norm === pat || norm.startsWith(`${pat}/`))
        return true;
    }
    return false;
  }

  private assertNotExcluded(rel: string, op: string): void {
    if (this.excluded(rel)) {
      throw new FileSystemError(`${op}: path is excluded by policy: ${rel}`, ErrorCode.FILE_NOT_FOUND, { context: { rel, op } });
    }
  }

  /** Cache one recursive directory snapshot per task and requested root. */
  private treeSnapshot(rootAbs: string): TreeSnapshot {
    const cached = this.treeSnapshots.get(rootAbs);
    if (cached) return cached;

    const snapshot: TreeSnapshot = { files: [], directories: [] };
    if (fs.statSync(rootAbs).isFile()) {
      snapshot.files.push(path.relative(rootAbs, rootAbs));
    } else {
      const walk = (dir: string) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          const relFromWorkspace = path.relative(this.config.codebasePath, full);
          if (this.excluded(relFromWorkspace)) continue;
          const relFromRoot = path.relative(rootAbs, full).split(path.sep).join("/");
          if (entry.isDirectory()) {
            snapshot.directories.push(relFromRoot);
            walk(full);
          } else {
            snapshot.files.push(relFromRoot);
          }
        }
      };
      walk(rootAbs);
    }

    snapshot.files.sort();
    snapshot.directories.sort();
    this.treeSnapshots.set(rootAbs, snapshot);
    return snapshot;
  }

  private limitToolResults(items: string[]): string {
    const kept: string[] = [];
    let chars = 0;
    let omitted = 0;
    for (const item of items) {
      if (kept.length >= MAX_TOOL_RESULT_ITEMS || chars + item.length + 1 > MAX_TOOL_RESULT_CHARS) {
        omitted++;
        continue;
      }
      kept.push(item);
      chars += item.length + 1;
    }
    if (omitted) kept.push(`[${omitted} more entries omitted; narrow the search or choose a smaller directory]`);
    return kept.join("\n");
  }

  getEffectiveText(rel: string): string | undefined {
    const key = this.norm(rel);
    if (this.deleted.has(key)) return undefined;
    if (this.overlay.has(key)) return this.overlay.get(key);
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return undefined;
    return fs.readFileSync(abs, "utf8");
  }

  readFile(rel: string): string {
    this.assertNotExcluded(rel, "read_file");
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new FileSystemError(`File not found: ${rel}`, ErrorCode.FILE_NOT_FOUND, { context: { rel } });
    }
    const st = fs.statSync(abs);
    if (st.size > this.config.maxFileSizeToRead) {
      throw new FileSystemError(`File too large: ${rel}`, ErrorCode.FILE_TOO_LARGE, { context: { rel } });
    }
    const text = fs.readFileSync(abs, "utf8");
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rel),
      details: { after: text, toolName: "read_file" },
      status: "executed",
    });
    return text;
  }

  /** Read a small group of relevant files in one model tool call. */
  readFiles(paths: string[]): string {
    if (paths.length === 0) return "No file paths were provided.";
    if (paths.length > MAX_BATCH_READ_FILES) {
      throw new OperationError(
        `read_files accepts at most ${MAX_BATCH_READ_FILES} paths`,
        ErrorCode.INVALID_INPUT,
        { context: { count: paths.length, limit: MAX_BATCH_READ_FILES } },
      );
    }

    let remaining = MAX_BATCH_READ_CHARS;
    const sections = paths.map((rel) => {
      try {
        this.assertNotExcluded(rel, "read_files");
        const abs = this.resolveSafe(rel);
        const stat = fs.statSync(abs);
        if (!stat.isFile()) return `--- ${rel} ---\n[not a file]`;
        if (stat.size > MAX_BATCH_READ_FILE_BYTES) {
          return `--- ${rel} ---\n[too large for batch read; use read_file for this file]`;
        }
        const content = this.readFile(rel);
        if (remaining <= 0) return `--- ${rel} ---\n[omitted: batch output limit reached]`;
        const excerpt = content.slice(0, remaining);
        remaining -= excerpt.length;
        const suffix = excerpt.length < content.length ? "\n[truncated: batch output limit reached]" : "";
        return `--- ${rel} ---\n${excerpt}${suffix}`;
      } catch (error) {
        return `--- ${rel} ---\n[read error: ${error instanceof Error ? error.message : String(error)}]`;
      }
    });
    return sections.join("\n\n");
  }

  createFile(rel: string, content: string): string {
    if (!this.config.tools.allowFileCreation)
      throw new OperationError("File creation disabled", ErrorCode.OPERATION_DISABLED, { context: { operation: "create_file" } });
    this.assertNotExcluded(rel, "create_file");
    const key = this.norm(rel);
    const abs = this.resolveSafe(rel);
    if (fs.existsSync(abs) && !this.deleted.has(key)) {
      throw new FileSystemError(`create_file: already exists: ${rel}`, ErrorCode.FILE_ALREADY_EXISTS, { context: { rel } });
    }
    this.deleted.delete(key);
    this.overlay.set(key, content);
    this.tracker.log({
      type: "file_create",
      path: key,
      details: { after: content },
      status: "pending",
    });
    return `Staged new file: ${key}`;
  }

  modifyFile(rel: string, content: string): string {
    if (!this.config.tools.allowFileModification)
      throw new OperationError("File modification disabled", ErrorCode.OPERATION_DISABLED, { context: { operation: "modify_file" } });
    this.assertNotExcluded(rel, "modify_file");
    const before = this.getEffectiveText(rel);
    if (before === undefined)
      throw new FileSystemError(`modify_file: file not found: ${rel}`, ErrorCode.FILE_NOT_FOUND, { context: { rel } });
    const key = this.norm(rel);
    this.overlay.set(key, content);
    this.tracker.log({
      type: "file_modify",
      path: key,
      details: { before, after: content },
      status: "pending",
    });
    return `Staged update: ${key}`;
  }

  deleteFile(rel: string): string {
    if (!this.config.tools.allowFileModification)
      throw new OperationError("File deletion disabled", ErrorCode.OPERATION_DISABLED, { context: { operation: "delete_file" } });
    this.assertNotExcluded(rel, "delete_file");
    const before = this.getEffectiveText(rel);
    if (before === undefined)
      throw new FileSystemError(`delete_file: file not found: ${rel}`, ErrorCode.FILE_NOT_FOUND, { context: { rel } });
    const key = this.norm(rel);
    this.overlay.delete(key);
    this.deleted.add(key);
    this.tracker.log({
      type: "file_delete",
      path: key,
      details: { before },
      status: "pending",
    });
    return `Staged delete: ${key}`;
  }

  createFolder(rel: string): string {
    if (!this.config.tools.allowFolderCreation)
      throw new OperationError("Folder creation disabled", ErrorCode.OPERATION_DISABLED, { context: { operation: "create_folder" } });
    this.assertNotExcluded(rel, "create_folder");
    const key = this.norm(rel);
    this.tracker.log({
      type: "folder_create",
      path: key,
      details: { after: key },
      status: "pending",
    });
    return `Staged folder: ${key}`;
  }

  listFiles(rel: string, recursive: boolean): string {
    this.assertNotExcluded(rel, "list_files");
    const abs = this.resolveSafe(rel);
    if (!fs.existsSync(abs)) throw new FileSystemError(`list_files: not found: ${rel}`, ErrorCode.DIRECTORY_NOT_FOUND, { context: { rel } });

    let lines: string[];
    if (!fs.statSync(abs).isDirectory()) {
      lines = [path.relative(this.config.codebasePath, abs)];
    } else if (recursive) {
      const snapshot = this.treeSnapshot(abs);
      lines = [...snapshot.directories.map((dir) => `${dir}/`), ...snapshot.files];
    } else {
      lines = fs.readdirSync(abs, { withFileTypes: true })
        .filter((entry) => !this.excluded(path.relative(this.config.codebasePath, path.join(abs, entry.name))))
        .map((entry) => entry.isDirectory() ? `${entry.name}/` : entry.name);
    }

    const out = this.limitToolResults(lines.sort());
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rel),
      details: { after: out, toolName: "list_files" },
      status: "executed",
    });
    return out || "(empty)";
  }

  searchFiles(
    rootRel: string,
    globPattern: string,
    contentQuery?: string,
  ): string {
    this.assertNotExcluded(rootRel, "search_files");
    const rootAbs = this.resolveSafe(rootRel);
    if (!fs.existsSync(rootAbs))
      throw new FileSystemError(`search_files: root not found: ${rootRel}`, ErrorCode.DIRECTORY_NOT_FOUND, { context: { rootRel } });

    const regexFromGlob = (g: string): RegExp => {
      const escaped = g
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/\\\\]*")
        .replace(/§§/g, ".*")
        .replace(/\?/g, ".");
      return new RegExp(`^${escaped}$`, "i");
    };
    const nameRe = regexFromGlob(globPattern.replace(/\\/g, "/"));

    const rootIsDirectory = fs.statSync(rootAbs).isDirectory();
    const candidates = rootIsDirectory
      ? this.treeSnapshot(rootAbs).files
        .filter((relP) => nameRe.test(relP) || nameRe.test(path.basename(relP)))
        .map((relP) => ({ relP, full: path.resolve(rootAbs, relP) }))
      : nameRe.test(path.basename(rootAbs))
        ? [{ relP: path.basename(rootAbs), full: rootAbs }]
        : [];
    const results: string[] = [];
    let inspected = 0;
    for (const candidate of candidates) {
      if (contentQuery && inspected >= 500) break;
      const full = candidate.full;
      if (contentQuery) {
        inspected++;
        if (!isProbablyTextFile(full)) continue;
        const stat = fs.statSync(full);
        if (stat.size > this.config.maxFileSizeToRead) continue;
        if (!fs.readFileSync(full, "utf8").includes(contentQuery)) continue;
      }
      results.push(path.relative(this.config.codebasePath, full).split(path.sep).join("/"));
    }
    if (contentQuery && candidates.length > inspected) {
      results.push(`[content scan stopped after ${inspected} files; narrow the pattern or root]`);
    }

    const out = this.limitToolResults([...new Set(results)].sort());
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rootRel),
      details: { after: out || "(no matches)", toolName: "search_files" },
      status: "executed",
    });
    return out || "(no matches)";
  }

  analyzeCodebase(rootRel: string): string {
    const rootAbs = this.resolveSafe(rootRel);
    if (!fs.existsSync(rootAbs))
      throw new FileSystemError(`analyze_codebase: not found: ${rootRel}`, ErrorCode.DIRECTORY_NOT_FOUND, { context: { rootRel } });

    const stat = fs.statSync(rootAbs);
    const snapshot = this.treeSnapshot(rootAbs);
    const files = snapshot.files.length;
    const dirs = stat.isDirectory() ? snapshot.directories.length : 0;

    const summary = `Files: ${files} | Directories: ${dirs}`;
    this.tracker.log({
      type: "code_analysis",
      path: this.norm(rootRel),
      details: { after: summary, toolName: "analyze_codebase" },
      status: "executed",
    });
    return summary;
  }

  queueShell(command: string): string {
    if (!this.config.tools.allowShellExecution)
      throw new OperationError("Shell execution disabled", ErrorCode.OPERATION_DISABLED, { context: { operation: "execute_shell" } });
    assertSafeShellCommand(command);
    this.tracker.log({
      type: "tool_execute",
      path: "shell",
      details: { command, toolName: "execute_shell" },
      status: "pending",
    });
    return `Shell queued: ${command}`;
  }
  skillRoots(): string[] {
    const extra =
      process.env.SKILLS_DIRS?.split(/[;]/)
        .map((s) => s.trim())
        .filter(Boolean) ?? [];
    return [
      ...extra,
      path.join(homedir(), ".cursor/skills-cursor"),
      path.join(homedir(), ".claude/skills"),
    ];
  }

  listSkills(): string {
    const lines: string[] = [];
    for (const root of this.skillRoots()) {
      if (!fs.existsSync(root)) continue;
      const walk = (dir: string) => {
        for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, ent.name);
          if (ent.isDirectory()) walk(full);
          else if (ent.name === "SKILL.md") lines.push(full);
        }
      };
      walk(root);
    }
    const out = lines.sort().join("\n");
    this.tracker.log({
      type: "code_analysis",
      path: "skills",
      details: { after: out || "(none)", toolName: "list_skills" },
      status: "executed",
    });
    return out || "(none)";
  }

  readSkill(skillPath: string): string {
    const abs = path.isAbsolute(skillPath)
      ? path.normalize(skillPath)
      : path.normalize(path.resolve(this.config.codebasePath, skillPath));
    const allowed = this.skillRoots().some((root) => {
      const r = path.resolve(root);
      return abs === r || abs.startsWith(r + path.sep);
    });
    if (!allowed) throw new FileSystemError("read_skill: outside skill roots", ErrorCode.PATH_ESCAPE, { context: { skillPath } });
    const text = fs.readFileSync(abs, "utf8");
    this.tracker.log({
      type: "code_analysis",
      path: abs,
      details: { after: text, toolName: "read_skill" },
      status: "executed",
    });
    return text;
  }

  applyApprovedFromTracker(): { errors: string[] } {
    const errors: string[] = [];
    const all = [...this.tracker.getActions()];

    for (const a of all.filter(
      (x) => x.type === "folder_create" && x.status === "approved",
    )) {
      try {
        fs.mkdirSync(this.resolveSafe(a.path), { recursive: true });
      } catch (e) {
        errors.push(String(e));
      }
    }

    const fileOps = all
      .filter(
        (a) =>
          (a.type === "file_create" ||
            a.type === "file_modify" ||
            a.type === "file_delete") &&
          a.status === "approved",
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    const lastByPath = new Map<string, ActionLog>();
    for (const a of fileOps) lastByPath.set(this.norm(a.path), a);

    for (const [p, a] of lastByPath) {
      try {
        if (a.type === "file_delete")
          fs.rmSync(this.resolveSafe(p), { force: true });
        else {
          const target = this.resolveSafe(p);
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, a.details.after ?? "", "utf8");
        }
      } catch (e) {
        errors.push(String(e));
      }
    }

    for (const a of all.filter(
      (x) => x.type === "tool_execute" && x.status === "approved",
    )) {
      const cmd = a.details.command;
      if (!cmd) continue;
      try {
        const r = spawnSync(cmd, {
          shell: true,
          cwd: this.config.codebasePath,
          encoding: "utf8",
          maxBuffer: 16 * 1024 * 1024,
          timeout: 120_000,
        });
        const output = [r.stdout, r.stderr].filter(Boolean).join("\n").trim();
        if (r.error) {
          errors.push(new OperationError(
            `Shell execution failed: ${r.error.message}`,
            ErrorCode.SHELL_EXECUTION_FAILED,
            {
              context: { command: cmd, error: r.error.message },
              recoverable: true
            }
          ).toDisplayString());
        } else if (r.status && r.status !== 0) {
          errors.push(new OperationError(
            `Shell command exited with code ${r.status}`,
            ErrorCode.SHELL_EXECUTION_FAILED,
            {
              context: { command: cmd, exitCode: r.status, output },
              recoverable: true
            }
          ).toDisplayString());
        } else {
          a.details.toolResult = output;
        }
      } catch (err) {
        const clawError = err instanceof RifeClawError
          ? err
          : new OperationError(
              `Shell execution error: ${String(err)}`,
              ErrorCode.UNKNOWN_ERROR,
              { context: { command: cmd } }
            );
        errors.push(clawError.toDisplayString());
      }
    }

    return { errors };
  }

  clearStaging():void{
    this.overlay.clear()
    this.deleted.clear()
  }
}
