/**
 * Scene Tabs Component
 * Tab-based UI for switching between multiple open scenes
 */

import { Component } from '../base';
import { sceneStore } from '../../stores/sceneStore';

import type { Scene } from '../../stores/sceneStore';

export interface SceneTabsOptions {
  onSceneSelect?: (sceneId: string) => void;
  onSceneClose?: (sceneId: string) => void;
  onSceneCreate?: () => void;
  onSceneRename?: (sceneId: string, newName: string) => void;
}

export class SceneTabs extends Component {
  private options: SceneTabsOptions;
  private unsubscribe: (() => void) | null = null;
  private renamingSceneId: string | null = null;
  private boundDocumentClickHandler: ((e: Event) => void) | null = null;

  constructor(options: SceneTabsOptions = {}) {
    super('div', { className: 'scene-tabs' });
    this.options = options;
    this.render();
  }

  protected onMount(): void {
    // Subscribe to store changes
    this.unsubscribe = sceneStore.subscribe(() => {
      this.render();
    });

    // Setup document click handler for closing dropdowns (only once)
    this.boundDocumentClickHandler = () => {
      const dropdown = this.element.querySelector('.scene-tabs-dropdown') as HTMLElement;
      if (dropdown) {
        dropdown.style.display = 'none';
      }
    };
    document.addEventListener('click', this.boundDocumentClickHandler);
  }

  protected onUnmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    // Remove document click handler
    if (this.boundDocumentClickHandler) {
      document.removeEventListener('click', this.boundDocumentClickHandler);
      this.boundDocumentClickHandler = null;
    }
  }

  render(): this {
    const state = sceneStore.getState();
    const openScenes = sceneStore.getOpenScenes();

    this.element.innerHTML = `
      <div class="scene-tabs-container">
        <div class="scene-tabs-scroll">
          <div class="scene-tabs-list">
            ${openScenes.map(scene => this.renderTab(scene, state.activeSceneId === scene.id)).join('')}
          </div>
        </div>
        <div class="scene-tabs-actions">
          <button class="scene-tabs-add-btn" title="Create New Scene">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <div class="scene-tabs-dropdown-container">
            <button class="scene-tabs-menu-btn" title="Scene Options">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
              </svg>
            </button>
            <div class="scene-tabs-dropdown" style="display: none;">
              <button class="scene-tabs-dropdown-item" data-action="create-ui">
                <span class="dropdown-icon">UI</span>
                <span>New UI Scene</span>
              </button>
              <button class="scene-tabs-dropdown-item" data-action="create-game">
                <span class="dropdown-icon">G</span>
                <span>New Game Scene</span>
              </button>
              <div class="scene-tabs-dropdown-separator"></div>
              <button class="scene-tabs-dropdown-item" data-action="close-all">
                <span class="dropdown-icon">X</span>
                <span>Close All Scenes</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      ${openScenes.length === 0 ? this.renderEmptyState() : ''}
    `;

    this.setupEventHandlers();
    return this;
  }

  private renderTab(scene: Scene, isActive: boolean): string {
    const isRenaming = this.renamingSceneId === scene.id;
    const dirtyIndicator = scene.isDirty ? '<span class="scene-tab-dirty">*</span>' : '';

    if (isRenaming) {
      return `
        <div class="scene-tab ${isActive ? 'active' : ''}" data-scene-id="${scene.id}">
          <input
            type="text"
            class="scene-tab-rename-input"
            value="${this.escapeHtml(scene.name)}"
            data-scene-id="${scene.id}"
          />
        </div>
      `;
    }

    return `
      <div class="scene-tab ${isActive ? 'active' : ''}" data-scene-id="${scene.id}">
        <span class="scene-tab-name" title="${this.escapeHtml(scene.name)}">${this.escapeHtml(scene.name)}${dirtyIndicator}</span>
        <button class="scene-tab-close" data-scene-id="${scene.id}" title="Close Scene">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `;
  }

  private renderEmptyState(): string {
    return `
      <div class="scene-tabs-empty">
        <p>No scenes open</p>
        <button class="scene-tabs-empty-create-btn">Create a Scene</button>
      </div>
    `;
  }

  private setupEventHandlers(): void {
    // Tab click handlers
    const tabs = this.element.querySelectorAll('.scene-tab');
    tabs.forEach(tab => {
      const tabElement = tab as HTMLElement;
      const sceneId = tabElement.dataset.sceneId;
      if (!sceneId) return;

      // Select tab on click (not on close button)
      tabElement.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.closest('.scene-tab-close')) return;
        if (target.closest('.scene-tab-rename-input')) return;

        sceneStore.setActiveScene(sceneId);
        this.options.onSceneSelect?.(sceneId);
      });

      // Double-click to rename
      const nameSpan = tabElement.querySelector('.scene-tab-name');
      if (nameSpan) {
        nameSpan.addEventListener('dblclick', () => {
          this.startRenaming(sceneId);
        });
      }
    });

    // Close button handlers
    const closeButtons = this.element.querySelectorAll('.scene-tab-close');
    closeButtons.forEach(btn => {
      const button = btn as HTMLButtonElement;
      const sceneId = button.dataset.sceneId;
      if (!sceneId) return;

      button.addEventListener('click', (e: MouseEvent) => {
        e.stopPropagation();
        this.handleCloseScene(sceneId);
      });
    });

    // Add button handler
    const addBtn = this.element.querySelector('.scene-tabs-add-btn');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        this.handleCreateScene();
      });
    }

    // Empty state create button
    const emptyCreateBtn = this.element.querySelector('.scene-tabs-empty-create-btn');
    if (emptyCreateBtn) {
      emptyCreateBtn.addEventListener('click', () => {
        this.handleCreateScene();
      });
    }

    // Menu button and dropdown
    const menuBtn = this.element.querySelector('.scene-tabs-menu-btn');
    const dropdown = this.element.querySelector('.scene-tabs-dropdown') as HTMLElement;
    if (menuBtn && dropdown) {
      menuBtn.addEventListener('click', (e: Event) => {
        e.stopPropagation();
        const isVisible = dropdown.style.display !== 'none';
        dropdown.style.display = isVisible ? 'none' : 'block';
      });

      // Note: Document click handler for closing dropdown is set up in onMount() once
      // to avoid memory leaks from adding listeners on every render

      // Dropdown item handlers
      const dropdownItems = dropdown.querySelectorAll('.scene-tabs-dropdown-item');
      dropdownItems.forEach(item => {
        const action = (item as HTMLElement).dataset.action;
        item.addEventListener('click', () => {
          dropdown.style.display = 'none';
          this.handleDropdownAction(action || '');
        });
      });
    }

    // Rename input handlers
    const renameInputs = this.element.querySelectorAll('.scene-tab-rename-input');
    renameInputs.forEach(input => {
      const inputEl = input as HTMLInputElement;
      const sceneId = inputEl.dataset.sceneId;
      if (!sceneId) return;

      inputEl.focus();
      inputEl.select();

      inputEl.addEventListener('blur', () => {
        this.finishRenaming(sceneId, inputEl.value);
      });

      inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.finishRenaming(sceneId, inputEl.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.cancelRenaming();
        }
      });
    });
  }

  private handleCreateScene(): void {
    const scene = sceneStore.createScene();
    this.options.onSceneCreate?.();
    this.options.onSceneSelect?.(scene.id);
  }

  private handleCloseScene(sceneId: string): void {
    const scene = sceneStore.getScene(sceneId);
    if (scene?.isDirty) {
      if (!confirm(`"${scene.name}" has unsaved changes. Close anyway?`)) {
        return;
      }
    }
    sceneStore.closeScene(sceneId);
    this.options.onSceneClose?.(sceneId);
  }

  private handleDropdownAction(action: string): void {
    switch (action) {
      case 'create-ui':
        sceneStore.createScene('UI Scene');
        break;
      case 'create-game':
        sceneStore.createScene('Game Scene');
        break;
      case 'close-all':
        if (sceneStore.hasUnsavedScenes()) {
          if (!confirm('Some scenes have unsaved changes. Close all anyway?')) {
            return;
          }
        }
        sceneStore.closeAllScenes();
        break;
    }
  }

  private startRenaming(sceneId: string): void {
    this.renamingSceneId = sceneId;
    this.render();
  }

  private finishRenaming(sceneId: string, newName: string): void {
    const trimmedName = newName.trim();
    if (trimmedName) {
      sceneStore.renameScene(sceneId, trimmedName);
      this.options.onSceneRename?.(sceneId, trimmedName);
    }
    this.renamingSceneId = null;
    this.render();
  }

  private cancelRenaming(): void {
    this.renamingSceneId = null;
    this.render();
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
