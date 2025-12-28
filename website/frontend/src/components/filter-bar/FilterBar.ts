import { Component, ComponentOptions } from '../base';
import { FilterDropdown, FilterOption, RangeValue } from '../filter-dropdown';
import './filter-bar.css';

export interface FilterConfig {
  id: string;
  type: 'select' | 'multi-select' | 'range' | 'checkbox';
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
}

export interface FilterBarOptions extends ComponentOptions {
  filters: FilterConfig[];
  searchable?: boolean;
  searchPlaceholder?: string;
  searchValue?: string;
  showClearAll?: boolean;
  showResultCount?: boolean;
  resultCount?: number;
  onFilterChange?: (filterId: string, value: string | string[] | RangeValue | boolean) => void;
  onSearchChange?: (query: string) => void;
  onClearAll?: () => void;
}

export interface FilterValues {
  [key: string]: string | string[] | RangeValue | boolean;
}

export class FilterBar extends Component<HTMLDivElement> {
  private options: FilterBarOptions;
  private filterDropdowns: Map<string, FilterDropdown> = new Map();
  private searchInput?: HTMLInputElement;
  private filtersContainer: HTMLDivElement;
  private searchDebounceTimer?: number;

  constructor(options: FilterBarOptions) {
    super('div', {
      className: 'filter-bar',
      ...options,
    });

    this.options = {
      searchPlaceholder: 'Search...',
      showClearAll: true,
      showResultCount: false,
      ...options,
    };

    this.filtersContainer = document.createElement('div');
    this.filtersContainer.className = 'filter-bar__filters';

    this.buildStructure();
  }

  private buildStructure(): void {
    const { searchable, showClearAll, showResultCount, resultCount } = this.options;

    // Search section
    if (searchable) {
      const searchSection = document.createElement('div');
      searchSection.className = 'filter-bar__search';

      this.searchInput = document.createElement('input');
      this.searchInput.type = 'text';
      this.searchInput.className = 'filter-bar__search-input';
      this.searchInput.placeholder = this.options.searchPlaceholder!;
      this.searchInput.value = this.options.searchValue ?? '';

      const searchIcon = document.createElement('span');
      searchIcon.className = 'filter-bar__search-icon';
      searchIcon.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z"/>
        </svg>
      `;

      searchSection.appendChild(searchIcon);
      searchSection.appendChild(this.searchInput);

      this.element.appendChild(searchSection);

      // Search input event
      this.on(this.searchInput, 'input', () => {
        if (this.searchDebounceTimer) {
          clearTimeout(this.searchDebounceTimer);
        }
        this.searchDebounceTimer = window.setTimeout(() => {
          this.options.onSearchChange?.(this.searchInput!.value);
        }, 300);
      });
    }

    // Filters section
    this.element.appendChild(this.filtersContainer);
    this.buildFilters();

    // Actions section (clear all, result count)
    if (showClearAll || showResultCount) {
      const actionsSection = document.createElement('div');
      actionsSection.className = 'filter-bar__actions';

      if (showResultCount && resultCount !== undefined) {
        const countEl = document.createElement('span');
        countEl.className = 'filter-bar__result-count';
        countEl.textContent = `${resultCount} result${resultCount !== 1 ? 's' : ''}`;
        actionsSection.appendChild(countEl);
      }

      if (showClearAll) {
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'filter-bar__clear-btn';
        clearBtn.textContent = 'Clear filters';
        this.on(clearBtn, 'click', () => {
          this.clearAll();
          this.options.onClearAll?.();
        });
        actionsSection.appendChild(clearBtn);
      }

      this.element.appendChild(actionsSection);
    }
  }

  private buildFilters(): void {
    this.filtersContainer.innerHTML = '';
    this.filterDropdowns.clear();

    for (const config of this.options.filters) {
      const dropdown = new FilterDropdown({
        type: config.type,
        label: config.label,
        placeholder: config.placeholder,
        options: config.options,
        value: config.value,
        min: config.min,
        max: config.max,
        step: config.step,
        unit: config.unit,
        showCounts: config.showCounts,
        searchable: config.searchable,
        clearable: config.clearable ?? true,
        onChange: (value) => {
          this.options.onFilterChange?.(config.id, value);
        },
      });

      this.filterDropdowns.set(config.id, dropdown);
      this.filtersContainer.appendChild(dropdown.getElement());
    }
  }

  getValues(): FilterValues {
    const values: FilterValues = {};
    for (const [id, dropdown] of this.filterDropdowns) {
      values[id] = dropdown.getValue();
    }
    if (this.searchInput) {
      values['search'] = this.searchInput.value;
    }
    return values;
  }

  getValue(filterId: string): string | string[] | RangeValue | boolean | undefined {
    const dropdown = this.filterDropdowns.get(filterId);
    return dropdown?.getValue();
  }

  setValue(filterId: string, value: string | string[] | RangeValue | boolean): this {
    const dropdown = this.filterDropdowns.get(filterId);
    if (dropdown) {
      dropdown.setValue(value);
    }
    return this;
  }

  setSearchValue(value: string): this {
    if (this.searchInput) {
      this.searchInput.value = value;
    }
    return this;
  }

  getSearchValue(): string {
    return this.searchInput?.value ?? '';
  }

  setFilterOptions(filterId: string, options: FilterOption[]): this {
    const dropdown = this.filterDropdowns.get(filterId);
    if (dropdown) {
      dropdown.setOptions(options);
    }
    return this;
  }

  clearAll(): this {
    for (const dropdown of this.filterDropdowns.values()) {
      dropdown.clear();
    }
    if (this.searchInput) {
      this.searchInput.value = '';
    }
    return this;
  }

  clearFilter(filterId: string): this {
    const dropdown = this.filterDropdowns.get(filterId);
    if (dropdown) {
      dropdown.clear();
    }
    return this;
  }

  setResultCount(count: number): this {
    const countEl = this.element.querySelector('.filter-bar__result-count');
    if (countEl) {
      countEl.textContent = `${count} result${count !== 1 ? 's' : ''}`;
    }
    return this;
  }

  updateFilters(filters: FilterConfig[]): this {
    this.options.filters = filters;
    this.buildFilters();
    return this;
  }

  getActiveFilterCount(): number {
    let count = 0;

    for (const dropdown of this.filterDropdowns.values()) {
      const value = dropdown.getValue();
      if (Array.isArray(value)) {
        if (value.length > 0) count++;
      } else if (typeof value === 'object') {
        const range = value as RangeValue;
        if (range.min !== undefined || range.max !== undefined) count++;
      } else if (typeof value === 'boolean') {
        if (value) count++;
      } else if (value) {
        count++;
      }
    }

    if (this.searchInput?.value) {
      count++;
    }

    return count;
  }

  hasActiveFilters(): boolean {
    return this.getActiveFilterCount() > 0;
  }
}
