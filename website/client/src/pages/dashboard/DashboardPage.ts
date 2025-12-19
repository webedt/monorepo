/**
 * Dashboard Page
 */

import { Page, type PageOptions } from '../base/Page';
import { Card, Button, Icon } from '../../components';
import { authStore } from '../../stores/authStore';
import './dashboard.css';

export class DashboardPage extends Page<PageOptions> {
  readonly route = '/dashboard';
  readonly title = 'Dashboard';
  protected requiresAuth = true;

  private cards: Card[] = [];
  private buttons: Button[] = [];

  protected render(): string {
    const user = authStore.getUser();

    return `
      <div class="dashboard-page">
        <header class="dashboard-header">
          <h1 class="dashboard-title">Welcome back${user?.displayName ? `, ${user.displayName}` : ''}!</h1>
          <p class="dashboard-subtitle">What would you like to work on today?</p>
        </header>

        <div class="dashboard-grid">
          <div class="dashboard-card" data-action="new-session"></div>
          <div class="dashboard-card" data-action="view-sessions"></div>
          <div class="dashboard-card" data-action="settings"></div>
        </div>

        <section class="dashboard-section">
          <h2 class="section-title">Quick Actions</h2>
          <div class="quick-actions"></div>
        </section>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Create action cards
    this.createActionCard(
      '[data-action="new-session"]',
      'code',
      'New Agent Session',
      'Start a new AI coding session with your repository',
      () => this.navigate('/agents')
    );

    this.createActionCard(
      '[data-action="view-sessions"]',
      'folder',
      'Agent Sessions',
      'View and manage your AI coding sessions',
      () => this.navigate('/agents')
    );

    this.createActionCard(
      '[data-action="settings"]',
      'settings',
      'Settings',
      'Configure your account and preferences',
      () => this.navigate('/settings')
    );

    // Create quick action buttons
    const quickActions = this.$('.quick-actions') as HTMLElement;
    if (quickActions) {
      const actions = [
        { text: 'Connect GitHub', action: () => this.navigate('/settings') },
        { text: 'Quick Chat', action: () => this.navigate('/agents') },
      ];

      for (const action of actions) {
        const btn = new Button(action.text, {
          variant: 'secondary',
          onClick: action.action,
        });
        btn.mount(quickActions);
        this.buttons.push(btn);
      }
    }
  }

  private createActionCard(
    selector: string,
    iconName: 'code' | 'folder' | 'settings',
    title: string,
    description: string,
    onClick: () => void
  ): void {
    const container = this.$(selector) as HTMLElement;
    if (!container) return;

    const content = document.createElement('div');
    content.className = 'action-card-content';
    content.innerHTML = `
      <div class="action-card-icon"></div>
      <h3 class="action-card-title">${title}</h3>
      <p class="action-card-description">${description}</p>
    `;

    // Add icon
    const iconContainer = content.querySelector('.action-card-icon') as HTMLElement;
    if (iconContainer) {
      const iconComponent = new Icon(iconName, { size: 'xl' });
      iconComponent.mount(iconContainer);
    }

    const card = new Card({ interactive: true, onClick });
    const body = card.body();
    body.getElement().appendChild(content);
    card.mount(container);
    this.cards.push(card);
  }

  protected onUnmount(): void {
    for (const card of this.cards) {
      card.unmount();
    }
    for (const btn of this.buttons) {
      btn.unmount();
    }
    this.cards = [];
    this.buttons = [];
  }
}
