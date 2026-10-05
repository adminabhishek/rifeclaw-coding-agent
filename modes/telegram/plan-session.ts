import { Markup } from "telegraf";
import { escapeMarkdown } from "./text.ts";
import type { Plan } from "../plan/types.ts";

export interface PlanSession {
  plan: Plan;
  selected: Set<string>;
}

export const planSessions = new Map<number, PlanSession>();

function shortLabel(value: string, max = 34): string {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max - 1).join("")}…` : value;
}

export function planMessage(session: PlanSession): string {
  const lines = session.plan.steps.map((step, i) => {
    const mark = session.selected.has(step.id) ? "✅" : "▫️";
    const complexity = step.complexity
      ? ` \\[${escapeMarkdown(step.complexity)}\\]`
      : "";
    return `${mark} ${i + 1}. ${escapeMarkdown(step.title)}${complexity}`;
  });

  return [
    "🧭 Plan review",
    "",
    shortLabel(escapeMarkdown(session.plan.goal), 700),
    "",
    ...lines,
    "",
    `📊 ${session.selected.size}/${session.plan.steps.length} steps selected`,
    "Tap a step to include or skip it, then continue.",
  ].join("\n");
}

export function planKeyboard(session: PlanSession) {
  const stepButtons = session.plan.steps.map((step, i) => {
    const mark = session.selected.has(step.id) ? "✅" : "▫️";
    return [Markup.button.callback(
      `${mark} ${i + 1}. ${shortLabel(step.title)}`,
      `plan_toggle:${step.id}`,
    )];
  });

  return Markup.inlineKeyboard([
    ...stepButtons,
    [
      Markup.button.callback("Select all", "plan_all"),
      Markup.button.callback("Clear", "plan_none"),
    ],
    [Markup.button.callback("Cancel plan", "plan_cancel")],
    [Markup.button.callback("▶️ Run selected steps", "plan_proceed")],
  ]);
}

export async function refreshPlanUi(
  ctx: { editMessageText: (text: string, options: object) => Promise<unknown> },
  session: PlanSession,
) {
  await ctx.editMessageText(planMessage(session), {
    reply_markup: planKeyboard(session).reply_markup,
  });
}
