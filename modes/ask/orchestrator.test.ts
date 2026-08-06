import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defaultAskFilename, validateAskFilename } from "./orchestrator.ts";

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ask-mode-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("defaultAskFilename", () => {
  test("creates a markdown filename with a filesystem-safe timestamp", () => {
    const filename = defaultAskFilename(new Date("2026-08-03T10:11:12.000Z"));

    expect(filename).toBe("ask-2026-08-03T10-11-12Z.md");
  });
});

describe("validateAskFilename", () => {
  test("accepts a new markdown filename", () => {
    expect(validateAskFilename("answer.md", root)).toBeUndefined();
  });

  test("rejects empty values", () => {
    expect(validateAskFilename(" ", root)).toBe("Required");
  });

  test("rejects paths", () => {
    expect(validateAskFilename("../answer.md", root)).toBe("No paths");
    expect(validateAskFilename("notes/answer.md", root)).toBe("No paths");
  });

  test("rejects non-markdown files", () => {
    expect(validateAskFilename("answer.txt", root)).toBe("Must end with .md");
  });

  test("rejects existing files", () => {
    fs.writeFileSync(path.join(root, "answer.md"), "existing", "utf8");

    expect(validateAskFilename("answer.md", root)).toBe("File already exists");
  });
});
