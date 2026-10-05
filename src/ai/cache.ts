/**
 * LLM Response Cache Strategy
 *
 * Caches LLM responses for repeated queries on a stable codebase.
 * Reduces latency and API usage when the same or similar prompts
 * are sent to the model.
 */

import { createHash } from "node:crypto";

export interface CacheEntry<T = unknown> {
  value: T;
  timestamp: number;
  ttlMs: number;
  promptHash: string;
  modelId: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  size: number;
  hitRate: number;
}

interface CacheOptions {
  /** Time-to-live in milliseconds (default: 5 minutes) */
  defaultTtlMs?: number;
  /** Maximum number of entries in cache (default: 100) */
  maxEntries?: number;
  /** Enable/disable caching (default: true) */
  enabled?: boolean;
}

const DEFAULT_OPTIONS: Required<CacheOptions> = {
  defaultTtlMs: 5 * 60 * 1000, // 5 minutes
  maxEntries: 100,
  enabled: true,
};

/** Simple in-memory cache with TTL support */
export class LLMResponseCache {
  private cache = new Map<string, CacheEntry>();
  private options: Required<CacheOptions>;
  private stats = { hits: 0, misses: 0 };

  constructor(options: CacheOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Generate a cache key from prompt, model, and context
   */
  private generateKey(prompt: string, modelId: string): string {
    const content = `${modelId}:${prompt}`;
    return createHash("sha256").update(content).digest("hex").slice(0, 16);
  }

  /**
   * Get a cached value if it exists and is not expired
   */
  get<T>(prompt: string, modelId: string): T | null {
    if (!this.options.enabled) return null;

    const key = this.generateKey(prompt, modelId);
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check TTL expiration
    const age = Date.now() - entry.timestamp;
    if (age > entry.ttlMs) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }

    this.stats.hits++;
    return entry.value as T;
  }

  /**
   * Store a value in the cache
   */
  set<T>(prompt: string, modelId: string, value: T, ttlMs?: number): void {
    if (!this.options.enabled) return;

    // Evict oldest entries if at capacity
    if (this.cache.size >= this.options.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    const key = this.generateKey(prompt, modelId);
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttlMs: ttlMs ?? this.options.defaultTtlMs,
      promptHash: key,
      modelId,
    });
  }

  /**
   * Clear all entries from the cache
   */
  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  /**
   * Remove expired entries from the cache
   */
  prune(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      hits: this.stats.hits,
      misses: this.stats.misses,
      size: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Update cache options
   */
  configure(options: Partial<CacheOptions>): void {
    this.options = { ...this.options, ...options };
  }
}

// Singleton instance for the application
export const llmCache = new LLMResponseCache();

/**
 * Check if a cached response is available
 */
export function getCachedResponse<T>(prompt: string, modelId: string): T | null {
  return llmCache.get<T>(prompt, modelId);
}

/**
 * Store a response in the cache
 */
export function cacheResponse<T>(
  prompt: string,
  modelId: string,
  value: T,
  ttlMs?: number
): void {
  llmCache.set(prompt, modelId, value, ttlMs);
}

/**
 * Generate a cache key for a given prompt and model
 */
export function getCacheKey(prompt: string, modelId: string): string {
  const content = `${modelId}:${prompt}`;
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Get cache statistics
 */
export function getCacheStats(): CacheStats {
  return llmCache.getStats();
}

/**
 * Clear the entire cache
 */
export function clearCache(): void {
  llmCache.clear();
}

/**
 * Remove expired entries from the cache
 */
export function pruneCache(): void {
  llmCache.prune();
}

/**
 * Configure the cache behavior
 */
export function configureCache(options: Partial<CacheOptions>): void {
  llmCache.configure(options);
}