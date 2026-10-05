import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ActionTracker } from "../agent/action-tracker.ts";
import { createWebTools, getUsageStats, hasWebTools } from "./web-tools";

describe("web-tools", () => {
  let tracker: ActionTracker;

  beforeEach(() => {
    tracker = new ActionTracker();
    // Reset usage stats before each test
    // We'll do this by accessing the module and resetting - but since we can't easily do that,
    // we'll just note that tests should run in isolation
  });

  afterEach(() => {
    // Clean up is handled by creating fresh instances
  });

  test("hasWebTools returns true when API key is set", () => {
    // Ensure API key is set for this test
    process.env.FIRECRAWL_API_KEY = "test-key";
    expect(hasWebTools()).toBe(true);
  });

  test("hasWebTools returns false when API key is not set", () => {
    // Temporarily remove the API key
    const originalKey = process.env.FIRECRAWL_API_KEY;
    delete process.env.FIRECRAWL_API_KEY;
    expect(hasWebTools()).toBe(false);
    // Restore it
    if (originalKey !== undefined) {
      process.env.FIRECRAWL_API_KEY = originalKey;
    }
  });

  test("createWebTools returns expected tool definitions", () => {
    process.env.FIRECRAWL_API_KEY = "test-key";
    const tools = createWebTools(tracker);

    expect(tools).toHaveProperty("web_search");
    expect(tools).toHaveProperty("web_crawl");
    expect(tools).toHaveProperty("fetch_url");

    expect(typeof tools.web_search).toBe("object");
    expect(typeof tools.web_crawl).toBe("object");
    expect(typeof tools.fetch_url).toBe("object");
  });

  test("getUsageStats returns correct structure", () => {
    const stats = getUsageStats();
    expect(stats).toHaveProperty("searchCount");
    expect(stats).toHaveProperty("crawlCount");
    expect(stats).toHaveProperty("lastReset");

    expect(typeof stats.searchCount).toBe("number");
    expect(typeof stats.crawlCount).toBe("number");
    expect(typeof stats.lastReset).toBe("number");
  });

  test("usage tracking starts at zero", () => {
    const stats = getUsageStats();
    expect(stats.searchCount).toBe(0);
    expect(stats.crawlCount).toBe(0);
  });
});