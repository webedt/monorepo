/**
 * Trash Page
 * Manage deleted sessions - restore or permanently delete
 */

import { Page, type PageOptions } from '../base/Page';
import { Button, Icon, Spinner, toast, confirm } from '../../components';
import { sessionsApi } from '../../lib/api';
import type { Session } from '../../types';
import './trash.css';

export class TrashPage extends Page<PageOptions> {
  readonly route = '/trash';
  readonly title = 'Trash';
  protected requiresAuth = true;

  private sessions: Session[] = [];
  private selectedIds: Set<string> = new Set();
  private spinner: Spinner | null = null;
  private emptyIcon: Icon | null = null;
  private isLoading = true;

  protected render(): string {
    return `
      <div class="trash-page">
        <header class="trash-header">
          <div class="trash-header-left">
            <a href="#/agents" class="back-link">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </a>
            <div>
              <h1 class="trash-title">Trash</h1>
              <p class="trash-subtitle">Deleted sessions can be restored or permanently deleted</p>
            </div>
          </div>
          <div class="trash-count"></div>
        </header>

        <div class="bulk-actions" style="display: none;">
          <div class="bulk-info">
            <span class="bulk-count"></span>
            <button class="clear-selection">Clear selection</button>
          </div>
          <div class="bulk-buttons">
            <div class="restore-selected-btn"></div>
            <div class="delete-selected-btn"></div>
          </div>
        </div>

        <div class="sessions-container">
          <div class="sessions-loading">
            <div class="spinner-container"></div>
          </div>
          <div class="sessions-empty" style="display: none;">
            <div class="empty-icon"></div>
            <h3 class="empty-title">Trash is empty</h3>
            <p class="empty-description">No deleted sessions found</p>
          </div>
          <div class="sessions-list" style="display: none;">
            <div class="select-all-header">
              <label class="checkbox-label">
                <input type="checkbox" class="select-all-checkbox">
                <span>Select all</span>
              </label>
            </div>
            <div class="sessions-items"></div>
          </div>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      this.spinner = new Spinner({ size: 'lg' });
      this.spinner.mount(spinnerContainer);
    }

    // Setup select all checkbox
    const selectAllCheckbox = this.$('.select-all-checkbox') as HTMLInputElement;
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', () => this.handleSelectAll());
    }

    // Setup clear selection
    const clearBtn = this.$('.clear-selection');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => this.clearSelection());
    }

    // Setup bulk action buttons
    this.setupBulkActions();

    // Load sessions
    this.loadSessions();
  }

  private setupBulkActions(): void {
    const restoreContainer = this.$('.restore-selected-btn') as HTMLElement;
    if (restoreContainer) {
      const restoreBtn = new Button('Restore selected', {
        variant: 'primary',
        onClick: () => this.handleBulkRestore(),
      });
      restoreBtn.mount(restoreContainer);
    }

    const deleteContainer = this.$('.delete-selected-btn') as HTMLElement;
    if (deleteContainer) {
      const deleteBtn = new Button('Delete permanently', {
        variant: 'danger',
        onClick: () => this.handleBulkDelete(),
      });
      deleteBtn.mount(deleteContainer);
    }
  }

  private async loadSessions(): Promise<void> {
    this.isLoading = true;
    this.updateLoadingState();

    try {
      const response = await sessionsApi.listDeleted({ limit: 100 });
      this.sessions = (response as { sessions?: Session[] }).sessions || [];
      this.updateCount();
      this.renderSessions();
    } catch (error) {
      toast.error('Failed to load deleted sessions');
      console.error('Failed to load deleted sessions:', error);
    } finally {
      this.isLoading = false;
      this.updateLoadingState();
    }
  }

  private updateCount(): void {
    const countEl = this.$('.trash-count');
    if (countEl) {
      const count = this.sessions.length;
      countEl.textContent = `${count} deleted session${count !== 1 ? 's' : ''}`;
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

    if (this.sessions.length === 0) {
      empty?.style.setProperty('display', 'flex');
      list?.style.setProperty('display', 'none');

      // Add empty icon
      const emptyIconContainer = this.$('.empty-icon') as HTMLElement;
      if (emptyIconContainer && !emptyIconContainer.hasChildNodes()) {
        this.emptyIcon = new Icon('trash', { size: 'xl' });
        this.emptyIcon.mount(emptyIconContainer);
      }
    } else {
      empty?.style.setProperty('display', 'none');
      list?.style.setProperty('display', 'block');

      const itemsContainer = this.$('.sessions-items');
      if (itemsContainer) {
        itemsContainer.innerHTML = '';
        for (const session of this.sessions) {
          this.renderSessionItem(session, itemsContainer);
        }
      }
    }
  }

  private renderSessionItem(session: Session, container: Element): void {
    const itemEl = document.createElement('div');
    itemEl.className = 'session-item';
    itemEl.dataset.sessionId = session.id;

    const title = session.userRequest?.slice(0, 100) || 'Untitled Session';
    const repo = session.repositoryOwner && session.repositoryName
      ? `${session.repositoryOwner}/${session.repositoryName}`
      : 'No repository';
    const deletedAt = session.deletedAt ? new Date(session.deletedAt).toLocaleDateString() : 'Unknown';

    itemEl.innerHTML = `
      <div class="session-item-checkbox">
        <input type="checkbox" class="item-checkbox" ${this.selectedIds.has(session.id) ? 'checked' : ''}>
      </div>
      <div class="session-item-content">
        <h3 class="session-item-title">${this.escapeHtml(title)}</h3>
        <p class="session-item-repo">${this.escapeHtml(repo)}</p>
      </div>
      <div class="session-item-meta">
        <span class="deleted-date">Deleted ${deletedAt}</span>
      </div>
      <div class="session-item-actions">
        <button class="action-btn restore-btn" title="Restore">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
        </button>
        <button class="action-btn delete-btn" title="Delete permanently">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
    `;

    // Checkbox handler
    const checkbox = itemEl.querySelector('.item-checkbox') as HTMLInputElement;
    checkbox.addEventListener('change', () => {
      this.toggleSelection(session.id);
    });

    // Restore handler
    const restoreBtn = itemEl.querySelector('.restore-btn');
    restoreBtn?.addEventListener('click', () => this.handleRestore(session.id));

    // Delete handler
    const deleteBtn = itemEl.querySelector('.delete-btn');
    deleteBtn?.addEventListener('click', () => this.handleDelete(session.id));

    container.appendChild(itemEl);
  }

  private toggleSelection(id: string): void {
    if (this.selectedIds.has(id)) {
      this.selectedIds.delete(id);
    } else {
      this.selectedIds.add(id);
    }
    this.updateBulkActionsVisibility();
    this.updateSelectAllCheckbox();
  }

  private handleSelectAll(): void {
    const checkbox = this.$('.select-all-checkbox') as HTMLInputElement;
    if (checkbox.checked) {
      this.sessions.forEach(s => this.selectedIds.add(s.id));
    } else {
      this.selectedIds.clear();
    }
    this.updateCheckboxes();
    this.updateBulkActionsVisibility();
  }

  private clearSelection(): void {
    this.selectedIds.clear();
    this.updateCheckboxes();
    this.updateBulkActionsVisibility();
    this.updateSelectAllCheckbox();
  }

  private updateCheckboxes(): void {
    const checkboxes = this.$$('.item-checkbox') as NodeListOf<HTMLInputElement>;
    checkboxes.forEach(cb => {
      const sessionId = cb.closest('.session-item')?.getAttribute('data-session-id');
      if (sessionId) {
        cb.checked = this.selectedIds.has(sessionId);
      }
    });
  }

  private updateSelectAllCheckbox(): void {
    const checkbox = this.$('.select-all-checkbox') as HTMLInputElement;
    if (checkbox) {
      checkbox.checked = this.sessions.length > 0 && this.selectedIds.size === this.sessions.length;
    }
  }

  private updateBulkActionsVisibility(): void {
    const bulkActions = this.$('.bulk-actions') as HTMLElement;
    const bulkCount = this.$('.bulk-count');

    if (this.selectedIds.size > 0) {
      bulkActions?.style.setProperty('display', 'flex');
      if (bulkCount) {
        bulkCount.textContent = `${this.selectedIds.size} session${this.selectedIds.size !== 1 ? 's' : ''} selected`;
      }
    } else {
      bulkActions?.style.setProperty('display', 'none');
    }
  }

  private async handleRestore(id: string): Promise<void> {
    try {
      await sessionsApi.restore(id);
      toast.success('Session restored');
      this.sessions = this.sessions.filter(s => s.id !== id);
      this.selectedIds.delete(id);
      this.updateCount();
      this.renderSessions();
      this.updateBulkActionsVisibility();
    } catch (error) {
      toast.error('Failed to restore session');
    }
  }

  private async handleDelete(id: string): Promise<void> {
    const confirmed = await confirm({
      title: 'Delete Permanently',
      message: 'This session will be permanently deleted. This action cannot be undone.',
      confirmText: 'Delete',
      danger: true,
    });

    if (!confirmed) return;

    try {
      await sessionsApi.deletePermanentBulk([id]);
      toast.success('Session permanently deleted');
      this.sessions = this.sessions.filter(s => s.id !== id);
      this.selectedIds.delete(id);
      this.updateCount();
      this.renderSessions();
      this.updateBulkActionsVisibility();
    } catch (error) {
      toast.error('Failed to delete session');
    }
  }

  private async handleBulkRestore(): Promise<void> {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) return;

    try {
      await sessionsApi.restoreBulk(ids);
      toast.success(`${ids.length} session${ids.length !== 1 ? 's' : ''} restored`);
      this.sessions = this.sessions.filter(s => !this.selectedIds.has(s.id));
      this.selectedIds.clear();
      this.updateCount();
      this.renderSessions();
      this.updateBulkActionsVisibility();
      this.updateSelectAllCheckbox();
    } catch (error) {
      toast.error('Failed to restore sessions');
    }
  }

  private async handleBulkDelete(): Promise<void> {
    const ids = Array.from(this.selectedIds);
    if (ids.length === 0) return;

    const confirmed = await confirm({
      title: 'Delete Permanently',
      message: `${ids.length} session${ids.length !== 1 ? 's' : ''} will be permanently deleted. This action cannot be undone.`,
      confirmText: 'Delete',
      danger: true,
    });

    if (!confirmed) return;

    try {
      await sessionsApi.deletePermanentBulk(ids);
      toast.success(`${ids.length} session${ids.length !== 1 ? 's' : ''} permanently deleted`);
      this.sessions = this.sessions.filter(s => !this.selectedIds.has(s.id));
      this.selectedIds.clear();
      this.updateCount();
      this.renderSessions();
      this.updateBulkActionsVisibility();
      this.updateSelectAllCheckbox();
    } catch (error) {
      toast.error('Failed to delete sessions');
    }
  }

  protected onUnmount(): void {
    this.spinner?.unmount();
    this.emptyIcon?.unmount();
  }
}
