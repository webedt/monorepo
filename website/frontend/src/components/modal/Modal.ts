import { Component, ComponentOptions } from '../base';
import { Button } from '../button';
import { escapeText } from '../../lib/sanitize';
import './modal.css';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

export interface ModalOptions extends ComponentOptions {
  title?: string;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  showClose?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
}

export class Modal extends Component<HTMLDivElement> {
  private backdropElement: HTMLDivElement;
  private modalElement: HTMLDivElement;
  private headerElement?: HTMLElement;
  private bodyElement?: HTMLElement;
  private footerElement?: HTMLElement;
  private options: ModalOptions;
  private isOpen: boolean = false;
  private previousActiveElement: HTMLElement | null = null;

  constructor(options: ModalOptions = {}) {
    // The component root is the backdrop
    super('div', {
      className: 'modal-backdrop',
      attributes: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-hidden': 'true',
      },
    });

    this.options = {
      size: 'md',
      closeOnBackdrop: true,
      closeOnEscape: true,
      showClose: true,
      ...options,
    };

    this.backdropElement = this.element;
    this.modalElement = document.createElement('div');
    this.modalElement.className = `modal modal--${this.options.size}`;

    this.backdropElement.appendChild(this.modalElement);

    this.buildStructure();
    this.setupEventListeners();
  }

  private buildStructure(): void {
    const { title, showClose } = this.options;

    // Header with title and close button
    if (title || showClose) {
      this.headerElement = document.createElement('header');
      this.headerElement.className = 'modal-header';

      if (title) {
        const titleEl = document.createElement('h2');
        titleEl.className = 'modal-title';
        titleEl.textContent = title;
        this.headerElement.appendChild(titleEl);
      }

      if (showClose) {
        const closeBtn = document.createElement('button');
        closeBtn.className = 'modal-close';
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'Close modal');
        closeBtn.innerHTML = `
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        `;
        closeBtn.addEventListener('click', () => this.close());
        this.headerElement.appendChild(closeBtn);
      }

      this.modalElement.appendChild(this.headerElement);
    }

    // Body
    this.bodyElement = document.createElement('div');
    this.bodyElement.className = 'modal-body';
    this.modalElement.appendChild(this.bodyElement);
  }

  private setupEventListeners(): void {
    const { closeOnBackdrop, closeOnEscape } = this.options;

    // Close on backdrop click
    if (closeOnBackdrop) {
      this.on('click', (e) => {
        if (e.target === this.backdropElement) {
          this.close();
        }
      });
    }

    // Close on Escape key
    if (closeOnEscape) {
      this.on(document, 'keydown', ((e: KeyboardEvent) => {
        if (e.key === 'Escape' && this.isOpen) {
          this.close();
        }
      }) as EventListener);
    }
  }

  /**
   * Open the modal
   */
  open(): this {
    if (this.isOpen) return this;

    // Store current focus
    this.previousActiveElement = document.activeElement as HTMLElement;

    // Mount to body if not already mounted
    if (!this.element.parentElement) {
      this.mount(document.body);
    }

    // Trigger reflow for animation
    void this.element.offsetHeight;

    // Open modal
    this.element.classList.add('modal-backdrop--open');
    this.element.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    this.isOpen = true;

    // Focus first focusable element in modal
    requestAnimationFrame(() => {
      const focusable = this.modalElement.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable) {
        focusable.focus();
      }
    });

    this.options.onOpen?.();
    return this;
  }

  /**
   * Close the modal
   */
  close(): this {
    if (!this.isOpen) return this;

    this.element.classList.remove('modal-backdrop--open');
    this.element.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    this.isOpen = false;

    // Restore focus
    if (this.previousActiveElement) {
      this.previousActiveElement.focus();
      this.previousActiveElement = null;
    }

    this.options.onClose?.();
    return this;
  }

  /**
   * Toggle modal open/closed
   */
  toggle(): this {
    return this.isOpen ? this.close() : this.open();
  }

  /**
   * Check if modal is open
   */
  getIsOpen(): boolean {
    return this.isOpen;
  }

  /**
   * Set the modal title
   */
  setTitle(title: string): this {
    if (this.headerElement) {
      const titleEl = this.headerElement.querySelector('.modal-title');
      if (titleEl) {
        titleEl.textContent = title;
      }
    }
    return this;
  }

  /**
   * Get the body element to add content
   */
  getBody(): HTMLElement {
    return this.bodyElement!;
  }

  /**
   * Set body content
   */
  setBody(content: string | Component | HTMLElement): this {
    this.bodyElement!.innerHTML = '';

    if (typeof content === 'string') {
      this.bodyElement!.innerHTML = content;
    } else if (content instanceof Component) {
      this.bodyElement!.appendChild(content.getElement());
    } else {
      this.bodyElement!.appendChild(content);
    }

    return this;
  }

  /**
   * Add a footer to the modal
   */
  footer(options?: { align?: 'start' | 'end' | 'between' }): HTMLElement {
    if (!this.footerElement) {
      this.footerElement = document.createElement('footer');
      this.footerElement.className = 'modal-footer';

      if (options?.align && options.align !== 'end') {
        this.footerElement.classList.add(`modal-footer--${options.align}`);
      }

      this.modalElement.appendChild(this.footerElement);
    }
    return this.footerElement;
  }

  /**
   * Add element to footer
   */
  addFooterAction(component: Component | HTMLElement): this {
    const footer = this.footer();
    if (component instanceof Component) {
      footer.appendChild(component.getElement());
    } else {
      footer.appendChild(component);
    }
    return this;
  }

  /**
   * Cleanup on unmount
   */
  protected onUnmount(): void {
    if (this.isOpen) {
      document.body.style.overflow = '';
    }
  }
}

/**
 * Confirm dialog helper
 */
export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new Modal({
      title: options.title ?? 'Confirm',
      size: 'sm',
      showClose: false,
      closeOnBackdrop: false,
      closeOnEscape: false,
    });

    modal.setBody(`<p>${escapeText(options.message)}</p>`);

    const cancelBtn = new Button(options.cancelText ?? 'Cancel', {
      variant: 'secondary',
      onClick: () => {
        modal.close();
        modal.unmount();
        resolve(false);
      },
    });

    const confirmBtn = new Button(options.confirmText ?? 'Confirm', {
      variant: options.danger ? 'danger' : 'primary',
      onClick: () => {
        modal.close();
        modal.unmount();
        resolve(true);
      },
    });

    modal.addFooterAction(cancelBtn);
    modal.addFooterAction(confirmBtn);
    modal.open();
  });
}
