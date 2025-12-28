/**
 * Dashboard Page
 */

import { Page, type PageOptions } from '../base/Page';
import { Card, Button, Icon, GameCard, CommunityActivityWidget } from '../../components';
import { authStore } from '../../stores/authStore';
import { libraryApi } from '../../lib/api';
import type { LibraryItem } from '../../types';
import './dashboard.css';

export class DashboardPage extends Page<PageOptions> {
  readonly route = '/dashboard';
  readonly title = 'Dashboard';
  protected requiresAuth = true;

  private cards: Card[] = [];
  private buttons: Button[] = [];
  private recentlyPlayed: LibraryItem[] = [];
  private loadingRecentlyPlayed = true;
  private communityActivityWidget: CommunityActivityWidget | null = null;

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

        ${this.renderRecentlyPlayed()}

        <div class="dashboard-two-column">
          <section class="dashboard-section">
            <h2 class="section-title">Quick Actions</h2>
            <div class="quick-actions"></div>
          </section>

          <section class="dashboard-section community-activity-section">
            <div id="community-activity-container"></div>
          </section>
        </div>
      </div>
    `;
  }

  private renderRecentlyPlayed(): string {
    if (this.loadingRecentlyPlayed) {
      return `
        <section class="dashboard-section recently-played-section">
          <div class="section-header">
            <h2 class="section-title">Recently Played</h2>
          </div>
          <div class="recently-played-loading">
            <div class="spinner"></div>
          </div>
        </section>
      `;
    }

    if (this.recentlyPlayed.length === 0) {
      return '';
    }

    return `
      <section class="dashboard-section recently-played-section">
        <div class="section-header">
          <h2 class="section-title">Recently Played</h2>
          <a href="#/library?sort=lastPlayed" class="section-link">View All</a>
        </div>
        <div class="recently-played-grid" id="recently-played-grid"></div>
      </section>
    `;
  }

  private async loadRecentlyPlayed(): Promise<void> {
    try {
      const result = await libraryApi.getRecentlyPlayed(6);
      this.recentlyPlayed = result.items || [];
    } catch (error) {
      console.error('Failed to load recently played:', error);
      this.recentlyPlayed = [];
    } finally {
      this.loadingRecentlyPlayed = false;
    }
  }

  private renderRecentlyPlayedCards(): void {
    const grid = this.$('#recently-played-grid');
    if (!grid || this.recentlyPlayed.length === 0) return;

    grid.innerHTML = '';

    for (const item of this.recentlyPlayed) {
      if (!item.game) continue;

      const cardWrapper = document.createElement('div');
      cardWrapper.className = 'recently-played-item';

      const card = new GameCard({
        game: item.game,
        showPrice: false,
        onClick: () => this.navigate(`/game/${item.game!.id}`),
      });

      cardWrapper.appendChild(card.getElement());

      // Add playtime info
      if (item.playtimeMinutes > 0 || item.lastPlayedAt) {
        const info = document.createElement('div');
        info.className = 'recently-played-info';
        info.innerHTML = `
          ${item.playtimeMinutes > 0 ? `<span class="playtime">${this.formatPlaytime(item.playtimeMinutes)}</span>` : ''}
          ${item.lastPlayedAt ? `<span class="last-played">${this.formatLastPlayed(item.lastPlayedAt)}</span>` : ''}
        `;
        cardWrapper.appendChild(info);
      }

      grid.appendChild(cardWrapper);
    }
  }

  private formatPlaytime(minutes: number): string {
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }

  private formatLastPlayed(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Played today';
    if (diffDays === 1) return 'Played yesterday';
    if (diffDays < 7) return `Played ${diffDays} days ago`;
    return `Played ${date.toLocaleDateString()}`;
  }

  protected onMount(): void {
    super.onMount();

    // Load recently played games
    this.loadRecentlyPlayed().then(() => {
      // Re-render section and cards after loading
      const section = this.$('.recently-played-section');
      if (section) {
        section.outerHTML = this.renderRecentlyPlayed();
        this.renderRecentlyPlayedCards();
      }
    });

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

    // Create Community Activity Widget
    const activityContainer = this.$('#community-activity-container') as HTMLElement;
    if (activityContainer) {
      this.communityActivityWidget = new CommunityActivityWidget({
        config: {
          id: 'community-activity',
          type: 'activity',
          title: 'Community Activity',
          size: 'md',
          order: 0,
          visible: true,
        },
        maxItems: 8,
        refreshInterval: 60000, // Refresh every minute
      });
      this.communityActivityWidget.mount(activityContainer);
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
    if (this.communityActivityWidget) {
      this.communityActivityWidget.unmount();
      this.communityActivityWidget = null;
    }
    this.cards = [];
    this.buttons = [];
  }
}
