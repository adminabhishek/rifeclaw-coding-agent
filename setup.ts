import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import chalk from "chalk";
import { autocomplete, confirm, isCancel, text } from "@clack/prompts";
import { getProjectPath } from "./project.ts";

const ENV_FILE = ".env";

const KNOWN_KEYS = [
  "AI_PROVIDER",
  "OPENROUTER_API_KEY",
  "OPENROUTER_DEFAULT_MODEL",
  "OPENROUTER_REASONING_ENABLED",
  "OPENROUTER_REASONING_EFFORT",
  "OLLAMA_MODEL",
  "OLLAMA_BASE_URL",
  "FIRECRAWL_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_OWNER_ID",
] as const;

type KnownKey = (typeof KNOWN_KEYS)[number];

type OllamaModel = {
  id: string;
  label: string;
  minRamGb: number;
  note: string;
};

const CUSTOM_OLLAMA_MODEL = "__custom_ollama_model__";

const OLLAMA_MODELS: OllamaModel[] = [
  {
    id: "qwen2.5-coder:1.5b",
    label: "Qwen2.5 Coder 1.5B",
    minRamGb: 4,
    note: "fastest coding option for low-memory machines",
  },
  {
    id: "llama3.2:1b",
    label: "Llama 3.2 1B",
    minRamGb: 4,
    note: "very lightweight general assistant",
  },
  {
    id: "qwen2.5:3b",
    label: "Qwen2.5 3B",
    minRamGb: 6,
    note: "balanced small model",
  },
  {
    id: "llama3.2:3b",
    label: "Llama 3.2 3B",
    minRamGb: 6,
    note: "good small general model",
  },
  {
    id: "phi3.5:3.8b",
    label: "Phi 3.5 3.8B",
    minRamGb: 8,
    note: "compact reasoning model",
  },
  {
    id: "qwen2.5-coder:7b",
    label: "Qwen2.5 Coder 7B",
    minRamGb: 12,
    note: "recommended for local coding work",
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    minRamGb: 12,
    note: "strong general-purpose local model",
  },
  {
    id: "mistral:7b",
    label: "Mistral 7B",
    minRamGb: 12,
    note: "fast general-purpose model",
  },
  {
    id: "gemma2:9b",
    label: "Gemma 2 9B",
    minRamGb: 16,
    note: "larger general-purpose model",
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Qwen2.5 Coder 14B",
    minRamGb: 24,
    note: "better coding quality if you have the memory",
  },
  {
    id: "qwen2.5-coder:32b",
    label: "Qwen2.5 Coder 32B",
    minRamGb: 48,
    note: "high-quality local coding model for beefy machines",
  },
];

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

function systemRamGb(): number {
  return Math.round((os.totalmem() / 1024 ** 3) * 10) / 10;
}

function recommendedOllamaModel(ramGb: number): OllamaModel {
  return (
    [...OLLAMA_MODELS]
      .filter((model) => model.minRamGb <= ramGb)
      .sort((a, b) => b.minRamGb - a.minRamGb)[0] ?? OLLAMA_MODELS[0]!
  );
}

function installedOllamaModels(): string[] {
  try {
    const output = execFileSync("ollama", ["list"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((model): model is string => Boolean(model));
  } catch {
    return [];
  }
}

function pullOllamaModel(model: string): boolean {
  const result = spawnSync("ollama", ["pull", model], { stdio: "inherit" });
  return result.status === 0;
}

async function promptOllamaModel(
  values: Map<string, string>,
): Promise<string | undefined> {
  const ramGb = systemRamGb();
  const recommendation = recommendedOllamaModel(ramGb);
  const installed = installedOllamaModels();
  const existing = envValue(values, "OLLAMA_MODEL");
  const optionIds = new Set<string>();
  const options = [
    ...installed.map((id) => {
      optionIds.add(id);
      const known = OLLAMA_MODELS.find((model) => model.id === id);
      return {
        value: id,
        label: known?.label ?? id,
        hint:
          id === recommendation.id
            ? `installed, **recommended** for ${ramGb} GB RAM`
            : "installed",
      };
    }),
    ...OLLAMA_MODELS.filter((model) => !optionIds.has(model.id)).map(
      (model) => ({
        value: model.id,
        label: model.label,
        hint:
          model.id === recommendation.id
            ? `**recommended** for ${ramGb} GB RAM; ${model.note}`
            : `${model.minRamGb}+ GB RAM; ${model.note}`,
      }),
    ),
    {
      value: CUSTOM_OLLAMA_MODEL,
      label: "Enter another Ollama model",
      hint: "use any model name or tag from Ollama",
    },
  ];

  const selected = await autocomplete({
    message: `Ollama model (detected about ${ramGb} GB RAM) - **recommended: ${recommendation.label}**`,
    placeholder: "Search installed, recommended, or common models...",
    initialValue: existing || installed[0] || recommendation.id,
    options,
    maxItems: 10,
  });
  if (isCancel(selected)) return undefined;

  if (selected === CUSTOM_OLLAMA_MODEL) {
    const customModel = await text({
      message: "Ollama model name",
      initialValue: existing || recommendation.id,
      validate: required,
    });
    if (isCancel(customModel)) return undefined;
    return customModel.trim();
  }

  return selected;
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
    "# AI provider: openrouter or ollama",
    `AI_PROVIDER=${values.get("AI_PROVIDER") ?? "openrouter"}`,
    "",
    "# OpenRouter settings",
    `OPENROUTER_API_KEY=${values.get("OPENROUTER_API_KEY") ?? ""}`,
    `OPENROUTER_DEFAULT_MODEL=${values.get("OPENROUTER_DEFAULT_MODEL") ?? "openai/gpt-4.1"}`,
    "",
    "# OpenRouter reasoning settings",
    `OPENROUTER_REASONING_ENABLED=${values.get("OPENROUTER_REASONING_ENABLED") ?? "true"}`,
    `OPENROUTER_REASONING_EFFORT=${values.get("OPENROUTER_REASONING_EFFORT") ?? "medium"}`,
    "",
    "# Ollama local settings",
    `OLLAMA_MODEL=${values.get("OLLAMA_MODEL") ?? "qwen2.5-coder:7b"}`,
    `OLLAMA_BASE_URL=${values.get("OLLAMA_BASE_URL") ?? "http://localhost:11434/v1"}`,
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

  const useOllama = await confirm({
    message: "Use Ollama local model instead of OpenRouter?",
    initialValue: envValue(values, "AI_PROVIDER") === "ollama",
  });
  if (isCancel(useOllama)) return;

  if (useOllama) {
    values.set("AI_PROVIDER", "ollama");

    const ollamaModel = await promptOllamaModel(values);
    if (ollamaModel === undefined) return;
    values.set("OLLAMA_MODEL", ollamaModel);

    if (!installedOllamaModels().includes(ollamaModel)) {
      const installModel = await confirm({
        message: `Pull ${ollamaModel} with Ollama now?`,
        initialValue: true,
      });
      if (isCancel(installModel)) return;
      if (installModel && !pullOllamaModel(ollamaModel)) {
        console.log(chalk.yellow(`\nCould not pull ${ollamaModel}.`));
        console.log(chalk.dim(`You can install it later with: ollama pull ${ollamaModel}\n`));
      }
    }

    const ollamaBaseUrl = await text({
      message: "Ollama OpenAI-compatible base URL",
      initialValue:
        envValue(values, "OLLAMA_BASE_URL") || "http://localhost:11434/v1",
      validate: required,
    });
    if (isCancel(ollamaBaseUrl)) return;
    values.set("OLLAMA_BASE_URL", ollamaBaseUrl.trim());
  } else {
    values.set("AI_PROVIDER", "openrouter");

    const openRouterKey = await promptSecret(
      values,
      "OPENROUTER_API_KEY",
      "OpenRouter API key",
    );
    if (openRouterKey === undefined) return;
    values.set("OPENROUTER_API_KEY", openRouterKey);

    const model = await text({
      message: "Default model",
      initialValue:
        envValue(values, "OPENROUTER_DEFAULT_MODEL") || "openai/gpt-4.1",
      validate: required,
    });
    if (isCancel(model)) return;
    values.set("OPENROUTER_DEFAULT_MODEL", model.trim());

    const enableReasoning = await confirm({
      message: "Enable model reasoning when supported?",
      initialValue: envValue(values, "OPENROUTER_REASONING_ENABLED").toLowerCase() !== "false",
    });
    if (isCancel(enableReasoning)) return;
    values.set("OPENROUTER_REASONING_ENABLED", String(enableReasoning));

    if (enableReasoning) {
      const effortOptions = ["minimal", "low", "medium", "high", "xhigh"];
      const currentEffort = envValue(values, "OPENROUTER_REASONING_EFFORT").toLowerCase();
      const effort = await autocomplete({
        message: "Reasoning effort",
        initialValue: effortOptions.includes(currentEffort) ? currentEffort : "medium",
        options: effortOptions.map((value) => ({ value, label: value })),
      });
      if (isCancel(effort)) return;
      values.set("OPENROUTER_REASONING_EFFORT", effort);
    }
  }

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
