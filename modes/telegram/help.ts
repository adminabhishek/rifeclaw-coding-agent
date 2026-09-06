/**
 * Help / onboarding message builder for the Telegram bot.
 *
 * Uses Telegram's MarkdownV2 (bot API v7+). All raw text is pre-escaped
 * via the local md2() helper so it renders correctly in any client.
 */

import { optionalEnv } from "../../env.ts";

// Hardcoded version — update manually when releasing. Avoids path-fragility
// of import.meta.url in bundled/published packages.
const VERSION = "0.1.6";

const MODEL = (() => {
  const provider = optionalEnv("AI_PROVIDER")?.toLowerCase();
  if (provider === "ollama") {
    return optionalEnv("OLLAMA_MODEL") ?? "ollama (check .env)";
  }
  return optionalEnv("OPENROUTER_DEFAULT_MODEL") ?? "unknown";
})();

// ── MarkdownV2 escape ───────────────────────────────────────────────────────
// Characters that MUST be escaped in MarkdownV2 outside of code spans:
//   _ * [ ] ( ) ~ ` > # + - = | { } . !
// We temporarily protect inline backtick code spans, escape everything else,
// then restore the code spans.

function md2(text: string): string {
  const codeSpans: string[] = [];
  let result = text.replace(/`[^`\n]+`/g, (m) => {
    codeSpans.push(m);
    return `\x00${codeSpans.length - 1}\x00`;
  });
  // Escape all MarkdownV2 special chars.
  // Per Telegram docs: _ * [ ] ( ) ~ ` > # + - = | { } . !
  result = result.replace(/[_*[\]()~`>#+\-=|{}.!]/g, (c) => `\\${c}`);
  result = result.replace(/\x00(\d+)\x00/g, (_, i) => {
    const span = codeSpans[Number(i)] ?? "";
    // Escape dots and parentheses inside code spans too — Telegram's parser
    // is stricter than the spec and requires them escaped everywhere.
    return span.replace(/[().]/g, (c) => `\\${c}`);
  });
  return result;
}

interface CommandEntry {
  command: string;
  description: string;
  example: string;
  icon: string;
}

const COMMANDS: CommandEntry[] = [
  {
    command: "/ask",
    description: "Ask a question about your codebase. Read-only — never modifies files.",
    example: "/ask where is authentication handled?",
    icon: "🔍",
  },
  {
    command: "/agent",
    description: "Run a multi-step agent that explores the codebase and proposes file changes for your approval.",
    example: "/agent refactor the user model to use Zod validation",
    icon: "🤖",
  },
  {
    command: "/plan",
    description: "Generate a structured, multi-step plan for a larger goal. Pick which steps to execute.",
    example: "/plan add rate limiting to the API",
    icon: "🗺",
  },
  {
    command: "/help",
    description: "Show this help message.",
    example: "/help",
    icon: "ℹ️",
  },
  {
    command: "/start",
    description: "Welcome message and quick start guide.",
    example: "/start",
    icon: "👋",
  },
];

// Unicode box-drawing — NOT a Markdown special char, safe to use unescaped.
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━";

/**
 * Full /help message — index, examples, FAQ, footer.
 */
export function buildHelpMessage(): string {
  const sections: string[] = [];

  sections.push(
    [
      md2("*🤖 RifeClaw — Telegram Bot*"),
      md2("*AI coding assistant for your local project*"),
      md2(`*v${VERSION}*  •  Model: \`${MODEL}\``),
    ].join("\n"),
  );

  sections.push(
    [
      DIVIDER,
      md2("*📚 Commands*"),
      ...COMMANDS.map((c) => md2(`${c.icon}  *${c.command}* — ${c.description}`)),
    ].join("\n"),
  );

  sections.push(
    [
      DIVIDER,
      md2("*💡 Examples*"),
      ...COMMANDS
        .filter((c) => c.example !== c.command)
        .map((c) => md2(`• \`${c.example}\``)),
    ].join("\n"),
  );

  sections.push(
    [
      DIVIDER,
      md2("*❓ FAQ*"),
      md2("• *Are my files safe?* — Yes. Agent and Plan mode *stage* every change. Nothing is written until you click ✅."),
      md2("• *Can I undo?* — During a plan you can reject any step. After applying, use `git` to revert."),
      md2("• *What model is this?* — Configurable in your `.env` (OpenRouter or local Ollama)."),
      md2("• *Is this private?* — Only you can talk to this bot. Auth is enforced on every command."),
    ].join("\n"),
  );

  sections.push([DIVIDER, md2("*Type any command above to get started.*")].join("\n"));

  return sections.join("\n\n");
}

/**
 * Welcome /start message — warmer, action-oriented.
 */
export function buildWelcomeMessage(): string {
  return [
    md2("*👋 Welcome to RifeClaw!*"),
    "",
    md2("*I help you navigate and modify your codebase from Telegram.*"),
    "",
    md2("*Quick start:*"),
    md2("1) Try /ask for a read-only question first."),
    md2("2) Use /plan to break larger work into steps."),
    md2("3) Use /agent when you want me to make changes (with your approval)."),
    "",
    md2("*Run /help any time to see all commands and examples.*"),
  ].join("\n");
}

/**
 * Shown to non-owners attempting to use the bot.
 */
export function buildUnauthorizedMessage(): string {
  return [
    md2("*🔒 Access Denied*"),
    "",
    md2("Only the bot owner can use this bot."),
    md2("If this is your bot, set `TELEGRAM_OWNER_ID` in your `.env` to your Telegram numeric user ID."),
  ].join("\n");
}
