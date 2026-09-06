import { tool, ToolLoopAgent, stepCountIs } from "ai";
import { z } from "zod";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { createAgentTools } from "../agent/agent-tools.ts";
import { defaultAgentConfig, type AgentConfig } from "../agent/types.ts";
import { createWebTools, hasWebTools } from "../plan/web-tools.ts";
import type { Plan, PlanStep } from "../plan/types.ts";
import { replyMarkdown, escapeMarkdown } from "./text.ts";
import { finishOrApprove } from "./approval-session.ts";
import { memoryManager } from "../../src/ai/memory.ts";

// ── Enhanced Loading Messages ────────────────────────────────────────────────
const LOADING_MESSAGES = [
  "🤖 *Analyzing your request…*",
  "🔍 *Scanning codebase…*",
  "🧠 *Thinking through the task…*",
  "⚡ *Executing tools…*",
];

type ReplyContext = { reply: (t: string, o?: object) => Promise<unknown> };

async function showLoading(ctx: ReplyContext, idx: number) {
  const message = LOADING_MESSAGES[idx] ?? LOADING_MESSAGES[0] ?? "⏳ *Working…*";
  return ctx.reply(message, { parse_mode: "MarkdownV2" });
}

// ── Better Tool Result Formatting ────────────────────────────────────────────

function formatToolName(name: string): string {
  // Convert snake_case to Title Case with spaces
  return name
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatToolResult(result: unknown): string {
  if (result === null || result === undefined) return "✓ Done";
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const singleLine = text.replace(/\s+/g, " ").trim();

  // For long output, show first 120 chars with truncation
  if (singleLine.length > 120) {
    return singleLine.slice(0, 120) + "…";
  }
  return singleLine || "✓ Done";
}

async function showToolStart(ctx: ReplyContext, name: string, input?: unknown) {
  const toolDisplay = formatToolName(name);
  const inputInfo = input !== undefined ? ` ${formatToolResult(input)}` : "";
  await ctx.reply(`⚡ ${toolDisplay}${inputInfo}`);
}

async function showToolDone(ctx: ReplyContext, name: string, result: unknown) {
  const toolDisplay = formatToolName(name);
  const resultText = formatToolResult(result);
  await ctx.reply(`✅ ${toolDisplay}: ${resultText}`);
}

// ── Completion Indicator ────────────────────────────────────────────────────
// Sends a clear "done" marker so the user knows the response is finished
// and the bot is no longer working. Three variants: success / partial / error.

function nowStamp(): string {
  const d = new Date();
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
}

async function done(ctx: ReplyContext, label: string = "Ask"): Promise<void> {
  await ctx.reply(
    `━━━━━━━━━━━━━━━━━━\n` +
    `✅ ${label} complete · ⏱ ${nowStamp()}\n` +
    `━━━━━━━━━━━━━━━━━━`,
  );
}

async function doneWithSummary(
  ctx: ReplyContext,
  label: string,
  summary: { steps?: number; files?: number; durationMs?: number },
): Promise<void> {
  const parts: string[] = [`✅ ${label} complete`];
  if (summary.steps !== undefined) parts.push(`${summary.steps} step(s)`);
  if (summary.files !== undefined) parts.push(`${summary.files} file(s)`);
  if (summary.durationMs !== undefined) {
    const sec = (summary.durationMs / 1000).toFixed(1);
    parts.push(`${sec}s`);
  }
  parts.push(`⏱ ${nowStamp()}`);
  await ctx.reply(
    `━━━━━━━━━━━━━━━━━━\n` +
    `${parts.join(" · ")}\n` +
    `━━━━━━━━━━━━━━━━━━`,
  );
}

async function partialDone(ctx: ReplyContext, label: string, reason: string): Promise<void> {
  const safe = (reason || "unknown error")
    .replace(/\r?\n/g, " ")
    .slice(0, 200);
  await ctx.reply(
    `━━━━━━━━━━━━━━━━━━\n` +
    `⚠️ ${label} stopped — ${safe}\n` +
    `⏱ ${nowStamp()}\n` +
    `━━━━━━━━━━━━━━━━━━`,
  );
}

function isDirectoryStructureQuestion(question: string): boolean {
  return /\b(directory|folder|project|codebase)\s+(structure|tree|files?)\b/i.test(question) ||
    /\b(show|list|display)\b.*\b(structure|tree|files?)\b/i.test(question);
}

function normalizeWorkspacePath(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed || trimmed === "/" || trimmed === "\\" || trimmed === "." || trimmed === "./") {
    return ".";
  }
  if (/^workspace\\?$/i.test(trimmed) || /^workspace root$/i.test(trimmed)) {
    return ".";
  }
  return trimmed.replace(/^workspace[\\/]+/i, "");
}

function formatDirectoryStructure(files: string): string {
  const lines = files.split("\n").filter(Boolean);

  // Build a nested tree from flat path list.
  type Node = { name: string; children: Map<string, Node>; isFile: boolean };
  const root: Node = { name: "", children: new Map(), isFile: false };

  for (const line of lines) {
    const parts = line.split("/").filter(Boolean);
    let cursor = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]!;
      const isFile = i === parts.length - 1;
      if (!cursor.children.has(part)) {
        cursor.children.set(part, { name: part, children: new Map(), isFile });
      }
      cursor = cursor.children.get(part)!;
    }
  }

  // Render with tree-drawing characters, grouping all dirs first then files at each level.
  const treeLines: string[] = [];
  const renderNode = (node: Node, prefix: string, isLast: boolean) => {
    const entries = Array.from(node.children.values());
    // Directories first, then files; alphabetical within each group.
    entries.sort((a, b) => {
      const aDir = a.children.size > 0 ? 0 : 1;
      const bDir = b.children.size > 0 ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return a.name.localeCompare(b.name);
    });

    entries.forEach((entry, idx) => {
      const last = idx === entries.length - 1;
      const connector = last ? "└── " : "├── ";
      const isDir = entry.children.size > 0;
      const display = isDir ? `${entry.name}/` : entry.name;
      treeLines.push(`${prefix}${connector}${display}`);

      if (isDir) {
        const childPrefix = `${prefix}${last ? "    " : "│   "}`;
        renderNode(entry, childPrefix, last);
      }
    });
  };

  renderNode(root, "", true);

  // Limit to 3400 chars and report truncation.
  const MAX = 3400;
  let body = treeLines.join("\n");
  let shown = treeLines.length;
  if (body.length > MAX) {
    // Slice the rendered lines until we fit, keeping the tree structure.
    const acc: string[] = [];
    let size = 0;
    for (const l of treeLines) {
      if (size + l.length + 1 > MAX) break;
      acc.push(l);
      size += l.length + 1;
    }
    body = acc.join("\n");
    shown = acc.length;
  }
  const truncated = shown < treeLines.length ? `\n…[${treeLines.length - shown} more entries]` : "";

  return [
    "📂 *Project Structure*",
    "",
    "```",
    body,
    truncated.trimEnd(),
    "```",
    "",
    `📊 Total: ${lines.length} items • ${treeLines.filter((l) => l.endsWith("/")).length} directories`,
  ].join("\n");
}

function readOnlyConfig(): AgentConfig {
  const c = defaultAgentConfig();
  c.tools.allowFileCreation = false;
  c.tools.allowFileModification = false;
  c.tools.allowFolderCreation = false;
  c.tools.allowShellExecution = false;
  return c;
}

function agentOptions(config: AgentConfig, maxSteps: number) {
  return {
    model: getAgentModel(),
    stopWhen: stepCountIs(maxSteps),
    instructions: [
      `Workspace root: ${config.codebasePath}`,
      "Use paths relative to the workspace root.",
      "For the workspace root, always pass path: \".\". Never pass \"/\", \"\\\", or the absolute workspace path.",
      "After using tools, answer in normal markdown. Do not show raw tool-call JSON.",
    ].join("\n"),
  };
}

function createReadOnlyTools(executor: ToolExecutor, ctx: ReplyContext) {
  return {
    read_file: tool({
      description: "Read a workspace file (relative path).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path: p }) => {
        const path = normalizeWorkspacePath(p);
        await showToolStart(ctx, "read_file", { path });
        const result = executor.readFile(path);
        await showToolDone(ctx, "read_file", result);
        return result;
      },
    }),
    list_files: tool({
      description: "List files/dirs at a path.",
      inputSchema: z.object({
        path: z.string(),
        recursive: z.boolean().optional().default(false),
      }),
      execute: async ({ path: p, recursive }) => {
        const path = normalizeWorkspacePath(p);
        await showToolStart(ctx, "list_files", { path, recursive });
        const result = executor.listFiles(path, recursive);
        await showToolDone(ctx, "list_files", result);
        return result;
      },
    }),
    search_files: tool({
      description:
        "Find files matching a glob pattern; optional content filter.",
      inputSchema: z.object({
        root: z.string(),
        pattern: z.string(),
        content_contains: z.string().optional(),
      }),
      execute: async ({ root, pattern, content_contains }) => {
        const safeRoot = normalizeWorkspacePath(root);
        await showToolStart(ctx, "search_files", { root: safeRoot, pattern, content_contains });
        const result = executor.searchFiles(safeRoot, pattern, content_contains);
        await showToolDone(ctx, "search_files", result);
        return result;
      },
    }),
    analyze_codebase: tool({
      description: "Summarize the codebase structure.",
      inputSchema: z.object({ path: z.string().default(".") }),
      execute: async ({ path: p }) => {
        const path = normalizeWorkspacePath(p);
        await showToolStart(ctx, "analyze_codebase", { path });
        const result = executor.analyzeCodebase(path);
        await showToolDone(ctx, "analyze_codebase", result);
        return result;
      },
    }),
  };
}

function extraWebTools(tracker: ActionTracker) {
  return hasWebTools() ? createWebTools(tracker) : {};
}

export async function runAsk(ctx: { reply: (t: string, o?: object) => Promise<unknown> }, question: string) {
  const config = readOnlyConfig();
  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);
  const sessionId = `telegram_ask_${Date.now()}`;
  const startMs = Date.now();
  memoryManager.addMessage(sessionId, 'user', question);

  try {
    const wantsDescriptions = /describe|description|what is|explain|what does|brief/i.test(question);

    if (isDirectoryStructureQuestion(question)) {
      const files = executor.listFiles(".", true);
      const tree = formatDirectoryStructure(files);

      if (wantsDescriptions) {
        // Use the AI to analyze the codebase and provide descriptions.
        const tools = { ...createReadOnlyTools(executor, ctx), ...extraWebTools(tracker) };
        const agent = new ToolLoopAgent({
          ...agentOptions(config, 25),
          tools,
        });

        await ctx.reply("🔍 *Analyzing codebase…*", { parse_mode: "MarkdownV2" });
        await showLoading(ctx, Math.floor(Math.random() * LOADING_MESSAGES.length));

        const { text } = await agent.generate({
          prompt: `Provide a comprehensive overview of this codebase:

1. Show the complete directory tree (use tree format)
2. Give a brief description of each important file/directory
3. Explain the purpose of major components

Focus on giving useful context for someone reading the code.`,
          onStepFinish: async ({ toolCalls, text }) => {
            for (const tc of toolCalls) {
              await showToolStart(ctx, String(tc.toolName), tc.input);
            }
          },
        });

        memoryManager.addMessage(sessionId, 'assistant', text || tree);
        memoryManager.saveToDisk();
        await replyMarkdown(ctx, text || tree);
        await doneWithSummary(ctx, "Ask", { durationMs: Date.now() - startMs });
        return;
      }

      memoryManager.addMessage(sessionId, 'assistant', tree);
      memoryManager.saveToDisk();
      await ctx.reply(tree, { parse_mode: "MarkdownV2" });
      await doneWithSummary(ctx, "Ask", { durationMs: Date.now() - startMs });
      return;
    }

    const tools = { ...createReadOnlyTools(executor, ctx), ...extraWebTools(tracker) };
    const agent = new ToolLoopAgent({
      ...agentOptions(config, 20),
      tools,
    });

    await ctx.reply("🔍 *Analyzing your question…*", { parse_mode: "MarkdownV2" });
    await showLoading(ctx, Math.floor(Math.random() * LOADING_MESSAGES.length));
    const { text } = await agent.generate({
      prompt: question,
      onStepFinish: async ({ toolCalls }) => {
        for (const tc of toolCalls) {
          await showToolStart(ctx, String(tc.toolName), tc.input);
        }
      },
    });

    memoryManager.addMessage(sessionId, 'assistant', text || 'no answer');
    memoryManager.saveToDisk();

    await replyMarkdown(ctx, text || "No answer generated.");
    await doneWithSummary(ctx, "Ask", { durationMs: Date.now() - startMs });
  } catch (err) {
    await partialDone(ctx, "Ask", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function runAgent(ctx: { reply: (t: string, o?: object) => Promise<unknown> }, chatId: number, goal: string) {
  // Create session for memory
  const sessionId = `telegram_agent_${chatId}_${Date.now()}`;
  const taskId = memoryManager.createTask(goal);
  memoryManager.addMessage(sessionId, 'user', goal);
  const startMs = Date.now();

  // Clean header message
  await ctx.reply("🤖 *Agent Mode Started*\n\n🎯 *Task:* " + escapeMarkdown(goal), { parse_mode: "MarkdownV2" });
  await ctx.reply("🔍 Analyzing request…\n📂 Reading relevant files…", { parse_mode: "MarkdownV2" });

  try {
    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);
    const tools = createAgentTools(executor);
    const agent = new ToolLoopAgent({
      ...agentOptions(config, 40),
      tools,
    });

    const { text } = await agent.generate({ prompt: goal });

    memoryManager.addMessage(sessionId, 'assistant', text || 'no answer');

    if (text?.trim()) {
      await replyMarkdown(ctx, text.trim());
    }

    // Update task status and save memory
    memoryManager.updateTask(taskId, { status: 'completed', result: text || 'Completed' });
    memoryManager.saveToDisk();

    const pending = tracker.getPendingMutations();
    if (pending.length === 0) {
      await doneWithSummary(ctx, "Agent", { durationMs: Date.now() - startMs, files: 0 });
    } else {
      await doneWithSummary(ctx, "Agent", { durationMs: Date.now() - startMs, files: pending.length });
    }
    await finishOrApprove(ctx, chatId, tracker, executor, "✅ *Done.* No file changes were needed.");
  } catch (err) {
    await partialDone(ctx, "Agent", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

export async function runPlanSteps(
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  chatId: number,
  plan: Plan,
  steps: PlanStep[],
) {
  // Create session for memory
  const sessionId = `telegram_plan_${chatId}_${Date.now()}`;
  const taskId = memoryManager.createTask(`Plan: ${plan.goal}`);
  memoryManager.addMessage(sessionId, 'user', `Plan: ${plan.goal}\nSteps: ${steps.map(s => s.title).join(', ')}`);
  const startMs = Date.now();

  // Clean header
  await ctx.reply("🗺 *Plan Execution*\n\n📋 *Goal:* " + escapeMarkdown(plan.goal), { parse_mode: "MarkdownV2" });

  // Show steps summary
  const stepList = steps.map((s, i) => `${i + 1}. *${escapeMarkdown(s.title)}*`).join('\n');
  await ctx.reply("📝 *Steps:*\n" + stepList, { parse_mode: "MarkdownV2" });

  try {
    const config = defaultAgentConfig();
    const tracker = new ActionTracker();
    const executor = new ToolExecutor(tracker, config);
    const tools = { ...createAgentTools(executor), ...extraWebTools(tracker) };

    for (let idx = 0; idx < steps.length; idx++) {
      const step = steps[idx]!;
      await ctx.reply(`🔧 *Step ${idx + 1}/${steps.length}:* ${escapeMarkdown(step.title)}`, { parse_mode: "MarkdownV2" });
      const prompt = [`Goal: ${plan.goal}`, `Step: ${step.title}`, step.description].join('\n');
      const agent = new ToolLoopAgent({
        ...agentOptions(config, 30),
        tools,
      });
      const { text } = await agent.generate({ prompt });
      if (text?.trim()) await replyMarkdown(ctx, text.trim());
    }

    memoryManager.updateTask(taskId, { status: 'completed', result: `Executed ${steps.length} steps` });
    memoryManager.saveToDisk();

    const pending = tracker.getPendingMutations();
    await doneWithSummary(ctx, "Plan", {
      steps: steps.length,
      files: pending.length,
      durationMs: Date.now() - startMs,
    });
    await finishOrApprove(ctx, chatId, tracker, executor, "✅ *All steps completed successfully!*");
  } catch (err) {
    await partialDone(ctx, "Plan", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ── Welcome / Help Message ──────────────────────────────────────────────────

export const WELCOME_MESSAGE =
  "🤖 *RifeClaw Telegram Bot*\n\n" +
  "Welcome! I'm your AI coding assistant for this codebase.\n\n" +
  "📋 *Commands:*\n" +
  "• \`/ask <question>\` — Ask about the codebase\n" +
  "• \`/agent <task>\` — Let me implement something\n" +
  "• \`/plan <goal>\` — Create a structured plan\n" +
  "• \`/help\` — Show this message\n\n" +
  "_Run /help for full documentation._";

export async function sendWelcome(ctx: { reply: (t: string, o?: object) => Promise<unknown> }) {
  await ctx.reply(WELCOME_MESSAGE, { parse_mode: "MarkdownV2" });
}

// ── Error Formatting ────────────────────────────────────────────────────────

export function formatError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (
    "❌ *Error*\n\n" +
    "```\n" + message.slice(0, 500) + "\n```\n\n" +
    "Try rephrasing your request or use \`/help\` for guidance."
  );
}

// ── Progress Indicator ──────────────────────────────────────────────────────

export function progressBar(current: number, total: number, label: string = "Progress"): string {
  const width = 20;
  const filled = Math.round((current / total) * width);
  const empty = width - filled;
  const bar = "▓".repeat(filled) + "░".repeat(empty);
  return `${label} \`[${bar}]\` ${current}/${total}`;
}
