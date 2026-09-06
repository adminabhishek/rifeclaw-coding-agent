import { multiselect, isCancel } from '@clack/prompts';
import chalk from 'chalk';
import type { Plan, PlanStep } from './types.ts';
import { renderTerminalMarkdown } from '../../tui/terminal-md.ts';


const COMPLEXITY_COLOR: Record<NonNullable<PlanStep['complexity']>, string> = {
  low: chalk.green('low'),
  medium: chalk.yellow('medium'),
  high: chalk.red('high'),
};

// ── Helpers ────────────────────────────────────────────────────────────────
function stepHint(step: PlanStep): string {
  const parts: string[] = [];
  if (step.complexity) parts.push(COMPLEXITY_COLOR[step.complexity]);
  // Truncate description to ~60 chars for the hint
  const desc = step.description.replace(/\s+/g, ' ').trim();
  const short = desc.length > 60 ? desc.slice(0, 57) + '...' : desc;
  parts.push(chalk.dim(short));
  return parts.join(' ');
}


export function printPlan(plan: Plan): void {
  if (plan.researchSummary?.trim()) {
    console.log(chalk.bold('\n🔍 Research summary'));
    console.log(renderTerminalMarkdown(plan.researchSummary));
  }
  console.log(chalk.bold('\n📋 Generated Plan\n'));
  for (const [i, s] of plan.steps.entries()) {
    const tag = s.complexity ? `  ${chalk.dim(`[${COMPLEXITY_COLOR[s.complexity]}]`)}` : '';
    const num = chalk.cyan(`Step ${String(i + 1).padStart(2)}`);
    const desc = chalk.dim(s.description.replace(/\s+/g, ' ').trim());
    console.log(`  ${num}. ${chalk.bold(s.title)}${tag}`);
    console.log(`       ${desc}`);
  }
  console.log();
}


export async function selectSteps(plan: Plan): Promise<PlanStep[]> {
  console.log(chalk.cyan("\n📋 Step Selection"));
  console.log(chalk.dim("   Choose which steps to execute (space toggles, enter confirms)"));
  console.log(chalk.dim("   (press Enter to run all, or space to toggle individual steps)\n"));

  const SELECT_ALL = "__select_all__";

  const options = [
    {
      value: SELECT_ALL,
      label: chalk.bold("✅ Select all steps"),
      hint: chalk.dim(`${plan.steps.length} step${plan.steps.length !== 1 ? 's' : ''} — press Enter to run all`),
    },
    ...plan.steps.map((s) => ({
      value: s.id,
      label: s.title,
      hint: stepHint(s),
    })),
  ];

  const picked = await multiselect<string>({
    message: 'Select steps to execute (space toggles, enter confirms)',
    options,
    // Pre-select "Select all" so pressing Enter immediately runs everything.
    // Users can press space to deselect, then space on individual steps to
    // pick a subset.
    initialValues: [SELECT_ALL],
    required: false,
  });

  if (isCancel(picked)) return [];

  // If the user toggled "Select all" (either pre-selected or re-toggled),
  // return every step
  if (picked.includes(SELECT_ALL)) {
    return [...plan.steps];
  }

  const set = new Set<string>(picked);
  return plan.steps.filter((s) => set.has(s.id));
}

