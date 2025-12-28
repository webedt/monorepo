/**
 * Quick Access Page
 * Provides quick access to recent sessions and quick-start options
 */

import { Page, type PageOptions } from '../base/Page';
import { Card, Button, Icon, Spinner, toast, SearchableSelect } from '../../components';
import { sessionsApi, githubApi } from '../../lib/api';
import { authStore } from '../../stores/authStore';
import type { Session, Repository, Branch } from '../../types';
import './quick-access.css';

interface QuickStartTemplate {
  id: string;
  name: string;
  repositoryOwner: string;
  repositoryName: string;
  defaultBranch: string;
}

export class QuickAccessPage extends Page<PageOptions> {
  readonly route = '/quick-access';
  readonly title = 'Quick Access';
  protected requiresAuth = true;

  private recentSessions: Session[] = [];
  private quickStartTemplates: QuickStartTemplate[] = [];
  private loadingRecent = true;

  // Components
  private cards: Card[] = [];
  private buttons: Button[] = [];
  private spinner: Spinner | null = null;
  private repoSelect: SearchableSelect | null = null;
  private branchSelect: SearchableSelect | null = null;

  // Quick start form state
  private repos: Repository[] = [];
  private branches: Branch[] = [];
  private selectedRepo: Repository | null = null;
  private selectedBranch: string = '';

  // SSE subscription
  private sessionUpdatesEventSource: EventSource | null = null;
  private sseReconnectAttempts = 0;
  private sseReconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private readonly MAX_SSE_RECONNECT_ATTEMPTS = 5;

  protected render(): string {
    const user = authStore.getUser();

    return `
      <div class="quick-access-page">
        <header class="quick-access-header">
          <h1 class="quick-access-title">Quick Access</h1>
          <p class="quick-access-subtitle">Jump back into your work${user?.displayName ? `, ${user.displayName}` : ''}</p>
        </header>

        <div class="quick-access-content">
          <!-- Recent Sessions Section -->
          <section class="quick-access-section recent-section">
            <div class="section-header">
              <h2 class="section-title">Recent Sessions</h2>
              <a href="#/agents" class="section-link">View All</a>
            </div>
            <div class="recent-sessions-container">
              <div class="recent-sessions-loading">
                <div class="spinner-container"></div>
              </div>
              <div class="recent-sessions-empty" style="display: none;">
                <div class="empty-icon"></div>
                <p class="empty-text">No recent sessions</p>
                <p class="empty-subtext">Start a new session to get going</p>
              </div>
              <div class="recent-sessions-grid" style="display: none;"></div>
            </div>
          </section>

          <!-- Quick Start Section -->
          <section class="quick-access-section quick-start-section">
            <div class="section-header">
              <h2 class="section-title">Quick Start</h2>
            </div>
            <div class="quick-start-container">
              <!-- Pinned Templates -->
              <div class="quick-start-templates">
                <div class="templates-loading" style="display: none;">
                  <div class="spinner-container-sm"></div>
                </div>
                <div class="templates-grid"></div>
              </div>

              <!-- New Session Form -->
              <div class="quick-start-form">
                <div class="form-row">
                  <div class="repo-select-container"></div>
                  <div class="branch-select-container"></div>
                </div>
                <div class="form-actions">
                  <div class="start-session-btn"></div>
                </div>
              </div>
            </div>
          </section>

          <!-- Quick Actions -->
          <section class="quick-access-section actions-section">
            <div class="section-header">
              <h2 class="section-title">Actions</h2>
            </div>
            <div class="quick-actions-grid"></div>
          </section>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      this.spinner = new Spinner({ size: 'md' });
      this.spinner.mount(spinnerContainer);
    }

    // Setup repo select
    const repoSelectContainer = this.$('.repo-select-container') as HTMLElement;
    if (repoSelectContainer) {
      this.repoSelect = new SearchableSelect({
        placeholder: 'Select repository...',
        searchPlaceholder: 'Search repositories...',
        disabled: true,
        recentKey: 'webedt_recent_repos',
        onChange: async (value) => {
          if (value) {
            const [owner, name] = value.split('/');
            this.selectedRepo = this.repos.find(r => r.owner.login === owner && r.name === name) || null;
            this.selectedBranch = '';
            await this.loadBranches();
          } else {
            this.selectedRepo = null;
            this.selectedBranch = '';
            this.branches = [];
            this.updateBranchSelect();
          }
        },
      });
      this.repoSelect.mount(repoSelectContainer);
    }

    // Setup branch select
    const branchSelectContainer = this.$('.branch-select-container') as HTMLElement;
    if (branchSelectContainer) {
      this.branchSelect = new SearchableSelect({
        placeholder: 'Select branch...',
        searchPlaceholder: 'Search branches...',
        disabled: true,
        onChange: (value) => {
          this.selectedBranch = value;
        },
      });
      this.branchSelect.mount(branchSelectContainer);
    }

    // Setup start session button
    const startBtnContainer = this.$('.start-session-btn') as HTMLElement;
    if (startBtnContainer) {
      const startBtn = new Button('Start Session', {
        variant: 'primary',
        onClick: () => this.handleStartSession(),
      });
      startBtn.mount(startBtnContainer);
      this.buttons.push(startBtn);
    }

    // Setup quick actions
    this.setupQuickActions();

    // Load data - repos first so templates can use default_branch
    this.loadRecentSessions();
    this.loadRepos().then(() => {
      this.loadQuickStartTemplates();
    });

    // Subscribe to session updates
    this.subscribeToSessionUpdates();
  }

  private async loadRecentSessions(): Promise<void> {
    this.loadingRecent = true;

    try {
      const response = await sessionsApi.list();
      // Get the 6 most recent sessions
      this.recentSessions = (response.sessions || [])
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 6);
    } catch (error) {
      console.error('Failed to load recent sessions:', error);
      this.recentSessions = [];
    } finally {
      this.loadingRecent = false;
      this.renderRecentSessions();
    }
  }

  private renderRecentSessions(): void {
    const loading = this.$('.recent-sessions-loading') as HTMLElement;
    const empty = this.$('.recent-sessions-empty') as HTMLElement;
    const grid = this.$('.recent-sessions-grid') as HTMLElement;

    if (this.loadingRecent) {
      loading?.style.setProperty('display', 'flex');
      empty?.style.setProperty('display', 'none');
      grid?.style.setProperty('display', 'none');
      return;
    }

    loading?.style.setProperty('display', 'none');

    if (this.recentSessions.length === 0) {
      empty?.style.setProperty('display', 'flex');
      grid?.style.setProperty('display', 'none');

      // Add empty icon
      const emptyIconContainer = this.$('.empty-icon') as HTMLElement;
      if (emptyIconContainer && !emptyIconContainer.hasChildNodes()) {
        const icon = new Icon('folder', { size: 'xl' });
        icon.mount(emptyIconContainer);
      }
    } else {
      empty?.style.setProperty('display', 'none');
      grid?.style.setProperty('display', 'grid');

      if (grid) {
        grid.innerHTML = '';
        for (const session of this.recentSessions) {
          this.renderSessionCard(session, grid);
        }
      }
    }
  }

  private renderSessionCard(session: Session, container: HTMLElement): void {
    const card = document.createElement('div');
    card.className = 'quick-session-card';
    card.dataset.sessionId = session.id;

    const title = session.userRequest?.slice(0, 60) || 'Untitled Session';
    const repo = session.repositoryOwner && session.repositoryName
      ? `${session.repositoryOwner}/${session.repositoryName}`
      : 'No repository';
    const status = session.status;
    const statusClass = `status-${status}`;
    const timeAgo = this.formatTimeAgo(session.createdAt);

    card.innerHTML = `
      <div class="quick-session-header">
        <span class="quick-session-status ${statusClass}" title="${this.escapeHtml(status)}">${this.getStatusIcon(status)}</span>
        <span class="quick-session-time">${timeAgo}</span>
      </div>
      <h3 class="quick-session-title">${this.escapeHtml(title)}</h3>
      <div class="quick-session-meta">
        <span class="quick-session-repo">${this.escapeHtml(repo)}</span>
      </div>
      <div class="quick-session-actions">
        <button class="quick-session-resume" title="Resume session">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
          Resume
        </button>
      </div>
    `;

    // Click to open session
    card.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (!target.closest('.quick-session-resume')) {
        this.navigate(`/session/${session.id}/chat`);
      }
    });

    // Resume button
    const resumeBtn = card.querySelector('.quick-session-resume');
    resumeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.navigate(`/session/${session.id}/chat`);
    });

    container.appendChild(card);
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'running':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;
      case 'completed':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`;
      case 'failed':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`;
      case 'pending':
        return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`;
      default:
        return `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>`;
    }
  }

  private formatTimeAgo(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  private async loadQuickStartTemplates(): Promise<void> {
    try {
      // Load templates from localStorage
      const saved = localStorage.getItem('webedt_quick_start_templates');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Validate the parsed data structure
        if (Array.isArray(parsed) && parsed.every(this.isValidTemplate)) {
          this.quickStartTemplates = parsed;
        }
      }

      // If no templates, create default from recent repos
      if (this.quickStartTemplates.length === 0) {
        const recentRepos = localStorage.getItem('webedt_recent_repos');
        if (recentRepos) {
          const parsed = JSON.parse(recentRepos);
          // Validate it's an array of strings
          if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) {
            this.quickStartTemplates = parsed.slice(0, 3).map((repoStr, index) => {
              const [owner, name] = repoStr.split('/');
              // Try to find the repo in loaded repos to get actual default branch
              const repo = this.repos.find(r => r.owner.login === owner && r.name === name);
              return {
                id: `template-${index}`,
                name: name,
                repositoryOwner: owner,
                repositoryName: name,
                defaultBranch: repo?.default_branch || 'main',
              };
            });
          }
        }
      }
    } catch (error) {
      console.error('Failed to load quick start templates:', error);
      this.quickStartTemplates = [];
    } finally {
      this.renderQuickStartTemplates();
    }
  }

  private isValidTemplate(item: unknown): item is QuickStartTemplate {
    return (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as QuickStartTemplate).id === 'string' &&
      typeof (item as QuickStartTemplate).name === 'string' &&
      typeof (item as QuickStartTemplate).repositoryOwner === 'string' &&
      typeof (item as QuickStartTemplate).repositoryName === 'string' &&
      typeof (item as QuickStartTemplate).defaultBranch === 'string'
    );
  }

  private renderQuickStartTemplates(): void {
    const grid = this.$('.templates-grid') as HTMLElement;
    if (!grid) return;

    grid.innerHTML = '';

    if (this.quickStartTemplates.length === 0) {
      // Show hint to add templates
      const hint = document.createElement('div');
      hint.className = 'templates-hint';
      hint.innerHTML = `
        <p>No quick start templates yet.</p>
        <p class="hint-subtext">Select a repository below to start a session.</p>
      `;
      grid.appendChild(hint);
      return;
    }

    for (const template of this.quickStartTemplates) {
      const templateCard = document.createElement('button');
      templateCard.className = 'template-card';
      templateCard.type = 'button';

      templateCard.innerHTML = `
        <div class="template-icon">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
          </svg>
        </div>
        <div class="template-info">
          <span class="template-name">${this.escapeHtml(template.name)}</span>
          <span class="template-repo">${this.escapeHtml(template.repositoryOwner)}/${this.escapeHtml(template.repositoryName)}</span>
        </div>
        <div class="template-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </div>
      `;

      templateCard.addEventListener('click', () => this.handleQuickStart(template));
      grid.appendChild(templateCard);
    }
  }

  private async handleQuickStart(template: QuickStartTemplate): Promise<void> {
    try {
      const response = await sessionsApi.createCodeSession({
        repositoryOwner: template.repositoryOwner,
        repositoryName: template.repositoryName,
        baseBranch: template.defaultBranch,
        branch: `claude/session-${Date.now()}`,
      });

      toast.success('Session created!');
      this.navigate(`/session/${response.session.id}/chat`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      toast.error(message);
    }
  }

  private async loadRepos(): Promise<void> {
    if (!this.repoSelect) return;

    try {
      const response = await githubApi.getRepos();
      this.repos = response.repos || [];
    } catch (error) {
      console.error('Failed to load repos:', error);
      this.repos = [];
    } finally {
      this.updateRepoSelect();
    }
  }

  private updateRepoSelect(): void {
    if (!this.repoSelect) return;

    if (this.repos.length === 0) {
      this.repoSelect.setPlaceholder('No repositories found');
      this.repoSelect.setDisabled(true);
    } else {
      const options = this.repos.map(repo => ({
        value: `${repo.owner.login}/${repo.name}`,
        label: `${repo.owner.login}/${repo.name}`,
      }));
      this.repoSelect.setOptions(options);
      this.repoSelect.setPlaceholder('Select repository...');
      this.repoSelect.setDisabled(false);
    }
  }

  private async loadBranches(): Promise<void> {
    if (!this.selectedRepo || !this.branchSelect) return;

    this.branchSelect.setPlaceholder('Loading branches...');
    this.branchSelect.setDisabled(true);

    try {
      const response = await githubApi.getBranches(this.selectedRepo.owner.login, this.selectedRepo.name);
      this.branches = response.branches || [];
    } catch (error) {
      console.error('Failed to load branches:', error);
      this.branches = [];
    } finally {
      this.updateBranchSelect();
      this.autoSelectDefaultBranch();
    }
  }

  private updateBranchSelect(): void {
    if (!this.branchSelect) return;

    if (!this.selectedRepo) {
      this.branchSelect.setOptions([]);
      this.branchSelect.setPlaceholder('Select branch...');
      this.branchSelect.setDisabled(true);
    } else if (this.branches.length === 0) {
      this.branchSelect.setOptions([]);
      this.branchSelect.setPlaceholder('No branches found');
      this.branchSelect.setDisabled(true);
    } else {
      const options = this.branches.map(branch => ({
        value: branch.name,
        label: branch.name === 'main' || branch.name === 'master'
          ? `${branch.name} (default)`
          : branch.name,
      }));
      this.branchSelect.setOptions(options);
      this.branchSelect.setPlaceholder('Select branch...');
      this.branchSelect.setDisabled(false);
    }
  }

  private autoSelectDefaultBranch(): void {
    if (!this.branchSelect) return;

    const defaultBranch = this.branches.find(b => b.name === 'main' || b.name === 'master');
    if (defaultBranch) {
      this.selectedBranch = defaultBranch.name;
      this.branchSelect.setValue(defaultBranch.name);
    }
  }

  private async handleStartSession(): Promise<void> {
    if (!this.selectedRepo || !this.selectedBranch) {
      toast.error('Please select a repository and branch');
      return;
    }

    try {
      const response = await sessionsApi.createCodeSession({
        repositoryOwner: this.selectedRepo.owner.login,
        repositoryName: this.selectedRepo.name,
        baseBranch: this.selectedBranch,
        branch: `claude/session-${Date.now()}`,
      });

      // Save to recent repos
      localStorage.setItem('webedt_last_repo', `${this.selectedRepo.owner.login}/${this.selectedRepo.name}`);

      toast.success('Session created!');
      this.navigate(`/session/${response.session.id}/chat`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      toast.error(message);
    }
  }

  private setupQuickActions(): void {
    const actionsGrid = this.$('.quick-actions-grid') as HTMLElement;
    if (!actionsGrid) return;

    const actions = [
      {
        icon: 'code',
        title: 'All Sessions',
        description: 'View and manage all your sessions',
        onClick: () => this.navigate('/agents'),
      },
      {
        icon: 'settings',
        title: 'Settings',
        description: 'Configure your preferences',
        onClick: () => this.navigate('/settings'),
      },
      {
        icon: 'folder',
        title: 'Trash',
        description: 'View deleted sessions',
        onClick: () => this.navigate('/trash'),
      },
    ];

    for (const action of actions) {
      const card = new Card({ interactive: true, onClick: action.onClick });
      const content = document.createElement('div');
      content.className = 'action-card-content';
      content.innerHTML = `
        <div class="action-card-icon-container"></div>
        <div class="action-card-text">
          <h3 class="action-card-title">${action.title}</h3>
          <p class="action-card-description">${action.description}</p>
        </div>
      `;

      const iconContainer = content.querySelector('.action-card-icon-container') as HTMLElement;
      if (iconContainer) {
        const icon = new Icon(action.icon as 'code' | 'settings' | 'folder', { size: 'lg' });
        icon.mount(iconContainer);
      }

      card.body().getElement().appendChild(content);
      card.mount(actionsGrid);
      this.cards.push(card);
    }
  }

  private subscribeToSessionUpdates(): void {
    if (this.sessionUpdatesEventSource) {
      this.sessionUpdatesEventSource.close();
    }

    this.sessionUpdatesEventSource = new EventSource('/api/sessions/updates', { withCredentials: true });

    this.sessionUpdatesEventSource.addEventListener('created', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const session = data.session as Session;
        // Add to beginning and keep only 6
        this.recentSessions.unshift(session);
        this.recentSessions = this.recentSessions.slice(0, 6);
        this.renderRecentSessions();
      } catch (error) {
        console.error('[QuickAccessPage] Failed to parse created event:', error);
      }
    });

    this.sessionUpdatesEventSource.addEventListener('updated', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const updatedSession = data.session as Partial<Session> & { id: string };
        const index = this.recentSessions.findIndex(s => s.id === updatedSession.id);
        if (index !== -1) {
          this.recentSessions[index] = { ...this.recentSessions[index], ...updatedSession };
          this.renderRecentSessions();
        }
      } catch (error) {
        console.error('[QuickAccessPage] Failed to parse updated event:', error);
      }
    });

    this.sessionUpdatesEventSource.addEventListener('status_changed', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const updatedSession = data.session as Partial<Session> & { id: string };
        const index = this.recentSessions.findIndex(s => s.id === updatedSession.id);
        if (index !== -1) {
          this.recentSessions[index] = { ...this.recentSessions[index], ...updatedSession };
          this.renderRecentSessions();
        }
      } catch (error) {
        console.error('[QuickAccessPage] Failed to parse status_changed event:', error);
      }
    });

    this.sessionUpdatesEventSource.addEventListener('deleted', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const sessionId = data.session.id;
        this.recentSessions = this.recentSessions.filter(s => s.id !== sessionId);
        this.renderRecentSessions();
      } catch (error) {
        console.error('[QuickAccessPage] Failed to parse deleted event:', error);
      }
    });

    this.sessionUpdatesEventSource.onerror = () => {
      console.error('[QuickAccessPage] Session updates SSE error, attempting reconnect...');
      this.handleSSEReconnect();
    };

    // Reset reconnect attempts on successful connection
    this.sessionUpdatesEventSource.onopen = () => {
      this.sseReconnectAttempts = 0;
    };
  }

  private handleSSEReconnect(): void {
    // Close existing connection
    if (this.sessionUpdatesEventSource) {
      this.sessionUpdatesEventSource.close();
      this.sessionUpdatesEventSource = null;
    }

    // Check if we've exceeded max attempts
    if (this.sseReconnectAttempts >= this.MAX_SSE_RECONNECT_ATTEMPTS) {
      console.warn('[QuickAccessPage] Max SSE reconnect attempts reached');
      toast.error('Lost connection to updates. Please refresh the page.');
      return;
    }

    // Calculate backoff delay: 1s, 2s, 4s, 8s, 16s
    const delay = Math.pow(2, this.sseReconnectAttempts) * 1000;
    this.sseReconnectAttempts++;

    console.log(`[QuickAccessPage] Reconnecting SSE in ${delay}ms (attempt ${this.sseReconnectAttempts})`);

    this.sseReconnectTimeout = setTimeout(() => {
      this.subscribeToSessionUpdates();
    }, delay);
  }

  protected onUnmount(): void {
    // Cleanup cards
    for (const card of this.cards) {
      card.unmount();
    }
    this.cards = [];

    // Cleanup buttons
    for (const btn of this.buttons) {
      btn.unmount();
    }
    this.buttons = [];

    // Cleanup spinner
    this.spinner?.unmount();
    this.spinner = null;

    // Cleanup selects
    this.repoSelect?.unmount();
    this.repoSelect = null;
    this.branchSelect?.unmount();
    this.branchSelect = null;

    // Clear SSE reconnect timeout
    if (this.sseReconnectTimeout) {
      clearTimeout(this.sseReconnectTimeout);
      this.sseReconnectTimeout = null;
    }

    // Close SSE connection
    if (this.sessionUpdatesEventSource) {
      this.sessionUpdatesEventSource.close();
      this.sessionUpdatesEventSource = null;
    }
  }
}
