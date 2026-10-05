import { select, isCancel, confirm } from "@clack/prompts";
import chalk from "chalk";
import type { ActionTracker } from "./action-tracker.ts";
import type { ActionLog } from "./types.ts";
import {
  composeBeforeAfter,
  generateDiffResult,
  calculateRiskLevel,
  colorizeDiff,
  type DiffResult,
  type RiskLevel,
} from "./diff-view.ts";
import { summaryBox, renderHeader } from "../../tui/terminal-md.ts";

interface ReviewGroup {
  label: string;
  actionIds: string[];
  path: string;
  actions: ActionLog[];
  diffResult: DiffResult | null;
  riskLevel: RiskLevel;
}

interface ApprovalConfig {
  autoApproveLowRisk: boolean;
  showAllDiffsFirst: boolean;
}

const DEFAULT_APPROVAL_CONFIG: ApprovalConfig = {
  autoApproveLowRisk: false,
  showAllDiffsFirst: true,
};

/** Risk level icon */
function riskIcon(level: RiskLevel): string {
  switch (level) {
    case "low":
      return chalk.green("●");
    case "medium":
      return chalk.yellow("●");
    case "high":
      return chalk.red("●");
  }
}

/** Format risk level with color */
function formatRisk(level: RiskLevel): string {
  switch (level) {
    case "low":
      return chalk.green("LOW");
    case "medium":
      return chalk.yellow("MED");
    case "high":
      return chalk.red("HIGH");
  }
}

/** Group pending mutations by file with risk assessment */
function groupPending(pending: ActionLog[]): ReviewGroup[] {
  const byPath = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];

  for (const a of pending) {
    if (a.type === "tool_execute") {
      shells.push(a);
      continue;
    }
    const key = a.path;
    if (!byPath.has(key)) byPath.set(key, []);
    byPath.get(key)!.push(a);
  }

  const groups: ReviewGroup[] = [];

  const pathEntries = [...byPath.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  );
  for (const [p, acts] of pathEntries) {
    const sorted = acts.sort(
      (x, y) => x.timestamp.getTime() - y.timestamp.getTime(),
    );
    const ids = sorted.map((x) => x.id);

    if (sorted.every((x) => x.type === "folder_create")) {
      const risk = calculateRiskLevel(sorted);
      groups.push({
        label: `Create folder: ${p}`,
        actionIds: ids,
        path: p,
        actions: sorted,
        diffResult: null,
        riskLevel: risk.level,
      });
      continue;
    }

    composeBeforeAfter(sorted);
    const kinds = [...new Set(sorted.map((x) => x.type))].join(", ");
    const diffResult = generateDiffResult(p, sorted);
    groups.push({
      label: `${p} (${kinds})`,
      actionIds: ids,
      path: p,
      actions: sorted,
      diffResult,
      riskLevel: diffResult.riskLevel,
    });
  }

  for (const s of shells) {
    const risk = calculateRiskLevel([s]);
    groups.push({
      label: `Shell: ${s.details.command ?? "(no command)"}`,
      actionIds: [s.id],
      path: "shell",
      actions: [s],
      diffResult: null,
      riskLevel: risk.level,
    });
  }

  return groups;
}

/** Print summary overview of all pending changes */
function printSummary(groups: ReviewGroup[]): void {
  const lowRisk = groups.filter((g) => g.riskLevel === "low").length;
  const medRisk = groups.filter((g) => g.riskLevel === "medium").length;
  const highRisk = groups.filter((g) => g.riskLevel === "high").length;

  console.log(renderHeader("📋 Staged Changes — Review Before Applying", 2));
  console.log("");

  // Summary stats
  const stats = summaryBox([
    { label: "Total changes:", value: groups.length },
    { label: `${riskIcon("low")} Low risk:`, value: lowRisk },
    { label: `${riskIcon("medium")} Medium risk:`, value: medRisk },
    { label: `${riskIcon("high")} High risk:`, value: highRisk },
  ]);
  console.log(stats);
  console.log("");

  // File list with risk indicators
  console.log(chalk.dim("Changes:"));
  for (const g of groups) {
    const icon = riskIcon(g.riskLevel);
    const typeLabel = g.path === "shell" ? "🖥 Shell" : "📄 File";
    const diffInfo = g.diffResult
      ? ` +${chalk.green(g.diffResult.stats.linesAdded)} -${chalk.red(g.diffResult.stats.linesRemoved)}`
      : "";
    console.log(
      `  ${icon} ${chalk.bold(typeLabel)} ${chalk.cyan(g.path)}${diffInfo} ${chalk.dim(`[${formatRisk(g.riskLevel)}]`)}`,
    );
  }
  console.log("");
}

/** Display a colorized diff with stats */
function displayDiff(diffResult: DiffResult): void {
  console.log(renderHeader(`Diff: ${diffResult.filePath}`, 3));
  console.log("");

  // Stats line
  const { stats } = diffResult;
  console.log(
    summaryBox([
      { label: "Hunks:", value: stats.hunks },
      { label: "Added:", value: chalk.green(`+${stats.linesAdded}`) },
      { label: "Removed:", value: chalk.red(`-${stats.linesRemoved}`) },
      { label: "Context:", value: stats.linesContext },
    ]),
  );
  console.log("");

  // Colorized diff
  console.log(colorizeDiff(diffResult.patch));
  console.log("");
}

/** Display shell command for review */
function displayShell(action: ActionLog): void {
  console.log(renderHeader("Shell Command", 3));
  console.log("");
  console.log(chalk.cyan("Command:"));
  console.log(chalk.bold(action.details.command ?? "(no command)"));
  console.log("");
  console.log(chalk.yellow("⚠️  This will execute in the workspace root with a 2-minute timeout."));
  console.log("");
}

/** Interactive approval flow with enhanced UI */
export async function runApprovalFlow(
  tracker: ActionTracker,
  config: Partial<ApprovalConfig> = {},
): Promise<boolean> {
  const pending = tracker.getPendingMutations();
  const approvalConfig = { ...DEFAULT_APPROVAL_CONFIG, ...config };

  if (pending.length === 0) {
    console.log(
      chalk.dim("\nNo staged file, folder, or shell changes to review.\n"),
    );
    return false;
  }

  const groups = groupPending(pending);

  // Count risk levels for hints
  const lowRisk = groups.filter((g) => g.riskLevel === "low").length;
  const medRisk = groups.filter((g) => g.riskLevel === "medium").length;
  const highRisk = groups.filter((g) => g.riskLevel === "high").length;

  // Step 1: Show summary overview
  printSummary(groups);

  // If configured, show all diffs first in "review all" mode
  if (approvalConfig.showAllDiffsFirst && groups.some((g) => g.diffResult)) {
    const showAll = await confirm({
      message: "Review all diffs before deciding?",
      initialValue: true,
    });

    if (!isCancel(showAll) && showAll) {
      console.log(renderHeader("📄 All Diffs", 2));
      console.log("");
      for (const g of groups) {
        if (g.diffResult) {
          displayDiff(g.diffResult);
        }
      }
    }
  }

  // Step 2: Main approval choice
  const choice = await select({
    message: "How would you like to proceed?",
    options: [
      {
        value: "all",
        label: "✅ Approve and apply all",
        hint: highRisk > 0 ? "Includes high-risk changes" : "",
      },
      {
        value: "low-only",
        label: "🟢 Approve low-risk only",
        hint: lowRisk > 0 ? `${lowRisk} low-risk change(s)` : "No low-risk changes",
      },
      {
        value: "select",
        label: "🔍 Review one by one",
        hint: "Interactive per-file review",
      },
      { value: "cancel", label: "❌ Cancel" },
    ],
  });

  if (isCancel(choice) || choice === "cancel") {
    for (const a of pending) tracker.updateStatus(a.id, "rejected", false);
    return false;
  }

  if (choice === "all") {
    // Final confirmation for high-risk changes
    if (highRisk > 0 || medRisk > 0) {
      const confirmAll = await confirm({
        message: `${chalk.red(`${highRisk} high-risk`)} and ${chalk.yellow(`${medRisk} medium-risk`)} changes included. Apply anyway?`,
        initialValue: false,
      });
      if (isCancel(confirmAll) || !confirmAll) {
        return await runApprovalFlow(tracker, config);
      }
    }

    for (const a of pending) tracker.updateStatus(a.id, "approved", true);
    return true;
  }

  if (choice === "low-only") {
    if (lowRisk === 0) {
      console.log(chalk.yellow("\nNo low-risk changes to approve.\n"));
      return await runApprovalFlow(tracker, config);
    }

    const confirmLow = await confirm({
      message: `Approve ${lowRisk} low-risk change(s)? Medium/high-risk changes will remain pending.`,
      initialValue: true,
    });

    if (isCancel(confirmLow) || !confirmLow) {
      return await runApprovalFlow(tracker, config);
    }

    for (const g of groups) {
      if (g.riskLevel === "low") {
        for (const id of g.actionIds) {
          tracker.updateStatus(id, "approved", true);
        }
      }
    }
    return tracker.getActions().some((a) => a.status === "approved");
  }

  // Step 3: Interactive per-file review
  for (const g of groups) {
    while (true) {
      const diffAvailable = !!g.diffResult;
      const shellCmd = g.path === "shell";

      const options = [
        { value: "accept", label: "✅ Accept" },
        { value: "diff", label: "👁 Show diff", hint: diffAvailable ? "" : "N/A" },
        { value: "reject", label: "❌ Reject" },
      ];

      if (shellCmd) {
        options.splice(1, 0, { value: "view", label: "📝 View command", hint: "" });
      }

      const opt = await select({
        message: chalk.bold(`${riskIcon(g.riskLevel)} ${g.label}`),
        options,
      });

      if (isCancel(opt)) {
        for (const a of pending) tracker.updateStatus(a.id, "rejected", false);
        return false;
      }

      if (opt === "diff" && g.diffResult) {
        displayDiff(g.diffResult);
        continue;
      }

      if (opt === "view" && shellCmd) {
        const action = g.actions[0];
        if (action) displayShell(action);
        continue;
      }

      for (const id of g.actionIds) {
        tracker.updateStatus(
          id,
          opt === "accept" ? "approved" : "rejected",
          opt === "accept",
        );
      }
      break;
    }
  }

  const hasApproved = tracker.getActions().some((a) => a.status === "approved");

  if (hasApproved) {
    const approvedCount = tracker.getActions().filter((a) => a.status === "approved").length;
    const rejectedCount = tracker.getActions().filter((a) => a.status === "rejected").length;
    console.log(chalk.green(`\n✅ ${approvedCount} change(s) approved, ${rejectedCount} rejected.\n`));
  }

  return hasApproved;
}

/** Export config for external customization */
export { DEFAULT_APPROVAL_CONFIG, type ApprovalConfig };