import { describe, expect, test } from "bun:test";
import { approvalDiff, approvalSummary } from "./approval-session.ts";
import type { ActionLog } from "../agent/types.ts";

function action(partial: Partial<ActionLog>): ActionLog {
  return {
    id: partial.id ?? "a",
    timestamp: partial.timestamp ?? new Date(),
    type: partial.type ?? "file_modify",
    path: partial.path ?? "app.ts",
    details: partial.details ?? {},
    status: partial.status ?? "pending",
    userApproved: partial.userApproved,
  };
}

describe("approvalSummary", () => {
  test("summarizes pending file and shell actions", () => {
    const summary = approvalSummary([
      action({ type: "file_modify", path: "app.ts" }),
      action({
        type: "tool_execute",
        path: "shell",
        details: { command: "bun test" },
      }),
    ]);

    expect(summary).toContain("app.ts");
    expect(summary).toContain("Shell: bun test");
    expect(summary).toContain("Total: 2 change(s)");
  });
});

describe("approvalDiff", () => {
  test("includes file diffs and shell commands", () => {
    const diff = approvalDiff([
      action({
        type: "file_modify",
        path: "app.ts",
        details: { before: "old\n", after: "new\n" },
      }),
      action({
        type: "tool_execute",
        path: "shell",
        details: { command: "bun test" },
      }),
    ]);

    expect(diff).toContain("-old");
    expect(diff).toContain("+new");
    expect(diff).toContain("Shell: bun test");
  });
});
