import fs from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import type { Plan, PlanStep } from './types.ts';

const COMPLEXITY_EMOJI: Record<NonNullable<PlanStep['complexity']>, string> = {
  low: '🟢',
  medium: '🟡',
  high: '🔴',
};

function formatStepMarkdown(step: PlanStep, index: number): string {
  const complexity = step.complexity
    ? ` ${COMPLEXITY_EMOJI[step.complexity]} _${step.complexity}_`
    : '';
  const hints = step.hints?.length
    ? `\n\n  **Hints:**\n${step.hints.map((h) => `  - ${h}`).join('\n')}`
    : '';
  return `### Step ${index + 1}: ${step.title}${complexity}\n\n${step.description}${hints}`;
}

export function planToMarkdown(plan: Plan, selectedIds?: Set<string>): string {
  const stamp = new Date().toISOString();
  const selectedLabel = selectedIds
    ? `${selectedIds.size}/${plan.steps.length} steps`
    : `${plan.steps.length} steps`;
  const body = plan.steps
    .map((s, i) => formatStepMarkdown(s, i))
    .join('\n\n');
  const summary = plan.researchSummary
    ? `## Research Summary\n\n${plan.researchSummary.trim()}\n\n`
    : '';
  const selection = selectedIds
    ? `\n## Selected for Execution\n\n${plan.steps
        .filter((s) => selectedIds.has(s.id))
        .map((s, i) => `${i + 1}. ${s.title}`)
        .join('\n')}\n`
    : '';
  return `# Plan: ${plan.goal}\n\n_Generated: ${stamp} • ${selectedLabel}_\n\n${summary}## Steps\n\n${body}${selection}\n`;
}

export function defaultPlanFilename(now = new Date()): string {
  const stamp = now
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z')
    .replace(/[:]/g, '-');
  return `plan-${stamp}.md`;
}

/**
 * Persist a plan to the `plans/` directory under the codebase root.
 * Returns the absolute path of the written file, or `undefined` if write failed.
 */
export function persistPlan(
  plan: Plan,
  options?: { selected?: PlanStep[]; filename?: string; dir?: string },
): string | undefined {
  const dir = options?.dir ?? path.join(process.cwd(), 'plans');
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filename = options?.filename ?? defaultPlanFilename();
    const target = path.join(dir, filename);
    const selectedIds = options?.selected?.length
      ? new Set(options.selected.map((s) => s.id))
      : undefined;
    fs.writeFileSync(target, planToMarkdown(plan, selectedIds), 'utf8');
    return target;
  } catch (error) {
    console.error(chalk.red(`Failed to persist plan: ${(error as Error).message}`));
    return undefined;
  }
}
