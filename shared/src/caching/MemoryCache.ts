/**
 * In-Memory LRU Cache Implementation
 *
 * High-performance in-memory cache with LRU eviction, TTL support,
 * and automatic cleanup of expired entries.
 *
 * This is a low-level cache implementation used internally by CacheService.
 */
import { createHash } from 'crypto';

import {
  DEFAULT_CACHE_CONFIG,
  type CacheConfig,
  type CacheEntry,
  type CacheStats,
  type CacheResult,
  type CacheSetOptions,
  type InvalidationPattern,
  type CacheHealth,
} from './types.js';

/**
 * Doubly-linked list node for O(1) LRU eviction
 */
interface LRUNode {
  key: string;
  prev: LRUNode | null;
  next: LRUNode | null;
}

export class MemoryCache {
  private cache: Map<string, CacheEntry> = new Map();
  private tags: Map<string, Set<string>> = new Map(); // tag -> keys
  private pendingFactories: Map<string, Promise<unknown>> = new Map(); // For request coalescing
  private config: CacheConfig;
  private stats: CacheStats;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  private lastCleanup: Date | null = null;
  private accessTimings: number[] = [];
  private errors: string[] = [];

  // Doubly-linked list for O(1) LRU eviction
  private lruHead: LRUNode | null = null; // Most recently used
  private lruTail: LRUNode | null = null; // Least recently used
  private lruNodes: Map<string, LRUNode> = new Map(); // key -> node for O(1) lookup

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
    this.stats = this.createEmptyStats();
  }

  private createEmptyStats(): CacheStats {
    return {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      invalidations: 0,
      entryCount: 0,
      sizeBytes: 0,
      hitRate: 0,
      avgAccessTimeMs: 0,
    };
  }

  async initialize(): Promise<void> {
    // Start periodic cleanup
    if (this.config.cleanupIntervalMs > 0) {
      this.cleanupTimer = setInterval(() => {
        this.cleanup().catch(err => {
          this.errors.push(`Cleanup error: ${err.message}`);
          if (this.errors.length > 10) {
            this.errors.shift();
          }
        });
      }, this.config.cleanupIntervalMs);
      // Allow process to exit even if timer is running
      this.cleanupTimer.unref();
    }
  }

  async dispose(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    await this.clear();
  }

  async get<T>(key: string): Promise<CacheResult<T>> {
    return this.getSync<T>(key);
  }

  getSync<T>(key: string): CacheResult<T> {
    const startTime = performance.now();
    const entry = this.cache.get(key);
    const accessTimeMs = performance.now() - startTime;

    this.trackAccessTime(accessTimeMs);

    if (!entry) {
      if (this.config.enableStats) {
        this.stats.misses++;
        this.updateHitRate();
      }
      return { value: undefined, hit: false, expired: false, accessTimeMs };
    }

    const now = Date.now();
    const expired = now > entry.expiresAt;

    if (expired) {
      // Remove expired entry
      this.cache.delete(key);
      this.removeFromTags(key);
      if (this.config.enableStats) {
        this.stats.misses++;
        this.stats.entryCount--;
        this.stats.sizeBytes -= entry.sizeBytes;
        this.updateHitRate();
      }
      return { value: undefined, hit: false, expired: true, accessTimeMs };
    }

    // Update access metadata (LRU tracking)
    entry.lastAccessedAt = now;
    entry.accessCount++;

    // Move to head of LRU list (most recently used)
    this.moveToHead(key);

    if (this.config.enableStats) {
      this.stats.hits++;
      this.updateHitRate();
    }

    return { value: entry.value as T, hit: true, expired: false, accessTimeMs };
  }

  async set<T>(key: string, value: T, options?: CacheSetOptions): Promise<void> {
    this.setSync(key, value, options);
  }

  setSync<T>(key: string, value: T, options?: CacheSetOptions): void {
    const ttlMs = options?.ttlMs ?? this.config.defaultTtlMs;
    const now = Date.now();

    // Calculate size
    const sizeBytes = options?.skipSizeCalculation ? 0 : this.calculateSize(value);

    // Check if we need to evict entries
    this.ensureCapacity(sizeBytes);

    // Remove existing entry if present
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      this.stats.sizeBytes -= existingEntry.sizeBytes;
      this.removeFromTags(key);
      this.removeFromLRU(key);
    }

    // Create new entry
    const entry: CacheEntry<T> = {
      value,
      createdAt: now,
      expiresAt: now + ttlMs,
      lastAccessedAt: now,
      accessCount: 0,
      sizeBytes,
    };

    this.cache.set(key, entry);

    // Add to head of LRU list (most recently used)
    this.addToHead(key);

    // Track tags
    if (options?.tags) {
      for (const tag of options.tags) {
        if (!this.tags.has(tag)) {
          this.tags.set(tag, new Set());
        }
        this.tags.get(tag)!.add(key);
      }
    }

    if (this.config.enableStats) {
      this.stats.sets++;
      this.stats.entryCount = this.cache.size;
      this.stats.sizeBytes += sizeBytes;
    }
  }

  async delete(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    this.cache.delete(key);
    this.removeFromTags(key);
    this.removeFromLRU(key);

    if (this.config.enableStats) {
      this.stats.deletes++;
      this.stats.entryCount = this.cache.size;
      this.stats.sizeBytes -= entry.sizeBytes;
    }

    return true;
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) {
      return false;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      await this.delete(key);
      return false;
    }

    return true;
  }

  async clear(): Promise<void> {
    this.cache.clear();
    this.tags.clear();
    this.lruHead = null;
    this.lruTail = null;
    this.lruNodes.clear();
    this.stats = this.createEmptyStats();
  }

  async invalidate(pattern: InvalidationPattern): Promise<number> {
    let count = 0;

    if (pattern.key) {
      if (await this.delete(pattern.key)) {
        count++;
      }
    }

    if (pattern.prefix) {
      count += await this.invalidatePrefix(pattern.prefix);
    }

    if (pattern.tags && pattern.tags.length > 0) {
      count += await this.invalidateTags(pattern.tags);
    }

    if (this.config.enableStats) {
      this.stats.invalidations += count;
    }

    return count;
  }

  async invalidatePrefix(prefix: string): Promise<number> {
    let count = 0;
    const keysToDelete: string[] = [];

    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        keysToDelete.push(key);
      }
    }

    for (const key of keysToDelete) {
      if (await this.delete(key)) {
        count++;
      }
    }

    if (this.config.enableStats) {
      this.stats.invalidations += count;
    }

    return count;
  }

  async invalidateTags(tags: string[]): Promise<number> {
    const keysToDelete = new Set<string>();

    for (const tag of tags) {
      const taggedKeys = this.tags.get(tag);
      if (taggedKeys) {
        for (const key of taggedKeys) {
          keysToDelete.add(key);
        }
      }
    }

    let count = 0;
    for (const key of keysToDelete) {
      if (await this.delete(key)) {
        count++;
      }
    }

    if (this.config.enableStats) {
      this.stats.invalidations += count;
    }

    return count;
  }

  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    options?: CacheSetOptions
  ): Promise<T> {
    // Check cache first
    const result = await this.get<T>(key);
    if (result.hit) {
      return result.value as T;
    }

    // Check if there's already a pending factory for this key (request coalescing)
    const pending = this.pendingFactories.get(key);
    if (pending) {
      // Wait for the existing factory to complete
      return pending as Promise<T>;
    }

    // Execute factory with request coalescing to prevent stampeding herd
    const factoryPromise = (async () => {
      try {
        const value = await factory();
        await this.set(key, value, options);
        return value;
      } finally {
        // Clean up pending factory regardless of success/failure
        this.pendingFactories.delete(key);
      }
    })();

    // Track the pending factory
    this.pendingFactories.set(key, factoryPromise);

    return factoryPromise;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }

  getHealth(): CacheHealth {
    const healthy = this.errors.length === 0 &&
      this.stats.entryCount < this.config.maxEntries &&
      this.stats.sizeBytes < this.config.maxSizeBytes;

    return {
      healthy,
      entryCount: this.stats.entryCount,
      sizeBytes: this.stats.sizeBytes,
      hitRate: this.stats.hitRate,
      lastCleanup: this.lastCleanup,
      errors: [...this.errors],
    };
  }

  getConfig(): CacheConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<CacheConfig>): void {
    this.config = { ...this.config, ...config };

    // Restart cleanup timer if interval changed
    if (config.cleanupIntervalMs !== undefined && this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      if (config.cleanupIntervalMs > 0) {
        this.cleanupTimer = setInterval(() => {
          this.cleanup().catch(err => {
            this.errors.push(`Cleanup error: ${err.message}`);
          });
        }, this.config.cleanupIntervalMs);
        // Allow process to exit even if timer is running
        this.cleanupTimer.unref();
      }
    }
  }

  async cleanup(): Promise<number> {
    const now = Date.now();
    let removed = 0;

    // Remove expired entries
    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
        this.removeFromTags(key);
        removed++;
        if (this.config.enableStats) {
          this.stats.sizeBytes -= entry.sizeBytes;
        }
      }
    }

    if (this.config.enableStats) {
      this.stats.entryCount = this.cache.size;
      this.stats.evictions += removed;
    }

    this.lastCleanup = new Date();
    return removed;
  }

  async warmup(entries: Array<{ key: string; value: unknown; options?: CacheSetOptions }>): Promise<void> {
    for (const entry of entries) {
      await this.set(entry.key, entry.value, entry.options);
    }
  }

  generateKey(...components: (string | number | boolean | undefined | null)[]): string {
    const keyData = components
      .map(c => {
        if (c === null || c === undefined) return '';
        return String(c);
      })
      .join(':');
    return createHash('sha256').update(keyData).digest('hex').substring(0, 32);
  }

  scopedKey(prefix: string, ...components: (string | number | boolean | undefined | null)[]): string {
    const suffix = components
      .map(c => {
        if (c === null || c === undefined) return '';
        return String(c);
      })
      .filter(c => c.length > 0)
      .join(':');
    return suffix ? `${prefix}:${suffix}` : prefix;
  }

  // Private helper methods

  private calculateSize(value: unknown, seen = new WeakSet<object>()): number {
    // Handle primitives
    if (value === null || value === undefined) {
      return 8;
    }
    if (typeof value === 'string') {
      return value.length * 2;
    }
    if (typeof value === 'number') {
      return 8;
    }
    if (typeof value === 'boolean') {
      return 4;
    }

    // Handle objects with circular reference detection
    if (typeof value === 'object') {
      // Check for circular references
      if (seen.has(value)) {
        return 0; // Already counted this object
      }
      seen.add(value);

      if (Array.isArray(value)) {
        let size = 40; // Array overhead
        for (const item of value) {
          size += this.calculateSize(item, seen);
        }
        return size;
      }

      // Regular object
      let size = 40; // Object overhead
      for (const key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          size += key.length * 2; // Key size
          size += this.calculateSize((value as Record<string, unknown>)[key], seen);
        }
      }
      return size;
    }

    return 100; // Default for unknown types (functions, symbols, etc.)
  }

  private ensureCapacity(newEntrySize: number): void {
    // Check entry count limit
    while (this.cache.size >= this.config.maxEntries) {
      this.evictLRU();
    }

    // Check size limit
    while (this.stats.sizeBytes + newEntrySize > this.config.maxSizeBytes && this.cache.size > 0) {
      this.evictLRU();
    }
  }

  /**
   * O(1) LRU eviction - removes the tail (least recently used) entry
   */
  private evictLRU(): void {
    if (!this.lruTail) {
      return;
    }

    const lruKey = this.lruTail.key;
    const entry = this.cache.get(lruKey);

    if (entry) {
      this.cache.delete(lruKey);
      this.removeFromTags(lruKey);
      this.removeFromLRU(lruKey);

      if (this.config.enableStats) {
        this.stats.evictions++;
        this.stats.entryCount = this.cache.size;
        this.stats.sizeBytes -= entry.sizeBytes;
      }
    }
  }

  /**
   * Add a key to the head of the LRU list (most recently used)
   */
  private addToHead(key: string): void {
    const node: LRUNode = { key, prev: null, next: this.lruHead };

    if (this.lruHead) {
      this.lruHead.prev = node;
    }
    this.lruHead = node;

    if (!this.lruTail) {
      this.lruTail = node;
    }

    this.lruNodes.set(key, node);
  }

  /**
   * Move an existing key to the head of the LRU list
   */
  private moveToHead(key: string): void {
    const node = this.lruNodes.get(key);
    if (!node || node === this.lruHead) {
      return;
    }

    // Remove from current position
    if (node.prev) {
      node.prev.next = node.next;
    }
    if (node.next) {
      node.next.prev = node.prev;
    }
    if (node === this.lruTail) {
      this.lruTail = node.prev;
    }

    // Add to head
    node.prev = null;
    node.next = this.lruHead;
    if (this.lruHead) {
      this.lruHead.prev = node;
    }
    this.lruHead = node;
  }

  /**
   * Remove a key from the LRU list
   */
  private removeFromLRU(key: string): void {
    const node = this.lruNodes.get(key);
    if (!node) {
      return;
    }

    if (node.prev) {
      node.prev.next = node.next;
    } else {
      this.lruHead = node.next;
    }

    if (node.next) {
      node.next.prev = node.prev;
    } else {
      this.lruTail = node.prev;
    }

    this.lruNodes.delete(key);
  }

  private removeFromTags(key: string): void {
    const emptyTags: string[] = [];
    for (const [tag, taggedKeys] of this.tags.entries()) {
      taggedKeys.delete(key);
      // Track empty tag sets for cleanup
      if (taggedKeys.size === 0) {
        emptyTags.push(tag);
      }
    }
    // Clean up empty tag sets to prevent memory leaks
    for (const tag of emptyTags) {
      this.tags.delete(tag);
    }
  }

  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? this.stats.hits / total : 0;
  }

  private trackAccessTime(timeMs: number): void {
    this.accessTimings.push(timeMs);
    // Keep only last 100 timings
    if (this.accessTimings.length > 100) {
      this.accessTimings.shift();
    }
    // Update average
    const sum = this.accessTimings.reduce((a, b) => a + b, 0);
    this.stats.avgAccessTimeMs = sum / this.accessTimings.length;
  }
}
