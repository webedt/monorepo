/**
 * Accessibility utilities for WCAG 2.1 AA compliance
 * Provides:
 * - Screen reader announcements via aria-live regions
 * - Focus management utilities
 * - Keyboard navigation helpers
 * - Skip link support
 * - Roving tabindex management
 */

export type AnnouncementPoliteness = 'polite' | 'assertive';

/**
 * StatusAnnouncer provides a way to announce status changes to screen readers
 * using aria-live regions.
 *
 * Usage:
 *   import { statusAnnouncer } from './lib/accessibility';
 *   statusAnnouncer.announce('File saved successfully');
 *   statusAnnouncer.announce('Error: Connection failed', 'assertive');
 */
class StatusAnnouncer {
  private politeRegion: HTMLDivElement | null = null;
  private assertiveRegion: HTMLDivElement | null = null;
  private initialized = false;

  /**
   * Initialize the announcer by creating aria-live regions in the DOM
   * This is called automatically on first announce
   */
  private init(): void {
    if (this.initialized) return;

    // Create polite region for non-urgent announcements
    this.politeRegion = this.createRegion('polite');
    document.body.appendChild(this.politeRegion);

    // Create assertive region for urgent announcements
    this.assertiveRegion = this.createRegion('assertive');
    document.body.appendChild(this.assertiveRegion);

    this.initialized = true;
  }

  /**
   * Create an aria-live region element
   */
  private createRegion(politeness: AnnouncementPoliteness): HTMLDivElement {
    const region = document.createElement('div');
    // Use 'alert' role for assertive (urgent) and 'status' for polite (non-urgent)
    region.setAttribute('role', politeness === 'assertive' ? 'alert' : 'status');
    region.setAttribute('aria-live', politeness);
    region.setAttribute('aria-atomic', 'true');
    region.className = 'sr-only';

    // Visually hidden but accessible to screen readers
    Object.assign(region.style, {
      position: 'absolute',
      width: '1px',
      height: '1px',
      padding: '0',
      margin: '-1px',
      overflow: 'hidden',
      clip: 'rect(0, 0, 0, 0)',
      whiteSpace: 'nowrap',
      border: '0',
    });

    return region;
  }

  /**
   * Announce a message to screen readers
   *
   * @param message - The message to announce
   * @param politeness - 'polite' (default) for non-urgent, 'assertive' for urgent
   */
  announce(message: string, politeness: AnnouncementPoliteness = 'polite'): void {
    this.init();

    const region = politeness === 'assertive' ? this.assertiveRegion : this.politeRegion;
    if (!region) return;

    // Clear the region first to ensure the announcement is made even if
    // the same message is announced twice in a row
    region.textContent = '';

    // Use requestAnimationFrame to ensure the DOM update is processed
    requestAnimationFrame(() => {
      region.textContent = message;
    });
  }

  /**
   * Clear all pending announcements
   */
  clear(): void {
    if (this.politeRegion) {
      this.politeRegion.textContent = '';
    }
    if (this.assertiveRegion) {
      this.assertiveRegion.textContent = '';
    }
  }

  /**
   * Remove the announcer from the DOM (useful for cleanup)
   */
  destroy(): void {
    if (this.politeRegion) {
      this.politeRegion.remove();
      this.politeRegion = null;
    }
    if (this.assertiveRegion) {
      this.assertiveRegion.remove();
      this.assertiveRegion = null;
    }
    this.initialized = false;
  }
}

// Export singleton instance
export const statusAnnouncer = new StatusAnnouncer();

// Also export the class for testing or custom instances
export { StatusAnnouncer };

/**
 * Focus management utilities for modal dialogs and complex widgets
 */
export class FocusManager {
  private previousActiveElement: HTMLElement | null = null;
  private container: HTMLElement;
  private trapHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  /**
   * Get all focusable elements within the container
   */
  getFocusableElements(): HTMLElement[] {
    const selector = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(', ');

    return Array.from(this.container.querySelectorAll<HTMLElement>(selector)).filter(
      (el) => {
        const style = getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }
    );
  }

  /**
   * Save current focus and focus the first element in container
   */
  captureFocus(): void {
    this.previousActiveElement = document.activeElement as HTMLElement;
    const focusable = this.getFocusableElements();
    if (focusable.length > 0) {
      requestAnimationFrame(() => focusable[0].focus());
    }
  }

  /**
   * Restore focus to the previously focused element
   */
  restoreFocus(): void {
    if (this.previousActiveElement) {
      this.previousActiveElement.focus();
      this.previousActiveElement = null;
    }
  }

  /**
   * Enable focus trap within the container
   */
  enableFocusTrap(): void {
    this.trapHandler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      const focusable = this.getFocusableElements();
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', this.trapHandler);
  }

  /**
   * Disable focus trap
   */
  disableFocusTrap(): void {
    if (this.trapHandler) {
      document.removeEventListener('keydown', this.trapHandler);
      this.trapHandler = null;
    }
  }

  /**
   * Clean up all focus management
   */
  destroy(): void {
    this.disableFocusTrap();
    this.restoreFocus();
  }
}

/**
 * Roving tabindex manager for keyboard navigation in widget groups
 * Implements WAI-ARIA roving tabindex pattern for:
 * - Tree views
 * - Tab lists
 * - Menu bars
 * - Toolbars
 */
export class RovingTabindex {
  private container: HTMLElement;
  private selector: string;
  private currentIndex: number = 0;
  private orientation: 'horizontal' | 'vertical' | 'both';
  private wrap: boolean;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: {
    container: HTMLElement;
    selector: string;
    orientation?: 'horizontal' | 'vertical' | 'both';
    wrap?: boolean;
    onFocusChange?: (element: HTMLElement, index: number) => void;
  }) {
    this.container = options.container;
    this.selector = options.selector;
    this.orientation = options.orientation || 'vertical';
    this.wrap = options.wrap ?? true;
    this.onFocusChange = options.onFocusChange;
  }

  private onFocusChange?: (element: HTMLElement, index: number) => void;

  private getItems(): HTMLElement[] {
    return Array.from(this.container.querySelectorAll<HTMLElement>(this.selector)).filter(
      (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true'
    );
  }

  /**
   * Initialize roving tabindex on the items
   */
  init(): void {
    const items = this.getItems();
    items.forEach((item, index) => {
      item.setAttribute('tabindex', index === 0 ? '0' : '-1');
    });

    this.keydownHandler = this.handleKeydown.bind(this);
    this.container.addEventListener('keydown', this.keydownHandler);
  }

  private handleKeydown(e: KeyboardEvent): void {
    const items = this.getItems();
    if (items.length === 0) return;

    // Find current focused item
    const focusedIndex = items.findIndex((item) => item === document.activeElement);
    if (focusedIndex === -1) return;

    let nextIndex = focusedIndex;
    let handled = false;

    switch (e.key) {
      case 'ArrowDown':
        if (this.orientation === 'vertical' || this.orientation === 'both') {
          nextIndex = this.getNextIndex(focusedIndex, 1, items.length);
          handled = true;
        }
        break;
      case 'ArrowUp':
        if (this.orientation === 'vertical' || this.orientation === 'both') {
          nextIndex = this.getNextIndex(focusedIndex, -1, items.length);
          handled = true;
        }
        break;
      case 'ArrowRight':
        if (this.orientation === 'horizontal' || this.orientation === 'both') {
          nextIndex = this.getNextIndex(focusedIndex, 1, items.length);
          handled = true;
        }
        break;
      case 'ArrowLeft':
        if (this.orientation === 'horizontal' || this.orientation === 'both') {
          nextIndex = this.getNextIndex(focusedIndex, -1, items.length);
          handled = true;
        }
        break;
      case 'Home':
        nextIndex = 0;
        handled = true;
        break;
      case 'End':
        nextIndex = items.length - 1;
        handled = true;
        break;
    }

    if (handled) {
      e.preventDefault();
      this.focusItem(items, nextIndex);
    }
  }

  private getNextIndex(current: number, delta: number, length: number): number {
    const next = current + delta;
    if (this.wrap) {
      if (next < 0) return length - 1;
      if (next >= length) return 0;
      return next;
    }
    return Math.max(0, Math.min(length - 1, next));
  }

  private focusItem(items: HTMLElement[], index: number): void {
    items.forEach((item, i) => {
      item.setAttribute('tabindex', i === index ? '0' : '-1');
    });
    items[index].focus();
    this.currentIndex = index;
    this.onFocusChange?.(items[index], index);
  }

  /**
   * Focus a specific item by index
   */
  focus(index: number): void {
    const items = this.getItems();
    if (index >= 0 && index < items.length) {
      this.focusItem(items, index);
    }
  }

  /**
   * Update tabindex after items change
   */
  refresh(): void {
    const items = this.getItems();
    const validIndex = Math.min(this.currentIndex, items.length - 1);
    items.forEach((item, i) => {
      item.setAttribute('tabindex', i === validIndex ? '0' : '-1');
    });
    this.currentIndex = validIndex;
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    if (this.keydownHandler) {
      this.container.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }
}

/**
 * Tree keyboard navigation helper
 * Implements WAI-ARIA tree pattern with:
 * - Arrow key navigation
 * - Home/End support
 * - Expand/collapse with Enter/Space
 * - Type-ahead find
 */
export class TreeKeyboardNav {
  private container: HTMLElement;
  private itemSelector: string;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private typeAheadBuffer: string = '';
  private typeAheadTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: {
    container: HTMLElement;
    itemSelector: string;
    onSelect?: (element: HTMLElement) => void;
    onExpand?: (element: HTMLElement) => void;
    onCollapse?: (element: HTMLElement) => void;
  }) {
    this.container = options.container;
    this.itemSelector = options.itemSelector;
    this.onSelect = options.onSelect;
    this.onExpand = options.onExpand;
    this.onCollapse = options.onCollapse;
  }

  private onSelect?: (element: HTMLElement) => void;
  private onExpand?: (element: HTMLElement) => void;
  private onCollapse?: (element: HTMLElement) => void;

  private getItems(): HTMLElement[] {
    return Array.from(
      this.container.querySelectorAll<HTMLElement>(this.itemSelector)
    ).filter((el) => {
      const style = getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden';
    });
  }

  /**
   * Initialize keyboard navigation
   */
  init(): void {
    this.keydownHandler = this.handleKeydown.bind(this);
    this.container.addEventListener('keydown', this.keydownHandler);

    // Set initial tabindex
    const items = this.getItems();
    items.forEach((item, index) => {
      item.setAttribute('tabindex', index === 0 ? '0' : '-1');
    });
  }

  private handleKeydown(e: KeyboardEvent): void {
    const items = this.getItems();
    if (items.length === 0) return;

    const currentIndex = items.findIndex((item) => item === document.activeElement);
    if (currentIndex === -1 && !this.isTypeAheadKey(e.key)) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this.focusItem(items, Math.min(currentIndex + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.focusItem(items, Math.max(currentIndex - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        this.focusItem(items, 0);
        break;
      case 'End':
        e.preventDefault();
        this.focusItem(items, items.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (currentIndex >= 0) {
          const item = items[currentIndex];
          const isExpanded = item.getAttribute('aria-expanded');
          if (isExpanded === 'true') {
            this.onCollapse?.(item);
          } else if (isExpanded === 'false') {
            this.onExpand?.(item);
          } else {
            this.onSelect?.(item);
          }
        }
        break;
      case 'ArrowRight':
        e.preventDefault();
        if (currentIndex >= 0) {
          const item = items[currentIndex];
          if (item.getAttribute('aria-expanded') === 'false') {
            this.onExpand?.(item);
          } else {
            // Focus first child if expanded
            const nextIndex = currentIndex + 1;
            if (nextIndex < items.length) {
              this.focusItem(items, nextIndex);
            }
          }
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (currentIndex >= 0) {
          const item = items[currentIndex];
          if (item.getAttribute('aria-expanded') === 'true') {
            this.onCollapse?.(item);
          }
        }
        break;
      default:
        // Type-ahead find
        if (this.isTypeAheadKey(e.key)) {
          this.handleTypeAhead(e.key, items);
        }
    }
  }

  private isTypeAheadKey(key: string): boolean {
    return key.length === 1 && /[a-zA-Z0-9]/.test(key);
  }

  private handleTypeAhead(key: string, items: HTMLElement[]): void {
    if (this.typeAheadTimeout) {
      clearTimeout(this.typeAheadTimeout);
    }

    this.typeAheadBuffer += key.toLowerCase();

    this.typeAheadTimeout = setTimeout(() => {
      this.typeAheadBuffer = '';
    }, 500);

    const match = items.find((item) => {
      const text = item.textContent?.toLowerCase() || '';
      return text.startsWith(this.typeAheadBuffer);
    });

    if (match) {
      const index = items.indexOf(match);
      this.focusItem(items, index);
    }
  }

  private focusItem(items: HTMLElement[], index: number): void {
    items.forEach((item, i) => {
      item.setAttribute('tabindex', i === index ? '0' : '-1');
    });
    items[index]?.focus();
  }

  /**
   * Clean up event listeners
   */
  destroy(): void {
    if (this.keydownHandler) {
      this.container.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    if (this.typeAheadTimeout) {
      clearTimeout(this.typeAheadTimeout);
    }
  }
}

/**
 * Skip link helper - creates skip navigation links for keyboard users
 */
export function createSkipLink(options: {
  targetId: string;
  text?: string;
  className?: string;
}): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = `#${options.targetId}`;
  link.className = options.className || 'skip-link';
  link.textContent = options.text || 'Skip to main content';

  // Default styling for skip link
  Object.assign(link.style, {
    position: 'absolute',
    top: '-40px',
    left: '0',
    background: 'var(--color-bg-primary)',
    color: 'var(--color-text-primary)',
    padding: '8px 16px',
    zIndex: '10000',
    transition: 'top 0.2s ease',
  });

  link.addEventListener('focus', () => {
    link.style.top = '0';
  });

  link.addEventListener('blur', () => {
    link.style.top = '-40px';
  });

  return link;
}

/**
 * ARIA attribute helpers
 */
export const aria = {
  /**
   * Set live region attributes for dynamic content
   */
  setLiveRegion(
    element: HTMLElement,
    options: {
      politeness?: 'polite' | 'assertive' | 'off';
      atomic?: boolean;
      relevant?: 'additions' | 'removals' | 'text' | 'all';
    } = {}
  ): void {
    element.setAttribute('aria-live', options.politeness || 'polite');
    if (options.atomic !== undefined) {
      element.setAttribute('aria-atomic', String(options.atomic));
    }
    if (options.relevant) {
      element.setAttribute('aria-relevant', options.relevant);
    }
  },

  /**
   * Set expanded state for disclosure widgets
   */
  setExpanded(element: HTMLElement, expanded: boolean): void {
    element.setAttribute('aria-expanded', String(expanded));
  },

  /**
   * Set selected state for selectable items
   */
  setSelected(element: HTMLElement, selected: boolean): void {
    element.setAttribute('aria-selected', String(selected));
  },

  /**
   * Set pressed state for toggle buttons
   */
  setPressed(element: HTMLElement, pressed: boolean): void {
    element.setAttribute('aria-pressed', String(pressed));
  },

  /**
   * Set current state for navigation items
   */
  setCurrent(
    element: HTMLElement,
    current: 'page' | 'step' | 'location' | 'date' | 'time' | 'true' | 'false'
  ): void {
    element.setAttribute('aria-current', current);
  },

  /**
   * Set description via aria-describedby
   */
  describe(element: HTMLElement, descriptionId: string): void {
    element.setAttribute('aria-describedby', descriptionId);
  },

  /**
   * Set label via aria-labelledby
   */
  labelBy(element: HTMLElement, labelId: string): void {
    element.setAttribute('aria-labelledby', labelId);
  },

  /**
   * Hide element from accessibility tree
   */
  hide(element: HTMLElement, hidden = true): void {
    element.setAttribute('aria-hidden', String(hidden));
  },

  /**
   * Set invalid state for form validation
   */
  setInvalid(element: HTMLElement, invalid: boolean, errorId?: string): void {
    element.setAttribute('aria-invalid', String(invalid));
    if (invalid && errorId) {
      element.setAttribute('aria-describedby', errorId);
    } else if (!invalid) {
      element.removeAttribute('aria-describedby');
    }
  },

  /**
   * Set busy state for loading content
   */
  setBusy(element: HTMLElement, busy: boolean): void {
    element.setAttribute('aria-busy', String(busy));
  },
};

/**
 * Contrast ratio calculation utilities for WCAG 2.1 AA compliance
 * Minimum ratios: 4.5:1 for normal text, 3:1 for large text
 */
export const contrast = {
  /**
   * Calculate relative luminance of a color
   */
  luminance(r: number, g: number, b: number): number {
    const [rs, gs, bs] = [r, g, b].map((c) => {
      const sRGB = c / 255;
      return sRGB <= 0.03928 ? sRGB / 12.92 : Math.pow((sRGB + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  },

  /**
   * Calculate contrast ratio between two luminance values
   */
  ratio(l1: number, l2: number): number {
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  },

  /**
   * Parse hex color to RGB
   */
  hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result
      ? {
          r: parseInt(result[1], 16),
          g: parseInt(result[2], 16),
          b: parseInt(result[3], 16),
        }
      : null;
  },

  /**
   * Check if contrast meets WCAG AA for normal text (4.5:1)
   */
  meetsAA(foreground: string, background: string): boolean {
    const fg = this.hexToRgb(foreground);
    const bg = this.hexToRgb(background);
    if (!fg || !bg) return false;

    const fgLum = this.luminance(fg.r, fg.g, fg.b);
    const bgLum = this.luminance(bg.r, bg.g, bg.b);
    return this.ratio(fgLum, bgLum) >= 4.5;
  },

  /**
   * Check if contrast meets WCAG AA for large text (3:1)
   */
  meetsAALarge(foreground: string, background: string): boolean {
    const fg = this.hexToRgb(foreground);
    const bg = this.hexToRgb(background);
    if (!fg || !bg) return false;

    const fgLum = this.luminance(fg.r, fg.g, fg.b);
    const bgLum = this.luminance(bg.r, bg.g, bg.b);
    return this.ratio(fgLum, bgLum) >= 3;
  },
};

/**
 * Generate unique IDs for accessibility attributes
 */
let idCounter = 0;
export function generateId(prefix = 'a11y'): string {
  return `${prefix}-${++idCounter}-${Math.random().toString(36).slice(2, 7)}`;
}
