/**
 * Image Layers Store
 * State management for multi-layer image editing
 */

import { Store } from '../lib/store';
import { exportToOra } from '../lib/export/oraExporter';
import { exportToPsd } from '../lib/export/psdExporter';

import type { ExportFormat } from '../lib/export';

/**
 * Blend mode for layer compositing
 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion';

/**
 * Layer interface representing a single layer in the image
 */
export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  canvas: HTMLCanvasElement; // Each layer has its own canvas
}

/**
 * Image layers state
 */
interface ImageLayersState {
  layers: Layer[];
  activeLayerId: string | null;
  selectedLayerIds: Set<string>;
  width: number;
  height: number;
}

/**
 * Generate unique layer ID
 */
function generateLayerId(): string {
  return `layer-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a new layer canvas
 */
function createLayerCanvas(width: number, height: number, fillColor?: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  if (fillColor) {
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = fillColor;
      ctx.fillRect(0, 0, width, height);
    }
  }

  return canvas;
}

/**
 * Create the image layers store
 */
function createImageLayersStore() {
  const store = new Store<ImageLayersState>({
    layers: [],
    activeLayerId: null,
    selectedLayerIds: new Set(),
    width: 800,
    height: 600,
  });

  return {
    // Expose Store methods directly
    getState: () => store.getState(),
    setState: (partial: Partial<ImageLayersState> | ((state: ImageLayersState) => Partial<ImageLayersState>)) =>
      store.setState(partial),
    subscribe: (subscriber: (state: ImageLayersState, prevState: ImageLayersState) => void) =>
      store.subscribe(subscriber),

    /**
     * Initialize canvas with default background layer
     */
    initialize(width: number, height: number): void {
      const backgroundLayer: Layer = {
        id: generateLayerId(),
        name: 'Background',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        canvas: createLayerCanvas(width, height, '#ffffff'),
      };

      store.setState({
        layers: [backgroundLayer],
        activeLayerId: backgroundLayer.id,
        selectedLayerIds: new Set([backgroundLayer.id]),
        width,
        height,
      });
    },

    /**
     * Reset store to initial state
     */
    clear(): void {
      const state = store.getState();
      // Clean up canvas references
      for (const layer of state.layers) {
        layer.canvas.width = 0;
        layer.canvas.height = 0;
      }
      store.setState({
        layers: [],
        activeLayerId: null,
        selectedLayerIds: new Set(),
      });
    },

    /**
     * Add a new layer above the active layer
     */
    addLayer(name?: string): Layer {
      const state = store.getState();
      const newLayer: Layer = {
        id: generateLayerId(),
        name: name || `Layer ${state.layers.length + 1}`,
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        canvas: createLayerCanvas(state.width, state.height),
      };

      // Insert above active layer or at top
      const activeIndex = state.layers.findIndex((l) => l.id === state.activeLayerId);
      const insertIndex = activeIndex >= 0 ? activeIndex + 1 : state.layers.length;

      const newLayers = [...state.layers];
      newLayers.splice(insertIndex, 0, newLayer);

      store.setState({
        layers: newLayers,
        activeLayerId: newLayer.id,
        selectedLayerIds: new Set([newLayer.id]),
      });

      return newLayer;
    },

    /**
     * Delete a layer by ID
     */
    deleteLayer(layerId: string): boolean {
      const state = store.getState();

      // Cannot delete the last layer
      if (state.layers.length <= 1) {
        return false;
      }

      const layerIndex = state.layers.findIndex((l) => l.id === layerId);
      if (layerIndex === -1) {
        return false;
      }

      // Clean up canvas
      const layer = state.layers[layerIndex];
      layer.canvas.width = 0;
      layer.canvas.height = 0;

      const newLayers = state.layers.filter((l) => l.id !== layerId);

      // Update active layer if needed
      let newActiveId = state.activeLayerId;
      if (state.activeLayerId === layerId) {
        // Select the layer below, or above if deleting bottom layer
        const newIndex = Math.min(layerIndex, newLayers.length - 1);
        newActiveId = newLayers[newIndex]?.id || null;
      }

      // Update selection
      const newSelection = new Set(state.selectedLayerIds);
      newSelection.delete(layerId);
      if (newSelection.size === 0 && newActiveId) {
        newSelection.add(newActiveId);
      }

      store.setState({
        layers: newLayers,
        activeLayerId: newActiveId,
        selectedLayerIds: newSelection,
      });

      return true;
    },

    /**
     * Duplicate a layer
     */
    duplicateLayer(layerId: string): Layer | null {
      const state = store.getState();
      const sourceLayer = state.layers.find((l) => l.id === layerId);

      if (!sourceLayer) {
        return null;
      }

      // Create new canvas with copied content
      const newCanvas = createLayerCanvas(state.width, state.height);
      const ctx = newCanvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(sourceLayer.canvas, 0, 0);
      }

      const newLayer: Layer = {
        id: generateLayerId(),
        name: `${sourceLayer.name} copy`,
        visible: sourceLayer.visible,
        locked: false,
        opacity: sourceLayer.opacity,
        blendMode: sourceLayer.blendMode,
        canvas: newCanvas,
      };

      // Insert above source layer
      const sourceIndex = state.layers.findIndex((l) => l.id === layerId);
      const newLayers = [...state.layers];
      newLayers.splice(sourceIndex + 1, 0, newLayer);

      store.setState({
        layers: newLayers,
        activeLayerId: newLayer.id,
        selectedLayerIds: new Set([newLayer.id]),
      });

      return newLayer;
    },

    /**
     * Move layer up in the stack (higher z-index)
     */
    moveLayerUp(layerId: string): boolean {
      const state = store.getState();
      const index = state.layers.findIndex((l) => l.id === layerId);

      if (index === -1 || index >= state.layers.length - 1) {
        return false;
      }

      const newLayers = [...state.layers];
      [newLayers[index], newLayers[index + 1]] = [newLayers[index + 1], newLayers[index]];

      store.setState({ layers: newLayers });
      return true;
    },

    /**
     * Move layer down in the stack (lower z-index)
     */
    moveLayerDown(layerId: string): boolean {
      const state = store.getState();
      const index = state.layers.findIndex((l) => l.id === layerId);

      if (index <= 0) {
        return false;
      }

      const newLayers = [...state.layers];
      [newLayers[index], newLayers[index - 1]] = [newLayers[index - 1], newLayers[index]];

      store.setState({ layers: newLayers });
      return true;
    },

    /**
     * Set active layer
     * Note: Locked layers can be selected (for viewing), but drawing operations
     * should check isActiveLayerLocked() before modifying
     */
    setActiveLayer(layerId: string): void {
      const state = store.getState();
      const layer = state.layers.find((l) => l.id === layerId);

      if (layer) {
        store.setState({
          activeLayerId: layerId,
          selectedLayerIds: new Set([layerId]),
        });
      }
    },

    /**
     * Check if the active layer is locked
     */
    isActiveLayerLocked(): boolean {
      const activeLayer = this.getActiveLayer();
      return activeLayer?.locked ?? false;
    },

    /**
     * Toggle layer visibility
     */
    toggleLayerVisibility(layerId: string): void {
      const state = store.getState();
      const newLayers = state.layers.map((l) => (l.id === layerId ? { ...l, visible: !l.visible } : l));
      store.setState({ layers: newLayers });
    },

    /**
     * Toggle layer lock
     */
    toggleLayerLock(layerId: string): void {
      const state = store.getState();
      const newLayers = state.layers.map((l) => (l.id === layerId ? { ...l, locked: !l.locked } : l));
      store.setState({ layers: newLayers });
    },

    /**
     * Set layer opacity
     */
    setLayerOpacity(layerId: string, opacity: number): void {
      const state = store.getState();
      const clampedOpacity = Math.max(0, Math.min(1, opacity));
      const newLayers = state.layers.map((l) => (l.id === layerId ? { ...l, opacity: clampedOpacity } : l));
      store.setState({ layers: newLayers });
    },

    /**
     * Set layer blend mode
     */
    setLayerBlendMode(layerId: string, blendMode: BlendMode): void {
      const state = store.getState();
      const newLayers = state.layers.map((l) => (l.id === layerId ? { ...l, blendMode } : l));
      store.setState({ layers: newLayers });
    },

    /**
     * Rename layer
     */
    renameLayer(layerId: string, name: string): void {
      const state = store.getState();
      const newLayers = state.layers.map((l) => (l.id === layerId ? { ...l, name } : l));
      store.setState({ layers: newLayers });
    },

    /**
     * Merge layer down into the layer below
     */
    mergeLayerDown(layerId: string): boolean {
      const state = store.getState();
      const index = state.layers.findIndex((l) => l.id === layerId);

      if (index <= 0) {
        return false;
      }

      const topLayer = state.layers[index];
      const bottomLayer = state.layers[index - 1];

      // Draw top layer onto bottom layer
      const ctx = bottomLayer.canvas.getContext('2d');
      if (ctx) {
        ctx.globalAlpha = topLayer.opacity;
        ctx.globalCompositeOperation = topLayer.blendMode === 'normal' ? 'source-over' : topLayer.blendMode;
        ctx.drawImage(topLayer.canvas, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // Clean up top layer canvas
      topLayer.canvas.width = 0;
      topLayer.canvas.height = 0;

      // Remove top layer
      const newLayers = state.layers.filter((l) => l.id !== layerId);

      store.setState({
        layers: newLayers,
        activeLayerId: bottomLayer.id,
        selectedLayerIds: new Set([bottomLayer.id]),
      });

      return true;
    },

    /**
     * Flatten all layers into one
     */
    flattenAllLayers(): void {
      const state = store.getState();

      if (state.layers.length <= 1) {
        return;
      }

      // Create new canvas for flattened result
      const flatCanvas = createLayerCanvas(state.width, state.height, '#ffffff');
      const ctx = flatCanvas.getContext('2d');

      if (ctx) {
        // Composite all visible layers from bottom to top
        for (const layer of state.layers) {
          if (layer.visible) {
            ctx.globalAlpha = layer.opacity;
            ctx.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode;
            ctx.drawImage(layer.canvas, 0, 0);
          }
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }

      // Clean up all layer canvases
      for (const layer of state.layers) {
        layer.canvas.width = 0;
        layer.canvas.height = 0;
      }

      const flatLayer: Layer = {
        id: generateLayerId(),
        name: 'Flattened',
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: 'normal',
        canvas: flatCanvas,
      };

      store.setState({
        layers: [flatLayer],
        activeLayerId: flatLayer.id,
        selectedLayerIds: new Set([flatLayer.id]),
      });
    },

    /**
     * Get the active layer
     */
    getActiveLayer(): Layer | null {
      const state = store.getState();
      return state.layers.find((l) => l.id === state.activeLayerId) || null;
    },

    /**
     * Get the active layer's canvas context
     */
    getActiveContext(): CanvasRenderingContext2D | null {
      const activeLayer = this.getActiveLayer();
      return activeLayer?.canvas.getContext('2d') || null;
    },

    /**
     * Get layer by ID
     */
    getLayer(layerId: string): Layer | null {
      const state = store.getState();
      return state.layers.find((l) => l.id === layerId) || null;
    },

    /**
     * Composite all layers to a destination canvas
     */
    compositeToCanvas(destinationCanvas: HTMLCanvasElement): void {
      const state = store.getState();
      const ctx = destinationCanvas.getContext('2d');

      if (!ctx) {
        return;
      }

      // Clear destination
      ctx.clearRect(0, 0, destinationCanvas.width, destinationCanvas.height);

      // Draw layers from bottom to top
      for (const layer of state.layers) {
        if (!layer.visible) {
          continue;
        }

        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = layer.blendMode === 'normal' ? 'source-over' : layer.blendMode;
        ctx.drawImage(layer.canvas, 0, 0);
      }

      // Reset context
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    },

    /**
     * Resize all layers
     */
    resizeLayers(newWidth: number, newHeight: number): void {
      const state = store.getState();

      const resizedLayers = state.layers.map((layer) => {
        const newCanvas = createLayerCanvas(newWidth, newHeight);
        const ctx = newCanvas.getContext('2d');

        if (ctx) {
          // Draw existing content (will be cropped or have empty space)
          ctx.drawImage(layer.canvas, 0, 0);
        }

        // Clean up old canvas
        layer.canvas.width = 0;
        layer.canvas.height = 0;

        return {
          ...layer,
          canvas: newCanvas,
        };
      });

      store.setState({
        layers: resizedLayers,
        width: newWidth,
        height: newHeight,
      });
    },

    /**
     * Load image data into the active layer
     */
    loadImageToActiveLayer(image: HTMLImageElement | HTMLCanvasElement): void {
      const activeLayer = this.getActiveLayer();
      if (!activeLayer) {
        return;
      }

      const ctx = activeLayer.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
        ctx.drawImage(image, 0, 0);
      }
    },

    /**
     * Load ImageData into the active layer (for frame-based animation)
     */
    loadImageDataToActiveLayer(imageData: ImageData): void {
      const activeLayer = this.getActiveLayer();
      if (!activeLayer) {
        return;
      }

      const ctx = activeLayer.canvas.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, activeLayer.canvas.width, activeLayer.canvas.height);
        ctx.putImageData(imageData, 0, 0);
      }
    },

    /**
     * Get composite image as data URL
     */
    getCompositeDataURL(type = 'image/png', quality?: number): string {
      const state = store.getState();
      const tempCanvas = createLayerCanvas(state.width, state.height);
      this.compositeToCanvas(tempCanvas);
      const dataURL = tempCanvas.toDataURL(type, quality);

      // Clean up temp canvas
      tempCanvas.width = 0;
      tempCanvas.height = 0;

      return dataURL;
    },

    /**
     * Get composite image as blob
     */
    async getCompositeBlob(type = 'image/png', quality?: number): Promise<Blob | null> {
      const state = store.getState();
      const tempCanvas = createLayerCanvas(state.width, state.height);
      this.compositeToCanvas(tempCanvas);

      return new Promise((resolve) => {
        tempCanvas.toBlob(
          (blob) => {
            // Clean up temp canvas
            tempCanvas.width = 0;
            tempCanvas.height = 0;
            resolve(blob);
          },
          type,
          quality
        );
      });
    },

    /**
     * Export image in the specified format
     * Supports: png, jpg, ora (OpenRaster), psd (Photoshop)
     */
    async exportAs(format: ExportFormat, quality?: number): Promise<Blob | null> {
      const state = store.getState();

      // Create composite canvas for merged image
      const compositeCanvas = createLayerCanvas(state.width, state.height);
      this.compositeToCanvas(compositeCanvas);

      let result: Blob | null = null;

      try {
        switch (format) {
          case 'png':
            result = await this.getCompositeBlob('image/png');
            break;

          case 'jpg':
            result = await this.getCompositeBlob('image/jpeg', quality ?? 0.92);
            break;

          case 'ora':
            result = await exportToOra(
              state.layers,
              state.width,
              state.height,
              compositeCanvas
            );
            break;

          case 'psd':
            result = exportToPsd(
              state.layers,
              state.width,
              state.height,
              compositeCanvas
            );
            break;

          default:
            console.warn(`Unknown export format: ${format}`);
            result = await this.getCompositeBlob('image/png');
        }
      } finally {
        // Clean up composite canvas
        compositeCanvas.width = 0;
        compositeCanvas.height = 0;
      }

      return result;
    },

    /**
     * Export as ORA (OpenRaster) format
     * Preserves layers, opacity, blend modes, and visibility
     */
    async exportAsOra(): Promise<Blob> {
      const state = store.getState();
      const compositeCanvas = createLayerCanvas(state.width, state.height);
      this.compositeToCanvas(compositeCanvas);

      try {
        return await exportToOra(
          state.layers,
          state.width,
          state.height,
          compositeCanvas
        );
      } finally {
        compositeCanvas.width = 0;
        compositeCanvas.height = 0;
      }
    },

    /**
     * Export as PSD (Photoshop) format
     * Preserves layers, opacity, blend modes, and visibility
     */
    exportAsPsd(): Blob {
      const state = store.getState();
      const compositeCanvas = createLayerCanvas(state.width, state.height);
      this.compositeToCanvas(compositeCanvas);

      try {
        return exportToPsd(
          state.layers,
          state.width,
          state.height,
          compositeCanvas
        );
      } finally {
        compositeCanvas.width = 0;
        compositeCanvas.height = 0;
      }
    },
  };
}

// Export singleton store instance
export const imageLayersStore = createImageLayersStore();
