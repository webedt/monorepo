/**
 * Connection Quality Indicator Component
 *
 * Displays the current SSE connection quality with visual indicators
 * and optional detailed metrics on hover.
 */

import { Component, ComponentOptions } from '../base';
import type { ConnectionQuality, ConnectionMetrics } from '../../lib/events';
import './connection-quality-indicator.css';

export type IndicatorSize = 'sm' | 'md' | 'lg';

export interface ConnectionQualityIndicatorOptions extends ComponentOptions {
  /** Initial connection quality */
  quality?: ConnectionQuality;
  /** Size of the indicator */
  size?: IndicatorSize;
  /** Show detailed metrics on hover */
  showDetails?: boolean;
  /** Compact mode - show only the dot */
  compact?: boolean;
  /** Custom label (overrides default status text) */
  label?: string;
}

export class ConnectionQualityIndicator extends Component<HTMLDivElement> {
  private options: Required<Omit<ConnectionQualityIndicatorOptions, keyof ComponentOptions | 'label'>> & { label?: string };
  private dotElement: HTMLDivElement | null = null;
  private labelElement: HTMLSpanElement | null = null;
  private tooltipElement: HTMLDivElement | null = null;
  private currentMetrics: ConnectionMetrics | null = null;

  constructor(options: ConnectionQualityIndicatorOptions = {}) {
    super('div', {
      className: 'connection-quality-indicator',
      ...options,
    });

    this.options = {
      quality: 'disconnected',
      size: 'md',
      showDetails: true,
      compact: false,
      label: options.label,
      ...options,
    };

    this.buildStructure();
    this.setQuality(this.options.quality);
  }

  private buildStructure(): void {
    const { size, compact, showDetails } = this.options;

    // Add size class
    this.element.classList.add(`connection-quality-indicator--${size}`);

    if (compact) {
      this.element.classList.add('connection-quality-indicator--compact');
    }

    // Create the dot indicator
    this.dotElement = document.createElement('div');
    this.dotElement.className = 'connection-quality-dot';
    this.element.appendChild(this.dotElement);

    // Create label (unless compact mode)
    if (!compact) {
      this.labelElement = document.createElement('span');
      this.labelElement.className = 'connection-quality-label';
      this.element.appendChild(this.labelElement);
    }

    // Create tooltip for details
    if (showDetails) {
      this.tooltipElement = document.createElement('div');
      this.tooltipElement.className = 'connection-quality-tooltip';
      this.element.appendChild(this.tooltipElement);

      // Show tooltip on hover
      this.on('mouseenter', () => this.showTooltip());
      this.on('mouseleave', () => this.hideTooltip());
    }
  }

  /**
   * Set the connection quality state
   */
  setQuality(quality: ConnectionQuality, metrics?: ConnectionMetrics): this {
    this.options.quality = quality;
    this.currentMetrics = metrics || null;

    // Remove old quality classes
    const qualityClasses = ['excellent', 'good', 'poor', 'disconnected'];
    for (const cls of qualityClasses) {
      this.element.classList.remove(`connection-quality-indicator--${cls}`);
      this.dotElement?.classList.remove(`connection-quality-dot--${cls}`);
    }

    // Add new quality class
    this.element.classList.add(`connection-quality-indicator--${quality}`);
    this.dotElement?.classList.add(`connection-quality-dot--${quality}`);

    // Update label text
    if (this.labelElement) {
      this.labelElement.textContent = this.options.label || this.getQualityLabel(quality);
    }

    // Update tooltip content
    this.updateTooltip();

    // Update title for accessibility
    this.element.title = this.getQualityDescription(quality);

    return this;
  }

  /**
   * Update with new metrics
   */
  updateMetrics(metrics: ConnectionMetrics): this {
    this.currentMetrics = metrics;
    this.setQuality(metrics.quality, metrics);
    return this;
  }

  /**
   * Get the current quality state
   */
  getQuality(): ConnectionQuality {
    return this.options.quality;
  }

  /**
   * Get a human-readable label for the quality
   */
  private getQualityLabel(quality: ConnectionQuality): string {
    switch (quality) {
      case 'excellent':
        return 'Connected';
      case 'good':
        return 'Connected';
      case 'poor':
        return 'Unstable';
      case 'disconnected':
        return 'Offline';
      default:
        return 'Unknown';
    }
  }

  /**
   * Get a description for accessibility
   */
  private getQualityDescription(quality: ConnectionQuality): string {
    switch (quality) {
      case 'excellent':
        return 'Connection is excellent';
      case 'good':
        return 'Connection is good with minor issues';
      case 'poor':
        return 'Connection is unstable, some events may be delayed';
      case 'disconnected':
        return 'Not connected to server';
      default:
        return 'Connection status unknown';
    }
  }

  /**
   * Show the tooltip with detailed metrics
   */
  private showTooltip(): void {
    if (!this.tooltipElement) return;
    this.updateTooltip();
    this.tooltipElement.classList.add('connection-quality-tooltip--visible');
  }

  /**
   * Hide the tooltip
   */
  private hideTooltip(): void {
    if (!this.tooltipElement) return;
    this.tooltipElement.classList.remove('connection-quality-tooltip--visible');
  }

  /**
   * Update tooltip content with current metrics
   */
  private updateTooltip(): void {
    if (!this.tooltipElement) return;

    const quality = this.options.quality;
    const metrics = this.currentMetrics;

    let content = `<div class="tooltip-header">${this.getQualityDescription(quality)}</div>`;

    if (metrics) {
      content += '<div class="tooltip-metrics">';

      // Events received
      content += `<div class="tooltip-metric">
        <span class="tooltip-metric-label">Events received:</span>
        <span class="tooltip-metric-value">${metrics.eventsReceived}</span>
      </div>`;

      // Events replayed (recovered)
      if (metrics.eventsReplayed > 0) {
        content += `<div class="tooltip-metric">
          <span class="tooltip-metric-label">Events recovered:</span>
          <span class="tooltip-metric-value">${metrics.eventsReplayed}</span>
        </div>`;
      }

      // Reconnection attempts
      if (metrics.reconnectAttempts > 0) {
        content += `<div class="tooltip-metric tooltip-metric--warning">
          <span class="tooltip-metric-label">Reconnections:</span>
          <span class="tooltip-metric-value">${metrics.reconnectAttempts}</span>
        </div>`;
      }

      // Gaps detected
      if (metrics.gapsDetected > 0) {
        content += `<div class="tooltip-metric tooltip-metric--warning">
          <span class="tooltip-metric-label">Gaps detected:</span>
          <span class="tooltip-metric-value">${metrics.gapsDetected}</span>
        </div>`;
      }

      // Replaying status
      if (metrics.isReplaying) {
        content += `<div class="tooltip-metric tooltip-metric--info">
          <span class="tooltip-metric-label">Status:</span>
          <span class="tooltip-metric-value">Recovering...</span>
        </div>`;
      }

      // Latency
      if (metrics.latencyMs !== null) {
        content += `<div class="tooltip-metric">
          <span class="tooltip-metric-label">Latency:</span>
          <span class="tooltip-metric-value">${metrics.latencyMs}ms</span>
        </div>`;
      }

      content += '</div>';
    }

    this.tooltipElement.innerHTML = content;
  }

  /**
   * Start pulsing animation (for active streaming)
   */
  startPulse(): this {
    this.dotElement?.classList.add('connection-quality-dot--pulse');
    return this;
  }

  /**
   * Stop pulsing animation
   */
  stopPulse(): this {
    this.dotElement?.classList.remove('connection-quality-dot--pulse');
    return this;
  }

  /**
   * Set compact mode
   */
  setCompact(compact: boolean): this {
    this.options.compact = compact;
    this.element.classList.toggle('connection-quality-indicator--compact', compact);

    if (compact && this.labelElement) {
      this.labelElement.remove();
      this.labelElement = null;
    } else if (!compact && !this.labelElement) {
      this.labelElement = document.createElement('span');
      this.labelElement.className = 'connection-quality-label';
      this.labelElement.textContent = this.options.label || this.getQualityLabel(this.options.quality);
      this.dotElement?.after(this.labelElement);
    }

    return this;
  }
}
