import { describe, expect, test } from "bun:test";
import { composeBeforeAfter, formatPatch } from "./diff-view.ts";
import type { ActionLog } from "./types.ts";

function action(partial: Partial<ActionLog>): ActionLog {
  return {
    id: partial.id ?? "a",
    timestamp: partial.timestamp ?? new Date(),
    type: partial.type ?? "file_modify",
    path: partial.path ?? "file.txt",
    details: partial.details ?? {},
    status: partial.status ?? "pending",
    userApproved: partial.userApproved,
  };
}

describe("composeBeforeAfter", () => {
  test("uses an empty before value for file creation", () => {
    const result = composeBeforeAfter([
      action({ type: "file_create", details: { after: "hello" } }),
    ]);

    expect(result).toEqual({ before: "", after: "hello" });
  });

  test("uses the delete action before value when the last action deletes", () => {
    const result = composeBeforeAfter([
      action({ type: "file_modify", details: { before: "old", after: "new" } }),
      action({ type: "file_delete", details: { before: "new" } }),
    ]);

    expect(result).toEqual({ before: "new", after: "" });
  });
});

describe("formatPatch", () => {
  test("includes the target path and changed content", () => {
    const patch = formatPatch("file.txt", "old\n", "new\n");

    expect(patch).toContain("file.txt");
    expect(patch).toContain("-old");
    expect(patch).toContain("+new");
  });
});
