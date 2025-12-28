/**
 * SaveAsSnippetDialog Component
 * Modal dialog for saving selected code as a snippet
 */

import { Component } from '../base';
import { Modal } from '../modal';
import { Button } from '../button';
import { Input } from '../input';
import { toast } from '../';
import { snippetsApi } from '../../lib/api';
import { SNIPPET_LANGUAGES, SNIPPET_CATEGORIES } from '../../types';
import type { SnippetLanguage, SnippetCategory, Snippet } from '../../types';
import './save-as-snippet-dialog.css';

export interface SaveAsSnippetDialogOptions {
  code: string;
  language?: string;
  filename?: string;
  onSuccess?: (snippet: Snippet) => void;
  onClose?: () => void;
}

export class SaveAsSnippetDialog extends Component {
  private modal: Modal;
  private options: SaveAsSnippetDialogOptions;
  private titleInput: Input | null = null;
  private descriptionInput: Input | null = null;
  private languageSelect: HTMLSelectElement | null = null;
  private categorySelect: HTMLSelectElement | null = null;
  private tagsInput: Input | null = null;
  private saveBtn: Button | null = null;
  private isSaving = false;

  constructor(options: SaveAsSnippetDialogOptions) {
    super('div', { className: 'save-as-snippet-dialog-wrapper' });
    this.options = options;

    this.modal = new Modal({
      title: 'Save as Snippet',
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
    const detectedLanguage = this.detectLanguage();

    body.innerHTML = `
      <div class="save-as-snippet-dialog">
        <div class="snippet-form-section">
          <label class="snippet-form-label">Title <span class="required">*</span></label>
          <div class="title-input-container"></div>
        </div>

        <div class="snippet-form-section">
          <label class="snippet-form-label">Description</label>
          <div class="description-input-container"></div>
          <p class="snippet-form-hint">Optional description of what this code does</p>
        </div>

        <div class="snippet-form-row">
          <div class="snippet-form-section snippet-form-half">
            <label class="snippet-form-label">Language</label>
            <select class="snippet-form-select language-select">
              ${SNIPPET_LANGUAGES.map(lang => `
                <option value="${lang}" ${lang === detectedLanguage ? 'selected' : ''}>
                  ${this.formatLanguageName(lang)}
                </option>
              `).join('')}
            </select>
          </div>

          <div class="snippet-form-section snippet-form-half">
            <label class="snippet-form-label">Category</label>
            <select class="snippet-form-select category-select">
              ${SNIPPET_CATEGORIES.map(cat => `
                <option value="${cat}" ${cat === 'snippet' ? 'selected' : ''}>
                  ${this.formatCategoryName(cat)}
                </option>
              `).join('')}
            </select>
          </div>
        </div>

        <div class="snippet-form-section">
          <label class="snippet-form-label">Tags</label>
          <div class="tags-input-container"></div>
          <p class="snippet-form-hint">Comma-separated tags for easier searching</p>
        </div>

        <div class="snippet-form-section">
          <label class="snippet-form-label">Code Preview</label>
          <div class="code-preview-container">
            <pre class="code-preview"><code>${this.escapeHtml(this.truncateCode(this.options.code, 500))}</code></pre>
            ${this.options.code.length > 500 ? '<p class="code-preview-truncated">... (truncated)</p>' : ''}
          </div>
          <p class="snippet-form-hint">${this.options.code.split('\n').length} lines, ${this.options.code.length} characters</p>
        </div>
      </div>
    `;

    // Create title input
    const titleInputContainer = body.querySelector('.title-input-container') as HTMLElement;
    if (titleInputContainer) {
      const suggestedTitle = this.options.filename
        ? this.options.filename.replace(/\.[^/.]+$/, '') // Remove extension
        : 'Untitled Snippet';

      this.titleInput = new Input({
        type: 'text',
        placeholder: 'Enter snippet title',
        value: suggestedTitle,
        onInput: () => this.updateSaveButton(),
      });
      this.titleInput.mount(titleInputContainer);
    }

    // Create description input
    const descriptionInputContainer = body.querySelector('.description-input-container') as HTMLElement;
    if (descriptionInputContainer) {
      this.descriptionInput = new Input({
        type: 'text',
        placeholder: 'What does this code do?',
      });
      this.descriptionInput.mount(descriptionInputContainer);
    }

    // Create tags input
    const tagsInputContainer = body.querySelector('.tags-input-container') as HTMLElement;
    if (tagsInputContainer) {
      this.tagsInput = new Input({
        type: 'text',
        placeholder: 'e.g., utility, helper, react',
      });
      this.tagsInput.mount(tagsInputContainer);
    }

    // Get select elements
    this.languageSelect = body.querySelector('.language-select') as HTMLSelectElement;
    this.categorySelect = body.querySelector('.category-select') as HTMLSelectElement;

    // Add footer buttons
    const cancelBtn = new Button('Cancel', {
      variant: 'secondary',
      onClick: () => this.close(),
    });

    this.saveBtn = new Button('Save Snippet', {
      variant: 'primary',
      onClick: () => this.handleSave(),
    });

    this.modal.addFooterAction(cancelBtn);
    this.modal.addFooterAction(this.saveBtn);

    this.updateSaveButton();
  }

  private detectLanguage(): SnippetLanguage {
    // First check if language was provided
    if (this.options.language) {
      const normalized = this.normalizeLanguage(this.options.language);
      if (normalized) return normalized;
    }

    // Try to detect from filename
    if (this.options.filename) {
      const ext = this.options.filename.split('.').pop()?.toLowerCase() || '';
      const normalized = this.normalizeLanguage(ext);
      if (normalized) return normalized;
    }

    return 'other';
  }

  private normalizeLanguage(lang: string): SnippetLanguage | null {
    const langLower = lang.toLowerCase();

    const languageMap: Record<string, SnippetLanguage> = {
      'js': 'javascript',
      'javascript': 'javascript',
      'jsx': 'javascript',
      'mjs': 'javascript',
      'cjs': 'javascript',
      'ts': 'typescript',
      'typescript': 'typescript',
      'tsx': 'typescript',
      'py': 'python',
      'python': 'python',
      'java': 'java',
      'cs': 'csharp',
      'csharp': 'csharp',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'c': 'c',
      'h': 'c',
      'go': 'go',
      'rs': 'rust',
      'rust': 'rust',
      'rb': 'ruby',
      'ruby': 'ruby',
      'php': 'php',
      'swift': 'swift',
      'kt': 'kotlin',
      'kotlin': 'kotlin',
      'scala': 'scala',
      'html': 'html',
      'htm': 'html',
      'css': 'css',
      'scss': 'scss',
      'sass': 'scss',
      'sql': 'sql',
      'sh': 'bash',
      'bash': 'bash',
      'shell': 'bash',
      'ps1': 'powershell',
      'powershell': 'powershell',
      'yml': 'yaml',
      'yaml': 'yaml',
      'json': 'json',
      'xml': 'xml',
      'md': 'markdown',
      'markdown': 'markdown',
      'dockerfile': 'dockerfile',
      'tf': 'terraform',
      'terraform': 'terraform',
      'graphql': 'graphql',
      'gql': 'graphql',
    };

    return languageMap[langLower] || null;
  }

  private formatLanguageName(lang: SnippetLanguage): string {
    const nameMap: Record<SnippetLanguage, string> = {
      'javascript': 'JavaScript',
      'typescript': 'TypeScript',
      'python': 'Python',
      'java': 'Java',
      'csharp': 'C#',
      'cpp': 'C++',
      'c': 'C',
      'go': 'Go',
      'rust': 'Rust',
      'ruby': 'Ruby',
      'php': 'PHP',
      'swift': 'Swift',
      'kotlin': 'Kotlin',
      'scala': 'Scala',
      'html': 'HTML',
      'css': 'CSS',
      'scss': 'SCSS',
      'sql': 'SQL',
      'bash': 'Bash',
      'powershell': 'PowerShell',
      'yaml': 'YAML',
      'json': 'JSON',
      'xml': 'XML',
      'markdown': 'Markdown',
      'dockerfile': 'Dockerfile',
      'terraform': 'Terraform',
      'graphql': 'GraphQL',
      'other': 'Other',
    };
    return nameMap[lang] || lang;
  }

  private formatCategoryName(cat: SnippetCategory): string {
    const nameMap: Record<SnippetCategory, string> = {
      'function': 'Function',
      'class': 'Class',
      'component': 'Component',
      'hook': 'Hook',
      'utility': 'Utility',
      'api': 'API',
      'database': 'Database',
      'testing': 'Testing',
      'config': 'Config',
      'boilerplate': 'Boilerplate',
      'algorithm': 'Algorithm',
      'pattern': 'Pattern',
      'snippet': 'Snippet',
      'template': 'Template',
      'other': 'Other',
    };
    return nameMap[cat] || cat;
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private truncateCode(code: string, maxLength: number): string {
    if (code.length <= maxLength) return code;
    return code.slice(0, maxLength);
  }

  private updateSaveButton(): void {
    if (!this.saveBtn) return;

    const title = this.titleInput?.getValue()?.trim() || '';
    const isValid = title.length > 0;

    this.saveBtn.setDisabled(!isValid || this.isSaving);

    if (this.isSaving) {
      this.saveBtn.setLabel('Saving...');
    } else {
      this.saveBtn.setLabel('Save Snippet');
    }
  }

  private async handleSave(): Promise<void> {
    if (this.isSaving) return;

    const title = this.titleInput?.getValue()?.trim();
    if (!title) {
      toast.error('Please enter a title');
      return;
    }

    this.isSaving = true;
    this.updateSaveButton();

    try {
      const description = this.descriptionInput?.getValue()?.trim() || undefined;
      const language = (this.languageSelect?.value || 'other') as SnippetLanguage;
      const category = (this.categorySelect?.value || 'snippet') as SnippetCategory;
      const tagsStr = this.tagsInput?.getValue()?.trim() || '';
      const tags = tagsStr
        ? tagsStr.split(',').map(t => t.trim()).filter(t => t.length > 0)
        : [];

      const snippet = await snippetsApi.create({
        title,
        description,
        code: this.options.code,
        language,
        category,
        tags,
      });

      toast.success('Snippet saved successfully');
      this.options.onSuccess?.(snippet);
      this.close();
    } catch (error) {
      console.error('Failed to save snippet:', error);
      toast.error(`Failed to save: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      this.isSaving = false;
      this.updateSaveButton();
    }
  }

  /**
   * Open the dialog
   */
  open(): this {
    this.modal.open();
    // Focus title input
    setTimeout(() => {
      this.titleInput?.focus();
    }, 100);
    return this;
  }

  /**
   * Close the dialog
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
