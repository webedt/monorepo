import { Component } from '../base';
import { debugStore } from '../../stores/debugStore';
import type { LogLevel, LogEntry } from '../../stores/debugStore';
import './debug-output.css';

export interface DebugOutputPanelOptions {
  position?: 'bottom' | 'right';
  defaultHeight?: number;
  defaultWidth?: number;
}

const LOG_LEVEL_ICONS: Record<LogLevel, string> = {
  log: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  info: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  warn: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  error: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
  debug: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>`,
};

export class DebugOutputPanel extends Component<HTMLDivElement> {
  private options: Required<DebugOutputPanelOptions>;
  private unsubscribe?: () => void;
  private entriesContainer?: HTMLDivElement;
  private countElements: Map<LogLevel | 'all', HTMLSpanElement> = new Map();
  private isResizing = false;
  private startY = 0;
  private startHeight = 0;
  // Track state for granular change detection
  private lastEntriesLength = 0;
  private lastFilter: LogLevel | 'all' = 'all';
  private lastSearchQuery = '';
  private lastIsOpen = false;

  constructor(options: DebugOutputPanelOptions = {}) {
    super('div', { className: 'debug-output-panel' });

    this.options = {
      position: options.position ?? 'bottom',
      defaultHeight: options.defaultHeight ?? 250,
      defaultWidth: options.defaultWidth ?? 400,
    };

    this.addClass(`debug-output-panel--${this.options.position}`);
    this.buildContent();
  }

  private buildContent(): void {
    // Header
    const header = document.createElement('div');
    header.className = 'debug-output-header';

    // Resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'debug-output-resize-handle';
    resizeHandle.addEventListener('mousedown', (e) => this.startResize(e));
    header.appendChild(resizeHandle);

    // Title
    const title = document.createElement('div');
    title.className = 'debug-output-title';
    title.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
      </svg>
      <span>Console</span>
    `;
    header.appendChild(title);

    // Filter tabs
    const filters = document.createElement('div');
    filters.className = 'debug-output-filters';

    const levels: (LogLevel | 'all')[] = ['all', 'log', 'info', 'warn', 'error', 'debug'];
    for (const level of levels) {
      const filterBtn = document.createElement('button');
      filterBtn.type = 'button';
      filterBtn.className = `debug-output-filter ${level === 'all' ? 'active' : ''}`;
      filterBtn.dataset.level = level;

      const label = document.createElement('span');
      label.textContent = level === 'all' ? 'All' : level.charAt(0).toUpperCase() + level.slice(1);

      const count = document.createElement('span');
      count.className = 'debug-output-count';
      count.textContent = '0';
      this.countElements.set(level, count);

      filterBtn.appendChild(label);
      filterBtn.appendChild(count);

      filterBtn.addEventListener('click', () => {
        debugStore.setFilter(level);
        filters.querySelectorAll('.debug-output-filter').forEach((el) => el.classList.remove('active'));
        filterBtn.classList.add('active');
        this.renderEntries();
      });

      filters.appendChild(filterBtn);
    }
    header.appendChild(filters);

    // Search
    const searchContainer = document.createElement('div');
    searchContainer.className = 'debug-output-search';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Filter...';
    searchInput.className = 'debug-output-search-input';
    searchInput.addEventListener('input', (e) => {
      debugStore.setSearchQuery((e.target as HTMLInputElement).value);
      this.renderEntries();
    });
    searchContainer.appendChild(searchInput);
    header.appendChild(searchContainer);

    // Actions
    const actions = document.createElement('div');
    actions.className = 'debug-output-actions';

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'debug-output-action';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.addEventListener('click', async () => {
      const success = await debugStore.copyToClipboard();
      if (success) {
        copyBtn.classList.add('success');
        setTimeout(() => copyBtn.classList.remove('success'), 1000);
      }
    });
    actions.appendChild(copyBtn);

    // Clear button
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'debug-output-action';
    clearBtn.title = 'Clear console';
    clearBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`;
    clearBtn.addEventListener('click', () => {
      debugStore.clear();
      this.renderEntries();
      this.updateCounts();
    });
    actions.appendChild(clearBtn);

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'debug-output-action debug-output-close';
    closeBtn.title = 'Close';
    closeBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    closeBtn.addEventListener('click', () => debugStore.close());
    actions.appendChild(closeBtn);

    header.appendChild(actions);
    this.element.appendChild(header);

    // Entries container
    this.entriesContainer = document.createElement('div');
    this.entriesContainer.className = 'debug-output-entries';
    this.element.appendChild(this.entriesContainer);

    // Set initial height
    this.element.style.height = `${this.options.defaultHeight}px`;
  }

  private startResize(e: MouseEvent): void {
    e.preventDefault();
    this.isResizing = true;
    this.startY = e.clientY;
    this.startHeight = this.element.offsetHeight;

    this.element.classList.add('resizing');

    const onMouseMove = (e: MouseEvent) => {
      if (!this.isResizing) return;
      const delta = this.startY - e.clientY;
      const newHeight = Math.max(100, Math.min(window.innerHeight * 0.8, this.startHeight + delta));
      this.element.style.height = `${newHeight}px`;
    };

    const onMouseUp = () => {
      this.isResizing = false;
      this.element.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  private renderEntries(forceFullRender = false): void {
    if (!this.entriesContainer) return;

    const entries = debugStore.getFilteredEntries();
    const state = debugStore.getState();

    // Check if we need a full re-render (filter/search changed or cleared)
    const filterChanged = state.filter !== this.lastFilter;
    const searchChanged = state.searchQuery !== this.lastSearchQuery;
    const needsFullRender = forceFullRender || filterChanged || searchChanged || entries.length < this.lastEntriesLength;

    // Update tracking state
    this.lastFilter = state.filter;
    this.lastSearchQuery = state.searchQuery;
    this.lastEntriesLength = entries.length;

    if (needsFullRender) {
      // Full re-render
      this.entriesContainer.innerHTML = '';

      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'debug-output-empty';
        empty.textContent = 'No console output';
        this.entriesContainer.appendChild(empty);
        return;
      }

      for (const entry of entries) {
        const entryEl = this.createEntryElement(entry);
        this.entriesContainer.appendChild(entryEl);
      }
    } else if (entries.length > 0) {
      // Remove empty message if present
      const emptyEl = this.entriesContainer.querySelector('.debug-output-empty');
      if (emptyEl) {
        emptyEl.remove();
      }

      // Incremental append - only add new entries
      const existingCount = this.entriesContainer.children.length;
      const newEntries = entries.slice(existingCount);

      for (const entry of newEntries) {
        const entryEl = this.createEntryElement(entry);
        this.entriesContainer.appendChild(entryEl);
      }
    }

    // Scroll to bottom only if there are entries
    if (entries.length > 0) {
      this.entriesContainer.scrollTop = this.entriesContainer.scrollHeight;
    }
  }

  private createEntryElement(entry: LogEntry): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `debug-output-entry debug-output-entry--${entry.level}`;

    // Timestamp
    const time = document.createElement('span');
    time.className = 'debug-output-time';
    time.textContent = entry.timestamp.toLocaleTimeString();
    el.appendChild(time);

    // Level icon
    const icon = document.createElement('span');
    icon.className = 'debug-output-icon';
    icon.innerHTML = LOG_LEVEL_ICONS[entry.level];
    el.appendChild(icon);

    // Category badge (if present)
    if (entry.category) {
      const category = document.createElement('span');
      category.className = 'debug-output-category';
      category.textContent = entry.category;
      el.appendChild(category);
    }

    // Message
    const message = document.createElement('span');
    message.className = 'debug-output-message';
    message.textContent = entry.message;
    el.appendChild(message);

    return el;
  }

  private updateCounts(): void {
    const counts = debugStore.getCounts();

    for (const [level, element] of this.countElements) {
      element.textContent = String(counts[level]);
    }
  }

  protected onMount(): void {
    // Subscribe to store changes with granular change detection
    this.unsubscribe = debugStore.subscribe(() => {
      const state = debugStore.getState();

      // Handle visibility changes
      const visibilityChanged = state.isOpen !== this.lastIsOpen;
      this.lastIsOpen = state.isOpen;

      if (visibilityChanged) {
        if (state.isOpen) {
          this.show();
          // Force full render when opening to ensure correct state
          this.renderEntries(true);
        } else {
          this.hide();
          return; // Skip updates when hidden
        }
      }

      // Only update when panel is visible
      if (state.isOpen) {
        // Update counts (cheap operation)
        this.updateCounts();

        // Render entries (uses incremental updates when possible)
        if (!visibilityChanged) {
          this.renderEntries();
        }
      }
    });

    // Initial render
    const state = debugStore.getState();
    this.lastIsOpen = state.isOpen;
    this.lastFilter = state.filter;
    this.lastSearchQuery = state.searchQuery;

    if (state.isOpen) {
      this.show();
      this.renderEntries(true);
    } else {
      this.hide();
    }
    this.updateCounts();
  }

  protected onUnmount(): void {
    this.unsubscribe?.();
  }
}
