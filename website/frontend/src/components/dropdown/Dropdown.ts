import { Component, ComponentOptions } from '../base';
import { Button } from '../button';
import { sanitizeHtmlPermissive } from '../../lib/sanitize';
import './dropdown.css';

export type DropdownPosition = 'bottom' | 'bottom-end' | 'top' | 'top-end';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

export interface DropdownOptions extends ComponentOptions {
  trigger: Component | HTMLElement;
  items?: DropdownItem[];
  position?: DropdownPosition;
  wide?: boolean;
  closeOnSelect?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export class Dropdown extends Component<HTMLDivElement> {
  private triggerElement: HTMLElement;
  private menuElement: HTMLDivElement;
  private options: DropdownOptions;
  private isOpen: boolean = false;
  private items: DropdownItem[] = [];
  private focusedIndex: number = -1;
  private menuItems: HTMLButtonElement[] = [];

  constructor(options: DropdownOptions) {
    super('div', {
      className: 'dropdown',
      ...options,
    });

    this.options = {
      position: 'bottom',
      closeOnSelect: true,
      ...options,
    };

    this.items = options.items ?? [];

    // Setup trigger
    this.triggerElement = options.trigger instanceof Component
      ? options.trigger.getElement()
      : options.trigger;
    this.triggerElement.classList.add('dropdown-trigger');

    // Create menu
    this.menuElement = document.createElement('div');
    this.menuElement.className = `dropdown-menu dropdown-menu--${this.options.position}`;

    if (this.options.wide) {
      this.menuElement.classList.add('dropdown-menu--wide');
    }

    this.element.appendChild(this.triggerElement);
    this.element.appendChild(this.menuElement);

    this.buildMenu();
    this.setupEventListeners();
  }

  private buildMenu(): void {
    this.menuElement.innerHTML = '';
    this.menuItems = [];

    for (const item of this.items) {
      if (item.id === 'divider') {
        const divider = document.createElement('div');
        divider.className = 'dropdown-divider';
        this.menuElement.appendChild(divider);
        continue;
      }

      if (item.id.startsWith('header:')) {
        const header = document.createElement('div');
        header.className = 'dropdown-header';
        header.textContent = item.label;
        this.menuElement.appendChild(header);
        continue;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dropdown-item';
      button.dataset.itemId = item.id;

      if (item.danger) {
        button.classList.add('dropdown-item--danger');
      }

      if (item.disabled) {
        button.classList.add('dropdown-item--disabled');
        button.disabled = true;
      }

      if (item.icon) {
        const iconSpan = document.createElement('span');
        iconSpan.className = 'dropdown-item-icon';
        // Sanitize icon HTML to prevent XSS from user-provided content
        iconSpan.innerHTML = sanitizeHtmlPermissive(item.icon);
        button.appendChild(iconSpan);
      }

      const labelSpan = document.createElement('span');
      labelSpan.textContent = item.label;
      button.appendChild(labelSpan);

      button.addEventListener('click', () => {
        if (item.disabled) return;
        item.onClick?.();
        if (this.options.closeOnSelect) {
          this.close();
        }
      });

      this.menuElement.appendChild(button);
      this.menuItems.push(button);
    }
  }

  private setupEventListeners(): void {
    // Toggle on trigger click
    this.on(this.triggerElement, 'click', (e) => {
      e.stopPropagation();
      this.toggle();
    });

    // Close on outside click
    this.on(document, 'click', ((e: MouseEvent) => {
      if (this.isOpen && !this.element.contains(e.target as Node)) {
        this.close();
      }
    }) as EventListener);

    // Keyboard navigation
    this.on(this.element, 'keydown', ((e: KeyboardEvent) => {
      if (!this.isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.open();
        }
        return;
      }

      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          this.close();
          this.triggerElement.focus();
          break;

        case 'ArrowDown':
          e.preventDefault();
          this.focusNext();
          break;

        case 'ArrowUp':
          e.preventDefault();
          this.focusPrevious();
          break;

        case 'Home':
          e.preventDefault();
          this.focusFirst();
          break;

        case 'End':
          e.preventDefault();
          this.focusLast();
          break;

        case 'Tab':
          this.close();
          break;
      }
    }) as EventListener);
  }

  private focusNext(): void {
    const enabledItems = this.menuItems.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;

    this.focusedIndex = Math.min(this.focusedIndex + 1, enabledItems.length - 1);
    enabledItems[this.focusedIndex]?.focus();
  }

  private focusPrevious(): void {
    const enabledItems = this.menuItems.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;

    this.focusedIndex = Math.max(this.focusedIndex - 1, 0);
    enabledItems[this.focusedIndex]?.focus();
  }

  private focusFirst(): void {
    const enabledItems = this.menuItems.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;

    this.focusedIndex = 0;
    enabledItems[0]?.focus();
  }

  private focusLast(): void {
    const enabledItems = this.menuItems.filter((item) => !item.disabled);
    if (enabledItems.length === 0) return;

    this.focusedIndex = enabledItems.length - 1;
    enabledItems[this.focusedIndex]?.focus();
  }

  /**
   * Open the dropdown
   */
  open(): this {
    if (this.isOpen) return this;

    this.element.classList.add('dropdown--open');
    this.triggerElement.setAttribute('aria-expanded', 'true');
    this.isOpen = true;
    this.focusedIndex = -1;

    this.options.onOpen?.();
    return this;
  }

  /**
   * Close the dropdown
   */
  close(): this {
    if (!this.isOpen) return this;

    this.element.classList.remove('dropdown--open');
    this.triggerElement.setAttribute('aria-expanded', 'false');
    this.isOpen = false;
    this.focusedIndex = -1;

    this.options.onClose?.();
    return this;
  }

  /**
   * Toggle the dropdown
   */
  toggle(): this {
    return this.isOpen ? this.close() : this.open();
  }

  /**
   * Check if dropdown is open
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Set new items
   */
  setItems(items: DropdownItem[]): this {
    this.items = items;
    this.buildMenu();
    return this;
  }

  /**
   * Add a single item
   */
  addItem(item: DropdownItem): this {
    this.items.push(item);
    this.buildMenu();
    return this;
  }

  /**
   * Remove an item by id
   */
  removeItem(id: string): this {
    this.items = this.items.filter((item) => item.id !== id);
    this.buildMenu();
    return this;
  }

  /**
   * Add a divider
   */
  addDivider(): this {
    return this.addItem({ id: 'divider', label: '' });
  }

  /**
   * Add a header
   */
  addHeader(label: string): this {
    return this.addItem({ id: `header:${label}`, label });
  }
}

/**
 * Helper to create a dropdown with a button trigger
 */
export function createDropdown(
  buttonText: string,
  items: DropdownItem[],
  options?: Partial<DropdownOptions>
): Dropdown {
  const trigger = new Button(buttonText, {
    variant: 'secondary',
  });

  return new Dropdown({
    trigger,
    items,
    ...options,
  });
}
