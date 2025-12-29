/**
 * MidiImportDialog Component
 * Modal dialog for importing MIDI files
 */

import { Component } from '../base';
import { Modal } from '../modal';
import { Button } from '../button';
import { toast } from '../';
import { midiStore } from '../../lib/midi';
import './midi-import-dialog.css';

export interface MidiImportDialogOptions {
  onImportSuccess?: (fileName: string) => void;
  onClose?: () => void;
}

export class MidiImportDialog extends Component {
  private modal: Modal;
  private options: MidiImportDialogOptions;
  private fileInput: HTMLInputElement | null = null;
  private importBtn: Button | null = null;
  private selectedFile: File | null = null;
  private isImporting = false;

  constructor(options: MidiImportDialogOptions = {}) {
    super('div', { className: 'midi-import-dialog-wrapper' });
    this.options = options;

    this.modal = new Modal({
      title: 'Import MIDI File',
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
      <div class="midi-import-dialog">
        <div class="midi-import-dropzone" tabindex="0">
          <div class="midi-import-dropzone-content">
            <svg class="midi-import-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/>
            </svg>
            <svg class="midi-import-icon midi-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            <p class="midi-import-dropzone-text">
              Drop a MIDI file here or click to browse
            </p>
            <p class="midi-import-dropzone-hint">
              Supports .mid and .midi files
            </p>
          </div>
          <input type="file" accept=".mid,.midi,audio/midi,audio/x-midi" class="midi-import-file-input" />
        </div>
        <div class="midi-import-preview" style="display: none;">
          <div class="midi-import-preview-header">
            <svg class="midi-import-preview-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M9 18V5l12-2v13"/>
              <circle cx="6" cy="18" r="3"/>
              <circle cx="18" cy="16" r="3"/>
            </svg>
            <div class="midi-import-preview-info">
              <span class="midi-import-preview-name"></span>
              <span class="midi-import-preview-size"></span>
            </div>
            <button class="midi-import-preview-remove" type="button" aria-label="Remove file">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
        </div>
        <div class="midi-import-error" style="display: none;"></div>
      </div>
    `;

    // Setup file input
    this.fileInput = body.querySelector('.midi-import-file-input') as HTMLInputElement;
    if (this.fileInput) {
      this.fileInput.addEventListener('change', () => this.handleFileSelect());
    }

    // Setup dropzone
    const dropzone = body.querySelector('.midi-import-dropzone') as HTMLElement;
    if (dropzone) {
      dropzone.addEventListener('click', () => this.fileInput?.click());
      dropzone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.fileInput?.click();
        }
      });
      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('midi-import-dropzone--dragover');
      });
      dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('midi-import-dropzone--dragover');
      });
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('midi-import-dropzone--dragover');
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
          this.selectFile(files[0]);
        }
      });
    }

    // Setup remove button
    const removeBtn = body.querySelector('.midi-import-preview-remove') as HTMLButtonElement;
    if (removeBtn) {
      removeBtn.addEventListener('click', () => this.clearSelection());
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

  private handleFileSelect(): void {
    const files = this.fileInput?.files;
    if (files && files.length > 0) {
      this.selectFile(files[0]);
    }
  }

  private selectFile(file: File): void {
    // Validate file type
    const validTypes = ['audio/midi', 'audio/x-midi', 'audio/mid'];
    const validExtensions = ['.mid', '.midi'];
    const hasValidExtension = validExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );
    const hasValidType = validTypes.includes(file.type) || file.type === '';

    if (!hasValidExtension && !hasValidType) {
      this.showError('Please select a valid MIDI file (.mid or .midi)');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      this.showError('File size must be less than 5MB');
      return;
    }

    this.selectedFile = file;
    this.updatePreview();
    this.hideError();
  }

  private clearSelection(): void {
    this.selectedFile = null;
    if (this.fileInput) {
      this.fileInput.value = '';
    }
    this.updatePreview();
  }

  private updatePreview(): void {
    const dropzone = this.modal.getBody().querySelector('.midi-import-dropzone') as HTMLElement;
    const preview = this.modal.getBody().querySelector('.midi-import-preview') as HTMLElement;

    if (this.selectedFile) {
      dropzone.style.display = 'none';
      preview.style.display = 'block';

      const nameEl = preview.querySelector('.midi-import-preview-name') as HTMLElement;
      const sizeEl = preview.querySelector('.midi-import-preview-size') as HTMLElement;

      nameEl.textContent = this.selectedFile.name;
      sizeEl.textContent = this.formatBytes(this.selectedFile.size);

      this.importBtn?.setDisabled(false);
    } else {
      dropzone.style.display = 'flex';
      preview.style.display = 'none';
      this.importBtn?.setDisabled(true);
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  private showError(message: string): void {
    const errorEl = this.modal.getBody().querySelector('.midi-import-error') as HTMLElement;
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  }

  private hideError(): void {
    const errorEl = this.modal.getBody().querySelector('.midi-import-error') as HTMLElement;
    if (errorEl) {
      errorEl.style.display = 'none';
    }
  }

  private async handleImport(): Promise<void> {
    if (!this.selectedFile || this.isImporting) return;

    this.isImporting = true;
    this.importBtn?.setLabel('Importing...');
    this.importBtn?.setDisabled(true);

    try {
      // Initialize audio context if needed
      midiStore.init();

      // Load the file
      const success = await midiStore.loadFile(this.selectedFile);

      if (success) {
        toast.success(`Imported ${this.selectedFile.name}`);
        this.options.onImportSuccess?.(this.selectedFile.name);
        this.close();
      } else {
        this.showError('Failed to parse MIDI file. The file may be corrupted or in an unsupported format.');
      }
    } catch (error) {
      console.error('Failed to import MIDI file:', error);
      this.showError(error instanceof Error ? error.message : 'Failed to import file');
    } finally {
      this.isImporting = false;
      this.importBtn?.setLabel('Import');
      this.updatePreview();
    }
  }

  /**
   * Open the import dialog
   */
  open(): this {
    this.modal.open();
    return this;
  }

  /**
   * Close the import dialog
   */
  close(): this {
    this.modal.close();
    this.clearSelection();
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
