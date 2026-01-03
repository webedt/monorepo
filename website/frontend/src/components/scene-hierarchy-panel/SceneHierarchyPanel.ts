/**
 * SceneHierarchyPanel Component
 * Displays the hierarchy tree of scene objects with selection and z-order indicators
 *
 * Accessibility features:
 * - WAI-ARIA tree pattern with role="tree" and role="treeitem"
 * - Keyboard navigation: Arrow keys, Home, End, Enter/Space
 * - Type-ahead find for quick navigation
 * - Screen reader announcements for selection changes
 */

import { Component } from '../base/Component';
import { sceneStore } from '../../stores/sceneStore';
import { TreeKeyboardNav, statusAnnouncer, generateId } from '../../lib/accessibility';

import './scene-hierarchy-panel.css';

import type { SceneObject } from '../../stores/sceneStore';

export interface SceneHierarchyPanelOptions {
  onObjectSelect?: (objectId: string) => void;
  onAddObject?: () => void;
}

export class SceneHierarchyPanel extends Component {
  private options: SceneHierarchyPanelOptions;
  private selectedObjectId: string | null = null;
  private unsubscribeStore: (() => void) | null = null;
  private treeNav: TreeKeyboardNav | null = null;
  private treeId: string;

  constructor(options: SceneHierarchyPanelOptions = {}) {
    super('aside', { className: 'hierarchy-panel' });
    this.options = options;
    this.treeId = generateId('hierarchy-tree');
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
    if (this.treeNav) {
      this.treeNav.destroy();
      this.treeNav = null;
    }
  }

  render(): this {
    this.element.innerHTML = `
      <div class="panel-header">
        <h2 class="panel-title" id="${this.treeId}-label">Hierarchy</h2>
        <button class="add-object-btn" aria-label="Add new object to scene" title="Add Object">+</button>
      </div>
      <div class="hierarchy-tree" role="tree" aria-labelledby="${this.treeId}-label" id="${this.treeId}">
        <div class="hierarchy-empty" role="status">
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

    // Use event delegation for hierarchy items to avoid memory leak
    const treeContainer = this.element.querySelector('.hierarchy-tree');
    if (treeContainer) {
      this.on(treeContainer, 'click', (e) => {
        const target = e.target as HTMLElement;
        const hierarchyItem = target.closest('.hierarchy-item') as HTMLElement | null;
        if (hierarchyItem) {
          const objectId = hierarchyItem.dataset.id;
          if (objectId) {
            this.selectedObjectId = objectId;
            this.updateHierarchy();
            this.options.onObjectSelect?.(objectId);
          }
        }
      });
    }
  }

  private updateHierarchy(): void {
    const treeContainer = this.element.querySelector('.hierarchy-tree') as HTMLElement;
    if (!treeContainer) return;

    const activeScene = sceneStore.getActiveScene();
    const objects = activeScene?.objects || [];

    // Clean up old tree navigation
    if (this.treeNav) {
      this.treeNav.destroy();
      this.treeNav = null;
    }

    if (objects.length === 0) {
      treeContainer.innerHTML = `
        <div class="hierarchy-empty" role="status">
          <p>No objects in scene</p>
          <p class="hint">Add sprites, shapes, text, or UI components</p>
        </div>
      `;
      return;
    }

    // Sort by zIndex in descending order (highest z-index at top of list = front of scene)
    const sortedObjects = [...objects].sort((a, b) => b.zIndex - a.zIndex);

    const items = sortedObjects.map((obj, index) => {
      const isSelected = obj.id === this.selectedObjectId;
      const objectType = this.getObjectTypeLabel(obj);
      const visibilityLabel = obj.visible ? 'Visible' : 'Hidden';
      const lockedLabel = obj.locked ? ', Locked' : '';

      return `
      <div class="hierarchy-item ${isSelected ? 'selected' : ''}"
           data-id="${this.escapeHtml(obj.id)}"
           role="treeitem"
           aria-selected="${isSelected}"
           aria-label="${this.escapeHtml(obj.name)}, ${objectType}, Z-index ${obj.zIndex}, ${visibilityLabel}${lockedLabel}"
           tabindex="${index === 0 ? '0' : '-1'}">
        <button type="button" class="hierarchy-visibility" aria-label="${obj.visible ? 'Hide' : 'Show'} ${this.escapeHtml(obj.name)}" aria-pressed="${obj.visible}">${obj.visible ? '👁' : '👁‍🗨'}</button>
        <span class="hierarchy-icon" aria-hidden="true">${this.getObjectIcon(obj)}</span>
        <span class="hierarchy-name">${this.escapeHtml(obj.name)}</span>
        <span class="hierarchy-z-index" aria-hidden="true" title="Z-Index: ${obj.zIndex}">[${obj.zIndex}]</span>
        ${obj.locked ? '<span class="hierarchy-locked" aria-hidden="true">🔒</span>' : ''}
      </div>
    `;
    }).join('');

    treeContainer.innerHTML = items;

    // Initialize keyboard navigation for tree
    this.treeNav = new TreeKeyboardNav({
      container: treeContainer,
      itemSelector: '.hierarchy-item',
      onSelect: (element) => {
        const objectId = element.dataset.id;
        if (objectId) {
          this.selectedObjectId = objectId;
          this.updateHierarchy();
          this.options.onObjectSelect?.(objectId);
          // Announce selection to screen readers
          const name = element.querySelector('.hierarchy-name')?.textContent || 'Object';
          statusAnnouncer.announce(`${name} selected`);
        }
      },
    });
    this.treeNav.init();
  }

  private getObjectTypeLabel(obj: SceneObject): string {
    switch (obj.type) {
      case 'sprite': return 'Sprite';
      case 'shape': return `Shape (${obj.shapeType || 'unknown'})`;
      case 'text': return 'Text';
      case 'group': return 'Group';
      case 'ui-button': return 'UI Button';
      case 'ui-panel': return 'UI Panel';
      case 'ui-text': return 'UI Text';
      case 'ui-image': return 'UI Image';
      case 'ui-slider': return 'UI Slider';
      case 'ui-progress-bar': return 'Progress Bar';
      case 'ui-checkbox': return 'Checkbox';
      case 'custom': return 'Custom Object';
      default: return 'Object';
    }
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
