/**
 * Agents Page
 * Lists and manages AI coding sessions
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Input, TextArea, Icon, Spinner, toast, SearchableSelect } from '../../components';
import { sessionsApi, githubApi } from '../../lib/api';
import type { Session, Repository, Branch } from '../../types';
import './agents.css';

type FilterMode = 'all' | 'active' | 'favorites';

export class AgentsPage extends Page<PageOptions> {
  readonly route = '/agents';
  readonly title = 'Agent Sessions';
  protected requiresAuth = true;

  private sessions: Session[] = [];
  private filteredSessions: Session[] = [];
  private searchInput: Input | null = null;
  private createSessionBtn: Button | null = null;
  private spinner: Spinner | null = null;
  private emptyIcon: Icon | null = null;
  private repoSelect: SearchableSelect | null = null;
  private branchSelect: SearchableSelect | null = null;
  private requestTextArea: TextArea | null = null;
  private isLoading = true;
  private filterMode: FilterMode = 'all';
  private searchQuery = '';

  // Inline form state
  private repos: Repository[] = [];
  private branches: Branch[] = [];
  private selectedRepo: Repository | null = null;
  private selectedBranch: string = '';

  // Prefetched GitHub data
  private prefetchedRepos: Repository[] | null = null;
  private prefetchedBranches: Map<string, Branch[]> = new Map();
  private reposPrefetchPromise: Promise<void> | null = null;

  // Session list updates subscription
  private sessionUpdatesEventSource: EventSource | null = null;

  protected render(): string {
    return `
      <div class="agents-page">
        <header class="agents-header">
          <div class="agents-header-left">
            <h1 class="agents-title">Agent Sessions</h1>
            <p class="agents-subtitle">Manage your AI coding sessions</p>
          </div>
          <div class="agents-header-right">
            <div class="filter-buttons">
              <button class="filter-btn filter-btn--active" data-filter="all">All</button>
              <button class="filter-btn" data-filter="active">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polygon points="10 8 16 12 10 16 10 8"></polygon>
                </svg>
                Active
                <span class="filter-btn-count active-count" style="display: none;">0</span>
              </button>
              <button class="filter-btn" data-filter="favorites">
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                </svg>
                Favorites
              </button>
            </div>
            <div class="search-container"></div>
            <a href="#/trash" class="trash-link" title="View deleted sessions">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
            </a>
          </div>
        </header>

        <div class="new-session-input-box">
          <div class="request-textarea-container"></div>
          <div class="new-session-controls">
            <div class="repo-select-container"></div>
            <div class="branch-select-container"></div>
            <button type="button" class="control-icon-btn" title="Attach image" disabled>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
            </button>
            <button type="button" class="control-icon-btn" title="Record voice" disabled>
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            <div class="create-session-btn"></div>
          </div>
        </div>

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

    // Create request textarea
    const textareaContainer = this.$('.request-textarea-container') as HTMLElement;
    if (textareaContainer) {
      this.requestTextArea = new TextArea({
        placeholder: 'Describe what you want the AI to help with...',
        rows: 3,
        resize: 'vertical',
        onSubmit: () => this.handleCreateSession(),
      });
      this.requestTextArea.mount(textareaContainer);
    }

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

    // Create repo select (SearchableSelect)
    const repoSelectContainer = this.$('.repo-select-container') as HTMLElement;
    if (repoSelectContainer) {
      this.repoSelect = new SearchableSelect({
        placeholder: 'Loading repos...',
        searchPlaceholder: 'Search repositories...',
        disabled: true,
        recentKey: 'webedt_recent_repos',
        onChange: async (value) => {
          if (value) {
            const [owner, name] = value.split('/');
            this.selectedRepo = this.repos.find(r => r.owner.login === owner && r.name === name) || null;
            this.selectedBranch = '';
            await this.loadBranchesForInlineForm();
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

    // Create branch select (SearchableSelect)
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

    // Create session button in inline form
    const createBtnContainer = this.$('.create-session-btn') as HTMLElement;
    if (createBtnContainer) {
      this.createSessionBtn = new Button('Create', {
        variant: 'primary',
        onClick: () => this.handleCreateSession(),
      });
      this.createSessionBtn.mount(createBtnContainer);
    }

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      this.spinner = new Spinner({ size: 'lg' });
      this.spinner.mount(spinnerContainer);
    }

    // Load sessions
    this.loadSessions();

    // Subscribe to real-time session list updates
    this.subscribeToSessionUpdates();

    // Setup filter button handlers
    this.setupFilterButtons();

    // Load GitHub repos for inline form
    this.loadReposForInlineForm();
  }

  private async loadReposForInlineForm(): Promise<void> {
    if (!this.repoSelect) return;

    // Check if we already have prefetched repos
    if (this.prefetchedRepos !== null) {
      this.repos = this.prefetchedRepos;
      this.updateRepoSelect();
      await this.autoSelectLastRepo();
      return;
    }

    // If prefetch is in progress, wait for it
    if (this.reposPrefetchPromise) {
      await this.reposPrefetchPromise;
      this.repos = this.prefetchedRepos || [];
      this.updateRepoSelect();
      await this.autoSelectLastRepo();
      return;
    }

    // Otherwise fetch repos now
    try {
      const response = await githubApi.getRepos();
      this.repos = response.repos || [];
      this.prefetchedRepos = this.repos;
    } catch (error) {
      console.error('Failed to load repos:', error);
      this.repos = [];
    } finally {
      this.updateRepoSelect();
      await this.autoSelectLastRepo();
    }
  }

  private async autoSelectLastRepo(): Promise<void> {
    const lastUsedRepo = localStorage.getItem('webedt_last_repo');
    if (lastUsedRepo && this.repos.length > 0) {
      const [owner, name] = lastUsedRepo.split('/');
      const lastRepo = this.repos.find(r => r.owner.login === owner && r.name === name);
      if (lastRepo) {
        this.selectedRepo = lastRepo;
        this.repoSelect?.setValue(`${owner}/${name}`);
        await this.loadBranchesForInlineForm();
      }
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

  private async loadBranchesForInlineForm(): Promise<void> {
    if (!this.selectedRepo || !this.branchSelect) return;

    const repoKey = `${this.selectedRepo.owner.login}/${this.selectedRepo.name}`;

    // Check cache first
    const cachedBranches = this.prefetchedBranches.get(repoKey);
    if (cachedBranches) {
      this.branches = cachedBranches;
      this.updateBranchSelect();
      this.autoSelectDefaultBranch();
      return;
    }

    this.branchSelect.setPlaceholder('Loading branches...');
    this.branchSelect.setDisabled(true);

    try {
      const response = await githubApi.getBranches(this.selectedRepo.owner.login, this.selectedRepo.name);
      this.branches = response.branches || [];
      this.prefetchedBranches.set(repoKey, this.branches);
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

  private async handleCreateSession(): Promise<void> {
    if (!this.selectedRepo || !this.selectedBranch) {
      toast.error('Please select a repository and branch');
      return;
    }

    const initialRequest = this.requestTextArea?.getValue()?.trim() || '';

    this.createSessionBtn?.setDisabled(true);
    this.createSessionBtn?.setLoading(true);

    try {
      const response = await sessionsApi.createCodeSession({
        repositoryOwner: this.selectedRepo.owner.login,
        repositoryName: this.selectedRepo.name,
        baseBranch: this.selectedBranch,
        branch: `claude/session-${Date.now()}`,
        title: initialRequest || undefined,
      });

      // Save the selected repository to localStorage for next time
      localStorage.setItem('webedt_last_repo', `${this.selectedRepo.owner.login}/${this.selectedRepo.name}`);

      // Clear the input
      this.requestTextArea?.clear();

      toast.success('Session created!');
      this.navigate(`/session/${response.session.id}/chat`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      toast.error(message);
    } finally {
      this.createSessionBtn?.setDisabled(false);
      this.createSessionBtn?.setLoading(false);
    }
  }

  /**
   * Subscribe to real-time session list updates via SSE
   */
  private subscribeToSessionUpdates(): void {
    // Close any existing connection
    if (this.sessionUpdatesEventSource) {
      this.sessionUpdatesEventSource.close();
    }

    this.sessionUpdatesEventSource = new EventSource('/api/sessions/updates', { withCredentials: true });

    this.sessionUpdatesEventSource.addEventListener('created', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const session = data.session as Session;
        // Add new session to the beginning of the list
        this.sessions.unshift(session);
        this.applyFilters();
        this.renderSessions();
        console.log('[AgentsPage] Session created:', session.id);
      } catch (error) {
        console.error('[AgentsPage] Failed to parse created event:', error);
      }
    });

    this.sessionUpdatesEventSource.addEventListener('updated', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const updatedSession = data.session as Partial<Session> & { id: string };
        // Update the session in our list
        const index = this.sessions.findIndex(s => s.id === updatedSession.id);
        if (index !== -1) {
          this.sessions[index] = { ...this.sessions[index], ...updatedSession };
          this.applyFilters();
          this.renderSessions();
          console.log('[AgentsPage] Session updated:', updatedSession.id, updatedSession);
        }
      } catch (error) {
        console.error('[AgentsPage] Failed to parse updated event:', error);
      }
    });

    this.sessionUpdatesEventSource.addEventListener('status_changed', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const updatedSession = data.session as Partial<Session> & { id: string };
        // Update the session status in our list
        const index = this.sessions.findIndex(s => s.id === updatedSession.id);
        if (index !== -1) {
          this.sessions[index] = { ...this.sessions[index], ...updatedSession };
          this.applyFilters();
          this.renderSessions();
          console.log('[AgentsPage] Session status changed:', updatedSession.id, updatedSession.status);
        }
      } catch (error) {
        console.error('[AgentsPage] Failed to parse status_changed event:', error);
      }
    });

    this.sessionUpdatesEventSource.addEventListener('deleted', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const sessionId = data.session.id;
        // Remove the session from our list
        this.sessions = this.sessions.filter(s => s.id !== sessionId);
        this.applyFilters();
        this.renderSessions();
        console.log('[AgentsPage] Session deleted:', sessionId);
      } catch (error) {
        console.error('[AgentsPage] Failed to parse deleted event:', error);
      }
    });

    this.sessionUpdatesEventSource.onerror = (error) => {
      console.error('[AgentsPage] Session updates SSE error:', error);
    };
  }

  private async loadSessions(): Promise<void> {
    this.isLoading = true;
    this.updateLoadingState();

    try {
      const response = await sessionsApi.list();
      this.sessions = response.sessions || [];
      this.applyFilters();
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

      // Update empty state message based on filter mode
      const emptyTitle = this.$('.empty-title') as HTMLElement;
      const emptyDesc = this.$('.empty-description') as HTMLElement;
      if (this.filterMode === 'active') {
        if (emptyTitle) emptyTitle.textContent = 'No active sessions';
        if (emptyDesc) emptyDesc.textContent = 'No sessions are currently running';
      } else if (this.filterMode === 'favorites') {
        if (emptyTitle) emptyTitle.textContent = 'No favorite sessions';
        if (emptyDesc) emptyDesc.textContent = 'Star sessions to add them to your favorites';
      } else if (this.searchQuery) {
        if (emptyTitle) emptyTitle.textContent = 'No matching sessions';
        if (emptyDesc) emptyDesc.textContent = 'Try a different search term';
      } else {
        if (emptyTitle) emptyTitle.textContent = 'No agent sessions yet';
        if (emptyDesc) emptyDesc.textContent = 'Start a new session to begin coding with AI';
      }

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
    const isFavorite = session.favorite ?? false;
    const starIcon = isFavorite
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`;

    cardEl.innerHTML = `
      <div class="session-card-header">
        <span class="session-status ${statusClass}">${status}</span>
        <div class="session-card-actions">
          <button class="session-favorite-btn ${isFavorite ? 'session-favorite-btn--active' : ''}" title="${isFavorite ? 'Remove from favorites' : 'Add to favorites'}">
            ${starIcon}
          </button>
          <span class="session-date">${date}</span>
          <button class="session-delete-btn" title="Delete session">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            </svg>
          </button>
        </div>
      </div>
      <h3 class="session-title">${this.escapeHtml(title)}</h3>
      <div class="session-meta">
        <span class="session-repo">${this.escapeHtml(repo)}</span>
        <span class="session-branch">${this.escapeHtml(branch)}</span>
      </div>
    `;

    // Favorite button handler
    const favoriteBtn = cardEl.querySelector('.session-favorite-btn');
    favoriteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleToggleFavorite(session.id);
    });

    // Delete button handler
    const deleteBtn = cardEl.querySelector('.session-delete-btn');
    deleteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleDeleteSession(session.id);
    });

    cardEl.addEventListener('click', () => {
      this.navigate(`/session/${session.id}/chat`);
    });

    container.appendChild(cardEl);
  }

  private async handleDeleteSession(sessionId: string): Promise<void> {
    try {
      await sessionsApi.delete(sessionId);
      toast.success('Session moved to trash');
      this.sessions = this.sessions.filter(s => s.id !== sessionId);
      this.applyFilters();
      this.renderSessions();
    } catch (error) {
      toast.error('Failed to delete session');
    }
  }

  private async handleToggleFavorite(sessionId: string): Promise<void> {
    // Find the session and store original value for rollback
    const index = this.sessions.findIndex(s => s.id === sessionId);
    if (index === -1) return;

    const originalFavorite = this.sessions[index].favorite ?? false;
    const newFavorite = !originalFavorite;

    // Optimistic UI update
    this.sessions[index] = { ...this.sessions[index], favorite: newFavorite };
    this.applyFilters();
    this.renderSessions();

    try {
      const result = await sessionsApi.toggleFavorite(sessionId);
      if (!result.success) {
        // Revert on failure
        this.sessions[index] = { ...this.sessions[index], favorite: originalFavorite };
        this.applyFilters();
        this.renderSessions();
        toast.error('Failed to update favorite status');
      }
    } catch (error) {
      // Revert on error
      this.sessions[index] = { ...this.sessions[index], favorite: originalFavorite };
      this.applyFilters();
      this.renderSessions();
      toast.error('Failed to update favorite status');
    }
  }

  private setupFilterButtons(): void {
    const filterButtons = this.$$('.filter-btn') as NodeListOf<HTMLButtonElement>;
    filterButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter as FilterMode;
        if (filter && filter !== this.filterMode) {
          this.filterMode = filter;
          // Update button styles
          filterButtons.forEach(b => b.classList.remove('filter-btn--active'));
          btn.classList.add('filter-btn--active');
          this.applyFilters();
          this.renderSessions();
        }
      });
    });
  }

  private applyFilters(): void {
    let result = [...this.sessions];

    // Apply active filter (running sessions only)
    if (this.filterMode === 'active') {
      result = result.filter(session => session.status === 'running');
    }

    // Apply favorites filter
    if (this.filterMode === 'favorites') {
      result = result.filter(session => session.favorite === true);
    }

    // Apply search filter
    const lowerQuery = this.searchQuery.toLowerCase().trim();
    if (lowerQuery) {
      result = result.filter(session => {
        const title = session.userRequest?.toLowerCase() || '';
        const repo = `${session.repositoryOwner || ''}/${session.repositoryName || ''}`.toLowerCase();
        const branch = session.branch?.toLowerCase() || '';

        return title.includes(lowerQuery) ||
               repo.includes(lowerQuery) ||
               branch.includes(lowerQuery);
      });
    }

    this.filteredSessions = result;

    // Update active count badge
    this.updateActiveCount();
  }

  private updateActiveCount(): void {
    const activeCount = this.sessions.filter(s => s.status === 'running').length;
    const countBadge = this.$('.active-count') as HTMLElement;
    if (countBadge) {
      countBadge.textContent = activeCount.toString();
      countBadge.style.display = activeCount > 0 ? 'inline-flex' : 'none';
    }
  }

  private handleSearch(query: string): void {
    this.searchQuery = query;
    this.applyFilters();
    this.renderSessions();
  }

  protected onUnmount(): void {
    this.requestTextArea?.unmount();
    this.searchInput?.unmount();
    this.createSessionBtn?.unmount();
    this.spinner?.unmount();
    this.emptyIcon?.unmount();
    this.repoSelect?.unmount();
    this.branchSelect?.unmount();

    // Close session updates subscription
    if (this.sessionUpdatesEventSource) {
      this.sessionUpdatesEventSource.close();
      this.sessionUpdatesEventSource = null;
    }
  }
}
