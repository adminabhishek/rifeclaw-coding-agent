/**
 * Help / onboarding message builder for the Telegram bot.
 *
 * Uses Telegram's MarkdownV2 (bot API v7+). Plain text is escaped while
 * formatting is added with helpers that preserve active Markdown delimiters.
 */

import { optionalEnv } from "../../env.ts";
import { Markup } from "telegraf";

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
// Escape plain text only. Formatting is added separately so its delimiters
// remain active MarkdownV2 instead of appearing literally in Telegram.
function md2(text: string): string {
  const special = new Set("\\_*[]()~`>#+-=|{}.!".split(""));
  return [...text].map((c) => special.has(c) ? `\\${c}` : c).join("");
}

function bold(text: string): string {
  return `*${md2(text)}*`;
}

function code(text: string): string {
  return `\`${text.replace(/[\\`]/g, (c) => `\\${c}`)}\``;
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
      bold("🤖 RifeClaw — Telegram Bot"),
      bold("AI coding assistant for your local project"),
      `${bold(`v${VERSION}`)}  •  Model: ${code(MODEL)}`,
    ].join("\n"),
  );

  sections.push(
    [
      DIVIDER,
      bold("📚 Commands"),
      ...COMMANDS.map((c) => `${c.icon}  ${bold(c.command)} — ${md2(c.description)}`),
    ].join("\n"),
  );

  sections.push(
    [
      DIVIDER,
      bold("💡 Examples"),
      ...COMMANDS
        .filter((c) => c.example !== c.command)
        .map((c) => `• ${code(c.example)}`),
    ].join("\n"),
  );

  sections.push(
    [
      DIVIDER,
      bold("❓ FAQ"),
      `• ${bold("Are my files safe?")} — Yes. Agent and Plan mode ${bold("stage")} every change. Nothing is written until you click ✅\.`,
      `• ${bold("Can I undo?")} — During a plan you can reject any step. After applying, use ${code("git")} to revert\.`,
      `• ${bold("What model is this?")} — Configurable in your ${code(".env")} (OpenRouter or local Ollama)\.`,
      `• ${bold("Is this private?")} — Only you can talk to this bot. Auth is enforced on every command\.`,
    ].join("\n"),
  );

  sections.push([DIVIDER, bold("Type any command above to get started.")].join("\n"));

  return sections.join("\n\n");
}

/**
 * Welcome /start message — warmer, action-oriented.
 */
export function buildWelcomeMessage(): string {
  return [
    bold("👋 Welcome to RifeClaw!"),
    "",
    bold("I help you navigate and modify your codebase from Telegram."),
    "",
    md2("Choose Ask, Plan, or Agent from the buttons below, then send your request."),
    "",
    md2("Changes are always shown for your approval before they are applied."),
  ].join("\n");
}

/**
 * Shown to non-owners attempting to use the bot.
 */
export function buildUnauthorizedMessage(): string {
  return [
    bold("🔒 Access Denied"),
    "",
    md2("Only the bot owner can use this bot."),
    `If this is your bot, set ${code("TELEGRAM_OWNER_ID")} in your ${code(".env")} to your Telegram numeric user ID\.`,
  ].join("\n");
}

export function welcomeKeyboard() {
  return Markup.keyboard([
    ["🔎 Ask", "🧭 Plan"],
    ["🤖 Agent", "📚 Help"],
  ]).resize().persistent();
}
