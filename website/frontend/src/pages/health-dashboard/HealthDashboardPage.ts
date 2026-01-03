/**
 * Health Dashboard Page
 * Admin page for monitoring external service health
 */

import { Page } from '../base/Page';
import { HealthDashboard } from '../../components/health-dashboard';

export class HealthDashboardPage extends Page {
  readonly route = '/health-dashboard';
  readonly title = 'Health Dashboard | WebEDT';
  protected requiresAuth = true;
  protected requiresAdmin = true;

  private dashboard: HealthDashboard | null = null;

  protected render(): string {
    return `
      <div class="health-dashboard-page">
        <div id="health-dashboard-container"></div>
      </div>
    `;
  }

  protected onMount(): void {
    const container = this.element.querySelector('#health-dashboard-container');
    if (container) {
      this.dashboard = new HealthDashboard({
        autoRefresh: true,
        refreshInterval: 30000,
      });
      container.appendChild(this.dashboard.getElement());
    }
  }

  protected onUnmount(): void {
    if (this.dashboard) {
      this.dashboard.unmount();
      this.dashboard = null;
    }
  }
}
