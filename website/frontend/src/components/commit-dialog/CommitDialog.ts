/**
 * CommitDialog Component
 * Modal dialog for committing changes to GitHub
 */

import { Component } from '../base';
import { Modal } from '../modal';
import { Button } from '../button';
import { TextArea } from '../input';
import { toast } from '../';
import { githubApi } from '../../lib/api';
import './commit-dialog.css';

export interface ChangedFile {
  path: string;
  content: string;
  status: 'modified' | 'added' | 'deleted';
}

export interface CommitDialogOptions {
  owner: string;
  repo: string;
  branch: string;
  onCommitSuccess?: (result: { commitSha: string; message: string }) => void;
  onClose?: () => void;
}

export class CommitDialog extends Component {
  private modal: Modal;
  private options: CommitDialogOptions;
  private changedFiles: ChangedFile[] = [];
  private messageInput: TextArea | null = null;
  private commitBtn: Button | null = null;
  private isCommitting = false;
  private selectedFiles: Set<string> = new Set();

  constructor(options: CommitDialogOptions) {
    super('div', { className: 'commit-dialog-wrapper' });
    this.options = options;

    this.modal = new Modal({
      title: 'Commit Changes',
      size: 'md',
      closeOnBackdrop: true,
      closeOnEscape: true,
      showClose: true,
      onClose: () => {
        this.options.onClose?.();
      },
    });

    this.buildContent();
  }

  private buildContent(): void {
    const body = this.modal.getBody();
    body.innerHTML = `
      <div class="commit-dialog">
        <div class="commit-files-section">
          <div class="commit-section-header">
            <span class="commit-section-title">Changed Files</span>
            <span class="commit-file-count">0 files</span>
          </div>
          <div class="commit-files-list">
            <div class="commit-files-empty">
              No changes to commit
            </div>
          </div>
        </div>
        <div class="commit-message-section">
          <label class="commit-message-label">Commit Message</label>
          <div class="commit-message-input"></div>
          <p class="commit-message-hint">
            Write a clear, concise description of your changes
          </p>
        </div>
      </div>
    `;

    // Create message input
    const messageContainer = body.querySelector('.commit-message-input') as HTMLElement;
    if (messageContainer) {
      this.messageInput = new TextArea({
        placeholder: 'Describe your changes...',
        rows: 3,
      });
      this.messageInput.mount(messageContainer);
    }

    // Add footer buttons
    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => this.close(),
    });

    this.commitBtn = new Button('Commit Changes', {
      variant: 'primary',
      disabled: true,
      onClick: () => this.handleCommit(),
    });

    this.modal.addFooterAction(cancelBtn);
    this.modal.addFooterAction(this.commitBtn);
  }

  /**
   * Set the list of changed files to display
   */
  setChangedFiles(files: ChangedFile[]): this {
    this.changedFiles = files;
    this.selectedFiles = new Set(files.map(f => f.path));
    this.renderFilesList();
    this.updateCommitButton();
    return this;
  }

  private renderFilesList(): void {
    const listContainer = this.modal.getBody().querySelector('.commit-files-list') as HTMLElement;
    const countEl = this.modal.getBody().querySelector('.commit-file-count') as HTMLElement;

    if (!listContainer) return;

    if (this.changedFiles.length === 0) {
      listContainer.innerHTML = `
        <div class="commit-files-empty">
          No changes to commit
        </div>
      `;
      if (countEl) countEl.textContent = '0 files';
      return;
    }

    if (countEl) {
      countEl.textContent = `${this.changedFiles.length} file${this.changedFiles.length !== 1 ? 's' : ''}`;
    }

    listContainer.innerHTML = this.changedFiles.map(file => `
      <label class="commit-file-item" data-path="${this.escapeHtml(file.path)}">
        <input type="checkbox" class="commit-file-checkbox" ${this.selectedFiles.has(file.path) ? 'checked' : ''}>
        <span class="commit-file-status commit-file-status--${file.status}">${this.getStatusIcon(file.status)}</span>
        <span class="commit-file-path">${this.escapeHtml(file.path)}</span>
      </label>
    `).join('');

    // Add checkbox handlers
    listContainer.querySelectorAll('.commit-file-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const item = target.closest('.commit-file-item') as HTMLElement;
        const path = item?.dataset.path;
        if (path) {
          if (target.checked) {
            this.selectedFiles.add(path);
          } else {
            this.selectedFiles.delete(path);
          }
          this.updateCommitButton();
        }
      });
    });
  }

  private getStatusIcon(status: 'modified' | 'added' | 'deleted'): string {
    switch (status) {
      case 'modified': return 'M';
      case 'added': return 'A';
      case 'deleted': return 'D';
      default: return '?';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private updateCommitButton(): void {
    if (!this.commitBtn) return;

    const hasSelectedFiles = this.selectedFiles.size > 0;

    this.commitBtn.setDisabled(!hasSelectedFiles || this.isCommitting);

    if (this.isCommitting) {
      this.commitBtn.setLabel('Committing...');
    } else {
      this.commitBtn.setLabel(`Commit ${this.selectedFiles.size} file${this.selectedFiles.size !== 1 ? 's' : ''}`);
    }
  }

  private async handleCommit(): Promise<void> {
    if (this.isCommitting || this.selectedFiles.size === 0) return;

    const message = this.messageInput?.getValue()?.trim() || this.generateDefaultMessage();

    this.isCommitting = true;
    this.updateCommitButton();

    try {
      const { owner, repo, branch } = this.options;

      // Prepare files for commit
      const filesToCommit = this.changedFiles.filter(f =>
        this.selectedFiles.has(f.path) && f.status !== 'deleted'
      );
      const deletions = this.changedFiles
        .filter(f => this.selectedFiles.has(f.path) && f.status === 'deleted')
        .map(f => f.path);

      const result = await githubApi.commit(owner, repo, {
        branch,
        files: filesToCommit.map(f => ({
          path: f.path,
          content: f.content,
        })),
        deletions: deletions.length > 0 ? deletions : undefined,
        message,
      });

      toast.success('Changes committed successfully');
      this.options.onCommitSuccess?.({
        commitSha: result.data.commitSha,
        message: result.data.message,
      });
      this.close();
    } catch (error) {
      console.error('Failed to commit changes:', error);
      toast.error(`Failed to commit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isCommitting = false;
      this.updateCommitButton();
    }
  }

  private generateDefaultMessage(): string {
    const modifiedCount = this.changedFiles.filter(f =>
      this.selectedFiles.has(f.path) && f.status === 'modified'
    ).length;
    const addedCount = this.changedFiles.filter(f =>
      this.selectedFiles.has(f.path) && f.status === 'added'
    ).length;
    const deletedCount = this.changedFiles.filter(f =>
      this.selectedFiles.has(f.path) && f.status === 'deleted'
    ).length;

    const parts = [];
    if (addedCount > 0) parts.push(`Add ${addedCount} file${addedCount !== 1 ? 's' : ''}`);
    if (modifiedCount > 0) parts.push(`Update ${modifiedCount} file${modifiedCount !== 1 ? 's' : ''}`);
    if (deletedCount > 0) parts.push(`Delete ${deletedCount} file${deletedCount !== 1 ? 's' : ''}`);

    return parts.join(', ') || 'Update files';
  }

  /**
   * Open the commit dialog
   */
  open(): this {
    // Attach message input listener for button state
    if (this.messageInput) {
      const inputEl = this.messageInput.getElement().querySelector('textarea');
      if (inputEl) {
        inputEl.addEventListener('input', () => this.updateCommitButton());
      }
    }
    this.modal.open();
    return this;
  }

  /**
   * Close the commit dialog
   */
  close(): this {
    this.modal.close();
    return this;
  }

  /**
   * Check if the dialog is open
   */
  isOpen(): boolean {
    return this.modal.getIsOpen();
  }

  /**
   * Cleanup
   */
  protected onUnmount(): void {
    this.modal.unmount();
  }
}
