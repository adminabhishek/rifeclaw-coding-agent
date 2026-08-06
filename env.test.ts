import { afterEach, describe, expect, test } from "bun:test";
import { requireEnv } from "./env.ts";

const ORIGINAL_VALUE = process.env.CHAICODECLAW_TEST_ENV;

afterEach(() => {
  if (ORIGINAL_VALUE === undefined) {
    delete process.env.CHAICODECLAW_TEST_ENV;
  } else {
    process.env.CHAICODECLAW_TEST_ENV = ORIGINAL_VALUE;
  }
});

describe("requireEnv", () => {
  test("returns a trimmed environment variable", () => {
    process.env.CHAICODECLAW_TEST_ENV = "  present  ";

    expect(requireEnv("CHAICODECLAW_TEST_ENV")).toBe("present");
  });

  test("throws a helpful error when the value is missing", () => {
    delete process.env.CHAICODECLAW_TEST_ENV;

    expect(() => requireEnv("CHAICODECLAW_TEST_ENV")).toThrow(
      "Missing required environment variable: CHAICODECLAW_TEST_ENV",
    );
  });
});
