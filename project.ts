import fs from "node:fs";
import path from "node:path";

let projectPath = process.cwd();

export function resolveProjectPath(input?: string): string {
  const resolved = path.resolve(process.cwd(), input?.trim() || ".");
  if (!fs.existsSync(resolved)) {
    throw new Error(`Project path does not exist: ${resolved}`);
  }
  if (!fs.statSync(resolved).isDirectory()) {
    throw new Error(`Project path must be a directory: ${resolved}`);
  }
  return resolved;
}

export function setProjectPath(nextProjectPath: string): void {
  projectPath = nextProjectPath;
}

export function getProjectPath(): string {
  return projectPath;
}

export function loadProjectEnv(root = projectPath): void {
  const envPath = path.join(root, ".env");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (!key || rawValue === undefined || process.env[key]) continue;

    const value = rawValue.trim();
    const quote = value[0];
    process.env[key] =
      (quote === "'" || quote === '"') && value.at(-1) === quote
        ? value.slice(1, -1)
        : value;
  }
}
