/**
 * Widget Customizer
 * Modal for customizing widget layout and adding new widgets
 */

import { Component } from '../base';
import { Button } from '../button';
import { Icon } from '../icon';
import { Modal } from '../modal';
import { widgetStore } from '../../stores/widgetStore';

import type { ComponentOptions } from '../base';
import type { WidgetType } from './types';

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export interface WidgetCustomizerOptions extends ComponentOptions {
  onClose?: () => void;
}

export class WidgetCustomizer extends Component<HTMLDivElement> {
  private modal: Modal | null = null;
  private buttons: Button[] = [];
  private options: WidgetCustomizerOptions;
  private unsubscribe: (() => void) | null = null;

  constructor(options: WidgetCustomizerOptions = {}) {
    super('div', {
      className: 'widget-customizer',
      ...options,
    });

    this.options = options;
    this.buildContent();
  }

  private buildContent(): void {
    this.element.innerHTML = `
      <div class="widget-customizer-section">
        <h3 class="widget-customizer-title">Add Widgets</h3>
        <div class="widget-customizer-grid" data-section="add"></div>
      </div>

      <div class="widget-customizer-section">
        <h3 class="widget-customizer-title">Manage Widgets</h3>
        <div class="widget-customizer-list" data-section="manage"></div>
      </div>

      <div class="widget-customizer-section">
        <h3 class="widget-customizer-title">Layout Settings</h3>
        <div class="widget-customizer-layout" data-section="layout"></div>
      </div>

      <div class="widget-customizer-actions"></div>
    `;

    this.renderAddSection();
    this.renderManageSection();
    this.renderLayoutSection();
    this.renderActions();
  }

  private renderAddSection(): void {
    const section = this.element.querySelector('[data-section="add"]');
    if (!section) return;

    section.innerHTML = '';

    const widgetTypes = widgetStore.getAvailableWidgetTypes();

    for (const type of widgetTypes) {
      const card = document.createElement('button');
      card.className = 'widget-type-card';
      card.type = 'button';

      const iconName = this.getIconForType(type.type);
      const icon = new Icon(iconName, { size: 'lg' });

      card.innerHTML = `
        <div class="widget-type-icon"></div>
        <div class="widget-type-info">
          <div class="widget-type-label">${type.label}</div>
          <div class="widget-type-description">${type.description}</div>
        </div>
      `;

      const iconContainer = card.querySelector('.widget-type-icon');
      if (iconContainer) {
        iconContainer.appendChild(icon.getElement());
      }

      card.addEventListener('click', () => this.addWidget(type.type));

      section.appendChild(card);
    }
  }

  private renderManageSection(): void {
    const section = this.element.querySelector('[data-section="manage"]');
    if (!section) return;

    section.innerHTML = '';

    const allWidgets = widgetStore.getAllWidgets();

    if (allWidgets.length === 0) {
      section.innerHTML = '<p class="widget-customizer-empty">No widgets configured</p>';
      return;
    }

    for (const widget of allWidgets) {
      const item = document.createElement('div');
      item.className = 'widget-manage-item';
      item.setAttribute('data-widget-id', widget.id);

      const iconName = this.getIconForType(widget.type);
      const icon = new Icon(iconName, { size: 'sm' });

      item.innerHTML = `
        <div class="widget-manage-icon"></div>
        <div class="widget-manage-info">
          <div class="widget-manage-title">${escapeHtml(widget.title)}</div>
          <div class="widget-manage-meta">${escapeHtml(widget.type)} · ${escapeHtml(widget.size)}</div>
        </div>
        <div class="widget-manage-actions">
          <label class="widget-manage-toggle">
            <input type="checkbox" ${widget.visible ? 'checked' : ''}>
            <span class="widget-toggle-slider"></span>
          </label>
          <button type="button" class="widget-manage-delete" aria-label="Remove widget">
            <span class="icon-trash"></span>
          </button>
        </div>
      `;

      const iconContainer = item.querySelector('.widget-manage-icon');
      if (iconContainer) {
        iconContainer.appendChild(icon.getElement());
      }

      const deleteBtn = item.querySelector('.widget-manage-delete');
      if (deleteBtn) {
        const trashIcon = new Icon('trash', { size: 'sm' });
        deleteBtn.innerHTML = '';
        deleteBtn.appendChild(trashIcon.getElement());
      }

      // Toggle visibility
      const toggle = item.querySelector('input[type="checkbox"]');
      toggle?.addEventListener('change', () => {
        widgetStore.toggleWidgetVisibility(widget.id);
      });

      // Delete widget
      const deleteButton = item.querySelector('.widget-manage-delete');
      deleteButton?.addEventListener('click', () => {
        widgetStore.removeWidget(widget.id);
        this.renderManageSection();
      });

      section.appendChild(item);
    }
  }

  private renderLayoutSection(): void {
    const section = this.element.querySelector('[data-section="layout"]');
    if (!section) return;

    const { columns } = widgetStore.getState().layout;

    section.innerHTML = `
      <div class="layout-option">
        <label class="layout-label">Grid Columns</label>
        <div class="layout-columns">
          ${[2, 3, 4, 5, 6].map(n => `
            <button type="button" class="layout-column-btn ${n === columns ? 'layout-column-btn--active' : ''}" data-columns="${n}">
              ${n}
            </button>
          `).join('')}
        </div>
      </div>
    `;

    // Add column button listeners
    const columnBtns = section.querySelectorAll('.layout-column-btn');
    for (const btn of columnBtns) {
      btn.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const cols = parseInt(target.dataset.columns || '4', 10);
        widgetStore.setColumns(cols);

        // Update active state
        for (const b of columnBtns) {
          b.classList.remove('layout-column-btn--active');
        }
        target.classList.add('layout-column-btn--active');
      });
    }
  }

  private renderActions(): void {
    const section = this.element.querySelector('.widget-customizer-actions');
    if (!section) return;

    section.innerHTML = '';

    const resetBtn = new Button('Reset to Default', {
      variant: 'ghost',
      onClick: () => {
        widgetStore.resetToDefault();
        this.renderManageSection();
        this.renderLayoutSection();
      },
    });

    const doneBtn = new Button('Done', {
      variant: 'primary',
      onClick: () => this.close(),
    });

    resetBtn.mount(section as HTMLElement);
    doneBtn.mount(section as HTMLElement);

    this.buttons.push(resetBtn, doneBtn);
  }

  private getIconForType(type: WidgetType): 'code' | 'folder' | 'settings' | 'info' | 'plus' | 'star' {
    const iconMap: Record<WidgetType, 'code' | 'folder' | 'settings' | 'info' | 'plus' | 'star'> = {
      stats: 'info',
      activity: 'folder',
      'quick-actions': 'plus',
      favorites: 'star',
      chart: 'code',
      custom: 'settings',
    };
    return iconMap[type] || 'settings';
  }

  private addWidget(type: WidgetType): void {
    const typeInfo = widgetStore.getAvailableWidgetTypes().find(t => t.type === type);
    const id = `${type}-${Date.now()}`;

    widgetStore.addWidget({
      id,
      type,
      title: typeInfo?.label || 'New Widget',
      size: type === 'stats' ? 'sm' : 'md',
      visible: true,
    });

    this.renderManageSection();
  }

  /**
   * Open customizer in a modal
   */
  openModal(): void {
    this.modal = new Modal({
      title: 'Customize Widgets',
      size: 'lg',
      onClose: () => {
        this.options.onClose?.();
        this.modal = null;
      },
    });

    this.modal.setBody(this.element);
    this.modal.open();

    // Subscribe to store changes
    this.unsubscribe = widgetStore.subscribe(() => {
      this.renderManageSection();
    });
  }

  /**
   * Close modal
   */
  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.modal?.close();
    this.options.onClose?.();
  }

  protected onUnmount(): void {
    this.unsubscribe?.();
    for (const btn of this.buttons) {
      btn.unmount();
    }
    this.buttons = [];
  }
}
