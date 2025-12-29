/**
 * Debug Store
 * Captures and stores console output for the debug panel
 */

import { Store, persist } from '../lib/store';

export type LogLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
  timestamp: Date;
  category?: string;
  // Note: We intentionally don't store the original args to avoid memory leaks
  // from holding references to potentially large objects
}

export interface DebugState {
  entries: LogEntry[];
  isOpen: boolean;
  filter: LogLevel | 'all';
  searchQuery: string;
  maxEntries: number;
  isCapturing: boolean;
  verboseMode: boolean;
}

// Store original console methods at module load time.
// This captures the native console methods before any other code might wrap them.
// The actual interception doesn't happen until initialize() is called,
// so any console calls before that use the original unintercepted methods.
const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
};

class DebugStore extends Store<DebugState> {
  private entryCounter = 0;

  constructor() {
    super({
      entries: [],
      isOpen: false,
      filter: 'all',
      searchQuery: '',
      maxEntries: 1000,
      isCapturing: false,
      verboseMode: false,
    });
  }

  /**
   * Initialize console interception
   */
  initialize(): void {
    if (this.getState().isCapturing) return;

    this.interceptConsole();
    this.setState({ isCapturing: true });
  }

  /**
   * Stop console interception and restore original methods
   */
  destroy(): void {
    this.restoreConsole();
    this.setState({ isCapturing: false });
  }

  /**
   * Intercept console methods
   */
  private interceptConsole(): void {
    const levels: LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

    for (const level of levels) {
      console[level] = (...args: unknown[]) => {
        // Call original method
        originalConsole[level](...args);

        // Capture the log entry
        this.addEntry(level, args);
      };
    }
  }

  /**
   * Restore original console methods
   */
  private restoreConsole(): void {
    console.log = originalConsole.log;
    console.info = originalConsole.info;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
    console.debug = originalConsole.debug;
  }

  /**
   * Add a log entry
   */
  private addEntry(level: LogLevel, args: unknown[]): void {
    const { entries, maxEntries } = this.getState();

    // Parse category from message if it follows [Category] pattern
    let category: string | undefined;
    let message = this.formatArgs(args);

    const categoryMatch = message.match(/^\[([^\]]+)\]\s*/);
    if (categoryMatch) {
      category = categoryMatch[1];
      message = message.slice(categoryMatch[0].length);
    }

    const entry: LogEntry = {
      id: `log-${++this.entryCounter}`,
      level,
      message,
      timestamp: new Date(),
      category,
    };

    // Limit entries to maxEntries
    const newEntries = [...entries, entry];
    if (newEntries.length > maxEntries) {
      newEntries.splice(0, newEntries.length - maxEntries);
    }

    this.setState({ entries: newEntries });
  }

  /**
   * Format console arguments to a string
   */
  private formatArgs(args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === 'string') return arg;
        if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
        try {
          return JSON.stringify(arg, null, 2);
        } catch {
          return String(arg);
        }
      })
      .join(' ');
  }

  /**
   * Toggle the debug panel
   */
  toggle(): void {
    this.setState({ isOpen: !this.getState().isOpen });
  }

  /**
   * Open the debug panel
   */
  open(): void {
    this.setState({ isOpen: true });
  }

  /**
   * Close the debug panel
   */
  close(): void {
    this.setState({ isOpen: false });
  }

  /**
   * Set the log level filter
   */
  setFilter(filter: LogLevel | 'all'): void {
    this.setState({ filter });
  }

  /**
   * Set the search query
   */
  setSearchQuery(query: string): void {
    this.setState({ searchQuery: query });
  }

  /**
   * Clear all log entries
   */
  clear(): void {
    this.setState({ entries: [] });
  }

  /**
   * Get filtered entries
   */
  getFilteredEntries(): LogEntry[] {
    const { entries, filter, searchQuery } = this.getState();

    return entries.filter((entry) => {
      // Apply level filter
      if (filter !== 'all' && entry.level !== filter) {
        return false;
      }

      // Apply search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesMessage = entry.message.toLowerCase().includes(query);
        const matchesCategory = entry.category?.toLowerCase().includes(query);
        return matchesMessage || matchesCategory;
      }

      return true;
    });
  }

  /**
   * Get unique categories from entries
   */
  getCategories(): string[] {
    const { entries } = this.getState();
    const categories = new Set<string>();

    for (const entry of entries) {
      if (entry.category) {
        categories.add(entry.category);
      }
    }

    return Array.from(categories).sort();
  }

  /**
   * Get entry counts by level
   */
  getCounts(): Record<LogLevel | 'all', number> {
    const { entries } = this.getState();

    const counts: Record<LogLevel | 'all', number> = {
      all: entries.length,
      log: 0,
      info: 0,
      warn: 0,
      error: 0,
      debug: 0,
    };

    for (const entry of entries) {
      counts[entry.level]++;
    }

    return counts;
  }

  /**
   * Copy all filtered entries to clipboard
   */
  async copyToClipboard(): Promise<boolean> {
    const entries = this.getFilteredEntries();
    const text = entries
      .map((entry) => {
        const time = entry.timestamp.toLocaleTimeString();
        const category = entry.category ? `[${entry.category}] ` : '';
        return `[${time}] [${entry.level.toUpperCase()}] ${category}${entry.message}`;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Toggle verbose mode
   */
  toggleVerboseMode(): void {
    const newValue = !this.getState().verboseMode;
    this.setState({ verboseMode: newValue });
    if (newValue) {
      console.info('[DEBUG] Verbose mode enabled - showing maximum detail');
    } else {
      console.info('[DEBUG] Verbose mode disabled');
    }
  }

  /**
   * Set verbose mode
   */
  setVerboseMode(enabled: boolean): void {
    this.setState({ verboseMode: enabled });
    if (enabled) {
      console.info('[DEBUG] Verbose mode enabled - showing maximum detail');
    }
  }

  /**
   * Check if verbose mode is enabled
   */
  isVerbose(): boolean {
    return this.getState().verboseMode;
  }

  /**
   * Log a verbose message (only when verbose mode is enabled)
   */
  verbose(message: string, data?: unknown): void {
    if (!this.getState().verboseMode) return;
    if (data !== undefined) {
      console.debug(`[VERBOSE] ${message}`, data);
    } else {
      console.debug(`[VERBOSE] ${message}`);
    }
  }
}

// Export singleton instance
export const debugStore = new DebugStore();

// Persist open state and verbose mode
persist(debugStore, 'debug-panel-state', { include: ['isOpen', 'filter', 'verboseMode'] });
