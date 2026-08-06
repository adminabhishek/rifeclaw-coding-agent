import chalk from "chalk";

export class MissingEnvError extends Error {
  constructor(readonly variableName: string) {
    super(`Missing required environment variable: ${variableName}`);
    this.name = "MissingEnvError";
  }
}

export function isMissingEnvError(error: unknown): error is MissingEnvError {
  return error instanceof MissingEnvError;
}

export function printMissingEnvHelp(error: MissingEnvError): void {
  console.error(chalk.red(`\nMissing required environment variable: ${error.variableName}`));
  console.error(chalk.dim("Run `rifeclaw setup` in this project, or add it to your .env file."));

  if (error.variableName.startsWith("TELEGRAM_")) {
    console.error(chalk.dim("Telegram mode needs TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID."));
  } else if (error.variableName.startsWith("OPENROUTER_")) {
    console.error(chalk.dim("CLI Ask, Agent, and Plan modes need OPENROUTER_API_KEY and OPENROUTER_DEFAULT_MODEL."));
  }

  console.error();
}

export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MissingEnvError(name);
  }
  return value;
}
