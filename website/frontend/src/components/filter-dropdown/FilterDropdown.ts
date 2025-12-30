import { Component, ComponentOptions } from '../base';
import './filter-dropdown.css';

export type FilterType = 'select' | 'multi-select' | 'range' | 'checkbox';

export interface FilterOption {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface RangeValue {
  min?: number;
  max?: number;
}

export interface FilterDropdownOptions extends ComponentOptions {
  type: FilterType;
  label: string;
  placeholder?: string;
  options?: FilterOption[];
  value?: string | string[] | RangeValue | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  showCounts?: boolean;
  searchable?: boolean;
  clearable?: boolean;
  disabled?: boolean;
  onChange?: (value: string | string[] | RangeValue | boolean) => void;
}

export class FilterDropdown extends Component<HTMLDivElement> {
  private static instances: Set<FilterDropdown> = new Set();

  private triggerElement: HTMLButtonElement;
  private dropdownElement: HTMLDivElement;
  private searchInput?: HTMLInputElement;
  private optionsContainer: HTMLDivElement;
  private options: FilterDropdownOptions;
  private filterOptions: FilterOption[] = [];
  private filteredOptions: FilterOption[] = [];
  private isOpen = false;
  private focusedIndex = -1;

  // Values for different filter types
  private selectedValue: string = '';
  private selectedValues: Set<string> = new Set();
  private rangeValue: RangeValue = {};
  private checkboxValue = false;

  // Track option click handlers for cleanup
  private optionClickHandlers: Array<{ element: HTMLElement; handler: EventListener }> = [];
  private dropdownId: string;

  constructor(options: FilterDropdownOptions) {
    super('div', {
      className: 'filter-dropdown',
      ...options,
    });

    this.options = {
      placeholder: 'Select...',
      clearable: true,
      searchable: false,
      ...options,
    };

    this.filterOptions = options.options ?? [];
    this.filteredOptions = [...this.filterOptions];

    // Initialize values based on type
    this.initializeValue();

    // Generate unique ID for ARIA attributes
    this.dropdownId = `filter-dropdown-${Math.random().toString(36).substring(2, 9)}`;

    // Create elements
    this.triggerElement = document.createElement('button');
    this.triggerElement.type = 'button';
    this.triggerElement.className = 'filter-dropdown__trigger';

    this.dropdownElement = document.createElement('div');
    this.dropdownElement.className = 'filter-dropdown__dropdown';
    this.dropdownElement.id = `${this.dropdownId}-listbox`;

    this.optionsContainer = document.createElement('div');
    this.optionsContainer.className = 'filter-dropdown__options';
    this.optionsContainer.setAttribute('role', 'listbox');

    // Set up ARIA attributes on trigger
    if (this.options.type !== 'checkbox') {
      this.triggerElement.setAttribute('aria-haspopup', 'listbox');
      this.triggerElement.setAttribute('aria-expanded', 'false');
      this.triggerElement.setAttribute('aria-controls', `${this.dropdownId}-listbox`);
    }

    this.buildStructure();
    this.setupEventListeners();
    this.updateTrigger();

    FilterDropdown.instances.add(this);
  }

  private static closeOthers(except: FilterDropdown): void {
    for (const instance of FilterDropdown.instances) {
      if (instance !== except && instance.isOpen) {
        instance.close();
      }
    }
  }

  private initializeValue(): void {
    const { type, value } = this.options;

    switch (type) {
      case 'select':
        this.selectedValue = (value as string) ?? '';
        break;
      case 'multi-select':
        if (Array.isArray(value)) {
          this.selectedValues = new Set(value);
        }
        break;
      case 'range':
        this.rangeValue = (value as RangeValue) ?? {};
        break;
      case 'checkbox':
        this.checkboxValue = (value as boolean) ?? false;
        break;
    }
  }

  private buildStructure(): void {
    const { type, searchable } = this.options;

    this.element.appendChild(this.triggerElement);

    // Add search input for searchable dropdowns
    if (searchable && (type === 'select' || type === 'multi-select')) {
      const searchWrapper = document.createElement('div');
      searchWrapper.className = 'filter-dropdown__search-wrapper';

      this.searchInput = document.createElement('input');
      this.searchInput.type = 'text';
      this.searchInput.className = 'filter-dropdown__search';
      this.searchInput.placeholder = 'Search...';

      searchWrapper.appendChild(this.searchInput);
      this.dropdownElement.appendChild(searchWrapper);
    }

    // Build content based on type
    if (type === 'range') {
      this.buildRangeContent();
    } else if (type === 'checkbox') {
      // Checkbox doesn't need dropdown
      return;
    } else {
      this.dropdownElement.appendChild(this.optionsContainer);
      this.renderOptions();
    }

    this.element.appendChild(this.dropdownElement);
  }

  private buildRangeContent(): void {
    const { min = 0, max = 100, step = 1, unit = '' } = this.options;
    const rangeContainer = document.createElement('div');
    rangeContainer.className = 'filter-dropdown__range';

    // Escape unit to prevent XSS
    const escapedUnit = this.escapeHtml(unit);

    // Ensure numeric values are valid numbers to prevent HTML injection
    const safeMin = Number(min) || 0;
    const safeMax = Number(max) || 100;
    const safeStep = Number(step) || 1;
    const safeRangeMin = this.rangeValue.min != null ? Number(this.rangeValue.min) : '';
    const safeRangeMax = this.rangeValue.max != null ? Number(this.rangeValue.max) : '';

    rangeContainer.innerHTML = `
      <div class="filter-dropdown__range-inputs">
        <div class="filter-dropdown__range-field">
          <label>Min${escapedUnit ? ` (${escapedUnit})` : ''}</label>
          <input
            type="number"
            class="filter-dropdown__range-input"
            data-range="min"
            min="${safeMin}"
            max="${safeMax}"
            step="${safeStep}"
            value="${safeRangeMin}"
            placeholder="${safeMin}"
          />
        </div>
        <span class="filter-dropdown__range-separator">to</span>
        <div class="filter-dropdown__range-field">
          <label>Max${escapedUnit ? ` (${escapedUnit})` : ''}</label>
          <input
            type="number"
            class="filter-dropdown__range-input"
            data-range="max"
            min="${safeMin}"
            max="${safeMax}"
            step="${safeStep}"
            value="${safeRangeMax}"
            placeholder="${safeMax}"
          />
        </div>
      </div>
      <div class="filter-dropdown__range-presets">
        <button type="button" class="filter-dropdown__preset" data-min="0" data-max="0">Free</button>
        <button type="button" class="filter-dropdown__preset" data-min="0" data-max="10">Under $10</button>
        <button type="button" class="filter-dropdown__preset" data-min="10" data-max="30">$10-$30</button>
        <button type="button" class="filter-dropdown__preset" data-min="30" data-max="">$30+</button>
      </div>
      <div class="filter-dropdown__range-actions">
        <button type="button" class="filter-dropdown__btn filter-dropdown__btn--secondary" data-action="clear">Clear</button>
        <button type="button" class="filter-dropdown__btn filter-dropdown__btn--primary" data-action="apply">Apply</button>
      </div>
    `;

    this.dropdownElement.appendChild(rangeContainer);
  }

  private setupEventListeners(): void {
    const { type } = this.options;

    if (type === 'checkbox') {
      // Toggle checkbox on trigger click
      this.on(this.triggerElement, 'click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.checkboxValue = !this.checkboxValue;
        this.updateTrigger();
        this.options.onChange?.(this.checkboxValue);
      });
      return;
    }

    // Toggle dropdown on trigger click
    this.on(this.triggerElement, 'click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });

    // Search input handling
    if (this.searchInput) {
      this.on(this.searchInput, 'input', () => {
        this.filterOptionsList(this.searchInput!.value);
      });

      this.on(this.searchInput, 'keydown', (e) => {
        this.handleKeydown(e as KeyboardEvent);
      });
    }

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

    // Range-specific event handlers
    if (type === 'range') {
      this.setupRangeEventListeners();
    }
  }

  private setupRangeEventListeners(): void {
    // Range input changes
    const rangeInputs = this.dropdownElement.querySelectorAll('.filter-dropdown__range-input');
    rangeInputs.forEach((input) => {
      this.on(input as HTMLElement, 'input', () => {
        const minInput = this.dropdownElement.querySelector('[data-range="min"]') as HTMLInputElement;
        const maxInput = this.dropdownElement.querySelector('[data-range="max"]') as HTMLInputElement;
        this.rangeValue = {
          min: minInput.value ? parseFloat(minInput.value) : undefined,
          max: maxInput.value ? parseFloat(maxInput.value) : undefined,
        };
      });
    });

    // Preset buttons
    const presetButtons = this.dropdownElement.querySelectorAll('.filter-dropdown__preset');
    presetButtons.forEach((btn) => {
      this.on(btn as HTMLElement, 'click', (e) => {
        const button = e.currentTarget as HTMLButtonElement;
        const min = button.dataset.min;
        const max = button.dataset.max;

        this.rangeValue = {
          min: min !== '' ? parseFloat(min!) : undefined,
          max: max !== '' ? parseFloat(max!) : undefined,
        };

        // Update inputs
        const minInput = this.dropdownElement.querySelector('[data-range="min"]') as HTMLInputElement;
        const maxInput = this.dropdownElement.querySelector('[data-range="max"]') as HTMLInputElement;
        minInput.value = min !== '' ? min! : '';
        maxInput.value = max !== '' ? max! : '';
      });
    });

    // Action buttons
    const actionButtons = this.dropdownElement.querySelectorAll('[data-action]');
    actionButtons.forEach((btn) => {
      this.on(btn as HTMLElement, 'click', (e) => {
        const button = e.currentTarget as HTMLButtonElement;
        const action = button.dataset.action;

        if (action === 'apply') {
          this.updateTrigger();
          this.close();
          this.options.onChange?.(this.rangeValue);
        } else if (action === 'clear') {
          this.rangeValue = {};
          const minInput = this.dropdownElement.querySelector('[data-range="min"]') as HTMLInputElement;
          const maxInput = this.dropdownElement.querySelector('[data-range="max"]') as HTMLInputElement;
          minInput.value = '';
          maxInput.value = '';
          this.updateTrigger();
          this.close();
          this.options.onChange?.(this.rangeValue);
        }
      });
    });
  }

  private handleKeydown(e: KeyboardEvent): void {
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
        if (this.focusedIndex >= 0 && this.focusedIndex < this.filteredOptions.length) {
          this.selectOption(this.filteredOptions[this.focusedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.close();
        this.triggerElement.focus();
        break;
      case 'Tab':
        this.close();
        break;
    }
  }

  private filterOptionsList(query: string): void {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      this.filteredOptions = [...this.filterOptions];
    } else {
      this.filteredOptions = this.filterOptions.filter(
        (opt) =>
          opt.label.toLowerCase().includes(lowerQuery) ||
          opt.value.toLowerCase().includes(lowerQuery)
      );
    }

    this.focusedIndex = -1;
    this.renderOptions();
  }

  private cleanupOptionListeners(): void {
    for (const { element, handler } of this.optionClickHandlers) {
      element.removeEventListener('click', handler);
    }
    this.optionClickHandlers = [];
  }

  private addOptionClickHandler(element: HTMLElement, handler: EventListener): void {
    element.addEventListener('click', handler);
    this.optionClickHandlers.push({ element, handler });
  }

  private renderOptions(): void {
    const { type, showCounts, clearable } = this.options;

    // Clean up existing listeners before re-rendering
    this.cleanupOptionListeners();
    this.optionsContainer.innerHTML = '';

    // Add "All" option for single select if clearable
    if (type === 'select' && clearable) {
      const allOption = document.createElement('button');
      allOption.type = 'button';
      allOption.className = 'filter-dropdown__option';
      allOption.setAttribute('role', 'option');
      allOption.setAttribute('aria-selected', (!this.selectedValue).toString());
      if (!this.selectedValue) {
        allOption.classList.add('filter-dropdown__option--selected');
      }
      allOption.textContent = 'All';

      const allHandler = ((e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        this.selectedValue = '';
        this.updateTrigger();
        this.close();
        this.options.onChange?.('');
      }) as EventListener;

      this.addOptionClickHandler(allOption, allHandler);
      this.optionsContainer.appendChild(allOption);
    }

    if (this.filteredOptions.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'filter-dropdown__empty';
      emptyEl.textContent = 'No results found';
      this.optionsContainer.appendChild(emptyEl);
      return;
    }

    this.filteredOptions.forEach((opt, index) => {
      const optionEl = document.createElement('button');
      optionEl.type = 'button';
      optionEl.className = 'filter-dropdown__option';
      optionEl.dataset.value = opt.value;
      optionEl.setAttribute('role', 'option');

      const isSelected =
        (type === 'select' && this.selectedValue === opt.value) ||
        (type === 'multi-select' && this.selectedValues.has(opt.value));

      optionEl.setAttribute('aria-selected', isSelected.toString());

      if (opt.disabled) {
        optionEl.classList.add('filter-dropdown__option--disabled');
        optionEl.disabled = true;
        optionEl.setAttribute('aria-disabled', 'true');
      }

      // Check selected state based on type
      if (isSelected) {
        optionEl.classList.add('filter-dropdown__option--selected');
      }

      if (index === this.focusedIndex) {
        optionEl.classList.add('filter-dropdown__option--focused');
      }

      // Build option content
      if (type === 'multi-select') {
        const checkbox = document.createElement('span');
        checkbox.className = 'filter-dropdown__checkbox';
        if (this.selectedValues.has(opt.value)) {
          checkbox.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M10.28 2.28a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06L4.25 7.19l4.97-4.97a.75.75 0 0 1 1.06 0Z"/>
          </svg>`;
        }
        optionEl.appendChild(checkbox);
      }

      const labelSpan = document.createElement('span');
      labelSpan.className = 'filter-dropdown__option-label';
      labelSpan.textContent = opt.label;
      optionEl.appendChild(labelSpan);

      if (showCounts && opt.count !== undefined) {
        const countSpan = document.createElement('span');
        countSpan.className = 'filter-dropdown__option-count';
        countSpan.textContent = `(${opt.count})`;
        optionEl.appendChild(countSpan);
      }

      const optHandler = ((e: Event) => {
        e.preventDefault();
        e.stopPropagation();
        if (!opt.disabled) {
          this.selectOption(opt);
        }
      }) as EventListener;

      this.addOptionClickHandler(optionEl, optHandler);
      this.optionsContainer.appendChild(optionEl);
    });
  }

  private selectOption(option: FilterOption): void {
    const { type } = this.options;

    if (type === 'select') {
      this.selectedValue = option.value;
      this.updateTrigger();
      this.close();
      this.triggerElement.focus();
      this.options.onChange?.(option.value);
    } else if (type === 'multi-select') {
      if (this.selectedValues.has(option.value)) {
        this.selectedValues.delete(option.value);
      } else {
        this.selectedValues.add(option.value);
      }
      this.renderOptions();
      this.updateTrigger();
      this.options.onChange?.(Array.from(this.selectedValues));
    }
  }

  private updateTrigger(): void {
    const { type, label, placeholder } = this.options;

    let displayText = '';
    let hasValue = false;

    switch (type) {
      case 'select': {
        if (this.selectedValue) {
          const option = this.filterOptions.find((o) => o.value === this.selectedValue);
          displayText = option?.label ?? this.selectedValue;
          hasValue = true;
        } else {
          displayText = placeholder ?? 'All';
        }
        break;
      }
      case 'multi-select': {
        if (this.selectedValues.size > 0) {
          if (this.selectedValues.size === 1) {
            const value = Array.from(this.selectedValues)[0];
            const option = this.filterOptions.find((o) => o.value === value);
            displayText = option?.label ?? value;
          } else {
            displayText = `${this.selectedValues.size} selected`;
          }
          hasValue = true;
        } else {
          displayText = placeholder ?? 'All';
        }
        break;
      }
      case 'range': {
        const { unit = '$' } = this.options;
        if (this.rangeValue.min !== undefined || this.rangeValue.max !== undefined) {
          if (this.rangeValue.min === 0 && this.rangeValue.max === 0) {
            displayText = 'Free';
          } else if (this.rangeValue.min !== undefined && this.rangeValue.max !== undefined) {
            displayText = `${unit}${this.rangeValue.min} - ${unit}${this.rangeValue.max}`;
          } else if (this.rangeValue.min !== undefined) {
            displayText = `${unit}${this.rangeValue.min}+`;
          } else {
            displayText = `Up to ${unit}${this.rangeValue.max}`;
          }
          hasValue = true;
        } else {
          displayText = placeholder ?? 'Any price';
        }
        break;
      }
      case 'checkbox': {
        displayText = label;
        hasValue = this.checkboxValue;
        break;
      }
    }

    if (type === 'checkbox') {
      this.triggerElement.innerHTML = `
        <span class="filter-dropdown__checkbox-icon ${hasValue ? 'filter-dropdown__checkbox-icon--checked' : ''}">
          ${hasValue ? `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M10.28 2.28a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06L4.25 7.19l4.97-4.97a.75.75 0 0 1 1.06 0Z"/>
          </svg>` : ''}
        </span>
        <span class="filter-dropdown__trigger-text">${this.escapeHtml(displayText)}</span>
      `;
    } else {
      this.triggerElement.innerHTML = `
        <span class="filter-dropdown__trigger-label">${this.escapeHtml(label)}</span>
        <span class="filter-dropdown__trigger-value ${hasValue ? 'filter-dropdown__trigger-value--active' : ''}">
          ${this.escapeHtml(displayText)}
        </span>
        <span class="filter-dropdown__trigger-icon">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 8L1 3h10z"/>
          </svg>
        </span>
      `;
    }

    this.element.classList.toggle('filter-dropdown--has-value', hasValue);
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private focusNext(): void {
    if (this.filteredOptions.length === 0) return;
    this.focusedIndex = Math.min(this.focusedIndex + 1, this.filteredOptions.length - 1);
    while (
      this.focusedIndex < this.filteredOptions.length &&
      this.filteredOptions[this.focusedIndex].disabled
    ) {
      this.focusedIndex++;
    }
    if (this.focusedIndex >= this.filteredOptions.length) {
      this.focusedIndex = this.filteredOptions.length - 1;
    }
    this.renderOptions();
    this.scrollToFocused();
  }

  private focusPrevious(): void {
    if (this.filteredOptions.length === 0) return;
    this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
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
    const focusedEl = this.optionsContainer.querySelector('.filter-dropdown__option--focused');
    if (focusedEl) {
      focusedEl.scrollIntoView({ block: 'nearest' });
    }
  }

  open(): this {
    if (this.isOpen || this.options.disabled || this.options.type === 'checkbox') return this;

    FilterDropdown.closeOthers(this);

    this.isOpen = true;
    this.element.classList.add('filter-dropdown--open');
    this.triggerElement.setAttribute('aria-expanded', 'true');
    this.focusedIndex = -1;

    if (this.searchInput) {
      this.searchInput.value = '';
      this.filterOptionsList('');
      setTimeout(() => this.searchInput?.focus(), 50);
    }

    return this;
  }

  close(): this {
    if (!this.isOpen) return this;

    this.isOpen = false;
    this.element.classList.remove('filter-dropdown--open');
    this.triggerElement.setAttribute('aria-expanded', 'false');
    this.focusedIndex = -1;

    return this;
  }

  toggle(): this {
    return this.isOpen ? this.close() : this.open();
  }

  getValue(): string | string[] | RangeValue | boolean {
    switch (this.options.type) {
      case 'select':
        return this.selectedValue;
      case 'multi-select':
        return Array.from(this.selectedValues);
      case 'range':
        return this.rangeValue;
      case 'checkbox':
        return this.checkboxValue;
    }
  }

  setValue(value: string | string[] | RangeValue | boolean): this {
    switch (this.options.type) {
      case 'select':
        this.selectedValue = value as string;
        break;
      case 'multi-select':
        this.selectedValues = new Set(value as string[]);
        break;
      case 'range':
        this.rangeValue = value as RangeValue;
        break;
      case 'checkbox':
        this.checkboxValue = value as boolean;
        break;
    }
    this.updateTrigger();
    if (this.options.type === 'select' || this.options.type === 'multi-select') {
      this.renderOptions();
    }
    return this;
  }

  clear(): this {
    switch (this.options.type) {
      case 'select':
        this.selectedValue = '';
        break;
      case 'multi-select':
        this.selectedValues.clear();
        break;
      case 'range':
        this.rangeValue = {};
        break;
      case 'checkbox':
        this.checkboxValue = false;
        break;
    }
    this.updateTrigger();
    if (this.options.type === 'select' || this.options.type === 'multi-select') {
      this.renderOptions();
    }
    return this;
  }

  setOptions(options: FilterOption[]): this {
    this.filterOptions = options;
    this.filteredOptions = [...options];
    this.renderOptions();
    return this;
  }

  setDisabled(disabled: boolean): this {
    this.options.disabled = disabled;
    this.triggerElement.disabled = disabled;
    this.element.classList.toggle('filter-dropdown--disabled', disabled);
    if (disabled && this.isOpen) {
      this.close();
    }
    return this;
  }

  protected onUnmount(): void {
    this.cleanupOptionListeners();
    FilterDropdown.instances.delete(this);
  }
}
