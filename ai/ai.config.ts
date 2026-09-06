import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, type LanguageModel, type GenerateTextResult } from "ai";
import { optionalEnv } from "../env";
import { memoryManager } from "../src/ai/memory";
import { createOllamaNativeAdapter } from "./ollama-tool-adapter";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

export interface StructuredOutput<T> {
  data: T;
  confidence?: number;
  timestamp: string;
}

// Helper to get the language model with memory context
export function getAgentModel(): LanguageModel {
  const aiProvider = (optionalEnv("AI_PROVIDER") ?? "openrouter").toLowerCase();

  if (aiProvider === "ollama") {
    const ollamaModel = optionalEnv("OLLAMA_MODEL");
    if (!ollamaModel) {
      throw new Error("OLLAMA_MODEL not configured. Please run 'rifeclaw setup' or set it in .env");
    }

    // Use Ollama's native /api/chat endpoint with native tool-calling format.
    // Small local models follow this schema more reliably than the
    // OpenAI-compatible /v1/chat/completions bridge used for OpenRouter.
    return createOllamaNativeAdapter(
      optionalEnv("OLLAMA_BASE_URL") ?? DEFAULT_OLLAMA_BASE_URL,
      ollamaModel,
    );
  }

  if (aiProvider !== "openrouter") {
    throw new Error(
      `Unsupported AI_PROVIDER: ${aiProvider}. Use "openrouter" or "ollama".`,
    );
  }

  const apiKey = optionalEnv("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY not configured. Please run 'rifeclaw setup' or set it in .env");
  }

  const provider = createOpenRouter({ apiKey });
  const modelId = optionalEnv("OPENROUTER_DEFAULT_MODEL");

  if (!modelId) {
    throw new Error("OPENROUTER_DEFAULT_MODEL not configured. Please run 'rifeclaw setup' or set it in .env");
  }

  return provider.chat(modelId);
}

// Generate with memory context
export async function generateWithMemory(
  prompt: string,
  sessionId: string,
  options?: {
    system?: string;
    maxTokens?: number;
    temperature?: number;
  }
): Promise<GenerateTextResult<never, never>> {
  // Add memory context to prompt
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

// Structured output formatter
export function formatStructuredOutput<T>(
  data: T,
  confidence = 1.0
): StructuredOutput<T> {
  return {
    data,
    confidence,
    timestamp: new Date().toISOString()
  };
}