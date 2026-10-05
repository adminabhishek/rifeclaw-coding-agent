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
import { createLiveTokenUsageReporter, type TokenUsageSnapshot } from "../../src/utils/live-token-usage.ts";

export function stepPrompt(goal: string, step: PlanStep): string {
  return [`Goal: ${goal}`, `Step: ${step.title}`, step.description].join("\n");
}

interface StepAgent {
  stream(input: {
    prompt: string;
    onStepFinish?: (data: { toolCalls?: unknown[]; text?: string | null; usage?: TokenUsageSnapshot }) => void;
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
  hasPendingChanges?: () => boolean;
  onTokenUsage?: (usage: TokenUsageSnapshot) => void;
}

export interface PlanExecutionResult {
  outcome: "no_changes" | "rejected" | "applied" | "failed";
  errors: string[];
}

export async function executePlanSteps(
  goal: string,
  selected: PlanStep[],
  deps: PlanExecutionDeps,
): Promise<PlanExecutionResult> {
  for (const step of selected) {
    deps.print(chalk.bold(`\n🔧 Running: ${step.title}\n`));

    const agent = deps.createStepAgent();
    const result = await agent.stream({
      prompt: stepPrompt(goal, step),
      onStepFinish: ({ usage }) => usage && deps.onTokenUsage?.(usage),
    });

    let buffer = "";
    for await (const chunk of result.textStream) {
      buffer += chunk;
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary);
        if (((block.match(/```/g) ?? []).length % 2) === 1) {
          const next = buffer.indexOf("\n\n", boundary + 2);
          if (next < 0) break;
          boundary = next;
          continue;
        }
        if (block.trim()) deps.print(deps.renderMarkdown(block));
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim().length > 0) {
      deps.print(deps.renderMarkdown(buffer));
    }
  }

  if (deps.hasPendingChanges && !deps.hasPendingChanges()) {
    deps.print(chalk.green("\nPlan steps finished. No file changes were needed.\n"));
    deps.clearStaging();
    return { outcome: "no_changes", errors: [] };
  }

  const ok = await deps.approve();
  if (!ok) {
    deps.clearStaging();
    deps.print(chalk.yellow("\nChanges discarded. Nothing was applied.\n"));
    return { outcome: "rejected", errors: [] };
  }

  const { errors } = deps.applyApproved();
  if (errors.length) {
    deps.printError(chalk.red("\n⚠️ Some operations reported errors:\n"));
    for (const error of errors) deps.printError(chalk.red(`  ❌ - ${error}`));
  } else {
    deps.print(chalk.green("\n✅ All changes applied successfully!\n"));
  }
  deps.clearStaging();
  return { outcome: errors.length ? "failed" : "applied", errors };
}

export async function runPlanMode(): Promise<boolean> {
  console.log(chalk.bold("\n🗺 Plan Mode\n"));
  console.log(chalk.cyan("🔍 Ready to receive a plan goal. Type /back to return.\n"));

  const goal = await text({
    message: "What is your goal?",
    placeholder: "High-level objective for this plan...",
  });

  if (isCancel(goal) || !goal.trim()) return true;

  const trimmedGoal = goal.trim();
  if (trimmedGoal.toLowerCase() === "/back") return false;

  // Load memory from disk so prior sessions are available
  memoryManager.loadFromDisk();

  const config = defaultAgentConfig();

  // Use a stable session ID for plan mode + project so context carries over
  const sessionId = memoryManager.resolveSessionId('plan', config.codebasePath);

  // Surface prior context if any
  const priorContext = memoryManager.getRecentContext(sessionId);
  const reportTokenUsage = createLiveTokenUsageReporter();
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
  const plan = await generatePlan(trimmedGoal, priorContext || undefined, reportTokenUsage);

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
  if (selected.length === 0) {
    memoryManager.updateTask(taskId, { status: "failed", result: "Plan cancelled before execution" });
    memoryManager.saveToDisk();
    return true;
  }

  const proceed = await confirm({
    message: `⚡ Execute ${selected.length} step(s)`,
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) {
    memoryManager.updateTask(taskId, { status: "failed", result: "Plan cancelled before execution" });
    memoryManager.saveToDisk();
    return true;
  }

  console.log(chalk.cyan("\n🚀 Starting plan execution...\n"));

  const tracker = new ActionTracker();
  const executor = new ToolExecutor(tracker, config);

  const preview = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return (text ?? "").replace(/\s+/g, " ").slice(0, 140);
  };
  const tools = {
    ...createAgentTools(executor, {
      onToolStart: (name, input) => console.log(chalk.yellow("  →"), chalk.bold(name), chalk.dim(preview(input))),
      onToolFinish: (name, output) => console.log(chalk.green("  ✓"), chalk.bold(name), chalk.dim(preview(output))),
    }),
    ...(hasWebTools() ? createWebTools(tracker) : {}),
  };

  const execution = await executePlanSteps(plan.goal, selected, {
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
    hasPendingChanges: () => tracker.getPendingMutations().length > 0,
    onTokenUsage: reportTokenUsage,
  });

  const taskResult = execution.outcome === "applied"
    ? `Executed ${selected.length} steps and applied changes`
    : execution.outcome === "no_changes"
      ? `Executed ${selected.length} steps; no file changes were needed`
      : execution.outcome === "rejected"
        ? "Changes rejected by user"
        : execution.errors.join("\n");
  memoryManager.updateTask(taskId, {
    status: execution.outcome === "applied" || execution.outcome === "no_changes" ? "completed" : "failed",
    result: taskResult,
  });
  memoryManager.saveToDisk();
  return true;
}
