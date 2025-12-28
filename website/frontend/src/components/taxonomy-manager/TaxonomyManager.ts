/**
 * TaxonomyManager Component
 * Admin UI for managing taxonomies, terms, and item assignments
 */

import { Component } from '../base';
import { Button, Input, Modal, toast, confirm } from '../../components';
import { taxonomyApi } from '../../lib/api';
import type { Taxonomy, TaxonomyTerm } from '../../types';
import './taxonomy-manager.css';

export interface TaxonomyManagerOptions {
  onTaxonomySelect?: (taxonomy: Taxonomy) => void;
}

export class TaxonomyManager extends Component {
  private options: TaxonomyManagerOptions;
  private taxonomies: Taxonomy[] = [];
  private selectedTaxonomy: Taxonomy | null = null;
  private terms: TaxonomyTerm[] = [];
  private loading = false;
  private components: Component[] = [];

  constructor(options: TaxonomyManagerOptions = {}) {
    super('div', { className: 'taxonomy-manager' });
    this.options = options;
    this.render();
    this.loadTaxonomies();
  }

  private async loadTaxonomies(): Promise<void> {
    this.loading = true;
    this.render();

    try {
      this.taxonomies = await taxonomyApi.list();
    } catch (error) {
      toast.error('Failed to load taxonomies');
      console.error('Error loading taxonomies:', error);
    }

    this.loading = false;
    this.render();
  }

  private async loadTerms(taxonomyId: string): Promise<void> {
    try {
      this.terms = await taxonomyApi.getTerms(taxonomyId);
      this.render();
    } catch (error) {
      toast.error('Failed to load terms');
      console.error('Error loading terms:', error);
    }
  }

  private async selectTaxonomy(taxonomy: Taxonomy): Promise<void> {
    this.selectedTaxonomy = taxonomy;
    await this.loadTerms(taxonomy.id);
    this.options.onTaxonomySelect?.(taxonomy);
  }

  private showCreateTaxonomyModal(): void {
    const modal = new Modal({
      title: 'Create Taxonomy',
      size: 'md',
    });

    const form = document.createElement('div');
    form.className = 'taxonomy-form';
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">Internal Name</label>
        <div class="name-input"></div>
        <p class="form-hint">Lowercase identifier (e.g., "genre", "category")</p>
      </div>
      <div class="form-group">
        <label class="form-label">Display Name</label>
        <div class="display-name-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <div class="description-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Item Types (comma-separated)</label>
        <div class="item-types-input"></div>
        <p class="form-hint">e.g., "game, post, session"</p>
      </div>
      <div class="form-group checkbox-group">
        <label class="checkbox-label">
          <input type="checkbox" class="allow-multiple-checkbox" checked>
          Allow multiple terms per item
        </label>
      </div>
      <div class="form-group checkbox-group">
        <label class="checkbox-label">
          <input type="checkbox" class="is-required-checkbox">
          Required (items must have at least one term)
        </label>
      </div>
    `;

    const nameInput = new Input({ placeholder: 'genre' });
    nameInput.mount(form.querySelector('.name-input') as HTMLElement);

    const displayNameInput = new Input({ placeholder: 'Genre' });
    displayNameInput.mount(form.querySelector('.display-name-input') as HTMLElement);

    const descriptionInput = new Input({ placeholder: 'Categories for organizing content' });
    descriptionInput.mount(form.querySelector('.description-input') as HTMLElement);

    const itemTypesInput = new Input({ placeholder: 'game, post' });
    itemTypesInput.mount(form.querySelector('.item-types-input') as HTMLElement);

    const allowMultipleCheckbox = form.querySelector('.allow-multiple-checkbox') as HTMLInputElement;
    const isRequiredCheckbox = form.querySelector('.is-required-checkbox') as HTMLInputElement;

    modal.setBody(form);

    const footerEl = modal.footer();
    footerEl.className = 'modal-footer modal-actions';

    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => modal.close(),
    });
    cancelBtn.mount(footerEl);

    const createBtn = new Button('Create', {
      variant: 'primary',
      onClick: async () => {
        const name = nameInput.getValue().trim();
        const displayName = displayNameInput.getValue().trim();

        if (!name || !displayName) {
          toast.error('Name and display name are required');
          return;
        }

        try {
          const taxonomy = await taxonomyApi.create({
            name,
            displayName,
            description: descriptionInput.getValue().trim() || undefined,
            itemTypes: itemTypesInput.getValue().split(',').map(s => s.trim()).filter(Boolean),
            allowMultiple: allowMultipleCheckbox.checked,
            isRequired: isRequiredCheckbox.checked,
          });
          this.taxonomies.push(taxonomy);
          toast.success('Taxonomy created');
          modal.close();
          this.render();
        } catch (error) {
          toast.error('Failed to create taxonomy');
          console.error('Error creating taxonomy:', error);
        }
      },
    });
    createBtn.mount(footerEl);

    modal.open();
    this.components.push(modal);
  }

  private showEditTaxonomyModal(taxonomy: Taxonomy): void {
    const modal = new Modal({
      title: 'Edit Taxonomy',
      size: 'md',
    });

    const form = document.createElement('div');
    form.className = 'taxonomy-form';
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">Internal Name</label>
        <p class="form-value">${taxonomy.name}</p>
      </div>
      <div class="form-group">
        <label class="form-label">Display Name</label>
        <div class="display-name-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <div class="description-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Item Types (comma-separated)</label>
        <div class="item-types-input"></div>
      </div>
      <div class="form-group checkbox-group">
        <label class="checkbox-label">
          <input type="checkbox" class="allow-multiple-checkbox" ${taxonomy.allowMultiple ? 'checked' : ''}>
          Allow multiple terms per item
        </label>
      </div>
      <div class="form-group checkbox-group">
        <label class="checkbox-label">
          <input type="checkbox" class="is-required-checkbox" ${taxonomy.isRequired ? 'checked' : ''}>
          Required
        </label>
      </div>
    `;

    const displayNameInput = new Input({ placeholder: 'Genre', value: taxonomy.displayName });
    displayNameInput.mount(form.querySelector('.display-name-input') as HTMLElement);

    const descriptionInput = new Input({ placeholder: 'Description', value: taxonomy.description || '' });
    descriptionInput.mount(form.querySelector('.description-input') as HTMLElement);

    const itemTypesInput = new Input({ placeholder: 'game, post', value: taxonomy.itemTypes?.join(', ') || '' });
    itemTypesInput.mount(form.querySelector('.item-types-input') as HTMLElement);

    const allowMultipleCheckbox = form.querySelector('.allow-multiple-checkbox') as HTMLInputElement;
    const isRequiredCheckbox = form.querySelector('.is-required-checkbox') as HTMLInputElement;

    modal.setBody(form);

    const footerEl = modal.footer();
    footerEl.className = 'modal-footer modal-actions';

    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => modal.close(),
    });
    cancelBtn.mount(footerEl);

    const saveBtn = new Button('Save', {
      variant: 'primary',
      onClick: async () => {
        try {
          const updated = await taxonomyApi.update(taxonomy.id, {
            displayName: displayNameInput.getValue().trim(),
            description: descriptionInput.getValue().trim() || undefined,
            itemTypes: itemTypesInput.getValue().split(',').map(s => s.trim()).filter(Boolean),
            allowMultiple: allowMultipleCheckbox.checked,
            isRequired: isRequiredCheckbox.checked,
          });
          const index = this.taxonomies.findIndex(t => t.id === taxonomy.id);
          if (index !== -1) {
            this.taxonomies[index] = updated;
          }
          if (this.selectedTaxonomy?.id === taxonomy.id) {
            this.selectedTaxonomy = updated;
          }
          toast.success('Taxonomy updated');
          modal.close();
          this.render();
        } catch (error) {
          toast.error('Failed to update taxonomy');
          console.error('Error updating taxonomy:', error);
        }
      },
    });
    saveBtn.mount(footerEl);

    modal.open();
    this.components.push(modal);
  }

  private async deleteTaxonomy(taxonomy: Taxonomy): Promise<void> {
    const confirmed = await confirm({
      title: 'Delete Taxonomy',
      message: `Are you sure you want to delete "${taxonomy.displayName}"? This will also delete all terms and item assignments.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });

    if (!confirmed) return;

    try {
      await taxonomyApi.delete(taxonomy.id);
      this.taxonomies = this.taxonomies.filter(t => t.id !== taxonomy.id);
      if (this.selectedTaxonomy?.id === taxonomy.id) {
        this.selectedTaxonomy = null;
        this.terms = [];
      }
      toast.success('Taxonomy deleted');
      this.render();
    } catch (error) {
      toast.error('Failed to delete taxonomy');
      console.error('Error deleting taxonomy:', error);
    }
  }

  private showCreateTermModal(): void {
    if (!this.selectedTaxonomy) return;

    const modal = new Modal({
      title: 'Add Term',
      size: 'md',
    });

    const form = document.createElement('div');
    form.className = 'taxonomy-form';
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">Name</label>
        <div class="name-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <div class="description-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Color (optional)</label>
        <div class="color-input"></div>
        <p class="form-hint">Hex color code (e.g., #FF5733)</p>
      </div>
    `;

    const nameInput = new Input({ placeholder: 'Action' });
    nameInput.mount(form.querySelector('.name-input') as HTMLElement);

    const descriptionInput = new Input({ placeholder: 'Fast-paced games with combat' });
    descriptionInput.mount(form.querySelector('.description-input') as HTMLElement);

    const colorInput = new Input({ placeholder: '#FF5733' });
    colorInput.mount(form.querySelector('.color-input') as HTMLElement);

    modal.setBody(form);

    const footerEl = modal.footer();
    footerEl.className = 'modal-footer modal-actions';

    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => modal.close(),
    });
    cancelBtn.mount(footerEl);

    const createBtn = new Button('Add', {
      variant: 'primary',
      onClick: async () => {
        const name = nameInput.getValue().trim();
        if (!name) {
          toast.error('Name is required');
          return;
        }

        try {
          const term = await taxonomyApi.createTerm(this.selectedTaxonomy!.id, {
            name,
            description: descriptionInput.getValue().trim() || undefined,
            color: colorInput.getValue().trim() || undefined,
          });
          this.terms.push(term);
          toast.success('Term added');
          modal.close();
          this.render();
        } catch (error) {
          toast.error('Failed to add term');
          console.error('Error adding term:', error);
        }
      },
    });
    createBtn.mount(footerEl);

    modal.open();
    this.components.push(modal);
  }

  private showEditTermModal(term: TaxonomyTerm): void {
    const modal = new Modal({
      title: 'Edit Term',
      size: 'md',
    });

    const form = document.createElement('div');
    form.className = 'taxonomy-form';
    form.innerHTML = `
      <div class="form-group">
        <label class="form-label">Name</label>
        <div class="name-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Description</label>
        <div class="description-input"></div>
      </div>
      <div class="form-group">
        <label class="form-label">Color</label>
        <div class="color-input"></div>
      </div>
    `;

    const nameInput = new Input({ placeholder: 'Action', value: term.name });
    nameInput.mount(form.querySelector('.name-input') as HTMLElement);

    const descriptionInput = new Input({ placeholder: 'Description', value: term.description || '' });
    descriptionInput.mount(form.querySelector('.description-input') as HTMLElement);

    const colorInput = new Input({ placeholder: '#FF5733', value: term.color || '' });
    colorInput.mount(form.querySelector('.color-input') as HTMLElement);

    modal.setBody(form);

    const footerEl = modal.footer();
    footerEl.className = 'modal-footer modal-actions';

    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => modal.close(),
    });
    cancelBtn.mount(footerEl);

    const saveBtn = new Button('Save', {
      variant: 'primary',
      onClick: async () => {
        try {
          const updated = await taxonomyApi.updateTerm(term.id, {
            name: nameInput.getValue().trim(),
            description: descriptionInput.getValue().trim() || undefined,
            color: colorInput.getValue().trim() || undefined,
          });
          const index = this.terms.findIndex(t => t.id === term.id);
          if (index !== -1) {
            this.terms[index] = updated;
          }
          toast.success('Term updated');
          modal.close();
          this.render();
        } catch (error) {
          toast.error('Failed to update term');
          console.error('Error updating term:', error);
        }
      },
    });
    saveBtn.mount(footerEl);

    modal.open();
    this.components.push(modal);
  }

  private async deleteTerm(term: TaxonomyTerm): Promise<void> {
    const confirmed = await confirm({
      title: 'Delete Term',
      message: `Are you sure you want to delete "${term.name}"? This will remove it from all items.`,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      danger: true,
    });

    if (!confirmed) return;

    try {
      await taxonomyApi.deleteTerm(term.id);
      this.terms = this.terms.filter(t => t.id !== term.id);
      toast.success('Term deleted');
      this.render();
    } catch (error) {
      toast.error('Failed to delete term');
      console.error('Error deleting term:', error);
    }
  }

  render(): this {
    // Clean up old components
    for (const comp of this.components) {
      comp.unmount();
    }
    this.components = [];

    this.element.innerHTML = `
      <div class="taxonomy-manager-layout">
        <div class="taxonomy-list-panel">
          <div class="panel-header">
            <h3 class="panel-title">Taxonomies</h3>
            <div class="create-taxonomy-btn"></div>
          </div>
          <div class="taxonomy-list">
            ${this.loading ? '<div class="loading">Loading...</div>' : ''}
            ${!this.loading && this.taxonomies.length === 0 ? '<div class="empty">No taxonomies yet</div>' : ''}
            ${this.taxonomies.map(taxonomy => `
              <div class="taxonomy-item ${this.selectedTaxonomy?.id === taxonomy.id ? 'selected' : ''}" data-id="${taxonomy.id}">
                <div class="taxonomy-info">
                  <span class="taxonomy-name">${this.escapeHtml(taxonomy.displayName)}</span>
                  <span class="taxonomy-meta">${taxonomy.itemTypes?.join(', ') || 'all types'}</span>
                </div>
                <div class="taxonomy-actions">
                  <button class="icon-btn edit-taxonomy-btn" data-id="${taxonomy.id}" title="Edit">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                    </svg>
                  </button>
                  <button class="icon-btn delete-taxonomy-btn" data-id="${taxonomy.id}" title="Delete">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"></polyline>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="terms-panel">
          ${this.selectedTaxonomy ? `
            <div class="panel-header">
              <h3 class="panel-title">Terms: ${this.escapeHtml(this.selectedTaxonomy.displayName)}</h3>
              <div class="create-term-btn"></div>
            </div>
            <div class="terms-list">
              ${this.terms.length === 0 ? '<div class="empty">No terms yet</div>' : ''}
              ${this.terms.map(term => {
                const safeColor = this.safeColorStyle(term.color);
                return `
                <div class="term-item" data-id="${term.id}">
                  <div class="term-info">
                    ${safeColor ? `<span class="term-color" style="background-color: ${safeColor}"></span>` : ''}
                    <span class="term-name">${this.escapeHtml(term.name)}</span>
                    ${term.description ? `<span class="term-description">${this.escapeHtml(term.description)}</span>` : ''}
                  </div>
                  <div class="term-actions">
                    <button class="icon-btn edit-term-btn" data-id="${term.id}" title="Edit">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
                      </svg>
                    </button>
                    <button class="icon-btn delete-term-btn" data-id="${term.id}" title="Delete">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </div>
              `}).join('')}
            </div>
          ` : `
            <div class="empty-state">
              <p>Select a taxonomy to manage its terms</p>
            </div>
          `}
        </div>
      </div>
    `;

    // Mount buttons
    const createTaxonomyBtnContainer = this.element.querySelector('.create-taxonomy-btn');
    if (createTaxonomyBtnContainer) {
      const btn = new Button('Add Taxonomy', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.showCreateTaxonomyModal(),
      });
      btn.mount(createTaxonomyBtnContainer as HTMLElement);
      this.components.push(btn);
    }

    const createTermBtnContainer = this.element.querySelector('.create-term-btn');
    if (createTermBtnContainer) {
      const btn = new Button('Add Term', {
        variant: 'primary',
        size: 'sm',
        onClick: () => this.showCreateTermModal(),
      });
      btn.mount(createTermBtnContainer as HTMLElement);
      this.components.push(btn);
    }

    // Add event listeners
    this.element.querySelectorAll('.taxonomy-item').forEach(el => {
      el.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.taxonomy-actions')) return;
        const id = el.getAttribute('data-id');
        const taxonomy = this.taxonomies.find(t => t.id === id);
        if (taxonomy) {
          this.selectTaxonomy(taxonomy);
        }
      });
    });

    this.element.querySelectorAll('.edit-taxonomy-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
        const taxonomy = this.taxonomies.find(t => t.id === id);
        if (taxonomy) {
          this.showEditTaxonomyModal(taxonomy);
        }
      });
    });

    this.element.querySelectorAll('.delete-taxonomy-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
        const taxonomy = this.taxonomies.find(t => t.id === id);
        if (taxonomy) {
          this.deleteTaxonomy(taxonomy);
        }
      });
    });

    this.element.querySelectorAll('.edit-term-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
        const term = this.terms.find(t => t.id === id);
        if (term) {
          this.showEditTermModal(term);
        }
      });
    });

    this.element.querySelectorAll('.delete-term-btn').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = (e.currentTarget as HTMLElement).getAttribute('data-id');
        const term = this.terms.find(t => t.id === id);
        if (term) {
          this.deleteTerm(term);
        }
      });
    });

    return this;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Validate hex color to prevent CSS injection
  private isValidHexColor(color: string): boolean {
    return /^#[0-9A-Fa-f]{6}$/.test(color);
  }

  // Safely get color style or empty string
  private safeColorStyle(color: string | null | undefined): string {
    if (!color) return '';
    return this.isValidHexColor(color) ? color : '';
  }

  protected onUnmount(): void {
    for (const comp of this.components) {
      comp.unmount();
    }
    this.components = [];
  }
}
