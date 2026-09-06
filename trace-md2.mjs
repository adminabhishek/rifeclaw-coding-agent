// Inline the md2 function so we can trace it
function md2(text) {
  const codeSpans = [];
  let result = text.replace(/`[^`\n]+`/g, (m) => {
    codeSpans.push(m);
    return "\x00" + (codeSpans.length - 1) + "\x00";
  });
  console.log("  after protect:", JSON.stringify(result));
  console.log("  codeSpans stored:", codeSpans);
  result = result.replace(/[_*[\]()~`>#+\-=|{}.!]/g, (c) => "\\" + c);
  console.log("  after escape:", JSON.stringify(result));
  result = result.replace(/\x00(\d+)\x00/g, (_, i) => {
    const span = codeSpans[Number(i)] ?? "";
    return span.replace(/[().]/g, (c) => "\\" + c);
  });
  console.log("  after restore:", JSON.stringify(result));
  return result;
}

const text = "Configurable in your `.env` (OpenRouter or local Ollama).";
console.log("Input:", text);
console.log("Output:", md2(text));
