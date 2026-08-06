import { Telegraf } from "telegraf";
import chalk from "chalk";
import { WELCOME } from "./constants";
import { registerHandlers } from "./handlers";
import { requireEnv } from "../../env.ts";

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "UND_ERR_SOCKET",
]);

function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const maybeCode = (error as { code?: unknown }).code;
  return typeof maybeCode === "string" ? maybeCode : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function redactTelegramToken(value: string): string {
  return value.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot<redacted>");
}

function getSafeErrorDetails(error: unknown): string {
  const code = getErrorCode(error);
  const message = redactTelegramToken(getErrorMessage(error));
  return code ? `${code}: ${message}` : message;
}

function isRetryableTelegramError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (code && RETRYABLE_NETWORK_CODES.has(code)) return true;

  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("socket connection was closed") ||
    message.includes("network") ||
    message.includes("fetch failed")
  );
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runTelegramMode() {
  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const ownerId = requireEnv("TELEGRAM_OWNER_ID");

  const bot = new Telegraf(token);
  registerHandlers(bot);

  bot.catch((error) => {
    console.error(chalk.red("Telegram handler error:"), getSafeErrorDetails(error));
  });

  try {
    await bot.telegram.sendMessage(ownerId, WELCOME, { parse_mode: "Markdown" });
  } catch (error) {
    console.error(chalk.red("Could not send Telegram welcome message:"), getSafeErrorDetails(error));
    return;
  }
  console.log(chalk.green("Sent welcome message to Telegram.\n"));

  console.log(chalk.green("Telegram bot is running. Press Ctrl+C to stop.\n"));

  let stopping = false;
  let activeBot = false;

  const launchLoop = async () => {
    while (!stopping) {
      try {
        activeBot = true;
        await bot.launch();
      } catch (error) {
        activeBot = false;
        if (stopping) return;

        const details = getSafeErrorDetails(error);

        if (!isRetryableTelegramError(error)) {
          console.error(chalk.red("Telegram bot stopped:"), details);
          stopping = true;
          return;
        }

        console.log(
          chalk.yellow(`Telegram connection interrupted (${details}). Retrying in 5s...`),
        );
        await wait(5000);
      }
    }
  };

  const running = launchLoop();

  await new Promise<void>((resolve) => {
    const stop = () => {
      stopping = true;
      if (activeBot) bot.stop("SIGINT");
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });

  await running.catch((error) => {
    if (!stopping) throw error;
  });
}
