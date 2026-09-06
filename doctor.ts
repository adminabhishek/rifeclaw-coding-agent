import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { getProjectPath } from "./project.ts";

function readEnvFile(root: string): Map<string, string> {
  const envPath = path.join(root, ".env");
  const values = new Map<string, string>();
  if (!fs.existsSync(envPath)) return values;

  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!match) continue;
    const [, key, value] = match;
    if (!key || value === undefined) continue;
    values.set(key, value);
  }

  return values;
}

function hasEnv(name: string, values: Map<string, string>): boolean {
  return Boolean(process.env[name]?.trim() || values.get(name)?.trim());
}

function envValue(name: string, values: Map<string, string>): string {
  return process.env[name]?.trim() || values.get(name)?.trim() || "";
}

function status(ok: boolean, label: string, help?: string): void {
  const mark = ok ? chalk.green("OK") : chalk.yellow("--");
  console.log(`${mark} ${label}`);
  if (!ok && help) console.log(chalk.dim(`   ${help}`));
}

export function runDoctor(projectPath = getProjectPath()): void {
  console.log(chalk.bold("\nRifeClaw doctor\n"));
  console.log(chalk.dim(`Project: ${projectPath}\n`));

  // Runtime detection — works under Bun, Node, and any other JS runtime.
  const bunVersion = (globalThis as { Bun?: { version: string } }).Bun?.version;
  if (bunVersion) {
    status(true, `Bun ${bunVersion}`);
  } else {
    const nodeVersion = process.versions.node;
    status(true, `Node.js ${nodeVersion}`);
  }

  const envExists = fs.existsSync(path.join(projectPath, ".env"));
  const envValues = readEnvFile(projectPath);
  status(envExists, ".env file found", "Run `rifeclaw setup` to create one.");

  const aiProvider = (envValue("AI_PROVIDER", envValues) || "openrouter").toLowerCase();
  const usesOllama = aiProvider === "ollama";
  const usesOpenRouter = aiProvider === "openrouter";

  status(
    usesOpenRouter || usesOllama,
    `AI provider configured (${aiProvider})`,
    "Add AI_PROVIDER=openrouter or AI_PROVIDER=ollama to .env.",
  );

  if (usesOllama) {
    status(
      hasEnv("OLLAMA_MODEL", envValues),
      "Ollama model configured",
      "Run `rifeclaw setup` to choose an Ollama model for this machine.",
    );
    status(
      true,
      `Ollama base URL: ${envValue("OLLAMA_BASE_URL", envValues) || "http://localhost:11434/v1"}`,
    );
  } else {
    status(
      hasEnv("OPENROUTER_API_KEY", envValues),
      "OpenRouter API key configured",
      "Add OPENROUTER_API_KEY to .env.",
    );
    status(
      hasEnv("OPENROUTER_DEFAULT_MODEL", envValues),
      "Default OpenRouter model configured",
      "Add OPENROUTER_DEFAULT_MODEL=openai/gpt-4.1 to .env.",
    );
  }

  status(
    hasEnv("FIRECRAWL_API_KEY", envValues),
    "Firecrawl web tools configured",
    "Optional. Add FIRECRAWL_API_KEY only if you want web search/crawl tools.",
  );

  const hasTelegramToken = hasEnv("TELEGRAM_BOT_TOKEN", envValues);
  const hasTelegramOwner = hasEnv("TELEGRAM_OWNER_ID", envValues);
  status(
    hasTelegramToken && hasTelegramOwner,
    "Telegram mode configured",
    "Optional. Add TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID to use Telegram mode.",
  );

  const readyForCli =
    (usesOpenRouter &&
      hasEnv("OPENROUTER_API_KEY", envValues) &&
      hasEnv("OPENROUTER_DEFAULT_MODEL", envValues)) ||
    (usesOllama &&
      hasEnv("OLLAMA_MODEL", envValues));
  console.log();
  if (readyForCli) {
    console.log(chalk.green("Ready for CLI Ask, Agent, and Plan modes."));
  } else {
    console.log(chalk.yellow("Not ready yet. Run `rifeclaw setup`."));
  }
}
