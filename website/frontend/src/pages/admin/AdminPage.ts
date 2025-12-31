/**
 * Admin Page
 * Admin-only page for managing platform settings, taxonomies, and more
 */

import { Page, type PageOptions } from '../base/Page';
import { Card, TaxonomyManager, toast } from '../../components';
import { authStore } from '../../stores/authStore';
import { adminApi } from '../../lib/api';
import './admin.css';

type AdminSection = 'taxonomies' | 'users' | 'stats' | 'audit';

export class AdminPage extends Page<PageOptions> {
  readonly route = '/admin';
  readonly title = 'Admin';
  protected requiresAuth = true;
  protected requiresAdmin = true;

  private cards: Card[] = [];
  private taxonomyManager: TaxonomyManager | null = null;
  private currentSection: AdminSection = 'taxonomies';

  protected render(): string {
    const user = authStore.getUser();

    if (!user?.isAdmin) {
      return `
        <div class="admin-page">
          <div class="access-denied">
            <h1>Access Denied</h1>
            <p>You do not have permission to access this page.</p>
          </div>
        </div>
      `;
    }

    return `
      <div class="admin-page">
        <header class="admin-header">
          <h1 class="admin-title">Admin Panel</h1>
          <p class="admin-subtitle">Platform administration and configuration</p>
        </header>

        <div class="admin-layout">
          <nav class="admin-nav">
            <button class="nav-item ${this.currentSection === 'taxonomies' ? 'active' : ''}" data-section="taxonomies">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
              </svg>
              <span>Taxonomies</span>
            </button>
            <button class="nav-item ${this.currentSection === 'users' ? 'active' : ''}" data-section="users">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
              </svg>
              <span>Users</span>
            </button>
            <button class="nav-item ${this.currentSection === 'stats' ? 'active' : ''}" data-section="stats">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="20" x2="18" y2="10"></line>
                <line x1="12" y1="20" x2="12" y2="4"></line>
                <line x1="6" y1="20" x2="6" y2="14"></line>
              </svg>
              <span>Statistics</span>
            </button>
            <button class="nav-item ${this.currentSection === 'audit' ? 'active' : ''}" data-section="audit">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
              <span>Audit Logs</span>
            </button>
          </nav>

          <main class="admin-content">
            <div class="admin-section ${this.currentSection === 'taxonomies' ? 'visible' : ''}" data-content="taxonomies">
              <h2 class="section-title">Taxonomy Management</h2>
              <p class="section-description">Create and manage categories, tags, genres, and other classification systems.</p>
              <div class="taxonomy-manager-container"></div>
            </div>

            <div class="admin-section ${this.currentSection === 'users' ? 'visible' : ''}" data-content="users">
              <h2 class="section-title">User Management</h2>
              <p class="section-description">Manage user accounts and permissions.</p>
              <div class="users-card"></div>
            </div>

            <div class="admin-section ${this.currentSection === 'stats' ? 'visible' : ''}" data-content="stats">
              <h2 class="section-title">Platform Statistics</h2>
              <p class="section-description">View platform usage and performance metrics.</p>
              <div class="stats-card"></div>
            </div>

            <div class="admin-section ${this.currentSection === 'audit' ? 'visible' : ''}" data-content="audit">
              <h2 class="section-title">Admin Audit Trail</h2>
              <p class="section-description">Track security-sensitive admin operations for compliance and accountability.</p>
              <div class="audit-stats-card"></div>
              <div class="audit-logs-card"></div>
            </div>
          </main>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    const user = authStore.getUser();
    if (!user?.isAdmin) return;

    this.setupNavigation();
    this.renderCurrentSection();
  }

  private setupNavigation(): void {
    this.element.querySelectorAll('.nav-item').forEach(el => {
      el.addEventListener('click', () => {
        const section = el.getAttribute('data-section') as AdminSection;
        if (section && section !== this.currentSection) {
          this.currentSection = section;
          this.update({});
        }
      });
    });
  }

  private renderCurrentSection(): void {
    switch (this.currentSection) {
      case 'taxonomies':
        this.renderTaxonomySection();
        break;
      case 'users':
        this.renderUsersSection();
        break;
      case 'stats':
        this.renderStatsSection();
        break;
      case 'audit':
        this.renderAuditSection();
        break;
    }
  }

  private renderTaxonomySection(): void {
    const container = this.$('.taxonomy-manager-container') as HTMLElement;
    if (!container) return;

    this.taxonomyManager = new TaxonomyManager();
    this.taxonomyManager.mount(container);
  }

  private async renderUsersSection(): Promise<void> {
    const container = this.$('.users-card') as HTMLElement;
    if (!container) return;

    try {
      const response = await adminApi.listUsers();
      const users = response.users || [];

      const card = new Card();
      const body = card.body();

      const content = document.createElement('div');
      content.className = 'users-list';
      content.innerHTML = `
        <table class="users-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Display Name</th>
              <th>Admin</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            ${users.map((user: { email: string; displayName?: string; isAdmin: boolean; createdAt: string }) => `
              <tr>
                <td>${this.escapeHtml(user.email)}</td>
                <td>${this.escapeHtml(user.displayName || '-')}</td>
                <td>${user.isAdmin ? 'Yes' : 'No'}</td>
                <td>${new Date(user.createdAt).toLocaleDateString()}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${users.length === 0 ? '<p class="empty-message">No users found</p>' : ''}
      `;

      body.getElement().appendChild(content);
      card.mount(container);
      this.cards.push(card);
    } catch (error) {
      toast.error('Failed to load users');
      console.error('Error loading users:', error);
    }
  }

  private async renderStatsSection(): Promise<void> {
    const container = this.$('.stats-card') as HTMLElement;
    if (!container) return;

    try {
      const response = await adminApi.getStats();
      const stats = response.data || { userCount: 0, sessionCount: 0, activeSessionCount: 0 };

      const card = new Card();
      const body = card.body();

      const content = document.createElement('div');
      content.className = 'stats-grid';
      content.innerHTML = `
        <div class="stat-item">
          <span class="stat-value">${stats.userCount}</span>
          <span class="stat-label">Total Users</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${stats.sessionCount}</span>
          <span class="stat-label">Total Sessions</span>
        </div>
        <div class="stat-item">
          <span class="stat-value">${stats.activeSessionCount}</span>
          <span class="stat-label">Active Sessions</span>
        </div>
      `;

      body.getElement().appendChild(content);
      card.mount(container);
      this.cards.push(card);
    } catch (error) {
      toast.error('Failed to load stats');
      console.error('Error loading stats:', error);
    }
  }

  private async renderAuditSection(): Promise<void> {
    await Promise.all([
      this.renderAuditStats(),
      this.renderAuditLogs(),
    ]);
  }

  private async renderAuditStats(): Promise<void> {
    const container = this.$('.audit-stats-card') as HTMLElement;
    if (!container) return;

    try {
      const response = await adminApi.getAuditStats();
      const stats = response.data || { totalLogs: 0, recentActivityCount: 0, logsByAction: {}, logsByEntityType: {} };

      const card = new Card();
      const body = card.body();

      const content = document.createElement('div');
      content.className = 'audit-stats';
      content.innerHTML = `
        <div class="stats-grid">
          <div class="stat-item">
            <span class="stat-value">${stats.totalLogs}</span>
            <span class="stat-label">Total Audit Logs</span>
          </div>
          <div class="stat-item">
            <span class="stat-value">${stats.recentActivityCount}</span>
            <span class="stat-label">Last 24 Hours</span>
          </div>
        </div>
        ${Object.keys(stats.logsByAction).length > 0 ? `
          <div class="audit-breakdown">
            <h4>Activity by Action</h4>
            <div class="breakdown-list">
              ${Object.entries(stats.logsByAction)
                .sort(([,a], [,b]) => (b as number) - (a as number))
                .slice(0, 5)
                .map(([action, count]) => `
                  <div class="breakdown-item">
                    <span class="breakdown-label">${this.formatActionName(action)}</span>
                    <span class="breakdown-value">${count}</span>
                  </div>
                `).join('')}
            </div>
          </div>
        ` : ''}
      `;

      body.getElement().appendChild(content);
      card.mount(container);
      this.cards.push(card);
    } catch (error) {
      toast.error('Failed to load audit stats');
      console.error('Error loading audit stats:', error);
    }
  }

  private async renderAuditLogs(): Promise<void> {
    const container = this.$('.audit-logs-card') as HTMLElement;
    if (!container) return;

    try {
      const response = await adminApi.getAuditLogs({ limit: 20 });
      const data = response.data || { logs: [], total: 0 };

      const card = new Card();
      const body = card.body();

      const content = document.createElement('div');
      content.className = 'audit-logs';
      content.innerHTML = `
        <h4>Recent Admin Activity</h4>
        ${data.logs.length > 0 ? `
          <table class="audit-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Admin</th>
                <th>Action</th>
                <th>Entity</th>
              </tr>
            </thead>
            <tbody>
              ${data.logs.map((log: { createdAt: string; admin?: { email: string }; adminId: string; action: string; entityType: string; entityId?: string }) => `
                <tr>
                  <td>${this.formatDate(log.createdAt)}</td>
                  <td>${this.escapeHtml(log.admin?.email || log.adminId.slice(0, 8) + '...')}</td>
                  <td><span class="action-badge ${this.getActionClass(log.action)}">${this.formatActionName(log.action)}</span></td>
                  <td>${log.entityType}${log.entityId ? ` (${log.entityId.slice(0, 8)}...)` : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          ${data.total > 20 ? `<p class="audit-more">Showing 20 of ${data.total} logs. Use CLI for full access.</p>` : ''}
        ` : '<p class="empty-message">No audit logs found</p>'}
      `;

      body.getElement().appendChild(content);
      card.mount(container);
      this.cards.push(card);
    } catch (error) {
      toast.error('Failed to load audit logs');
      console.error('Error loading audit logs:', error);
    }
  }

  private formatActionName(action: string): string {
    return action
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  private formatDate(dateStr: string): string {
    const date = new Date(dateStr);
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  private getActionClass(action: string): string {
    if (action.includes('DELETE')) return 'action-delete';
    if (action.includes('CREATE')) return 'action-create';
    if (action.includes('UPDATE') || action.includes('CHANGE')) return 'action-update';
    if (action.includes('IMPERSONATE')) return 'action-warning';
    return 'action-default';
  }

  protected onUnmount(): void {
    this.taxonomyManager?.unmount();
    this.taxonomyManager = null;

    for (const card of this.cards) {
      card.unmount();
    }
    this.cards = [];
  }
}
