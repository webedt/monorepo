/**
 * Tests for ImageLayersStore
 * Covers multi-layer image editing state management including layer CRUD,
 * ordering, visibility, blend modes, and compositing operations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock canvas and 2D context
const mockContext2D = {
  fillStyle: '',
  fillRect: vi.fn(),
  drawImage: vi.fn(),
  clearRect: vi.fn(),
  putImageData: vi.fn(),
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
};

const createMockCanvas = () => ({
  width: 800,
  height: 600,
  getContext: vi.fn(() => mockContext2D),
  toDataURL: vi.fn(() => 'data:image/png;base64,mock'),
  toBlob: vi.fn((callback: (blob: Blob | null) => void) => {
    callback(new Blob(['mock'], { type: 'image/png' }));
  }),
});

vi.stubGlobal('document', {
  createElement: vi.fn((tag: string) => {
    if (tag === 'canvas') {
      return createMockCanvas();
    }
    return {};
  }),
});

// Mock export functions
vi.mock('../../src/lib/export/oraExporter', () => ({
  exportToOra: vi.fn().mockResolvedValue(new Blob(['ora'], { type: 'application/zip' })),
}));

vi.mock('../../src/lib/export/psdExporter', () => ({
  exportToPsd: vi.fn().mockReturnValue(new Blob(['psd'], { type: 'image/vnd.adobe.photoshop' })),
}));

// Import after mocks are set up
import { imageLayersStore } from '../../src/stores/imageLayersStore';

import type { BlendMode } from '../../src/stores/imageLayersStore';

describe('ImageLayersStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageLayersStore.clear();
  });

  afterEach(() => {
    imageLayersStore.clear();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = imageLayersStore.getState();

      expect(state.layers).toEqual([]);
      expect(state.activeLayerId).toBeNull();
      expect(state.selectedLayerIds).toBeInstanceOf(Set);
      expect(state.selectedLayerIds.size).toBe(0);
      expect(state.width).toBe(800);
      expect(state.height).toBe(600);
    });

    it('should return null for getActiveLayer when no layers exist', () => {
      expect(imageLayersStore.getActiveLayer()).toBeNull();
    });

    it('should return null for getActiveContext when no layers exist', () => {
      expect(imageLayersStore.getActiveContext()).toBeNull();
    });
  });

  describe('Initialize', () => {
    it('should initialize with a background layer', () => {
      imageLayersStore.initialize(1024, 768);

      const state = imageLayersStore.getState();
      expect(state.layers.length).toBe(1);
      expect(state.layers[0].name).toBe('Background');
      expect(state.layers[0].visible).toBe(true);
      expect(state.layers[0].locked).toBe(false);
      expect(state.layers[0].opacity).toBe(1);
      expect(state.layers[0].blendMode).toBe('normal');
      expect(state.width).toBe(1024);
      expect(state.height).toBe(768);
    });

    it('should set the background layer as active', () => {
      imageLayersStore.initialize(800, 600);

      const state = imageLayersStore.getState();
      expect(state.activeLayerId).toBe(state.layers[0].id);
      expect(state.selectedLayerIds.has(state.layers[0].id)).toBe(true);
    });
  });

  describe('Layer CRUD', () => {
    beforeEach(() => {
      imageLayersStore.initialize(800, 600);
    });

    describe('addLayer', () => {
      it('should add a new layer above the active layer', () => {
        const newLayer = imageLayersStore.addLayer('New Layer');

        const state = imageLayersStore.getState();
        expect(state.layers.length).toBe(2);
        expect(state.layers[1].name).toBe('New Layer');
        expect(newLayer.id).toBe(state.layers[1].id);
      });

      it('should auto-generate layer name if not provided', () => {
        const newLayer = imageLayersStore.addLayer();

        expect(newLayer.name).toBe('Layer 2');
      });

      it('should set the new layer as active', () => {
        const newLayer = imageLayersStore.addLayer('Test Layer');

        const state = imageLayersStore.getState();
        expect(state.activeLayerId).toBe(newLayer.id);
        expect(state.selectedLayerIds.has(newLayer.id)).toBe(true);
      });

      it('should create layer with default properties', () => {
        const newLayer = imageLayersStore.addLayer();

        expect(newLayer.visible).toBe(true);
        expect(newLayer.locked).toBe(false);
        expect(newLayer.opacity).toBe(1);
        expect(newLayer.blendMode).toBe('normal');
      });
    });

    describe('deleteLayer', () => {
      it('should delete a layer', () => {
        const layer1 = imageLayersStore.addLayer('Layer 1');
        const initialCount = imageLayersStore.getState().layers.length;

        const result = imageLayersStore.deleteLayer(layer1.id);

        expect(result).toBe(true);
        expect(imageLayersStore.getState().layers.length).toBe(initialCount - 1);
      });

      it('should not delete the last layer', () => {
        const state = imageLayersStore.getState();
        const backgroundId = state.layers[0].id;

        const result = imageLayersStore.deleteLayer(backgroundId);

        expect(result).toBe(false);
        expect(imageLayersStore.getState().layers.length).toBe(1);
      });

      it('should update active layer when deleting active', () => {
        const layer1 = imageLayersStore.addLayer('Layer 1');
        imageLayersStore.setActiveLayer(layer1.id);

        imageLayersStore.deleteLayer(layer1.id);

        const state = imageLayersStore.getState();
        expect(state.activeLayerId).not.toBe(layer1.id);
        expect(state.activeLayerId).not.toBeNull();
      });

      it('should return false for non-existent layer', () => {
        const result = imageLayersStore.deleteLayer('non-existent');
        expect(result).toBe(false);
      });
    });

    describe('duplicateLayer', () => {
      it('should duplicate a layer', () => {
        const original = imageLayersStore.getState().layers[0];

        const duplicate = imageLayersStore.duplicateLayer(original.id);

        expect(duplicate).not.toBeNull();
        expect(duplicate!.name).toBe('Background copy');
        expect(duplicate!.id).not.toBe(original.id);
      });

      it('should copy layer properties except lock', () => {
        const original = imageLayersStore.getState().layers[0];
        imageLayersStore.setLayerOpacity(original.id, 0.5);
        imageLayersStore.setLayerBlendMode(original.id, 'multiply');

        const duplicate = imageLayersStore.duplicateLayer(original.id);

        expect(duplicate!.opacity).toBe(0.5);
        expect(duplicate!.blendMode).toBe('multiply');
        expect(duplicate!.locked).toBe(false);
      });

      it('should return null for non-existent layer', () => {
        const result = imageLayersStore.duplicateLayer('non-existent');
        expect(result).toBeNull();
      });
    });

    describe('renameLayer', () => {
      it('should rename a layer', () => {
        const layer = imageLayersStore.getState().layers[0];

        imageLayersStore.renameLayer(layer.id, 'Renamed Layer');

        expect(imageLayersStore.getLayer(layer.id)?.name).toBe('Renamed Layer');
      });
    });
  });

  describe('Layer Ordering', () => {
    beforeEach(() => {
      imageLayersStore.initialize(800, 600);
      imageLayersStore.addLayer('Layer 1');
      imageLayersStore.addLayer('Layer 2');
    });

    describe('moveLayerUp', () => {
      it('should move layer up in the stack', () => {
        const state = imageLayersStore.getState();
        const layer1Id = state.layers[1].id;

        const result = imageLayersStore.moveLayerUp(layer1Id);

        expect(result).toBe(true);
        const newState = imageLayersStore.getState();
        expect(newState.layers[2].id).toBe(layer1Id);
      });

      it('should return false when layer is already at top', () => {
        const state = imageLayersStore.getState();
        const topLayerId = state.layers[state.layers.length - 1].id;

        const result = imageLayersStore.moveLayerUp(topLayerId);

        expect(result).toBe(false);
      });

      it('should return false for non-existent layer', () => {
        const result = imageLayersStore.moveLayerUp('non-existent');
        expect(result).toBe(false);
      });
    });

    describe('moveLayerDown', () => {
      it('should move layer down in the stack', () => {
        const state = imageLayersStore.getState();
        const layer2Id = state.layers[2].id;

        const result = imageLayersStore.moveLayerDown(layer2Id);

        expect(result).toBe(true);
        const newState = imageLayersStore.getState();
        expect(newState.layers[1].id).toBe(layer2Id);
      });

      it('should return false when layer is already at bottom', () => {
        const state = imageLayersStore.getState();
        const bottomLayerId = state.layers[0].id;

        const result = imageLayersStore.moveLayerDown(bottomLayerId);

        expect(result).toBe(false);
      });
    });
  });

  describe('Layer Properties', () => {
    beforeEach(() => {
      imageLayersStore.initialize(800, 600);
    });

    describe('setActiveLayer', () => {
      it('should set a layer as active', () => {
        const layer = imageLayersStore.addLayer('Test');
        const backgroundId = imageLayersStore.getState().layers[0].id;

        imageLayersStore.setActiveLayer(backgroundId);

        const state = imageLayersStore.getState();
        expect(state.activeLayerId).toBe(backgroundId);
        expect(state.selectedLayerIds.has(backgroundId)).toBe(true);
      });

      it('should not change state for non-existent layer', () => {
        const originalActiveId = imageLayersStore.getState().activeLayerId;

        imageLayersStore.setActiveLayer('non-existent');

        expect(imageLayersStore.getState().activeLayerId).toBe(originalActiveId);
      });
    });

    describe('isActiveLayerLocked', () => {
      it('should return false for unlocked layer', () => {
        expect(imageLayersStore.isActiveLayerLocked()).toBe(false);
      });

      it('should return true for locked layer', () => {
        const activeId = imageLayersStore.getState().activeLayerId!;
        imageLayersStore.toggleLayerLock(activeId);

        expect(imageLayersStore.isActiveLayerLocked()).toBe(true);
      });
    });

    describe('toggleLayerVisibility', () => {
      it('should toggle layer visibility', () => {
        const layerId = imageLayersStore.getState().layers[0].id;

        imageLayersStore.toggleLayerVisibility(layerId);
        expect(imageLayersStore.getLayer(layerId)?.visible).toBe(false);

        imageLayersStore.toggleLayerVisibility(layerId);
        expect(imageLayersStore.getLayer(layerId)?.visible).toBe(true);
      });
    });

    describe('toggleLayerLock', () => {
      it('should toggle layer lock', () => {
        const layerId = imageLayersStore.getState().layers[0].id;

        imageLayersStore.toggleLayerLock(layerId);
        expect(imageLayersStore.getLayer(layerId)?.locked).toBe(true);

        imageLayersStore.toggleLayerLock(layerId);
        expect(imageLayersStore.getLayer(layerId)?.locked).toBe(false);
      });
    });

    describe('setLayerOpacity', () => {
      it('should set layer opacity', () => {
        const layerId = imageLayersStore.getState().layers[0].id;

        imageLayersStore.setLayerOpacity(layerId, 0.5);

        expect(imageLayersStore.getLayer(layerId)?.opacity).toBe(0.5);
      });

      it('should clamp opacity to valid range', () => {
        const layerId = imageLayersStore.getState().layers[0].id;

        imageLayersStore.setLayerOpacity(layerId, -0.5);
        expect(imageLayersStore.getLayer(layerId)?.opacity).toBe(0);

        imageLayersStore.setLayerOpacity(layerId, 1.5);
        expect(imageLayersStore.getLayer(layerId)?.opacity).toBe(1);
      });
    });

    describe('setLayerBlendMode', () => {
      it('should set layer blend mode', () => {
        const layerId = imageLayersStore.getState().layers[0].id;
        const blendModes: BlendMode[] = [
          'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
          'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion',
        ];

        for (const mode of blendModes) {
          imageLayersStore.setLayerBlendMode(layerId, mode);
          expect(imageLayersStore.getLayer(layerId)?.blendMode).toBe(mode);
        }
      });
    });
  });

  describe('Layer Merging', () => {
    beforeEach(() => {
      imageLayersStore.initialize(800, 600);
      imageLayersStore.addLayer('Layer 1');
      imageLayersStore.addLayer('Layer 2');
    });

    describe('mergeLayerDown', () => {
      it('should merge layer into the one below', () => {
        const state = imageLayersStore.getState();
        const topLayerId = state.layers[2].id;
        const middleLayerId = state.layers[1].id;

        const result = imageLayersStore.mergeLayerDown(topLayerId);

        expect(result).toBe(true);
        const newState = imageLayersStore.getState();
        expect(newState.layers.length).toBe(2);
        expect(newState.activeLayerId).toBe(middleLayerId);
      });

      it('should return false for bottom layer', () => {
        const state = imageLayersStore.getState();
        const bottomLayerId = state.layers[0].id;

        const result = imageLayersStore.mergeLayerDown(bottomLayerId);

        expect(result).toBe(false);
      });
    });

    describe('flattenAllLayers', () => {
      it('should flatten all layers into one', () => {
        imageLayersStore.flattenAllLayers();

        const state = imageLayersStore.getState();
        expect(state.layers.length).toBe(1);
        expect(state.layers[0].name).toBe('Flattened');
      });

      it('should do nothing with only one layer', () => {
        imageLayersStore.clear();
        imageLayersStore.initialize(800, 600);

        imageLayersStore.flattenAllLayers();

        expect(imageLayersStore.getState().layers.length).toBe(1);
        expect(imageLayersStore.getState().layers[0].name).toBe('Background');
      });
    });
  });

  describe('Canvas Operations', () => {
    beforeEach(() => {
      imageLayersStore.initialize(800, 600);
    });

    describe('resizeLayers', () => {
      it('should resize all layers', () => {
        imageLayersStore.addLayer('Layer 1');

        imageLayersStore.resizeLayers(1024, 768);

        const state = imageLayersStore.getState();
        expect(state.width).toBe(1024);
        expect(state.height).toBe(768);
      });
    });

    describe('getCompositeDataURL', () => {
      it('should return a data URL', () => {
        const dataURL = imageLayersStore.getCompositeDataURL();

        expect(dataURL).toContain('data:image/png');
      });
    });

    describe('getCompositeBlob', () => {
      it('should return a blob', async () => {
        const blob = await imageLayersStore.getCompositeBlob();

        expect(blob).toBeInstanceOf(Blob);
      });
    });
  });

  describe('Export', () => {
    beforeEach(() => {
      imageLayersStore.initialize(800, 600);
    });

    describe('exportAs', () => {
      it('should export as PNG', async () => {
        const blob = await imageLayersStore.exportAs('png');

        expect(blob).toBeInstanceOf(Blob);
      });

      it('should export as JPG', async () => {
        const blob = await imageLayersStore.exportAs('jpg', 0.8);

        expect(blob).toBeInstanceOf(Blob);
      });

      it('should export as ORA', async () => {
        const blob = await imageLayersStore.exportAs('ora');

        expect(blob).toBeInstanceOf(Blob);
      });

      it('should export as PSD', async () => {
        const blob = await imageLayersStore.exportAs('psd');

        expect(blob).toBeInstanceOf(Blob);
      });
    });
  });

  describe('Subscriptions', () => {
    beforeEach(() => {
      imageLayersStore.initialize(800, 600);
    });

    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      imageLayersStore.subscribe(subscriber);

      imageLayersStore.addLayer('Test');

      expect(subscriber).toHaveBeenCalled();
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = imageLayersStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      imageLayersStore.addLayer('Test');

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle rapid layer additions', () => {
      imageLayersStore.initialize(800, 600);

      for (let i = 0; i < 100; i++) {
        imageLayersStore.addLayer(`Layer ${i}`);
      }

      expect(imageLayersStore.getState().layers.length).toBe(101);
    });

    it('should handle clear operation', () => {
      imageLayersStore.initialize(800, 600);
      imageLayersStore.addLayer('Test');

      imageLayersStore.clear();

      const state = imageLayersStore.getState();
      expect(state.layers.length).toBe(0);
      expect(state.activeLayerId).toBeNull();
    });
  });
});
