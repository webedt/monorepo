/**
 * Tests for OnionSkinningStore
 * Covers onion skinning preferences for frame-by-frame animation,
 * including visibility, opacity, colors, and count settings.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock TypedStorage
const mockStorage: Record<string, unknown> = {};

vi.mock('../../src/lib/typedStorage', () => ({
  TypedStorage: vi.fn().mockImplementation(({ defaultValue }) => ({
    get: () => mockStorage['onion-skinning'] ?? defaultValue,
    set: (value: unknown) => { mockStorage['onion-skinning'] = value; },
  })),
}));

vi.mock('../../src/lib/storageKeys', () => ({
  STORE_KEYS: { ONION_SKINNING: 'onion-skinning' },
}));

// Import after mocks
import { onionSkinningStore } from '../../src/stores/onionSkinningStore';

describe('OnionSkinningStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockStorage['onion-skinning'];
    onionSkinningStore.reset();
  });

  describe('Initial State', () => {
    it('should have correct default settings', () => {
      const settings = onionSkinningStore.getSettings();

      expect(settings.enabled).toBe(false);
      expect(settings.showPrevious).toBe(true);
      expect(settings.showNext).toBe(true);
      expect(settings.previousCount).toBe(2);
      expect(settings.nextCount).toBe(2);
      expect(settings.previousOpacity).toBe(0.3);
      expect(settings.nextOpacity).toBe(0.3);
      expect(settings.previousColor).toBe('#ff0000');
      expect(settings.nextColor).toBe('#0000ff');
      expect(settings.useColors).toBe(false);
    });
  });

  describe('Enable/Disable', () => {
    describe('isEnabled', () => {
      it('should return enabled state', () => {
        expect(onionSkinningStore.isEnabled()).toBe(false);
      });
    });

    describe('setEnabled', () => {
      it('should enable onion skinning', () => {
        onionSkinningStore.setEnabled(true);

        expect(onionSkinningStore.isEnabled()).toBe(true);
      });

      it('should disable onion skinning', () => {
        onionSkinningStore.setEnabled(true);
        onionSkinningStore.setEnabled(false);

        expect(onionSkinningStore.isEnabled()).toBe(false);
      });
    });

    describe('toggleEnabled', () => {
      it('should toggle enabled state', () => {
        onionSkinningStore.toggleEnabled();
        expect(onionSkinningStore.isEnabled()).toBe(true);

        onionSkinningStore.toggleEnabled();
        expect(onionSkinningStore.isEnabled()).toBe(false);
      });

      it('should return new enabled state', () => {
        const result1 = onionSkinningStore.toggleEnabled();
        expect(result1).toBe(true);

        const result2 = onionSkinningStore.toggleEnabled();
        expect(result2).toBe(false);
      });
    });
  });

  describe('Direction Visibility', () => {
    describe('setShowPrevious', () => {
      it('should set show previous frames', () => {
        onionSkinningStore.setShowPrevious(false);

        expect(onionSkinningStore.getSettings().showPrevious).toBe(false);
      });
    });

    describe('setShowNext', () => {
      it('should set show next frames', () => {
        onionSkinningStore.setShowNext(false);

        expect(onionSkinningStore.getSettings().showNext).toBe(false);
      });
    });
  });

  describe('Frame Counts', () => {
    describe('setPreviousCount', () => {
      it('should set previous frame count', () => {
        onionSkinningStore.setPreviousCount(5);

        expect(onionSkinningStore.getSettings().previousCount).toBe(5);
      });

      it('should not set count below minimum (1)', () => {
        onionSkinningStore.setPreviousCount(0);

        expect(onionSkinningStore.getSettings().previousCount).toBe(2); // Unchanged
      });

      it('should not set count above maximum (10)', () => {
        onionSkinningStore.setPreviousCount(15);

        expect(onionSkinningStore.getSettings().previousCount).toBe(2); // Unchanged
      });

      it('should accept boundary values', () => {
        onionSkinningStore.setPreviousCount(1);
        expect(onionSkinningStore.getSettings().previousCount).toBe(1);

        onionSkinningStore.setPreviousCount(10);
        expect(onionSkinningStore.getSettings().previousCount).toBe(10);
      });
    });

    describe('setNextCount', () => {
      it('should set next frame count', () => {
        onionSkinningStore.setNextCount(5);

        expect(onionSkinningStore.getSettings().nextCount).toBe(5);
      });

      it('should not set count below minimum (1)', () => {
        onionSkinningStore.setNextCount(0);

        expect(onionSkinningStore.getSettings().nextCount).toBe(2); // Unchanged
      });

      it('should not set count above maximum (10)', () => {
        onionSkinningStore.setNextCount(15);

        expect(onionSkinningStore.getSettings().nextCount).toBe(2); // Unchanged
      });

      it('should accept boundary values', () => {
        onionSkinningStore.setNextCount(1);
        expect(onionSkinningStore.getSettings().nextCount).toBe(1);

        onionSkinningStore.setNextCount(10);
        expect(onionSkinningStore.getSettings().nextCount).toBe(10);
      });
    });
  });

  describe('Opacity Settings', () => {
    describe('setPreviousOpacity', () => {
      it('should set previous frames opacity', () => {
        onionSkinningStore.setPreviousOpacity(0.5);

        expect(onionSkinningStore.getSettings().previousOpacity).toBe(0.5);
      });

      it('should not set opacity below minimum (0)', () => {
        onionSkinningStore.setPreviousOpacity(-0.5);

        expect(onionSkinningStore.getSettings().previousOpacity).toBe(0.3); // Unchanged
      });

      it('should not set opacity above maximum (1)', () => {
        onionSkinningStore.setPreviousOpacity(1.5);

        expect(onionSkinningStore.getSettings().previousOpacity).toBe(0.3); // Unchanged
      });

      it('should accept boundary values', () => {
        onionSkinningStore.setPreviousOpacity(0);
        expect(onionSkinningStore.getSettings().previousOpacity).toBe(0);

        onionSkinningStore.setPreviousOpacity(1);
        expect(onionSkinningStore.getSettings().previousOpacity).toBe(1);
      });
    });

    describe('setNextOpacity', () => {
      it('should set next frames opacity', () => {
        onionSkinningStore.setNextOpacity(0.5);

        expect(onionSkinningStore.getSettings().nextOpacity).toBe(0.5);
      });

      it('should not set opacity below minimum (0)', () => {
        onionSkinningStore.setNextOpacity(-0.5);

        expect(onionSkinningStore.getSettings().nextOpacity).toBe(0.3); // Unchanged
      });

      it('should not set opacity above maximum (1)', () => {
        onionSkinningStore.setNextOpacity(1.5);

        expect(onionSkinningStore.getSettings().nextOpacity).toBe(0.3); // Unchanged
      });

      it('should accept boundary values', () => {
        onionSkinningStore.setNextOpacity(0);
        expect(onionSkinningStore.getSettings().nextOpacity).toBe(0);

        onionSkinningStore.setNextOpacity(1);
        expect(onionSkinningStore.getSettings().nextOpacity).toBe(1);
      });
    });
  });

  describe('Color Settings', () => {
    describe('setPreviousColor', () => {
      it('should set previous frames color', () => {
        onionSkinningStore.setPreviousColor('#00ff00');

        expect(onionSkinningStore.getSettings().previousColor).toBe('#00ff00');
      });

      it('should accept any string value', () => {
        onionSkinningStore.setPreviousColor('rgb(255, 0, 0)');

        expect(onionSkinningStore.getSettings().previousColor).toBe('rgb(255, 0, 0)');
      });
    });

    describe('setNextColor', () => {
      it('should set next frames color', () => {
        onionSkinningStore.setNextColor('#00ff00');

        expect(onionSkinningStore.getSettings().nextColor).toBe('#00ff00');
      });

      it('should accept any string value', () => {
        onionSkinningStore.setNextColor('hsl(240, 100%, 50%)');

        expect(onionSkinningStore.getSettings().nextColor).toBe('hsl(240, 100%, 50%)');
      });
    });

    describe('setUseColors', () => {
      it('should enable color tinting', () => {
        onionSkinningStore.setUseColors(true);

        expect(onionSkinningStore.getSettings().useColors).toBe(true);
      });

      it('should disable color tinting', () => {
        onionSkinningStore.setUseColors(true);
        onionSkinningStore.setUseColors(false);

        expect(onionSkinningStore.getSettings().useColors).toBe(false);
      });
    });
  });

  describe('Batch Updates', () => {
    describe('updateSettings', () => {
      it('should update multiple settings at once', () => {
        onionSkinningStore.updateSettings({
          enabled: true,
          previousCount: 5,
          nextCount: 3,
          previousOpacity: 0.5,
        });

        const settings = onionSkinningStore.getSettings();
        expect(settings.enabled).toBe(true);
        expect(settings.previousCount).toBe(5);
        expect(settings.nextCount).toBe(3);
        expect(settings.previousOpacity).toBe(0.5);
      });

      it('should preserve unspecified settings', () => {
        onionSkinningStore.setNextColor('#00ff00');

        onionSkinningStore.updateSettings({ enabled: true });

        expect(onionSkinningStore.getSettings().nextColor).toBe('#00ff00');
      });
    });
  });

  describe('Reset', () => {
    it('should reset all settings to defaults', () => {
      onionSkinningStore.setEnabled(true);
      onionSkinningStore.setPreviousCount(5);
      onionSkinningStore.setNextOpacity(0.8);
      onionSkinningStore.setPreviousColor('#00ff00');
      onionSkinningStore.setUseColors(true);

      onionSkinningStore.reset();

      const settings = onionSkinningStore.getSettings();
      expect(settings.enabled).toBe(false);
      expect(settings.previousCount).toBe(2);
      expect(settings.nextOpacity).toBe(0.3);
      expect(settings.previousColor).toBe('#ff0000');
      expect(settings.useColors).toBe(false);
    });
  });

  describe('Subscriptions', () => {
    it('should call listener immediately with current settings', () => {
      const listener = vi.fn();

      onionSkinningStore.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(onionSkinningStore.getSettings());
    });

    it('should notify subscribers on state changes', () => {
      const listener = vi.fn();
      onionSkinningStore.subscribe(listener);

      onionSkinningStore.setEnabled(true);

      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', () => {
      const listener = vi.fn();
      const unsubscribe = onionSkinningStore.subscribe(listener);

      expect(listener).toHaveBeenCalledTimes(1);

      unsubscribe();
      onionSkinningStore.setEnabled(true);

      expect(listener).toHaveBeenCalledTimes(1); // No additional calls
    });

    it('should support multiple subscribers', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      onionSkinningStore.subscribe(listener1);
      onionSkinningStore.subscribe(listener2);

      onionSkinningStore.setEnabled(true);

      expect(listener1).toHaveBeenCalledTimes(2);
      expect(listener2).toHaveBeenCalledTimes(2);
    });
  });

  describe('Persistence', () => {
    it('should save settings to storage', () => {
      onionSkinningStore.setEnabled(true);
      onionSkinningStore.setPreviousCount(5);

      expect(mockStorage['onion-skinning']).toBeDefined();
      expect(mockStorage['onion-skinning'].enabled).toBe(true);
      expect(mockStorage['onion-skinning'].previousCount).toBe(5);
    });
  });

  describe('Edge Cases', () => {
    it('should handle all valid count values', () => {
      for (let i = 1; i <= 10; i++) {
        onionSkinningStore.setPreviousCount(i);
        expect(onionSkinningStore.getSettings().previousCount).toBe(i);

        onionSkinningStore.setNextCount(i);
        expect(onionSkinningStore.getSettings().nextCount).toBe(i);
      }
    });

    it('should handle opacity edge values', () => {
      const opacities = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

      for (const opacity of opacities) {
        onionSkinningStore.setPreviousOpacity(opacity);
        expect(onionSkinningStore.getSettings().previousOpacity).toBe(opacity);

        onionSkinningStore.setNextOpacity(opacity);
        expect(onionSkinningStore.getSettings().nextOpacity).toBe(opacity);
      }
    });

    it('should handle rapid consecutive updates', () => {
      for (let i = 1; i <= 10; i++) {
        onionSkinningStore.setPreviousCount(i);
        onionSkinningStore.setNextCount(i);
      }

      expect(onionSkinningStore.getSettings().previousCount).toBe(10);
      expect(onionSkinningStore.getSettings().nextCount).toBe(10);
    });

    it('should handle various color formats', () => {
      const colors = [
        '#ff0000',
        '#f00',
        'rgb(255, 0, 0)',
        'rgba(255, 0, 0, 1)',
        'hsl(0, 100%, 50%)',
        'red',
      ];

      for (const color of colors) {
        onionSkinningStore.setPreviousColor(color);
        expect(onionSkinningStore.getSettings().previousColor).toBe(color);
      }
    });
  });
});
