/**
 * DiffViewer Component
 * Displays diff comparison between branches with file-by-file navigation
 */

import { Component } from '../base';
import { Spinner } from '../spinner';
import { diffsApi } from '../../lib/api';
import type { CompareResult, FileDiff, DiffHunk, DiffLine, FileChange } from '../../lib/api';
import './diff-viewer.css';

export interface DiffViewerOptions {
  owner: string;
  repo: string;
  baseBranch: string;
  headBranch: string;
  onClose?: () => void;
}

export class DiffViewer extends Component<HTMLDivElement> {
  private options: DiffViewerOptions;
  private compareResult: CompareResult | null = null;
  private changedFiles: FileChange[] = [];
  private selectedFile: string | null = null;
  private isLoading = true;
  private error: string | null = null;

  constructor(options: DiffViewerOptions) {
    super('div', { className: 'diff-viewer' });
    this.options = options;
  }

  protected onMount(): void {
    this.render();
    this.loadDiff();
  }

  private async loadDiff(): Promise<void> {
    this.isLoading = true;
    this.error = null;
    this.render();

    try {
      const { owner, repo, baseBranch, headBranch } = this.options;

      // Load changed files list first (lighter)
      const changedFilesResult = await diffsApi.getChangedFiles(owner, repo, baseBranch, headBranch);
      this.changedFiles = changedFilesResult.files;

      // Load full comparison
      this.compareResult = await diffsApi.compare(owner, repo, baseBranch, headBranch);

      // Select first file by default if any
      if (this.compareResult.diff.files.length > 0) {
        this.selectedFile = this.compareResult.diff.files[0].newPath || this.compareResult.diff.files[0].oldPath;
      }
    } catch (err) {
      this.error = err instanceof Error ? err.message : 'Failed to load diff';
    } finally {
      this.isLoading = false;
      this.render();
    }
  }

  private selectFile(filePath: string): void {
    this.selectedFile = filePath;
    this.render();
  }

  private getFileStatusLabel(status: FileChange['status']): string {
    switch (status) {
      case 'added': return 'A';
      case 'removed': return 'D';
      case 'modified': return 'M';
      case 'renamed': return 'R';
      case 'copied': return 'C';
      default: return '?';
    }
  }

  private getFileStatusClass(status: FileChange['status']): string {
    switch (status) {
      case 'added': return 'added';
      case 'removed': return 'deleted';
      case 'modified': return 'modified';
      case 'renamed': return 'renamed';
      default: return 'modified';
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private renderHeader(): string {
    const { baseBranch, headBranch } = this.options;
    const result = this.compareResult;

    let statsHtml = '';
    if (result) {
      const { diff, aheadBy, behindBy } = result;
      statsHtml = `
        <div class="diff-viewer-stats">
          <span class="diff-stat diff-stat-files">${diff.totalFilesChanged} file${diff.totalFilesChanged !== 1 ? 's' : ''}</span>
          <span class="diff-stat diff-stat-additions">+${diff.totalAdditions}</span>
          <span class="diff-stat diff-stat-deletions">-${diff.totalDeletions}</span>
          ${aheadBy > 0 ? `<span class="diff-stat">${aheadBy} commit${aheadBy !== 1 ? 's' : ''} ahead</span>` : ''}
          ${behindBy > 0 ? `<span class="diff-stat">${behindBy} commit${behindBy !== 1 ? 's' : ''} behind</span>` : ''}
        </div>
      `;
    }

    return `
      <div class="diff-viewer-header">
        <div class="diff-viewer-title">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
            <path d="M6 3v12"></path>
            <circle cx="6" cy="18" r="3"></circle>
            <circle cx="18" cy="6" r="3"></circle>
            <path d="M18 9a9 9 0 0 1-9 9"></path>
          </svg>
          Comparing <code>${this.escapeHtml(baseBranch)}</code> ... <code>${this.escapeHtml(headBranch)}</code>
        </div>
        ${statsHtml}
      </div>
    `;
  }

  private renderFileList(): string {
    if (this.changedFiles.length === 0) {
      return '';
    }

    const fileItems = this.changedFiles.map(file => {
      const isActive = this.selectedFile === file.filename;
      const statusLabel = this.getFileStatusLabel(file.status);
      const statusClass = this.getFileStatusClass(file.status);

      return `
        <div class="diff-file-item ${isActive ? 'active' : ''}" data-file="${this.escapeHtml(file.filename)}">
          <span class="diff-file-status ${statusClass}">${statusLabel}</span>
          <span class="diff-file-name">${this.escapeHtml(file.filename)}</span>
          <span class="diff-file-changes">
            <span class="diff-file-additions">+${file.additions}</span>
            <span class="diff-file-deletions">-${file.deletions}</span>
          </span>
        </div>
      `;
    }).join('');

    return `<div class="diff-file-list">${fileItems}</div>`;
  }

  private renderDiffLine(line: DiffLine): string {
    const oldNum = line.oldLineNumber !== undefined ? line.oldLineNumber : '';
    const newNum = line.newLineNumber !== undefined ? line.newLineNumber : '';
    let marker = ' ';

    if (line.type === 'addition') marker = '+';
    else if (line.type === 'deletion') marker = '-';

    return `
      <div class="diff-line ${line.type}">
        <div class="diff-line-numbers">
          <span class="diff-line-number old">${oldNum}</span>
          <span class="diff-line-number new">${newNum}</span>
        </div>
        <span class="diff-line-marker">${marker}</span>
        <span class="diff-line-content">${this.escapeHtml(line.content)}</span>
      </div>
    `;
  }

  private renderHunk(hunk: DiffHunk): string {
    const lines = hunk.lines.map(line => this.renderDiffLine(line)).join('');

    return `
      <div class="diff-hunk">
        <div class="diff-hunk-header">
          @@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@
        </div>
        ${lines}
      </div>
    `;
  }

  private renderFileDiff(file: FileDiff): string {
    if (file.isBinary) {
      return `<div class="diff-binary">Binary file changed</div>`;
    }

    if (file.hunks.length === 0) {
      return `<div class="diff-binary">No changes in content</div>`;
    }

    const hunks = file.hunks.map(hunk => this.renderHunk(hunk)).join('');

    return `
      <div class="diff-file-header">
        <span class="diff-file-path">${this.escapeHtml(file.newPath || file.oldPath)}</span>
        <span class="diff-file-changes">
          <span class="diff-file-additions">+${file.additions}</span>
          <span class="diff-file-deletions">-${file.deletions}</span>
        </span>
      </div>
      ${hunks}
    `;
  }

  private renderContent(): string {
    if (this.isLoading) {
      return '<div class="diff-loading"><div class="spinner-placeholder"></div></div>';
    }

    if (this.error) {
      return `
        <div class="diff-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <p>Error: ${this.escapeHtml(this.error)}</p>
        </div>
      `;
    }

    if (!this.compareResult || this.compareResult.diff.files.length === 0) {
      return `
        <div class="diff-no-changes">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="48" height="48">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
          </svg>
          <p>No changes between branches</p>
          <p style="font-size: var(--font-size-sm);">The branches are identical.</p>
        </div>
      `;
    }

    // Find the selected file
    const selectedFileDiff = this.compareResult.diff.files.find(
      f => (f.newPath || f.oldPath) === this.selectedFile
    );

    if (!selectedFileDiff) {
      return `
        <div class="diff-empty">
          <p>Select a file to view changes</p>
        </div>
      `;
    }

    return this.renderFileDiff(selectedFileDiff);
  }

  render(): this {
    this.element.innerHTML = `
      ${this.renderHeader()}
      ${this.renderFileList()}
      <div class="diff-content">
        ${this.renderContent()}
      </div>
    `;

    // Add spinner if loading
    if (this.isLoading) {
      const placeholder = this.element.querySelector('.spinner-placeholder');
      if (placeholder) {
        const spinner = new Spinner({ size: 'md' });
        placeholder.replaceWith(spinner.getElement());
      }
    }

    // Add file click handlers
    this.element.querySelectorAll('.diff-file-item').forEach(item => {
      item.addEventListener('click', () => {
        const filePath = (item as HTMLElement).dataset.file;
        if (filePath) {
          this.selectFile(filePath);
        }
      });
    });

    return this;
  }
}
