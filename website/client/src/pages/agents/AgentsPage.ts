/**
 * Agents Page
 * Lists and manages AI coding sessions
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Input, Icon, Spinner, Modal, toast } from '../../components';
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
            <a href="#/trash" class="trash-link" title="View deleted sessions">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
            </a>
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
    this.showNewSessionModal();
  }

  private showNewSessionModal(): void {
    const modal = new Modal({
      title: 'New Agent Session',
      size: 'md',
      onClose: () => {
        modal.unmount();
      },
    });

    // State for the form
    let repos: Repository[] = [];
    let branches: Branch[] = [];
    let selectedRepo: Repository | null = null;
    let selectedBranch: string = '';
    let initialRequest: string = '';
    let isLoadingRepos = true;
    let isLoadingBranches = false;

    // Build the form HTML
    const updateBody = () => {
      const body = modal.getBody();
      body.innerHTML = `
        <div class="new-session-form">
          <div class="form-group">
            <label class="form-label">Repository</label>
            ${isLoadingRepos ? `
              <div class="form-loading">Loading repositories...</div>
            ` : repos.length === 0 ? `
              <div class="form-empty">
                <p>No repositories found. <a href="#" id="connect-github">Connect GitHub</a> to get started.</p>
              </div>
            ` : `
              <select class="form-select" id="repo-select">
                <option value="">Select a repository...</option>
                ${repos.map(repo => `
                  <option value="${repo.owner.login}/${repo.name}" ${selectedRepo?.owner.login === repo.owner.login && selectedRepo?.name === repo.name ? 'selected' : ''}>
                    ${repo.owner.login}/${repo.name}
                  </option>
                `).join('')}
              </select>
            `}
          </div>

          ${selectedRepo ? `
            <div class="form-group">
              <label class="form-label">Branch</label>
              ${isLoadingBranches ? `
                <div class="form-loading">Loading branches...</div>
              ` : `
                <select class="form-select" id="branch-select">
                  <option value="">Select a branch...</option>
                  ${branches.map(branch => `
                    <option value="${branch.name}" ${selectedBranch === branch.name ? 'selected' : ''}>
                      ${branch.name}${branch.name === 'main' || branch.name === 'master' ? ' (default)' : ''}
                    </option>
                  `).join('')}
                </select>
              `}
            </div>
          ` : ''}

          ${selectedRepo && selectedBranch ? `
            <div class="form-group">
              <label class="form-label">Initial Task (optional)</label>
              <textarea class="form-textarea" id="request-input" placeholder="Describe what you want the AI to help with...">${initialRequest}</textarea>
            </div>
          ` : ''}
        </div>
      `;

      // Add event listeners
      const repoSelect = body.querySelector('#repo-select') as HTMLSelectElement;
      if (repoSelect) {
        repoSelect.addEventListener('change', async () => {
          const value = repoSelect.value;
          if (value) {
            const [owner, name] = value.split('/');
            selectedRepo = repos.find(r => r.owner.login === owner && r.name === name) || null;
            selectedBranch = '';
            branches = [];
            updateBody();
            await loadBranches();
          } else {
            selectedRepo = null;
            selectedBranch = '';
            branches = [];
            updateBody();
          }
        });
      }

      const branchSelect = body.querySelector('#branch-select') as HTMLSelectElement;
      if (branchSelect) {
        branchSelect.addEventListener('change', () => {
          selectedBranch = branchSelect.value;
          updateBody();
        });
      }

      const requestInput = body.querySelector('#request-input') as HTMLTextAreaElement;
      if (requestInput) {
        requestInput.addEventListener('input', () => {
          initialRequest = requestInput.value;
        });
      }

      const connectGithubLink = body.querySelector('#connect-github');
      if (connectGithubLink) {
        connectGithubLink.addEventListener('click', (e) => {
          e.preventDefault();
          modal.close();
          modal.unmount();
          githubApi.connect();
        });
      }
    };

    // Load repositories
    const loadRepos = async () => {
      isLoadingRepos = true;
      updateBody();

      try {
        const response = await githubApi.getRepos();
        repos = response.repos || [];
      } catch (error) {
        console.error('Failed to load repos:', error);
        repos = [];
      } finally {
        isLoadingRepos = false;
        updateBody();
      }
    };

    // Load branches for selected repo
    const loadBranches = async () => {
      if (!selectedRepo) return;

      isLoadingBranches = true;
      updateBody();

      try {
        const response = await githubApi.getBranches(selectedRepo.owner.login, selectedRepo.name);
        branches = response.branches || [];
        // Auto-select main or master if available
        const defaultBranch = branches.find(b => b.name === 'main' || b.name === 'master');
        if (defaultBranch) {
          selectedBranch = defaultBranch.name;
        }
      } catch (error) {
        console.error('Failed to load branches:', error);
        branches = [];
      } finally {
        isLoadingBranches = false;
        updateBody();
      }
    };

    // Create session
    const createSession = async () => {
      if (!selectedRepo || !selectedBranch) {
        toast.error('Please select a repository and branch');
        return;
      }

      createBtn.setDisabled(true);
      createBtn.setLoading(true);

      try {
        const response = await sessionsApi.createCodeSession({
          repositoryOwner: selectedRepo.owner.login,
          repositoryName: selectedRepo.name,
          baseBranch: selectedBranch,
          branch: `claude/session-${Date.now()}`,
          title: initialRequest || undefined,
        });

        modal.close();
        modal.unmount();

        toast.success('Session created!');
        this.navigate(`/session/${response.session.id}/chat`);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to create session';
        toast.error(message);
        createBtn.setDisabled(false);
        createBtn.setLoading(false);
      }
    };

    // Footer buttons
    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => {
        modal.close();
        modal.unmount();
      },
    });

    const createBtn = new Button('Create Session', {
      variant: 'primary',
      onClick: createSession,
    });

    modal.addFooterAction(cancelBtn);
    modal.addFooterAction(createBtn);

    // Initialize
    updateBody();
    modal.open();
    loadRepos();
  }

  protected onUnmount(): void {
    this.searchInput?.unmount();
    this.newSessionBtn?.unmount();
    this.spinner?.unmount();
    this.emptyIcon?.unmount();
  }
}
