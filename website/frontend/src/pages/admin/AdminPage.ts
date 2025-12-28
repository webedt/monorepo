/**
 * Admin Page
 * Admin-only page for managing platform settings, taxonomies, and more
 */

import { Page, type PageOptions } from '../base/Page';
import { Card, TaxonomyManager, toast } from '../../components';
import { authStore } from '../../stores/authStore';
import { adminApi } from '../../lib/api';
import './admin.css';

type AdminSection = 'taxonomies' | 'users' | 'stats';

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

  protected onUnmount(): void {
    this.taxonomyManager?.unmount();
    this.taxonomyManager = null;

    for (const card of this.cards) {
      card.unmount();
    }
    this.cards = [];
  }
}
