/**
 * Offline Indicator Component
 * Displays connectivity status and pending sync operations
 */

import { Component } from '../base';
import { offlineManager, type ConnectionStatus } from '../../lib/offline';
import './offline-indicator.css';

export interface OfflineIndicatorOptions {
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
  showPendingCount?: boolean;
  autoHideWhenOnline?: boolean;
  autoHideDelay?: number;
}

export class OfflineIndicator extends Component {
  private options: OfflineIndicatorOptions;
  private unsubscribe: (() => void) | null = null;
  private hideTimeout: number | null = null;
  private status: ConnectionStatus = 'online';

  constructor(options: OfflineIndicatorOptions = {}) {
    super('div', { className: 'offline-indicator' });

    this.options = {
      position: 'bottom-right',
      showPendingCount: true,
      autoHideWhenOnline: true,
      autoHideDelay: 3000,
      ...options,
    };

    this.element.classList.add(`offline-indicator--${this.options.position}`);
    this.render();
  }

  protected onMount(): void {
    this.unsubscribe = offlineManager.subscribe((status, wasOffline) => {
      this.status = status;
      this.handleStatusChange(status, wasOffline);
    });
  }

  protected onUnmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  private handleStatusChange(status: ConnectionStatus, wasOffline: boolean): void {
    this.render();

    // Clear any existing hide timeout
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }

    // Show the indicator
    this.show();
    this.element.classList.remove('offline-indicator--hidden');

    if (status === 'online' && wasOffline) {
      // Briefly show "Back online" message
      this.element.classList.add('offline-indicator--restored');

      if (this.options.autoHideWhenOnline) {
        this.hideTimeout = window.setTimeout(() => {
          this.element.classList.add('offline-indicator--hidden');
        }, this.options.autoHideDelay);
      }
    } else if (status === 'online' && this.options.autoHideWhenOnline) {
      // Hide when online (not coming from offline)
      this.element.classList.add('offline-indicator--hidden');
    } else {
      this.element.classList.remove('offline-indicator--restored');
    }
  }

  render(): this {
    const pendingCount = offlineManager.getPendingCount();
    const statusClass = `offline-indicator--${this.status}`;

    // Remove old status classes
    this.element.classList.remove(
      'offline-indicator--online',
      'offline-indicator--offline',
      'offline-indicator--slow'
    );
    this.element.classList.add(statusClass);

    let icon: string;
    let message: string;

    switch (this.status) {
      case 'offline':
        icon = `<svg class="offline-indicator__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="1" y1="1" x2="23" y2="23"></line>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path>
          <path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20"></line>
        </svg>`;
        message = 'You are offline';
        break;
      case 'slow':
        icon = `<svg class="offline-indicator__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="12 6 12 12 16 14"></polyline>
        </svg>`;
        message = 'Slow connection';
        break;
      case 'online':
      default:
        if (this.element.classList.contains('offline-indicator--restored')) {
          icon = `<svg class="offline-indicator__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>`;
          message = 'Back online';
        } else {
          icon = `<svg class="offline-indicator__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
            <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
            <line x1="12" y1="20" x2="12.01" y2="20"></line>
          </svg>`;
          message = 'Online';
        }
        break;
    }

    let html = `
      <div class="offline-indicator__content">
        ${icon}
        <span class="offline-indicator__message">${message}</span>
    `;

    if (this.options.showPendingCount && pendingCount > 0) {
      html += `
        <span class="offline-indicator__pending">
          ${pendingCount} pending
        </span>
      `;
    }

    html += `</div>`;

    if (this.status === 'offline') {
      html += `
        <div class="offline-indicator__details">
          Changes will sync when connection is restored
        </div>
      `;
    }

    this.element.innerHTML = html;
    return this;
  }

  /**
   * Force show the indicator
   */
  forceShow(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
    this.element.classList.remove('offline-indicator--hidden');
    this.show();
  }

  /**
   * Force hide the indicator
   */
  forceHide(): void {
    this.element.classList.add('offline-indicator--hidden');
  }
}

export { OfflineIndicator as default };
