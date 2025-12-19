/**
 * Agents Page
 * Lists and manages AI coding sessions
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Input, Icon, Spinner, toast } from '../../components';
import { sessionsApi } from '../../lib/api';
import type { Session } from '../../types';
import './agents.css';

export class AgentsPage extends Page<PageOptions> {
  readonly route = '/agents';
  readonly title = 'Agent Sessions';
  protected requiresAuth = true;

  private sessions: Session[] = [];
  private filteredSessions: Session[] = [];
  private searchInput: Input | null = null;
  private newSessionBtn: Button | null = null;
  private spinner: Spinner | null = null;
  private emptyIcon: Icon | null = null;
  private isLoading = true;

  protected render(): string {
    return `
      <div class="agents-page">
        <header class="agents-header">
          <div class="agents-header-left">
            <h1 class="agents-title">Agent Sessions</h1>
            <p class="agents-subtitle">Manage your AI coding sessions</p>
          </div>
          <div class="agents-header-right">
            <div class="search-container"></div>
            <div class="new-session-btn"></div>
          </div>
        </header>

        <div class="sessions-container">
          <div class="sessions-loading">
            <div class="spinner-container"></div>
          </div>
          <div class="sessions-empty" style="display: none;">
            <div class="empty-icon"></div>
            <h3 class="empty-title">No agent sessions yet</h3>
            <p class="empty-description">Start a new session to begin coding with AI</p>
          </div>
          <div class="sessions-list" style="display: none;"></div>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Create search input
    const searchContainer = this.$('.search-container') as HTMLElement;
    if (searchContainer) {
      this.searchInput = new Input({
        type: 'search',
        placeholder: 'Search agent sessions...',
        onChange: (value) => this.handleSearch(value),
      });
      this.searchInput.mount(searchContainer);
    }

    // Create new session button
    const newBtnContainer = this.$('.new-session-btn') as HTMLElement;
    if (newBtnContainer) {
      this.newSessionBtn = new Button('New Session', {
        variant: 'primary',
        onClick: () => this.handleNewSession(),
      });
      this.newSessionBtn.mount(newBtnContainer);
    }

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      this.spinner = new Spinner({ size: 'lg' });
      this.spinner.mount(spinnerContainer);
    }

    // Load sessions
    this.loadSessions();
  }

  private async loadSessions(): Promise<void> {
    this.isLoading = true;
    this.updateLoadingState();

    try {
      const response = await sessionsApi.list();
      this.sessions = response.sessions || [];
      this.filteredSessions = [...this.sessions];
      this.renderSessions();
    } catch (error) {
      toast.error('Failed to load agent sessions');
      console.error('Failed to load agent sessions:', error);
    } finally {
      this.isLoading = false;
      this.updateLoadingState();
    }
  }

  private updateLoadingState(): void {
    const loading = this.$('.sessions-loading') as HTMLElement;
    const empty = this.$('.sessions-empty') as HTMLElement;
    const list = this.$('.sessions-list') as HTMLElement;

    if (this.isLoading) {
      loading?.style.setProperty('display', 'flex');
      empty?.style.setProperty('display', 'none');
      list?.style.setProperty('display', 'none');
    } else {
      loading?.style.setProperty('display', 'none');
    }
  }

  private renderSessions(): void {
    const empty = this.$('.sessions-empty') as HTMLElement;
    const list = this.$('.sessions-list') as HTMLElement;

    if (this.filteredSessions.length === 0) {
      empty?.style.setProperty('display', 'flex');
      list?.style.setProperty('display', 'none');

      // Add empty icon
      const emptyIconContainer = this.$('.empty-icon') as HTMLElement;
      if (emptyIconContainer && !emptyIconContainer.hasChildNodes()) {
        this.emptyIcon = new Icon('folder', { size: 'xl' });
        this.emptyIcon.mount(emptyIconContainer);
      }
    } else {
      empty?.style.setProperty('display', 'none');
      list?.style.setProperty('display', 'grid');

      if (list) {
        list.innerHTML = '';
        for (const session of this.filteredSessions) {
          this.renderSessionCard(session, list);
        }
      }
    }
  }

  private renderSessionCard(session: Session, container: Element): void {
    const cardEl = document.createElement('div');
    cardEl.className = 'session-card';
    cardEl.dataset.sessionId = session.id;

    const title = session.userRequest?.slice(0, 100) || 'Untitled Session';
    const repo = session.repositoryOwner && session.repositoryName
      ? `${session.repositoryOwner}/${session.repositoryName}`
      : 'No repository';
    const branch = session.branch || 'No branch';
    const date = new Date(session.createdAt).toLocaleDateString();
    const status = session.status;
    const statusClass = `status-${status}`;

    cardEl.innerHTML = `
      <div class="session-card-header">
        <span class="session-status ${statusClass}">${status}</span>
        <span class="session-date">${date}</span>
      </div>
      <h3 class="session-title">${this.escapeHtml(title)}</h3>
      <div class="session-meta">
        <span class="session-repo">${this.escapeHtml(repo)}</span>
        <span class="session-branch">${this.escapeHtml(branch)}</span>
      </div>
    `;

    cardEl.addEventListener('click', () => {
      this.navigate(`/session/${session.id}/chat`);
    });

    container.appendChild(cardEl);
  }

  private handleSearch(query: string): void {
    const lowerQuery = query.toLowerCase().trim();

    if (!lowerQuery) {
      this.filteredSessions = [...this.sessions];
    } else {
      this.filteredSessions = this.sessions.filter(session => {
        const title = session.userRequest?.toLowerCase() || '';
        const repo = `${session.repositoryOwner || ''}/${session.repositoryName || ''}`.toLowerCase();
        const branch = session.branch?.toLowerCase() || '';

        return title.includes(lowerQuery) ||
               repo.includes(lowerQuery) ||
               branch.includes(lowerQuery);
      });
    }

    this.renderSessions();
  }

  private handleNewSession(): void {
    // For now, navigate to a quick setup or show a modal
    toast.info('New session feature coming soon!');
  }

  protected onUnmount(): void {
    this.searchInput?.unmount();
    this.newSessionBtn?.unmount();
    this.spinner?.unmount();
    this.emptyIcon?.unmount();
  }
}
