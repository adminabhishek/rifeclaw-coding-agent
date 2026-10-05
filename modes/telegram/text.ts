import { marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

let ready = false;

function ensureMarked(): void {
  if (ready) return;
  const w = Math.max(40, Math.min(process.stdout.columns || 80, 120));
  // @ts-ignore
  marked.use(markedTerminal({ width: w, reflowText: true }, {}));
  ready = true;
}

// Export the core renderer for reuse
export function renderTerminalMarkdown(source: string): string {
  ensureMarked();
  return marked.parse(source.trimEnd(), { async: false }) as string;
}

// ── Clip helper (re-exported for backward compatibility) ──────────────────

export const clip = (text: string, max = 4000) =>
  text.length <= max ? text : text.slice(0, max) + '\n…[truncated]';

// ── Command argument helper ─────────────────────────────────────────────

export function commandArg(fullText: string, name: string): string {
  return fullText.replace(new RegExp(`^/${name}\\s*`, 'i'), '').trim();
}

export function isSimpleGreeting(text: string): boolean {
  return /^(?:hi+|hello|hey|heya|hiya|howdy|good\s+(?:morning|afternoon|evening))(?:\s+there)?[.!?…\s]*$/i.test(text.trim());
}

// ── TUI Formatting Utilities (adapted from tui/terminal-md.ts) ─────────────

const TERMINAL_WIDTH = Math.max(40, Math.min(process.stdout.columns || 80, 120));

// Color palette
const COLORS = {
  primary: chalk.cyan,
  success: chalk.green,
  warning: chalk.yellow,
  error: chalk.red,
  info: chalk.blue,
  accent: chalk.magenta,
  dim: chalk.dim,
};

// Wrap text to terminal width
function wrapText(text: string, width: number = TERMINAL_WIDTH): string {
  return text
    .split('\n')
    .map(line => {
      if (line.length <= width) return line;
      const words = line.split(/(?=\s)/);
      let result = '';
      let currentLen = 0;
      for (const word of words) {
        if (currentLen + word.length > width) {
          result += '\n' + word.trimStart();
          currentLen = word.trimStart().length;
        } else {
          result += word;
          currentLen += word.length;
        }
      }
      return result.trimStart();
    })
    .join('\n');
}

// ── Card / Section Rendering ────────────────────────────────────────────────

export interface CardOptions {
  title: string;
  icon?: string;
  padding?: number;
}

export function renderCard(
  content: string,
  opts: CardOptions
): string {
  const icon = opts.icon || '📋';
  const width = TERMINAL_WIDTH;

  const lines = content.trim().split('\n');
  const maxLen = Math.max(
    opts.title.length + 4,
    ...lines.map(l => l.length)
  );

  const horizontal = '─'.repeat(Math.min(maxLen, width - 4));
  const border = chalk.dim('│');

  let result = '';
  result += chalk.cyan(`${icon} ${opts.title}`).trimEnd() + '\n';
  result += border + ' ' + horizontal + ' ' + border + '\n';

  for (const line of lines) {
    const padded = line.padEnd(maxLen).slice(0, width - 4);
    result += border + ' ' + padded + ' ' + border + '\n';
  }

  result += border + ' ' + horizontal + ' ' + border + '\n';
  return result;
}

// ── Section Headers ───────────────────────────────────────────────────────

export function renderHeader(title: string, level: 1 | 2 | 3 = 1): string {
  const width = TERMINAL_WIDTH;
  const padded = title.padEnd(width - 4);
  return chalk.bold(
    level === 1 ? '═'.repeat(width - 4) : level === 2 ? '─'.repeat(width - 4) : '·'.repeat(width - 4)
  ) + '\n' +
  (level === 1 ? chalk.cyan(title) : level === 2 ? chalk.green(title) : chalk.blue(title)) +
  '\n' +
  chalk.dim(level === 1 ? '═'.repeat(width - 4) : level === 2 ? '─'.repeat(width - 4) : '·'.repeat(width - 4));
}

// ── Status Messages ───────────────────────────────────────────────────────

export function success(message: string): string {
  return COLORS.success(` ✅ ${message}`);
}

export function error(message: string): string {
  return COLORS.error(` ❌ ${message}`);
}

export function warning(message: string): string {
  return COLORS.warning(` ⚠️  ${message}`);
}

export function info(message: string): string {
  return COLORS.info(` ℹ️  ${message}`);
}

export function prompt(message: string): string {
  return COLORS.accent(` ▶ ${message}`);
}

// ── Code Block Formatting ───────────────────────────────────────────────

export function codeBlock(code: string, language?: string): string {
  const lines = code.split('\n');
  const maxLen = Math.max(...lines.map(l => l.length));
  const border = chalk.dim('│');

  let result = '';
  result += chalk.dim('│ ') + COLORS.info(language ? `\`\`\`${language}\`\`\`` : '```') + chalk.dim(' │\n');

  for (const line of lines) {
    const padded = line.padEnd(maxLen);
    result += border + ' ' + chalk.white(padded) + ' ' + border + '\n';
  }

  result += border + ' ' + chalk.dim('```') + ' ' + border;
  return result;
}

// ── List Formatting ─────────────────────────────────────────────────────

export function bulletList(items: string[], indent: number = 0): string {
  const prefix = '  '.repeat(indent) + '• ';
  return items.map(item => prefix + colorizeItem(item)).join('\n');
}

export function numberedList(items: string[], indent: number = 0): string {
  const prefix = '  '.repeat(indent);
  return items.map((item, i) => prefix + `${i + 1}. ${colorizeItem(item)}`).join('\n');
}

function colorizeItem(text: string): string {
  return text.replace(/(`[^`]+`)/g, COLORS.accent('$1'))
             .replace(/(https?:\/\/\S+)/g, COLORS.info('$1'));
}

// ── Summary Box ─────────────────────────────────────────────────────────

export function summaryBox(lines: { label: string; value: string | number }[]): string {
  const keyWidth = Math.max(...lines.map(l => l.label.length)) + 2;
  const rows = lines.map(l =>
    chalk.dim(l.label.padEnd(keyWidth)) + (typeof l.value === 'number' ? COLORS.success(String(l.value)) : COLORS.info(String(l.value)))
  );
  return rows.join('\n');
}

// ── Markdown helper for Telegram (escape then render) ────────────────────

/** Escape Markdown special characters for Telegram's Markdown parser */
export function escapeMarkdown(text: string): string {
  const escapeChars: Record<string, string> = {
    // Escape backslashes first in effect: MarkdownV2 treats them as escape
    // introducers, so leaving one in user/model text can cancel the escape
    // added for a following character (for example `\\|` leaves `|` raw).
    '\\': '\\\\',
    '*': '\\*',
    '_': '\\_',
    '[': '\\[',
    ']': '\\]',
    '(': '\\(',
    ')': '\\)',
    '~': '\\~',
    '`': '\\`',
    '>': '\\>',
    '#': '\\#',
    '+': '\\+',
    '-': '\\-',
    '=': '\\=',
    '|': '\\|',
    '{': '\\{',
    '}': '\\}',
    '.': '\\.',
    '!': '\\!'
  };

  return text.split('').map(char => escapeChars[char] || char).join('');
}

/** Send generated text to Telegram without terminal codes or MarkdownV2 escapes. */
export async function replyMarkdown(
  ctx: { reply: (t: string, o?: object) => Promise<unknown> },
  text: string,
  opts: { parseMode?: "Markdown" | "MarkdownV2" | "HTML" } = {}
): Promise<unknown> {
  const { parseMode } = opts;
  // Telegram's legacy Markdown parser does not understand MarkdownV2 escaping.
  // Send generated Markdown as readable plain text by default, and split long
  // answers below Telegram's 4096 character limit. Explicit parse modes are
  // passed through unchanged because their callers own the corresponding syntax.
  // Model output sometimes contains Telegram MarkdownV2 escapes even though
  // these answers are sent as plain text. Drop those formatting escapes so
  // users see `Hello!` instead of `Hello\!`; preserve ordinary path slashes.
  const markdownV2Special = new Set("\\_*[]()~`>#+-=|{}.!".split(""));
  const displayText = parseMode
    ? text
    : text.replace(/\\([\s\S])/g, (match, char: string) =>
        markdownV2Special.has(char) ? char : match,
      );
  const chunks = splitTelegramText(displayText, parseMode ? 3800 : 3900);
  let last: unknown;
  for (const chunk of chunks) {
    last = parseMode
      ? await ctx.reply(chunk, { parse_mode: parseMode })
      : await ctx.reply(chunk);
  }
  return last;
}

function splitTelegramText(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > limit) {
    let boundary = remaining.lastIndexOf("\n", limit);
    if (boundary < limit * 0.55) boundary = remaining.lastIndexOf(" ", limit);
    if (boundary < limit * 0.55) boundary = limit;
    chunks.push(remaining.slice(0, boundary).trimEnd());
    remaining = remaining.slice(boundary).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/** Strip ANSI escape sequences (chalk colour codes) from a string. */
export function stripAnsi(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
