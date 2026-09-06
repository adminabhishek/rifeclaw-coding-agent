import { buildWelcomeMessage, buildHelpMessage, buildUnauthorizedMessage } from './modes/telegram/help.ts';

function findUnescaped(text, chars, label) {
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (chars.includes(text[i])) {
      const prev = i > 0 ? text[i - 1] : '';
      if (prev !== '\\') {
        const ctx = text.slice(Math.max(0, i - 12), i + 12);
        console.log(`  [${label}] unescaped "${text[i]}" at ${i}: ${JSON.stringify(ctx)}`);
        count++;
      }
    }
  }
  console.log(`  [${label}] total unescaped: ${count}`);
  return count;
}

// Check all exported messages
const msgs = [
  { fn: buildWelcomeMessage, name: 'welcome' },
  { fn: buildHelpMessage, name: 'help' },
  { fn: buildUnauthorizedMessage, name: 'unauthorized' },
];

const MARKDOWNV2_SPECIAL = '()[]_*.~`>#+-=|{}.!';

for (const { fn, name } of msgs) {
  const text = fn();
  console.log(`\n${name}: ${text.length} chars`);
  findUnescaped(text, MARKDOWNV2_SPECIAL.split(''), name);
}
