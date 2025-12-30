/**
 * Typed Storage
 * Type-safe localStorage wrapper with Zod schema validation,
 * automatic versioning, and migration support.
 *
 * ## Limitations
 *
 * 1. **Cache Invalidation**: The in-memory cache is not invalidated when
 *    localStorage is modified externally (e.g., from another tab or directly
 *    via localStorage API). Use `clearCache()` to force a reload from storage.
 *
 * 2. **Singleton Instances**: Multiple storage instances for the same key will
 *    have independent caches. Use shared instances from `storageInstances.ts`
 *    for commonly accessed keys to ensure cache consistency.
 */

import type { ZodType } from 'zod';

export interface TypedStorageOptions<T> {
  key: string;
  schema: ZodType<T>;
  defaultValue: T;
  version?: number;
  migrate?: (oldData: unknown, oldVersion: number) => T;
}

export class TypedStorage<T> {
  private readonly key: string;
  private readonly schema: ZodType<T>;
  private readonly defaultValue: T;
  private readonly version: number;
  private readonly migrate?: (oldData: unknown, oldVersion: number) => T;
  private cache: T | null = null;

  constructor(options: TypedStorageOptions<T>) {
    this.key = options.key;
    this.schema = options.schema;
    this.defaultValue = options.defaultValue;
    this.version = options.version ?? 1;
    this.migrate = options.migrate;
  }

  /**
   * Get the stored value, validated against the schema.
   * Returns the default value if parsing fails or data is missing.
   * Note: This method does NOT auto-upgrade storage format. Call upgrade()
   * explicitly if you need to persist version upgrades.
   */
  get(): T {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) {
        this.cache = this.defaultValue;
        return this.defaultValue;
      }

      const parsed = JSON.parse(raw);
      const { value } = this.handleVersionedData(parsed);
      this.cache = value;
      return value;
    } catch (error) {
      console.warn(`TypedStorage: Failed to load ${this.key}:`, error);
      this.cache = this.defaultValue;
      return this.defaultValue;
    }
  }

  /**
   * Set a new value, which is validated against the schema before storing.
   * @returns true if the value was saved successfully, false otherwise
   */
  set(value: T): boolean {
    try {
      // Validate before storing
      const validated = this.schema.parse(value);

      const wrapped = {
        version: this.version,
        data: validated,
      };

      localStorage.setItem(this.key, JSON.stringify(wrapped));
      this.cache = validated;
      return true;
    } catch (error) {
      console.error(`TypedStorage: Failed to save ${this.key}:`, error);
      return false;
    }
  }

  /**
   * Update the stored value using a partial update or updater function.
   */
  update(updater: Partial<T> | ((current: T) => Partial<T>)): void {
    const current = this.get();
    const updates = typeof updater === 'function' ? updater(current) : updater;
    this.set({ ...current, ...updates });
  }

  /**
   * Remove the stored value.
   */
  remove(): void {
    try {
      localStorage.removeItem(this.key);
      this.cache = null;
    } catch (error) {
      console.error(`TypedStorage: Failed to remove ${this.key}:`, error);
    }
  }

  /**
   * Reset to default value.
   */
  reset(): void {
    this.set(this.defaultValue);
  }

  /**
   * Clear the in-memory cache, forcing a reload from storage on next get().
   */
  clearCache(): void {
    this.cache = null;
  }

  /**
   * Handle versioned data with migration support.
   * Note: This method does NOT write back to storage. Use set() explicitly
   * if you need to persist upgraded/migrated data.
   */
  private handleVersionedData(parsed: unknown): { value: T; needsUpgrade: boolean } {
    // Check if data is in versioned format
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'version' in parsed &&
      'data' in parsed
    ) {
      const versioned = parsed as { version: number; data: unknown };

      // If version matches, validate and return
      if (versioned.version === this.version) {
        const result = this.schema.safeParse(versioned.data);
        if (result.success) {
          return { value: result.data, needsUpgrade: false };
        }
        // Schema validation failed, try to merge with defaults
        const merged = this.mergeWithDefaults(versioned.data);
        return { value: merged, needsUpgrade: merged !== this.defaultValue };
      }

      // Version mismatch - try migration
      if (this.migrate && versioned.version < this.version) {
        try {
          const migrated = this.migrate(versioned.data, versioned.version);
          return { value: migrated, needsUpgrade: true };
        } catch (error) {
          console.warn(`TypedStorage: Migration failed for ${this.key}:`, error);
        }
      }

      // Try to merge old data with defaults
      const merged = this.mergeWithDefaults(versioned.data);
      return { value: merged, needsUpgrade: merged !== this.defaultValue };
    }

    // Legacy unversioned data - try to parse directly
    const result = this.schema.safeParse(parsed);
    if (result.success) {
      return { value: result.data, needsUpgrade: true };
    }

    // Try to merge with defaults
    const merged = this.mergeWithDefaults(parsed);
    return { value: merged, needsUpgrade: merged !== this.defaultValue };
  }

  /**
   * Merge unknown data with defaults, preserving valid fields.
   * Note: This method does NOT write back to storage.
   */
  private mergeWithDefaults(data: unknown): T {
    if (typeof data !== 'object' || data === null) {
      return this.defaultValue;
    }

    // Shallow merge with defaults
    const merged = { ...this.defaultValue, ...data };
    const result = this.schema.safeParse(merged);

    if (result.success) {
      return result.data;
    }

    // Complete parse failure - return defaults and clean up corrupt data
    try {
      localStorage.removeItem(this.key);
    } catch {
      // Ignore removal errors
    }
    return this.defaultValue;
  }
}

/**
 * Create a typed storage instance for a simple value (not an object).
 */
export function createTypedStorage<T>(
  options: TypedStorageOptions<T>
): TypedStorage<T> {
  return new TypedStorage(options);
}

/**
 * Simple storage helper for primitive values (string, number, boolean).
 * Less overhead than full TypedStorage for simple use cases.
 */
export class SimpleStorage<T extends string | number | boolean> {
  private readonly key: string;
  private readonly defaultValue: T;
  private readonly validator?: (value: unknown) => value is T;
  private cache: T | null = null;

  constructor(
    key: string,
    defaultValue: T,
    validator?: (value: unknown) => value is T
  ) {
    this.key = key;
    this.defaultValue = defaultValue;
    this.validator = validator;
  }

  get(): T {
    if (this.cache !== null) {
      return this.cache;
    }

    try {
      const raw = localStorage.getItem(this.key);
      if (raw === null) {
        this.cache = this.defaultValue;
        return this.defaultValue;
      }

      let value: unknown;
      if (typeof this.defaultValue === 'boolean') {
        value = raw === 'true';
      } else if (typeof this.defaultValue === 'number') {
        value = Number(raw);
        if (isNaN(value as number)) {
          value = this.defaultValue;
        }
      } else {
        value = raw;
      }

      if (this.validator && !this.validator(value)) {
        this.cache = this.defaultValue;
        return this.defaultValue;
      }

      this.cache = value as T;
      return this.cache;
    } catch {
      this.cache = this.defaultValue;
      return this.defaultValue;
    }
  }

  set(value: T): void {
    try {
      localStorage.setItem(this.key, String(value));
      this.cache = value;
    } catch (error) {
      console.error(`SimpleStorage: Failed to save ${this.key}:`, error);
    }
  }

  remove(): void {
    try {
      localStorage.removeItem(this.key);
      this.cache = null;
    } catch (error) {
      console.error(`SimpleStorage: Failed to remove ${this.key}:`, error);
    }
  }

  clearCache(): void {
    this.cache = null;
  }
}

export interface ArrayStorageOptions<T> {
  maxItems?: number;
  itemValidator?: (item: unknown) => item is T;
  /**
   * Custom equality function for duplicate detection in push().
   * Defaults to reference equality (===).
   * @example
   * compareFn: (a, b) => a.id === b.id // For objects with id property
   */
  compareFn?: (a: T, b: T) => boolean;
}

/**
 * Storage helper for arrays with validation.
 */
export class ArrayStorage<T> {
  private readonly key: string;
  private readonly defaultValue: T[];
  private readonly maxItems: number;
  private readonly itemValidator?: (item: unknown) => item is T;
  private readonly compareFn: (a: T, b: T) => boolean;
  private cache: T[] | null = null;

  constructor(
    key: string,
    defaultValue: T[] = [],
    options: ArrayStorageOptions<T> = {}
  ) {
    this.key = key;
    this.defaultValue = defaultValue;
    this.maxItems = options.maxItems ?? Infinity;
    this.itemValidator = options.itemValidator;
    this.compareFn = options.compareFn ?? ((a, b) => a === b);
  }

  /**
   * Get the stored array.
   * @returns A shallow copy of the array to prevent external mutation.
   */
  get(): T[] {
    if (this.cache !== null) {
      return [...this.cache];
    }

    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) {
        this.cache = [...this.defaultValue];
        return [...this.cache];
      }

      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.cache = [...this.defaultValue];
        return [...this.cache];
      }

      // Filter valid items if validator provided
      const items = this.itemValidator
        ? parsed.filter(this.itemValidator)
        : parsed;

      this.cache = items.slice(0, this.maxItems) as T[];
      return [...this.cache];
    } catch {
      this.cache = [...this.defaultValue];
      return [...this.cache];
    }
  }

  set(value: T[]): void {
    try {
      const trimmed = value.slice(0, this.maxItems);
      localStorage.setItem(this.key, JSON.stringify(trimmed));
      this.cache = trimmed;
    } catch (error) {
      console.error(`ArrayStorage: Failed to save ${this.key}:`, error);
    }
  }

  /**
   * Add item to front of array, removing duplicates.
   * Uses the compareFn from constructor options for duplicate detection
   * (defaults to reference equality ===).
   */
  push(item: T): void {
    const current = this.get();
    // Remove existing if present using compareFn, add to front
    const filtered = current.filter(i => !this.compareFn(i, item));
    const updated = [item, ...filtered].slice(0, this.maxItems);
    this.set(updated);
  }

  remove(): void {
    try {
      localStorage.removeItem(this.key);
      this.cache = null;
    } catch (error) {
      console.error(`ArrayStorage: Failed to remove ${this.key}:`, error);
    }
  }

  clearCache(): void {
    this.cache = null;
  }
}

/**
 * Storage helper for Record<string, T> objects with validation.
 */
export class RecordStorage<T> {
  private readonly key: string;
  private readonly defaultValue: Record<string, T>;
  private readonly schema?: ZodType<Record<string, T>>;
  private cache: Record<string, T> | null = null;

  constructor(
    key: string,
    defaultValue: Record<string, T>,
    schema?: ZodType<Record<string, T>>
  ) {
    this.key = key;
    this.defaultValue = defaultValue;
    this.schema = schema;
  }

  get(): Record<string, T> {
    if (this.cache !== null) {
      return { ...this.cache };
    }

    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) {
        this.cache = { ...this.defaultValue };
        return { ...this.cache };
      }

      const parsed = JSON.parse(raw);

      if (this.schema) {
        const result = this.schema.safeParse(parsed);
        if (result.success) {
          this.cache = { ...this.defaultValue, ...result.data };
          return { ...this.cache };
        }
      }

      // Merge with defaults - explicitly exclude arrays
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        this.cache = { ...this.defaultValue, ...(parsed as Record<string, T>) };
        return { ...this.cache };
      }

      this.cache = { ...this.defaultValue };
      return { ...this.cache };
    } catch {
      this.cache = { ...this.defaultValue };
      return { ...this.cache };
    }
  }

  /**
   * Set the record value.
   * If a schema was provided, validates the value before storing.
   * @returns true if the value was saved successfully, false otherwise
   */
  set(value: Record<string, T>): boolean {
    try {
      // Validate against schema if provided
      if (this.schema) {
        const result = this.schema.safeParse(value);
        if (!result.success) {
          console.error(`RecordStorage: Validation failed for ${this.key}:`, result.error);
          return false;
        }
      }
      localStorage.setItem(this.key, JSON.stringify(value));
      this.cache = value;
      return true;
    } catch (error) {
      console.error(`RecordStorage: Failed to save ${this.key}:`, error);
      return false;
    }
  }

  update(updates: Record<string, T>): void {
    const current = this.get();
    this.set({ ...current, ...updates });
  }

  remove(): void {
    try {
      localStorage.removeItem(this.key);
      this.cache = null;
    } catch (error) {
      console.error(`RecordStorage: Failed to remove ${this.key}:`, error);
    }
  }

  clearCache(): void {
    this.cache = null;
  }
}
