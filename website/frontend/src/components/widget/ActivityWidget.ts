/**
 * Activity Widget
 * Displays a feed of recent activity items
 */

import { Widget } from './Widget';
import { Icon } from '../icon';

import type { WidgetOptions, ActivityItem } from './types';

export interface ActivityWidgetOptions extends WidgetOptions {
  items?: ActivityItem[];
  maxItems?: number;
}

const TYPE_ICONS: Record<ActivityItem['type'], string> = {
  info: 'info',
  success: 'check',
  warning: 'alert',
  error: 'x',
};

export class ActivityWidget extends Widget {
  private items: ActivityItem[];
  private maxItems: number;

  constructor(options: ActivityWidgetOptions) {
    super(options);
    this.addClass('widget--activity');

    this.items = options.items || [];
    this.maxItems = options.maxItems || 10;
  }

  renderContent(): void {
    const body = this.getBody();
    if (!body) return;

    body.innerHTML = '';

    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'activity-widget-empty';
      empty.textContent = 'No recent activity';
      body.appendChild(empty);
      return;
    }

    const list = document.createElement('ul');
    list.className = 'activity-widget-list';

    const displayItems = this.items.slice(0, this.maxItems);

    for (const item of displayItems) {
      const li = document.createElement('li');
      li.className = `activity-widget-item activity-widget-item--${item.type}`;
      li.setAttribute('data-activity-id', item.id);

      // Icon
      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'activity-item-icon';
      const iconName = item.icon || TYPE_ICONS[item.type];
      const icon = new Icon(iconName as 'info' | 'check', { size: 'sm' });
      iconWrapper.appendChild(icon.getElement());
      li.appendChild(iconWrapper);

      // Content
      const content = document.createElement('div');
      content.className = 'activity-item-content';

      const title = document.createElement('div');
      title.className = 'activity-item-title';
      title.textContent = item.title;
      content.appendChild(title);

      if (item.description) {
        const desc = document.createElement('div');
        desc.className = 'activity-item-description';
        desc.textContent = item.description;
        content.appendChild(desc);
      }

      const time = document.createElement('time');
      time.className = 'activity-item-time';
      time.dateTime = item.timestamp.toISOString();
      time.textContent = this.formatTime(item.timestamp);
      content.appendChild(time);

      li.appendChild(content);
      list.appendChild(li);
    }

    body.appendChild(list);
  }

  private formatTime(date: Date): string {
    const now = new Date();
    const diff = now.getTime() - date.getTime();

    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return date.toLocaleDateString();
  }

  /**
   * Set activity items
   */
  setItems(items: ActivityItem[]): void {
    this.items = items;
    this.renderContent();
  }

  /**
   * Add a new activity item
   */
  addItem(item: ActivityItem): void {
    this.items.unshift(item);
    if (this.items.length > this.maxItems * 2) {
      this.items = this.items.slice(0, this.maxItems * 2);
    }
    this.renderContent();
  }

  /**
   * Remove an activity item
   */
  removeItem(id: string): void {
    this.items = this.items.filter(item => item.id !== id);
    this.renderContent();
  }

  /**
   * Clear all items
   */
  clearItems(): void {
    this.items = [];
    this.renderContent();
  }
}
