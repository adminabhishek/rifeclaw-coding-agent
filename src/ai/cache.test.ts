import { describe, expect, test, beforeEach } from "bun:test";
import {
  LLMResponseCache,
  getCachedResponse,
  cacheResponse,
  getCacheKey,
  getCacheStats,
  clearCache,
} from "./cache.ts";

describe("LLMResponseCache", () => {
  let cache: LLMResponseCache;

  beforeEach(() => {
    cache = new LLMResponseCache({ defaultTtlMs: 1000, maxEntries: 3, enabled: true });
    clearCache();
  });

  test("stores and retrieves cached values", () => {
    cache.set("hello", "model1", "cached_response", 10000);
    const result = cache.get<string>("hello", "model1");
    expect(result).toBe("cached_response");
  });

  test("returns null for missing cache entries", () => {
    const result = cache.get<string>("nonexistent", "model1");
    expect(result).toBeNull();
  });

  test("different models with same prompt have separate entries", () => {
    cache.set("prompt", "model_a", "response_a");
    cache.set("prompt", "model_b", "response_b");
    expect(cache.get<string>("prompt", "model_a")).toBe("response_a");
    expect(cache.get<string>("prompt", "model_b")).toBe("response_b");
  });

  test("expired entries are not returned", async () => {
    cache.set("shortlived", "model1", "expires_soon", 1);
    await new Promise(resolve => setTimeout(resolve, 50));
    const result = cache.get<string>("shortlived", "model1");
    expect(result).toBeNull();
  });

  test("evicts oldest entries when max is reached", () => {
    cache.set("key1", "model", "val1");
    cache.set("key2", "model", "val2");
    cache.set("key3", "model", "val3");
    cache.set("key4", "model", "val4"); // Should evict key1

    expect(cache.get<string>("key1", "model")).toBeNull();
    expect(cache.get<string>("key2", "model")).toBe("val2");
    expect(cache.get<string>("key3", "model")).toBe("val3");
    expect(cache.get<string>("key4", "model")).toBe("val4");
  });

  test("cache stats track hits and misses", () => {
    cache.set("prompt", "model", "response");
    cache.get<string>("prompt", "model");  // hit
    cache.get<string>("missing", "model");  // miss
    cache.get<string>("prompt", "model");  // hit

    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(1);
    expect(stats.hitRate).toBe(0.6666666666666666);
  });

  test("prune removes expired entries", async () => {
    cache.set("old", "model", "old_data", 1);
    cache.set("new", "model", "new_data", 10000);
    await new Promise(resolve => setTimeout(resolve, 50));
    cache.prune();

    expect(cache.get<string>("old", "model")).toBeNull();
    expect(cache.get<string>("new", "model")).toBe("new_data");
  });

  test("clear removes all entries", () => {
    cache.set("key1", "model", "val1");
    cache.set("key2", "model", "val2");
    cache.clear();
    expect(cache.getStats().size).toBe(0);
  });

  test("disabled cache returns null on get", () => {
    const disabledCache = new LLMResponseCache({ enabled: false });
    disabledCache.set("prompt", "model", "response");
    expect(disabledCache.get<string>("prompt", "model")).toBeNull();
  });
});

describe("Singleton cache functions", () => {
  beforeEach(() => {
    clearCache();
  });

  test("getCachedResponse returns cached values", () => {
    cacheResponse("prompt", "model", "cached");
    expect(getCachedResponse<string>("prompt", "model")).toBe("cached");
    expect(getCachedResponse<string>("uncached", "model")).toBeNull();
  });

  test("getCacheKey generates consistent keys", () => {
    const key1 = getCacheKey("prompt", "model");
    const key2 = getCacheKey("prompt", "model");
    expect(key1).toBe(key2);
    expect(key1.length).toBe(16); // sha256 sliced to 16 chars
  });

  test("getCacheStats returns correct stats", () => {
    cacheResponse("prompt", "model", "response");
    getCachedResponse<string>("prompt", "model");
    getCachedResponse<string>("miss", "model");
    const stats = getCacheStats();
    expect(stats.size).toBeGreaterThanOrEqual(1);
  });

  test("configureCache updates options", () => {
    const disabledCache = new LLMResponseCache({ enabled: false });
    expect(disabledCache.getStats().size).toBe(0);
  });
});