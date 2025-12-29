/**
 * SceneHierarchyPanel Component
 * Displays the hierarchy tree of scene objects with selection and z-order indicators
 */

import { Component } from '../base/Component';
import { sceneStore } from '../../stores/sceneStore';

import type { SceneObject } from '../../stores/sceneStore';

export interface SceneHierarchyPanelOptions {
  onObjectSelect?: (objectId: string) => void;
  onAddObject?: () => void;
}

export class SceneHierarchyPanel extends Component {
  private options: SceneHierarchyPanelOptions;
  private selectedObjectId: string | null = null;
  private unsubscribeStore: (() => void) | null = null;

  constructor(options: SceneHierarchyPanelOptions = {}) {
    super('aside', { className: 'hierarchy-panel' });
    this.options = options;
  }

  protected onMount(): void {
    this.render();
    this.unsubscribeStore = sceneStore.subscribe(() => {
      this.updateHierarchy();
    });
  }

  protected onUnmount(): void {
    if (this.unsubscribeStore) {
      this.unsubscribeStore();
      this.unsubscribeStore = null;
    }
  }

  render(): this {
    this.element.innerHTML = `
      <div class="panel-header">
        <span class="panel-title">Hierarchy</span>
        <button class="add-object-btn" title="Add Object">+</button>
      </div>
      <div class="hierarchy-tree">
        <div class="hierarchy-empty">
          <p>No objects in scene</p>
          <p class="hint">Add sprites, shapes, or text</p>
        </div>
      </div>
    `;

    this.setupEventListeners();
    this.updateHierarchy();
    return this;
  }

  private setupEventListeners(): void {
    const addBtn = this.element.querySelector('.add-object-btn');
    if (addBtn) {
      this.on(addBtn, 'click', () => {
        this.options.onAddObject?.();
      });
    }
  }

  private updateHierarchy(): void {
    const treeContainer = this.element.querySelector('.hierarchy-tree') as HTMLElement;
    if (!treeContainer) return;

    const activeScene = sceneStore.getActiveScene();
    const objects = activeScene?.objects || [];

    if (objects.length === 0) {
      treeContainer.innerHTML = `
        <div class="hierarchy-empty">
          <p>No objects in scene</p>
          <p class="hint">Add sprites, shapes, text, or UI components</p>
        </div>
      `;
      return;
    }

    // Sort by zIndex in descending order (highest z-index at top of list = front of scene)
    const sortedObjects = [...objects].sort((a, b) => b.zIndex - a.zIndex);

    const items = sortedObjects.map(obj => `
      <div class="hierarchy-item ${obj.id === this.selectedObjectId ? 'selected' : ''}" data-id="${this.escapeHtml(obj.id)}">
        <span class="hierarchy-visibility">${obj.visible ? '👁' : '👁‍🗨'}</span>
        <span class="hierarchy-icon">${this.getObjectIcon(obj)}</span>
        <span class="hierarchy-name">${this.escapeHtml(obj.name)}</span>
        <span class="hierarchy-z-index" title="Z-Index: ${obj.zIndex}">[${obj.zIndex}]</span>
        ${obj.locked ? '<span class="hierarchy-locked">🔒</span>' : ''}
      </div>
    `).join('');

    treeContainer.innerHTML = items;

    // Add click handlers
    treeContainer.querySelectorAll('.hierarchy-item').forEach(item => {
      this.on(item, 'click', () => {
        const objectId = (item as HTMLElement).dataset.id;
        if (objectId) {
          this.selectedObjectId = objectId;
          this.updateHierarchy();
          this.options.onObjectSelect?.(objectId);
        }
      });
    });
  }

  private getObjectIcon(obj: SceneObject): string {
    switch (obj.type) {
      case 'sprite': return '🖼';
      case 'shape':
        switch (obj.shapeType) {
          case 'rectangle': return '⬜';
          case 'circle': return '⭕';
          default: return '◆';
        }
      case 'text': return '📝';
      case 'group': return '📁';
      case 'ui-button': return '🔘';
      case 'ui-panel': return '🪟';
      case 'ui-text': return '🔤';
      case 'ui-image': return '🖼️';
      case 'ui-slider': return '🎚️';
      case 'ui-progress-bar': return '📊';
      case 'ui-checkbox': return '☑️';
      case 'custom': return '📦';
      default: return '◻';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Public API
  setSelectedObject(objectId: string | null): void {
    this.selectedObjectId = objectId;
    this.updateHierarchy();
  }

  getSelectedObject(): string | null {
    return this.selectedObjectId;
  }

  refresh(): void {
    this.updateHierarchy();
  }
}
