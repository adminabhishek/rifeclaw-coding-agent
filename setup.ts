import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { confirm, isCancel, text } from "@clack/prompts";
import { getProjectPath } from "./project.ts";

const ENV_FILE = ".env";

const KNOWN_KEYS = [
  "OPENROUTER_API_KEY",
  "OPENROUTER_DEFAULT_MODEL",
  "FIRECRAWL_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_OWNER_ID",
] as const;

type KnownKey = (typeof KNOWN_KEYS)[number];

function readEnvFile(cwd = process.cwd()): Map<string, string> {
  const envPath = path.join(cwd, ENV_FILE);
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

function envValue(values: Map<string, string>, key: KnownKey): string {
  return process.env[key]?.trim() || values.get(key)?.trim() || "";
}

function required(value: string | undefined): string | undefined {
  return value?.trim() ? undefined : "Required";
}

async function promptSecret(
  values: Map<string, string>,
  key: KnownKey,
  message: string,
): Promise<string | undefined> {
  const existing = envValue(values, key);
  if (existing) {
    const keep = await confirm({
      message: `${key} already exists. Keep it?`,
      initialValue: true,
    });
    if (isCancel(keep)) return undefined;
    if (keep) return existing;
  }

  const value = await text({
    message,
    validate: required,
  });
  if (isCancel(value)) return undefined;
  return value.trim();
}

async function promptOptionalSecret(
  values: Map<string, string>,
  key: KnownKey,
  message: string,
): Promise<string | undefined> {
  const existing = envValue(values, key);
  if (existing) {
    const keep = await confirm({
      message: `${key} already exists. Keep it?`,
      initialValue: true,
    });
    if (isCancel(keep)) return undefined;
    if (keep) return existing;
  }

  const value = await text({ message });
  if (isCancel(value)) return undefined;
  return value.trim();
}

function envLines(values: Map<string, string>): string {
  const lines = [
    "# Required AI settings",
    `OPENROUTER_API_KEY=${values.get("OPENROUTER_API_KEY") ?? ""}`,
    `OPENROUTER_DEFAULT_MODEL=${values.get("OPENROUTER_DEFAULT_MODEL") ?? "openai/gpt-4.1"}`,
    "",
    "# Optional web tools",
    `FIRECRAWL_API_KEY=${values.get("FIRECRAWL_API_KEY") ?? ""}`,
    "",
    "# Optional Telegram mode",
    `TELEGRAM_BOT_TOKEN=${values.get("TELEGRAM_BOT_TOKEN") ?? ""}`,
    `TELEGRAM_OWNER_ID=${values.get("TELEGRAM_OWNER_ID") ?? ""}`,
    "",
  ];

  return lines.join("\n");
}

export async function runSetup(projectPath = getProjectPath()): Promise<void> {
  console.log(chalk.bold("\nRifeClaw setup\n"));
  console.log(chalk.dim(`Project: ${projectPath}\n`));

  const values = readEnvFile(projectPath);
  const openRouterKey = await promptSecret(
    values,
    "OPENROUTER_API_KEY",
    "OpenRouter API key",
  );
  if (openRouterKey === undefined) return;
  values.set("OPENROUTER_API_KEY", openRouterKey);

  const model = await text({
    message: "Default model",
    initialValue: envValue(values, "OPENROUTER_DEFAULT_MODEL") || "openai/gpt-4.1",
    validate: required,
  });
  if (isCancel(model)) return;
  values.set("OPENROUTER_DEFAULT_MODEL", model.trim());

  const enableWeb = await confirm({
    message: "Enable Firecrawl web tools?",
    initialValue: Boolean(envValue(values, "FIRECRAWL_API_KEY")),
  });
  if (isCancel(enableWeb)) return;
  if (enableWeb) {
    const firecrawlKey = await promptOptionalSecret(
      values,
      "FIRECRAWL_API_KEY",
      "Firecrawl API key",
    );
    if (firecrawlKey === undefined) return;
    values.set("FIRECRAWL_API_KEY", firecrawlKey);
  } else {
    values.set("FIRECRAWL_API_KEY", "");
  }

  const enableTelegram = await confirm({
    message: "Enable Telegram mode?",
    initialValue:
      Boolean(envValue(values, "TELEGRAM_BOT_TOKEN")) ||
      Boolean(envValue(values, "TELEGRAM_OWNER_ID")),
  });
  if (isCancel(enableTelegram)) return;
  if (enableTelegram) {
    const telegramToken = await promptSecret(
      values,
      "TELEGRAM_BOT_TOKEN",
      "Telegram bot token from BotFather",
    );
    if (telegramToken === undefined) return;
    values.set("TELEGRAM_BOT_TOKEN", telegramToken);

    const ownerId = await text({
      message: "Telegram owner numeric chat ID",
      initialValue: envValue(values, "TELEGRAM_OWNER_ID"),
      validate: required,
    });
    if (isCancel(ownerId)) return;
    values.set("TELEGRAM_OWNER_ID", ownerId.trim());
  } else {
    values.set("TELEGRAM_BOT_TOKEN", "");
    values.set("TELEGRAM_OWNER_ID", "");
  }

  fs.writeFileSync(path.join(projectPath, ENV_FILE), envLines(values), "utf8");
  console.log(chalk.green("\nSetup complete. Wrote .env\n"));
  console.log(chalk.dim("Run `rifeclaw doctor` to verify your configuration."));
}
