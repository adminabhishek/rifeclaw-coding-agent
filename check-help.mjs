import { buildWelcomeMessage, buildHelpMessage, buildUnauthorizedMessage } from './modes/telegram/help.ts';

function findUnescaped(text, char, label) {
  let count = 0;
  let positions = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === char) {
      const prev = i > 0 ? text[i - 1] : '';
      if (prev !== '\\') {
        positions.push(i);
        count++;
      }
    }
  }
  if (count > 0) {
    console.log(`  [${label}] unescaped "${char}" at positions:`, positions.slice(0, 10));
    for (const p of positions.slice(0, 3)) {
      console.log(`    context @${p}: ${JSON.stringify(text.slice(Math.max(0, p-15), p+15))}`);
    }
  }
  return count;
}

const msgs = [
  { text: buildWelcomeMessage(), name: 'welcome' },
  { text: buildHelpMessage(), name: 'help' },
  { text: buildUnauthorizedMessage(), name: 'unauthorized' },
];

const chars = ['(', ')', '[', ']', '_', '*', '.', '!', '~', '`', '>', '#', '+', '-', '=', '|', '{', '}'];

for (const { text, name } of msgs) {
  console.log(`\n=== ${name} (${text.length} chars) ===`);
  let total = 0;
  for (const c of chars) {
    const n = findUnescaped(text, c, name);
    total += n;
  }
  console.log(`  TOTAL unescaped: ${total}`);
}
