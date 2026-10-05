/** Human-readable Telegram error messages with context and examples */

// MarkdownV2 escape helper (inline to avoid circular deps)
function escapeMd2(text: string): string {
  const special = new Set("\\_*[]()~`>#+-=|{}.!".split(""));
  return [...text].map((char) => special.has(char) ? `\\${char}` : char).join("");
}

interface TelegramErrorOptions {
  command: string;
  description: string;
  examples: string[];
}

export function usageError(opts: TelegramErrorOptions): string {
  const examples = opts.examples
    .map((ex) => `\n  \`${opts.command} ${ex}\``)
    .join('');
  return escapeMd2(`❌ *Usage*\n\n${opts.description}\n\n*Examples:*${examples}`);
}

export function authorizationError(): string {
  return escapeMd2('🔒 Access denied. Only the owner of this bot can use commands.');
}

export function internalError(context: 'planning' | 'agent-run' | 'unknown'): string {
  const messages: Record<typeof context, string> = {
    planning:
      '🧠 Plan generation failed.\nThis might be due to an API issue or an extremely complex goal.\nTry simplifying the goal or breaking it into smaller pieces.',
    'agent-run':
      '🤖 Agent failed to complete the task.\nThis might be due to an API issue or an unexpected error.\nPlease check logs or try again later.',
    unknown:
      '💥 An unexpected error occurred.\nOur team has been notified. Please try again in a few minutes.',
  };
  return escapeMd2(messages[context]);
}

export function networkError(): string {
  return escapeMd2('📡 Network error while contacting the API.\nPlease check your connection or API key configuration.');
}

export function rateLimitError(): string {
  return escapeMd2('⏳ You\'ve hit the rate limit. Please wait a moment and try again.');
}
