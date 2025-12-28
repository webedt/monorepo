/**
 * UrlImportDialog Component
 * Modal dialog for importing files from external URLs
 */

import { Component } from '../base';
import { Modal } from '../modal';
import { Button } from '../button';
import { Input } from '../input';
import { toast } from '../';
import { importApi } from '../../lib/api';
import './url-import-dialog.css';

export interface UrlImportDialogOptions {
  sessionPath: string;
  onImportSuccess?: (result: { filePath: string; contentType: string; size: number }) => void;
  onClose?: () => void;
}

export class UrlImportDialog extends Component {
  private modal: Modal;
  private options: UrlImportDialogOptions;
  private urlInput: Input | null = null;
  private filenameInput: Input | null = null;
  private importBtn: Button | null = null;
  private isImporting = false;
  private isValidating = false;
  private validationResult: {
    valid: boolean;
    suggestedFilename?: string;
    contentType?: string;
    contentLength?: number;
    error?: string;
  } | null = null;

  constructor(options: UrlImportDialogOptions) {
    super('div', { className: 'url-import-dialog-wrapper' });
    this.options = options;

    this.modal = new Modal({
      title: 'Import from URL',
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
      <div class="url-import-dialog">
        <div class="url-import-section">
          <label class="url-import-label">URL</label>
          <div class="url-input-container"></div>
          <p class="url-import-hint">
            Enter the URL of the file you want to import (e.g., raw GitHub file, gist, etc.)
          </p>
        </div>
        <div class="url-import-section">
          <label class="url-import-label">Save as (optional)</label>
          <div class="filename-input-container"></div>
          <p class="url-import-hint">
            Leave empty to use the filename from the URL
          </p>
        </div>
        <div class="url-import-validating" style="display: none;">
          <span class="url-import-validating-text">Validating URL...</span>
        </div>
        <div class="url-import-preview" style="display: none;">
          <div class="url-import-preview-header">
            <span class="url-import-preview-title">File Preview</span>
          </div>
          <div class="url-import-preview-content">
            <div class="url-import-preview-item">
              <span class="url-import-preview-label">Filename:</span>
              <span class="url-import-preview-value" data-field="filename"></span>
            </div>
            <div class="url-import-preview-item">
              <span class="url-import-preview-label">Type:</span>
              <span class="url-import-preview-value" data-field="contentType"></span>
            </div>
            <div class="url-import-preview-item" data-field="size-container">
              <span class="url-import-preview-label">Size:</span>
              <span class="url-import-preview-value" data-field="size"></span>
            </div>
          </div>
        </div>
        <div class="url-import-error" style="display: none;"></div>
      </div>
    `;

    // Create URL input
    const urlInputContainer = body.querySelector('.url-input-container') as HTMLElement;
    if (urlInputContainer) {
      this.urlInput = new Input({
        type: 'url',
        placeholder: 'https://example.com/file.js',
        onInput: () => this.handleUrlChange(),
        onBlur: () => this.validateUrl(),
      });
      this.urlInput.mount(urlInputContainer);
    }

    // Create filename input
    const filenameInputContainer = body.querySelector('.filename-input-container') as HTMLElement;
    if (filenameInputContainer) {
      this.filenameInput = new Input({
        type: 'text',
        placeholder: 'path/to/file.js',
      });
      this.filenameInput.mount(filenameInputContainer);
    }

    // Add footer buttons
    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => this.close(),
    });

    this.importBtn = new Button('Import', {
      variant: 'primary',
      disabled: true,
      onClick: () => this.handleImport(),
    });

    this.modal.addFooterAction(cancelBtn);
    this.modal.addFooterAction(this.importBtn);
  }

  private handleUrlChange(): void {
    // Reset validation when URL changes
    this.validationResult = null;
    this.updatePreview();
    this.updateImportButton();
  }

  private async validateUrl(): Promise<void> {
    const url = this.urlInput?.getValue()?.trim();
    if (!url) {
      this.validationResult = null;
      this.isValidating = false;
      this.updatePreview();
      this.updateImportButton();
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      this.validationResult = { valid: false, error: 'Invalid URL format' };
      this.isValidating = false;
      this.updatePreview();
      this.updateImportButton();
      return;
    }

    // Show loading state
    this.isValidating = true;
    this.validationResult = null;
    this.updatePreview();

    try {
      // Validate URL with backend
      const result = await importApi.validate(url);
      this.validationResult = result.data;

      // Auto-fill filename if not already set
      if (this.validationResult?.valid && this.validationResult.suggestedFilename) {
        const currentFilename = this.filenameInput?.getValue()?.trim();
        if (!currentFilename) {
          this.filenameInput?.setValue(this.validationResult.suggestedFilename);
        }
      }
    } catch (error) {
      this.validationResult = {
        valid: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      };
    } finally {
      this.isValidating = false;
      this.updatePreview();
      this.updateImportButton();
    }
  }

  private updatePreview(): void {
    const validatingEl = this.modal.getBody().querySelector('.url-import-validating') as HTMLElement;
    const previewEl = this.modal.getBody().querySelector('.url-import-preview') as HTMLElement;
    const errorEl = this.modal.getBody().querySelector('.url-import-error') as HTMLElement;

    // Show loading indicator during validation
    if (this.isValidating) {
      validatingEl.style.display = 'block';
      previewEl.style.display = 'none';
      errorEl.style.display = 'none';
      return;
    }

    validatingEl.style.display = 'none';

    if (!this.validationResult) {
      previewEl.style.display = 'none';
      errorEl.style.display = 'none';
      return;
    }

    if (!this.validationResult.valid) {
      previewEl.style.display = 'none';
      errorEl.style.display = 'block';
      errorEl.textContent = this.validationResult.error || 'Invalid URL';
      return;
    }

    // Show preview
    errorEl.style.display = 'none';
    previewEl.style.display = 'block';

    const filenameEl = previewEl.querySelector('[data-field="filename"]') as HTMLElement;
    const contentTypeEl = previewEl.querySelector('[data-field="contentType"]') as HTMLElement;
    const sizeEl = previewEl.querySelector('[data-field="size"]') as HTMLElement;
    const sizeContainer = previewEl.querySelector('[data-field="size-container"]') as HTMLElement;

    filenameEl.textContent = this.filenameInput?.getValue()?.trim() ||
      this.validationResult.suggestedFilename ||
      'Unknown';
    contentTypeEl.textContent = this.validationResult.contentType || 'Unknown';

    if (this.validationResult.contentLength) {
      sizeContainer.style.display = 'flex';
      sizeEl.textContent = this.formatBytes(this.validationResult.contentLength);
    } else {
      sizeContainer.style.display = 'none';
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private updateImportButton(): void {
    if (!this.importBtn) return;

    const hasValidUrl = this.validationResult?.valid === true;
    this.importBtn.setDisabled(!hasValidUrl || this.isImporting);

    if (this.isImporting) {
      this.importBtn.setLabel('Importing...');
    } else {
      this.importBtn.setLabel('Import');
    }
  }

  private async handleImport(): Promise<void> {
    if (this.isImporting || !this.validationResult?.valid) return;

    const url = this.urlInput?.getValue()?.trim();
    const targetPath = this.filenameInput?.getValue()?.trim() ||
      this.validationResult.suggestedFilename;

    if (!url) {
      toast.error('Please enter a URL');
      return;
    }

    this.isImporting = true;
    this.updateImportButton();

    try {
      const result = await importApi.fromUrl(
        url,
        this.options.sessionPath,
        targetPath
      );

      toast.success(`Imported ${result.data.filePath}`);
      this.options.onImportSuccess?.(result.data);
      this.close();
    } catch (error) {
      console.error('Failed to import file:', error);
      toast.error(`Failed to import: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isImporting = false;
      this.updateImportButton();
    }
  }

  /**
   * Open the import dialog
   */
  open(): this {
    this.modal.open();
    // Focus URL input
    setTimeout(() => {
      this.urlInput?.focus();
    }, 100);
    return this;
  }

  /**
   * Close the import dialog
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
