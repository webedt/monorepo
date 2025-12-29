import { Component, ComponentOptions } from '../base';
import { Modal } from '../modal';
import { Button } from '../button';
import { SearchableSelect } from '../searchable-select';
import { TextArea } from '../input';
import { Spinner } from '../spinner';
import { toast } from '../toast';
import { githubApi, sessionsApi } from '../../lib/api';
import { lastRepoStorage } from '../../lib/storageInstances';

import type { Repository, Branch, Session } from '../../types';

import './new-session-modal.css';

export interface NewSessionModalOptions extends ComponentOptions {
  onSessionCreated?: (session: Session) => void;
  onClose?: () => void;
}

export class NewSessionModal extends Component<HTMLDivElement> {
  private modal: Modal;
  private repoSelect: SearchableSelect | null = null;
  private branchSelect: SearchableSelect | null = null;
  private taskTextArea: TextArea | null = null;
  private createButton: Button | null = null;
  private cancelButton: Button | null = null;
  private loadingSpinner: Spinner | null = null;

  private repos: Repository[] = [];
  private branches: Branch[] = [];
  private selectedRepo: Repository | null = null;
  private selectedBranch: string = '';
  private isLoadingRepos = true;
  private isCreating = false;

  private prefetchedBranches: Map<string, Branch[]> = new Map();
  private options: NewSessionModalOptions;

  constructor(options: NewSessionModalOptions = {}) {
    super('div', { className: 'new-session-modal-wrapper' });
    this.options = options;

    this.modal = new Modal({
      title: 'New Session',
      size: 'md',
      closeOnBackdrop: true,
      closeOnEscape: true,
      showClose: true,
      onClose: () => {
        this.options.onClose?.();
      },
    });

    this.buildContent();
    this.loadRepositories();
  }

  private buildContent(): void {
    const body = this.modal.getBody();
    body.classList.add('new-session-modal-body');

    body.innerHTML = `
      <div class="new-session-form">
        <div class="new-session-field">
          <label class="new-session-label">Repository</label>
          <div class="new-session-repo-select"></div>
          <p class="new-session-hint">Select the repository you want to work on</p>
        </div>

        <div class="new-session-field">
          <label class="new-session-label">Branch</label>
          <div class="new-session-branch-select"></div>
          <p class="new-session-hint">Select the base branch for your changes</p>
        </div>

        <div class="new-session-field">
          <label class="new-session-label">Task Description <span class="new-session-optional">(optional)</span></label>
          <div class="new-session-task-input"></div>
          <p class="new-session-hint">Describe what you want the AI to help with</p>
        </div>

        <div class="new-session-loading" style="display: none;">
          <div class="new-session-loading-spinner"></div>
          <span>Loading repositories...</span>
        </div>
      </div>
    `;

    // Create repo select
    const repoSelectContainer = body.querySelector('.new-session-repo-select') as HTMLElement;
    if (repoSelectContainer) {
      this.repoSelect = new SearchableSelect({
        placeholder: 'Loading repositories...',
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
          this.updateCreateButtonState();
        },
      });
      this.repoSelect.mount(repoSelectContainer);
    }

    // Create branch select
    const branchSelectContainer = body.querySelector('.new-session-branch-select') as HTMLElement;
    if (branchSelectContainer) {
      this.branchSelect = new SearchableSelect({
        placeholder: 'Select a repository first',
        searchPlaceholder: 'Search branches...',
        disabled: true,
        onChange: (value) => {
          this.selectedBranch = value;
          this.updateCreateButtonState();
        },
      });
      this.branchSelect.mount(branchSelectContainer);
    }

    // Create task textarea
    const taskInputContainer = body.querySelector('.new-session-task-input') as HTMLElement;
    if (taskInputContainer) {
      this.taskTextArea = new TextArea({
        placeholder: 'Describe what you want the AI to help with...',
        rows: 4,
        resize: 'vertical',
        onSubmit: () => this.handleCreate(),
      });
      this.taskTextArea.mount(taskInputContainer);
    }

    // Create loading spinner
    const loadingSpinnerContainer = body.querySelector('.new-session-loading-spinner') as HTMLElement;
    if (loadingSpinnerContainer) {
      this.loadingSpinner = new Spinner({ size: 'sm' });
      this.loadingSpinner.mount(loadingSpinnerContainer);
    }

    // Add footer with buttons
    const footer = this.modal.footer({ align: 'end' });
    footer.classList.add('new-session-modal-footer');

    this.cancelButton = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => this.close(),
    });
    footer.appendChild(this.cancelButton.getElement());

    this.createButton = new Button('Create Session', {
      variant: 'primary',
      onClick: () => this.handleCreate(),
    });
    this.createButton.setDisabled(true);
    footer.appendChild(this.createButton.getElement());
  }

  private async loadRepositories(): Promise<void> {
    this.isLoadingRepos = true;
    this.updateLoadingState();

    try {
      const response = await githubApi.getRepos();
      this.repos = response.repos || [];
      this.updateRepoSelect();
      await this.autoSelectLastRepo();
    } catch (error) {
      console.error('Failed to load repositories:', error);
      toast.error('Failed to load repositories');
      this.repos = [];
      this.updateRepoSelect();
    } finally {
      this.isLoadingRepos = false;
      this.updateLoadingState();
    }
  }

  private async autoSelectLastRepo(): Promise<void> {
    const lastUsedRepo = lastRepoStorage.get();
    if (lastUsedRepo && this.repos.length > 0) {
      const [owner, name] = lastUsedRepo.split('/');
      const lastRepo = this.repos.find(r => r.owner.login === owner && r.name === name);
      if (lastRepo) {
        this.selectedRepo = lastRepo;
        this.repoSelect?.setValue(`${owner}/${name}`);
        await this.loadBranches();
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

  private async loadBranches(): Promise<void> {
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
      toast.error('Failed to load branches');
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
      this.branchSelect.setPlaceholder('Select a repository first');
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
    if (!this.branchSelect || this.branches.length === 0) return;

    // Try to select 'main' or 'master' as default
    const defaultBranch = this.branches.find(b => b.name === 'main' || b.name === 'master');
    if (defaultBranch) {
      this.selectedBranch = defaultBranch.name;
      this.branchSelect.setValue(defaultBranch.name);
    }
    this.updateCreateButtonState();
  }

  private updateLoadingState(): void {
    const loadingEl = this.modal.getBody().querySelector('.new-session-loading') as HTMLElement;
    const formFields = this.modal.getBody().querySelectorAll('.new-session-field');

    if (this.isLoadingRepos) {
      loadingEl?.style.setProperty('display', 'flex');
      formFields.forEach(field => (field as HTMLElement).style.setProperty('display', 'none'));
    } else {
      loadingEl?.style.setProperty('display', 'none');
      formFields.forEach(field => (field as HTMLElement).style.setProperty('display', 'block'));
    }
  }

  private updateCreateButtonState(): void {
    if (!this.createButton) return;
    const canCreate = this.selectedRepo && this.selectedBranch && !this.isCreating;
    this.createButton.setDisabled(!canCreate);
  }

  private async handleCreate(): Promise<void> {
    if (!this.selectedRepo || !this.selectedBranch) {
      toast.error('Please select a repository and branch');
      return;
    }

    this.isCreating = true;
    this.createButton?.setLoading(true);
    this.createButton?.setDisabled(true);
    this.cancelButton?.setDisabled(true);

    try {
      const taskDescription = this.taskTextArea?.getValue()?.trim() || '';

      const response = await sessionsApi.createCodeSession({
        repositoryOwner: this.selectedRepo.owner.login,
        repositoryName: this.selectedRepo.name,
        baseBranch: this.selectedBranch,
        branch: `claude/session-${Date.now()}`,
        title: taskDescription || undefined,
      });

      // Save the selected repository for next time
      lastRepoStorage.set(`${this.selectedRepo.owner.login}/${this.selectedRepo.name}`);

      toast.success('Session created!');
      this.options.onSessionCreated?.(response.session);
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create session';
      toast.error(message);
    } finally {
      this.isCreating = false;
      this.createButton?.setLoading(false);
      this.updateCreateButtonState();
      this.cancelButton?.setDisabled(false);
    }
  }

  open(): this {
    this.modal.open();
    return this;
  }

  close(): this {
    this.modal.close();
    return this;
  }

  isOpen(): boolean {
    return this.modal.getIsOpen();
  }

  reset(): this {
    this.selectedRepo = null;
    this.selectedBranch = '';
    this.branches = [];
    this.repoSelect?.clear();
    this.branchSelect?.clear();
    this.taskTextArea?.clear();
    this.updateBranchSelect();
    this.updateCreateButtonState();
    return this;
  }

  protected onUnmount(): void {
    this.repoSelect?.unmount();
    this.branchSelect?.unmount();
    this.taskTextArea?.unmount();
    this.createButton?.unmount();
    this.cancelButton?.unmount();
    this.loadingSpinner?.unmount();
    this.modal.unmount();
  }
}
