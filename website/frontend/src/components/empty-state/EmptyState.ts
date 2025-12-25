import { Component, ComponentOptions } from '../base';
import { Icon, IconName } from '../icon';
import './empty-state.css';

export type EmptyStateSize = 'sm' | 'md' | 'lg';

export interface EmptyStateOptions extends ComponentOptions {
  icon?: IconName;
  title: string;
  description?: string;
  size?: EmptyStateSize;
}

export class EmptyState extends Component<HTMLDivElement> {
  private iconComponent?: Icon;
  private options: EmptyStateOptions;

  constructor(options: EmptyStateOptions) {
    super('div', {
      className: 'empty-state',
      ...options,
    });

    this.options = {
      size: 'md',
      ...options,
    };

    this.buildStructure();
  }

  private buildStructure(): void {
    const { icon, title, description, size } = this.options;

    if (size && size !== 'md') {
      this.element.classList.add(`empty-state--${size}`);
    }

    if (icon) {
      const iconContainer = document.createElement('div');
      iconContainer.className = 'empty-state-icon';
      this.element.appendChild(iconContainer);

      this.iconComponent = new Icon(icon, { size: 'xl' });
      this.iconComponent.mount(iconContainer);
    }

    const titleEl = document.createElement('h3');
    titleEl.className = 'empty-state-title';
    titleEl.textContent = title;
    this.element.appendChild(titleEl);

    if (description) {
      const descEl = document.createElement('p');
      descEl.className = 'empty-state-description';
      descEl.textContent = description;
      this.element.appendChild(descEl);
    }
  }

  setTitle(title: string): this {
    const titleEl = this.element.querySelector('.empty-state-title');
    if (titleEl) {
      titleEl.textContent = title;
    }
    return this;
  }

  setDescription(description: string): this {
    let descEl = this.element.querySelector('.empty-state-description');
    if (descEl) {
      descEl.textContent = description;
    } else {
      descEl = document.createElement('p');
      descEl.className = 'empty-state-description';
      descEl.textContent = description;
      this.element.appendChild(descEl);
    }
    return this;
  }

  protected onUnmount(): void {
    this.iconComponent?.unmount();
  }
}
