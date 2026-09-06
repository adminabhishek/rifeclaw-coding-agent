import type { Telegraf } from "telegraf";
import { isOwner } from "./auth";
import { buildHelpMessage, buildWelcomeMessage, buildUnauthorizedMessage } from "./help";
import { clip, commandArg, escapeMarkdown } from "./text";
import { runAgent, runAsk, runPlanSteps } from "./agent-run";
import { generatePlan } from "../plan/planner";
import { planKeyboard, planMessage, planSessions, refreshPlanUi, type PlanSession } from "./plan-session";
import { approvalDiff, approvalSessions } from "./approval-session";
import { usageError, internalError } from "./error";

export function registerHandlers(bot: Telegraf) {
  // ── /start ── Welcome the owner, or silently ignore strangers ───────────
  bot.command("start", async (ctx) => {
    if (!isOwner(ctx.chat.id)) {
      // Don't reveal bot capabilities to non-owners.
      return;
    }
    try {
      await ctx.reply(buildWelcomeMessage(), { parse_mode: "MarkdownV2" });
    } catch (error) {
      console.error("/start failed:", error);
    }
  });

  // ── /help ── Production-grade help index ───────────────────────────────
  bot.command("help", async (ctx) => {
    if (!isOwner(ctx.chat.id)) {
      // Inform the unauthorized user with a single clean message.
      try {
        await ctx.reply(buildUnauthorizedMessage(), { parse_mode: "MarkdownV2" });
      } catch {
        /* ignore — we can't even reply */
      }
      return;
    }
    try {
      await ctx.reply(buildHelpMessage(), { parse_mode: "MarkdownV2" });
    } catch (error) {
      console.error("/help failed:", error);
      // Fall back to a plain-text reply if Markdown parsing fails.
      try {
        await ctx.reply("Help is currently unavailable. Please try again in a moment.");
      } catch {
        /* give up */
      }
    }
  });

  bot.command("ask", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const q = commandArg(ctx.message.text, "ask");
    if (!q) {
      try {
        await ctx.reply(
          usageError({
            command: "/ask",
            description: "Ask a read-only question about your codebase. The agent will search files and provide an answer.",
            examples: ["what does the auth module do?", "find the main entry point"],
          }),
          { parse_mode: "MarkdownV2" },
        );
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      await ctx.reply("🔍 *Analyzing your question…*", { parse_mode: "MarkdownV2" });
    } catch {
      /* ignore */
    }
    void runAsk(ctx, q).catch(console.error);
  });

  bot.command("agent", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "agent");
    if (!goal) {
      try {
        await ctx.reply(
          usageError({
            command: "/agent",
            description: "Run a full coding agent that reads files, writes changes, and stages them for your approval.",
            examples: ["add input validation to the form", "extract a shared Button component"],
          }),
          { parse_mode: "MarkdownV2" },
        );
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await ctx.reply("🤖 *Agent is working on your task…*", { parse_mode: "MarkdownV2" });
    } catch {
      /* ignore */
    }
    void runAgent(ctx, ctx.chat.id, goal).catch(console.error);
  });

  bot.command("plan", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "plan");

    if (!goal) {
      try {
        await ctx.reply(
          usageError({
            command: "/plan",
            description: "Generate a structured, step-by-step plan. You pick which steps to execute.",
            examples: ["add user authentication", "migrate the database to SQLite"],
          }),
          { parse_mode: "MarkdownV2" },
        );
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      await ctx.reply("🧭 *Generating a plan…*", { parse_mode: "MarkdownV2" });
    } catch {
      /* ignore */
    }

    void (async () => {
      try {
        const plan = await generatePlan(goal);
        const session: PlanSession = {
          plan,
          selected: new Set(plan.steps.map((s) => s.id)),
        };
        await ctx.reply(planMessage(session), {
          parse_mode: "Markdown",
          ...planKeyboard(session),
        });
        planSessions.set(ctx.chat.id, session);
      } catch (error) {
        console.error("/plan failed:", error);
        try {
          await ctx.reply(
            internalError("planning"),
            { parse_mode: "MarkdownV2" },
          );
        } catch {
          /* ignore */
        }
      }
    })();
  });

    bot.action(/^plan_toggle:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    const id = ctx.match[1]!;
    if (s.selected.has(id)) s.selected.delete(id);
    else s.selected.add(id);

    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

  
  bot.action('plan_all', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    for (const step of s.plan.steps) s.selected.add(step.id);
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

    bot.action('plan_none', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    s.selected.clear();
    await refreshPlanUi(ctx, s);
    await ctx.answerCbQuery();
  });

   bot.action('plan_proceed', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = planSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    const steps = s.plan.steps.filter((step) => s.selected.has(step.id));
    if (steps.length === 0) return ctx.answerCbQuery();

    const { plan } = s;
    planSessions.delete(ctx.chat!.id);
    const list = steps.map((step, i) => `${i + 1}. *${escapeMarkdown(step.title)}*`).join('\n');
    await ctx.editMessageText(
      `🚀 *Executing ${steps.length} step(s)…*\n\n${list}`,
      { parse_mode: "MarkdownV2" },
    );
    await ctx.answerCbQuery();

    void runPlanSteps(ctx, ctx.chat!.id, plan, steps).catch(console.error);
  });

  bot.action('approval_diff', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();
    await ctx.answerCbQuery();
    await ctx.reply("```\n" + clip(approvalDiff(s.pending), 3500) + "\n```", { parse_mode: "MarkdownV2" });
  });

  bot.action('approval_accept', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    approvalSessions.delete(ctx.chat!.id);
    for (const a of s.pending) s.tracker.updateStatus(a.id, 'approved', true);
    const { errors } = s.executor.applyApprovedFromTracker();
    s.executor.clearStaging();

    await ctx.editMessageText("✅ *All changes applied.*", { parse_mode: "MarkdownV2" });
    await ctx.answerCbQuery('Applied!');
    if (errors.length) console.error(errors);
  });

  bot.action('approval_reject', async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const s = approvalSessions.get(ctx.chat!.id);
    if (!s) return ctx.answerCbQuery();

    approvalSessions.delete(ctx.chat!.id);
    for (const a of s.pending) s.tracker.updateStatus(a.id, 'rejected', false);
    s.executor.clearStaging();

    await ctx.editMessageText("❌ *All changes rejected.* Nothing was applied.", { parse_mode: "MarkdownV2" });
    await ctx.answerCbQuery('Rejected');
  });

}
