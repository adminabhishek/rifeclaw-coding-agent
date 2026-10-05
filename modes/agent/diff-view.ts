import { createTwoFilesPatch, structuredPatch } from "diff";
import type { ActionLog } from "./types";

/** Risk level for approval decisions */
export type RiskLevel = "low" | "medium" | "high";

/** Enhanced diff result with statistics and colorized output */
export interface DiffResult {
  filePath: string;
  patch: string;
  stats: DiffStats;
  riskLevel: RiskLevel;
  riskReason: string;
}

/** Statistics about a diff */
export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
  linesContext: number;
  hunks: number;
}

/**
 * Calculate risk level for an action or group of actions
 */
export function calculateRiskLevel(
  actions: ActionLog[],
  config?: { allowShellPreapproval?: boolean; allowDeletePreapproval?: boolean }
): { level: RiskLevel; reason: string } {
  // Shell commands are always high risk
  const hasShell = actions.some((a) => a.type === "tool_execute");
  if (hasShell) {
    return {
      level: "high",
      reason: "Shell command execution",
    };
  }

  // File deletions are high risk unless preapproval is configured
  const hasDelete = actions.some((a) => a.type === "file_delete");
  if (hasDelete && !config?.allowDeletePreapproval) {
    return {
      level: "high",
      reason: "File deletion",
    };
  }

  // File creation and modification are generally low/medium risk
  const hasCreate = actions.some((a) => a.type === "file_create");
  const hasModify = actions.some((a) => a.type === "file_modify");

  if (hasCreate || hasModify) {
    // Check if it's a config/sensitive file
    const sensitivePaths = actions.some((a) =>
      /\.(env|config|json|lock|toml|yaml|yml)$/i.test(a.path)
    );
    if (sensitivePaths) {
      return {
        level: "medium",
        reason: "Configuration or sensitive file",
      };
    }
    return {
      level: "low",
      reason: "File creation/modification",
    };
  }

  // Folder creation is low risk
  const hasFolder = actions.some((a) => a.type === "folder_create");
  if (hasFolder) {
    return { level: "low", reason: "Folder creation" };
  }

  return { level: "low", reason: "Unknown action type" };
}

/**
 * Get diff statistics from a unified patch
 */
export function getDiffStats(patch: string): DiffStats {
  let linesAdded = 0;
  let linesRemoved = 0;
  let linesContext = 0;
  let hunks = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      hunks++;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      linesAdded++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      linesRemoved++;
    } else if (line.startsWith(" ")) {
      linesContext++;
    }
  }

  return { linesAdded, linesRemoved, linesContext, hunks };
}

/**
 * Create a colorized diff for terminal display
 */
export function colorizeDiff(patch: string): string {
  const chalk = require("chalk");
  return patch
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) return chalk.cyan(line);
      if (line.startsWith("+") && !line.startsWith("+++"))
        return chalk.green(line);
      if (line.startsWith("-") && !line.startsWith("---"))
        return chalk.red(line);
      if (line.startsWith("---") || line.startsWith("+++"))
        return chalk.dim(line);
      return line;
    })
    .join("\n");
}

/**
 * Generate enhanced diff result for a group of actions
 */
export function generateDiffResult(
  filePath: string,
  sorted: ActionLog[],
  config?: { allowShellPreapproval?: boolean; allowDeletePreapproval?: boolean }
): DiffResult {
  const { before, after } = composeBeforeAfter(sorted);
  const patch = formatPatch(filePath, before, after);
  const stats = getDiffStats(patch);
  const { level, reason } = calculateRiskLevel(sorted, config);

  return {
    filePath,
    patch,
    stats,
    riskLevel: level,
    riskReason: reason,
  };
}

export function formatPatch(
  filePath: string,
  before: string,
  after: string,
): string {
  return createTwoFilesPatch(filePath, filePath, before, after, "", "", {
    context: 3,
  });
}

export function composeBeforeAfter(sorted: ActionLog[]): {
  before: string;
  after: string;
} {
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (last.type === "file_delete")
    return { before: last.details.before ?? "", after: "" };
  const before =
    first.type === "file_create" ? "" : (first.details.before ?? "");
  const after = last.details.after ?? "";
  return { before, after };
}
