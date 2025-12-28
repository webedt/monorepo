/**
 * Stats Widget
 * Displays a single statistic with optional trend indicator
 */

import { Widget } from './Widget';
import { Icon } from '../icon';

import type { WidgetOptions, StatsWidgetData } from './types';

export interface StatsWidgetOptions extends WidgetOptions {
  data?: StatsWidgetData;
}

export class StatsWidget extends Widget {
  private data: StatsWidgetData;

  constructor(options: StatsWidgetOptions) {
    super(options);
    this.addClass('widget--stats');

    this.data = options.data || {
      label: options.config.title,
      value: '--',
    };
  }

  renderContent(): void {
    const body = this.getBody();
    if (!body) return;

    body.innerHTML = '';

    const content = document.createElement('div');
    content.className = 'stats-widget-content';

    // Icon (if provided)
    if (this.data.icon) {
      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'stats-widget-icon';
      const icon = new Icon(this.data.icon as 'code' | 'folder', { size: 'lg' });
      iconWrapper.appendChild(icon.getElement());
      content.appendChild(iconWrapper);
    }

    // Main value and info
    const info = document.createElement('div');
    info.className = 'stats-widget-info';

    const value = document.createElement('div');
    value.className = 'stats-widget-value';
    value.textContent = String(this.data.value);
    info.appendChild(value);

    const label = document.createElement('div');
    label.className = 'stats-widget-label';
    label.textContent = this.data.label;
    info.appendChild(label);

    content.appendChild(info);

    // Trend indicator (if provided)
    if (this.data.change) {
      const trend = document.createElement('div');
      trend.className = `stats-widget-trend stats-widget-trend--${this.data.change.type}`;

      const trendIcon = this.data.change.type === 'increase' ? 'chevronUp' :
                        this.data.change.type === 'decrease' ? 'chevronDown' : 'minus';

      const icon = new Icon(trendIcon, { size: 'sm' });
      trend.appendChild(icon.getElement());

      const trendValue = document.createElement('span');
      trendValue.textContent = `${Math.abs(this.data.change.value)}%`;
      trend.appendChild(trendValue);

      content.appendChild(trend);
    }

    body.appendChild(content);
  }

  /**
   * Update the stats data
   */
  setData(data: Partial<StatsWidgetData>): void {
    this.data = { ...this.data, ...data };
    this.renderContent();
  }

  /**
   * Update just the value
   */
  setValue(value: string | number): void {
    this.data.value = value;
    const valueEl = this.getBody()?.querySelector('.stats-widget-value');
    if (valueEl) {
      valueEl.textContent = String(value);
    }
  }
}
