export const clip = (text: string, max = 4000) =>
  text.length <= max ? text : text.slice(0, max) + '\n…[truncated]';

/**
 * Escape Markdown special characters for Telegram's Markdown parser
 * Reference: https://core.telegram.org/bots/api#formatting-options
 */
export function escapeMarkdown(text: string): string {
  // Escape special characters for Telegram's legacy Markdown syntax
  const escapeChars: Record<string, string> = {
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

export const replyMd = (ctx: { reply: (t: string, o?: object) => Promise<unknown> }, text: string) =>
  ctx.reply(clip(text), { parse_mode: 'Markdown' });

/** Text after `/name …` */
export function commandArg(fullText: string, name: string): string {
  return fullText.replace(new RegExp(`^/${name}\\s*`, 'i'), '').trim();
}
