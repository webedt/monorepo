/**
 * Agents Page
 * Lists and manages AI coding sessions
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Input, Icon, Spinner, toast, SearchableSelect } from '../../components';
import { sessionsApi, githubApi } from '../../lib/api';
import type { Session, Repository, Branch } from '../../types';
import './agents.css';

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
  private isLoading = true;

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
            <div class="search-container"></div>
            <a href="#/trash" class="trash-link" title="View deleted sessions">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
            </a>
          </div>
        </header>

        <div class="new-session-input-box">
          <textarea class="new-session-textarea" id="request-input" placeholder="Describe what you want the AI to help with..."></textarea>
          <div class="new-session-controls">
            <div class="repo-select-container"></div>
            <div class="branch-select-container"></div>
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

    // Set up inline form event listeners
    this.setupInlineForm();

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

    // Load GitHub repos for inline form
    this.loadReposForInlineForm();
  }

  private setupInlineForm(): void {
    const requestInput = this.$('#request-input') as HTMLTextAreaElement;

    if (requestInput) {
      requestInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          this.handleCreateSession();
        }
      });
    }
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

    const requestInput = this.$('#request-input') as HTMLTextAreaElement;
    const initialRequest = requestInput?.value?.trim() || '';

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
      if (requestInput) {
        requestInput.value = '';
      }

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
        this.filteredSessions = [...this.sessions];
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
          this.filteredSessions = [...this.sessions];
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
          this.filteredSessions = [...this.sessions];
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
        this.filteredSessions = this.filteredSessions.filter(s => s.id !== sessionId);
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
        <div class="session-card-actions">
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
      this.filteredSessions = this.filteredSessions.filter(s => s.id !== sessionId);
      this.renderSessions();
    } catch (error) {
      toast.error('Failed to delete session');
    }
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

  protected onUnmount(): void {
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
