/**
 * Ollama Native Tool Adapter
 *
 * Implements the Vercel AI SDK `LanguageModelV3` interface on top of Ollama's
 * *native* `/api/chat` endpoint.
 *
 * This is a **blocking** implementation: it does NOT support async tool execution
 * within the stream. For that, you need `experimental_useToolCall` or `ToolLoopAgent`
 * with a custom tool executor.
 *
 * Instead, this adapter returns tool calls in `finishReason: 'tool-calls'` so
 * `ToolLoopAgent` can detect them and execute the tools synchronously.
 */
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3FunctionTool,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3ToolCall,
  LanguageModelV3Usage,
  SharedV3Warning,
} from "@ai-sdk/provider";

const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";

type OllamaToolCall = {
  function: { name: string; arguments: Record<string, unknown> | string };
};

interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
}

interface OllamaChatRequest {
  model: string;
  messages: OllamaMessage[];
  tools?: Array<{
    type: "function";
    function: { name: string; description: string; parameters: Record<string, unknown> };
  }>;
  stream: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    num_gpu?: number;
    stop?: string[];
  };
}

interface OllamaChatResponse {
  model: string;
  message: {
    role: "assistant";
    content: string;
    tool_calls?: OllamaToolCall[];
  };
  done: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
  total_duration?: number;
}

function flattenTextParts(
  parts: Array<{ type: string; text?: string }>,
): string {
  return parts.map((p) => (p.type === "text" ? p.text ?? "" : "")).join("");
}

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const fullFence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fullFence?.[1]) return fullFence[1].trim();
  const embeddedFence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return embeddedFence?.[1]?.trim() ?? trimmed;
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stripJsonFence(value));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function toolInputToObject(input: unknown): Record<string, unknown> {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (typeof input === "string") {
    return parseJsonObject(input) ?? {};
  }
  return {};
}

function normalizeToolArguments(input: unknown): string {
  if (typeof input === "string") {
    return input.trim() === "" ? "{}" : input;
  }
  if (input && typeof input === "object") {
    return JSON.stringify(input);
  }
  return "{}";
}

const EMPTY_TOOL_ARGUMENTS: Record<string, unknown> = {};

function toOllamaToolArguments(input: unknown): Record<string, unknown> | string {
  if (typeof input === "string") return input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  return EMPTY_TOOL_ARGUMENTS;
}

function extractToolCallsFromContent(
  content: string,
): OllamaToolCall[] {
  const parsed = parseJsonObject(content);
  if (!parsed) return [];

  if (Array.isArray(parsed.tool_calls)) {
    return parsed.tool_calls
      .map((call) => {
        if (!call || typeof call !== "object") return undefined;
        const fn = (call as Record<string, unknown>).function;
        if (!fn || typeof fn !== "object") return undefined;
        const name = (fn as Record<string, unknown>).name;
        if (typeof name !== "string" || !name) return undefined;
        return {
          function: {
            name,
            arguments: toOllamaToolArguments(
              (fn as Record<string, unknown>).arguments,
            ),
          },
        };
      })
      .filter((call): call is NonNullable<typeof call> => Boolean(call));
  }

  const functionLike =
    parsed.function && typeof parsed.function === "object"
      ? (parsed.function as Record<string, unknown>)
      : parsed;
  const name = functionLike.name ?? functionLike.tool ?? functionLike.tool_name;
  if (typeof name !== "string" || !name) return [];

  return [
    {
      function: {
        name,
        arguments: toOllamaToolArguments(
          functionLike.arguments ??
          functionLike.args ??
          functionLike.input,
        ),
      },
    },
  ];
}

function getToolCalls(
  message: OllamaChatResponse["message"],
): OllamaToolCall[] {
  const nativeCalls = message.tool_calls ?? [];
  if (nativeCalls.length > 0) return nativeCalls;
  return extractToolCallsFromContent(message.content);
}

function convertPrompt(prompt: LanguageModelV3Prompt): OllamaMessage[] {
  const out: OllamaMessage[] = [];
  for (const msg of prompt) {
    if (msg.role === "system") {
      out.push({ role: "system", content: msg.content });
    } else if (msg.role === "user") {
      out.push({ role: "user", content: flattenTextParts(msg.content) });
    } else if (msg.role === "assistant") {
      const text = flattenTextParts(msg.content);
      const toolCalls = (msg.content as any[])
        .filter((p): p is { type: "tool-call" } => p.type === "tool-call")
        .map((p) => ({
          function: {
            name: (p as any).toolName,
            arguments: toolInputToObject((p as any).input),
          },
        }));
      out.push({ role: "assistant", content: text, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) });
    } else if (msg.role === "tool") {
      for (const part of msg.content) {
        if (part.type === "tool-result") {
          const output = part.output as { type: string; value: any };
          let value: string;
          if (output.type === "text") value = output.value;
          else if (output.type === "json") value = JSON.stringify(output.value);
          else if (output.type === "error-text") value = `Error: ${output.value}`;
          else if (output.type === "error-json")
            value = `Error: ${JSON.stringify(output.value)}`;
          else if (output.type === "execution-denied")
            value = `Denied: ${(output as any).reason ?? "user denied"}`;
          else value = JSON.stringify(output.value);
          out.push({ role: "tool", content: value });
        }
      }
    }
  }
  return out;
}

function convertTools(
  tools: Array<LanguageModelV3FunctionTool>,
): OllamaChatRequest["tools"] {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));
}

function makeUsage(r: OllamaChatResponse): LanguageModelV3Usage {
  return {
    inputTokens: {
      total: r.prompt_eval_count ?? undefined,
      noCache: r.prompt_eval_count ?? undefined, // Simplified: all tokens are non-cached
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: {
      total: r.eval_count ?? undefined,
      text: r.eval_count ?? undefined, // Simplified: all output tokens are text
      reasoning: undefined,
    },
    raw: {
      prompt_tokens: r.prompt_eval_count,
      completion_tokens: r.eval_count,
      total_tokens: (r.prompt_eval_count ?? 0) + (r.eval_count ?? 0),
    },
  };
}

function makeFinishReason(
  r: OllamaChatResponse,
  hadToolCalls: boolean,
): LanguageModelV3FinishReason {
  let unified: "stop" | "length" | "content-filter" | "tool-calls" | "error" | "other" =
    "stop";
  if (hadToolCalls) unified = "tool-calls";
  else if (r.done_reason === "length") unified = "length";
  else if (r.done_reason === "stop") unified = "stop";
  return { unified, raw: r.done_reason };
}

function generateToolCallId(): string {
  return `ollama_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function warnings(): SharedV3Warning[] {
  return [];
}

function isCudaInitializationError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("cuda") ||
    normalized.includes("shared object initialization failed") ||
    normalized.includes("llama-server process has terminated")
  );
}

interface OllamaToolAdapterConfig {
  baseURL: string;
  model: string;
}

/**
 * Ollama native adapter for the Vercel AI SDK.
 *
 * This adapter implements `LanguageModelV3` and uses Ollama's native
 * `/api/chat` endpoint for better tool-call support with small models.
 *
 * Key behavior:
 * - `doGenerate`: Returns a single turn with tool calls if the model decides to use tools.
 * - The finish reason is `'tool-calls'` when tools are invoked, allowing `ToolLoopAgent`
 *   to detect and execute them synchronously.
 * - `doStream`: Implemented but yields the same content as `doGenerate` (no true streaming
 *   for multi-turn tool loops).
 */
export class OllamaToolAdapter implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const;
  readonly provider = "ollama-native";
  readonly modelId: string;
  readonly defaultObjectGenerationMode = "tool";
  readonly supportsImageUrls = false;
  readonly supportedUrls: Record<string, RegExp[]> = {};
  readonly settings: Record<string, unknown> = {};

  private readonly baseURL: string;

  constructor(config: OllamaToolAdapterConfig) {
    this.modelId = config.model;
    this.baseURL = config.baseURL.replace(/\/+$/, "").replace(/\/v1$/, "");
  }

  private async callOllama(
    options: LanguageModelV3CallOptions,
  ): Promise<OllamaChatResponse> {
    const request = async (numGpu?: number): Promise<OllamaChatResponse> => {
      const body: OllamaChatRequest = {
        model: this.modelId,
        messages: convertPrompt(options.prompt),
        tools: convertTools(
          (options.tools ?? []).filter(
            (t) => t.type === "function"
          ) as LanguageModelV3FunctionTool[],
        ),
        stream: false,
        options: {
          temperature: options.temperature,
          top_p: options.topP,
          top_k: options.topK,
          num_predict: options.maxOutputTokens,
          num_gpu: numGpu,
          stop: options.stopSequences,
        },
      };

      const response = await fetch(`${this.baseURL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(
          `Ollama API error ${response.status}: ${text || response.statusText}`
        );
      }

      return response.json() as Promise<OllamaChatResponse>;
    };

    try {
      return await request();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isCudaInitializationError(message)) throw error;
      return request(0);
    }
  }

  async doGenerate(
    options: LanguageModelV3CallOptions,
  ): Promise<LanguageModelV3GenerateResult> {
    const data = await this.callOllama(options);

    const content: LanguageModelV3Content[] = [];

    const toolCalls = getToolCalls(data.message);

    if (data.message.content && toolCalls.length === 0) {
      content.push({ type: "text", text: data.message.content });
    }

    for (const call of toolCalls) {
      content.push({
        type: "tool-call",
        toolCallId: generateToolCallId(),
        toolName: call.function.name,
        input: normalizeToolArguments(call.function.arguments),
      } as LanguageModelV3ToolCall);
    }

    return {
      content,
      finishReason: makeFinishReason(data, toolCalls.length > 0),
      usage: makeUsage(data),
      warnings: warnings(),
      response: {
        id: `ollama-${Date.now()}`,
        timestamp: new Date(),
        modelId: data.model,
      },
    };
  }

  async doStream(
    options: LanguageModelV3CallOptions,
  ): Promise<{
    stream: ReadableStream<LanguageModelV3StreamPart>;
    warnings: SharedV3Warning[];
  }> {
    const data = await this.callOllama(options);

    const stream = new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        const toolCalls = getToolCalls(data.message);
        const textParts = data.message.content && toolCalls.length === 0
          ? [{ type: "text", text: data.message.content } as LanguageModelV3Content]
          : [];

        for (const part of textParts) {
          if (part.type === "text") {
            controller.enqueue({ type: "text-start", id: "ollama-1" });
            controller.enqueue({ type: "text-delta", id: "ollama-1", delta: part.text });
            controller.enqueue({ type: "text-end", id: "ollama-1" });
          }
        }

        for (const call of toolCalls) {
          const id = generateToolCallId();
          const input = normalizeToolArguments(call.function.arguments);

          controller.enqueue({
            type: "tool-input-start",
            id,
            toolName: call.function.name,
          });
          controller.enqueue({ type: "tool-input-delta", id, delta: input });
          controller.enqueue({ type: "tool-input-end", id });
          // Emit the final tool-call chunk which triggers tool execution
          // in runToolsTransformation
          controller.enqueue({
            type: "tool-call",
            toolCallId: id,
            toolName: call.function.name,
            input,
          });
        }

        controller.enqueue({
          type: "finish",
          usage: makeUsage(data),
          finishReason: makeFinishReason(data, toolCalls.length > 0),
        });

        controller.close();
      },
    });

    return { stream, warnings: warnings() };
  }
}

export function createOllamaNativeAdapter(
  baseURL: string,
  model: string,
): LanguageModelV3 {
  return new OllamaToolAdapter({ baseURL, model });
}
