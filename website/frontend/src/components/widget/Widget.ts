/**
 * Widget Base Class
 * Base component for customizable dashboard widgets
 */

import { Component } from '../base';
import { Icon } from '../icon';
import { Dropdown } from '../dropdown';
import './widget.css';

import type { WidgetOptions, WidgetSize, WidgetConfig } from './types';
import type { DropdownItem } from '../dropdown';

const SIZE_CLASSES: Record<WidgetSize, string> = {
  sm: 'widget--sm',
  md: 'widget--md',
  lg: 'widget--lg',
  xl: 'widget--xl',
};

export abstract class Widget extends Component<HTMLDivElement> {
  protected config: WidgetConfig;
  protected headerElement: HTMLElement | null = null;
  protected bodyElement: HTMLElement | null = null;
  protected footerElement: HTMLElement | null = null;
  protected options: WidgetOptions;
  private dropdown: Dropdown | null = null;

  constructor(options: WidgetOptions) {
    super('div', {
      className: `widget ${SIZE_CLASSES[options.config.size]}`,
      attributes: {
        'data-widget-id': options.config.id,
        'data-widget-type': options.config.type,
      },
    });

    this.config = options.config;
    this.options = options;

    if (options.draggable) {
      this.setAttribute('draggable', 'true');
      this.addClass('widget--draggable');
    }

    this.buildStructure();
  }

  private buildStructure(): void {
    // Header
    this.headerElement = document.createElement('header');
    this.headerElement.className = 'widget-header';

    const titleWrapper = document.createElement('div');
    titleWrapper.className = 'widget-title-wrapper';

    const title = document.createElement('h3');
    title.className = 'widget-title';
    title.textContent = this.config.title;
    titleWrapper.appendChild(title);

    this.headerElement.appendChild(titleWrapper);

    // Header actions container (will hold the dropdown)
    const actions = document.createElement('div');
    actions.className = 'widget-actions';

    // Create menu button as trigger for dropdown
    const menuButton = document.createElement('button');
    menuButton.className = 'widget-menu-btn';
    menuButton.setAttribute('aria-label', 'Widget options');
    menuButton.setAttribute('type', 'button');

    const menuIcon = new Icon('moreVertical', { size: 'sm' });
    menuButton.appendChild(menuIcon.getElement());

    // Setup dropdown menu
    this.setupMenu(menuButton, actions);

    this.headerElement.appendChild(actions);
    this.element.appendChild(this.headerElement);

    // Body
    this.bodyElement = document.createElement('div');
    this.bodyElement.className = 'widget-body';
    this.element.appendChild(this.bodyElement);
  }

  private setupMenu(trigger: HTMLElement, container: HTMLElement): void {
    const menuItems: DropdownItem[] = [
      {
        id: 'resize-sm',
        label: 'Small',
        onClick: () => this.resize('sm'),
      },
      {
        id: 'resize-md',
        label: 'Medium',
        onClick: () => this.resize('md'),
      },
      {
        id: 'resize-lg',
        label: 'Large',
        onClick: () => this.resize('lg'),
      },
      { id: 'divider', label: '' },
      {
        id: 'settings',
        label: 'Settings',
        onClick: () => this.openSettings(),
      },
      { id: 'divider', label: '' },
      {
        id: 'remove',
        label: 'Remove',
        danger: true,
        onClick: () => this.remove(),
      },
    ];

    this.dropdown = new Dropdown({
      trigger,
      items: menuItems,
      position: 'bottom-end',
    });

    container.appendChild(this.dropdown.getElement());
  }

  protected resize(size: WidgetSize): void {
    // Remove old size class
    for (const sizeClass of Object.values(SIZE_CLASSES)) {
      this.removeClass(sizeClass);
    }

    // Add new size class
    this.addClass(SIZE_CLASSES[size]);
    this.config.size = size;

    this.options.onResize?.(this.config.id, size);
    this.onResize(size);
  }

  protected openSettings(): void {
    this.options.onSettings?.(this.config.id);
  }

  protected remove(): void {
    this.options.onRemove?.(this.config.id);
  }

  /**
   * Get the widget body element for content
   */
  getBody(): HTMLElement | null {
    return this.bodyElement;
  }

  /**
   * Add a footer section
   */
  addFooter(): HTMLElement {
    if (!this.footerElement) {
      this.footerElement = document.createElement('footer');
      this.footerElement.className = 'widget-footer';
      this.element.appendChild(this.footerElement);
    }
    return this.footerElement;
  }

  /**
   * Get widget configuration
   */
  getConfig(): WidgetConfig {
    return { ...this.config };
  }

  /**
   * Update widget title
   */
  setTitle(title: string): void {
    this.config.title = title;
    const titleEl = this.headerElement?.querySelector('.widget-title');
    if (titleEl) {
      titleEl.textContent = title;
    }
  }

  /**
   * Called when widget is resized
   */
  protected onResize(_size: WidgetSize): void {
    // Override in subclasses if needed
  }

  /**
   * Render widget content - must be implemented by subclasses
   */
  abstract renderContent(): void;

  protected onMount(): void {
    this.renderContent();
  }

  protected onUnmount(): void {
    this.dropdown?.unmount();
    this.dropdown = null;
  }
}
