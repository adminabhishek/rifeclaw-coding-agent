import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, wrapLanguageModel, type LanguageModel, type GenerateTextResult } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { optionalEnv } from "../env";
import { memoryManager } from "../src/ai/memory";
import { createOllamaNativeAdapter } from "./ollama-tool-adapter";
import { modelCacheMiddleware } from "../src/ai/model-cache-middleware.ts";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

function withModelCache(model: LanguageModel): LanguageModel {
  return wrapLanguageModel({
    model: model as LanguageModelV3,
    middleware: modelCacheMiddleware,
  });
}

export interface StructuredOutput<T> {
  data: T;
  confidence?: number;
  timestamp: string;
}

export function getAgentModel(): LanguageModel {
  const aiProvider = (optionalEnv("AI_PROVIDER") ?? "openrouter").toLowerCase();

  if (aiProvider === "ollama") {
    const ollamaModel = optionalEnv("OLLAMA_MODEL");
    if (!ollamaModel) {
      throw new Error("OLLAMA_MODEL not configured. Please run 'rifeclaw setup' or set it in .env");
    }

    return withModelCache(createOllamaNativeAdapter(
      optionalEnv("OLLAMA_BASE_URL") ?? DEFAULT_OLLAMA_BASE_URL,
      ollamaModel,
    ));
  }

  if (aiProvider !== "openrouter") {
    throw new Error(`Unsupported AI_PROVIDER: ${aiProvider}. Use "openrouter" or "ollama".`);
  }

  const apiKey = optionalEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured. Please run 'rifeclaw setup' or set it in .env");
  }

  const modelId = optionalEnv("OPENROUTER_DEFAULT_MODEL");
  if (!modelId) {
    throw new Error("OPENROUTER_DEFAULT_MODEL not configured. Please run 'rifeclaw setup' or set it in .env");
  }

  const configuredEffort = (optionalEnv("OPENROUTER_REASONING_EFFORT") ?? "medium").toLowerCase();
  const allowedEfforts = ["xhigh", "high", "medium", "low", "minimal", "none"] as const;
  if (!allowedEfforts.includes(configuredEffort as (typeof allowedEfforts)[number])) {
    throw new Error(
      `Invalid OPENROUTER_REASONING_EFFORT: ${configuredEffort}. Use ${allowedEfforts.join(", ")}.`,
    );
  }

  const reasoningEffort = configuredEffort as (typeof allowedEfforts)[number];
  const reasoningEnabled = optionalEnv("OPENROUTER_REASONING_ENABLED")?.toLowerCase() !== "false";
  const modelSettings = reasoningEnabled && reasoningEffort !== "none"
    ? { reasoning: { enabled: true, effort: reasoningEffort } }
    : {};

  return withModelCache(
    createOpenRouter({ apiKey }).chat(modelId, modelSettings)
  );
}

export async function generateWithMemory(
  prompt: string,
  sessionId: string,
  options?: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<GenerateTextResult<any, any>> {
  const conversationContext = memoryManager.getRecentContext(sessionId);
  const memoryPrompt = conversationContext
    ? `Previous conversation:\n${conversationContext}\n\nCurrent question:\n${prompt}`
    : prompt;

  return generateText({
    model: getAgentModel(),
    prompt: memoryPrompt,
    system: options?.system,
    maxOutputTokens: options?.maxTokens,
    temperature: options?.temperature ?? 0.7,
  });
}

export function formatStructuredOutput<T>(data: T, confidence = 1.0): StructuredOutput<T> {
  return {
    data,
    confidence,
    timestamp: new Date().toISOString(),
  };
}
