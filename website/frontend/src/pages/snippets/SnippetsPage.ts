/**
 * Snippets Page
 * Manage user code snippets and templates
 */

import { Page } from '../base/Page';
import { snippetsStore } from '../../stores/snippetsStore';
import { toast } from '../../components';
import type { Snippet, SnippetLanguage, SnippetCategory } from '../../types';
import { SNIPPET_LANGUAGES, SNIPPET_CATEGORIES } from '../../types';
import './snippets.css';

export class SnippetsPage extends Page {
  readonly route = '/snippets';
  readonly title = 'Code Snippets';
  protected requiresAuth = true;

  private loading = true;
  private showCreateModal = false;
  private showEditModal = false;
  private showCreateCollectionModal = false;
  private editingSnippet: Snippet | null = null;
  private selectedCollectionId: string | null = null;
  private searchQuery = '';

  protected render(): string {
    const state = snippetsStore.getState();
    const snippets = state.snippets;
    const collections = state.collections;

    if (this.loading) {
      return `
        <div class="snippets-page">
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Loading snippets...</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="snippets-page">
        <header class="snippets-header">
          <div class="header-content">
            <h1>Code Snippets</h1>
            <p class="header-subtitle">Save and reuse common code patterns</p>
          </div>
          <button class="btn btn-primary" id="create-snippet-btn">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
            New Snippet
          </button>
        </header>

        <div class="snippets-layout">
          <!-- Sidebar with collections -->
          <aside class="snippets-sidebar">
            <div class="sidebar-section">
              <h3>Collections</h3>
              <button class="btn btn-sm btn-ghost" id="create-collection-btn">+ New</button>
            </div>
            <nav class="collections-nav">
              <button class="collection-item ${!this.selectedCollectionId ? 'active' : ''}" data-collection="">
                <span class="collection-icon">*</span>
                <span class="collection-name">All Snippets</span>
                <span class="collection-count">${snippets.length}</span>
              </button>
              <button class="collection-item" data-filter="favorites">
                <span class="collection-icon">*</span>
                <span class="collection-name">Favorites</span>
                <span class="collection-count">${snippets.filter(s => s.isFavorite).length}</span>
              </button>
              ${collections.map(c => `
                <button class="collection-item ${this.selectedCollectionId === c.id ? 'active' : ''}" data-collection="${c.id}">
                  <span class="collection-icon" ${c.color ? `style="color: ${c.color}"` : ''}>
                    ${this.getCollectionIcon(c.icon)}
                  </span>
                  <span class="collection-name">${this.escapeHtml(c.name)}</span>
                  <span class="collection-count">${c.snippetCount || 0}</span>
                </button>
              `).join('')}
            </nav>

            <div class="sidebar-section">
              <h3>Languages</h3>
            </div>
            <nav class="languages-nav">
              ${this.getPopularLanguages(snippets).map(lang => `
                <button class="language-item" data-language="${lang.language}">
                  <span class="language-badge">${this.getLanguageBadge(lang.language)}</span>
                  <span class="language-name">${lang.language}</span>
                  <span class="language-count">${lang.count}</span>
                </button>
              `).join('')}
            </nav>
          </aside>

          <!-- Main content -->
          <main class="snippets-main">
            <div class="snippets-toolbar">
              <div class="search-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input type="text" id="search-input" placeholder="Search snippets..." value="${this.escapeHtml(this.searchQuery)}" />
              </div>

              <div class="toolbar-filters">
                <select id="language-filter">
                  <option value="">All Languages</option>
                  ${SNIPPET_LANGUAGES.map(lang => `
                    <option value="${lang}">${lang}</option>
                  `).join('')}
                </select>

                <select id="category-filter">
                  <option value="">All Categories</option>
                  ${SNIPPET_CATEGORIES.map(cat => `
                    <option value="${cat}">${cat}</option>
                  `).join('')}
                </select>

                <select id="sort-filter">
                  <option value="updatedAt">Last Updated</option>
                  <option value="createdAt">Created</option>
                  <option value="usageCount">Most Used</option>
                  <option value="title">Name</option>
                </select>
              </div>
            </div>

            <div class="snippets-content">
              ${snippets.length === 0 ? this.renderEmptyState() : this.renderSnippetsList(snippets)}
            </div>
          </main>
        </div>

        ${this.showCreateModal ? this.renderCreateModal() : ''}
        ${this.showEditModal && this.editingSnippet ? this.renderEditModal(this.editingSnippet) : ''}
        ${this.showCreateCollectionModal ? this.renderCreateCollectionModal() : ''}
      </div>
    `;
  }

  private renderEmptyState(): string {
    return `
      <div class="empty-state">
        <div class="empty-icon">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
        </div>
        <h2>No snippets yet</h2>
        <p>Create your first code snippet to get started</p>
        <button class="btn btn-primary" id="empty-create-btn">Create Snippet</button>
      </div>
    `;
  }

  private renderSnippetsList(snippets: Snippet[]): string {
    return `
      <div class="snippets-grid">
        ${snippets.map(snippet => this.renderSnippetCard(snippet)).join('')}
      </div>
    `;
  }

  private renderSnippetCard(snippet: Snippet): string {
    const previewCode = snippet.code.slice(0, 200) + (snippet.code.length > 200 ? '...' : '');

    return `
      <article class="snippet-card" data-snippet-id="${snippet.id}">
        <header class="snippet-card-header">
          <div class="snippet-info">
            <h3 class="snippet-title">${this.escapeHtml(snippet.title)}</h3>
            <div class="snippet-meta">
              <span class="language-badge">${this.getLanguageBadge(snippet.language)}</span>
              <span class="category-badge">${snippet.category}</span>
            </div>
          </div>
          <div class="snippet-actions">
            <button class="icon-btn" data-action="favorite" data-id="${snippet.id}" title="${snippet.isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="${snippet.isFavorite ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
              </svg>
            </button>
            <button class="icon-btn" data-action="copy" data-id="${snippet.id}" title="Copy code">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <button class="icon-btn" data-action="menu" data-id="${snippet.id}" title="More options">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
              </svg>
            </button>
          </div>
        </header>

        ${snippet.description ? `
          <p class="snippet-description">${this.escapeHtml(snippet.description)}</p>
        ` : ''}

        <pre class="snippet-preview"><code>${this.escapeHtml(previewCode)}</code></pre>

        <footer class="snippet-card-footer">
          <div class="snippet-stats">
            <span title="Times used">Used ${snippet.usageCount}x</span>
          </div>
          ${snippet.tags && snippet.tags.length > 0 ? `
            <div class="snippet-tags">
              ${snippet.tags.slice(0, 3).map(tag => `
                <span class="tag">${this.escapeHtml(tag)}</span>
              `).join('')}
              ${snippet.tags.length > 3 ? `<span class="tag-more">+${snippet.tags.length - 3}</span>` : ''}
            </div>
          ` : ''}
        </footer>
      </article>
    `;
  }

  private renderCreateModal(): string {
    return `
      <div class="modal-overlay" id="create-modal">
        <div class="modal snippet-modal">
          <header class="modal-header">
            <h2>Create Snippet</h2>
            <button class="modal-close" id="close-create-modal">&times;</button>
          </header>
          <form id="create-snippet-form" class="modal-body">
            <div class="form-group">
              <label for="snippet-title">Title *</label>
              <input type="text" id="snippet-title" name="title" required maxlength="100" placeholder="e.g., React useState Hook" />
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="snippet-language">Language</label>
                <select id="snippet-language" name="language">
                  ${SNIPPET_LANGUAGES.map(lang => `
                    <option value="${lang}" ${lang === 'typescript' ? 'selected' : ''}>${lang}</option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group">
                <label for="snippet-category">Category</label>
                <select id="snippet-category" name="category">
                  ${SNIPPET_CATEGORIES.map(cat => `
                    <option value="${cat}">${cat}</option>
                  `).join('')}
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="snippet-description">Description</label>
              <textarea id="snippet-description" name="description" rows="2" maxlength="500" placeholder="Brief description of what this snippet does..."></textarea>
            </div>

            <div class="form-group">
              <label for="snippet-code">Code *</label>
              <textarea id="snippet-code" name="code" required rows="10" placeholder="Paste your code here..."></textarea>
            </div>

            <div class="form-group">
              <label for="snippet-tags">Tags (comma separated)</label>
              <input type="text" id="snippet-tags" name="tags" placeholder="e.g., react, hooks, state" />
            </div>

            <footer class="modal-footer">
              <button type="button" class="btn btn-ghost" id="cancel-create">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Snippet</button>
            </footer>
          </form>
        </div>
      </div>
    `;
  }

  private renderEditModal(snippet: Snippet): string {
    return `
      <div class="modal-overlay" id="edit-modal">
        <div class="modal snippet-modal">
          <header class="modal-header">
            <h2>Edit Snippet</h2>
            <button class="modal-close" id="close-edit-modal">&times;</button>
          </header>
          <form id="edit-snippet-form" class="modal-body">
            <div class="form-group">
              <label for="edit-title">Title *</label>
              <input type="text" id="edit-title" name="title" required maxlength="100" value="${this.escapeHtml(snippet.title)}" />
            </div>

            <div class="form-row">
              <div class="form-group">
                <label for="edit-language">Language</label>
                <select id="edit-language" name="language">
                  ${SNIPPET_LANGUAGES.map(lang => `
                    <option value="${lang}" ${lang === snippet.language ? 'selected' : ''}>${lang}</option>
                  `).join('')}
                </select>
              </div>

              <div class="form-group">
                <label for="edit-category">Category</label>
                <select id="edit-category" name="category">
                  ${SNIPPET_CATEGORIES.map(cat => `
                    <option value="${cat}" ${cat === snippet.category ? 'selected' : ''}>${cat}</option>
                  `).join('')}
                </select>
              </div>
            </div>

            <div class="form-group">
              <label for="edit-description">Description</label>
              <textarea id="edit-description" name="description" rows="2" maxlength="500">${this.escapeHtml(snippet.description || '')}</textarea>
            </div>

            <div class="form-group">
              <label for="edit-code">Code *</label>
              <textarea id="edit-code" name="code" required rows="10">${this.escapeHtml(snippet.code)}</textarea>
            </div>

            <div class="form-group">
              <label for="edit-tags">Tags (comma separated)</label>
              <input type="text" id="edit-tags" name="tags" value="${(snippet.tags || []).join(', ')}" />
            </div>

            <footer class="modal-footer">
              <button type="button" class="btn btn-danger" id="delete-snippet-btn">Delete</button>
              <div class="modal-footer-right">
                <button type="button" class="btn btn-ghost" id="cancel-edit">Cancel</button>
                <button type="submit" class="btn btn-primary">Save Changes</button>
              </div>
            </footer>
          </form>
        </div>
      </div>
    `;
  }

  private renderCreateCollectionModal(): string {
    return `
      <div class="modal-overlay" id="create-collection-modal">
        <div class="modal">
          <header class="modal-header">
            <h2>Create Collection</h2>
            <button class="modal-close" id="close-create-collection-modal">&times;</button>
          </header>
          <form id="create-collection-form" class="modal-body">
            <div class="form-group">
              <label for="collection-name">Name *</label>
              <input type="text" id="collection-name" name="name" required maxlength="50" placeholder="e.g., React Hooks" />
            </div>

            <div class="form-group">
              <label for="collection-description">Description</label>
              <textarea id="collection-description" name="description" rows="2" maxlength="200" placeholder="Brief description of this collection..."></textarea>
            </div>

            <div class="form-group">
              <label for="collection-color">Color</label>
              <input type="color" id="collection-color" name="color" value="#6366f1" />
            </div>

            <footer class="modal-footer">
              <button type="button" class="btn btn-ghost" id="cancel-create-collection">Cancel</button>
              <button type="submit" class="btn btn-primary">Create Collection</button>
            </footer>
          </form>
        </div>
      </div>
    `;
  }

  private getCollectionIcon(icon?: string): string {
    const icons: Record<string, string> = {
      folder: '*',
      code: '&lt;/&gt;',
      star: '*',
      bookmark: '#',
    };
    return icons[icon || 'folder'] || '*';
  }

  private getLanguageBadge(language: string): string {
    const badges: Record<string, string> = {
      javascript: 'JS',
      typescript: 'TS',
      python: 'PY',
      java: 'JV',
      csharp: 'C#',
      cpp: 'C++',
      c: 'C',
      go: 'GO',
      rust: 'RS',
      ruby: 'RB',
      php: 'PHP',
      swift: 'SW',
      kotlin: 'KT',
      scala: 'SC',
      html: 'HTML',
      css: 'CSS',
      scss: 'SCSS',
      sql: 'SQL',
      bash: 'SH',
      powershell: 'PS',
      yaml: 'YML',
      json: 'JSON',
      xml: 'XML',
      markdown: 'MD',
      dockerfile: 'DOC',
      terraform: 'TF',
      graphql: 'GQL',
      other: '?',
    };
    return badges[language] || language.slice(0, 2).toUpperCase();
  }

  private getPopularLanguages(snippets: Snippet[]): Array<{ language: SnippetLanguage; count: number }> {
    const counts: Record<string, number> = {};
    for (const s of snippets) {
      counts[s.language] = (counts[s.language] || 0) + 1;
    }
    return Object.entries(counts)
      .map(([language, count]) => ({ language: language as SnippetLanguage, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }

  async load(): Promise<void> {
    this.loading = true;
    this.element.innerHTML = this.render();

    try {
      await snippetsStore.initialize();
      this.loading = false;
      this.element.innerHTML = this.render();
      this.setupEventListeners();
    } catch (error) {
      console.error('Failed to load snippets:', error);
      this.loading = false;
      this.element.innerHTML = `
        <div class="snippets-page">
          <div class="error-state">
            <h2>Failed to load snippets</h2>
            <p>Please try again later</p>
            <button onclick="location.reload()">Retry</button>
          </div>
        </div>
      `;
    }
  }

  private setupEventListeners(): void {
    // Create snippet button
    this.on('#create-snippet-btn', 'click', () => this.openCreateModal());
    this.on('#empty-create-btn', 'click', () => this.openCreateModal());

    // Close modals
    this.on('#close-create-modal', 'click', () => this.closeCreateModal());
    this.on('#cancel-create', 'click', () => this.closeCreateModal());
    this.on('#close-edit-modal', 'click', () => this.closeEditModal());
    this.on('#cancel-edit', 'click', () => this.closeEditModal());

    // Create form
    const createForm = this.$('#create-snippet-form') as HTMLFormElement;
    if (createForm) {
      createForm.addEventListener('submit', (e) => this.handleCreateSubmit(e));
    }

    // Edit form
    const editForm = this.$('#edit-snippet-form') as HTMLFormElement;
    if (editForm) {
      editForm.addEventListener('submit', (e) => this.handleEditSubmit(e));
    }

    // Delete button
    this.on('#delete-snippet-btn', 'click', () => this.handleDelete());

    // Create collection button and modal
    this.on('#create-collection-btn', 'click', () => this.openCreateCollectionModal());
    this.on('#close-create-collection-modal', 'click', () => this.closeCreateCollectionModal());
    this.on('#cancel-create-collection', 'click', () => this.closeCreateCollectionModal());

    const createCollectionForm = this.$('#create-collection-form') as HTMLFormElement;
    if (createCollectionForm) {
      createCollectionForm.addEventListener('submit', (e) => this.handleCreateCollectionSubmit(e));
    }

    this.on('#create-collection-modal', 'click', (e) => {
      if ((e.target as HTMLElement).id === 'create-collection-modal') {
        this.closeCreateCollectionModal();
      }
    });

    // Search
    const searchInput = this.$('#search-input') as HTMLInputElement;
    if (searchInput) {
      let debounceTimeout: number;
      searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimeout);
        debounceTimeout = window.setTimeout(() => {
          this.searchQuery = searchInput.value;
          this.handleSearch();
        }, 300);
      });
    }

    // Filters
    this.on('#language-filter', 'change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      snippetsStore.setFilters({ language: value as SnippetLanguage || undefined });
      this.refresh();
    });

    this.on('#category-filter', 'change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      snippetsStore.setFilters({ category: value as SnippetCategory || undefined });
      this.refresh();
    });

    this.on('#sort-filter', 'change', (e) => {
      const value = (e.target as HTMLSelectElement).value;
      snippetsStore.setFilters({ sortBy: value as any });
      this.refresh();
    });

    // Collection nav
    const collectionItems = this.$$('.collection-item');
    collectionItems.forEach(item => {
      item.addEventListener('click', () => {
        const collectionId = (item as HTMLElement).dataset.collection;
        const filter = (item as HTMLElement).dataset.filter;

        if (filter === 'favorites') {
          snippetsStore.setFilters({ favorite: true, collectionId: undefined });
        } else {
          snippetsStore.setFilters({
            collectionId: collectionId || undefined,
            favorite: undefined
          });
        }
        this.selectedCollectionId = collectionId || null;
        this.refresh();
      });
    });

    // Language nav
    const languageItems = this.$$('.language-item');
    languageItems.forEach(item => {
      item.addEventListener('click', () => {
        const language = (item as HTMLElement).dataset.language as SnippetLanguage;
        snippetsStore.setFilters({ language });
        this.refresh();
      });
    });

    // Snippet card actions
    const actionButtons = this.$$('[data-action]');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = (btn as HTMLElement).dataset.action;
        const id = (btn as HTMLElement).dataset.id;
        if (action && id) {
          this.handleSnippetAction(action, id);
        }
      });
    });

    // Snippet card click to edit
    const snippetCards = this.$$('.snippet-card');
    snippetCards.forEach(card => {
      card.addEventListener('click', () => {
        const id = (card as HTMLElement).dataset.snippetId;
        if (id) {
          this.openEditModal(id);
        }
      });
    });

    // Modal overlay click to close
    this.on('#create-modal', 'click', (e) => {
      if ((e.target as HTMLElement).id === 'create-modal') {
        this.closeCreateModal();
      }
    });

    this.on('#edit-modal', 'click', (e) => {
      if ((e.target as HTMLElement).id === 'edit-modal') {
        this.closeEditModal();
      }
    });
  }

  private openCreateModal(): void {
    this.showCreateModal = true;
    this.refresh();
  }

  private closeCreateModal(): void {
    this.showCreateModal = false;
    this.refresh();
  }

  private async openEditModal(id: string): Promise<void> {
    const snippet = await snippetsStore.getSnippet(id);
    if (snippet) {
      this.editingSnippet = snippet;
      this.showEditModal = true;
      this.refresh();
    }
  }

  private closeEditModal(): void {
    this.showEditModal = false;
    this.editingSnippet = null;
    snippetsStore.clearSelectedSnippet();
    this.refresh();
  }

  private openCreateCollectionModal(): void {
    this.showCreateCollectionModal = true;
    this.refresh();
  }

  private closeCreateCollectionModal(): void {
    this.showCreateCollectionModal = false;
    this.refresh();
  }

  private async handleCreateCollectionSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    const name = formData.get('name') as string;
    const description = formData.get('description') as string;
    const color = formData.get('color') as string;

    const result = await snippetsStore.createCollection({
      name,
      description: description || undefined,
      color: color || undefined,
    });

    if (result) {
      toast.success('Collection created');
      this.closeCreateCollectionModal();
    } else {
      toast.error(snippetsStore.getState().error || 'Failed to create collection');
    }
  }

  private async handleCreateSubmit(e: Event): Promise<void> {
    e.preventDefault();

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    const title = formData.get('title') as string;
    const code = formData.get('code') as string;
    const language = formData.get('language') as SnippetLanguage;
    const category = formData.get('category') as SnippetCategory;
    const description = formData.get('description') as string;
    const tagsStr = formData.get('tags') as string;
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

    const result = await snippetsStore.createSnippet({
      title,
      code,
      language,
      category,
      description,
      tags,
    });

    if (result) {
      toast.success('Snippet created');
      this.closeCreateModal();
    } else {
      toast.error(snippetsStore.getState().error || 'Failed to create snippet');
    }
  }

  private async handleEditSubmit(e: Event): Promise<void> {
    e.preventDefault();

    if (!this.editingSnippet) return;

    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);

    const title = formData.get('title') as string;
    const code = formData.get('code') as string;
    const language = formData.get('language') as SnippetLanguage;
    const category = formData.get('category') as SnippetCategory;
    const description = formData.get('description') as string;
    const tagsStr = formData.get('tags') as string;
    const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

    const result = await snippetsStore.updateSnippet(this.editingSnippet.id, {
      title,
      code,
      language,
      category,
      description,
      tags,
    });

    if (result) {
      toast.success('Snippet updated');
      this.closeEditModal();
    } else {
      toast.error(snippetsStore.getState().error || 'Failed to update snippet');
    }
  }

  private async handleDelete(): Promise<void> {
    if (!this.editingSnippet) return;

    if (!confirm('Are you sure you want to delete this snippet?')) return;

    const success = await snippetsStore.deleteSnippet(this.editingSnippet.id);

    if (success) {
      toast.success('Snippet deleted');
      this.closeEditModal();
    } else {
      toast.error(snippetsStore.getState().error || 'Failed to delete snippet');
    }
  }

  private async handleSnippetAction(action: string, id: string): Promise<void> {
    const snippets = snippetsStore.getState().snippets;
    const snippet = snippets.find(s => s.id === id);

    switch (action) {
      case 'favorite':
        await snippetsStore.toggleFavorite(id);
        this.refresh();
        break;

      case 'copy':
        if (snippet) {
          await navigator.clipboard.writeText(snippet.code);
          await snippetsStore.useSnippet(id);
          toast.success('Code copied to clipboard');
        }
        break;

      case 'menu':
        // TODO: Show context menu with more options
        break;
    }
  }

  private handleSearch(): void {
    snippetsStore.setFilters({ search: this.searchQuery || undefined });
    this.refresh();
  }

  private refresh(): void {
    this.element.innerHTML = this.render();
    this.setupEventListeners();
  }
}
