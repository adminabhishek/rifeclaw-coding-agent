function collectErrorText(error: unknown, seen = new Set<unknown>(), depth = 0): string {
  if (depth > 5 || error == null || seen.has(error)) return "";
  if (typeof error === "string") return error;
  if (typeof error !== "object") return String(error);
  if (Array.isArray(error)) {
    seen.add(error);
    return error.map((item) => collectErrorText(item, seen, depth + 1)).join(" ");
  }
  seen.add(error);

  const value = error as Record<string, unknown>;
  const parts = [value.message, value.responseBody, value.code, value.statusCode, value.status, value.reason]
    .filter((part) => typeof part === "string" || typeof part === "number")
    .map(String);
  for (const key of ["cause", "errors", "data", "error"]) {
    if (value[key] !== undefined) parts.push(collectErrorText(value[key], seen, depth + 1));
  }
  return parts.join(" ");
}

/** Return actionable, non-sensitive guidance for common AI provider errors. */
export function providerErrorMessage(error: unknown): string {
  const details = collectErrorText(error).toLowerCase();
  if (details.includes("free-models-per-day") || details.includes("openrouter_free_tier_daily")) {
    return "OpenRouter's daily free-model quota is exhausted. Wait for the daily reset, or switch to a model/provider with available quota.";
  }
  if (details.includes("429") || details.includes("rate limit") || details.includes("rate_limit")) {
    return "The AI provider rate limit was reached. Wait a moment and try again. If this continues, check your OpenRouter quota or switch models.";
  }
  if (details.includes("network") || details.includes("fetch failed") || details.includes("econn")) {
    return "Could not reach the AI provider. Check your network or provider status, then try again.";
  }
  if (details.includes("api key") || details.includes("unauthorized") || details.includes("401")) {
    return "The AI provider rejected its API credentials. Check the provider API key in your configuration.";
  }
  return "The AI request failed. Check the provider configuration or logs, then try again.";
}
