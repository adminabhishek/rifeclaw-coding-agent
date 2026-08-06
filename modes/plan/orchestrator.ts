import chalk from "chalk";
import { confirm, isCancel, text } from "@clack/prompts";
import { ToolLoopAgent, stepCountIs } from "ai";
import { getAgentModel } from "../../ai/ai.config.ts";
import { ActionTracker } from "../agent/action-tracker.ts";
import { ToolExecutor } from "../agent/tool-executor.ts";
import { createAgentTools } from "../agent/agent-tools.ts";
import { defaultAgentConfig } from "../agent/types.ts";
import { runApprovalFlow } from "../agent/approval.ts";
import { renderTerminalMarkdown } from "../../tui/terminal-md.ts";
import { generatePlan } from "./planner.ts";
import { printPlan, selectSteps } from "./selection.ts";
import type { PlanStep } from "./types.ts";
import { createWebTools, hasWebTools } from "./web-tools.ts";

export function stepPrompt(goal: string, step: PlanStep): string {
  return [`Goal: ${goal}`, `Step: ${step.title}`, step.description].join("\n");
}

interface StepAgent {
  generate(input: { prompt: string }): Promise<{ text?: string | null }>;
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
    deps.print(chalk.bold(`\nRunning: ${step.title}\n`));

    const agent = deps.createStepAgent();
    const result = await agent.generate({ prompt: stepPrompt(goal, step) });

    if (result.text) deps.print(deps.renderMarkdown(result.text));
  }

  const ok = await deps.approve();
  if (!ok) {
    deps.clearStaging();
    return;
  }

  const { errors } = deps.applyApproved();
  if (errors.length) {
    deps.printError(chalk.red("\nSome operations reported errors:\n"));
    for (const error of errors) deps.printError(chalk.red(`  - ${error}`));
  } else {
    deps.print(chalk.green("\nApplied.\n"));
  }
  deps.clearStaging();
}

export async function runPlanMode(): Promise<void> {
  console.log(chalk.bold("\nPlan Mode\n"));

  const goal = await text({ message: "What is your goal?" });
  if (isCancel(goal) || !goal.trim()) return;

  const plan = await generatePlan(goal);

  printPlan(plan);

  const selected = await selectSteps(plan);
  if (selected.length === 0) return;

  const proceed = await confirm({
    message: `Execute ${selected.length} step(s)`,
    initialValue: true,
  });
  if (isCancel(proceed) || !proceed) return;

  const config = defaultAgentConfig();
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
      }),
    approve: () => runApprovalFlow(tracker),
    applyApproved: () => executor.applyApprovedFromTracker(),
    clearStaging: () => executor.clearStaging(),
    print: (message) => console.log(message),
    printError: (message) => console.log(message),
    renderMarkdown: renderTerminalMarkdown,
  });
}
