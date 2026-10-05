import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import type { LanguageModelMiddleware } from "ai";
import { llmCache } from "./cache.ts";

type CachedStream = {
  kind: "stream";
  parts: LanguageModelV3StreamPart[];
};

function makeCachePrompt(
  operation: "generate" | "stream",
  model: LanguageModelV3,
  params: LanguageModelV3CallOptions,
): string | undefined {
  try {
    const { abortSignal: _abortSignal, ...semanticParams } = params;
    return JSON.stringify({
      operation,
      provider: model.provider,
      modelId: model.modelId,
      params: semanticParams,
    });
  } catch {
    // Some provider options can contain non-serializable values. In that case,
    // bypass caching instead of risking a cache collision.
    return undefined;
  }
}

function hasToolCall(result: LanguageModelV3GenerateResult): boolean {
  return result.content.some((part) => part.type === "tool-call");
}

function replayStream(parts: LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

/**
 * Caches completed text-only model responses used by tool-loop agents.
 * Tool calls are never cached: the SDK must execute tools against the current
 * workspace before a response can be reused.
 */
export const modelCacheMiddleware: LanguageModelMiddleware = {
  specificationVersion: "v3",

  async wrapGenerate({ doGenerate, params, model }) {
    const cachePrompt = makeCachePrompt("generate", model, params);
    if (cachePrompt) {
      const cached = llmCache.get<LanguageModelV3GenerateResult>(cachePrompt, `${model.provider}:${model.modelId}`);
      if (cached) return cached;
    }

    const result = await doGenerate();
    if (cachePrompt && !hasToolCall(result)) {
      llmCache.set(cachePrompt, `${model.provider}:${model.modelId}`, result);
    }
    return result;
  },

  async wrapStream({ doStream, params, model }) {
    const cachePrompt = makeCachePrompt("stream", model, params);
    if (cachePrompt) {
      const cached = llmCache.get<CachedStream>(cachePrompt, `${model.provider}:${model.modelId}`);
      if (cached?.kind === "stream") return { stream: replayStream(cached.parts) };
    }

    const result = await doStream();
    if (!cachePrompt) return result;

    const [clientStream, cacheStream] = result.stream.tee();
    void (async () => {
      const parts: LanguageModelV3StreamPart[] = [];
      let sawFinish = false;
      let containsToolActivity = false;
      const reader = cacheStream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          parts.push(value);
          if (value.type === "finish") sawFinish = true;
          if (value.type.startsWith("tool-")) containsToolActivity = true;
          if (value.type === "error") return;
        }
        if (sawFinish && !containsToolActivity) {
          llmCache.set(cachePrompt, `${model.provider}:${model.modelId}`, {
            kind: "stream",
            parts,
          } satisfies CachedStream);
        }
      } catch {
        // A failed or cancelled stream must not be cached.
      } finally {
        reader.releaseLock();
      }
    })();

    return { ...result, stream: clientStream };
  },
};
