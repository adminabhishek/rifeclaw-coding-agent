import { providerErrorMessage } from "../../src/ai/provider-error.ts";

/** Convert provider/SDK errors into a concise, actionable Telegram response. */
export function telegramProviderError(error: unknown): string {
  return `${providerErrorMessage(error)} No code changes were applied.`;
}
