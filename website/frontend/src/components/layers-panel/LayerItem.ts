/**
 * Layer Item Component
 * Represents a single layer in the layers panel
 */

import { Component } from '../base/Component';
import type { Layer, BlendMode } from '../../stores/imageLayersStore';

export interface LayerItemOptions {
  layer: Layer;
  isActive: boolean;
  onSelect: (layerId: string) => void;
  onToggleVisibility: (layerId: string) => void;
  onToggleLock: (layerId: string) => void;
  onRename: (layerId: string, name: string) => void;
  onOpacityChange: (layerId: string, opacity: number) => void;
  onDelete: (layerId: string) => void;
  onDuplicate: (layerId: string) => void;
  onMoveUp: (layerId: string) => void;
  onMoveDown: (layerId: string) => void;
  onMergeDown: (layerId: string) => void;
  onBlendModeChange: (layerId: string, blendMode: BlendMode) => void;
}

export class LayerItem extends Component {
  private options: LayerItemOptions;
  private isEditing = false;
  private thumbnailCanvas: HTMLCanvasElement | null = null;
  private static readonly THUMBNAIL_SIZE = 32;

  constructor(options: LayerItemOptions) {
    super('div', { className: 'layer-item' });
    this.options = options;
    this.render();
  }

  /**
   * Update the thumbnail canvas with current layer content.
   * Reuses the existing canvas element to avoid DOM recreation.
   */
  private updateThumbnail(): void {
    const { layer } = this.options;
    const size = LayerItem.THUMBNAIL_SIZE;

    // Create thumbnail canvas only once
    if (!this.thumbnailCanvas) {
      this.thumbnailCanvas = document.createElement('canvas');
      this.thumbnailCanvas.width = size;
      this.thumbnailCanvas.height = size;
      this.thumbnailCanvas.className = 'layer-thumbnail';
    }

    const ctx = this.thumbnailCanvas.getContext('2d');
    if (ctx && layer.canvas) {
      // Clear and draw checkerboard pattern for transparency
      const tileSize = 4;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#cccccc';
      for (let y = 0; y < size; y += tileSize) {
        for (let x = 0; x < size; x += tileSize) {
          if ((x / tileSize + y / tileSize) % 2 === 0) {
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
      }

      // Draw scaled layer content
      ctx.drawImage(layer.canvas, 0, 0, layer.canvas.width, layer.canvas.height, 0, 0, size, size);
    }
  }

  render(): this {
    const { layer, isActive } = this.options;

    this.element.className = `layer-item ${isActive ? 'active' : ''} ${layer.locked ? 'locked' : ''}`;
    this.element.setAttribute('data-layer-id', layer.id);

    // Update thumbnail content (reuses cached canvas)
    this.updateThumbnail();

    this.element.innerHTML = `
      <button class="layer-visibility-btn" title="${layer.visible ? 'Hide layer' : 'Show layer'}">
        ${layer.visible ? '👁' : '👁‍🗨'}
      </button>
      <div class="layer-thumbnail-container"></div>
      <div class="layer-info">
        <span class="layer-name"></span>
        <span class="layer-opacity-badge">${Math.round(layer.opacity * 100)}%</span>
      </div>
      <button class="layer-lock-btn" title="${layer.locked ? 'Unlock layer' : 'Lock layer'}">
        ${layer.locked ? '🔒' : '🔓'}
      </button>
      <button class="layer-menu-btn" title="Layer options">⋮</button>
    `;

    // Set layer name using textContent to prevent XSS
    const nameEl = this.element.querySelector('.layer-name') as HTMLElement;
    if (nameEl) {
      nameEl.textContent = layer.name;
      nameEl.title = layer.name;
    }

    // Insert cached thumbnail canvas
    const thumbnailContainer = this.element.querySelector('.layer-thumbnail-container');
    if (thumbnailContainer && this.thumbnailCanvas) {
      thumbnailContainer.appendChild(this.thumbnailCanvas);
    }

    this.setupEventListeners();
    return this;
  }

  private setupEventListeners(): void {
    const { layer, onSelect, onToggleVisibility, onToggleLock } = this.options;

    // Select layer on click
    this.on('click', (e) => {
      const target = e.target as HTMLElement;
      // Don't select when clicking buttons
      if (!target.closest('button')) {
        onSelect(layer.id);
      }
    });

    // Double-click to edit name
    const nameEl = this.element.querySelector('.layer-name');
    if (nameEl) {
      this.on(nameEl, 'dblclick', () => this.startEditing());
    }

    // Visibility toggle
    const visBtn = this.element.querySelector('.layer-visibility-btn');
    if (visBtn) {
      this.on(visBtn, 'click', (e) => {
        e.stopPropagation();
        onToggleVisibility(layer.id);
      });
    }

    // Lock toggle
    const lockBtn = this.element.querySelector('.layer-lock-btn');
    if (lockBtn) {
      this.on(lockBtn, 'click', (e) => {
        e.stopPropagation();
        onToggleLock(layer.id);
      });
    }

    // Menu button
    const menuBtn = this.element.querySelector('.layer-menu-btn');
    if (menuBtn) {
      this.on(menuBtn, 'click', (e) => {
        e.stopPropagation();
        this.showContextMenu(e as MouseEvent);
      });
    }

    // Right-click context menu
    this.on('contextmenu', (e) => {
      e.preventDefault();
      this.showContextMenu(e as MouseEvent);
    });
  }

  private startEditing(): void {
    if (this.isEditing) return;
    this.isEditing = true;

    const nameEl = this.element.querySelector('.layer-name');
    if (!nameEl) return;

    const currentName = this.options.layer.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-name-input';
    input.value = currentName;

    nameEl.replaceWith(input);
    input.focus();
    input.select();

    const finishEditing = () => {
      if (!this.isEditing) return;
      this.isEditing = false;

      const newName = input.value.trim() || currentName;
      if (newName !== currentName) {
        this.options.onRename(this.options.layer.id, newName);
      }

      const newNameEl = document.createElement('span');
      newNameEl.className = 'layer-name';
      newNameEl.textContent = newName;
      newNameEl.title = newName;
      input.replaceWith(newNameEl);

      // Re-add double-click listener
      this.on(newNameEl, 'dblclick', () => this.startEditing());
    };

    input.addEventListener('blur', finishEditing);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finishEditing();
      } else if (e.key === 'Escape') {
        input.value = currentName;
        finishEditing();
      }
    });
  }

  private showContextMenu(e: MouseEvent): void {
    const { layer, onDelete, onDuplicate, onMoveUp, onMoveDown, onMergeDown, onOpacityChange, onBlendModeChange } =
      this.options;

    // Remove any existing context menu
    const existingMenu = document.querySelector('.layer-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    const menu = document.createElement('div');
    menu.className = 'layer-context-menu';
    menu.innerHTML = `
      <div class="context-menu-section">
        <label class="context-menu-label">Opacity</label>
        <input type="range" class="opacity-slider" min="0" max="100" value="${Math.round(layer.opacity * 100)}">
        <span class="opacity-value">${Math.round(layer.opacity * 100)}%</span>
      </div>
      <div class="context-menu-section">
        <label class="context-menu-label">Blend Mode</label>
        <select class="blend-mode-select">
          <option value="normal" ${layer.blendMode === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="multiply" ${layer.blendMode === 'multiply' ? 'selected' : ''}>Multiply</option>
          <option value="screen" ${layer.blendMode === 'screen' ? 'selected' : ''}>Screen</option>
          <option value="overlay" ${layer.blendMode === 'overlay' ? 'selected' : ''}>Overlay</option>
          <option value="darken" ${layer.blendMode === 'darken' ? 'selected' : ''}>Darken</option>
          <option value="lighten" ${layer.blendMode === 'lighten' ? 'selected' : ''}>Lighten</option>
          <option value="color-dodge" ${layer.blendMode === 'color-dodge' ? 'selected' : ''}>Color Dodge</option>
          <option value="color-burn" ${layer.blendMode === 'color-burn' ? 'selected' : ''}>Color Burn</option>
          <option value="difference" ${layer.blendMode === 'difference' ? 'selected' : ''}>Difference</option>
        </select>
      </div>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" data-action="duplicate">Duplicate Layer</button>
      <button class="context-menu-item" data-action="rename">Rename Layer</button>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item" data-action="move-up">Move Up</button>
      <button class="context-menu-item" data-action="move-down">Move Down</button>
      <button class="context-menu-item" data-action="merge-down">Merge Down</button>
      <div class="context-menu-divider"></div>
      <button class="context-menu-item context-menu-item--danger" data-action="delete">Delete Layer</button>
    `;

    // Position menu
    menu.style.position = 'fixed';
    menu.style.left = `${e.clientX}px`;
    menu.style.top = `${e.clientY}px`;
    menu.style.zIndex = '10000';

    document.body.appendChild(menu);

    // Adjust position if off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 10}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 10}px`;
    }

    // Opacity slider
    const opacitySlider = menu.querySelector('.opacity-slider') as HTMLInputElement;
    const opacityValue = menu.querySelector('.opacity-value') as HTMLElement;
    if (opacitySlider) {
      opacitySlider.addEventListener('input', () => {
        const value = parseInt(opacitySlider.value);
        if (opacityValue) {
          opacityValue.textContent = `${value}%`;
        }
        onOpacityChange(layer.id, value / 100);
      });
    }

    // Blend mode select
    const blendSelect = menu.querySelector('.blend-mode-select') as HTMLSelectElement;
    if (blendSelect) {
      blendSelect.addEventListener('change', () => {
        onBlendModeChange(layer.id, blendSelect.value as BlendMode);
      });
    }

    // Menu item actions
    menu.addEventListener('click', (evt) => {
      const target = evt.target as HTMLElement;
      const action = target.dataset.action;

      if (!action) return;

      switch (action) {
        case 'duplicate':
          onDuplicate(layer.id);
          break;
        case 'rename':
          this.startEditing();
          break;
        case 'move-up':
          onMoveUp(layer.id);
          break;
        case 'move-down':
          onMoveDown(layer.id);
          break;
        case 'merge-down':
          onMergeDown(layer.id);
          break;
        case 'delete':
          onDelete(layer.id);
          break;
      }

      menu.remove();
    });

    // Close menu on outside click
    const closeMenu = (evt: MouseEvent) => {
      // Check if menu still exists in DOM before removing
      if (menu.parentNode && !menu.contains(evt.target as Node)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };

    // Delay adding click listener to prevent immediate close
    requestAnimationFrame(() => {
      document.addEventListener('click', closeMenu);
    });
  }

  update(options: Partial<LayerItemOptions>): void {
    Object.assign(this.options, options);
    this.render();
  }
}
