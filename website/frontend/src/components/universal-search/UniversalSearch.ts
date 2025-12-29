import { Component, ComponentOptions } from '../base';
import { ArrayStorage } from '../../lib/typedStorage';
import './universal-search.css';

export type UniversalSearchSize = 'sm' | 'md' | 'lg';

export interface SearchResultItem {
  id: string;
  type: 'game' | 'user' | 'session' | 'post';
  title: string;
  subtitle?: string;
  description?: string;
  image?: string;
  tags?: string[];
  matchedFields?: string[];
}

export interface SearchResults {
  items: SearchResultItem[];
  total: number;
  query: string;
}

export interface UniversalSearchOptions extends ComponentOptions {
  size?: UniversalSearchSize;
  placeholder?: string;
  debounceMs?: number;
  minQueryLength?: number;
  maxResults?: number;
  showRecentSearches?: boolean;
  recentSearchesKey?: string;
  maxRecentSearches?: number;
  onSearch?: (query: string) => Promise<SearchResults>;
  onSelect?: (item: SearchResultItem) => void;
  onClear?: () => void;
}

export class UniversalSearch extends Component<HTMLDivElement> {
  private static instances: Set<UniversalSearch> = new Set();

  private inputWrapper: HTMLDivElement;
  private inputElement: HTMLInputElement;
  private clearButton: HTMLButtonElement;
  private dropdownElement: HTMLDivElement;
  private resultsContainer: HTMLDivElement;
  private loadingIndicator: HTMLDivElement;
  private options: UniversalSearchOptions;
  private isOpen = false;
  private focusedIndex = -1;
  private currentResults: SearchResultItem[] = [];
  private recentSearches: string[] = [];
  private recentSearchesStorage: ArrayStorage<string> | null = null;
  private debounceTimer: number | null = null;
  private currentQuery = '';

  constructor(options: UniversalSearchOptions = {}) {
    super('div', {
      className: 'universal-search',
      ...options,
    });

    this.options = {
      size: 'md',
      placeholder: 'Search across all fields...',
      debounceMs: 300,
      minQueryLength: 2,
      maxResults: 10,
      showRecentSearches: true,
      recentSearchesKey: 'universal-search-recent',
      maxRecentSearches: 5,
      ...options,
    };

    this.inputWrapper = document.createElement('div');
    this.inputWrapper.className = 'universal-search-input-wrapper';

    this.inputElement = document.createElement('input');
    this.inputElement.type = 'search';
    this.inputElement.className = 'universal-search-input';
    this.inputElement.placeholder = this.options.placeholder!;
    this.inputElement.autocomplete = 'off';

    this.clearButton = document.createElement('button');
    this.clearButton.type = 'button';
    this.clearButton.className = 'universal-search-clear';
    this.clearButton.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <path d="M7 5.586L10.293 2.293a1 1 0 111.414 1.414L8.414 7l3.293 3.293a1 1 0 01-1.414 1.414L7 8.414l-3.293 3.293a1 1 0 01-1.414-1.414L5.586 7 2.293 3.707a1 1 0 011.414-1.414L7 5.586z"/>
      </svg>
    `;
    this.clearButton.style.display = 'none';

    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'universal-search-dropdown';

    this.resultsContainer = document.createElement('div');
    this.resultsContainer.className = 'universal-search-results';

    this.loadingIndicator = document.createElement('div');
    this.loadingIndicator.className = 'universal-search-loading';
    this.loadingIndicator.innerHTML = `
      <div class="universal-search-spinner"></div>
      <span>Searching...</span>
    `;

    // Initialize typed storage for recent searches if key is provided
    if (this.options.recentSearchesKey) {
      this.recentSearchesStorage = new ArrayStorage<string>(
        this.options.recentSearchesKey,
        [],
        {
          maxItems: this.options.maxRecentSearches ?? 5,
          itemValidator: (item): item is string => typeof item === 'string',
        }
      );
    }

    this.loadRecentSearches();
    this.buildStructure();
    this.applyOptions();
    this.setupEventListeners();

    UniversalSearch.instances.add(this);
  }

  private static closeOthers(except: UniversalSearch): void {
    for (const instance of UniversalSearch.instances) {
      if (instance !== except && instance.isOpen) {
        instance.close();
      }
    }
  }

  private loadRecentSearches(): void {
    if (!this.options.showRecentSearches || !this.recentSearchesStorage) return;
    this.recentSearches = this.recentSearchesStorage.get();
  }

  private saveRecentSearch(query: string): void {
    if (!this.options.showRecentSearches || !this.recentSearchesStorage) return;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) return;

    // Remove duplicates (case-insensitive) and add to front
    this.recentSearches = this.recentSearches.filter(
      s => s.toLowerCase() !== normalizedQuery.toLowerCase()
    );
    this.recentSearches.unshift(normalizedQuery);
    this.recentSearches = this.recentSearches.slice(0, this.options.maxRecentSearches);

    this.recentSearchesStorage.set(this.recentSearches);
  }

  private clearRecentSearches(): void {
    this.recentSearches = [];
    this.recentSearchesStorage?.remove();
    this.renderRecentSearches();
  }

  private buildStructure(): void {
    const searchIcon = document.createElement('span');
    searchIcon.className = 'universal-search-icon';
    searchIcon.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85a1.007 1.007 0 00-.115-.1zM12 6.5a5.5 5.5 0 11-11 0 5.5 5.5 0 0111 0z"/>
      </svg>
    `;

    this.inputWrapper.appendChild(searchIcon);
    this.inputWrapper.appendChild(this.inputElement);
    this.inputWrapper.appendChild(this.clearButton);

    this.dropdownElement.appendChild(this.loadingIndicator);
    this.dropdownElement.appendChild(this.resultsContainer);

    this.element.appendChild(this.inputWrapper);
    this.element.appendChild(this.dropdownElement);
  }

  private applyOptions(): void {
    const { size } = this.options;
    if (size && size !== 'md') {
      this.element.classList.add(`universal-search--${size}`);
    }
  }

  private setupEventListeners(): void {
    this.on(this.inputElement, 'input', () => {
      this.handleInput();
    });

    this.on(this.inputElement, 'focus', () => {
      this.handleFocus();
    });

    this.on(this.inputElement, 'keydown', (e) => {
      this.handleKeyDown(e as KeyboardEvent);
    });

    this.on(this.clearButton, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.clear();
    });

    this.on(document, 'click', ((e: MouseEvent) => {
      if (this.isOpen && !this.element.contains(e.target as Node)) {
        this.close();
      }
    }) as EventListener);

    // Delegated click handler for dynamically created elements in resultsContainer
    this.on(this.resultsContainer, 'click', ((e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Handle clear recent searches button
      const clearBtn = target.closest('.universal-search-recent-clear');
      if (clearBtn) {
        e.preventDefault();
        e.stopPropagation();
        this.clearRecentSearches();
        return;
      }

      // Handle recent search item click
      const recentItem = target.closest('.universal-search-recent-item') as HTMLElement | null;
      if (recentItem && recentItem.dataset.search) {
        e.preventDefault();
        e.stopPropagation();
        const search = recentItem.dataset.search;
        this.inputElement.value = search;
        this.currentQuery = search;
        this.clearButton.style.display = 'flex';
        this.handleInput();
        return;
      }

      // Handle result item click
      const resultItem = target.closest('.universal-search-result') as HTMLElement | null;
      if (resultItem && resultItem.dataset.index) {
        e.preventDefault();
        e.stopPropagation();
        const index = parseInt(resultItem.dataset.index, 10);
        if (index >= 0 && index < this.currentResults.length) {
          this.selectResult(this.currentResults[index]);
        }
        return;
      }
    }) as EventListener);

    // Delegated mouseenter handler for result items
    this.on(this.resultsContainer, 'mouseenter', ((e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const resultItem = target.closest('.universal-search-result') as HTMLElement | null;
      if (resultItem && resultItem.dataset.index) {
        const index = parseInt(resultItem.dataset.index, 10);
        if (index >= 0 && index < this.currentResults.length) {
          this.focusedIndex = index;
          this.updateFocusedState();
        }
      }
    }) as EventListener, { capture: true });
  }

  private handleInput(): void {
    const query = this.inputElement.value.trim();
    this.currentQuery = query;

    this.clearButton.style.display = query.length > 0 ? 'flex' : 'none';

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (query.length < (this.options.minQueryLength ?? 2)) {
      this.currentResults = [];
      if (query.length === 0) {
        this.renderRecentSearches();
      } else {
        this.renderResults();
      }
      return;
    }

    this.setLoading(true);

    this.debounceTimer = window.setTimeout(async () => {
      await this.performSearch(query);
    }, this.options.debounceMs);
  }

  private handleFocus(): void {
    UniversalSearch.closeOthers(this);

    if (this.currentQuery.length >= (this.options.minQueryLength ?? 2)) {
      this.open();
    } else if (this.recentSearches.length > 0 && this.options.showRecentSearches) {
      this.renderRecentSearches();
      this.open();
    }
  }

  private handleKeyDown(e: KeyboardEvent): void {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.focusNext();
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.focusPrevious();
        break;
      case 'Enter':
        e.preventDefault();
        if (this.focusedIndex >= 0 && this.focusedIndex < this.currentResults.length) {
          this.selectResult(this.currentResults[this.focusedIndex]);
        } else if (this.currentQuery.length >= (this.options.minQueryLength ?? 2)) {
          this.saveRecentSearch(this.currentQuery);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.close();
        this.inputElement.blur();
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  private async performSearch(query: string): Promise<void> {
    if (!this.options.onSearch) {
      this.setLoading(false);
      return;
    }

    try {
      const results = await this.options.onSearch(query);

      if (query !== this.currentQuery) {
        return;
      }

      this.currentResults = results.items.slice(0, this.options.maxResults);
      this.renderResults();
      this.open();
    } catch (error) {
      console.error('Universal search error:', error);
      this.currentResults = [];
      this.renderError();
    } finally {
      this.setLoading(false);
    }
  }

  private renderResults(): void {
    this.resultsContainer.innerHTML = '';
    this.focusedIndex = -1;

    if (this.currentResults.length === 0) {
      if (this.currentQuery.length >= (this.options.minQueryLength ?? 2)) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'universal-search-empty';
        emptyEl.innerHTML = `
          <span class="universal-search-empty-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
            </svg>
          </span>
          <span class="universal-search-empty-text">No results found for "${this.escapeHtml(this.currentQuery)}"</span>
          <span class="universal-search-empty-hint">Try different keywords or check your spelling</span>
        `;
        this.resultsContainer.appendChild(emptyEl);
      }
      return;
    }

    const groupedResults = this.groupResultsByType(this.currentResults);

    for (const [type, items] of Object.entries(groupedResults)) {
      if (items.length === 0) continue;

      const groupEl = document.createElement('div');
      groupEl.className = 'universal-search-group';

      const labelEl = document.createElement('div');
      labelEl.className = 'universal-search-group-label';
      labelEl.textContent = this.getTypeLabel(type);
      groupEl.appendChild(labelEl);

      for (const item of items) {
        const itemEl = this.createResultItem(item);
        groupEl.appendChild(itemEl);
      }

      this.resultsContainer.appendChild(groupEl);
    }
  }

  private renderRecentSearches(): void {
    this.resultsContainer.innerHTML = '';
    this.focusedIndex = -1;
    this.currentResults = [];

    if (!this.options.showRecentSearches || this.recentSearches.length === 0) {
      return;
    }

    const headerEl = document.createElement('div');
    headerEl.className = 'universal-search-recent-header';
    headerEl.innerHTML = `
      <span class="universal-search-recent-title">Recent Searches</span>
      <button type="button" class="universal-search-recent-clear">Clear</button>
    `;

    this.resultsContainer.appendChild(headerEl);

    for (const search of this.recentSearches) {
      const itemEl = document.createElement('button');
      itemEl.type = 'button';
      itemEl.className = 'universal-search-recent-item';
      itemEl.dataset.search = search;
      itemEl.innerHTML = `
        <span class="universal-search-recent-icon">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
            <path d="M7 0a7 7 0 110 14A7 7 0 017 0zm0 1.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM7.5 3v4.207l2.146 2.147a.5.5 0 01-.707.707L6.5 7.621V3a.5.5 0 011 0z"/>
          </svg>
        </span>
        <span class="universal-search-recent-text">${this.escapeHtml(search)}</span>
      `;

      this.resultsContainer.appendChild(itemEl);
    }

    this.open();
  }

  private renderError(): void {
    this.resultsContainer.innerHTML = '';

    const errorEl = document.createElement('div');
    errorEl.className = 'universal-search-error';
    errorEl.innerHTML = `
      <span class="universal-search-error-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
        </svg>
      </span>
      <span class="universal-search-error-text">Search failed. Please try again.</span>
    `;

    this.resultsContainer.appendChild(errorEl);
  }

  private createResultItem(item: SearchResultItem): HTMLButtonElement {
    const itemEl = document.createElement('button');
    itemEl.type = 'button';
    itemEl.className = 'universal-search-result';
    itemEl.dataset.id = item.id;
    itemEl.dataset.type = item.type;

    const index = this.currentResults.indexOf(item);
    itemEl.dataset.index = String(index);

    if (index === this.focusedIndex) {
      itemEl.classList.add('universal-search-result--focused');
    }

    let imageHtml = '';
    if (item.image) {
      imageHtml = `<img src="${this.escapeHtml(item.image)}" alt="" class="universal-search-result-image" />`;
    } else {
      imageHtml = `<div class="universal-search-result-image universal-search-result-image--placeholder">${this.getTypeIcon(item.type)}</div>`;
    }

    let tagsHtml = '';
    if (item.tags && item.tags.length > 0) {
      const displayTags = item.tags.slice(0, 3);
      tagsHtml = `
        <div class="universal-search-result-tags">
          ${displayTags.map(tag => `<span class="universal-search-result-tag">${this.escapeHtml(tag)}</span>`).join('')}
        </div>
      `;
    }

    let matchedFieldsHtml = '';
    if (item.matchedFields && item.matchedFields.length > 0) {
      matchedFieldsHtml = `
        <div class="universal-search-result-matched">
          Matched in: ${item.matchedFields.map(f => `<span class="universal-search-result-matched-field">${this.escapeHtml(f)}</span>`).join(', ')}
        </div>
      `;
    }

    const highlightedTitle = this.highlightMatch(item.title, this.currentQuery);
    const highlightedSubtitle = item.subtitle ? this.highlightMatch(item.subtitle, this.currentQuery) : '';
    const highlightedDescription = item.description ? this.highlightMatch(item.description, this.currentQuery) : '';

    itemEl.innerHTML = `
      ${imageHtml}
      <div class="universal-search-result-content">
        <div class="universal-search-result-title">${highlightedTitle}</div>
        ${highlightedSubtitle ? `<div class="universal-search-result-subtitle">${highlightedSubtitle}</div>` : ''}
        ${highlightedDescription ? `<div class="universal-search-result-description">${highlightedDescription}</div>` : ''}
        ${tagsHtml}
        ${matchedFieldsHtml}
      </div>
      <span class="universal-search-result-type">${this.getTypeLabel(item.type)}</span>
    `;

    return itemEl;
  }

  private highlightMatch(text: string, query: string): string {
    if (!query || query.length < 2) return this.escapeHtml(text);

    const escapedText = this.escapeHtml(text);
    const escapedQuery = this.escapeHtml(query);

    const regex = new RegExp(`(${this.escapeRegex(escapedQuery)})`, 'gi');
    return escapedText.replace(regex, '<mark class="universal-search-highlight">$1</mark>');
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private groupResultsByType(results: SearchResultItem[]): Record<string, SearchResultItem[]> {
    const groups: Record<string, SearchResultItem[]> = {
      game: [],
      user: [],
      session: [],
      post: [],
    };

    for (const result of results) {
      if (groups[result.type]) {
        groups[result.type].push(result);
      }
    }

    return groups;
  }

  private getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      game: 'Games',
      user: 'Users',
      session: 'Sessions',
      post: 'Community',
    };
    return labels[type] || type;
  }

  private getTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      game: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 2a8 8 0 100 16 8 8 0 000-16zM8 7a1 1 0 012 0v2h2a1 1 0 110 2H9a1 1 0 01-1-1V7z"/></svg>`,
      user: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"/></svg>`,
      session: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a2 2 0 012-2h10a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V4z"/></svg>`,
      post: `<svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5z"/></svg>`,
    };
    return icons[type] || '';
  }

  private selectResult(item: SearchResultItem): void {
    this.saveRecentSearch(this.currentQuery);
    this.close();
    this.options.onSelect?.(item);
  }

  private focusNext(): void {
    if (this.currentResults.length === 0) return;

    this.focusedIndex = Math.min(this.focusedIndex + 1, this.currentResults.length - 1);
    this.updateFocusedState();
    this.scrollToFocused();
  }

  private focusPrevious(): void {
    if (this.currentResults.length === 0) return;

    this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
    this.updateFocusedState();
    this.scrollToFocused();
  }

  private updateFocusedState(): void {
    const items = this.resultsContainer.querySelectorAll('.universal-search-result');
    items.forEach((item, index) => {
      item.classList.toggle('universal-search-result--focused', index === this.focusedIndex);
    });
  }

  private scrollToFocused(): void {
    const focusedEl = this.resultsContainer.querySelector('.universal-search-result--focused');
    if (focusedEl) {
      focusedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  private setLoading(loading: boolean): void {
    this.loadingIndicator.style.display = loading ? 'flex' : 'none';
    this.resultsContainer.style.display = loading ? 'none' : 'block';
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  open(): this {
    if (this.isOpen) return this;

    UniversalSearch.closeOthers(this);

    this.isOpen = true;
    this.element.classList.add('universal-search--open');
    return this;
  }

  close(): this {
    if (!this.isOpen) return this;

    this.isOpen = false;
    this.element.classList.remove('universal-search--open');
    this.focusedIndex = -1;
    return this;
  }

  clear(): this {
    this.inputElement.value = '';
    this.currentQuery = '';
    this.currentResults = [];
    this.clearButton.style.display = 'none';
    this.focusedIndex = -1;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    this.setLoading(false);

    if (this.recentSearches.length > 0 && this.options.showRecentSearches) {
      this.renderRecentSearches();
    } else {
      this.resultsContainer.innerHTML = '';
      this.close();
    }

    this.options.onClear?.();
    this.inputElement.focus();
    return this;
  }

  getValue(): string {
    return this.inputElement.value;
  }

  setValue(value: string): this {
    this.inputElement.value = value;
    this.currentQuery = value;
    this.clearButton.style.display = value.length > 0 ? 'flex' : 'none';
    return this;
  }

  focus(): this {
    this.inputElement.focus();
    return this;
  }

  blur(): this {
    this.inputElement.blur();
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.inputElement.placeholder = placeholder;
    return this;
  }

  getInputElement(): HTMLInputElement {
    return this.inputElement;
  }

  protected onUnmount(): void {
    UniversalSearch.instances.delete(this);
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
  }
}
