/**
 * Health Dashboard Component
 *
 * Displays unified health monitoring for external services including
 * database, GitHub API, Claude API, and image generation providers.
 * Shows real-time status, circuit breaker states, failure rates, and alerts.
 */

import { Component, ComponentOptions } from '../base';
import { Card, CardHeader, CardBody } from '../card';
import { Button } from '../button';
import { Spinner } from '../spinner';
import {
  healthDashboardApi,
  type AggregatedHealthStatus,
  type ServiceHealthStatus,
  type AlertInfo,
  type ServiceStatus,
} from '../../lib/api';
import './health-dashboard.css';

export interface HealthDashboardOptions extends ComponentOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface ResolvedHealthDashboardOptions {
  autoRefresh: boolean;
  refreshInterval: number;
  className?: string;
  id?: string;
  attributes?: Record<string, string>;
}

export class HealthDashboard extends Component {
  private dashboardOptions: ResolvedHealthDashboardOptions;
  private healthData: AggregatedHealthStatus | null = null;
  private loading = true;
  private error: string | null = null;
  private headerEl: HTMLElement | null = null;
  private contentEl: HTMLElement | null = null;

  constructor(options: HealthDashboardOptions = {}) {
    super('div', { className: 'health-dashboard', ...options });

    this.dashboardOptions = {
      autoRefresh: options.autoRefresh ?? true,
      refreshInterval: options.refreshInterval ?? 30000,
      className: options.className,
      id: options.id,
      attributes: options.attributes,
    };

    this.buildStructure();
    this.loadHealthData();
  }

  private buildStructure(): void {
    // Header
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'health-dashboard__header';
    this.headerEl.innerHTML = `
      <div class="health-dashboard__title">
        <h1>Service Health Dashboard</h1>
        <span class="health-dashboard__subtitle">External dependency monitoring</span>
      </div>
      <div class="health-dashboard__actions"></div>
    `;
    this.element.appendChild(this.headerEl);

    // Add refresh button
    const actionsEl = this.headerEl.querySelector('.health-dashboard__actions');
    if (actionsEl) {
      const refreshBtn = new Button('Refresh', {
        variant: 'secondary',
        onClick: () => this.loadHealthData(),
      });
      refreshBtn.getElement().classList.add('health-dashboard__refresh-btn');
      actionsEl.appendChild(refreshBtn.getElement());
    }

    // Main content
    this.contentEl = document.createElement('div');
    this.contentEl.className = 'health-dashboard__content';
    this.element.appendChild(this.contentEl);
  }

  private async loadHealthData(): Promise<void> {
    this.loading = true;
    this.error = null;
    this.render();

    try {
      this.healthData = await healthDashboardApi.getHealth();
      this.loading = false;
      this.render();
    } catch (err) {
      this.loading = false;
      this.error = err instanceof Error ? err.message : 'Failed to load health data';
      this.render();
    }
  }

  render(): this {
    if (!this.contentEl) return this;

    this.contentEl.innerHTML = '';

    if (this.loading) {
      const spinnerContainer = document.createElement('div');
      spinnerContainer.className = 'health-dashboard__loading';
      const spinner = new Spinner({ size: 'lg' });
      spinnerContainer.appendChild(spinner.getElement());
      spinnerContainer.appendChild(document.createTextNode('Loading health data...'));
      this.contentEl.appendChild(spinnerContainer);
      return this;
    }

    if (this.error) {
      const errorEl = document.createElement('div');
      errorEl.className = 'health-dashboard__error';
      errorEl.textContent = this.error;
      this.contentEl.appendChild(errorEl);
      return this;
    }

    if (!this.healthData) return this;

    // Overall status banner
    this.renderOverallStatus();

    // Alerts section
    this.renderAlerts();

    // Services grid
    this.renderServices();

    // Application metrics
    this.renderMetrics();

    return this;
  }

  private renderOverallStatus(): void {
    if (!this.healthData || !this.contentEl) return;

    const statusEl = document.createElement('div');
    statusEl.className = `health-dashboard__overall-status health-dashboard__overall-status--${this.healthData.overallStatus}`;

    const statusIcon = this.getStatusIcon(this.healthData.overallStatus);
    const statusLabel = this.formatStatus(this.healthData.overallStatus);

    statusEl.innerHTML = `
      <div class="health-dashboard__overall-icon">${statusIcon}</div>
      <div class="health-dashboard__overall-info">
        <span class="health-dashboard__overall-label">${statusLabel}</span>
        <span class="health-dashboard__overall-summary">
          ${this.healthData.summary.healthy}/${this.healthData.summary.total} services healthy
        </span>
      </div>
      <div class="health-dashboard__timestamp">
        Last updated: ${new Date(this.healthData.timestamp).toLocaleTimeString()}
      </div>
    `;

    this.contentEl.appendChild(statusEl);
  }

  private renderAlerts(): void {
    if (!this.healthData || !this.contentEl) return;

    const alertsCard = new Card({
      className: 'health-dashboard__alerts-card',
    });

    const cardHeader = new CardHeader();
    cardHeader.getElement().textContent = `Alerts (${this.healthData.alerts.length})`;
    alertsCard.getElement().prepend(cardHeader.getElement());

    const cardBody = new CardBody();
    const alertsContent = document.createElement('div');
    alertsContent.className = 'health-dashboard__alerts';

    if (this.healthData.alerts.length === 0) {
      alertsContent.innerHTML = '<div class="health-dashboard__no-alerts">No active alerts</div>';
    } else {
      for (const alert of this.healthData.alerts) {
        const alertEl = this.createAlertElement(alert);
        alertsContent.appendChild(alertEl);
      }
    }

    cardBody.getElement().appendChild(alertsContent);
    alertsCard.getElement().appendChild(cardBody.getElement());
    this.contentEl.appendChild(alertsCard.getElement());
  }

  private createAlertElement(alert: AlertInfo): HTMLElement {
    const el = document.createElement('div');
    el.className = `health-dashboard__alert health-dashboard__alert--${alert.severity}`;

    const icon = this.getAlertIcon(alert.severity);
    const time = new Date(alert.triggeredAt).toLocaleTimeString();

    el.innerHTML = `
      <div class="health-dashboard__alert-icon">${icon}</div>
      <div class="health-dashboard__alert-content">
        <div class="health-dashboard__alert-message">${alert.message}</div>
        <div class="health-dashboard__alert-meta">
          <span class="health-dashboard__alert-threshold">${alert.threshold}</span>
          <span class="health-dashboard__alert-time">${time}</span>
        </div>
      </div>
    `;

    return el;
  }

  private renderServices(): void {
    if (!this.healthData || !this.contentEl) return;

    const servicesSection = document.createElement('div');
    servicesSection.className = 'health-dashboard__services-section';

    const heading = document.createElement('h2');
    heading.className = 'health-dashboard__section-title';
    heading.textContent = 'Services';
    servicesSection.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'health-dashboard__services-grid';

    for (const service of this.healthData.services) {
      const serviceCard = this.createServiceCard(service);
      grid.appendChild(serviceCard);
    }

    servicesSection.appendChild(grid);
    this.contentEl.appendChild(servicesSection);
  }

  private createServiceCard(service: ServiceHealthStatus): HTMLElement {
    const card = document.createElement('div');
    card.className = `health-dashboard__service-card health-dashboard__service-card--${service.status}`;

    const statusIcon = this.getStatusIcon(service.status);
    const latency = service.latencyMs !== null ? `${service.latencyMs}ms` : 'N/A';
    const lastCheck = service.lastCheck
      ? new Date(service.lastCheck).toLocaleTimeString()
      : 'Never';

    let circuitBreakerHtml = '';
    if (service.circuitBreaker) {
      const cbState = service.circuitBreaker.state;
      const cbClass = cbState === 'closed' ? 'closed' : cbState === 'open' ? 'open' : 'half-open';
      circuitBreakerHtml = `
        <div class="health-dashboard__circuit-breaker">
          <span class="health-dashboard__cb-label">Circuit Breaker:</span>
          <span class="health-dashboard__cb-state health-dashboard__cb-state--${cbClass}">${cbState.toUpperCase()}</span>
        </div>
      `;

      if (service.circuitBreaker.stats) {
        const stats = service.circuitBreaker.stats;
        circuitBreakerHtml += `
          <div class="health-dashboard__cb-stats">
            <span title="Total Successes">S: ${stats.totalSuccesses}</span>
            <span title="Total Failures">F: ${stats.totalFailures}</span>
            <span title="Consecutive Failures">CF: ${stats.consecutiveFailures}</span>
          </div>
        `;
      }
    }

    let historyHtml = '';
    if (service.history) {
      const failurePercent = (service.history.failureRate * 100).toFixed(1);
      historyHtml = `
        <div class="health-dashboard__history">
          <span title="Average Latency">Avg: ${service.history.averageLatencyMs}ms</span>
          <span title="Failure Rate">Fail: ${failurePercent}%</span>
        </div>
      `;
    }

    let alertHtml = '';
    if (service.alert) {
      const alertIcon = this.getAlertIcon(service.alert.severity);
      alertHtml = `
        <div class="health-dashboard__service-alert health-dashboard__service-alert--${service.alert.severity}">
          ${alertIcon} ${service.alert.severity.toUpperCase()}
        </div>
      `;
    }

    card.innerHTML = `
      <div class="health-dashboard__service-header">
        <div class="health-dashboard__service-status">${statusIcon}</div>
        <div class="health-dashboard__service-name">${service.displayName}</div>
        ${alertHtml}
      </div>
      <div class="health-dashboard__service-body">
        <div class="health-dashboard__service-metrics">
          <div class="health-dashboard__metric">
            <span class="health-dashboard__metric-label">Latency</span>
            <span class="health-dashboard__metric-value">${latency}</span>
          </div>
          <div class="health-dashboard__metric">
            <span class="health-dashboard__metric-label">Last Check</span>
            <span class="health-dashboard__metric-value">${lastCheck}</span>
          </div>
        </div>
        ${circuitBreakerHtml}
        ${historyHtml}
      </div>
    `;

    return card;
  }

  private renderMetrics(): void {
    if (!this.healthData || !this.contentEl) return;

    const metricsCard = new Card({
      className: 'health-dashboard__metrics-card',
    });

    const cardHeader = new CardHeader();
    cardHeader.getElement().textContent = 'Application Metrics';
    metricsCard.getElement().prepend(cardHeader.getElement());

    const cardBody = new CardBody();
    const metricsContent = document.createElement('div');
    metricsContent.className = 'health-dashboard__metrics';

    const { metrics } = this.healthData;
    const uptimeHours = (metrics.uptime / 3600).toFixed(1);
    const errorPercent = (metrics.errorRate * 100).toFixed(2);

    metricsContent.innerHTML = `
      <div class="health-dashboard__metrics-grid">
        <div class="health-dashboard__metric-item">
          <span class="health-dashboard__metric-value">${uptimeHours}h</span>
          <span class="health-dashboard__metric-label">Uptime</span>
        </div>
        <div class="health-dashboard__metric-item">
          <span class="health-dashboard__metric-value">${metrics.totalRequests.toLocaleString()}</span>
          <span class="health-dashboard__metric-label">Total Requests</span>
        </div>
        <div class="health-dashboard__metric-item">
          <span class="health-dashboard__metric-value">${errorPercent}%</span>
          <span class="health-dashboard__metric-label">Error Rate</span>
        </div>
        <div class="health-dashboard__metric-item">
          <span class="health-dashboard__metric-value">${metrics.avgResponseTime.toFixed(0)}ms</span>
          <span class="health-dashboard__metric-label">Avg Response</span>
        </div>
      </div>
    `;

    cardBody.getElement().appendChild(metricsContent);
    metricsCard.getElement().appendChild(cardBody.getElement());
    this.contentEl.appendChild(metricsCard.getElement());
  }

  private getStatusIcon(status: ServiceStatus): string {
    switch (status) {
      case 'healthy':
        return '<svg class="health-icon health-icon--healthy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>';
      case 'degraded':
        return '<svg class="health-icon health-icon--degraded" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
      case 'unhealthy':
        return '<svg class="health-icon health-icon--unhealthy" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
      default:
        return '<svg class="health-icon health-icon--unknown" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    }
  }

  private getAlertIcon(severity: AlertInfo['severity']): string {
    switch (severity) {
      case 'critical':
        return '<svg class="alert-icon alert-icon--critical" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"></polygon><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
      case 'warning':
        return '<svg class="alert-icon alert-icon--warning" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
      default:
        return '<svg class="alert-icon alert-icon--info" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    }
  }

  private formatStatus(status: ServiceStatus): string {
    switch (status) {
      case 'healthy':
        return 'All Systems Operational';
      case 'degraded':
        return 'Some Services Degraded';
      case 'unhealthy':
        return 'Service Outage Detected';
      default:
        return 'Status Unknown';
    }
  }

  protected onMount(): void {
    if (this.dashboardOptions.autoRefresh) {
      this.timers.setInterval(() => this.loadHealthData(), this.dashboardOptions.refreshInterval);
    }
  }

  refresh(): void {
    this.loadHealthData();
  }
}
