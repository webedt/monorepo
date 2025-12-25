import { Component, ComponentOptions } from '../base';
import './status-badge.css';

export type StatusType = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'info' | 'warning' | 'success' | 'error';
export type StatusBadgeSize = 'sm' | 'md' | 'lg';

export interface StatusBadgeOptions extends ComponentOptions {
  status: StatusType;
  label?: string;
  size?: StatusBadgeSize;
}

export class StatusBadge extends Component<HTMLSpanElement> {
  private options: StatusBadgeOptions;

  constructor(options: StatusBadgeOptions) {
    super('span', {
      className: 'status-badge',
      ...options,
    });

    this.options = {
      size: 'md',
      ...options,
    };

    this.buildStructure();
  }

  private buildStructure(): void {
    const { status, label, size } = this.options;

    this.element.classList.add(`status-badge--${status}`);

    if (size && size !== 'md') {
      this.element.classList.add(`status-badge--${size}`);
    }

    this.element.textContent = label ?? this.formatStatus(status);
  }

  private formatStatus(status: StatusType): string {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  setStatus(status: StatusType, label?: string): this {
    // Remove old status class
    const statusClasses = Array.from(this.element.classList).filter(c => c.startsWith('status-badge--') && c !== `status-badge--${this.options.size}`);
    for (const cls of statusClasses) {
      this.element.classList.remove(cls);
    }

    this.options.status = status;
    this.element.classList.add(`status-badge--${status}`);
    this.element.textContent = label ?? this.formatStatus(status);

    return this;
  }

  getStatus(): StatusType {
    return this.options.status;
  }

  setLabel(label: string): this {
    this.element.textContent = label;
    return this;
  }
}
