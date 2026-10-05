import chalk from "chalk";
import {
  RifeClawError,
  ErrorCode,
  ErrorHandler,
  type ConfigurationError,
} from "./src/errors/error-system.ts";

/**
 * Missing environment variable error - extends RifeClawError for consistency
 * and provides structured context for programmatic handling.
 */
export class MissingEnvError extends RifeClawError {
  constructor(readonly variableName: string) {
    const message = `Missing required environment variable: ${variableName}`;
    super(message, ErrorCode.MISSING_ENV_VAR, {
      context: { variableName },
      recoverable: false,
      suggestions: [
        `Run \`rifeclaw setup\` in this project`,
        `Add ${variableName} to your .env file`,
      ],
    });
    this.name = "MissingEnvError";
  }
}

export function isMissingEnvError(error: unknown): error is MissingEnvError {
  return error instanceof MissingEnvError;
}

/**
 * Print structured help for missing environment variables
 */
export function printMissingEnvHelp(error: MissingEnvError): void {
  const suggestionMap: Record<string, string[]> = {
    TELEGRAM_: ["Add TELEGRAM_BOT_TOKEN and TELEGRAM_OWNER_ID to .env"],
    OLLAMA_: ["Add AI_PROVIDER=ollama and OLLAMA_MODEL to .env"],
    OPENROUTER_: [
      "Add OPENROUTER_API_KEY and OPENROUTER_DEFAULT_MODEL to .env",
      "Or use ollama for local model use",
    ],
    FIRECRAWL_: ["Add FIRECRAWL_API_KEY to .env"],
    AI_PROVIDER_: ["Add AI_PROVIDER=openrouter or AI_PROVIDER=ollama to .env"],
  };

  const suggestions = suggestionMap[error.variableName] ?? [];

  console.error(chalk.red(`\nMissing required environment variable: ${error.variableName}`));
  console.error(chalk.dim("Run `rifeclaw setup` in this project, or add it to your .env file."));

  if (suggestions.length > 0) {
    console.error(chalk.dim("Suggestions:"));
    for (const s of suggestions) {
      console.error(chalk.dim(`  • ${s}`));
    }
  }

  console.error();
}

/**
 * Require an environment variable - throws MissingEnvError if not set
 */
export function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new MissingEnvError(name);
  }
  return value;
}

/**
 * Optional environment variable - returns undefined if not set
 */
export function optionalEnv(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

/**
 * Safely get an env var with a default and optional validation
 */
export function getEnv(
  name: string,
  options: { default?: string; validate?: (value: string) => boolean; errorMessage?: string } = {}
): string | undefined {
  const value = optionalEnv(name);

  if (value === undefined) {
    return options.default;
  }

  if (options.validate && !options.validate(value)) {
    const error = new RifeClawError(
      options.errorMessage ?? `Invalid value for ${name}`,
      ErrorCode.INVALID_ENV_VALUE,
      { context: { name, value } }
    );
    return options.default;
  }

  return value;
}

/**
 * Safely get an integer env var with fallback
 */
export function getEnvInt(name: string, fallback: number): number {
  const value = optionalEnv(name);
  if (value === undefined) return fallback;
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

/**
 * Safely get a boolean env var with fallback
 */
export function getEnvBool(name: string, fallback: boolean): boolean {
  const value = optionalEnv(name);
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true";
}