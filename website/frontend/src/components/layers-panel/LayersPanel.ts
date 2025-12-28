/**
 * Layers Panel Component
 * Manages the layer list UI for the image editor
 */

import { Component } from '../base/Component';
import { LayerItem } from './LayerItem';
import { imageLayersStore } from '../../stores/imageLayersStore';

export interface LayersPanelOptions {
  onLayerChange?: () => void;
}

export class LayersPanel extends Component {
  private options: LayersPanelOptions;
  private layerItems: Map<string, LayerItem> = new Map();
  private unsubscribe: (() => void) | null = null;

  constructor(options: LayersPanelOptions = {}) {
    super('aside', { className: 'layers-panel' });
    this.options = options;
  }

  protected onMount(): void {
    this.render();
    this.unsubscribe = imageLayersStore.subscribe(() => {
      this.renderLayers();
      this.options.onLayerChange?.();
    });
  }

  protected onUnmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Clean up layer items
    for (const item of this.layerItems.values()) {
      item.unmount();
    }
    this.layerItems.clear();
  }

  render(): this {
    this.element.innerHTML = `
      <div class="layers-header">
        <span class="layers-title">Layers</span>
        <div class="layers-header-actions">
          <button class="layer-action-btn" data-action="add" title="Add Layer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <button class="layer-action-btn" data-action="delete" title="Delete Layer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="layers-toolbar">
        <button class="layer-toolbar-btn" data-action="move-up" title="Move Layer Up">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
        </button>
        <button class="layer-toolbar-btn" data-action="move-down" title="Move Layer Down">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
        <button class="layer-toolbar-btn" data-action="duplicate" title="Duplicate Layer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <button class="layer-toolbar-btn" data-action="merge" title="Merge Down">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M8 6l4 4 4-4"></path>
            <path d="M12 2v8"></path>
            <rect x="4" y="14" width="16" height="8" rx="2"></rect>
          </svg>
        </button>
        <button class="layer-toolbar-btn" data-action="flatten" title="Flatten All">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <rect x="3" y="3" width="18" height="18" rx="2"></rect>
            <line x1="3" y1="9" x2="21" y2="9"></line>
            <line x1="3" y1="15" x2="21" y2="15"></line>
          </svg>
        </button>
      </div>
      <div class="layers-list"></div>
    `;

    this.setupEventListeners();
    this.renderLayers();
    return this;
  }

  private setupEventListeners(): void {
    // Header actions
    const addBtn = this.element.querySelector('[data-action="add"]');
    if (addBtn) {
      this.on(addBtn, 'click', () => {
        imageLayersStore.addLayer();
      });
    }

    const deleteBtn = this.element.querySelector('[data-action="delete"]');
    if (deleteBtn) {
      this.on(deleteBtn, 'click', () => {
        const state = imageLayersStore.getState();
        if (state.activeLayerId) {
          imageLayersStore.deleteLayer(state.activeLayerId);
        }
      });
    }

    // Toolbar actions
    const moveUpBtn = this.element.querySelector('[data-action="move-up"]');
    if (moveUpBtn) {
      this.on(moveUpBtn, 'click', () => {
        const state = imageLayersStore.getState();
        if (state.activeLayerId) {
          imageLayersStore.moveLayerUp(state.activeLayerId);
        }
      });
    }

    const moveDownBtn = this.element.querySelector('[data-action="move-down"]');
    if (moveDownBtn) {
      this.on(moveDownBtn, 'click', () => {
        const state = imageLayersStore.getState();
        if (state.activeLayerId) {
          imageLayersStore.moveLayerDown(state.activeLayerId);
        }
      });
    }

    const duplicateBtn = this.element.querySelector('[data-action="duplicate"]');
    if (duplicateBtn) {
      this.on(duplicateBtn, 'click', () => {
        const state = imageLayersStore.getState();
        if (state.activeLayerId) {
          imageLayersStore.duplicateLayer(state.activeLayerId);
        }
      });
    }

    const mergeBtn = this.element.querySelector('[data-action="merge"]');
    if (mergeBtn) {
      this.on(mergeBtn, 'click', () => {
        const state = imageLayersStore.getState();
        if (state.activeLayerId) {
          imageLayersStore.mergeLayerDown(state.activeLayerId);
        }
      });
    }

    const flattenBtn = this.element.querySelector('[data-action="flatten"]');
    if (flattenBtn) {
      this.on(flattenBtn, 'click', () => {
        if (confirm('Flatten all layers? This cannot be undone.')) {
          imageLayersStore.flattenAllLayers();
        }
      });
    }
  }

  private renderLayers(): void {
    const listEl = this.element.querySelector('.layers-list');
    if (!listEl) return;

    const state = imageLayersStore.getState();
    const currentIds = new Set(state.layers.map((l) => l.id));

    // Remove items for deleted layers
    for (const [id, item] of this.layerItems) {
      if (!currentIds.has(id)) {
        item.unmount();
        this.layerItems.delete(id);
      }
    }

    // Clear list and re-render in correct order (top to bottom = end to start)
    listEl.innerHTML = '';

    // Render layers from top to bottom (reverse order)
    for (let i = state.layers.length - 1; i >= 0; i--) {
      const layer = state.layers[i];
      let item = this.layerItems.get(layer.id);

      if (item) {
        // Update existing item
        item.update({
          layer,
          isActive: layer.id === state.activeLayerId,
        });
      } else {
        // Create new item
        item = new LayerItem({
          layer,
          isActive: layer.id === state.activeLayerId,
          onSelect: (id) => imageLayersStore.setActiveLayer(id),
          onToggleVisibility: (id) => imageLayersStore.toggleLayerVisibility(id),
          onToggleLock: (id) => imageLayersStore.toggleLayerLock(id),
          onRename: (id, name) => imageLayersStore.renameLayer(id, name),
          onOpacityChange: (id, opacity) => imageLayersStore.setLayerOpacity(id, opacity),
          onDelete: (id) => imageLayersStore.deleteLayer(id),
          onDuplicate: (id) => imageLayersStore.duplicateLayer(id),
          onMoveUp: (id) => imageLayersStore.moveLayerUp(id),
          onMoveDown: (id) => imageLayersStore.moveLayerDown(id),
          onMergeDown: (id) => imageLayersStore.mergeLayerDown(id),
          onBlendModeChange: (id, blendMode) => imageLayersStore.setLayerBlendMode(id, blendMode),
        });
        this.layerItems.set(layer.id, item);
      }

      listEl.appendChild(item.getElement());
    }
  }

  /**
   * Get current layer count
   */
  getLayerCount(): number {
    return imageLayersStore.getState().layers.length;
  }
}
