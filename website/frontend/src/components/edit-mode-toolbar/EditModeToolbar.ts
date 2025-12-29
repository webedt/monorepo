/**
 * Edit Mode Toolbar Component
 * Provides mode selection and editing tools for scene editing
 */

import { Component } from '../base';
import { editModeStore } from '../../stores/editModeStore';

import type { EditMode } from '../../stores/editModeStore';

export interface EditModeToolbarOptions {
  /** Called when edit mode changes */
  onModeChange?: (mode: EditMode) => void;
  /** Called when selection is cleared */
  onClearSelection?: () => void;
  /** Called when delete is requested */
  onDelete?: () => void;
  /** Called when copy is requested */
  onCopy?: () => void;
  /** Called when paste is requested */
  onPaste?: () => void;
  /** Called when duplicate is requested */
  onDuplicate?: () => void;
  /** Called when select all is requested */
  onSelectAll?: () => void;
  /** Initial edit mode */
  initialMode?: EditMode;
  /** Whether to show extended tools (copy, paste, etc.) */
  showExtendedTools?: boolean;
  /** Orientation of the toolbar */
  orientation?: 'horizontal' | 'vertical';
}

interface ModeButton {
  mode: EditMode;
  icon: string;
  title: string;
  shortcut?: string;
}

const MODE_BUTTONS: ModeButton[] = [
  {
    mode: 'select',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 3l14 9-7 2-3 7z"/>
    </svg>`,
    title: 'Select Tool',
    shortcut: 'V',
  },
  {
    mode: 'pan',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2L12 22M2 12L22 12"/>
      <path d="M17 7L12 2L7 7M17 17L12 22L7 17M7 7L2 12L7 17M17 7L22 12L17 17"/>
    </svg>`,
    title: 'Pan Tool',
    shortcut: 'H',
  },
  {
    mode: 'draw-rectangle',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
    </svg>`,
    title: 'Draw Rectangle',
    shortcut: 'R',
  },
  {
    mode: 'draw-circle',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
    </svg>`,
    title: 'Draw Circle',
    shortcut: 'O',
  },
  {
    mode: 'draw-text',
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="4 7 4 4 20 4 20 7"/>
      <line x1="9" y1="20" x2="15" y2="20"/>
      <line x1="12" y1="4" x2="12" y2="20"/>
    </svg>`,
    title: 'Draw Text',
    shortcut: 'T',
  },
];

export class EditModeToolbar extends Component {
  private options: EditModeToolbarOptions;
  private unsubscribe: (() => void) | null = null;
  private boundKeyHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(options: EditModeToolbarOptions = {}) {
    super('div', { className: 'edit-mode-toolbar' });
    this.options = options;

    if (options.orientation === 'vertical') {
      this.addClass('edit-mode-toolbar--vertical');
    }

    if (options.initialMode) {
      editModeStore.setMode(options.initialMode);
    }

    this.render();
  }

  protected onMount(): void {
    // Subscribe to store changes
    this.unsubscribe = editModeStore.subscribe(() => {
      this.updateActiveButton();
    });

    // Setup keyboard shortcuts
    this.boundKeyHandler = (e: KeyboardEvent) => this.handleKeyDown(e);
    document.addEventListener('keydown', this.boundKeyHandler);
  }

  protected onUnmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.boundKeyHandler) {
      document.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
  }

  render(): this {
    const currentMode = editModeStore.getMode();
    const showExtended = this.options.showExtendedTools ?? true;

    this.element.innerHTML = `
      <div class="edit-mode-toolbar-section edit-mode-tools">
        ${MODE_BUTTONS.map(btn => this.renderModeButton(btn, currentMode === btn.mode)).join('')}
      </div>
      ${showExtended ? this.renderExtendedTools() : ''}
    `;

    this.setupEventHandlers();
    return this;
  }

  private renderModeButton(btn: ModeButton, isActive: boolean): string {
    const shortcutHint = btn.shortcut ? ` (${btn.shortcut})` : '';
    return `
      <button
        class="edit-mode-btn ${isActive ? 'active' : ''}"
        data-mode="${btn.mode}"
        title="${btn.title}${shortcutHint}"
        aria-pressed="${isActive}"
      >
        ${btn.icon}
      </button>
    `;
  }

  private renderExtendedTools(): string {
    const selectedCount = editModeStore.getSelectedObjectIds().length;
    const hasSelection = selectedCount > 0;
    const hasClipboard = editModeStore.getClipboard().length > 0;

    return `
      <div class="edit-mode-toolbar-separator"></div>
      <div class="edit-mode-toolbar-section edit-mode-actions">
        <button
          class="edit-mode-btn edit-mode-action-btn"
          data-action="select-all"
          title="Select All (Ctrl+A)"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="4 2"/>
          </svg>
        </button>
        <button
          class="edit-mode-btn edit-mode-action-btn"
          data-action="copy"
          title="Copy (Ctrl+C)"
          ${!hasSelection ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>
          </svg>
        </button>
        <button
          class="edit-mode-btn edit-mode-action-btn"
          data-action="paste"
          title="Paste (Ctrl+V)"
          ${!hasClipboard ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
            <rect x="8" y="2" width="8" height="4" rx="1"/>
          </svg>
        </button>
        <button
          class="edit-mode-btn edit-mode-action-btn"
          data-action="duplicate"
          title="Duplicate (Ctrl+D)"
          ${!hasSelection ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="8" y="8" width="12" height="12" rx="2"/>
            <rect x="4" y="4" width="12" height="12" rx="2"/>
          </svg>
        </button>
        <button
          class="edit-mode-btn edit-mode-action-btn edit-mode-action-btn--danger"
          data-action="delete"
          title="Delete (Del)"
          ${!hasSelection ? 'disabled' : ''}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
            <line x1="10" y1="11" x2="10" y2="17"/>
            <line x1="14" y1="11" x2="14" y2="17"/>
          </svg>
        </button>
      </div>
      <div class="edit-mode-toolbar-separator"></div>
      <div class="edit-mode-toolbar-section edit-mode-info">
        <span class="edit-mode-selection-count">
          ${hasSelection ? `${selectedCount} selected` : 'No selection'}
        </span>
      </div>
    `;
  }

  private setupEventHandlers(): void {
    // Mode button handlers
    const modeButtons = this.element.querySelectorAll('[data-mode]');
    modeButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = (btn as HTMLElement).dataset.mode as EditMode;
        this.setMode(mode);
      });
    });

    // Action button handlers
    const actionButtons = this.element.querySelectorAll('[data-action]');
    actionButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = (btn as HTMLElement).dataset.action;
        this.handleAction(action || '');
      });
    });
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Don't handle shortcuts if typing in an input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
      return;
    }

    // Mode shortcuts (no modifier keys)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      switch (e.key.toUpperCase()) {
        case 'V':
          e.preventDefault();
          this.setMode('select');
          break;
        case 'H':
          e.preventDefault();
          this.setMode('pan');
          break;
        case 'R':
          e.preventDefault();
          this.setMode('draw-rectangle');
          break;
        case 'O':
          e.preventDefault();
          this.setMode('draw-circle');
          break;
        case 'T':
          e.preventDefault();
          this.setMode('draw-text');
          break;
        case 'DELETE':
        case 'BACKSPACE':
          if (editModeStore.getSelectedObjectIds().length > 0) {
            e.preventDefault();
            this.handleAction('delete');
          }
          break;
        case 'ESCAPE':
          e.preventDefault();
          editModeStore.clearSelection();
          this.options.onClearSelection?.();
          break;
      }
    }

    // Ctrl/Cmd shortcuts
    if (e.ctrlKey || e.metaKey) {
      switch (e.key.toUpperCase()) {
        case 'A':
          e.preventDefault();
          this.handleAction('select-all');
          break;
        case 'C':
          if (editModeStore.getSelectedObjectIds().length > 0) {
            e.preventDefault();
            this.handleAction('copy');
          }
          break;
        case 'V':
          if (editModeStore.getClipboard().length > 0) {
            e.preventDefault();
            this.handleAction('paste');
          }
          break;
        case 'D':
          if (editModeStore.getSelectedObjectIds().length > 0) {
            e.preventDefault();
            this.handleAction('duplicate');
          }
          break;
      }
    }
  }

  private setMode(mode: EditMode): void {
    editModeStore.setMode(mode);
    this.options.onModeChange?.(mode);
  }

  private handleAction(action: string): void {
    switch (action) {
      case 'select-all':
        this.options.onSelectAll?.();
        break;
      case 'copy':
        this.options.onCopy?.();
        break;
      case 'paste':
        this.options.onPaste?.();
        break;
      case 'duplicate':
        this.options.onDuplicate?.();
        break;
      case 'delete':
        this.options.onDelete?.();
        break;
    }
  }

  private updateActiveButton(): void {
    const currentMode = editModeStore.getMode();

    // Update mode buttons
    const modeButtons = this.element.querySelectorAll('[data-mode]');
    modeButtons.forEach(btn => {
      const mode = (btn as HTMLElement).dataset.mode as EditMode;
      btn.classList.toggle('active', mode === currentMode);
      btn.setAttribute('aria-pressed', String(mode === currentMode));
    });

    // Update action buttons state
    const selectedCount = editModeStore.getSelectedObjectIds().length;
    const hasSelection = selectedCount > 0;
    const hasClipboard = editModeStore.getClipboard().length > 0;

    const copyBtn = this.element.querySelector('[data-action="copy"]') as HTMLButtonElement;
    const pasteBtn = this.element.querySelector('[data-action="paste"]') as HTMLButtonElement;
    const duplicateBtn = this.element.querySelector('[data-action="duplicate"]') as HTMLButtonElement;
    const deleteBtn = this.element.querySelector('[data-action="delete"]') as HTMLButtonElement;
    const countSpan = this.element.querySelector('.edit-mode-selection-count');

    if (copyBtn) copyBtn.disabled = !hasSelection;
    if (pasteBtn) pasteBtn.disabled = !hasClipboard;
    if (duplicateBtn) duplicateBtn.disabled = !hasSelection;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
    if (countSpan) {
      countSpan.textContent = hasSelection ? `${selectedCount} selected` : 'No selection';
    }
  }

  /**
   * Get the current edit mode
   */
  getMode(): EditMode {
    return editModeStore.getMode();
  }

  /**
   * Update the toolbar to reflect current store state
   */
  update(): this {
    this.updateActiveButton();
    return this;
  }
}
