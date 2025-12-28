/**
 * Chart Widget
 * Displays data visualization with simple bar/line charts
 */

import { Widget } from './Widget';

import type { WidgetOptions, ChartDataPoint, WidgetSize } from './types';

export type ChartType = 'bar' | 'line' | 'donut';

export interface ChartWidgetOptions extends WidgetOptions {
  chartType?: ChartType;
  data?: ChartDataPoint[];
  showLegend?: boolean;
  animate?: boolean;
}

const DEFAULT_COLORS = [
  'var(--color-primary-500)',
  'var(--color-success-500)',
  'var(--color-warning-500)',
  'var(--color-error-500)',
  'var(--color-info-500)',
  'var(--color-primary-300)',
  'var(--color-success-300)',
  'var(--color-warning-300)',
];

export class ChartWidget extends Widget {
  private chartType: ChartType;
  private data: ChartDataPoint[];
  private showLegend: boolean;
  private animate: boolean;

  constructor(options: ChartWidgetOptions) {
    super(options);
    this.addClass('widget--chart');

    this.chartType = options.chartType || 'bar';
    this.data = options.data || [];
    this.showLegend = options.showLegend ?? true;
    this.animate = options.animate ?? true;
  }

  renderContent(): void {
    const body = this.getBody();
    if (!body) return;

    body.innerHTML = '';

    if (this.data.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chart-widget-empty';
      empty.textContent = 'No data available';
      body.appendChild(empty);
      return;
    }

    const container = document.createElement('div');
    container.className = 'chart-widget-container';

    // Render chart based on type
    switch (this.chartType) {
      case 'bar':
        this.renderBarChart(container);
        break;
      case 'line':
        this.renderLineChart(container);
        break;
      case 'donut':
        this.renderDonutChart(container);
        break;
    }

    body.appendChild(container);

    // Render legend if enabled
    if (this.showLegend) {
      const legend = this.renderLegend();
      body.appendChild(legend);
    }
  }

  private renderBarChart(container: HTMLElement): void {
    const chart = document.createElement('div');
    chart.className = 'chart-bar';

    const maxValue = Math.max(...this.data.map(d => d.value));

    for (let i = 0; i < this.data.length; i++) {
      const point = this.data[i];
      const barWrapper = document.createElement('div');
      barWrapper.className = 'chart-bar-wrapper';

      const bar = document.createElement('div');
      bar.className = 'chart-bar-item';
      const height = maxValue > 0 ? (point.value / maxValue) * 100 : 0;
      bar.style.height = this.animate ? '0%' : `${height}%`;
      bar.style.backgroundColor = point.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];
      bar.setAttribute('title', `${point.label}: ${point.value}`);

      if (this.animate) {
        requestAnimationFrame(() => {
          bar.style.height = `${height}%`;
        });
      }

      barWrapper.appendChild(bar);

      const label = document.createElement('div');
      label.className = 'chart-bar-label';
      label.textContent = point.label;
      barWrapper.appendChild(label);

      chart.appendChild(barWrapper);
    }

    container.appendChild(chart);
  }

  private renderLineChart(container: HTMLElement): void {
    const chart = document.createElement('div');
    chart.className = 'chart-line';

    const maxValue = Math.max(...this.data.map(d => d.value));
    const minValue = Math.min(...this.data.map(d => d.value));
    const range = maxValue - minValue || 1;

    // Create SVG
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 100 50');
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.classList.add('chart-line-svg');

    // Create path
    const dataLength = this.data.length;
    const points = this.data.map((d, i) => {
      // Handle single data point case to avoid division by zero
      const x = dataLength === 1 ? 50 : (i / (dataLength - 1)) * 100;
      const y = 50 - ((d.value - minValue) / range) * 45;
      return `${x},${y}`;
    });

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    path.setAttribute('points', points.join(' '));
    path.classList.add('chart-line-path');
    if (this.animate) {
      path.classList.add('chart-line-path--animate');
    }

    svg.appendChild(path);

    // Add dots
    this.data.forEach((d, i) => {
      // Handle single data point case to avoid division by zero
      const x = dataLength === 1 ? 50 : (i / (dataLength - 1)) * 100;
      const y = 50 - ((d.value - minValue) / range) * 45;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', String(x));
      circle.setAttribute('cy', String(y));
      circle.setAttribute('r', '2');
      circle.classList.add('chart-line-dot');

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${d.label}: ${d.value}`;
      circle.appendChild(title);

      svg.appendChild(circle);
    });

    chart.appendChild(svg);

    // X-axis labels
    const labels = document.createElement('div');
    labels.className = 'chart-line-labels';
    for (const point of this.data) {
      const label = document.createElement('span');
      label.textContent = point.label;
      labels.appendChild(label);
    }
    chart.appendChild(labels);

    container.appendChild(chart);
  }

  private renderDonutChart(container: HTMLElement): void {
    const chart = document.createElement('div');
    chart.className = 'chart-donut';

    const total = this.data.reduce((sum, d) => sum + d.value, 0);
    if (total === 0) {
      chart.innerHTML = '<div class="chart-donut-empty">No data</div>';
      container.appendChild(chart);
      return;
    }

    // Create SVG donut
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 42 42');
    svg.classList.add('chart-donut-svg');

    let accumulatedPercent = 0;
    const radius = 15.9155;
    const circumference = 2 * Math.PI * radius;

    for (let i = 0; i < this.data.length; i++) {
      const point = this.data[i];
      const percent = (point.value / total) * 100;

      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', '21');
      circle.setAttribute('cy', '21');
      circle.setAttribute('r', String(radius));
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', point.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]);
      circle.setAttribute('stroke-width', '5');

      const dashLength = (percent / 100) * circumference;
      const dashGap = circumference - dashLength;
      circle.setAttribute('stroke-dasharray', `${dashLength} ${dashGap}`);
      circle.setAttribute('stroke-dashoffset', String((25 - accumulatedPercent) / 100 * circumference));

      if (this.animate) {
        circle.classList.add('chart-donut-segment--animate');
      }

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${point.label}: ${point.value} (${percent.toFixed(1)}%)`;
      circle.appendChild(title);

      svg.appendChild(circle);
      accumulatedPercent += percent;
    }

    // Center text
    const centerText = document.createElement('div');
    centerText.className = 'chart-donut-center';
    centerText.innerHTML = `<span class="chart-donut-total">${total}</span><span class="chart-donut-label">Total</span>`;

    chart.appendChild(svg);
    chart.appendChild(centerText);
    container.appendChild(chart);
  }

  private renderLegend(): HTMLElement {
    const legend = document.createElement('div');
    legend.className = 'chart-legend';

    for (let i = 0; i < this.data.length; i++) {
      const point = this.data[i];
      const item = document.createElement('div');
      item.className = 'chart-legend-item';

      const color = document.createElement('span');
      color.className = 'chart-legend-color';
      color.style.backgroundColor = point.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length];

      const label = document.createElement('span');
      label.className = 'chart-legend-label';
      label.textContent = point.label;

      item.appendChild(color);
      item.appendChild(label);
      legend.appendChild(item);
    }

    return legend;
  }

  /**
   * Set chart data
   */
  setData(data: ChartDataPoint[]): void {
    this.data = data;
    this.renderContent();
  }

  /**
   * Set chart type
   */
  setChartType(type: ChartType): void {
    this.chartType = type;
    this.renderContent();
  }

  /**
   * Toggle legend
   */
  toggleLegend(show?: boolean): void {
    this.showLegend = show ?? !this.showLegend;
    this.renderContent();
  }

  protected onResize(_size: WidgetSize): void {
    this.renderContent();
  }
}
