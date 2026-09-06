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

export function renderTerminalMarkdown(source: string): string {
  ensureMarked();
  return marked.parse(source.trimEnd(), { async: false }) as string;
}

// ── TUI Formatting Utilities ───────────────────────────────────────────────

// Width for wrapping - must be defined before use
export const TERM_WIDTH = Math.max(40, Math.min(process.stdout.columns || 80, 120));

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

// Width for wrapping
const TERMINAL_WIDTH = TERM_WIDTH;

// Wrap text to terminal width
function wrapText(text: string, width: number = TERMINAL_WIDTH): string {
  return text
    .split('\n')
    .map(line => {
      if (line.length <= width) return line;
      // Simple word wrap - don't break URLs or code blocks
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
  const width = TERM_WIDTH;

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
  const width = TERM_WIDTH;
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
  result += chalk.dim('│ ') + COLORS.info(language ? `\`\`\`${language}\`` : '```') + chalk.dim(' │\n');

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
  // Highlight code-like patterns
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