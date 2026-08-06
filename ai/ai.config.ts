import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { requireEnv } from "../env.ts";

export function getAgentModel() {
  const provider = createOpenRouter({ apiKey: requireEnv("OPENROUTER_API_KEY") });

  const modelId = requireEnv("OPENROUTER_DEFAULT_MODEL");

  return provider(modelId);
}
