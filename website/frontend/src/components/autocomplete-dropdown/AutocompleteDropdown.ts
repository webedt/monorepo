/**
 * Autocomplete Dropdown Component
 * AI-powered code completion suggestions
 */

import { Component, ComponentOptions } from '../base';
import './autocomplete-dropdown.css';

export interface AutocompleteSuggestion {
  text: string;
  label: string;
  kind: 'function' | 'method' | 'variable' | 'class' | 'interface' | 'property' | 'keyword' | 'snippet' | 'text';
  detail?: string;
  confidence?: number;
}

export interface AutocompleteDropdownOptions extends ComponentOptions {
  onSelect?: (suggestion: AutocompleteSuggestion) => void;
  onDismiss?: () => void;
  maxHeight?: number;
}

const KIND_ICONS: Record<string, string> = {
  function: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v1h4a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4zm6 3v5h4V7H8zM6 4H4v2h2V4z"/></svg>',
  method: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 8a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm4-1h4v1h-4V8zm0-2h4v1h-4V6zm0-2h4v1h-4V4z"/></svg>',
  variable: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zM2 8a6 6 0 1 1 12 0A6 6 0 0 1 2 8z"/><path d="M6.5 5h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1zm0 3h3a.5.5 0 0 1 0 1h-3a.5.5 0 0 1 0-1z"/></svg>',
  class: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 2a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2zm10 0H4v12h8V2zM6 4h4v1H6V4zm0 2h4v1H6V6z"/></svg>',
  interface: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M4 1h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V4a3 3 0 0 1 3-3zm8 1H4a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2z"/></svg>',
  property: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 1 0-6 0v4H2v7a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7h-3z"/></svg>',
  keyword: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M14 5H2V4h12v1zm0 3H2V7h12v1zm-4 3H2v-1h8v1z"/></svg>',
  snippet: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5.854 4.854a.5.5 0 1 0-.708-.708l-3.5 3.5a.5.5 0 0 0 0 .708l3.5 3.5a.5.5 0 0 0 .708-.708L2.707 8l3.147-3.146zm4.292 0a.5.5 0 0 1 .708-.708l3.5 3.5a.5.5 0 0 1 0 .708l-3.5 3.5a.5.5 0 0 1-.708-.708L13.293 8l-3.147-3.146z"/></svg>',
  text: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M3 2.5a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1-.5-.5zM3 6a.5.5 0 0 1 .5-.5h9a.5.5 0 0 1 0 1h-9A.5.5 0 0 1 3 6zm0 3.5a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5z"/></svg>',
};

export class AutocompleteDropdown extends Component<HTMLDivElement> {
  private suggestions: AutocompleteSuggestion[] = [];
  private selectedIndex: number = -1;
  private listElement: HTMLDivElement;
  private dropdownOptions: AutocompleteDropdownOptions;
  private dropdownVisible: boolean = false;

  constructor(options: AutocompleteDropdownOptions = {}) {
    super('div', {
      className: 'autocomplete-dropdown',
      ...options,
    });

    this.dropdownOptions = {
      maxHeight: 300,
      ...options,
    };

    this.listElement = document.createElement('div');
    this.listElement.className = 'autocomplete-list';
    this.listElement.style.maxHeight = `${this.dropdownOptions.maxHeight}px`;
    this.element.appendChild(this.listElement);

    this.setupKeyboardHandler();
  }

  private setupKeyboardHandler(): void {
    // Keyboard handling is done by the editor, not the dropdown itself
  }

  /**
   * Show the dropdown with suggestions at a specific position
   */
  showAt(x: number, y: number, suggestions: AutocompleteSuggestion[]): this {
    this.suggestions = suggestions;
    this.selectedIndex = 0;
    this.dropdownVisible = true;

    this.element.style.left = `${x}px`;
    this.element.style.top = `${y}px`;
    this.element.classList.add('autocomplete-dropdown--visible');

    this.renderSuggestions();
    return this;
  }

  /**
   * Hide the dropdown
   */
  hideDropdown(): this {
    this.dropdownVisible = false;
    this.element.classList.remove('autocomplete-dropdown--visible');
    this.dropdownOptions.onDismiss?.();
    return this;
  }

  /**
   * Check if dropdown is visible
   */
  getIsVisible(): boolean {
    return this.dropdownVisible;
  }

  /**
   * Move selection up
   */
  selectPrevious(): this {
    if (this.suggestions.length === 0) return this;
    this.selectedIndex = Math.max(0, this.selectedIndex - 1);
    this.updateSelection();
    return this;
  }

  /**
   * Move selection down
   */
  selectNext(): this {
    if (this.suggestions.length === 0) return this;
    this.selectedIndex = Math.min(this.suggestions.length - 1, this.selectedIndex + 1);
    this.updateSelection();
    return this;
  }

  /**
   * Accept the current selection
   */
  acceptSelected(): AutocompleteSuggestion | null {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.suggestions.length) {
      const suggestion = this.suggestions[this.selectedIndex];
      this.dropdownOptions.onSelect?.(suggestion);
      this.hideDropdown();
      return suggestion;
    }
    return null;
  }

  /**
   * Get the currently selected suggestion
   */
  getSelected(): AutocompleteSuggestion | null {
    if (this.selectedIndex >= 0 && this.selectedIndex < this.suggestions.length) {
      return this.suggestions[this.selectedIndex];
    }
    return null;
  }

  /**
   * Update suggestions without repositioning
   */
  updateSuggestions(suggestions: AutocompleteSuggestion[]): this {
    this.suggestions = suggestions;
    this.selectedIndex = suggestions.length > 0 ? 0 : -1;
    this.renderSuggestions();
    return this;
  }

  private renderSuggestions(): void {
    this.listElement.innerHTML = '';

    if (this.suggestions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'autocomplete-empty';
      empty.textContent = 'No suggestions';
      this.listElement.appendChild(empty);
      return;
    }

    this.suggestions.forEach((suggestion, index) => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.dataset.index = String(index);

      if (index === this.selectedIndex) {
        item.classList.add('autocomplete-item--selected');
      }

      // Icon
      const icon = document.createElement('span');
      icon.className = `autocomplete-icon autocomplete-icon--${suggestion.kind}`;
      icon.innerHTML = KIND_ICONS[suggestion.kind] || KIND_ICONS.text;
      item.appendChild(icon);

      // Content
      const content = document.createElement('div');
      content.className = 'autocomplete-content';

      const label = document.createElement('span');
      label.className = 'autocomplete-label';
      label.textContent = suggestion.label;
      content.appendChild(label);

      if (suggestion.detail) {
        const detail = document.createElement('span');
        detail.className = 'autocomplete-detail';
        detail.textContent = suggestion.detail;
        content.appendChild(detail);
      }

      item.appendChild(content);

      // Kind badge
      const kindBadge = document.createElement('span');
      kindBadge.className = 'autocomplete-kind';
      kindBadge.textContent = suggestion.kind;
      item.appendChild(kindBadge);

      // Click handler
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectedIndex = index;
        this.acceptSelected();
      });

      // Hover handler
      item.addEventListener('mouseenter', () => {
        this.selectedIndex = index;
        this.updateSelection();
      });

      this.listElement.appendChild(item);
    });
  }

  private updateSelection(): void {
    const items = this.listElement.querySelectorAll('.autocomplete-item');
    items.forEach((item, index) => {
      item.classList.toggle('autocomplete-item--selected', index === this.selectedIndex);
    });

    // Scroll selected item into view
    const selectedItem = items[this.selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({ block: 'nearest' });
    }
  }
}
