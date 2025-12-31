/**
 * Tests for TimerRegistry
 * Covers centralized timer tracking and cleanup functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TimerRegistry, createTimerRegistry } from '../../src/lib/timerRegistry';

describe('TimerRegistry', () => {
  let registry: TimerRegistry;

  beforeEach(() => {
    registry = new TimerRegistry();
    vi.useFakeTimers();
  });

  afterEach(() => {
    registry.clearAll();
    vi.useRealTimers();
  });

  describe('setTimeout', () => {
    it('should execute callback after delay', () => {
      const callback = vi.fn();

      registry.setTimeout(callback, 100);

      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should return an internal ID', () => {
      const id = registry.setTimeout(vi.fn(), 100);

      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('should track the timer', () => {
      const id = registry.setTimeout(vi.fn(), 100);

      expect(registry.count).toBe(1);
      expect(registry.has(id)).toBe(true);
    });

    it('should remove timer from tracking after execution', () => {
      const id = registry.setTimeout(vi.fn(), 100);

      expect(registry.has(id)).toBe(true);
      vi.advanceTimersByTime(100);
      expect(registry.has(id)).toBe(false);
      expect(registry.count).toBe(0);
    });

    it('should return unique IDs for multiple timeouts', () => {
      const id1 = registry.setTimeout(vi.fn(), 100);
      const id2 = registry.setTimeout(vi.fn(), 200);
      const id3 = registry.setTimeout(vi.fn(), 300);

      expect(new Set([id1, id2, id3]).size).toBe(3);
    });
  });

  describe('setInterval', () => {
    it('should execute callback repeatedly', () => {
      const callback = vi.fn();

      registry.setInterval(callback, 100);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(2);

      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(3);
    });

    it('should return an internal ID', () => {
      const id = registry.setInterval(vi.fn(), 100);

      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);
    });

    it('should track the interval', () => {
      const id = registry.setInterval(vi.fn(), 100);

      expect(registry.count).toBe(1);
      expect(registry.has(id)).toBe(true);
    });

    it('should keep interval tracked until cleared', () => {
      const id = registry.setInterval(vi.fn(), 100);

      vi.advanceTimersByTime(500);
      expect(registry.has(id)).toBe(true);
      expect(registry.count).toBe(1);
    });
  });

  describe('clearTimeout', () => {
    it('should clear a specific timeout', () => {
      const callback = vi.fn();
      const id = registry.setTimeout(callback, 100);

      const result = registry.clearTimeout(id);

      expect(result).toBe(true);
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should remove timeout from tracking', () => {
      const id = registry.setTimeout(vi.fn(), 100);

      registry.clearTimeout(id);

      expect(registry.has(id)).toBe(false);
      expect(registry.count).toBe(0);
    });

    it('should return false for non-existent timer', () => {
      const result = registry.clearTimeout(999);

      expect(result).toBe(false);
    });

    it('should return false when trying to clear an interval', () => {
      const id = registry.setInterval(vi.fn(), 100);

      const result = registry.clearTimeout(id);

      expect(result).toBe(false);
      expect(registry.has(id)).toBe(true);
    });
  });

  describe('clearInterval', () => {
    it('should clear a specific interval', () => {
      const callback = vi.fn();
      const id = registry.setInterval(callback, 100);

      const result = registry.clearInterval(id);

      expect(result).toBe(true);
      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should remove interval from tracking', () => {
      const id = registry.setInterval(vi.fn(), 100);

      registry.clearInterval(id);

      expect(registry.has(id)).toBe(false);
      expect(registry.count).toBe(0);
    });

    it('should return false for non-existent timer', () => {
      const result = registry.clearInterval(999);

      expect(result).toBe(false);
    });

    it('should return false when trying to clear a timeout', () => {
      const id = registry.setTimeout(vi.fn(), 100);

      const result = registry.clearInterval(id);

      expect(result).toBe(false);
      expect(registry.has(id)).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear a timeout', () => {
      const callback = vi.fn();
      const id = registry.setTimeout(callback, 100);

      const result = registry.clear(id);

      expect(result).toBe(true);
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should clear an interval', () => {
      const callback = vi.fn();
      const id = registry.setInterval(callback, 100);

      const result = registry.clear(id);

      expect(result).toBe(true);
      vi.advanceTimersByTime(500);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should return false for non-existent timer', () => {
      const result = registry.clear(999);

      expect(result).toBe(false);
    });
  });

  describe('clearAll', () => {
    it('should clear all timeouts', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      registry.setTimeout(callback1, 100);
      registry.setTimeout(callback2, 200);

      registry.clearAll();

      vi.advanceTimersByTime(300);
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it('should clear all intervals', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      registry.setInterval(callback1, 100);
      registry.setInterval(callback2, 200);

      registry.clearAll();

      vi.advanceTimersByTime(500);
      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
    });

    it('should reset count to zero', () => {
      registry.setTimeout(vi.fn(), 100);
      registry.setTimeout(vi.fn(), 200);
      registry.setInterval(vi.fn(), 100);

      expect(registry.count).toBe(3);

      registry.clearAll();

      expect(registry.count).toBe(0);
    });

    it('should be safe to call multiple times', () => {
      registry.setTimeout(vi.fn(), 100);

      registry.clearAll();
      registry.clearAll();
      registry.clearAll();

      expect(registry.count).toBe(0);
    });

    it('should clear debounce keys', () => {
      registry.debounce('key1', vi.fn(), 100);
      registry.debounce('key2', vi.fn(), 100);

      registry.clearAll();

      expect(registry.hasDebounce('key1')).toBe(false);
      expect(registry.hasDebounce('key2')).toBe(false);
    });
  });

  describe('count and getters', () => {
    it('should return correct count', () => {
      expect(registry.count).toBe(0);

      registry.setTimeout(vi.fn(), 100);
      expect(registry.count).toBe(1);

      registry.setInterval(vi.fn(), 100);
      expect(registry.count).toBe(2);
    });

    it('should return correct timeoutCount', () => {
      registry.setTimeout(vi.fn(), 100);
      registry.setTimeout(vi.fn(), 200);
      registry.setInterval(vi.fn(), 100);

      expect(registry.timeoutCount).toBe(2);
    });

    it('should return correct intervalCount', () => {
      registry.setTimeout(vi.fn(), 100);
      registry.setInterval(vi.fn(), 100);
      registry.setInterval(vi.fn(), 200);

      expect(registry.intervalCount).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for tracked timer', () => {
      const id = registry.setTimeout(vi.fn(), 100);

      expect(registry.has(id)).toBe(true);
    });

    it('should return false for non-existent timer', () => {
      expect(registry.has(999)).toBe(false);
    });

    it('should return false after timer is cleared', () => {
      const id = registry.setTimeout(vi.fn(), 100);
      registry.clear(id);

      expect(registry.has(id)).toBe(false);
    });
  });

  describe('getTimers', () => {
    it('should return a copy of tracked timers', () => {
      registry.setTimeout(vi.fn(), 100);
      registry.setInterval(vi.fn(), 200);

      const timers = registry.getTimers();

      expect(timers).toHaveLength(2);
      expect(timers[0].type).toBe('timeout');
      expect(timers[0].delay).toBe(100);
      expect(timers[1].type).toBe('interval');
      expect(timers[1].delay).toBe(200);
    });

    it('should return a copy not a reference', () => {
      registry.setTimeout(vi.fn(), 100);

      const timers = registry.getTimers();
      (timers as unknown[]).push({});

      expect(registry.count).toBe(1);
    });
  });

  describe('clearAllTimeouts', () => {
    it('should clear only timeouts', () => {
      const timeoutCb = vi.fn();
      const intervalCb = vi.fn();

      registry.setTimeout(timeoutCb, 100);
      registry.setInterval(intervalCb, 100);

      const cleared = registry.clearAllTimeouts();

      expect(cleared).toBe(1);
      expect(registry.count).toBe(1);

      vi.advanceTimersByTime(100);
      expect(timeoutCb).not.toHaveBeenCalled();
      expect(intervalCb).toHaveBeenCalledTimes(1);
    });

    it('should clear debounce keys', () => {
      registry.debounce('key1', vi.fn(), 100);
      registry.setInterval(vi.fn(), 100);

      registry.clearAllTimeouts();

      expect(registry.hasDebounce('key1')).toBe(false);
    });
  });

  describe('clearAllIntervals', () => {
    it('should clear only intervals', () => {
      const timeoutCb = vi.fn();
      const intervalCb = vi.fn();

      registry.setTimeout(timeoutCb, 100);
      registry.setInterval(intervalCb, 100);

      const cleared = registry.clearAllIntervals();

      expect(cleared).toBe(1);
      expect(registry.count).toBe(1);

      vi.advanceTimersByTime(100);
      expect(timeoutCb).toHaveBeenCalledTimes(1);
      expect(intervalCb).not.toHaveBeenCalled();
    });
  });

  describe('debounce', () => {
    it('should execute callback after delay', () => {
      const callback = vi.fn();

      registry.debounce('search', callback, 100);

      expect(callback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(100);
      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should cancel previous timer with same key', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      registry.debounce('search', callback1, 100);
      vi.advanceTimersByTime(50);
      registry.debounce('search', callback2, 100);
      vi.advanceTimersByTime(100);

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should not interfere with different keys', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      registry.debounce('search', callback1, 100);
      registry.debounce('filter', callback2, 100);

      vi.advanceTimersByTime(100);

      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });

    it('should track debounce as timer', () => {
      registry.debounce('search', vi.fn(), 100);

      expect(registry.count).toBe(1);
      expect(registry.timeoutCount).toBe(1);
    });

    it('should remove from tracking after execution', () => {
      registry.debounce('search', vi.fn(), 100);

      vi.advanceTimersByTime(100);

      expect(registry.count).toBe(0);
      expect(registry.hasDebounce('search')).toBe(false);
    });

    it('should handle rapid successive calls', () => {
      const callback = vi.fn();

      for (let i = 0; i < 10; i++) {
        registry.debounce('search', callback, 100);
        vi.advanceTimersByTime(50);
      }

      vi.advanceTimersByTime(100);

      expect(callback).toHaveBeenCalledTimes(1);
    });

    it('should not have hash collision issues', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      // Use keys that might have similar hashes
      registry.debounce('FB', callback1, 100);
      registry.debounce('Ea', callback2, 100);

      vi.advanceTimersByTime(100);

      // Both should execute - no collision
      expect(callback1).toHaveBeenCalledTimes(1);
      expect(callback2).toHaveBeenCalledTimes(1);
    });
  });

  describe('cancelDebounce', () => {
    it('should cancel a debounced timer', () => {
      const callback = vi.fn();

      registry.debounce('search', callback, 100);
      const result = registry.cancelDebounce('search');

      expect(result).toBe(true);
      vi.advanceTimersByTime(100);
      expect(callback).not.toHaveBeenCalled();
    });

    it('should return false for non-existent key', () => {
      const result = registry.cancelDebounce('non-existent');

      expect(result).toBe(false);
    });

    it('should remove from tracking', () => {
      registry.debounce('search', vi.fn(), 100);

      registry.cancelDebounce('search');

      expect(registry.count).toBe(0);
      expect(registry.hasDebounce('search')).toBe(false);
    });
  });

  describe('hasDebounce', () => {
    it('should return true for active debounce', () => {
      registry.debounce('search', vi.fn(), 100);

      expect(registry.hasDebounce('search')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(registry.hasDebounce('search')).toBe(false);
    });

    it('should return false after debounce executes', () => {
      registry.debounce('search', vi.fn(), 100);

      vi.advanceTimersByTime(100);

      expect(registry.hasDebounce('search')).toBe(false);
    });

    it('should return false after debounce is cancelled', () => {
      registry.debounce('search', vi.fn(), 100);

      registry.cancelDebounce('search');

      expect(registry.hasDebounce('search')).toBe(false);
    });
  });
});

describe('createTimerRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should create a new TimerRegistry instance', () => {
    const registry = createTimerRegistry();

    expect(registry).toBeInstanceOf(TimerRegistry);
  });

  it('should create independent instances', () => {
    const registry1 = createTimerRegistry();
    const registry2 = createTimerRegistry();

    registry1.setTimeout(vi.fn(), 100);

    expect(registry1.count).toBe(1);
    expect(registry2.count).toBe(0);
  });
});
