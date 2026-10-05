import { describe, expect, test } from "bun:test";
import { clip, commandArg, isSimpleGreeting } from "./text.ts";

describe("commandArg", () => {
  test("extracts text after a slash command", () => {
    expect(commandArg("/ask how does this work?", "ask")).toBe(
      "how does this work?",
    );
  });

  test("handles commands without arguments", () => {
    expect(commandArg("/plan", "plan")).toBe("");
  });

  test("matches command names case-insensitively", () => {
    expect(commandArg("/Agent fix tests", "agent")).toBe("fix tests");
  });
});

describe("isSimpleGreeting", () => {
  test("recognizes short greetings without matching real requests", () => {
    expect(isSimpleGreeting("hii")).toBe(true);
    expect(isSimpleGreeting("Good morning!")).toBe(true);
    expect(isSimpleGreeting("what is the weather today?")).toBe(false);
  });
});

describe("clip", () => {
  test("returns short text unchanged", () => {
    expect(clip("hello", 10)).toBe("hello");
  });

  test("truncates long text", () => {
    expect(clip("hello world", 5)).toBe("hello\n…[truncated]");
  });
});
