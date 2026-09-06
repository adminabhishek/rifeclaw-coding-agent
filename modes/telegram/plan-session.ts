import { Markup } from 'telegraf';
import type { Plan } from '../plan/types.ts';
import { escapeMarkdown } from './text.ts';


export interface PlanSession {
  plan: Plan;
  selected: Set<string>;
}

export const planSessions = new Map<number, PlanSession>();

export function planMessage(session: PlanSession): string {
  const lines = session.plan.steps.map((step, i) => {
    const mark = session.selected.has(step.id) ? '✅' : '⬜';
    const tag = step.complexity ? ` \\[${escapeMarkdown(step.complexity)}\\]` : '';
    return escapeMarkdown(`${mark} ${i + 1}. *${step.title}*${tag}`);
  });

  const statusBar = `\n---\n📊 Steps: ${session.selected.size}/${session.plan.steps.length} selected`;

  return [
    '🗺 *Roadmap*',
    escapeMarkdown(`📋 ${session.plan.goal}`),
    '',
    ...lines,
    '',
    '🎯 Tap steps to toggle \\(✅/⬜\\), then hit Proceed',
    '💡 Select all or none with the buttons below',
    escapeMarkdown(statusBar),
    '',
    '🔀 Navigation — tap a step to navigate',
    '◀️ | 🔁 | ▶️',
  ].join('\n');
}

export function planKeyboard(session: PlanSession) {
  const stepButton = session.plan.steps.map((step, i) => {
    const mark = session.selected.has(step.id) ? '✅' : '⬜';
    const label = `${mark} ${i + 1}. ${step.title}`;
    return [Markup.button.callback(label, `plan_toggle:${step.id}`)];
  });

  return Markup.inlineKeyboard([
    ...stepButton,
    [
      Markup.button.callback('◀️ Prev', 'plan_prev'),
      Markup.button.callback('🔁 Refresh', 'plan_refresh'),
      Markup.button.callback('▶️ Next', 'plan_next'),
    ],
    [
      Markup.button.callback('✅ Select All', 'plan_all'),
      Markup.button.callback('⬜ Deselect All', 'plan_none'),
    ],
    [Markup.button.callback('🚀 Proceed', 'plan_proceed')],
  ]);
}

export async function refreshPlanUi(
  ctx: { editMessageText: (t: string, o: object) => Promise<unknown> },
  s: PlanSession,
) {
  await ctx.editMessageText(planMessage(s), {
    parse_mode: 'MarkdownV2',
    reply_markup: planKeyboard(s).reply_markup,
  });
}