/**
 * DataLoader-style Batching Utility for Database Queries
 *
 * Prevents N+1 query problems by automatically batching
 * individual entity requests into bulk queries.
 *
 * Features:
 * - Request coalescing within a single tick
 * - Configurable batch size limits
 * - Type-safe generic implementation
 * - Cache support with TTL
 * - Query deduplication
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

export interface DataLoaderOptions {
  /** Maximum batch size before forcing execution (default: 100) */
  maxBatchSize?: number;
  /** Cache TTL in milliseconds (default: 0 = no caching) */
  cacheTtlMs?: number;
  /** Whether to deduplicate keys in the same batch (default: true) */
  deduplicate?: boolean;
}

interface PendingRequest<K, V> {
  key: K;
  resolve: (value: V | null) => void;
  reject: (error: Error) => void;
}

interface CacheEntry<V> {
  value: V | null;
  expiresAt: number;
}

/**
 * Generic DataLoader for batching database queries
 *
 * @example
 * const userLoader = new DataLoader<string, User>(async (userIds) => {
 *   const users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
 *   return createResultMap(users, 'id');
 * });
 *
 * // These calls will be batched into a single query
 * const [user1, user2] = await Promise.all([
 *   userLoader.load('user-1'),
 *   userLoader.load('user-2'),
 * ]);
 */
export class DataLoader<K, V> {
  private batchFn: (keys: K[]) => Promise<Map<K, V | null>>;
  private options: Required<DataLoaderOptions>;
  private pendingQueue: PendingRequest<K, V>[] = [];
  private cache: Map<K, CacheEntry<V>> = new Map();
  private scheduled = false;

  constructor(
    batchFn: (keys: K[]) => Promise<Map<K, V | null>>,
    options: DataLoaderOptions = {}
  ) {
    this.batchFn = batchFn;
    this.options = {
      maxBatchSize: options.maxBatchSize ?? 100,
      cacheTtlMs: options.cacheTtlMs ?? 0,
      deduplicate: options.deduplicate ?? true,
    };
  }

  /**
   * Load a single entity by key
   * Requests are automatically batched within the same tick
   */
  async load(key: K): Promise<V | null> {
    // Check cache first
    if (this.options.cacheTtlMs > 0) {
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.value;
      }
    }

    return new Promise((resolve, reject) => {
      this.pendingQueue.push({ key, resolve, reject });

      // Force execution if batch is full
      if (this.pendingQueue.length >= this.options.maxBatchSize) {
        this.executeBatch();
      } else if (!this.scheduled) {
        this.scheduled = true;
        // Schedule batch execution on next tick
        queueMicrotask(() => this.executeBatch());
      }
    });
  }

  /**
   * Load multiple entities by keys
   */
  async loadMany(keys: K[]): Promise<(V | null)[]> {
    return Promise.all(keys.map((key) => this.load(key)));
  }

  /**
   * Prime the cache with a value
   */
  prime(key: K, value: V | null): void {
    if (this.options.cacheTtlMs > 0) {
      this.cache.set(key, {
        value,
        expiresAt: Date.now() + this.options.cacheTtlMs,
      });
    }
  }

  /**
   * Clear a specific key from the cache
   */
  clear(key: K): void {
    this.cache.delete(key);
  }

  /**
   * Clear all cached values
   */
  clearAll(): void {
    this.cache.clear();
  }

  private async executeBatch(): Promise<void> {
    this.scheduled = false;

    if (this.pendingQueue.length === 0) {
      return;
    }

    // Take current batch
    const batch = this.pendingQueue;
    this.pendingQueue = [];

    // Deduplicate keys if enabled
    const keySet = new Set<K>();
    const dedupedBatch: PendingRequest<K, V>[] = [];
    const duplicates: Map<K, PendingRequest<K, V>[]> = new Map();

    for (const request of batch) {
      if (this.options.deduplicate && keySet.has(request.key)) {
        // Group duplicates to resolve together
        const existing = duplicates.get(request.key) || [];
        existing.push(request);
        duplicates.set(request.key, existing);
      } else {
        keySet.add(request.key);
        dedupedBatch.push(request);
      }
    }

    const keys = dedupedBatch.map((r) => r.key);

    try {
      const results = await this.batchFn(keys);

      // Resolve all requests
      for (const request of dedupedBatch) {
        const value = results.get(request.key) ?? null;

        // Cache the result
        if (this.options.cacheTtlMs > 0) {
          this.cache.set(request.key, {
            value,
            expiresAt: Date.now() + this.options.cacheTtlMs,
          });
        }

        request.resolve(value);

        // Resolve duplicates
        const dups = duplicates.get(request.key);
        if (dups) {
          for (const dup of dups) {
            dup.resolve(value);
          }
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));

      // Reject all requests
      for (const request of dedupedBatch) {
        request.reject(err);

        // Reject duplicates
        const dups = duplicates.get(request.key);
        if (dups) {
          for (const dup of dups) {
            dup.reject(err);
          }
        }
      }
    }
  }
}

/**
 * Helper to create a result map from an array of entities
 *
 * @example
 * const users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
 * return createResultMap(users, 'id');
 */
export function createResultMap<T, K extends keyof T>(
  items: T[],
  keyField: K
): Map<T[K], T> {
  const map = new Map<T[K], T>();
  for (const item of items) {
    map.set(item[keyField], item);
  }
  return map;
}

/**
 * Helper to create a result map using a key extraction function
 *
 * @example
 * const users = await db.select().from(usersTable).where(inArray(usersTable.id, userIds));
 * return createResultMapBy(users, (user) => user.id);
 */
export function createResultMapBy<T, K>(
  items: T[],
  keyFn: (item: T) => K
): Map<K, T> {
  const map = new Map<K, T>();
  for (const item of items) {
    map.set(keyFn(item), item);
  }
  return map;
}

/**
 * Helper to group items by a key
 *
 * @example
 * const achievements = await db.select().from(achievementsTable).where(inArray(achievementsTable.gameId, gameIds));
 * return groupBy(achievements, 'gameId');
 */
export function groupBy<T, K extends keyof T>(
  items: T[],
  keyField: K
): Map<T[K], T[]> {
  const map = new Map<T[K], T[]>();
  for (const item of items) {
    const key = item[keyField];
    const existing = map.get(key) || [];
    existing.push(item);
    map.set(key, existing);
  }
  return map;
}

/**
 * Helper to group items by a key extraction function
 */
export function groupByFn<T, K>(
  items: T[],
  keyFn: (item: T) => K
): Map<K, T[]> {
  const map = new Map<K, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const existing = map.get(key) || [];
    existing.push(item);
    map.set(key, existing);
  }
  return map;
}

/**
 * BatchContext for request-scoped data loading
 *
 * Creates fresh DataLoaders for each request to ensure
 * proper isolation and cache invalidation
 *
 * @example
 * const batchCtx = new BatchContext();
 * const userLoader = batchCtx.createLoader<string, User>(async (ids) => {
 *   const users = await db.select().from(usersTable).where(inArray(usersTable.id, ids));
 *   return createResultMap(users, 'id');
 * });
 */
export class BatchContext {
  private loaders: Map<string, DataLoader<unknown, unknown>> = new Map();

  /**
   * Create or get a named data loader
   * Loaders are cached by name for reuse within the same request
   */
  getLoader<K, V>(
    name: string,
    batchFn: (keys: K[]) => Promise<Map<K, V | null>>,
    options?: DataLoaderOptions
  ): DataLoader<K, V> {
    let loader = this.loaders.get(name) as DataLoader<K, V> | undefined;
    if (!loader) {
      loader = new DataLoader<K, V>(batchFn, options);
      this.loaders.set(name, loader as DataLoader<unknown, unknown>);
    }
    return loader;
  }

  /**
   * Create a new loader (not cached by name)
   */
  createLoader<K, V>(
    batchFn: (keys: K[]) => Promise<Map<K, V | null>>,
    options?: DataLoaderOptions
  ): DataLoader<K, V> {
    return new DataLoader<K, V>(batchFn, options);
  }

  /**
   * Clear all loaders (call at end of request)
   */
  clear(): void {
    // Use Array.from for ES5 compatibility
    const loaders = Array.from(this.loaders.values());
    for (const loader of loaders) {
      loader.clearAll();
    }
    this.loaders.clear();
  }
}

/**
 * Query coalescing for multiple related queries
 *
 * Executes all queries in parallel and returns results together
 */
export async function coalesceQueries<T extends Record<string, () => Promise<unknown>>>(
  queries: T
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const entries = Object.entries(queries);
  const results = await Promise.all(
    entries.map(async ([key, queryFn]) => {
      const result = await queryFn();
      return [key, result] as const;
    })
  );

  return Object.fromEntries(results) as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}
