/**
 * Tests for WidgetStore
 * Covers widget layout management, customization mode,
 * visibility toggles, and drag-and-drop reordering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock TypedStorage
const mockStorage: Record<string, unknown> = {};

vi.mock('../../src/lib/typedStorage', () => ({
  TypedStorage: vi.fn().mockImplementation(({ defaultValue }) => ({
    get: () => mockStorage['widget'] ?? defaultValue,
    set: (value: unknown) => { mockStorage['widget'] = value; },
  })),
}));

vi.mock('../../src/lib/storageKeys', () => ({
  STORE_KEYS: { WIDGET: 'widget' },
}));

// Mock HMR functions
vi.mock('../../src/lib/hmr', () => ({
  registerStore: vi.fn(),
  getHmrState: vi.fn(() => undefined),
  saveHmrState: vi.fn(),
}));

// Import after mocks
import { widgetStore } from '../../src/stores/widgetStore';

import type { WidgetConfig, WidgetSize } from '../../src/components/widget/types';

describe('WidgetStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockStorage['widget'];
    widgetStore.resetToDefault();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = widgetStore.getState();

      expect(state.layout.widgets.length).toBe(8);
      expect(state.layout.columns).toBe(4);
      expect(state.isCustomizing).toBe(false);
      expect(state.draggedWidgetId).toBeNull();
    });

    it('should have default widgets', () => {
      const widgets = widgetStore.getAllWidgets();

      expect(widgets.some(w => w.type === 'stats')).toBe(true);
      expect(widgets.some(w => w.type === 'activity')).toBe(true);
      expect(widgets.some(w => w.type === 'quick-actions')).toBe(true);
    });
  });

  describe('Widget Visibility', () => {
    describe('getVisibleWidgets', () => {
      it('should return only visible widgets', () => {
        const visible = widgetStore.getVisibleWidgets();

        expect(visible.every(w => w.visible)).toBe(true);
      });

      it('should sort widgets by order', () => {
        const visible = widgetStore.getVisibleWidgets();

        for (let i = 1; i < visible.length; i++) {
          expect(visible[i].order).toBeGreaterThanOrEqual(visible[i - 1].order);
        }
      });
    });

    describe('toggleWidgetVisibility', () => {
      it('should toggle widget visibility', () => {
        const widgets = widgetStore.getAllWidgets();
        const widgetId = widgets[0].id;
        const initialVisibility = widgets[0].visible;

        widgetStore.toggleWidgetVisibility(widgetId);

        expect(widgetStore.getAllWidgets().find(w => w.id === widgetId)?.visible).toBe(!initialVisibility);
      });

      it('should handle non-existent widget gracefully', () => {
        expect(() => widgetStore.toggleWidgetVisibility('non-existent')).not.toThrow();
      });
    });
  });

  describe('Widget CRUD', () => {
    describe('addWidget', () => {
      it('should add a new widget', () => {
        const initialCount = widgetStore.getAllWidgets().length;

        widgetStore.addWidget({
          id: 'new-widget',
          type: 'custom',
          title: 'New Widget',
          size: 'md',
          visible: true,
        });

        expect(widgetStore.getAllWidgets().length).toBe(initialCount + 1);
      });

      it('should auto-assign order', () => {
        const maxOrder = Math.max(...widgetStore.getAllWidgets().map(w => w.order));

        widgetStore.addWidget({
          id: 'new-widget',
          type: 'custom',
          title: 'New Widget',
          size: 'md',
          visible: true,
        });

        const newWidget = widgetStore.getAllWidgets().find(w => w.id === 'new-widget');
        expect(newWidget?.order).toBe(maxOrder + 1);
      });
    });

    describe('removeWidget', () => {
      it('should remove a widget', () => {
        const widgets = widgetStore.getAllWidgets();
        const widgetId = widgets[0].id;

        widgetStore.removeWidget(widgetId);

        expect(widgetStore.getAllWidgets().find(w => w.id === widgetId)).toBeUndefined();
      });
    });

    describe('updateWidget', () => {
      it('should update widget configuration', () => {
        const widgets = widgetStore.getAllWidgets();
        const widgetId = widgets[0].id;

        widgetStore.updateWidget(widgetId, { title: 'Updated Title' });

        expect(widgetStore.getAllWidgets().find(w => w.id === widgetId)?.title).toBe('Updated Title');
      });

      it('should merge updates with existing config', () => {
        const widgets = widgetStore.getAllWidgets();
        const widgetId = widgets[0].id;
        const originalSize = widgets[0].size;

        widgetStore.updateWidget(widgetId, { title: 'Updated' });

        const updated = widgetStore.getAllWidgets().find(w => w.id === widgetId);
        expect(updated?.size).toBe(originalSize);
      });
    });
  });

  describe('Widget Sizing', () => {
    describe('resizeWidget', () => {
      it('should resize a widget', () => {
        const widgets = widgetStore.getAllWidgets();
        const widgetId = widgets[0].id;

        widgetStore.resizeWidget(widgetId, 'lg');

        expect(widgetStore.getAllWidgets().find(w => w.id === widgetId)?.size).toBe('lg');
      });

      it('should accept all valid sizes', () => {
        const widgets = widgetStore.getAllWidgets();
        const widgetId = widgets[0].id;
        const sizes: WidgetSize[] = ['sm', 'md', 'lg', 'xl'];

        for (const size of sizes) {
          widgetStore.resizeWidget(widgetId, size);
          expect(widgetStore.getAllWidgets().find(w => w.id === widgetId)?.size).toBe(size);
        }
      });
    });
  });

  describe('Widget Ordering', () => {
    describe('reorderWidgets', () => {
      it('should reorder widgets', () => {
        const widgets = widgetStore.getAllWidgets();
        const firstWidgetId = widgets[0].id;

        widgetStore.reorderWidgets(0, 2);

        const reordered = widgetStore.getAllWidgets();
        expect(reordered[2].id).toBe(firstWidgetId);
      });

      it('should update order properties', () => {
        widgetStore.reorderWidgets(0, 2);

        const widgets = widgetStore.getAllWidgets();
        for (let i = 0; i < widgets.length; i++) {
          expect(widgets[i].order).toBe(i);
        }
      });
    });

    describe('moveWidget', () => {
      it('should move widget by ID', () => {
        const visible = widgetStore.getVisibleWidgets();
        const sourceId = visible[0].id;
        const targetId = visible[2].id;

        widgetStore.moveWidget(sourceId, targetId);

        const newVisible = widgetStore.getVisibleWidgets();
        expect(newVisible[2].id).toBe(sourceId);
      });

      it('should handle non-existent source gracefully', () => {
        const visible = widgetStore.getVisibleWidgets();
        const targetId = visible[0].id;

        expect(() => widgetStore.moveWidget('non-existent', targetId)).not.toThrow();
      });
    });
  });

  describe('Layout Columns', () => {
    describe('setColumns', () => {
      it('should set column count', () => {
        widgetStore.setColumns(3);

        expect(widgetStore.getState().layout.columns).toBe(3);
      });

      it('should clamp to minimum (1)', () => {
        widgetStore.setColumns(0);

        expect(widgetStore.getState().layout.columns).toBe(1);
      });

      it('should clamp to maximum (6)', () => {
        widgetStore.setColumns(10);

        expect(widgetStore.getState().layout.columns).toBe(6);
      });

      it('should accept all valid column counts', () => {
        for (let i = 1; i <= 6; i++) {
          widgetStore.setColumns(i);
          expect(widgetStore.getState().layout.columns).toBe(i);
        }
      });
    });
  });

  describe('Customization Mode', () => {
    describe('startCustomizing', () => {
      it('should enter customization mode', () => {
        widgetStore.startCustomizing();

        expect(widgetStore.getState().isCustomizing).toBe(true);
      });
    });

    describe('stopCustomizing', () => {
      it('should exit customization mode', () => {
        widgetStore.startCustomizing();
        widgetStore.stopCustomizing();

        expect(widgetStore.getState().isCustomizing).toBe(false);
      });

      it('should clear dragged widget', () => {
        widgetStore.startCustomizing();
        widgetStore.setDraggedWidget('widget-1');
        widgetStore.stopCustomizing();

        expect(widgetStore.getState().draggedWidgetId).toBeNull();
      });
    });

    describe('setDraggedWidget', () => {
      it('should set dragged widget ID', () => {
        widgetStore.setDraggedWidget('widget-1');

        expect(widgetStore.getState().draggedWidgetId).toBe('widget-1');
      });

      it('should clear dragged widget', () => {
        widgetStore.setDraggedWidget('widget-1');
        widgetStore.setDraggedWidget(null);

        expect(widgetStore.getState().draggedWidgetId).toBeNull();
      });
    });
  });

  describe('Reset', () => {
    describe('resetToDefault', () => {
      it('should reset layout to defaults', () => {
        widgetStore.removeWidget(widgetStore.getAllWidgets()[0].id);
        widgetStore.setColumns(2);

        widgetStore.resetToDefault();

        expect(widgetStore.getAllWidgets().length).toBe(8);
        expect(widgetStore.getState().layout.columns).toBe(4);
      });
    });
  });

  describe('Available Widget Types', () => {
    describe('getAvailableWidgetTypes', () => {
      it('should return available widget types', () => {
        const types = widgetStore.getAvailableWidgetTypes();

        expect(types.length).toBeGreaterThan(0);
        expect(types.every(t => t.type && t.label && t.description)).toBe(true);
      });

      it('should include all expected types', () => {
        const types = widgetStore.getAvailableWidgetTypes();
        const typeNames = types.map(t => t.type);

        expect(typeNames).toContain('stats');
        expect(typeNames).toContain('activity');
        expect(typeNames).toContain('quick-actions');
        expect(typeNames).toContain('chart');
        expect(typeNames).toContain('custom');
      });
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      widgetStore.subscribe(subscriber);

      widgetStore.setColumns(3);

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = widgetStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      widgetStore.setColumns(3);

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Persistence', () => {
    it('should save layout to storage on changes', () => {
      widgetStore.setColumns(3);

      expect(mockStorage['widget']).toBeDefined();
      expect(mockStorage['widget'].columns).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle adding many widgets', () => {
      for (let i = 0; i < 50; i++) {
        widgetStore.addWidget({
          id: `widget-${i}`,
          type: 'custom',
          title: `Widget ${i}`,
          size: 'sm',
          visible: true,
        });
      }

      expect(widgetStore.getAllWidgets().length).toBe(58); // 8 default + 50 new
    });

    it('should maintain order consistency after multiple operations', () => {
      widgetStore.reorderWidgets(0, 3);
      widgetStore.reorderWidgets(2, 5);
      widgetStore.removeWidget(widgetStore.getAllWidgets()[1].id);

      const widgets = widgetStore.getAllWidgets();
      const orders = widgets.map(w => w.order);
      const uniqueOrders = new Set(orders);

      // Each widget should have unique order
      expect(orders.length).toBe(uniqueOrders.size);
    });
  });
});
