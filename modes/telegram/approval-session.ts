import { Markup } from "telegraf";
import type { ActionTracker } from "../agent/action-tracker.ts";
import type { ToolExecutor } from "../agent/tool-executor.ts";
import type { ActionLog } from "../agent/types.ts";
import { composeBeforeAfter, formatPatch } from "../agent/diff-view.ts";
import { escapeMarkdown } from "./text.ts";

export interface ApprovalSession {
  tracker: ActionTracker;
  executor: ToolExecutor;
  pending: ActionLog[];
}

export const approvalSessions = new Map<number, ApprovalSession>();

function groupPending(pending: ActionLog[]) {
  const files = new Map<string, ActionLog[]>();
  const shells: ActionLog[] = [];
  for (const action of pending) {
    if (action.type === "tool_execute") shells.push(action);
    else {
      if (!files.has(action.path)) files.set(action.path, []);
      files.get(action.path)!.push(action);
    }
  }
  return { files, shells };
}

export function approvalSummary(pending: ActionLog[]): string {
  const { files, shells } = groupPending(pending);
  const fileLines = [...files].map(([filePath, actions]) => {
    const types = [...new Set(actions.map((action) => action.type.replace(/_/g, " ")))].join(", ");
    return `📄 \`${escapeMarkdown(filePath)}\` \\(${escapeMarkdown(types)}\\)`;
  });
  const shellLines = shells.map((action) => `🖥 *Shell:* \`${escapeMarkdown(action.details.command ?? "")}\``);
  return [
    "📋 *Review these staged changes*",
    "",
    ...fileLines,
    ...shellLines,
    "",
    `📦 *${pending.length} ${escapeMarkdown("staged change(s)")}* · ${escapeMarkdown("Nothing is applied until you approve.")}`,
  ].join("\n");
}

/** Plain text diff content; the handler wraps it in an HTML <pre> block safely. */
export function approvalDiff(pending: ActionLog[]): string {
  const { files, shells } = groupPending(pending);
  const parts: string[] = [];
  for (const [filePath, actions] of files) {
    const sorted = [...actions].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    const { before, after } = composeBeforeAfter(sorted);
    parts.push(formatPatch(filePath, before, after));
  }
  for (const action of shells) {
    parts.push(`SHELL COMMAND\n${action.details.command ?? "(empty command)"}`);
  }
  return parts.join("\n\n").trim();
}

async function promptApproval(
  ctx: { reply: (text: string, options?: object) => Promise<unknown> },
  chatId: number,
  session: ApprovalSession,
) {
  approvalSessions.set(chatId, session);
  await ctx.reply(approvalSummary(session.pending), {
    ...Markup.inlineKeyboard([
      [Markup.button.callback("👁 Preview diff", "approval_diff")],
      [
        Markup.button.callback("✅ Apply changes", "approval_accept"),
        Markup.button.callback("🗑 Discard", "approval_reject"),
      ],
    ]),
    parse_mode: "MarkdownV2",
  });
}

export async function finishOrApprove(
  ctx: { reply: (text: string, options?: object) => Promise<unknown> },
  chatId: number,
  tracker: ActionTracker,
  executor: ToolExecutor,
  noChangesMsg: string,
) {
  const pending = tracker.getPendingMutations();
  if (pending.length === 0) {
    await ctx.reply(noChangesMsg);
    return;
  }
  await promptApproval(ctx, chatId, { tracker, executor, pending });
}
