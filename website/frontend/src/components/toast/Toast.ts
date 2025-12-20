import { Component } from '../base';
import './toast.css';

export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type ToastPosition =
  | 'top-right'
  | 'top-left'
  | 'top-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'bottom-center';

export interface ToastOptions {
  title?: string;
  message: string;
  type?: ToastType;
  duration?: number; // ms, 0 for no auto-dismiss
  closable?: boolean;
  showProgress?: boolean;
  onClose?: () => void;
  action?: {
    label: string;
    onClick: () => void;
  };
}

const TOAST_ICONS: Record<ToastType, string> = {
  success: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`,
  warning: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
};

interface ToastInternalOptions {
  title?: string;
  message: string;
  type: ToastType;
  duration: number;
  closable: boolean;
  showProgress: boolean;
  onClose: () => void;
  action?: ToastOptions['action'];
}

class Toast extends Component<HTMLDivElement> {
  private options: ToastInternalOptions;
  private timeoutId?: ReturnType<typeof setTimeout>;
  private progressElement?: HTMLDivElement;
  private startTime?: number;

  constructor(options: ToastOptions) {
    super('div', {
      className: 'toast',
    });

    this.options = {
      type: 'info',
      duration: 5000,
      closable: true,
      showProgress: false,
      onClose: () => {},
      ...options,
    };

    this.addClass(`toast--${this.options.type}`);
    this.buildContent();

    if (this.options.duration > 0) {
      this.startTimer();
    }
  }

  private buildContent(): void {
    const { title, message, type, closable, showProgress, action } = this.options;

    // Icon
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.innerHTML = TOAST_ICONS[type];
    this.element.appendChild(icon);

    // Content
    const content = document.createElement('div');
    content.className = 'toast-content';

    if (title) {
      const titleEl = document.createElement('div');
      titleEl.className = 'toast-title';
      titleEl.textContent = title;
      content.appendChild(titleEl);
    }

    const messageEl = document.createElement('div');
    messageEl.className = 'toast-message';
    messageEl.textContent = message;
    content.appendChild(messageEl);

    if (action) {
      const actionsEl = document.createElement('div');
      actionsEl.className = 'toast-actions';

      const actionBtn = document.createElement('button');
      actionBtn.className = 'btn btn--sm btn--ghost';
      actionBtn.textContent = action.label;
      actionBtn.addEventListener('click', () => {
        action.onClick();
        this.close();
      });

      actionsEl.appendChild(actionBtn);
      content.appendChild(actionsEl);
    }

    this.element.appendChild(content);

    // Close button
    if (closable) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'toast-close';
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Dismiss');
      closeBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      `;
      closeBtn.addEventListener('click', () => this.close());
      this.element.appendChild(closeBtn);
    }

    // Progress bar
    if (showProgress && this.options.duration > 0) {
      const progress = document.createElement('div');
      progress.className = 'toast-progress';

      this.progressElement = document.createElement('div');
      this.progressElement.className = 'toast-progress-bar';
      this.progressElement.style.width = '100%';

      progress.appendChild(this.progressElement);
      this.element.appendChild(progress);
    }
  }

  private startTimer(): void {
    this.startTime = Date.now();

    if (this.progressElement) {
      this.progressElement.style.transitionDuration = `${this.options.duration}ms`;
      requestAnimationFrame(() => {
        if (this.progressElement) {
          this.progressElement.style.width = '0%';
        }
      });
    }

    this.timeoutId = setTimeout(() => {
      this.close();
    }, this.options.duration);

    // Pause on hover
    this.on('mouseenter', () => this.pauseTimer());
    this.on('mouseleave', () => this.resumeTimer());
  }

  private pauseTimer(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }

    if (this.progressElement && this.startTime) {
      const elapsed = Date.now() - this.startTime;
      const remaining = this.options.duration - elapsed;
      const percentage = (remaining / this.options.duration) * 100;

      this.progressElement.style.transitionDuration = '0ms';
      this.progressElement.style.width = `${percentage}%`;
    }
  }

  private resumeTimer(): void {
    if (!this.startTime) return;

    const elapsed = Date.now() - this.startTime;
    const remaining = this.options.duration - elapsed;

    if (remaining <= 0) {
      this.close();
      return;
    }

    if (this.progressElement) {
      this.progressElement.style.transitionDuration = `${remaining}ms`;
      requestAnimationFrame(() => {
        if (this.progressElement) {
          this.progressElement.style.width = '0%';
        }
      });
    }

    this.timeoutId = setTimeout(() => {
      this.close();
    }, remaining);
  }

  close(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
    }

    this.addClass('toast--exiting');

    setTimeout(() => {
      this.options.onClose?.();
      this.unmount();
    }, 150);
  }
}

/**
 * Toast Manager - Singleton to manage all toasts
 */
class ToastManager {
  private container: HTMLDivElement | null = null;
  private position: ToastPosition = 'top-right';
  private toasts: Toast[] = [];

  private getContainer(): HTMLDivElement {
    if (!this.container || !document.body.contains(this.container)) {
      this.container = document.createElement('div');
      this.container.className = `toast-container toast-container--${this.position}`;
      document.body.appendChild(this.container);
    }
    return this.container;
  }

  setPosition(position: ToastPosition): void {
    this.position = position;
    if (this.container) {
      this.container.className = `toast-container toast-container--${position}`;
    }
  }

  show(options: ToastOptions): Toast {
    const toast = new Toast({
      ...options,
      onClose: () => {
        options.onClose?.();
        this.toasts = this.toasts.filter((t) => t !== toast);
      },
    });

    this.toasts.push(toast);
    toast.mount(this.getContainer());

    return toast;
  }

  success(message: string, options?: Omit<ToastOptions, 'message' | 'type'>): Toast {
    return this.show({ ...options, message, type: 'success' });
  }

  error(message: string, options?: Omit<ToastOptions, 'message' | 'type'>): Toast {
    return this.show({ ...options, message, type: 'error' });
  }

  warning(message: string, options?: Omit<ToastOptions, 'message' | 'type'>): Toast {
    return this.show({ ...options, message, type: 'warning' });
  }

  info(message: string, options?: Omit<ToastOptions, 'message' | 'type'>): Toast {
    return this.show({ ...options, message, type: 'info' });
  }

  dismissAll(): void {
    this.toasts.forEach((toast) => toast.close());
  }
}

// Export singleton instance
export const toast = new ToastManager();

// Also export types
export { Toast, ToastManager };
