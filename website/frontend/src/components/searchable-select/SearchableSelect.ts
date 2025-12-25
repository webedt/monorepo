import { Component, ComponentOptions } from '../base';
import './searchable-select.css';

export type SearchableSelectSize = 'sm' | 'md' | 'lg';

export interface SearchableSelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SearchableSelectOptions extends ComponentOptions {
  size?: SearchableSelectSize;
  placeholder?: string;
  searchPlaceholder?: string;
  value?: string;
  name?: string;
  disabled?: boolean;
  required?: boolean;
  label?: string;
  options?: SearchableSelectOption[];
  onChange?: (value: string, option: SearchableSelectOption | null) => void;
  onSearch?: (query: string) => void;
}

export class SearchableSelect extends Component<HTMLDivElement> {
  private triggerElement: HTMLButtonElement;
  private dropdownElement: HTMLDivElement;
  private searchInput: HTMLInputElement;
  private optionsContainer: HTMLDivElement;
  private labelElement?: HTMLLabelElement;
  private options: SearchableSelectOptions;
  private selectOptions: SearchableSelectOption[] = [];
  private filteredOptions: SearchableSelectOption[] = [];
  private selectedOption: SearchableSelectOption | null = null;
  private isOpen = false;
  private focusedIndex = -1;

  constructor(options: SearchableSelectOptions = {}) {
    super('div', {
      className: 'searchable-select',
      ...options,
    });

    this.options = {
      size: 'md',
      placeholder: 'Select...',
      searchPlaceholder: 'Search...',
      ...options,
    };

    this.selectOptions = options.options ?? [];
    this.filteredOptions = [...this.selectOptions];

    // Find initially selected option
    if (options.value) {
      this.selectedOption = this.selectOptions.find(o => o.value === options.value) ?? null;
    }

    // Create elements
    this.triggerElement = document.createElement('button');
    this.triggerElement.type = 'button';
    this.triggerElement.className = 'searchable-select-trigger';

    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'searchable-select-dropdown';

    this.searchInput = document.createElement('input');
    this.searchInput.type = 'text';
    this.searchInput.className = 'searchable-select-search';
    this.searchInput.placeholder = this.options.searchPlaceholder!;

    this.optionsContainer = document.createElement('div');
    this.optionsContainer.className = 'searchable-select-options';

    this.buildStructure();
    this.applyOptions();
    this.setupEventListeners();
    this.renderOptions();
  }

  private buildStructure(): void {
    const { label } = this.options;

    if (label) {
      this.labelElement = document.createElement('label');
      this.labelElement.className = 'searchable-select-label';
      this.labelElement.textContent = label;

      if (this.options.required) {
        this.labelElement.classList.add('searchable-select-label--required');
      }

      this.element.appendChild(this.labelElement);
    }

    this.element.appendChild(this.triggerElement);

    const searchWrapper = document.createElement('div');
    searchWrapper.className = 'searchable-select-search-wrapper';
    searchWrapper.appendChild(this.searchInput);

    this.dropdownElement.appendChild(searchWrapper);
    this.dropdownElement.appendChild(this.optionsContainer);
    this.element.appendChild(this.dropdownElement);

    this.updateTriggerText();
  }

  private applyOptions(): void {
    const { size, disabled } = this.options;

    if (size && size !== 'md') {
      this.element.classList.add(`searchable-select--${size}`);
    }

    if (disabled) {
      this.triggerElement.disabled = true;
      this.element.classList.add('searchable-select--disabled');
    }
  }

  private setupEventListeners(): void {
    // Toggle dropdown on trigger click
    this.on(this.triggerElement, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });

    // Filter on search input
    this.on(this.searchInput, 'input', () => {
      this.filterOptions(this.searchInput.value);
      this.options.onSearch?.(this.searchInput.value);
    });

    // Keyboard navigation
    this.on(this.searchInput, 'keydown', (e) => {
      const keyEvent = e as KeyboardEvent;
      switch (keyEvent.key) {
        case 'ArrowDown':
          keyEvent.preventDefault();
          this.focusNext();
          break;
        case 'ArrowUp':
          keyEvent.preventDefault();
          this.focusPrevious();
          break;
        case 'Enter':
          keyEvent.preventDefault();
          if (this.focusedIndex >= 0 && this.focusedIndex < this.filteredOptions.length) {
            this.selectOption(this.filteredOptions[this.focusedIndex]);
          }
          break;
        case 'Escape':
          keyEvent.preventDefault();
          this.close();
          this.triggerElement.focus();
          break;
        case 'Tab':
          this.close();
          break;
      }
    });

    // Close on outside click
    this.on(document, 'click', ((e: MouseEvent) => {
      if (this.isOpen && !this.element.contains(e.target as Node)) {
        this.close();
      }
    }) as EventListener);

    // Keyboard navigation on trigger
    this.on(this.triggerElement, 'keydown', (e) => {
      const keyEvent = e as KeyboardEvent;
      if (keyEvent.key === 'ArrowDown' || keyEvent.key === 'Enter' || keyEvent.key === ' ') {
        keyEvent.preventDefault();
        this.open();
      }
    });
  }

  private filterOptions(query: string): void {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      this.filteredOptions = [...this.selectOptions];
    } else {
      this.filteredOptions = this.selectOptions.filter(opt =>
        opt.label.toLowerCase().includes(lowerQuery) ||
        opt.value.toLowerCase().includes(lowerQuery)
      );
    }

    this.focusedIndex = -1;
    this.renderOptions();
  }

  private renderOptions(): void {
    this.optionsContainer.innerHTML = '';

    if (this.filteredOptions.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'searchable-select-empty';
      emptyEl.textContent = 'No results found';
      this.optionsContainer.appendChild(emptyEl);
      return;
    }

    this.filteredOptions.forEach((opt, index) => {
      const optionEl = document.createElement('button');
      optionEl.type = 'button';
      optionEl.className = 'searchable-select-option';
      optionEl.dataset.value = opt.value;
      optionEl.textContent = opt.label;

      if (opt.disabled) {
        optionEl.classList.add('searchable-select-option--disabled');
        optionEl.disabled = true;
      }

      if (this.selectedOption?.value === opt.value) {
        optionEl.classList.add('searchable-select-option--selected');
      }

      if (index === this.focusedIndex) {
        optionEl.classList.add('searchable-select-option--focused');
      }

      optionEl.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!opt.disabled) {
          this.selectOption(opt);
        }
      });

      this.optionsContainer.appendChild(optionEl);
    });
  }

  private selectOption(option: SearchableSelectOption): void {
    this.selectedOption = option;
    this.updateTriggerText();
    this.close();
    this.triggerElement.focus();
    this.options.onChange?.(option.value, option);
  }

  private updateTriggerText(): void {
    const text = this.selectedOption?.label ?? this.options.placeholder ?? 'Select...';
    this.triggerElement.innerHTML = `
      <span class="searchable-select-trigger-text">${this.escapeHtml(text)}</span>
      <span class="searchable-select-trigger-icon">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
          <path d="M6 8L1 3h10z"/>
        </svg>
      </span>
    `;

    if (this.selectedOption) {
      this.triggerElement.classList.remove('searchable-select-trigger--placeholder');
    } else {
      this.triggerElement.classList.add('searchable-select-trigger--placeholder');
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private focusNext(): void {
    const enabledOptions = this.filteredOptions.filter(o => !o.disabled);
    if (enabledOptions.length === 0) return;

    this.focusedIndex = Math.min(this.focusedIndex + 1, this.filteredOptions.length - 1);

    // Skip disabled options
    while (this.focusedIndex < this.filteredOptions.length && this.filteredOptions[this.focusedIndex].disabled) {
      this.focusedIndex++;
    }

    if (this.focusedIndex >= this.filteredOptions.length) {
      this.focusedIndex = this.filteredOptions.length - 1;
    }

    this.renderOptions();
    this.scrollToFocused();
  }

  private focusPrevious(): void {
    const enabledOptions = this.filteredOptions.filter(o => !o.disabled);
    if (enabledOptions.length === 0) return;

    this.focusedIndex = Math.max(this.focusedIndex - 1, 0);

    // Skip disabled options
    while (this.focusedIndex >= 0 && this.filteredOptions[this.focusedIndex].disabled) {
      this.focusedIndex--;
    }

    if (this.focusedIndex < 0) {
      this.focusedIndex = 0;
    }

    this.renderOptions();
    this.scrollToFocused();
  }

  private scrollToFocused(): void {
    const focusedEl = this.optionsContainer.querySelector('.searchable-select-option--focused');
    if (focusedEl) {
      focusedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  open(): this {
    if (this.isOpen || this.options.disabled) return this;

    this.isOpen = true;
    this.element.classList.add('searchable-select--open');
    this.searchInput.value = '';
    this.filterOptions('');
    this.focusedIndex = -1;

    // Focus search input after dropdown visibility transition completes
    const focusAfterTransition = () => {
      this.searchInput.focus();
      this.dropdownElement.removeEventListener('transitionend', focusAfterTransition);
    };
    this.dropdownElement.addEventListener('transitionend', focusAfterTransition, { once: true });

    // Fallback in case transitionend doesn't fire
    setTimeout(() => {
      if (this.isOpen && document.activeElement !== this.searchInput) {
        this.searchInput.focus();
      }
    }, 200);

    return this;
  }

  close(): this {
    if (!this.isOpen) return this;

    this.isOpen = false;
    this.element.classList.remove('searchable-select--open');
    this.focusedIndex = -1;

    return this;
  }

  toggle(): this {
    return this.isOpen ? this.close() : this.open();
  }

  getValue(): string {
    return this.selectedOption?.value ?? '';
  }

  setValue(value: string): this {
    const option = this.selectOptions.find(o => o.value === value);
    if (option) {
      this.selectedOption = option;
      this.updateTriggerText();
    } else {
      this.selectedOption = null;
      this.updateTriggerText();
    }
    return this;
  }

  getSelectedOption(): SearchableSelectOption | null {
    return this.selectedOption;
  }

  setDisabled(disabled: boolean): this {
    this.options.disabled = disabled;
    this.triggerElement.disabled = disabled;
    this.element.classList.toggle('searchable-select--disabled', disabled);
    if (disabled && this.isOpen) {
      this.close();
    }
    return this;
  }

  isDisabled(): boolean {
    return this.options.disabled ?? false;
  }

  setOptions(options: SearchableSelectOption[]): this {
    this.selectOptions = options;
    this.filteredOptions = [...options];

    // Clear selection if current value is no longer in options
    if (this.selectedOption && !options.find(o => o.value === this.selectedOption!.value)) {
      this.selectedOption = null;
      this.updateTriggerText();
    }

    this.renderOptions();
    return this;
  }

  setPlaceholder(placeholder: string): this {
    this.options.placeholder = placeholder;
    if (!this.selectedOption) {
      this.updateTriggerText();
    }
    return this;
  }

  clear(): this {
    this.selectedOption = null;
    this.updateTriggerText();
    return this;
  }

  focus(): this {
    this.triggerElement.focus();
    return this;
  }

  blur(): this {
    this.triggerElement.blur();
    return this;
  }
}
