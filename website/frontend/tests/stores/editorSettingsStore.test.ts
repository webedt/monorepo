/**
 * Tests for EditorSettingsStore
 * Covers editor preferences including format-on-save,
 * tab size, and indentation settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock TypedStorage
const mockStorage: Record<string, unknown> = {};

vi.mock('../../src/lib/typedStorage', () => ({
  TypedStorage: vi.fn().mockImplementation(({ defaultValue }) => ({
    get: () => mockStorage['editor-settings'] ?? defaultValue,
    set: (value: unknown) => { mockStorage['editor-settings'] = value; },
  })),
}));

vi.mock('../../src/lib/storageKeys', () => ({
  STORE_KEYS: { EDITOR_SETTINGS: 'editor-settings' },
}));

// Import after mocks
import { editorSettingsStore } from '../../src/stores/editorSettingsStore';

describe('EditorSettingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockStorage['editor-settings'];
    editorSettingsStore.reset();
  });

  describe('Initial State', () => {
    it('should have correct default settings', () => {
      const settings = editorSettingsStore.getSettings();

      expect(settings.formatOnSave).toBe(true);
      expect(settings.tabSize).toBe(2);
      expect(settings.useTabs).toBe(false);
    });
  });

  describe('Format On Save', () => {
    it('should get format on save', () => {
      expect(editorSettingsStore.getFormatOnSave()).toBe(true);
    });

    it('should set format on save', () => {
      editorSettingsStore.setFormatOnSave(false);

      expect(editorSettingsStore.getFormatOnSave()).toBe(false);
    });

    it('should toggle format on save', () => {
      editorSettingsStore.setFormatOnSave(false);
      expect(editorSettingsStore.getFormatOnSave()).toBe(false);

      editorSettingsStore.setFormatOnSave(true);
      expect(editorSettingsStore.getFormatOnSave()).toBe(true);
    });
  });

  describe('Tab Size', () => {
    it('should get tab size', () => {
      expect(editorSettingsStore.getTabSize()).toBe(2);
    });

    it('should set tab size within valid range', () => {
      editorSettingsStore.setTabSize(4);

      expect(editorSettingsStore.getTabSize()).toBe(4);
    });

    it('should not set tab size below minimum (1)', () => {
      editorSettingsStore.setTabSize(0);

      expect(editorSettingsStore.getTabSize()).toBe(2); // Unchanged
    });

    it('should not set tab size above maximum (8)', () => {
      editorSettingsStore.setTabSize(10);

      expect(editorSettingsStore.getTabSize()).toBe(2); // Unchanged
    });

    it('should accept boundary values', () => {
      editorSettingsStore.setTabSize(1);
      expect(editorSettingsStore.getTabSize()).toBe(1);

      editorSettingsStore.setTabSize(8);
      expect(editorSettingsStore.getTabSize()).toBe(8);
    });

    it('should handle all valid tab sizes', () => {
      for (let i = 1; i <= 8; i++) {
        editorSettingsStore.setTabSize(i);
        expect(editorSettingsStore.getTabSize()).toBe(i);
      }
    });
  });

  describe('Use Tabs', () => {
    it('should get use tabs', () => {
      expect(editorSettingsStore.getUseTabs()).toBe(false);
    });

    it('should set use tabs', () => {
      editorSettingsStore.setUseTabs(true);

      expect(editorSettingsStore.getUseTabs()).toBe(true);
    });

    it('should toggle use tabs', () => {
      editorSettingsStore.setUseTabs(true);
      expect(editorSettingsStore.getUseTabs()).toBe(true);

      editorSettingsStore.setUseTabs(false);
      expect(editorSettingsStore.getUseTabs()).toBe(false);
    });
  });

  describe('Batch Updates', () => {
    it('should update multiple settings at once', () => {
      editorSettingsStore.updateSettings({
        formatOnSave: false,
        tabSize: 4,
        useTabs: true,
      });

      expect(editorSettingsStore.getFormatOnSave()).toBe(false);
      expect(editorSettingsStore.getTabSize()).toBe(4);
      expect(editorSettingsStore.getUseTabs()).toBe(true);
    });

    it('should partially update settings', () => {
      editorSettingsStore.updateSettings({ tabSize: 4 });

      expect(editorSettingsStore.getFormatOnSave()).toBe(true); // Unchanged
      expect(editorSettingsStore.getTabSize()).toBe(4);
      expect(editorSettingsStore.getUseTabs()).toBe(false); // Unchanged
    });
  });

  describe('Reset', () => {
    it('should reset all settings to defaults', () => {
      editorSettingsStore.setFormatOnSave(false);
      editorSettingsStore.setTabSize(8);
      editorSettingsStore.setUseTabs(true);

      editorSettingsStore.reset();

      expect(editorSettingsStore.getFormatOnSave()).toBe(true);
      expect(editorSettingsStore.getTabSize()).toBe(2);
      expect(editorSettingsStore.getUseTabs()).toBe(false);
    });
  });

  describe('Subscriptions', () => {
    it('should call listener immediately with current settings', () => {
      const listener = vi.fn();

      editorSettingsStore.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(editorSettingsStore.getSettings());
    });

    it('should notify subscribers on state changes', () => {
      const listener = vi.fn();
      editorSettingsStore.subscribe(listener);

      editorSettingsStore.setTabSize(4);

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', () => {
      const listener = vi.fn();
      const unsubscribe = editorSettingsStore.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      editorSettingsStore.setTabSize(4);

      expect(listener).toHaveBeenCalledTimes(1); // No additional calls
    });

    it('should support multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      editorSettingsStore.subscribe(listener1);
      editorSettingsStore.subscribe(listener2);

      editorSettingsStore.setTabSize(4);

      expect(listener1).toHaveBeenCalledTimes(2);
      expect(listener2).toHaveBeenCalledTimes(2);
    });

    it('should allow unsubscribing one listener without affecting others', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      const unsubscribe1 = editorSettingsStore.subscribe(listener1);
      editorSettingsStore.subscribe(listener2);

      unsubscribe1();
      listener1.mockClear();
      listener2.mockClear();

      editorSettingsStore.setTabSize(4);

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('Persistence', () => {
    it('should save settings to storage', () => {
      editorSettingsStore.setTabSize(4);

      expect(mockStorage['editor-settings']).toEqual({
        formatOnSave: true,
        tabSize: 4,
        useTabs: false,
      });
    });

    it('should save on each change', () => {
      editorSettingsStore.setFormatOnSave(false);
      expect(mockStorage['editor-settings'].formatOnSave).toBe(false);

      editorSettingsStore.setUseTabs(true);
      expect(mockStorage['editor-settings'].useTabs).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid consecutive updates', () => {
      for (let i = 1; i <= 8; i++) {
        editorSettingsStore.setTabSize(i);
      }

      expect(editorSettingsStore.getTabSize()).toBe(8);
    });

    it('should handle setting same value multiple times', () => {
      const listener = vi.fn();
      editorSettingsStore.subscribe(listener);
      listener.mockClear();

      editorSettingsStore.setTabSize(4);
      editorSettingsStore.setTabSize(4);
      editorSettingsStore.setTabSize(4);

      // Should still notify (store doesn't optimize for no-op updates)
      expect(listener).toHaveBeenCalledTimes(3);
    });
  });
});
