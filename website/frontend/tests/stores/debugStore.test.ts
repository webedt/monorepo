/**
 * Tests for DebugStore
 * Covers console interception, log entry management,
 * filtering, and verbose mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Store original console methods before any imports
const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
  debug: console.debug,
};

// Mock persist function
vi.mock('../../src/lib/store', async () => {
  const actual = await vi.importActual('../../src/lib/store');
  return {
    ...actual,
    persist: vi.fn(),
  };
});

// Mock clipboard API
const mockClipboard = {
  writeText: vi.fn().mockResolvedValue(undefined),
};

vi.stubGlobal('navigator', { clipboard: mockClipboard });

// Import after mocks
import { debugStore } from '../../src/stores/debugStore';

import type { LogLevel } from '../../src/stores/debugStore';

describe('DebugStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Restore console before tests
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;

    // Clear entries
    debugStore.clear();
    debugStore.destroy();
  });

  afterEach(() => {
    debugStore.destroy();

    // Restore console after tests
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = debugStore.getState();

      expect(state.entries).toEqual([]);
      expect(state.isOpen).toBe(false);
      expect(state.filter).toBe('all');
      expect(state.searchQuery).toBe('');
      expect(state.maxEntries).toBe(1000);
      expect(state.isCapturing).toBe(false);
      expect(state.verboseMode).toBe(false);
    });
  });

  describe('Initialization', () => {
    it('should initialize console interception', () => {
      debugStore.initialize();

      expect(debugStore.getState().isCapturing).toBe(true);
    });

    it('should not re-initialize if already capturing', () => {
      debugStore.initialize();
      const initialConsoleLog = console.log;

      debugStore.initialize();

      expect(console.log).toBe(initialConsoleLog);
    });
  });

  describe('Console Interception', () => {
    beforeEach(() => {
      debugStore.initialize();
    });

    it('should capture console.log', () => {
      console.log('Test message');

      const entries = debugStore.getState().entries;
      expect(entries.length).toBe(1);
      expect(entries[0].level).toBe('log');
      expect(entries[0].message).toBe('Test message');
    });

    it('should capture console.info', () => {
      console.info('Info message');

      const entries = debugStore.getState().entries;
      expect(entries[0].level).toBe('info');
    });

    it('should capture console.warn', () => {
      console.warn('Warning message');

      const entries = debugStore.getState().entries;
      expect(entries[0].level).toBe('warn');
    });

    it('should capture console.error', () => {
      console.error('Error message');

      const entries = debugStore.getState().entries;
      expect(entries[0].level).toBe('error');
    });

    it('should capture console.debug', () => {
      console.debug('Debug message');

      const entries = debugStore.getState().entries;
      expect(entries[0].level).toBe('debug');
    });

    it('should still call original console method', () => {
      const spy = vi.spyOn(originalConsole, 'log');

      console.log('Test');

      expect(spy).toHaveBeenCalledWith('Test');
      spy.mockRestore();
    });

    it('should handle multiple arguments', () => {
      console.log('Hello', 'World', 123);

      const entries = debugStore.getState().entries;
      expect(entries[0].message).toBe('Hello World 123');
    });

    it('should handle objects', () => {
      console.log({ key: 'value' });

      const entries = debugStore.getState().entries;
      expect(entries[0].message).toContain('key');
      expect(entries[0].message).toContain('value');
    });

    it('should handle errors', () => {
      const error = new Error('Test error');
      console.error(error);

      const entries = debugStore.getState().entries;
      expect(entries[0].message).toContain('Error');
      expect(entries[0].message).toContain('Test error');
    });

    it('should parse category from message', () => {
      console.log('[Category] Message content');

      const entries = debugStore.getState().entries;
      expect(entries[0].category).toBe('Category');
      expect(entries[0].message).toBe('Message content');
    });

    it('should assign unique IDs to entries', () => {
      console.log('First');
      console.log('Second');

      const entries = debugStore.getState().entries;
      expect(entries[0].id).not.toBe(entries[1].id);
    });

    it('should include timestamp', () => {
      console.log('Test');

      const entries = debugStore.getState().entries;
      expect(entries[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Destroy', () => {
    it('should restore console methods', () => {
      debugStore.initialize();
      debugStore.destroy();

      expect(debugStore.getState().isCapturing).toBe(false);
    });

    it('should stop capturing logs', () => {
      debugStore.initialize();
      debugStore.destroy();
      debugStore.clear();

      console.log('After destroy');

      expect(debugStore.getState().entries.length).toBe(0);
    });
  });

  describe('Panel Controls', () => {
    describe('toggle', () => {
      it('should toggle panel open state', () => {
        debugStore.toggle();
        expect(debugStore.getState().isOpen).toBe(true);

        debugStore.toggle();
        expect(debugStore.getState().isOpen).toBe(false);
      });
    });

    describe('open', () => {
      it('should open the panel', () => {
        debugStore.open();
        expect(debugStore.getState().isOpen).toBe(true);
      });
    });

    describe('close', () => {
      it('should close the panel', () => {
        debugStore.open();
        debugStore.close();
        expect(debugStore.getState().isOpen).toBe(false);
      });
    });
  });

  describe('Filtering', () => {
    beforeEach(() => {
      debugStore.initialize();
      console.log('Log message');
      console.info('Info message');
      console.warn('Warning message');
      console.error('Error message');
      console.debug('Debug message');
    });

    describe('setFilter', () => {
      it('should set filter level', () => {
        debugStore.setFilter('error');

        expect(debugStore.getState().filter).toBe('error');
      });
    });

    describe('setSearchQuery', () => {
      it('should set search query', () => {
        debugStore.setSearchQuery('test');

        expect(debugStore.getState().searchQuery).toBe('test');
      });
    });

    describe('getFilteredEntries', () => {
      it('should return all entries when filter is all', () => {
        debugStore.setFilter('all');

        const filtered = debugStore.getFilteredEntries();
        expect(filtered.length).toBe(5);
      });

      it('should filter by level', () => {
        debugStore.setFilter('error');

        const filtered = debugStore.getFilteredEntries();
        expect(filtered.length).toBe(1);
        expect(filtered[0].level).toBe('error');
      });

      it('should filter by search query', () => {
        debugStore.setSearchQuery('Warning');

        const filtered = debugStore.getFilteredEntries();
        expect(filtered.length).toBe(1);
        expect(filtered[0].message).toContain('Warning');
      });

      it('should filter by category in search', () => {
        console.log('[MyCategory] Special message');

        debugStore.setSearchQuery('MyCategory');

        const filtered = debugStore.getFilteredEntries();
        expect(filtered.some(e => e.category === 'MyCategory')).toBe(true);
      });

      it('should combine level and search filters', () => {
        debugStore.setFilter('log');
        debugStore.setSearchQuery('Log');

        const filtered = debugStore.getFilteredEntries();
        expect(filtered.length).toBe(1);
      });
    });
  });

  describe('Categories', () => {
    beforeEach(() => {
      debugStore.initialize();
      console.log('[Auth] Auth message');
      console.log('[Network] Network message');
      console.log('[Auth] Another auth message');
      console.log('No category');
    });

    it('should get unique categories', () => {
      const categories = debugStore.getCategories();

      expect(categories).toContain('Auth');
      expect(categories).toContain('Network');
      expect(categories.length).toBe(2);
    });

    it('should return sorted categories', () => {
      const categories = debugStore.getCategories();

      expect(categories).toEqual(['Auth', 'Network']);
    });
  });

  describe('Entry Counts', () => {
    beforeEach(() => {
      debugStore.initialize();
      console.log('Log 1');
      console.log('Log 2');
      console.info('Info 1');
      console.warn('Warn 1');
      console.error('Error 1');
      console.error('Error 2');
    });

    it('should get counts by level', () => {
      const counts = debugStore.getCounts();

      expect(counts.all).toBe(6);
      expect(counts.log).toBe(2);
      expect(counts.info).toBe(1);
      expect(counts.warn).toBe(1);
      expect(counts.error).toBe(2);
      expect(counts.debug).toBe(0);
    });
  });

  describe('Clear', () => {
    it('should clear all entries', () => {
      debugStore.initialize();
      console.log('Test');
      console.log('Test 2');

      debugStore.clear();

      expect(debugStore.getState().entries.length).toBe(0);
    });
  });

  describe('Max Entries', () => {
    it('should limit entries to maxEntries', () => {
      debugStore.initialize();

      // Default maxEntries is 1000
      for (let i = 0; i < 1050; i++) {
        console.log(`Message ${i}`);
      }

      expect(debugStore.getState().entries.length).toBe(1000);
    });

    it('should remove oldest entries when limit reached', () => {
      debugStore.initialize();

      for (let i = 0; i < 1050; i++) {
        console.log(`Message ${i}`);
      }

      const entries = debugStore.getState().entries;
      // Should contain newer messages, not the first ones
      expect(entries[0].message).not.toBe('Message 0');
    });
  });

  describe('Copy to Clipboard', () => {
    beforeEach(() => {
      debugStore.initialize();
      console.log('Test message');
      console.error('Error message');
    });

    it('should copy filtered entries to clipboard', async () => {
      const result = await debugStore.copyToClipboard();

      expect(result).toBe(true);
      expect(mockClipboard.writeText).toHaveBeenCalled();
    });

    it('should format entries correctly', async () => {
      await debugStore.copyToClipboard();

      const text = mockClipboard.writeText.mock.calls[0][0];
      expect(text).toContain('[LOG]');
      expect(text).toContain('[ERROR]');
      expect(text).toContain('Test message');
      expect(text).toContain('Error message');
    });

    it('should include category in output', async () => {
      console.log('[Category] Message');
      await debugStore.copyToClipboard();

      const text = mockClipboard.writeText.mock.calls[0][0];
      expect(text).toContain('[Category]');
    });

    it('should handle clipboard errors', async () => {
      mockClipboard.writeText.mockRejectedValueOnce(new Error('Clipboard error'));

      const result = await debugStore.copyToClipboard();

      expect(result).toBe(false);
    });
  });

  describe('Verbose Mode', () => {
    beforeEach(() => {
      debugStore.initialize();
    });

    describe('toggleVerboseMode', () => {
      it('should toggle verbose mode', () => {
        debugStore.toggleVerboseMode();
        expect(debugStore.isVerbose()).toBe(true);

        debugStore.toggleVerboseMode();
        expect(debugStore.isVerbose()).toBe(false);
      });
    });

    describe('setVerboseMode', () => {
      it('should set verbose mode', () => {
        debugStore.setVerboseMode(true);
        expect(debugStore.isVerbose()).toBe(true);

        debugStore.setVerboseMode(false);
        expect(debugStore.isVerbose()).toBe(false);
      });
    });

    describe('verbose', () => {
      it('should not log when verbose mode is off', () => {
        debugStore.setVerboseMode(false);
        debugStore.clear();

        debugStore.verbose('Verbose message');

        // Should not add any entries (since verbose mode is off)
        const entries = debugStore.getState().entries;
        const verboseEntries = entries.filter(e => e.message.includes('Verbose message'));
        expect(verboseEntries.length).toBe(0);
      });

      it('should log when verbose mode is on', () => {
        debugStore.setVerboseMode(true);
        debugStore.clear();

        debugStore.verbose('Verbose message');

        const entries = debugStore.getState().entries;
        expect(entries.some(e => e.message.includes('Verbose message'))).toBe(true);
      });

      it('should include data in verbose log', () => {
        debugStore.setVerboseMode(true);
        debugStore.clear();

        debugStore.verbose('Message with data', { key: 'value' });

        const entries = debugStore.getState().entries;
        expect(entries.length).toBe(1);
      });
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      debugStore.subscribe(subscriber);

      debugStore.toggle();

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = debugStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      debugStore.toggle();

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    beforeEach(() => {
      debugStore.initialize();
    });

    it('should handle circular references in objects', () => {
      const obj: { self?: unknown } = {};
      obj.self = obj;

      // Should not throw
      expect(() => console.log(obj)).not.toThrow();
    });

    it('should handle undefined and null', () => {
      console.log(undefined, null);

      const entries = debugStore.getState().entries;
      expect(entries.length).toBe(1);
    });

    it('should handle symbols', () => {
      const sym = Symbol('test');

      console.log(sym);

      const entries = debugStore.getState().entries;
      expect(entries.length).toBe(1);
    });

    it('should handle rapid logging', () => {
      for (let i = 0; i < 100; i++) {
        console.log(`Rapid message ${i}`);
      }

      expect(debugStore.getState().entries.length).toBe(100);
    });
  });
});
