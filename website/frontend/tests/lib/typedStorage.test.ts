/**
 * Tests for TypedStorage
 * Covers type-safe localStorage wrapper with Zod schema validation,
 * versioning, migration, and caching.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import { TypedStorage, SimpleStorage, ArrayStorage, RecordStorage, createTypedStorage } from '../../src/lib/typedStorage';

describe('TypedStorage', () => {
  const testSchema = z.object({
    name: z.string(),
    count: z.number(),
  });

  type TestData = z.infer<typeof testSchema>;

  const defaultValue: TestData = { name: 'default', count: 0 };

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Basic Operations', () => {
    it('should return default value when storage is empty', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      expect(storage.get()).toEqual(defaultValue);
    });

    it('should set and get values', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      const newValue = { name: 'test', count: 42 };
      storage.set(newValue);

      expect(storage.get()).toEqual(newValue);
    });

    it('should wrap values in versioned format', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
        version: 1,
      });

      storage.set({ name: 'test', count: 5 });

      const stored = JSON.parse(localStorage.getItem('test_key') || '');
      expect(stored).toEqual({
        version: 1,
        data: { name: 'test', count: 5 },
      });
    });

    it('should update existing values', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      storage.set({ name: 'initial', count: 1 });
      storage.update({ count: 2 });

      expect(storage.get()).toEqual({ name: 'initial', count: 2 });
    });

    it('should update values using function updater', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      storage.set({ name: 'test', count: 5 });
      storage.update(current => ({ count: current.count + 1 }));

      expect(storage.get()).toEqual({ name: 'test', count: 6 });
    });

    it('should remove stored value', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      storage.set({ name: 'test', count: 1 });
      storage.remove();

      // After remove, cache is cleared and get() reads from storage
      expect(storage.get()).toEqual(defaultValue);
    });

    it('should reset to default value', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      storage.set({ name: 'modified', count: 99 });
      storage.reset();

      expect(storage.get()).toEqual(defaultValue);
    });
  });

  describe('Caching', () => {
    it('should cache values after first read', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      const getItemSpy = vi.spyOn(localStorage, 'getItem');

      storage.get();
      storage.get();
      storage.get();

      // Should only call getItem once
      expect(getItemSpy).toHaveBeenCalledTimes(1);
    });

    it('should clear cache when clearCache is called', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      const getItemSpy = vi.spyOn(localStorage, 'getItem');

      storage.get();
      storage.clearCache();
      storage.get();

      expect(getItemSpy).toHaveBeenCalledTimes(2);
    });

    it('should update cache on set', () => {
      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      storage.set({ name: 'cached', count: 10 });

      const getItemSpy = vi.spyOn(localStorage, 'getItem');

      // Should return cached value without reading from storage
      expect(storage.get()).toEqual({ name: 'cached', count: 10 });
      expect(getItemSpy).not.toHaveBeenCalled();
    });
  });

  describe('Schema Validation', () => {
    it('should return default value for invalid data', () => {
      localStorage.setItem('test_key', JSON.stringify({
        version: 1,
        data: { name: 123, count: 'invalid' }, // Wrong types
      }));

      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      // Should merge with defaults and fix invalid data
      const result = storage.get();
      expect(result.name).toBe('default'); // Merged from default
    });

    it('should merge partial valid data with defaults', () => {
      localStorage.setItem('test_key', JSON.stringify({
        version: 1,
        data: { name: 'valid' }, // Missing count
      }));

      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      const result = storage.get();
      expect(result).toEqual({ name: 'valid', count: 0 });
    });

    it('should handle malformed JSON gracefully', () => {
      localStorage.setItem('test_key', 'not valid json {{{');

      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
      });

      expect(storage.get()).toEqual(defaultValue);
    });
  });

  describe('Versioning and Migration', () => {
    it('should migrate data from older version', () => {
      localStorage.setItem('test_key', JSON.stringify({
        version: 1,
        data: { oldName: 'legacy', oldCount: 5 },
      }));

      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
        version: 2,
        migrate: (oldData, oldVersion) => {
          expect(oldVersion).toBe(1);
          const old = oldData as { oldName: string; oldCount: number };
          return { name: old.oldName, count: old.oldCount };
        },
      });

      expect(storage.get()).toEqual({ name: 'legacy', count: 5 });
    });

    it('should upgrade legacy unversioned data', () => {
      // Store data without version wrapper (legacy format)
      localStorage.setItem('test_key', JSON.stringify({ name: 'legacy', count: 10 }));

      const storage = new TypedStorage({
        key: 'test_key',
        schema: testSchema,
        defaultValue,
        version: 1,
      });

      const result = storage.get();
      expect(result).toEqual({ name: 'legacy', count: 10 });

      // Should have saved in versioned format
      const stored = JSON.parse(localStorage.getItem('test_key') || '');
      expect(stored.version).toBe(1);
    });
  });

  describe('createTypedStorage helper', () => {
    it('should create a TypedStorage instance', () => {
      const storage = createTypedStorage({
        key: 'helper_test',
        schema: testSchema,
        defaultValue,
      });

      expect(storage).toBeInstanceOf(TypedStorage);
      storage.set({ name: 'helper', count: 1 });
      expect(storage.get()).toEqual({ name: 'helper', count: 1 });
    });
  });
});

describe('SimpleStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('String values', () => {
    it('should store and retrieve strings', () => {
      const storage = new SimpleStorage('string_key', 'default');

      storage.set('hello world');
      expect(storage.get()).toBe('hello world');
    });

    it('should return default for missing key', () => {
      const storage = new SimpleStorage('missing_key', 'fallback');

      expect(storage.get()).toBe('fallback');
    });
  });

  describe('Number values', () => {
    it('should store and retrieve numbers', () => {
      const storage = new SimpleStorage('number_key', 0);

      storage.set(42);
      expect(storage.get()).toBe(42);
    });

    it('should return default for NaN', () => {
      localStorage.setItem('number_key', 'not a number');

      const storage = new SimpleStorage('number_key', 100);
      expect(storage.get()).toBe(100);
    });
  });

  describe('Boolean values', () => {
    it('should store and retrieve true', () => {
      const storage = new SimpleStorage('bool_key', false);

      storage.set(true);
      expect(storage.get()).toBe(true);
    });

    it('should store and retrieve false', () => {
      const storage = new SimpleStorage('bool_key', true);

      storage.set(false);
      expect(storage.get()).toBe(false);
    });

    it('should parse "true" string as true', () => {
      localStorage.setItem('bool_key', 'true');

      const storage = new SimpleStorage('bool_key', false);
      expect(storage.get()).toBe(true);
    });

    it('should parse "false" string as false', () => {
      localStorage.setItem('bool_key', 'false');

      const storage = new SimpleStorage('bool_key', true);
      expect(storage.get()).toBe(false);
    });
  });

  describe('Validation', () => {
    it('should use validator to check values', () => {
      const isPositive = (val: unknown): val is number =>
        typeof val === 'number' && val > 0;

      const storage = new SimpleStorage('validated_key', 10, isPositive);

      localStorage.setItem('validated_key', '-5');

      expect(storage.get()).toBe(10); // Returns default because -5 fails validation
    });
  });

  describe('Caching', () => {
    it('should cache values', () => {
      const storage = new SimpleStorage('cache_test', 'default');

      storage.set('cached');

      const getItemSpy = vi.spyOn(localStorage, 'getItem');

      storage.get();
      storage.get();

      expect(getItemSpy).not.toHaveBeenCalled();
    });

    it('should clear cache on clearCache', () => {
      const storage = new SimpleStorage('cache_test', 'default');

      storage.get();
      storage.clearCache();

      const getItemSpy = vi.spyOn(localStorage, 'getItem');
      storage.get();

      expect(getItemSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe('ArrayStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Basic Operations', () => {
    it('should return default empty array', () => {
      const storage = new ArrayStorage<string>('array_key');

      expect(storage.get()).toEqual([]);
    });

    it('should store and retrieve arrays', () => {
      const storage = new ArrayStorage<string>('array_key');

      storage.set(['a', 'b', 'c']);
      expect(storage.get()).toEqual(['a', 'b', 'c']);
    });

    it('should push items to front', () => {
      const storage = new ArrayStorage<string>('array_key');

      storage.set(['b', 'c']);
      storage.push('a');

      expect(storage.get()).toEqual(['a', 'b', 'c']);
    });

    it('should remove duplicates on push (reference equality)', () => {
      const storage = new ArrayStorage<string>('array_key');

      storage.set(['a', 'b', 'c']);
      storage.push('b'); // 'b' exists, should be moved to front

      expect(storage.get()).toEqual(['b', 'a', 'c']);
    });
  });

  describe('Max Items', () => {
    it('should respect maxItems on set', () => {
      const storage = new ArrayStorage<string>('array_key', [], { maxItems: 3 });

      storage.set(['a', 'b', 'c', 'd', 'e']);
      expect(storage.get()).toEqual(['a', 'b', 'c']);
    });

    it('should respect maxItems on push', () => {
      const storage = new ArrayStorage<string>('array_key', [], { maxItems: 3 });

      storage.set(['a', 'b', 'c']);
      storage.push('x');

      expect(storage.get()).toEqual(['x', 'a', 'b']);
    });
  });

  describe('Item Validation', () => {
    it('should filter invalid items when reading', () => {
      localStorage.setItem('array_key', JSON.stringify(['valid', 123, 'also valid', null]));

      const storage = new ArrayStorage<string>('array_key', [], {
        itemValidator: (item): item is string => typeof item === 'string',
      });

      expect(storage.get()).toEqual(['valid', 'also valid']);
    });
  });

  describe('Non-array data', () => {
    it('should return default for non-array stored data', () => {
      localStorage.setItem('array_key', JSON.stringify({ not: 'array' }));

      const storage = new ArrayStorage<string>('array_key', ['default']);

      expect(storage.get()).toEqual(['default']);
    });
  });
});

describe('RecordStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  describe('Basic Operations', () => {
    it('should return default value', () => {
      const storage = new RecordStorage<number>('record_key', { a: 1 });

      expect(storage.get()).toEqual({ a: 1 });
    });

    it('should store and retrieve records', () => {
      const storage = new RecordStorage<number>('record_key', {});

      storage.set({ x: 10, y: 20 });
      expect(storage.get()).toEqual({ x: 10, y: 20 });
    });

    it('should update specific keys', () => {
      const storage = new RecordStorage<number>('record_key', {});

      storage.set({ a: 1, b: 2 });
      storage.update({ b: 3, c: 4 });

      expect(storage.get()).toEqual({ a: 1, b: 3, c: 4 });
    });
  });

  describe('Merging with defaults', () => {
    it('should merge stored data with defaults', () => {
      localStorage.setItem('record_key', JSON.stringify({ b: 2 }));

      const storage = new RecordStorage<number>('record_key', { a: 1 });

      expect(storage.get()).toEqual({ a: 1, b: 2 });
    });
  });

  describe('Schema Validation', () => {
    it('should validate with Zod schema', () => {
      const schema = z.record(z.string(), z.number());
      const storage = new RecordStorage<number>('record_key', { default: 0 }, schema);

      localStorage.setItem('record_key', JSON.stringify({ valid: 10, also: 20 }));

      expect(storage.get()).toEqual({ default: 0, valid: 10, also: 20 });
    });
  });

  describe('Invalid data handling', () => {
    it('should return default for non-object stored data', () => {
      localStorage.setItem('record_key', JSON.stringify('not an object'));

      const storage = new RecordStorage<number>('record_key', { fallback: 99 });

      expect(storage.get()).toEqual({ fallback: 99 });
    });
  });
});
