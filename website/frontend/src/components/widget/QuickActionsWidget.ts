/**
 * Quick Actions Widget
 * Displays shortcut buttons for common actions
 */

import { Widget } from './Widget';
import { Button } from '../button';
import { Icon } from '../icon';

import type { WidgetOptions, QuickAction } from './types';

export interface QuickActionsWidgetOptions extends WidgetOptions {
  actions?: QuickAction[];
  layout?: 'grid' | 'list';
}

export class QuickActionsWidget extends Widget {
  private actions: QuickAction[];
  private layout: 'grid' | 'list';
  private buttons: Button[] = [];

  constructor(options: QuickActionsWidgetOptions) {
    super(options);
    this.addClass('widget--quick-actions');

    this.actions = options.actions || [];
    this.layout = options.layout || 'grid';
  }

  renderContent(): void {
    const body = this.getBody();
    if (!body) return;

    // Cleanup existing buttons
    for (const btn of this.buttons) {
      btn.unmount();
    }
    this.buttons = [];

    body.innerHTML = '';

    if (this.actions.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quick-actions-empty';
      empty.textContent = 'No actions configured';
      body.appendChild(empty);
      return;
    }

    const container = document.createElement('div');
    container.className = `quick-actions-container quick-actions-container--${this.layout}`;

    for (const action of this.actions) {
      const actionWrapper = document.createElement('div');
      actionWrapper.className = 'quick-action-wrapper';

      const btn = new Button(action.label, {
        variant: action.variant || 'secondary',
        onClick: action.onClick,
      });

      // Add icon if provided
      if (action.icon) {
        const icon = new Icon(action.icon as 'code' | 'folder', { size: 'sm' });
        btn.getElement().prepend(icon.getElement());
        btn.addClass('btn--with-icon');
      }

      btn.mount(actionWrapper);
      this.buttons.push(btn);
      container.appendChild(actionWrapper);
    }

    body.appendChild(container);
  }

  /**
   * Set actions
   */
  setActions(actions: QuickAction[]): void {
    this.actions = actions;
    this.renderContent();
  }

  /**
   * Add an action
   */
  addAction(action: QuickAction): void {
    this.actions.push(action);
    this.renderContent();
  }

  /**
   * Remove an action
   */
  removeAction(id: string): void {
    this.actions = this.actions.filter(a => a.id !== id);
    this.renderContent();
  }

  /**
   * Set layout mode
   */
  setLayout(layout: 'grid' | 'list'): void {
    this.layout = layout;
    this.renderContent();
  }

  protected onUnmount(): void {
    super.onUnmount();
    for (const btn of this.buttons) {
      btn.unmount();
    }
    this.buttons = [];
  }
}
