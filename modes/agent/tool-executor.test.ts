import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ActionTracker } from "./action-tracker.ts";
import { ToolExecutor } from "./tool-executor.ts";
import { defaultAgentConfig, type AgentConfig } from "./types.ts";

let root: string;
let tracker: ActionTracker;
let executor: ToolExecutor;

function testConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  const base = defaultAgentConfig();
  return {
    ...base,
    ...overrides,
    codebasePath: root,
    tools: {
      ...base.tools,
      ...(overrides.tools ?? {}),
    },
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tool-executor-"));
  tracker = new ActionTracker();
  executor = new ToolExecutor(tracker, testConfig());
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("ToolExecutor file safety", () => {
  test("blocks reads that escape the workspace", () => {
    expect(() => executor.readFile("../outside.txt")).toThrow(
      "Path escapes workspace",
    );
  });

  test("blocks excluded files", () => {
    fs.writeFileSync(path.join(root, ".env"), "SECRET=value", "utf8");

    expect(() => executor.readFile(".env")).toThrow(
      "read_file: path is excluded by policy: .env",
    );
  });

  test("stages file creation without writing until approval", () => {
    executor.createFile("notes/todo.txt", "hello");

    expect(fs.existsSync(path.join(root, "notes", "todo.txt"))).toBe(false);
    expect(executor.getEffectiveText("notes/todo.txt")).toBe("hello");
    expect(tracker.getPendingMutations()).toHaveLength(1);
  });

  test("applies the latest approved file operation per path", () => {
    fs.writeFileSync(path.join(root, "app.txt"), "old", "utf8");

    executor.modifyFile("app.txt", "first");
    executor.modifyFile("app.txt", "second");
    for (const action of tracker.getPendingMutations()) {
      tracker.updateStatus(action.id, "approved", true);
    }

    const result = executor.applyApprovedFromTracker();

    expect(result.errors).toEqual([]);
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("second");
  });

  test("respects disabled file creation", () => {
    executor = new ToolExecutor(
      tracker,
      testConfig({ tools: { ...defaultAgentConfig().tools, allowFileCreation: false } }),
    );

    expect(() => executor.createFile("new.txt", "content")).toThrow(
      "File creation disabled",
    );
  });
});

describe("ToolExecutor shell execution", () => {
  test("rejects empty shell commands", () => {
    expect(() => executor.queueShell("   ")).toThrow(
      "execute_shell: command is required",
    );
  });

  test("rejects blocked destructive shell commands", () => {
    expect(() => executor.queueShell("git reset --hard")).toThrow(
      "command blocked by safety policy",
    );
  });

  test("captures output for approved shell commands", () => {
    executor.queueShell('node -e "console.log(123)"');
    const [action] = tracker.getPendingMutations();
    tracker.updateStatus(action!.id, "approved", true);

    const result = executor.applyApprovedFromTracker();

    expect(result.errors).toEqual([]);
    expect(action!.details.toolResult).toBe("123");
  });
});
