/**
 * Collaborative Cursors Component
 * Displays other users' cursor positions in the code editor
 */

import { Component } from '../base';
import type { ComponentOptions } from '../base';
import { presenceStore } from '../../stores';
import type { PresenceUser } from '../../lib/api';
import './collaborative-cursors.css';

export interface CollaborativeCursorsOptions extends ComponentOptions {
  /** The file path to show cursors for */
  filePath?: string;
  /** Reference to the editor element for positioning */
  editorElement?: HTMLTextAreaElement;
  /** Line height in pixels */
  lineHeight?: number;
  /** Character width in pixels */
  charWidth?: number;
}

interface CursorData extends PresenceUser {
  color: string;
}

export class CollaborativeCursors extends Component {
  private options: CollaborativeCursorsOptions;
  private cursors: Map<string, HTMLElement> = new Map();
  private unsubscribe: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: CollaborativeCursorsOptions = {}) {
    super('div', {
      className: 'collaborative-cursors',
      ...options,
    });

    this.options = {
      lineHeight: 20,
      charWidth: 8,
      ...options,
    };

    this.render();
  }

  /**
   * Set the current file path to filter cursors
   */
  setFilePath(filePath: string): void {
    this.options.filePath = filePath;
    this.updateCursors();
  }

  /**
   * Set the editor element reference
   */
  setEditorElement(editor: HTMLTextAreaElement): void {
    this.options.editorElement = editor;

    // Calculate character dimensions from the editor's font
    this.measureCharacterDimensions();

    // Watch for scroll
    editor.addEventListener('scroll', () => this.updateCursorPositions());

    // Watch for resize
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.measureCharacterDimensions();
      this.updateCursorPositions();
    });
    this.resizeObserver.observe(editor);
  }

  /**
   * Measure character dimensions based on editor font
   */
  private measureCharacterDimensions(): void {
    const editor = this.options.editorElement;
    if (!editor) return;

    const style = window.getComputedStyle(editor);

    // Create a temporary span to measure character width
    const span = document.createElement('span');
    span.style.cssText = `
      font-family: ${style.fontFamily};
      font-size: ${style.fontSize};
      font-weight: ${style.fontWeight};
      line-height: ${style.lineHeight};
      visibility: hidden;
      position: absolute;
      white-space: pre;
    `;
    span.textContent = 'X';
    document.body.appendChild(span);

    const rect = span.getBoundingClientRect();
    this.options.charWidth = rect.width;
    this.options.lineHeight = parseFloat(style.lineHeight) || rect.height;

    document.body.removeChild(span);
  }

  protected onMount(): void {
    // Subscribe to presence updates
    this.unsubscribe = presenceStore.subscribe(() => {
      this.updateCursors();
    });

    // Initial render
    this.updateCursors();
  }

  protected onUnmount(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    // Clean up cursor elements
    this.cursors.forEach(el => el.remove());
    this.cursors.clear();
  }

  /**
   * Update cursor display based on current presence state
   */
  private updateCursors(): void {
    const usersWithColors = presenceStore.getOtherUsersWithColors();

    // Filter to users in the current file
    const usersInFile = this.options.filePath
      ? usersWithColors.filter(u => u.selection?.filePath === this.options.filePath)
      : usersWithColors;

    // Track which user IDs are still present
    const presentUserIds = new Set(usersInFile.map(u => u.userId));

    // Remove cursors for users who left
    this.cursors.forEach((el, userId) => {
      if (!presentUserIds.has(userId)) {
        el.remove();
        this.cursors.delete(userId);
      }
    });

    // Add or update cursors for present users
    for (const user of usersInFile) {
      this.updateCursor(user);
    }
  }

  /**
   * Update a single user's cursor
   */
  private updateCursor(user: CursorData): void {
    let cursorEl = this.cursors.get(user.userId);

    if (!cursorEl) {
      // Create new cursor element
      cursorEl = this.createCursorElement(user);
      this.element.appendChild(cursorEl);
      this.cursors.set(user.userId, cursorEl);
    }

    // Update position
    this.positionCursor(cursorEl, user);

    // Update label
    const label = cursorEl.querySelector('.collab-cursor-label');
    if (label) {
      label.textContent = user.displayName;
    }
  }

  /**
   * Create a cursor element for a user
   */
  private createCursorElement(user: CursorData): HTMLElement {
    const cursor = document.createElement('div');
    cursor.className = 'collab-cursor';
    cursor.dataset.userId = user.userId;

    // Cursor line (the actual cursor indicator)
    const line = document.createElement('div');
    line.className = 'collab-cursor-line';
    line.style.backgroundColor = user.color;
    cursor.appendChild(line);

    // User label
    const label = document.createElement('div');
    label.className = 'collab-cursor-label';
    label.style.backgroundColor = user.color;
    label.textContent = user.displayName;
    cursor.appendChild(label);

    // Selection highlight (if user has a selection)
    const selection = document.createElement('div');
    selection.className = 'collab-cursor-selection';
    selection.style.backgroundColor = user.color;
    cursor.appendChild(selection);

    return cursor;
  }

  /**
   * Position a cursor element based on user's cursor position
   */
  private positionCursor(cursorEl: HTMLElement, user: CursorData): void {
    const editor = this.options.editorElement;
    const lineHeight = this.options.lineHeight || 20;
    const charWidth = this.options.charWidth || 8;

    if (!editor) {
      cursorEl.style.display = 'none';
      return;
    }

    const line = user.selection?.startLine ?? user.cursorY ?? 0;
    const col = user.selection?.startCol ?? user.cursorX ?? 0;

    // Calculate position relative to the editor
    const editorRect = editor.getBoundingClientRect();
    const scrollTop = editor.scrollTop;
    const scrollLeft = editor.scrollLeft;

    // Account for padding
    const paddingTop = parseFloat(window.getComputedStyle(editor).paddingTop) || 0;
    const paddingLeft = parseFloat(window.getComputedStyle(editor).paddingLeft) || 0;

    const x = (col * charWidth) - scrollLeft + paddingLeft;
    const y = (line * lineHeight) - scrollTop + paddingTop;

    // Hide if cursor is outside visible area
    if (y < 0 || y > editorRect.height || x < 0 || x > editorRect.width) {
      cursorEl.style.opacity = '0';
    } else {
      cursorEl.style.opacity = '1';
    }

    cursorEl.style.transform = `translate(${x}px, ${y}px)`;

    // Update selection highlight if there's a selection
    const selectionEl = cursorEl.querySelector('.collab-cursor-selection') as HTMLElement;
    if (selectionEl && user.selection) {
      const startLine = user.selection.startLine ?? line;
      const endLine = user.selection.endLine ?? line;
      const startCol = user.selection.startCol ?? col;
      const endCol = user.selection.endCol ?? col;

      if (startLine === endLine && startCol !== endCol) {
        // Single line selection
        const width = Math.abs(endCol - startCol) * charWidth;
        selectionEl.style.width = `${width}px`;
        selectionEl.style.height = `${lineHeight}px`;
        selectionEl.style.display = 'block';
      } else if (startLine !== endLine) {
        // Multi-line selection (simplified: just show a highlight bar)
        const height = (endLine - startLine + 1) * lineHeight;
        selectionEl.style.width = '100%';
        selectionEl.style.height = `${height}px`;
        selectionEl.style.display = 'block';
      } else {
        selectionEl.style.display = 'none';
      }
    } else if (selectionEl) {
      selectionEl.style.display = 'none';
    }
  }

  /**
   * Update all cursor positions (called on scroll/resize)
   */
  private updateCursorPositions(): void {
    const usersWithColors = presenceStore.getOtherUsersWithColors();

    for (const user of usersWithColors) {
      const cursorEl = this.cursors.get(user.userId);
      if (cursorEl) {
        this.positionCursor(cursorEl, user);
      }
    }
  }

  render(): this {
    this.setHTML('');
    return this;
  }
}
