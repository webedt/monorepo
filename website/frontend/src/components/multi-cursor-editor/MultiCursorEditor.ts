/**
 * Multi-Cursor Code Editor Component
 *
 * A CodeMirror 6-based code editor with full multi-cursor support.
 *
 * Multi-cursor keyboard shortcuts:
 * - Alt+Click: Add cursor at click position
 * - Ctrl/Cmd+D: Select next occurrence of selection
 * - Ctrl/Cmd+Shift+L: Select all occurrences
 * - Ctrl/Cmd+Alt+Up/Down: Add cursor above/below
 * - Escape: Collapse to single cursor
 */

import { Component } from '../base';
import { EditorState, Compartment, EditorSelection } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, highlightActiveLineGutter, lineNumbers, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo, undoDepth, redoDepth } from '@codemirror/commands';
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching, indentOnInput, foldGutter, foldKeymap } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';

import type { Extension } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import type { LanguageSupport } from '@codemirror/language';

/**
 * Serialized editor state for saving/restoring per-tab history
 */
export interface EditorStateSnapshot {
  content: string;
  selection: { anchor: number; head: number }[];
  scrollTop: number;
  scrollLeft: number;
}

export interface MultiCursorEditorOptions {
  content?: string;
  language?: string;
  readOnly?: boolean;
  lineNumbers?: boolean;
  onChange?: (content: string) => void;
  onSave?: (content: string) => void;
}

interface CursorPosition {
  line: number;
  column: number;
}

export class MultiCursorEditor extends Component<HTMLDivElement> {
  private view: EditorView | null = null;
  private options: MultiCursorEditorOptions;
  private languageCompartment: Compartment;
  private readOnlyCompartment: Compartment;
  private themeCompartment: Compartment;

  constructor(options: MultiCursorEditorOptions = {}) {
    super('div', { className: 'multi-cursor-editor' });
    this.options = {
      content: '',
      language: 'text',
      readOnly: false,
      lineNumbers: true,
      ...options,
    };
    this.languageCompartment = new Compartment();
    this.readOnlyCompartment = new Compartment();
    this.themeCompartment = new Compartment();
  }

  protected onMount(): void {
    this.initializeEditor();
  }

  protected onUnmount(): void {
    if (this.view) {
      this.view.destroy();
      this.view = null;
    }
  }

  private initializeEditor(): void {
    const customTheme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px',
        backgroundColor: 'var(--color-bg-primary)',
      },
      '.cm-content': {
        fontFamily: 'var(--font-mono)',
        padding: 'var(--spacing-md)',
        caretColor: 'var(--color-primary)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-primary)',
        borderLeftWidth: '2px',
      },
      '.cm-cursor.cm-cursor-secondary': {
        borderLeftColor: 'var(--color-secondary, #888)',
        borderLeftWidth: '2px',
        borderLeftStyle: 'solid',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'var(--color-selection, rgba(66, 133, 244, 0.3)) !important',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--color-selection, rgba(66, 133, 244, 0.3)) !important',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--color-bg-secondary)',
        borderRight: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 16px',
        minWidth: '40px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--color-bg-hover)',
        color: 'var(--color-text-primary)',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--color-bg-hover, rgba(0, 0, 0, 0.05))',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'var(--color-bracket-match, rgba(66, 133, 244, 0.2))',
        outline: '1px solid var(--color-primary, #4285f4)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'var(--color-search-match, rgba(255, 213, 0, 0.4))',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'var(--color-search-match-selected, rgba(255, 165, 0, 0.6))',
      },
      '.cm-foldGutter': {
        width: '12px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.6',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
      },
      '.cm-panel.cm-search': {
        padding: 'var(--spacing-sm)',
      },
      '.cm-panel.cm-search input': {
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 8px',
      },
      '.cm-panel.cm-search button': {
        backgroundColor: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 8px',
        cursor: 'pointer',
      },
      '.cm-panel.cm-search button:hover': {
        backgroundColor: 'var(--color-bg-hover)',
      },
    }, { dark: false });

    // Custom keybindings for multi-cursor operations
    const multiCursorKeymap: KeyBinding[] = [
      // Ctrl/Cmd+D: Select next occurrence
      {
        key: 'Mod-d',
        run: selectNextOccurrence,
        preventDefault: true,
      },
      // Ctrl/Cmd+Shift+L: Select all occurrences
      {
        key: 'Mod-Shift-l',
        run: selectSelectionMatches,
        preventDefault: true,
      },
      // Ctrl/Cmd+S: Save
      {
        key: 'Mod-s',
        run: () => {
          if (this.options.onSave) {
            this.options.onSave(this.getContent());
          }
          return true;
        },
        preventDefault: true,
      },
    ];

    const extensions: Extension[] = [
      // Basic editor features
      this.options.lineNumbers ? lineNumbers() : [],
      this.options.lineNumbers ? highlightActiveLineGutter() : [],
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),

      // Keymaps
      keymap.of([
        ...multiCursorKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),

      // Language support (configurable)
      this.languageCompartment.of(this.getLanguageExtension(this.options.language || 'text')),

      // Read-only mode (configurable)
      this.readOnlyCompartment.of(EditorState.readOnly.of(this.options.readOnly || false)),

      // Theme
      this.themeCompartment.of([customTheme, syntaxHighlighting(defaultHighlightStyle)]),

      // Update listener
      EditorView.updateListener.of((update) => {
        if (update.docChanged && this.options.onChange) {
          const content = update.state.doc.toString();
          this.options.onChange(content);
        }
      }),
    ];

    const state = EditorState.create({
      doc: this.options.content || '',
      extensions: extensions.flat(),
    });

    this.view = new EditorView({
      state,
      parent: this.element,
    });
  }

  /**
   * Get the appropriate language extension based on file extension or language name
   */
  private getLanguageExtension(lang: string): LanguageSupport | Extension {
    const langLower = lang.toLowerCase();

    // Map file extensions and language names to CodeMirror language support
    switch (langLower) {
      case 'js':
      case 'javascript':
      case 'jsx':
        return javascript({ jsx: true });
      case 'ts':
      case 'typescript':
      case 'tsx':
        return javascript({ jsx: true, typescript: true });
      case 'py':
      case 'python':
        return python();
      case 'json':
        return json();
      case 'css':
      case 'scss':
      case 'less':
        return css();
      case 'html':
      case 'htm':
      case 'xml':
        return html();
      case 'md':
      case 'markdown':
        return markdown();
      default:
        return [];
    }
  }

  /**
   * Get the current editor content
   */
  getContent(): string {
    if (!this.view) return this.options.content || '';
    return this.view.state.doc.toString();
  }

  /**
   * Set the editor content (adds to undo history)
   */
  setContent(content: string): void {
    if (!this.view) {
      this.options.content = content;
      return;
    }

    const currentContent = this.view.state.doc.toString();
    if (content === currentContent) return;

    this.view.dispatch({
      changes: {
        from: 0,
        to: this.view.state.doc.length,
        insert: content,
      },
    });
  }

  /**
   * Load content without adding to undo history (for tab switches)
   * This creates a fresh editor state, so undo history is reset
   */
  loadContent(content: string, language?: string): void {
    if (!this.view) {
      this.options.content = content;
      if (language) this.options.language = language;
      return;
    }

    // Create a fresh state with the content, resetting history
    // This ensures each tab has its own independent undo/redo history
    this.view.setState(this.createStateWithContent(content, language || this.options.language || 'text'));
  }

  /**
   * Create a fresh editor state with content
   */
  private createStateWithContent(content: string, language: string): EditorState {
    const customTheme = EditorView.theme({
      '&': {
        height: '100%',
        fontSize: '13px',
        backgroundColor: 'var(--color-bg-primary)',
      },
      '.cm-content': {
        fontFamily: 'var(--font-mono)',
        padding: 'var(--spacing-md)',
        caretColor: 'var(--color-primary)',
      },
      '.cm-cursor': {
        borderLeftColor: 'var(--color-primary)',
        borderLeftWidth: '2px',
      },
      '.cm-cursor.cm-cursor-secondary': {
        borderLeftColor: 'var(--color-secondary, #888)',
        borderLeftWidth: '2px',
        borderLeftStyle: 'solid',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'var(--color-selection, rgba(66, 133, 244, 0.3)) !important',
      },
      '&.cm-focused .cm-selectionBackground': {
        backgroundColor: 'var(--color-selection, rgba(66, 133, 244, 0.3)) !important',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--color-bg-secondary)',
        borderRight: '1px solid var(--color-border)',
        color: 'var(--color-text-muted)',
      },
      '.cm-lineNumbers .cm-gutterElement': {
        padding: '0 8px 0 16px',
        minWidth: '40px',
      },
      '.cm-activeLineGutter': {
        backgroundColor: 'var(--color-bg-hover)',
        color: 'var(--color-text-primary)',
      },
      '.cm-activeLine': {
        backgroundColor: 'var(--color-bg-hover, rgba(0, 0, 0, 0.05))',
      },
      '.cm-matchingBracket': {
        backgroundColor: 'var(--color-bracket-match, rgba(66, 133, 244, 0.2))',
        outline: '1px solid var(--color-primary, #4285f4)',
      },
      '.cm-searchMatch': {
        backgroundColor: 'var(--color-search-match, rgba(255, 213, 0, 0.4))',
      },
      '.cm-searchMatch.cm-searchMatch-selected': {
        backgroundColor: 'var(--color-search-match-selected, rgba(255, 165, 0, 0.6))',
      },
      '.cm-foldGutter': {
        width: '12px',
      },
      '.cm-scroller': {
        overflow: 'auto',
        fontFamily: 'var(--font-mono)',
        lineHeight: '1.6',
      },
      '.cm-tooltip': {
        backgroundColor: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--color-bg-secondary)',
        borderBottom: '1px solid var(--color-border)',
      },
      '.cm-panel.cm-search': {
        padding: 'var(--spacing-sm)',
      },
      '.cm-panel.cm-search input': {
        backgroundColor: 'var(--color-bg-primary)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 8px',
      },
      '.cm-panel.cm-search button': {
        backgroundColor: 'var(--color-bg-tertiary)',
        color: 'var(--color-text-primary)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 8px',
        cursor: 'pointer',
      },
      '.cm-panel.cm-search button:hover': {
        backgroundColor: 'var(--color-bg-hover)',
      },
    }, { dark: false });

    const multiCursorKeymap: KeyBinding[] = [
      {
        key: 'Mod-d',
        run: selectNextOccurrence,
        preventDefault: true,
      },
      {
        key: 'Mod-Shift-l',
        run: selectSelectionMatches,
        preventDefault: true,
      },
      {
        key: 'Mod-s',
        run: () => {
          if (this.options.onSave) {
            this.options.onSave(this.getContent());
          }
          return true;
        },
        preventDefault: true,
      },
    ];

    const extensions: Extension[] = [
      this.options.lineNumbers ? lineNumbers() : [],
      this.options.lineNumbers ? highlightActiveLineGutter() : [],
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...multiCursorKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
      ]),
      this.languageCompartment.of(this.getLanguageExtension(language)),
      this.readOnlyCompartment.of(EditorState.readOnly.of(this.options.readOnly || false)),
      this.themeCompartment.of([customTheme, syntaxHighlighting(defaultHighlightStyle)]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged && this.options.onChange) {
          this.options.onChange(update.state.doc.toString());
        }
      }),
    ];

    return EditorState.create({
      doc: content,
      extensions: extensions.flat(),
    });
  }

  /**
   * Set the programming language for syntax highlighting
   */
  setLanguage(language: string): void {
    if (!this.view) {
      this.options.language = language;
      return;
    }

    this.view.dispatch({
      effects: this.languageCompartment.reconfigure(this.getLanguageExtension(language)),
    });
  }

  /**
   * Set read-only mode
   */
  setReadOnly(readOnly: boolean): void {
    if (!this.view) {
      this.options.readOnly = readOnly;
      return;
    }

    this.view.dispatch({
      effects: this.readOnlyCompartment.reconfigure(EditorState.readOnly.of(readOnly)),
    });
  }

  /**
   * Get the current cursor position (primary selection)
   */
  getCursorPosition(): number {
    if (!this.view) return 0;
    return this.view.state.selection.main.head;
  }

  /**
   * Set cursor position
   */
  setCursorPosition(position: number): void {
    if (!this.view) return;

    const clampedPos = Math.max(0, Math.min(position, this.view.state.doc.length));
    this.view.dispatch({
      selection: { anchor: clampedPos },
    });
  }

  /**
   * Get all cursor positions (for multi-cursor)
   */
  getAllCursorPositions(): number[] {
    if (!this.view) return [];
    return this.view.state.selection.ranges.map(r => r.head);
  }

  /**
   * Get the number of cursors
   */
  getCursorCount(): number {
    if (!this.view) return 0;
    return this.view.state.selection.ranges.length;
  }

  /**
   * Add a cursor at a specific position
   */
  addCursorAt(position: number): void {
    if (!this.view) return;

    const clampedPos = Math.max(0, Math.min(position, this.view.state.doc.length));
    const currentRanges = this.view.state.selection.ranges;
    const newCursor = EditorSelection.cursor(clampedPos);

    this.view.dispatch({
      selection: EditorSelection.create([...currentRanges, newCursor]),
    });
  }

  /**
   * Focus the editor
   */
  focus(): this {
    if (this.view) {
      this.view.focus();
    }
    return this;
  }

  /**
   * Check if editor is focused
   */
  isFocused(): boolean {
    return this.view?.hasFocus ?? false;
  }

  /**
   * Undo the last change
   */
  undoChange(): boolean {
    if (!this.view) return false;
    return undo(this.view);
  }

  /**
   * Redo the last undone change
   */
  redoChange(): boolean {
    if (!this.view) return false;
    return redo(this.view);
  }

  /**
   * Check if undo is available
   */
  canUndo(): boolean {
    if (!this.view) return false;
    return undoDepth(this.view.state) > 0;
  }

  /**
   * Check if redo is available
   */
  canRedo(): boolean {
    if (!this.view) return false;
    return redoDepth(this.view.state) > 0;
  }

  /**
   * Select text in the editor
   */
  setSelection(from: number, to: number): void {
    if (!this.view) return;

    const docLength = this.view.state.doc.length;
    const clampedFrom = Math.max(0, Math.min(from, docLength));
    const clampedTo = Math.max(0, Math.min(to, docLength));

    this.view.dispatch({
      selection: { anchor: clampedFrom, head: clampedTo },
    });
  }

  /**
   * Get the currently selected text
   */
  getSelectedText(): string {
    if (!this.view) return '';
    const { from, to } = this.view.state.selection.main;
    return this.view.state.doc.sliceString(from, to);
  }

  /**
   * Insert text at cursor position
   */
  insertText(text: string): void {
    if (!this.view) return;

    const { from, to } = this.view.state.selection.main;
    this.view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
    });
  }

  /**
   * Scroll to a specific line
   */
  scrollToLine(line: number): void {
    if (!this.view) return;

    const lineInfo = this.view.state.doc.line(Math.max(1, Math.min(line, this.view.state.doc.lines)));
    this.view.dispatch({
      effects: EditorView.scrollIntoView(lineInfo.from, { y: 'center' }),
    });
  }

  /**
   * Get line and column from position
   */
  getLineAndColumn(position: number): CursorPosition {
    if (!this.view) return { line: 1, column: 1 };

    const line = this.view.state.doc.lineAt(position);
    return {
      line: line.number,
      column: position - line.from + 1,
    };
  }

  /**
   * Get position from line and column
   */
  getPositionFromLineColumn(line: number, column: number): number {
    if (!this.view) return 0;

    const lineInfo = this.view.state.doc.line(Math.max(1, Math.min(line, this.view.state.doc.lines)));
    return lineInfo.from + Math.max(0, column - 1);
  }

  /**
   * Get the total number of lines
   */
  getLineCount(): number {
    if (!this.view) return 0;
    return this.view.state.doc.lines;
  }

  /**
   * Get content of a specific line
   */
  getLine(lineNumber: number): string {
    if (!this.view) return '';

    if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
      return '';
    }
    return this.view.state.doc.line(lineNumber).text;
  }
}
