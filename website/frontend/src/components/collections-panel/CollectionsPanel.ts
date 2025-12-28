/**
 * Collections Panel Component
 * Sidebar panel for managing user collections/folders
 */

import { Component, ComponentOptions } from '../base';
import { Button } from '../button';
import { Input } from '../input';
import { Modal } from '../modal';
import { toast } from '../toast';
import { collectionsApi } from '../../lib/api';
import type { Collection } from '../../types';
import './collections-panel.css';

export interface CollectionsPanelOptions extends ComponentOptions {
  onCollectionSelect?: (collectionId: string | null) => void;
  onCollectionsChange?: (collections: Collection[]) => void;
}

export class CollectionsPanel extends Component<HTMLDivElement> {
  private options: CollectionsPanelOptions;
  private collections: Collection[] = [];
  private selectedCollectionId: string | null = null;
  private listContainer: HTMLDivElement;
  private isLoading = false;
  private createModal: Modal | null = null;
  private editModal: Modal | null = null;
  private createNameInput: Input | null = null;
  private createDescInput: Input | null = null;
  private editNameInput: Input | null = null;
  private editDescInput: Input | null = null;

  constructor(options: CollectionsPanelOptions = {}) {
    super('div', {
      className: 'collections-panel',
      ...options,
    });

    this.options = options;
    this.listContainer = document.createElement('div');
    this.listContainer.className = 'collections-panel__list';

    this.buildStructure();
    this.loadCollections();
  }

  private buildStructure(): void {
    // Header
    const header = document.createElement('div');
    header.className = 'collections-panel__header';
    header.innerHTML = `
      <h3 class="collections-panel__title">Collections</h3>
    `;

    const addButton = document.createElement('button');
    addButton.className = 'collections-panel__add-btn';
    addButton.type = 'button';
    addButton.title = 'Create new collection';
    addButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
    `;
    this.on(addButton, 'click', () => this.showCreateModal());
    header.appendChild(addButton);

    this.element.appendChild(header);
    this.element.appendChild(this.listContainer);
  }

  private async loadCollections(): Promise<void> {
    if (this.isLoading) return;

    this.isLoading = true;
    this.listContainer.innerHTML = '<div class="collections-panel__loading">Loading...</div>';

    try {
      const result = await collectionsApi.list();
      this.collections = result.collections;
      this.renderList();
      this.options.onCollectionsChange?.(this.collections);
    } catch (error) {
      console.error('Failed to load collections:', error);
      this.listContainer.innerHTML = '<div class="collections-panel__error">Failed to load collections</div>';
    } finally {
      this.isLoading = false;
    }
  }

  private renderList(): void {
    this.listContainer.innerHTML = '';

    // "All Sessions" option
    const allItem = document.createElement('div');
    allItem.className = `collections-panel__item ${this.selectedCollectionId === null ? 'collections-panel__item--selected' : ''}`;
    allItem.innerHTML = `
      <span class="collections-panel__item-icon">
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>
      </span>
      <span class="collections-panel__item-name">All Sessions</span>
    `;
    this.on(allItem, 'click', () => this.selectCollection(null));
    this.listContainer.appendChild(allItem);

    // Collection items
    for (const collection of this.collections) {
      const item = this.createCollectionItem(collection);
      this.listContainer.appendChild(item);
    }

    // Empty state
    if (this.collections.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'collections-panel__empty';
      empty.textContent = 'No collections yet';
      this.listContainer.appendChild(empty);
    }
  }

  private createCollectionItem(collection: Collection): HTMLElement {
    const item = document.createElement('div');
    item.className = `collections-panel__item ${this.selectedCollectionId === collection.id ? 'collections-panel__item--selected' : ''}`;
    item.dataset.collectionId = collection.id;

    const iconColor = collection.color || 'var(--color-text-secondary)';
    const iconSvg = this.getIconSvg(collection.icon);

    item.innerHTML = `
      <span class="collections-panel__item-icon" style="color: ${iconColor}">
        ${iconSvg}
      </span>
      <span class="collections-panel__item-name">${this.escapeHtml(collection.name)}</span>
      <span class="collections-panel__item-count">${collection.sessionCount ?? 0}</span>
      <div class="collections-panel__item-actions">
        <button class="collections-panel__item-btn collections-panel__item-btn--edit" type="button" title="Edit collection">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
          </svg>
        </button>
        <button class="collections-panel__item-btn collections-panel__item-btn--delete" type="button" title="Delete collection">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
          </svg>
        </button>
      </div>
    `;

    // Main click to select
    this.on(item, 'click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.collections-panel__item-actions')) {
        this.selectCollection(collection.id);
      }
    });

    // Edit button
    const editBtn = item.querySelector('.collections-panel__item-btn--edit');
    if (editBtn) {
      this.on(editBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        this.showEditModal(collection);
      });
    }

    // Delete button
    const deleteBtn = item.querySelector('.collections-panel__item-btn--delete');
    if (deleteBtn) {
      this.on(deleteBtn as HTMLElement, 'click', (e) => {
        e.stopPropagation();
        this.deleteCollection(collection);
      });
    }

    return item;
  }

  private getIconSvg(icon?: string): string {
    switch (icon) {
      case 'star':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>`;
      case 'code':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="16 18 22 12 16 6"></polyline>
          <polyline points="8 6 2 12 8 18"></polyline>
        </svg>`;
      case 'bookmark':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>
        </svg>`;
      case 'archive':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="21 8 21 21 3 21 3 8"></polyline>
          <rect x="1" y="3" width="22" height="5"></rect>
          <line x1="10" y1="12" x2="14" y2="12"></line>
        </svg>`;
      case 'folder':
      default:
        return `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
        </svg>`;
    }
  }

  private selectCollection(collectionId: string | null): void {
    this.selectedCollectionId = collectionId;
    this.renderList();
    this.options.onCollectionSelect?.(collectionId);
  }

  private showCreateModal(): void {
    if (this.createModal) {
      this.createModal.unmount();
    }

    const content = document.createElement('div');
    content.className = 'collections-panel__modal-content';
    content.innerHTML = `
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Name</label>
        <div class="collections-panel__input-container" data-input="name"></div>
      </div>
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Description (optional)</label>
        <div class="collections-panel__input-container" data-input="description"></div>
      </div>
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Color</label>
        <div class="collections-panel__color-picker">
          <button type="button" class="collections-panel__color-btn" data-color="#6366f1" style="background-color: #6366f1"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#22c55e" style="background-color: #22c55e"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#f59e0b" style="background-color: #f59e0b"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#ef4444" style="background-color: #ef4444"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#8b5cf6" style="background-color: #8b5cf6"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#06b6d4" style="background-color: #06b6d4"></button>
        </div>
      </div>
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Icon</label>
        <div class="collections-panel__icon-picker">
          <button type="button" class="collections-panel__icon-btn collections-panel__icon-btn--selected" data-icon="folder">
            ${this.getIconSvg('folder')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="star">
            ${this.getIconSvg('star')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="code">
            ${this.getIconSvg('code')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="bookmark">
            ${this.getIconSvg('bookmark')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="archive">
            ${this.getIconSvg('archive')}
          </button>
        </div>
      </div>
    `;

    // Create inputs
    const nameContainer = content.querySelector('[data-input="name"]') as HTMLElement;
    this.createNameInput = new Input({ placeholder: 'Collection name...' });
    this.createNameInput.mount(nameContainer);

    const descContainer = content.querySelector('[data-input="description"]') as HTMLElement;
    this.createDescInput = new Input({ placeholder: 'Optional description...' });
    this.createDescInput.mount(descContainer);

    let selectedColor = '#6366f1';
    let selectedIcon = 'folder';

    // Color picker
    const colorBtns = content.querySelectorAll('.collections-panel__color-btn');
    colorBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        colorBtns.forEach((b) => b.classList.remove('collections-panel__color-btn--selected'));
        btn.classList.add('collections-panel__color-btn--selected');
        selectedColor = (btn as HTMLElement).dataset.color || '#6366f1';
      });
    });
    // Select first color by default
    colorBtns[0]?.classList.add('collections-panel__color-btn--selected');

    // Icon picker
    const iconBtns = content.querySelectorAll('.collections-panel__icon-btn');
    iconBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        iconBtns.forEach((b) => b.classList.remove('collections-panel__icon-btn--selected'));
        btn.classList.add('collections-panel__icon-btn--selected');
        selectedIcon = (btn as HTMLElement).dataset.icon || 'folder';
      });
    });

    this.createModal = new Modal({
      title: 'Create Collection',
    });

    this.createModal.setBody(content);
    this.createModal.addFooterAction(
      new Button('Cancel', {
        variant: 'secondary',
        onClick: () => this.createModal?.close(),
      })
    );
    this.createModal.addFooterAction(
      new Button('Create', {
        variant: 'primary',
        onClick: async () => {
          const name = this.createNameInput?.getValue()?.trim();
          if (!name) {
            toast.error('Collection name is required');
            return;
          }

          try {
            await collectionsApi.create({
              name,
              description: this.createDescInput?.getValue()?.trim() || undefined,
              color: selectedColor,
              icon: selectedIcon,
            });
            toast.success('Collection created');
            this.createModal?.close();
            this.loadCollections();
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create collection';
            toast.error(message);
          }
        },
      })
    );

    this.createModal.mount(document.body);
    this.createModal.open();
  }

  private showEditModal(collection: Collection): void {
    if (this.editModal) {
      this.editModal.unmount();
    }

    const content = document.createElement('div');
    content.className = 'collections-panel__modal-content';
    content.innerHTML = `
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Name</label>
        <div class="collections-panel__input-container" data-input="name"></div>
      </div>
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Description (optional)</label>
        <div class="collections-panel__input-container" data-input="description"></div>
      </div>
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Color</label>
        <div class="collections-panel__color-picker">
          <button type="button" class="collections-panel__color-btn" data-color="#6366f1" style="background-color: #6366f1"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#22c55e" style="background-color: #22c55e"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#f59e0b" style="background-color: #f59e0b"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#ef4444" style="background-color: #ef4444"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#8b5cf6" style="background-color: #8b5cf6"></button>
          <button type="button" class="collections-panel__color-btn" data-color="#06b6d4" style="background-color: #06b6d4"></button>
        </div>
      </div>
      <div class="collections-panel__form-group">
        <label class="collections-panel__label">Icon</label>
        <div class="collections-panel__icon-picker">
          <button type="button" class="collections-panel__icon-btn" data-icon="folder">
            ${this.getIconSvg('folder')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="star">
            ${this.getIconSvg('star')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="code">
            ${this.getIconSvg('code')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="bookmark">
            ${this.getIconSvg('bookmark')}
          </button>
          <button type="button" class="collections-panel__icon-btn" data-icon="archive">
            ${this.getIconSvg('archive')}
          </button>
        </div>
      </div>
    `;

    // Create inputs with existing values
    const nameContainer = content.querySelector('[data-input="name"]') as HTMLElement;
    this.editNameInput = new Input({ placeholder: 'Collection name...' });
    this.editNameInput.mount(nameContainer);
    this.editNameInput.setValue(collection.name);

    const descContainer = content.querySelector('[data-input="description"]') as HTMLElement;
    this.editDescInput = new Input({ placeholder: 'Optional description...' });
    this.editDescInput.mount(descContainer);
    if (collection.description) {
      this.editDescInput.setValue(collection.description);
    }

    let selectedColor = collection.color || '#6366f1';
    let selectedIcon = collection.icon || 'folder';

    // Color picker
    const colorBtns = content.querySelectorAll('.collections-panel__color-btn');
    colorBtns.forEach((btn) => {
      const btnColor = (btn as HTMLElement).dataset.color;
      if (btnColor === selectedColor) {
        btn.classList.add('collections-panel__color-btn--selected');
      }
      btn.addEventListener('click', () => {
        colorBtns.forEach((b) => b.classList.remove('collections-panel__color-btn--selected'));
        btn.classList.add('collections-panel__color-btn--selected');
        selectedColor = btnColor || '#6366f1';
      });
    });

    // Icon picker
    const iconBtns = content.querySelectorAll('.collections-panel__icon-btn');
    iconBtns.forEach((btn) => {
      const btnIcon = (btn as HTMLElement).dataset.icon;
      if (btnIcon === selectedIcon) {
        btn.classList.add('collections-panel__icon-btn--selected');
      }
      btn.addEventListener('click', () => {
        iconBtns.forEach((b) => b.classList.remove('collections-panel__icon-btn--selected'));
        btn.classList.add('collections-panel__icon-btn--selected');
        selectedIcon = btnIcon || 'folder';
      });
    });

    this.editModal = new Modal({
      title: 'Edit Collection',
    });

    this.editModal.setBody(content);
    this.editModal.addFooterAction(
      new Button('Cancel', {
        variant: 'secondary',
        onClick: () => this.editModal?.close(),
      })
    );
    this.editModal.addFooterAction(
      new Button('Save', {
        variant: 'primary',
        onClick: async () => {
          const name = this.editNameInput?.getValue()?.trim();
          if (!name) {
            toast.error('Collection name is required');
            return;
          }

          try {
            await collectionsApi.update(collection.id, {
              name,
              description: this.editDescInput?.getValue()?.trim() || undefined,
              color: selectedColor,
              icon: selectedIcon,
            });
            toast.success('Collection updated');
            this.editModal?.close();
            this.loadCollections();
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update collection';
            toast.error(message);
          }
        },
      })
    );

    this.editModal.mount(document.body);
    this.editModal.open();
  }

  private async deleteCollection(collection: Collection): Promise<void> {
    if (!confirm(`Delete collection "${collection.name}"? Sessions in this collection will not be deleted.`)) {
      return;
    }

    try {
      await collectionsApi.delete(collection.id);
      toast.success('Collection deleted');

      // If deleted collection was selected, clear selection
      if (this.selectedCollectionId === collection.id) {
        this.selectCollection(null);
      }

      this.loadCollections();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete collection';
      toast.error(message);
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getSelectedCollectionId(): string | null {
    return this.selectedCollectionId;
  }

  getCollections(): Collection[] {
    return this.collections;
  }

  refresh(): void {
    this.loadCollections();
  }

  protected onUnmount(): void {
    this.createModal?.unmount();
    this.editModal?.unmount();
    this.createNameInput?.unmount();
    this.createDescInput?.unmount();
    this.editNameInput?.unmount();
    this.editDescInput?.unmount();
  }
}
