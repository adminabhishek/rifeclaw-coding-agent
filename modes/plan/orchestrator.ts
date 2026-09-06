import chalk from "chalk";
import path from "node:path";
import { confirm, isCancel, text } from "@clack/prompts";
import { ToolLoopAgent, stepCountIs } from "ai";
import { getAgentModel } from "../../ai/ai.config";
import { memoryManager } from "../../src/ai/memory";
import { ActionTracker } from "../agent/action-tracker";
import { ToolExecutor } from "../agent/tool-executor";
import { createAgentTools } from "../agent/agent-tools";
import { defaultAgentConfig } from "../agent/types";
import { runApprovalFlow } from "../agent/approval";
import { renderTerminalMarkdown } from "../../tui/terminal-md";
import { generatePlan } from "./planner";
import { printPlan, selectSteps } from "./selection";
import { persistPlan } from "./persistence";
import type { PlanStep } from "./types";
import { createWebTools, hasWebTools } from "./web-tools";

// ── Tool result preview ───────────────────────────────────────────────────
function previewToolResult(result: unknown): string {
  const textResult =
    typeof result === "string" ? result : JSON.stringify(result, null, 2);
  const singleLine = (textResult ?? "").replace(/\s+/g, " ").trim();
  return singleLine.length > 140 ? `${singleLine.slice(0, 140)}...` : singleLine;
}

export function stepPrompt(goal: string, step: PlanStep): string {
  return [`Goal: ${goal}`, `Step: ${step.title}`, step.description].join("\n");
}

interface StepAgent {
  stream(input: {
    prompt: string;
    onStepFinish?: (data: { toolCalls?: unknown[]; text?: string | null }) => void;
  }): Promise<{
    textStream: AsyncIterable<string>;
    text: Promise<string>;
  }>;
}

interface PlanExecutionDeps {
  createStepAgent: () => StepAgent;
  approve: () => Promise<boolean>;
  applyApproved: () => { errors: string[] };
  clearStaging: () => void;
  print: (message: string) => void;
  printError: (message: string) => void;
  renderMarkdown: (source: string) => string;
}

export async function executePlanSteps(
  goal: string,
  selected: PlanStep[],
  deps: PlanExecutionDeps,
): Promise<void> {
  for (const step of selected) {
    deps.print(chalk.bold(`\n🔧 Running: ${step.title}\n`));

    const agent = deps.createStepAgent();
    const result = await agent.stream({
      prompt: stepPrompt(goal, step),
      onStepFinish: ({ toolCalls }) => {
        // Log tool calls as activity signals; the streamed output below
        // is the one source of truth for the step's text.
        for (const tc of toolCalls ?? []) {
          deps.print(
            chalk.yellow("  =>") + " " + chalk.bold(String((tc as { toolName?: unknown }).toolName)) + " " + chalk.dim(previewToolResult((tc as { input?: unknown }).input))
          );
        }
      },
    });

    // Stream output line-by-line so the user sees the model think in real time.
    // Buffer chunks and flush on each newline to avoid half-line updates.
    let buffer = "";
    let lineCount = 0;
    for await (const chunk of result.textStream) {
      buffer += chunk;
      const lines = buffer.split("\n");
      // Keep the last segment (possibly partial line) in the buffer
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        deps.print(deps.renderMarkdown(line));
        lineCount++;
      }
    }
    // Flush any trailing content (no newline at end of stream)
    if (buffer.trim().length > 0) {
      deps.print(deps.renderMarkdown(buffer));
      lineCount++;
    }
    if (lineCount === 0) {
      // Stream produced no text — fall back to a final message
      deps.print(chalk.dim("(no output)"));
    }
  }

  const ok = await deps.approve();
  if (!ok) {
    deps.clearStaging();
    return;
  }

  const { errors } = deps.applyApproved();
  if (errors.length) {
    deps.printError(chalk.red("\n⚠️ Some operations reported errors:\n"));
    for (const error of errors) deps.printError(chalk.red(`  ❌ - ${error}`));
  } else {
    deps.print(chalk.green("\n✅ All changes applied successfully!\n"));
  }
  deps.clearStaging();
}

export async function runPlanMode(): Promise<void> {
  console.log(chalk.bold("\n🗺 Plan Mode\n"));
  console.log(chalk.cyan("🔍 Ready to receive a plan goal. Type /back to return.\n"));

  const goal = await text({
    message: "What is your goal?",
    placeholder: "High-level objective for this plan...",
  });

  if (isCancel(goal) || !goal.trim()) return;

  const trimmedGoal = goal.trim();
  if (trimmedGoal.toLowerCase() === "/back") return;

  // Load memory from disk so prior sessions are available
  memoryManager.loadFromDisk();

  const config = defaultAgentConfig();

  // Use a stable session ID for plan mode + project so context carries over
  const sessionId = memoryManager.resolveSessionId('plan', config.codebasePath);

  // Surface prior context if any
  const priorContext = memoryManager.getRecentContext(sessionId);
  if (priorContext) {
    const turns = memoryManager.getMessages(sessionId, 50).length;
    console.log(chalk.dim(`\n💾 Loaded ${turns} prior message${turns !== 1 ? 's' : ''} from this project\n`));
  }

  const taskId = memoryManager.createTask(`Plan: ${trimmedGoal}`);

  // Record user message in memory
  memoryManager.addMessage(sessionId, 'user', trimmedGoal);

  console.log(chalk.cyan("\n🧠 Generating plan..."));
  console.log(chalk.dim("   (analyzing goals, creating steps)\n"));

  // Pass prior context to the planner if available
  const plan = await generatePlan(trimmedGoal, priorContext || undefined);

  // Record plan in memory
  const planSummary = `Goal: ${plan.goal}\nSteps: ${plan.steps.map(s => s.title).join(', ')}`;
  memoryManager.addMessage(sessionId, 'assistant', planSummary);

  console.log(chalk.green("\n✅ Plan generated successfully:\n"));
  printPlan(plan);

  // Persist the plan to the plans/ directory (auto-save)
  const planPath = persistPlan(plan, { dir: path.join(config.codebasePath, 'plans') });
  if (planPath) {
    console.log(chalk.dim(`📄 Plan saved to: ${path.relative(config.codebasePath, planPath)}\n`));
  }

  const selected = await selectSteps(plan);
  if (selected.length === 0) return;

  const proceed = await confirm({
    message: `⚡ Execute ${selected.length} step(s)`,
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) return;

  console.log(chalk.cyan("\n🚀 Starting plan execution...\n"));

  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const tools = {
    ...createAgentTools(executor),
    ...(hasWebTools() ? createWebTools(tracker) : {}),
  };

  await executePlanSteps(plan.goal, selected, {
    createStepAgent: () =>
      new ToolLoopAgent({
        model: getAgentModel(),
        stopWhen: stepCountIs(30),
        tools,
      }) as unknown as StepAgent,
    approve: () => runApprovalFlow(tracker),
    applyApproved: () => executor.applyApprovedFromTracker(),
    clearStaging: () => executor.clearStaging(),
    print: (message) => console.log(message),
    printError: (message) => console.log(message),
    renderMarkdown: renderTerminalMarkdown,
  });

  // Update task status and save memory
  memoryManager.updateTask(taskId, { status: 'completed', result: `Executed ${selected.length} steps` });
  memoryManager.saveToDisk();
}