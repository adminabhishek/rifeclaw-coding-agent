import chalk from "chalk";
import fs from "node:fs";
import path from "node:path";
import { confirm, isCancel, text } from "@clack/prompts";
import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { z } from "zod";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { defaultAgentConfig } from "../agent/types.ts";
import { renderTerminalMarkdown, summaryBox } from "../../tui/terminal-md.ts";
import { runApprovalFlow } from "../agent/approval.ts";
import { createWebTools } from "../plan/web-tools.ts";
import { createLiveTokenUsageReporter } from "../../src/utils/live-token-usage.ts";

// ── Command Recognition Patterns ───────────────────────────────────────
// High-confidence patterns for common, low-risk operations
const COMMAND_PATTERNS = [
  // Directory listing patterns
  { pattern: /^(ls|list)\s+files?$/i, action: "list_files" },
  { pattern: /^(dir|directory)$/i, action: "list_files" },
  { pattern: /^(show|display)\s+(me\s+)?(directory\s+)?structure$/i, action: "structure" },
  { pattern: /^(show|display)\s+(me\s+)?(structured?\s+)?(directory\s+)?files?$/i, action: "structure" },
  { pattern: /^tree$/i, action: "structure" },
  { pattern: /^(what\s+does\s+this\s+look\s+like|how\s+is\s+the\s+project\s+organized)/i, action: "structure" },

  // File search patterns
  { pattern: /^(find|search)\s+(me\s+)?(?<ext>\.ts|\.js|\.json|\.md|\.css)?(\s+for\s+(?<pattern>.+))?$/i, action: "search_file" },
  { pattern: /^(where\s+is|locate)\s+(?<name>.+)$/i, action: "search_file" },

  // Info patterns
  { pattern: /^(what\s+(are\s+the\s+)?files?|list\s+all\s+files?)$/i, action: "list_all" },
  { pattern: /^(show\s+me\s+)?(?<name>README|package\.json|tsconfig\.json)$/i, action: "read_common" },

  // Analysis patterns
  { pattern: /^(analyze|stats?|count)\s+(this\s+)?(project|codebase)/i, action: "analyze" },
];

// ── Confidence Levels ────────────────────────────────────────────────────
const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.95,  // Very confident - execute immediately
  MEDIUM: 0.70, // Reasonably confident - suggest execution
  LOW: 0.30,    // Uncertain - ask first
};

// ── Help Execution ─────────────────────────────────────────────────────
// Default executor for recognized patterns (no AI needed!)
interface HelpExecutor {
  name: string;
  reason: string;
  execute: () => Promise<string>;
}

function createHelpExecutor(question: string, action: string): HelpExecutor | null {
  const executor = defaultAgentConfig();
  const tracker = new ActionTracker();
  const toolExecutor = new ToolExecutor(tracker, executor);

  switch (action) {
    case "list_files":
      return {
        name: "List Files",
        reason: "Your request matches a safe, read-only operation.",
        execute: async () => toolExecutor.listFiles(".", true),
      };

    case "list_all":
      return {
        name: "List All Files",
        reason: "This is a simple file listing query.",
        execute: async () => toolExecutor.listFiles(".", true),
      };

    case "read_common":
      return {
        name: "Read Common File",
        reason: "Reading a common project file.",
        execute: async () => {
          const match = question.match(/(README|package\.json|tsconfig\.json)/i);
          const fileName = match?.[1] ?? "README.md";
          return toolExecutor.readFile(fileName);
        },
      };

    case "analyze":
      return {
        name: "Project Analysis",
        reason: "Analyzing your codebase structure.",
        execute: async () => toolExecutor.analyzeCodebase("."),
      };

    case "structure":
      return {
        name: "Directory Structure",
        reason: "Showing your project's directory layout.",
        execute: async () => {
          const files = await toolExecutor.listFiles(".", true);
          return `📁 **Project Structure**\n\n\`\`\`\n${files}\n\`\`\`\n\n*Total: ${files.split('\n').filter(f => f.length > 0).length} items*`;
        },
      };

    default:
      return null;
  }
}

// ── Pattern Matching ───────────────────────────────────────────────────
function matchCommand(question: string): { action: string; confidence: number } | null {
  for (const { pattern, action } of COMMAND_PATTERNS) {
    if (pattern.test(question)) {
      // High confidence for exact pattern matches
      return { action, confidence: CONFIDENCE_THRESHOLDS.HIGH };
    }
  }
  return null;
}

// ── Tool Definitions ───────────────────────────────────────────────────
function previewToolResult(result: unknown): string {
  const textResult =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const singleLine = (textResult ?? "").replace(/\s+/g, " ").trim();
  return singleLine.length > 140 ? `${singleLine.slice(0, 140)}...` : singleLine;
}

function createAskTools(executor: ToolExecutor) {
  return {
    read_file: tool({
      description:
        "Read a text file from the workspace. Use a path relative to the project root.",
      inputSchema: z.object({
        path: z.string().describe("Relative file path"),
      }),
      execute: async ({ path: p }) => {
        console.log(chalk.cyan("  ->"), chalk.bold("read_file"), chalk.dim(p));
        const result = executor.readFile(p);
        console.log(chalk.green("  <-"), chalk.bold("read_file"), chalk.dim(previewToolResult(result)));
        return result;
      },
    }),

    read_files: tool({
      description:
        "Read up to 8 relevant workspace files in one call after locating them. Prefer this over several read_file calls when the paths are already known.",
      inputSchema: z.object({ paths: z.array(z.string()).min(1).max(8) }),
      execute: async ({ paths }) => {
        console.log(chalk.cyan("  ->"), chalk.bold("read_files"), chalk.dim(paths.join(", ")));
        const result = executor.readFiles(paths);
        console.log(chalk.green("  <-"), chalk.bold("read_files"), chalk.dim(previewToolResult(result)));
        return result;
      },
    }),

    list_files: tool({
      description: "List files and directories under a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) => {
        console.log(chalk.cyan("  ->"), chalk.bold("list_files"), chalk.dim(JSON.stringify({ path: p, recursive })));
        const result = executor.listFiles(p, recursive);
        console.log(chalk.green("  <-"), chalk.bold("list_files"), chalk.dim(previewToolResult(result)));
        return result;
      },
    }),

    search_files: tool({
      description:
        'Find files matching a glob pattern (e.g. "*.ts", "**/*.md"). Optional content substring filter.',
      inputSchema: z.object({
        root: z.string().describe("Directory to search, relative to root"),
        pattern: z
          .string()
          .describe("Glob-like pattern using * and ** (forward slashes)"),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) => {
        console.log(chalk.cyan("  ->"), chalk.bold("search_files"), chalk.dim(JSON.stringify({ root, pattern, content_contains })));
        const result = executor.searchFiles(root, pattern, content_contains);
        console.log(chalk.green("  <-"), chalk.bold("search_files"), chalk.dim(previewToolResult(result)));
        return result;
      },
    }),

    analyze_codebase: tool({
      description:
        "Summarize structure: file counts, size, extensions. Read-only.",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path: p }) => {
        console.log(chalk.cyan("  ->"), chalk.bold("analyze_codebase"), chalk.dim(p));
        const result = executor.analyzeCodebase(p);
        console.log(chalk.green("  <-"), chalk.bold("analyze_codebase"), chalk.dim(previewToolResult(result)));
        return result;
      },
    }),

    list_skills: tool({
      description:
        "List absolute paths to SKILL.md files under configured skill directories (Cursor / Claude).",
      inputSchema: z.object({}),
      execute: async () => {
        console.log(chalk.cyan("  ->"), chalk.bold("list_skills"));
        const result = executor.listSkills();
        console.log(chalk.green("  <-"), chalk.bold("list_skills"), chalk.dim(previewToolResult(result)));
        return result;
      },
    }),

    read_skill: tool({
      description:
        "Read a SKILL.md file. Path must be absolute and under skill roots, or use a path returned by list_skills.",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: p }) => {
        console.log(chalk.cyan("  ->"), chalk.bold("read_skill"), chalk.dim(p));
        const result = executor.readSkill(p);
        console.log(chalk.green("  <-"), chalk.bold("read_skill"), chalk.dim(previewToolResult(result)));
        return result;
      },
    }),
  };
}

function asMd(question: string, answer: string): string {
  return `# Ask Mode\n\n## Question\n\n${question.trim()}\n\n## Answer\n\n${answer.trim()}\n`;
}

export function defaultAskFilename(now = new Date()): string {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:]/g, "-");
  return `ask-${stamp}.md`;
}

export function validateAskFilename(value: string | undefined, cwd = process.cwd()): string | undefined {
  const name = (value ?? "").trim();
  if (!name) return "Required";
  if (name.includes("..") || name.includes("/") || name.includes("\\")) return "No paths";
  if (!name.toLowerCase().endsWith(".md")) return "Must end with .md";
  if (fs.existsSync(path.resolve(cwd, name))) return "File already exists";
}

export async function runAskMode() {
  console.log(chalk.bold("\n❓ Ask Mode\n"));

  while (true) {
    console.log(chalk.cyan("🔍 Ready to receive your question. Type /back to return.\n"));
    const question = await text({
      message: "What do you want to ask? Type /back to return.",
    });
    if (isCancel(question)) continue;

    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) continue;
    if (trimmedQuestion.toLowerCase() === "/back") return;

    // ── FAST PATH: Recognized commands ───────────────────────────────────
    const match = matchCommand(trimmedQuestion);

    if (match && match.confidence >= CONFIDENCE_THRESHOLDS.HIGH) {
      // Extract action from pattern
      const action = COMMAND_PATTERNS.find(p => p.pattern.test(trimmedQuestion))?.action;
      const helpExec = createHelpExecutor(trimmedQuestion, action || "");

      if (helpExec) {
        console.log(chalk.green(`\n⚡ Quick answer (no AI needed):\n`));
        console.log(chalk.dim(`   ${helpExec.reason}\n`));

        try {
          console.log(chalk.cyan("  ->"), chalk.bold(helpExec.name));
          const result = await helpExec.execute();
          console.log(chalk.green("  <-"), chalk.bold(helpExec.name), chalk.dim(previewToolResult(result)));
          console.log(renderTerminalMarkdown(result), "\n");

          // Ask if they want to save
          const wantsSave = await confirm({
            message: "Save this answer to a Markdown file?",
            initialValue: true,
          });
          if (!isCancel(wantsSave) && wantsSave) {
            const fileSlug = helpExec.name.toLowerCase().replace(/\s+/g, "_");
            const filename = await text({
              message: "Filename",
              initialValue: `quick-answer-${fileSlug}-${Date.now()}.md`,
              validate: (value) => validateAskFilename(value, defaultAgentConfig().codebasePath),
            });
            if (isCancel(filename)) continue;

            const saveConfig = defaultAgentConfig();
            const saveTracker = new ActionTracker();
            const saveExecutor = new ToolExecutor(saveTracker, saveConfig);
            saveExecutor.createFile(filename, asMd(trimmedQuestion, result));
            const approved = await runApprovalFlow(saveTracker);
            if (!approved) {
              saveExecutor.clearStaging();
              console.log(chalk.yellow("\nSave cancelled. No file was created.\n"));
              continue;
            }
            const { errors } = saveExecutor.applyApprovedFromTracker();
            saveExecutor.clearStaging();
            if (errors.length) console.log(chalk.red(`\nCould not save the answer: ${errors.join("; ")}\n`));
            else console.log(chalk.green(`\n✅ Saved to: ${filename}\n`));
          }
        } catch (error) {
          console.log(chalk.red(` ❌ Error: ${error}`));
        }
        continue;
      }
    }

    // ── MEDIUM CONFIDENCE: Suggest before AI ───────────────────────────────
    if (match && match.confidence >= CONFIDENCE_THRESHOLDS.MEDIUM) {
      const action = COMMAND_PATTERNS.find(p => p.pattern.test(trimmedQuestion))?.action;
      const helpExec = createHelpExecutor(trimmedQuestion, action || "");

      if (helpExec) {
        console.log(chalk.yellow(`\n💡 I can help with that faster using a direct query.\n`));
        console.log(chalk.dim(`   (Would skip AI analysis)`));

        const useDirect = await confirm({
          message: `Use direct query instead of AI?`,
          initialValue: true,
        });

        if (!isCancel(useDirect) && useDirect) {
          try {
            console.log(chalk.cyan("  ->"), chalk.bold(helpExec.name));
            const result = await helpExec.execute();
            console.log(chalk.green("  <-"), chalk.bold(helpExec.name), chalk.dim(previewToolResult(result)));
            console.log(renderTerminalMarkdown(result), "\n");
          } catch (error) {
            console.log(chalk.red(` ❌ Error: ${error}`));
          }
          continue;
        }
      }
    }

    // ── FALLBACK: Use AI for complex queries ─────────────────────────────
    console.log(chalk.cyan("\n🤖 Analyzing your question..."));
    console.log(chalk.dim("   (searching the codebase, generating answer)\n"));

    const config = defaultAgentConfig();
    config.tools.allowFileCreation = true;
    config.tools.allowFileModification = false;
    config.tools.allowFolderCreation = false;
    config.tools.allowShellExecution = false;

    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);

    const tools = {
      ...createAskTools(executor),
      ...createWebTools(tracker),
    };

    const agent = new ToolLoopAgent({
      model: getAgentModel(),
      stopWhen: stepCountIs(20),
      tools,
      instructions: [
        "You are a helpful assistant for a CLI tool called RifeClaw.",
        "Your job is to answer questions about the codebase.",
        "Be direct and concise. Use markdown formatting.",
        "Use tools when you need codebase facts. After a tool result, write the final answer in normal markdown.",
        "Do not output raw tool-call JSON as the final answer.",
        "If the user wants to modify files, explain the steps to take.",
      ].join("\n"),
    });

    console.log(chalk.cyan("  .."), chalk.bold("Thinking"), chalk.dim("choosing what to inspect"));

    const reportTokenUsage = createLiveTokenUsageReporter();
    const checksPerformed: string[] = [];
    const result = await agent.generate({
      prompt: trimmedQuestion,
      onStepFinish: ({ toolCalls, usage }) => {
        reportTokenUsage(usage);
        for (const tc of toolCalls) {
          checksPerformed.push(`${String(tc.toolName)}(${previewToolResult(tc.input)})`);
          console.log(chalk.yellow("  =>"), chalk.bold(String(tc.toolName)), chalk.dim(previewToolResult(tc.input)));
        }
      },
    });
    const answer = result.text?.trim() || "(no answer)";
    if (checksPerformed.length) {
      console.log(chalk.cyan("\n  What I checked:"));
      for (const check of checksPerformed) console.log(chalk.dim(`  • ${check}`));
      console.log(chalk.dim("  Summarizing the results below.\n"));
    } else {
      console.log(chalk.dim("\n  No codebase lookup was needed; preparing a direct answer.\n"));
    }
    console.log(chalk.green("\n✅ Answer received:\n"));
    console.log(renderTerminalMarkdown(answer), "\n");

    const wantsSave = await confirm({
      message: "Save this answer to a .md file in the current directory?",
      initialValue: false,
    });
    if (isCancel(wantsSave)) continue;
    if (!wantsSave) continue;

    const filename = await text({
      message: "Filename",
      initialValue: defaultAskFilename(),
      validate: (v) => validateAskFilename(v, config.codebasePath),
    });

    if (isCancel(filename)) continue;

    executor.createFile(filename, asMd(trimmedQuestion, answer));
    const ok = await runApprovalFlow(tracker);
    if (!ok) {
      executor.clearStaging();
      continue;
    }

    executor.applyApprovedFromTracker();
    executor.clearStaging();
  }
}
