import { afterEach, describe, expect, test } from "bun:test";
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { createOllamaNativeAdapter } from "./ollama-tool-adapter.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function callOptions(
  prompt: LanguageModelV3CallOptions["prompt"],
): LanguageModelV3CallOptions {
  return {
    prompt,
    tools: [],
  } as unknown as LanguageModelV3CallOptions;
}

describe("OllamaToolAdapter", () => {
  test("turns JSON tool-call content into an SDK tool call instead of text", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "qwen2.5-coder:7b",
          message: {
            role: "assistant",
            content: '{"name":"analyze_codebase","arguments":{}}',
          },
          done: true,
          done_reason: "stop",
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const model = createOllamaNativeAdapter("http://localhost:11434", "qwen2.5-coder:7b");
    const result = await model.doGenerate(
      callOptions([{ role: "user", content: [{ type: "text", text: "show files" }] }]),
    );

    expect(result.content).toEqual([
      {
        type: "tool-call",
        toolCallId: expect.any(String),
        toolName: "analyze_codebase",
        input: "{}",
      },
    ]);
    expect(result.finishReason.unified).toBe("tool-calls");
  });

  test("turns fenced JSON tool-call content into an SDK tool call", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "qwen2.5-coder:7b",
          message: {
            role: "assistant",
            content: 'Calling a tool:\n```json\n{"name":"analyze_codebase","arguments":{}}\n```',
          },
          done: true,
          done_reason: "stop",
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const model = createOllamaNativeAdapter("http://localhost:11434", "qwen2.5-coder:7b");
    const result = await model.doGenerate(
      callOptions([{ role: "user", content: [{ type: "text", text: "show files" }] }]),
    );

    expect(result.content).toEqual([
      {
        type: "tool-call",
        toolCallId: expect.any(String),
        toolName: "analyze_codebase",
        input: "{}",
      },
    ]);
    expect(result.warnings).toEqual([]);
  });

  test("normalizes native Ollama string arguments", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          model: "qwen2.5-coder:7b",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                function: {
                  name: "list_files",
                  arguments: '{"path":".","recursive":true}',
                },
              },
            ],
          },
          done: true,
          done_reason: "stop",
        }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const model = createOllamaNativeAdapter("http://localhost:11434", "qwen2.5-coder:7b");
    const result = await model.doGenerate(
      callOptions([{ role: "user", content: [{ type: "text", text: "show files" }] }]),
    );

    expect(result.content[0]).toMatchObject({
      type: "tool-call",
      toolName: "list_files",
      input: '{"path":".","recursive":true}',
    });
  });

  test("sends prior assistant tool-call inputs back to Ollama as objects", async () => {
    let requestBody: unknown;
    globalThis.fetch = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      requestBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          model: "qwen2.5-coder:7b",
          message: { role: "assistant", content: "done" },
          done: true,
          done_reason: "stop",
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const model = createOllamaNativeAdapter("http://localhost:11434", "qwen2.5-coder:7b");
    await model.doGenerate(
      callOptions([
        {
          role: "assistant",
          content: [
            {
              type: "tool-call",
              toolCallId: "call-1",
              toolName: "list_files",
              input: '{"path":".","recursive":true}',
            },
          ],
        },
      ]),
    );

    expect(requestBody).toMatchObject({
      messages: [
        {
          role: "assistant",
          tool_calls: [
            {
              function: {
                name: "list_files",
                arguments: { path: ".", recursive: true },
              },
            },
          ],
        },
      ],
    });
  });
});
