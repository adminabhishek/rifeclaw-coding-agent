import { Markup, type Context, type Telegraf } from "telegraf";
import { isOwner } from "./auth";
import { buildHelpMessage, buildWelcomeMessage, buildUnauthorizedMessage, welcomeKeyboard } from "./help";
import { clip, commandArg, escapeMarkdown } from "./text";
import { runAgent, runAsk, runPlanSteps } from "./agent-run";
import { generatePlan } from "../plan/planner";
import { planKeyboard, planMessage, planSessions, refreshPlanUi, type PlanSession } from "./plan-session";
import { approvalDiff, approvalSessions } from "./approval-session";
import { usageError } from "./error";
import { telegramProviderError } from "./provider-error";
import { memoryManager } from "../../src/ai/memory.ts";
import { defaultAgentConfig } from "../agent/types";

type QuickMode = "ask" | "agent" | "plan";

function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);
}

async function replyWithHelp(ctx: Context): Promise<void> {
  const message = buildHelpMessage();
  try {
    await ctx.reply(message, { parse_mode: "MarkdownV2", ...welcomeKeyboard() });
  } catch (error) {
    console.error("Could not send formatted Telegram help; retrying as plain text:", error);
    const plainText = message
      .replace(/\\([_*\[\]()~`>#+\-=|{}.!])/g, "$1")
      .replace(/[*_`]/g, "");
    await ctx.reply(plainText, { ...welcomeKeyboard() });
  }
}

export function registerHandlers(bot: Telegraf) {
  // Keep the selected mode for this chat until another mode is chosen.
  const selectedModeByChat = new Map<number, QuickMode>();
  const activeRuns = new Map<number, AbortController>();
  const isBusy = (chatId: number) => activeRuns.has(chatId) || planSessions.has(chatId) || approvalSessions.has(chatId);
  const showIdleKeyboard = (ctx: Context, text = "Ready for your next request. Choose a mode:") =>
    ctx.reply(text, {
      ...Markup.inlineKeyboard([
        [
          Markup.button.callback("🔎 Ask", "quick:ask"),
          Markup.button.callback("🧭 Plan", "quick:plan"),
          Markup.button.callback("🤖 Agent", "quick:agent"),
        ],
        [Markup.button.callback("📚 Help", "quick:help")],
      ]),
    });
  const runWithLock = (ctx: Context, chatId: number, task: (signal: AbortSignal) => Promise<unknown>) => {
    if (isBusy(chatId)) {
      void ctx.reply("A task or review is already active in this chat. Send /cancel to stop or dismiss it.");
      return;
    }
    const controller = new AbortController();
    activeRuns.set(chatId, controller);
    void task(controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.error(error);
    }).finally(() => {
      if (activeRuns.get(chatId) === controller) activeRuns.delete(chatId);
      if (!isBusy(chatId)) {
        void showIdleKeyboard(ctx).catch((error) => {
          console.error("Could not restore Telegram menu keyboard:", error);
        });
      }
    });
  };

  const startMode = async (ctx: Context, mode: QuickMode, input: string) => {
    if (mode === "ask") {
      runWithLock(ctx, ctx.chat!.id, (signal) => runAsk(ctx, ctx.chat!.id, input, signal));
      return;
    }

    if (mode === "agent") {
      runWithLock(ctx, ctx.chat!.id, (signal) => runAgent(ctx, ctx.chat!.id, input, signal));
      return;
    }

    await ctx.reply("🧭 *Building your plan…*", { parse_mode: "MarkdownV2" });
    runWithLock(ctx, ctx.chat!.id, async (signal) => {
      try {
        const config = defaultAgentConfig();
        const sessionId = memoryManager.resolveSessionId(`telegram_plan_${ctx.chat!.id}`, config.codebasePath);
        const priorContext = memoryManager.getRecentContext(sessionId);
        const plan = await generatePlan(input, priorContext || undefined);
        if (signal.aborted) return;
        memoryManager.addMessage(sessionId, "user", input);
        memoryManager.addMessage(sessionId, "assistant", `Plan: ${plan.goal}\nSteps: ${plan.steps.map((step) => step.title).join(", ")}`);
        memoryManager.saveToDisk();
        const session: PlanSession = {
          plan,
          selected: new Set(plan.steps.map((step) => step.id)),
        };
        planSessions.set(ctx.chat!.id, session);
        await ctx.reply(planMessage(session), {
          ...planKeyboard(session),
        });
      } catch (error) {
        console.error("Plan generation failed:", telegramProviderError(error));
        await ctx.reply(telegramProviderError(error));
      }
    });
  };

  const promptForMode = async (ctx: Context, mode: QuickMode) => {
    selectedModeByChat.set(ctx.chat!.id, mode);
    const prompts: Record<QuickMode, string> = {
      ask: "🔎 Send the question you want me to answer.",
      agent: "🤖 Describe the change you want me to make. I’ll ask before applying it.",
      plan: "🧭 Describe the goal you want to plan.",
    };
    await ctx.reply(`${prompts[mode]}\n\nSend /cancel to dismiss.`, {
      ...welcomeKeyboard(),
    });
  };

  bot.command("start", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    await ctx.reply(buildWelcomeMessage(), {
      parse_mode: "MarkdownV2",
      ...welcomeKeyboard(),
    });
  });

  bot.command("help", async (ctx) => {
    if (!isOwner(ctx.chat.id)) {
      await ctx.reply(buildUnauthorizedMessage(), { parse_mode: "MarkdownV2" });
      return;
    }
    try {
      await replyWithHelp(ctx);
    } catch (error) {
      console.error("/help failed:", error);
      await ctx.reply("Help is unavailable right now. Please try again shortly.");
    }
  });

  bot.command("ask", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const question = commandArg(ctx.message.text, "ask");
    if (!question) {
      await ctx.reply(usageError({
        command: "/ask",
        description: "Ask a read-only question about your project.",
        examples: ["what does the auth module do?", "find the main entry point"],
      }), { parse_mode: "MarkdownV2" });
      return;
    }
    await startMode(ctx, "ask", question);
  });

  bot.command("agent", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "agent");
    if (!goal) {
      await ctx.reply(usageError({
        command: "/agent",
        description: "Ask the coding agent to make a change. It will show you the changes for approval.",
        examples: ["add input validation to the form", "extract a shared Button component"],
      }), { parse_mode: "MarkdownV2" });
      return;
    }
    await startMode(ctx, "agent", goal);
  });

  bot.command("plan", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const goal = commandArg(ctx.message.text, "plan");
    if (!goal) {
      await ctx.reply(usageError({
        command: "/plan",
        description: "Create a step-by-step plan and choose which steps to run.",
        examples: ["add user authentication", "migrate the database to SQLite"],
      }), { parse_mode: "MarkdownV2" });
      return;
    }
    await startMode(ctx, "plan", goal);
  });

  bot.action(/^quick:(ask|agent|plan)$/, async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const mode = ctx.match[1] as QuickMode;
    await ctx.answerCbQuery();
    await promptForMode(ctx, mode);
  });

  bot.hears("🔎 Ask", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    await promptForMode(ctx, "ask");
  });

  bot.hears("🧭 Plan", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    await promptForMode(ctx, "plan");
  });

  bot.hears("🤖 Agent", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    await promptForMode(ctx, "agent");
  });

  bot.hears(/^\s*(?:📚\s*)?help\s*$/iu, async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    selectedModeByChat.delete(ctx.chat.id);
    await replyWithHelp(ctx);
  });

  bot.action("quick:help", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    selectedModeByChat.delete(ctx.chat!.id);
    await ctx.answerCbQuery();
    await replyWithHelp(ctx);
  });

  bot.command("cancel", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const chatId = ctx.chat.id;
    const controller = activeRuns.get(chatId);
    if (controller) controller.abort();
    const plan = planSessions.get(chatId);
    if (plan) planSessions.delete(chatId);
    const approval = approvalSessions.get(chatId);
    if (approval) {
      approvalSessions.delete(chatId);
      for (const action of approval.pending) approval.tracker.updateStatus(action.id, "rejected", false);
      approval.executor.clearStaging();
    }
    const cancelled = Boolean(controller) || Boolean(plan) || Boolean(approval);
    await ctx.reply(cancelled ? "Cancelled. Any staged changes were discarded and nothing was applied." : "There’s nothing to cancel.");
    if (!isBusy(chatId)) await showIdleKeyboard(ctx);
  });

  bot.on("text", async (ctx) => {
    if (!isOwner(ctx.chat.id)) return;
    const mode = selectedModeByChat.get(ctx.chat.id);
    if (!mode) return;

    const input = ctx.message.text.trim();
    if (/^\/cancel(?:@\w+)?$/i.test(input)) {
      selectedModeByChat.delete(ctx.chat.id);
      await ctx.reply("Quick start cancelled.");
      await showIdleKeyboard(ctx);
      return;
    }
    if (!input || input.startsWith("/")) return;

    await startMode(ctx, mode, input);
  });

  bot.action(/^plan_toggle:(.+)$/, async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = planSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This plan has expired. Send /plan to start again.", { show_alert: true });

    const id = ctx.match[1]!;
    if (session.selected.has(id)) session.selected.delete(id);
    else if (session.plan.steps.some((step) => step.id === id)) session.selected.add(id);

    await ctx.answerCbQuery();
    await refreshPlanUi(ctx, session);
  });

  bot.action("plan_all", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = planSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This plan has expired.", { show_alert: true });
    for (const step of session.plan.steps) session.selected.add(step.id);
    await ctx.answerCbQuery("All steps selected");
    await refreshPlanUi(ctx, session);
  });

  bot.action("plan_none", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = planSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This plan has expired.", { show_alert: true });
    session.selected.clear();
    await ctx.answerCbQuery("Selection cleared");
    await refreshPlanUi(ctx, session);
  });

  bot.action("plan_cancel", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = planSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This plan has expired.", { show_alert: true });
    planSessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery("Plan cancelled");
    await ctx.editMessageText("Plan cancelled. No steps were run.", {
      reply_markup: { inline_keyboard: [] },
    });
    await showIdleKeyboard(ctx);
  });

  bot.action("plan_proceed", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = planSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This plan has expired.", { show_alert: true });

    const steps = session.plan.steps.filter((step) => session.selected.has(step.id));
    if (steps.length === 0) return ctx.answerCbQuery("Select at least one step to continue.", { show_alert: true });

    planSessions.delete(ctx.chat!.id);
    await ctx.answerCbQuery("Starting your plan");
    const summary = steps.map((step, index) => `${index + 1}. ${escapeMarkdown(step.title)}`).join("\n");
    await ctx.editMessageText(`🚀 Running ${steps.length} selected steps\n\n${summary}`, {
      reply_markup: { inline_keyboard: [] },
    });
    runWithLock(ctx, ctx.chat!.id, (signal) => runPlanSteps(ctx, ctx.chat!.id, session.plan, steps, signal));
  });

  bot.action("approval_diff", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = approvalSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This approval has expired.", { show_alert: true });
    await ctx.answerCbQuery();
    const diff = escapeHtml(clip(approvalDiff(session.pending), 3500));
    await ctx.reply(`<pre>${diff}</pre>`, { parse_mode: "HTML" });
  });

  bot.action("approval_accept", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = approvalSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This approval has expired.", { show_alert: true });

    approvalSessions.delete(ctx.chat!.id);
    for (const action of session.pending) session.tracker.updateStatus(action.id, "approved", true);
    const { errors } = session.executor.applyApprovedFromTracker();
    session.executor.clearStaging();

    await ctx.answerCbQuery(errors.length ? "Applied with errors" : "Applied");
    await ctx.editMessageText(errors.length
      ? `⚠️ Approved, but ${errors.length} operation(s) failed:\n${clip(errors.join("\n"), 2500)}`
      : "✅ Approved changes have been applied.", { reply_markup: { inline_keyboard: [] } });
    await showIdleKeyboard(ctx);
    if (errors.length) console.error("Telegram approval apply errors:", errors);
  });

  bot.action("approval_reject", async (ctx) => {
    if (!isOwner(ctx.chat!.id)) return ctx.answerCbQuery();
    const session = approvalSessions.get(ctx.chat!.id);
    if (!session) return ctx.answerCbQuery("This approval has expired.", { show_alert: true });

    approvalSessions.delete(ctx.chat!.id);
    for (const action of session.pending) session.tracker.updateStatus(action.id, "rejected", false);
    session.executor.clearStaging();

    await ctx.answerCbQuery("Changes discarded");
    await ctx.editMessageText("❌ Changes discarded. Nothing was applied.", {
      reply_markup: { inline_keyboard: [] },
    });
    await showIdleKeyboard(ctx);
  });

}
