/**
 * Chat Page
 * Main chat interface for agent sessions
 */

import { Page, type PageOptions } from '../base/Page';
import { Spinner, toast, ToolDetails, type ToolResult, type ToolUseBlock } from '../../components';
import { sessionsApi, userApi, createSessionExecuteEventSource } from '../../lib/api';
import { highlightCode, getLanguageDisplayName } from '../../lib/highlight';
import { authStore } from '../../stores/authStore';
import { workerStore } from '../../stores/workerStore';
import type { Session, VerbosityLevel, SessionStatus } from '../../types';
import './chat.css';

// View mode determines the level of detail shown
type ViewMode = 'normal' | 'detailed';

interface ChatMessage {
  id: string;
  type: string; // Event type from raw JSON (e.g., 'user', 'assistant', 'message', 'tool_use', 'error')
  content: string;
  timestamp: Date;
  model?: string;
  // For tool_use messages
  toolUse?: ToolUseBlock;
  toolResult?: ToolResult;
  // For thinking messages - stores full content when truncated
  fullContent?: string;
}

interface RawEvent {
  id: string;
  type: string;
  timestamp: Date;
  data: any;
}

// Event type emoji mapping
const EVENT_EMOJIS: Record<string, string> = {
  connected: '🔌',
  message: '💬',
  title_generation: '✨',
  session_created: '🎉',
  'session-created': '🎉',
  session_name: '📝',
  env_manager_log: '🔧',
  system: '⚙️',
  user: '👤',
  user_message: '👤',
  input_preview: '👤',
  submission_preview: '📤',
  resuming: '🔄',
  assistant: '🤖',
  assistant_message: '🤖',
  tool_use: '🔨',
  tool_result: '📤',
  tool_progress: '⏳',
  result: '✅',
  completed: '🏁',
  error: '❌',
  heartbeat: '💓',
  thinking: '🧠',
};

// Default event filters (for detailed mode)
const DEFAULT_EVENT_FILTERS: Record<string, boolean> = {
  user: true,
  user_message: true,
  input_preview: true,
  submission_preview: true,
  resuming: false,
  assistant: true,
  assistant_message: true,
  tool_use: true,
  tool_result: false,
  message: true,
  system: false, // Internal system init messages
  error: true,
  connected: false,
  completed: true,
  session_name: true, // Show session name
  'session-created': true,
  session_created: true,
  title_generation: true, // Show title generation status
  result: true, // Show completion stats
  env_manager_log: false,
  heartbeat: false,
  thinking: true,
};

// Events shown in Normal Mode - high-level progress without micro-steps
// Normal mode provides a summarized view suitable for most users
const NORMAL_MODE_EVENTS: Set<string> = new Set([
  'user',           // User messages
  'user_message',   // User follow-up messages
  'input_preview',  // User input confirmation (shows what was submitted)
  'assistant',      // Assistant responses
  'assistant_message', // Assistant follow-up responses
  'error',          // Errors are always important
  'result',         // Final completion stats
  'completed',      // Session completed
  'session_created', // Session started
  'session-created', // Session started (alt format)
]);

interface ChatPageOptions extends PageOptions {
  params?: {
    sessionId?: string;
  };
}

export class ChatPage extends Page<ChatPageOptions> {
  readonly route = '/session/:sessionId/chat';
  readonly title = 'Chat';
  protected requiresAuth = true;

  private session: Session | null = null;
  private messages: ChatMessage[] = [];
  private rawEvents: RawEvent[] = [];
  private toolResultMap: Map<string, ToolResult> = new Map(); // Maps tool_use_id to tool_result
  private inputValue = '';
  private isLoading = true;
  private isSending = false;
  private eventSource: { close: () => void } | null = null;
  private messagesContainer: HTMLElement | null = null;
  private inputElement: HTMLTextAreaElement | null = null;
  private shownOptimisticUserMessage: string | null = null; // Track optimistic user message to avoid duplicates
  private attachedImages: Array<{ id: string; data: string; mediaType: string }> = []; // Images pasted from clipboard

  // View settings (persisted to localStorage)
  private viewMode: ViewMode = 'normal'; // Default to normal mode for most users
  private showRawJson = false;
  private showTimestamps = false;
  private widescreen = false;
  private eventFilters: Record<string, boolean> = { ...DEFAULT_EVENT_FILTERS };

  protected render(): string {
    return `
      <div class="chat-page">
        <header class="chat-header">
          <div class="chat-header-left">
            <button class="back-btn" data-action="back">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="chat-session-info">
              <h1 class="chat-title">Loading...</h1>
              <p class="chat-subtitle"></p>
            </div>
          </div>
          <div class="chat-header-right">
            <button class="header-btn" data-action="view-code" title="View Files">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            </button>
            <div class="chat-status"></div>
          </div>
        </header>

        <div class="chat-toolbar">
          <div class="toolbar-left">
            <div class="view-toggle">
              <button class="toggle-btn" data-view="normal" title="Normal View - Summarized progress">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                Normal
              </button>
              <button class="toggle-btn" data-view="detailed" title="Detailed View - All events and steps">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                Detailed
              </button>
              <button class="toggle-btn" data-view="raw" title="Raw JSON View">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>
                Raw
              </button>
            </div>
          </div>
          <div class="toolbar-right">
            <button class="toolbar-btn" data-action="toggle-timestamps" title="Toggle Timestamps">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            </button>
            <button class="toolbar-btn" data-action="toggle-widescreen" title="Toggle Widescreen">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
            </button>
            <div class="filter-dropdown">
              <button class="toolbar-btn" data-action="toggle-filters" title="Filter Events">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"></polygon></svg>
              </button>
              <div class="filter-menu" style="display: none;"></div>
            </div>
          </div>
        </div>

        <div class="chat-messages" id="chat-messages">
          <div class="chat-loading">
            <div class="spinner-container"></div>
          </div>
          <div class="messages-list" style="display: none;"></div>
          <div class="events-list" style="display: none;"></div>
          <div class="chat-empty" style="display: none;">
            <h3>No messages yet</h3>
            <p>Send a message to start the conversation</p>
          </div>
        </div>

        <div class="chat-input-container">
          <div class="image-preview-container" style="display: none;"></div>
          <div class="chat-input-wrapper">
            <textarea
              class="chat-input"
              placeholder="Type your message..."
              rows="1"
            ></textarea>
            <button class="send-btn" data-action="send" disabled>
              <svg class="send-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
              <svg class="stop-icon" viewBox="0 0 24 24" fill="currentColor" style="display: none;"><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg>
            </button>
          </div>
          <p class="chat-input-hint">Press Enter to send, Shift+Enter for new line. Paste images with Ctrl+V</p>
        </div>
      </div>
    `;
  }

  protected onMount(): void {
    super.onMount();

    // Load settings from localStorage
    this.loadSettings();

    // Setup back button
    const backBtn = this.$('[data-action="back"]') as HTMLButtonElement;
    if (backBtn) {
      backBtn.addEventListener('click', () => this.navigate('/agents'));
    }

    // Setup view code button
    const viewCodeBtn = this.$('[data-action="view-code"]') as HTMLButtonElement;
    if (viewCodeBtn) {
      viewCodeBtn.addEventListener('click', () => {
        const sessionId = this.options.params?.sessionId;
        if (sessionId) {
          this.navigate(`/session/${sessionId}/code`);
        }
      });
    }

    // Setup send button (handles both send and stop)
    const sendBtn = this.$('[data-action="send"]') as HTMLButtonElement;
    if (sendBtn) {
      sendBtn.addEventListener('click', () => {
        // Check if we should stop or send
        if (this.isSessionRunning() && !this.inputValue.trim()) {
          this.handleStop();
        } else {
          this.handleSend();
        }
      });
    }

    // Setup textarea
    this.inputElement = this.$('.chat-input') as HTMLTextAreaElement;
    if (this.inputElement) {
      this.inputElement.addEventListener('input', () => this.handleInputChange());
      this.inputElement.addEventListener('keydown', (e) => this.handleKeyDown(e));
      this.inputElement.addEventListener('paste', (e) => this.handlePaste(e));
    }

    // Get messages container
    this.messagesContainer = this.$('.messages-list') as HTMLElement;

    // Setup toolbar buttons
    this.setupToolbar();

    // Show loading spinner
    const spinnerContainer = this.$('.spinner-container') as HTMLElement;
    if (spinnerContainer) {
      const spinner = new Spinner({ size: 'lg' });
      spinner.mount(spinnerContainer);
    }

    // Load session data
    this.loadSession();
  }

  /**
   * Map user's verbosity preference to view mode
   * - 'verbose' -> 'detailed' (shows all events)
   * - 'normal' -> 'normal' (summarized view for regular users)
   * - 'minimal' -> 'normal' (also uses summarized view)
   */
  private verbosityToViewMode(verbosity: VerbosityLevel | undefined): ViewMode {
    if (verbosity === 'verbose') {
      return 'detailed';
    }
    // Both 'normal' and 'minimal' use normal (summarized) view
    return 'normal';
  }

  private loadSettings(): void {
    try {
      // Get user's stored preference from database (source of truth for verbosity)
      const user = authStore.getUser();
      const userVerbosity = user?.chatVerbosityLevel;

      // Migrate legacy 'chat_showRawJson' setting if present
      const legacyRawJson = localStorage.getItem('chat_showRawJson');
      if (legacyRawJson === 'true' && !localStorage.getItem('chat_viewMode')) {
        // One-time migration: convert legacy setting to new format
        localStorage.setItem('chat_viewMode', 'raw');
        localStorage.removeItem('chat_showRawJson');
      }

      // Database preference is the source of truth for verbosity level
      // localStorage only stores 'raw' mode (which isn't a verbosity level)
      const savedViewMode = localStorage.getItem('chat_viewMode');

      if (savedViewMode === 'raw') {
        // Raw mode is a local-only UI preference (not stored in database)
        this.viewMode = 'detailed';
        this.showRawJson = true;
      } else if (userVerbosity) {
        // Use user's stored preference from database
        this.viewMode = this.verbosityToViewMode(userVerbosity);
        this.showRawJson = false;
        // Clear any stale localStorage view mode to avoid confusion
        localStorage.removeItem('chat_viewMode');
      } else {
        // Default: 'normal' mode for regular users (cleaner view)
        this.viewMode = 'normal';
        this.showRawJson = false;
      }

      // Load timestamps setting
      const savedTimestamps = localStorage.getItem('chat_showTimestamps');
      if (savedTimestamps !== null) {
        this.showTimestamps = savedTimestamps === 'true';
      }

      // Load widescreen setting
      const savedWidescreen = localStorage.getItem('chat_widescreen');
      if (savedWidescreen !== null) {
        this.widescreen = savedWidescreen === 'true';
      }

      // Load event filters (only used in detailed mode)
      const savedFilters = localStorage.getItem('chat_eventFilters');
      if (savedFilters) {
        const parsed = JSON.parse(savedFilters);
        this.eventFilters = { ...DEFAULT_EVENT_FILTERS, ...parsed };
      }
    } catch (error) {
      console.warn('Failed to load chat settings:', error);
    }
  }

  private saveSettings(): void {
    try {
      // Only save 'raw' mode to localStorage (normal/detailed are persisted to database)
      // This ensures view mode syncs across devices via the database
      if (this.showRawJson) {
        localStorage.setItem('chat_viewMode', 'raw');
      } else {
        // Clear localStorage when not in raw mode - database is source of truth
        localStorage.removeItem('chat_viewMode');
      }
      localStorage.setItem('chat_showTimestamps', String(this.showTimestamps));
      localStorage.setItem('chat_widescreen', String(this.widescreen));
      localStorage.setItem('chat_eventFilters', JSON.stringify(this.eventFilters));
    } catch (error) {
      console.warn('Failed to save chat settings:', error);
    }
  }

  /**
   * Persist verbosity preference to user's account settings.
   * This saves the preference to the database so it persists across sessions.
   * Fire-and-forget: we don't wait for the response or show errors.
   */
  private persistVerbosityPreference(verbosity: VerbosityLevel): void {
    // Only persist if user is logged in
    const user = authStore.getUser();
    if (!user) return;

    // Don't persist if it's the same as current preference
    // Use fallback to 'normal' for null/undefined (matches database default)
    if ((user.chatVerbosityLevel ?? 'normal') === verbosity) return;

    // Update local state immediately
    authStore.updateUser({ chatVerbosityLevel: verbosity });

    // Persist to database (fire-and-forget)
    userApi.updateChatVerbosity(verbosity).catch((error) => {
      console.warn('Failed to persist verbosity preference:', error);
    });
  }

  private setupToolbar(): void {
    // View toggle buttons
    const normalBtn = this.$('[data-view="normal"]') as HTMLButtonElement;
    const detailedBtn = this.$('[data-view="detailed"]') as HTMLButtonElement;
    const rawBtn = this.$('[data-view="raw"]') as HTMLButtonElement;

    normalBtn?.addEventListener('click', () => {
      this.viewMode = 'normal';
      this.showRawJson = false;
      this.saveSettings();
      this.persistVerbosityPreference('normal');
      this.updateToolbarState();
      this.renderContent();
    });

    detailedBtn?.addEventListener('click', () => {
      this.viewMode = 'detailed';
      this.showRawJson = false;
      this.saveSettings();
      this.persistVerbosityPreference('verbose');
      this.updateToolbarState();
      this.renderContent();
    });

    rawBtn?.addEventListener('click', () => {
      this.viewMode = 'detailed'; // Raw uses detailed mode data
      this.showRawJson = true;
      this.saveSettings();
      this.persistVerbosityPreference('verbose');
      this.updateToolbarState();
      this.renderContent();
    });

    // Timestamps toggle
    const timestampsBtn = this.$('[data-action="toggle-timestamps"]') as HTMLButtonElement;
    timestampsBtn?.addEventListener('click', () => {
      this.showTimestamps = !this.showTimestamps;
      this.saveSettings();
      this.updateToolbarState();
      this.renderContent();
    });

    // Widescreen toggle
    const widescreenBtn = this.$('[data-action="toggle-widescreen"]') as HTMLButtonElement;
    widescreenBtn?.addEventListener('click', () => {
      this.widescreen = !this.widescreen;
      this.saveSettings();
      this.updateToolbarState();
    });

    // Filters dropdown
    const filtersBtn = this.$('[data-action="toggle-filters"]') as HTMLButtonElement;
    const filterMenu = this.$('.filter-menu') as HTMLElement;

    filtersBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = filterMenu.style.display !== 'none';
      filterMenu.style.display = isVisible ? 'none' : 'block';
      if (!isVisible) {
        this.renderFilterMenu();
      }
    });

    // Close filter menu when clicking outside
    document.addEventListener('click', () => {
      if (filterMenu) {
        filterMenu.style.display = 'none';
      }
    });

    // Initial toolbar state
    this.updateToolbarState();
  }

  private updateToolbarState(): void {
    // Update view toggle
    const normalBtn = this.$('[data-view="normal"]') as HTMLButtonElement;
    const detailedBtn = this.$('[data-view="detailed"]') as HTMLButtonElement;
    const rawBtn = this.$('[data-view="raw"]') as HTMLButtonElement;

    normalBtn?.classList.toggle('active', this.viewMode === 'normal' && !this.showRawJson);
    detailedBtn?.classList.toggle('active', this.viewMode === 'detailed' && !this.showRawJson);
    rawBtn?.classList.toggle('active', this.showRawJson);

    // Show/hide filters button based on view mode (only useful in detailed/raw mode)
    const filtersBtn = this.$('[data-action="toggle-filters"]') as HTMLButtonElement;
    const filterDropdown = this.$('.filter-dropdown') as HTMLElement;
    if (filterDropdown) {
      filterDropdown.style.display = this.viewMode === 'normal' && !this.showRawJson ? 'none' : '';
    }

    // Update timestamps button
    const timestampsBtn = this.$('[data-action="toggle-timestamps"]') as HTMLButtonElement;
    timestampsBtn?.classList.toggle('active', this.showTimestamps);

    // Update widescreen button and class
    const widescreenBtn = this.$('[data-action="toggle-widescreen"]') as HTMLButtonElement;
    widescreenBtn?.classList.toggle('active', this.widescreen);
    const chatPage = this.$('.chat-page') as HTMLElement;
    chatPage?.classList.toggle('widescreen', this.widescreen);
    chatPage?.classList.toggle('normal-mode', this.viewMode === 'normal' && !this.showRawJson);

    // Update filters button to show if any filters are active (only relevant in detailed mode)
    const hasActiveFilters = Object.values(this.eventFilters).some(v => !v);
    filtersBtn?.classList.toggle('has-filters', hasActiveFilters);
  }

  private renderFilterMenu(): void {
    const filterMenu = this.$('.filter-menu') as HTMLElement;
    if (!filterMenu) return;

    // Get unique event types from raw events
    const eventTypes = new Set<string>();
    for (const event of this.rawEvents) {
      eventTypes.add(event.type);
    }

    // Also add common types that might appear (includes all known event types)
    // Note: 'user' and 'assistant' are excluded since they're always shown
    const commonTypes = [
      'user_message', 'input_preview', 'submission_preview',
      'assistant_message', 'thinking',
      'tool_use', 'tool_result',
      'message', 'error', 'completed', 'result',
      'title_generation', 'session_created', 'session_name',
      'connected', 'system', 'env_manager_log', 'heartbeat', 'resuming'
    ];
    for (const type of commonTypes) {
      eventTypes.add(type);
    }

    // Remove types that are always shown (not filterable)
    const alwaysShowTypes = ['user', 'assistant'];
    for (const type of alwaysShowTypes) {
      eventTypes.delete(type);
    }

    // Sort types alphabetically
    const sortedTypes = Array.from(eventTypes).sort();

    filterMenu.innerHTML = `
      <div class="filter-menu-header">
        <span>Filter Events</span>
        <button class="filter-select-all" data-action="select-all">All</button>
        <button class="filter-select-none" data-action="select-none">None</button>
      </div>
      <div class="filter-menu-items">
        ${sortedTypes.map(type => {
          const emoji = EVENT_EMOJIS[type] || '📦';
          const checked = this.eventFilters[type] !== false;
          return `
            <label class="filter-item">
              <input type="checkbox" data-filter="${type}" ${checked ? 'checked' : ''}>
              <span class="filter-emoji">${emoji}</span>
              <span class="filter-label">${type}</span>
            </label>
          `;
        }).join('')}
      </div>
    `;

    // Add event listeners
    filterMenu.querySelectorAll('input[data-filter]').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const filterType = target.dataset.filter!;
        this.eventFilters[filterType] = target.checked;
        this.saveSettings();
        this.updateToolbarState();
        this.renderContent();
      });
    });

    // Select all/none
    filterMenu.querySelector('[data-action="select-all"]')?.addEventListener('click', () => {
      for (const type of sortedTypes) {
        this.eventFilters[type] = true;
      }
      this.saveSettings();
      this.renderFilterMenu();
      this.updateToolbarState();
      this.renderContent();
    });

    filterMenu.querySelector('[data-action="select-none"]')?.addEventListener('click', () => {
      for (const type of sortedTypes) {
        this.eventFilters[type] = false;
      }
      this.saveSettings();
      this.renderFilterMenu();
      this.updateToolbarState();
      this.renderContent();
    });

    // Prevent clicks inside menu from closing it
    filterMenu.addEventListener('click', (e) => e.stopPropagation());
  }

  private renderContent(): void {
    if (this.showRawJson) {
      this.renderRawEvents();
    } else {
      this.renderMessages();
    }
  }

  private async loadSession(): Promise<void> {
    const sessionId = this.options.params?.sessionId;
    if (!sessionId) {
      toast.error('No session ID provided');
      this.navigate('/agents');
      return;
    }

    this.isLoading = true;
    this.updateLoadingState();

    try {
      // Load session details
      const response = await sessionsApi.get(sessionId);
      this.session = response.session;

      // Update header
      this.updateHeader();

      // Load events/messages
      await this.loadMessages();

      // Handle based on session status
      if (this.session?.status === 'pending') {
        // Start execution for pending sessions
        this.startExecution();
      } else if (this.session?.status === 'running') {
        // Connect to live stream if session is already running
        this.connectToStream();
      }
    } catch (error) {
      toast.error('Failed to load session');
      console.error('Failed to load session:', error);
      this.navigate('/agents');
    } finally {
      this.isLoading = false;
      this.updateLoadingState();
      // Initialize send/stop button state after loading
      this.updateSendButton();
    }
  }

  /**
   * Start execution for a pending session
   */
  private startExecution(): void {
    if (!this.session) return;

    console.log('[ChatPage] Starting execution for session:', this.session.id);

    // Show the user's request immediately (optimistic UI)
    // This gives instant feedback before the server responds
    if (this.session.userRequest) {
      this.shownOptimisticUserMessage = this.session.userRequest;
      this.addMessage({
        id: `user-${Date.now()}`,
        type: 'user',
        content: this.session.userRequest,
        timestamp: new Date(),
      });
    }

    // Update status
    this.updateSessionStatus('running');
    workerStore.startExecution(this.session.id);

    // Create EventSource for execution
    const es = createSessionExecuteEventSource(this.session);

    es.onopen = () => {
      console.log('[ChatPage] Execution stream connected');
    };

    // Only use named event listeners - don't use onmessage to avoid duplicates
    // The server sends events with specific types that we listen for
    const eventTypes = ['connected', 'message', 'session_name', 'assistant_message',
                        'assistant', 'user', 'tool_use', 'tool_result', 'completed',
                        'error', 'session-created', 'input_preview', 'submission_preview',
                        'title_generation', 'result'];
    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.handleStreamEvent({ ...data, type: eventType });
        } catch (error) {
          console.error(`Failed to parse ${eventType} event:`, error);
        }
      });
    }

    es.onerror = (error) => {
      console.error('[ChatPage] Execution stream error:', error);

      // Only show error if not completed
      if (this.session?.status !== 'completed') {
        this.addMessage({
          id: `error-${Date.now()}`,
          type: 'error',
          content: 'Connection lost. Please refresh to reconnect.',
          timestamp: new Date(),
        });
      }

      es.close();
      workerStore.stopExecution();
    };

    this.eventSource = { close: () => es.close() };
  }

  private updateHeader(): void {
    const titleEl = this.$('.chat-title');
    const subtitleEl = this.$('.chat-subtitle');
    const statusEl = this.$('.chat-status');

    if (this.session) {
      const title = this.session.userRequest?.slice(0, 60) || 'Untitled Session';
      if (titleEl) titleEl.textContent = title;

      const repo = this.session.repositoryOwner && this.session.repositoryName
        ? `${this.session.repositoryOwner}/${this.session.repositoryName}`
        : '';
      const branch = this.session.branch || '';
      const subtitle = [repo, branch].filter(Boolean).join(' • ');
      if (subtitleEl) subtitleEl.textContent = subtitle;

      if (statusEl) {
        const status = this.session.status || 'unknown';
        statusEl.className = `chat-status status-${status}`;
        statusEl.textContent = status;
      }
    }
  }

  private async loadMessages(): Promise<void> {
    if (!this.session) return;

    try {
      const response = await sessionsApi.getEvents(this.session.id) as { success?: boolean; data?: { events?: any[] }; events?: any[] };
      // Handle both wrapped { data: { events } } and direct { events } formats
      const events = response.data?.events || response.events || [];

      // Store raw events for raw view
      this.rawEvents = events.map((event: any) => this.convertToRawEvent(event));

      // Build tool result map from events (tool_result events reference tool_use by id)
      this.buildToolResultMap(events);

      // Convert events to messages for formatted view
      // Use flatMap since convertEventToMessages returns an array (to handle extracting tool_use from assistant)
      this.messages = events
        .flatMap((event: any) => this.convertEventToMessages(event))
        .filter((msg: ChatMessage | null): msg is ChatMessage => msg !== null);

      this.renderContent();
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }

  /**
   * Build a map of tool_use_id -> tool_result from events.
   * Tool results can come as:
   * 1. Direct tool_result events
   * 2. Inside user events with content array containing tool_result blocks
   */
  private buildToolResultMap(events: any[]): void {
    this.toolResultMap.clear();

    for (const event of events) {
      const data = event.eventData || event;

      // Direct tool_result event
      if (data?.type === 'tool_result' && data?.tool_use_id) {
        this.toolResultMap.set(data.tool_use_id, {
          tool_use_result: data.tool_use_result || {},
          content: data.content,
          is_error: data.is_error,
        });
      }

      // User event with tool_result in content array
      if (data?.type === 'user' && data?.message?.content) {
        const content = data.message.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              this.toolResultMap.set(block.tool_use_id, {
                tool_use_result: {},
                content: block.content,
                is_error: block.is_error,
              });
            }
          }
        }
      }
    }
  }

  private convertToRawEvent(event: any): RawEvent {
    const data = event.eventData || event;
    const eventType = data?.type || 'unknown';

    return {
      id: event.id || `event-${Date.now()}-${Math.random()}`,
      type: eventType,
      timestamp: new Date(event.timestamp || Date.now()),
      data: data,
    };
  }

  /**
   * Convert an event to one or more ChatMessages.
   * Returns an array because assistant events may contain both text and tool_use blocks.
   * @param event The event to convert
   */
  private convertEventToMessages(event: any): (ChatMessage | null)[] {
    const data = event.eventData || event;
    const eventType = data?.type;

    if (!data) return [null];

    // Skip replayed events (marked with _replayed: true during resume)
    // These are duplicates of already-stored events
    if (data._replayed === true) {
      return [null];
    }

    // Skip control/internal events (these are too low-level or redundant)
    // Pass through only key events: input_preview, title_generation, result, assistant, thinking, tool_use, error, user
    if (['connected', 'heartbeat', 'env_manager_log', 'system', 'tool_result',
         'session_created', 'session_name', 'completed', 'message', 'submission_preview',
         'replay_start', 'replay_end', 'live_stream_start', 'resuming'].includes(eventType)) {
      return [null];
    }

    // Handle different event types
    switch (eventType) {
      case 'input_preview': {
        // input_preview is server confirmation of user's request
        const previewContent = data.data?.preview || data.message || '';
        if (!previewContent) return [null];

        // During page load/replay: show as user message bubble (no optimistic message was shown)
        // During live execution: show as "Request confirmed" (optimistic message was already shown)
        // This applies to both initial requests AND follow-up messages

        if (!this.shownOptimisticUserMessage) {
          // Page load/replay - show as user message
          return [{
            id: event.id || `user-replay-${Date.now()}`,
            type: 'user',
            content: previewContent,
            timestamp: new Date(event.timestamp || Date.now()),
          }];
        }

        // Live execution - show as confirmation status message
        return [{
          id: event.id || `${eventType}-${Date.now()}`,
          type: 'message', // Show as system message
          content: `Request confirmed: ${previewContent}`,
          timestamp: new Date(event.timestamp || Date.now()),
        }];
      }

      case 'user_message':
        // Legacy event type for follow-up messages (backwards compatibility)
        // New sessions use input_preview with source: 'user' instead
        const userContent = data.content || '';
        if (!userContent) return [null];
        return [{
          id: event.id || `user-${Date.now()}`,
          type: 'user',
          content: userContent,
          timestamp: new Date(event.timestamp || Date.now()),
        }];

      case 'assistant':
      case 'assistant_message':
        // Extract messages from assistant event - can include text AND tool_use blocks
        return this.extractMessagesFromAssistant(event, data);

      case 'error': {
        const errorContent = data.message || data.error || 'An error occurred';
        // Filter out abort-related error messages - these will be shown as 'interrupted' event instead
        if (errorContent.includes('aborted') || errorContent.includes('Aborted')) {
          return [null];
        }
        return [{
          id: event.id || `error-${Date.now()}`,
          type: 'error',
          content: errorContent,
          timestamp: new Date(event.timestamp || Date.now()),
        }];
      }

      case 'tool_use':
        // Direct tool_use event (from streaming)
        const toolName = data.name || data.tool || 'unknown tool';
        const toolUseId = data.id || data.tool_use_id || '';
        const toolResult = this.toolResultMap.get(toolUseId);
        return [{
          id: event.id || `tool_use-${Date.now()}`,
          type: 'tool_use',
          content: `Using tool: ${toolName}`,
          timestamp: new Date(event.timestamp || Date.now()),
          toolUse: {
            id: toolUseId,
            name: data.name || data.tool || 'unknown',
            input: data.input || {},
          },
          toolResult: toolResult,
        }];

      case 'title_generation': {
        // Title generation progress/result
        const status = data.status || 'unknown';
        const method = data.method || '';
        let content = '';
        if (status === 'trying') {
          content = `Generating title via ${method}...`;
        } else if (status === 'success') {
          content = `Title: "${data.title || 'Untitled'}"`;
        } else if (status === 'failed') {
          content = `Title generation failed (${method})`;
        } else if (status === 'skipped') {
          content = `Title generation skipped (${method})`;
        } else {
          content = `Title generation: ${status}`;
        }
        return [{
          id: event.id || `title_generation-${Date.now()}`,
          type: 'title_generation',
          content,
          timestamp: new Date(event.timestamp || Date.now()),
        }];
      }

      case 'result': {
        // Final result from Anthropic with cost/duration info - this is the completion indicator
        const cost = data.total_cost_usd ? `$${data.total_cost_usd.toFixed(4)}` : '';
        const duration = data.duration_ms ? `${(data.duration_ms / 1000).toFixed(1)}s` : '';
        const stats = [cost, duration].filter(Boolean).join(' • ');
        return [{
          id: event.id || `result-${Date.now()}`,
          type: 'result',
          content: stats ? `Completed (${stats})` : 'Completed',
          timestamp: new Date(event.timestamp || Date.now()),
        }];
      }

      case 'user': {
        // Check for interrupt messages in tool_result content
        // These appear when the user stops/interrupts a session
        const messageContent = data.message?.content;
        if (Array.isArray(messageContent)) {
          for (const block of messageContent) {
            if (block.type === 'tool_result' && block.is_error === true) {
              const content = block.content || '';
              if (content.includes('interrupted by user')) {
                return [{
                  id: event.id || `interrupt-${Date.now()}`,
                  type: 'error',
                  content: '⏹️ Request interrupted by user',
                  timestamp: new Date(event.timestamp || Date.now()),
                }];
              }
            }
          }
        }
        // Also check tool_use_result field (alternative format)
        const toolResult = data.tool_use_result;
        if (typeof toolResult === 'string' && toolResult.includes('interrupted by user')) {
          return [{
            id: event.id || `interrupt-${Date.now()}`,
            type: 'error',
            content: '⏹️ Request interrupted by user',
            timestamp: new Date(event.timestamp || Date.now()),
          }];
        }
        return [null];
      }

      case 'interrupted': {
        // Interrupt event from the server when user stops the session
        const message = data.message || 'Request interrupted by user';
        return [{
          id: event.id || `interrupted-${Date.now()}`,
          type: 'error',
          content: `⏹️ ${message}`,
          timestamp: new Date(event.timestamp || Date.now()),
        }];
      }

      default:
        return [null];
    }
  }

  /**
   * Extract messages from an assistant event.
   * Assistant events can contain text blocks AND tool_use blocks.
   */
  private extractMessagesFromAssistant(event: any, data: any): (ChatMessage | null)[] {
    const messages: (ChatMessage | null)[] = [];
    const timestamp = new Date(event.timestamp || Date.now());
    const model = data.model || data.message?.model;

    // Get content array - could be in data.content or data.message.content
    let contentArray: any[] = [];
    if (Array.isArray(data.content)) {
      contentArray = data.content;
    } else if (data.message && Array.isArray(data.message.content)) {
      contentArray = data.message.content;
    }

    // Process each content block
    let textParts: string[] = [];

    for (const block of contentArray) {
      if (block.type === 'text' && block.text) {
        textParts.push(block.text);
      } else if (block.type === 'thinking' && block.thinking) {
        // If we have accumulated text, create a text message first
        if (textParts.length > 0) {
          messages.push({
            id: `assistant-text-${Date.now()}-${Math.random()}`,
            type: 'assistant',
            content: textParts.join('\n'),
            timestamp,
            model,
          });
          textParts = [];
        }

        // Create thinking message as a status line
        // Truncate thinking content for display (show first line or first 100 chars)
        const thinkingText = block.thinking;
        const firstLine = thinkingText.split('\n')[0];
        const isTruncated = firstLine.length > 100 || thinkingText.includes('\n');
        const displayText = firstLine.length > 100 ? firstLine.substring(0, 100) + '...' : firstLine;
        messages.push({
          id: `thinking-${Date.now()}-${Math.random()}`,
          type: 'thinking',
          content: displayText || 'Thinking...',
          timestamp,
          // Store full content only if truncated
          fullContent: isTruncated ? thinkingText : undefined,
        });
      } else if (block.type === 'tool_use') {
        // If we have accumulated text, create a text message first
        if (textParts.length > 0) {
          messages.push({
            id: `assistant-text-${Date.now()}-${Math.random()}`,
            type: 'assistant',
            content: textParts.join('\n'),
            timestamp,
            model,
          });
          textParts = [];
        }

        // Create tool_use message
        const toolUseId = block.id || '';
        const toolResult = this.toolResultMap.get(toolUseId);
        messages.push({
          id: block.id || `tool_use-${Date.now()}-${Math.random()}`,
          type: 'tool_use',
          content: `Using tool: ${block.name}`,
          timestamp,
          toolUse: {
            id: toolUseId,
            name: block.name || 'unknown',
            input: block.input || {},
          },
          toolResult: toolResult,
        });
      }
    }

    // Add any remaining text
    if (textParts.length > 0) {
      messages.push({
        id: `assistant-text-${Date.now()}-${Math.random()}`,
        type: 'assistant',
        content: textParts.join('\n'),
        timestamp,
        model,
      });
    }

    // If no messages were extracted, try the old approach (string content)
    if (messages.length === 0) {
      const assistantContent = this.extractAssistantContent(data);
      if (assistantContent) {
        messages.push({
          id: event.id || `assistant-${Date.now()}`,
          type: 'assistant',
          content: assistantContent,
          timestamp,
          model,
        });
      }
    }

    return messages.length > 0 ? messages : [null];
  }

  private extractAssistantContent(data: any): string {
    // Helper to extract text from content blocks array
    const extractFromContentArray = (contentArray: any[]): string => {
      return contentArray
        .map((block: any) => {
          if (typeof block === 'string') return block;
          if (block.type === 'text' && block.text) return block.text;
          if (block.type === 'tool_use') return `[Using tool: ${block.name}]`;
          if (block.type === 'thinking') return ''; // Thinking is handled separately as status message
          return '';
        })
        .filter(Boolean)
        .join('\n');
    };

    // Handle content blocks array directly on data
    if (Array.isArray(data.content)) {
      const result = extractFromContentArray(data.content);
      if (result) return result;
    }

    // Handle nested message object (from Claude remote events)
    if (data.message && typeof data.message === 'object') {
      // message.content can be an array of blocks
      if (Array.isArray(data.message.content)) {
        const result = extractFromContentArray(data.message.content);
        if (result) return result;
      }
      // Or message.content could be a string
      if (typeof data.message.content === 'string') {
        return data.message.content;
      }
    }

    // Handle message field as string (from SSE)
    if (typeof data.message === 'string') return data.message;

    // Handle direct content string
    if (typeof data.content === 'string') return data.content;

    // Handle nested data.data structure
    if (data.data) {
      if (typeof data.data.message === 'string') return data.data.message;
      if (typeof data.data.content === 'string') return data.data.content;
      if (Array.isArray(data.data.content)) {
        return extractFromContentArray(data.data.content);
      }
    }

    return '';
  }

  private connectToStream(): void {
    if (!this.session) return;

    // Close any existing connection first
    if (this.eventSource) {
      console.log('[ChatPage] Closing existing EventSource connection');
      this.eventSource.close();
      this.eventSource = null;
    }

    const streamUrl = sessionsApi.getStreamUrl(this.session.id);
    console.log('[ChatPage] Connecting to stream:', streamUrl);

    // Use EventSource for SSE
    const es = new EventSource(streamUrl, { withCredentials: true });

    // Log when connection opens
    es.onopen = () => {
      console.log('[ChatPage] EventSource connection opened');
    };

    // Only use named event listeners - don't use onmessage to avoid duplicates
    // The server sends events with specific types that we listen for
    const eventTypes = ['connected', 'message', 'session_name', 'assistant_message',
                        'assistant', 'user', 'tool_use', 'tool_result', 'completed',
                        'error', 'session-created', 'input_preview', 'submission_preview',
                        'title_generation', 'result'];
    for (const eventType of eventTypes) {
      es.addEventListener(eventType, (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.handleStreamEvent({ ...data, type: eventType });
        } catch (error) {
          console.error(`Failed to parse ${eventType} event:`, error);
        }
      });
    }

    es.onerror = () => {
      console.error('Stream connection error');
      es.close();
    };

    this.eventSource = { close: () => es.close() };

    // Update worker store
    workerStore.startExecution(this.session.id);
  }

  private handleStreamEvent(event: any): void {
    const eventType = event.type;

    // Update heartbeat
    workerStore.heartbeat();

    console.log('[ChatPage] Stream event:', eventType, event);

    // Always add to raw events (same format as loadMessages)
    const rawEvent = this.convertToRawEvent({ eventData: event, timestamp: new Date().toISOString() });
    this.addRawEvent(rawEvent);

    // Handle control events that don't create messages
    switch (eventType) {
      case 'connected':
      case 'session-created':
        console.log('[ChatPage] Connected/Session created:', event);
        return;

      case 'tool_result':
        // Tool completed - update the corresponding tool_use message with result
        const resultToolId = event.tool_use_id;
        if (resultToolId) {
          const result: ToolResult = {
            tool_use_result: event.tool_use_result || {},
            content: event.content,
            is_error: event.is_error,
          };
          this.toolResultMap.set(resultToolId, result);
          this.updateToolResult(resultToolId, result);
        }
        return;

      case 'error':
        // Only handle error if this is NOT a replayed event
        if (!event._replayed) {
          workerStore.stopExecution();
          this.updateSessionStatus('failed');
        }
        break; // Still create a message for errors

      case 'completed':
        // Only close the connection if this is NOT a replayed event
        // During resume, we replay past events including the old 'completed' event
        // but we need to keep the connection open for new events from the resume
        if (!event._replayed) {
          workerStore.stopExecution();
          this.updateSessionStatus('completed');
          if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
          }
        } else {
          console.log('[ChatPage] Ignoring replayed completed event, keeping connection open for resume');
        }
        return;

      case 'session_name':
        if ((event.sessionName || event.name) && this.session) {
          this.session.userRequest = event.sessionName || event.name;
          this.updateHeader();
        }
        return; // Don't create a message for session_name

      case 'title_generation':
        // Update the session title when title is successfully generated
        if (event.status === 'success' && event.title && this.session) {
          this.session.userRequest = event.title;
          // Also update branch if provided
          if (event.branch_name) {
            this.session.branch = event.branch_name;
          }
          this.updateHeader();
        }
        break; // Still create a message to show title generation status
    }

    // Use the same conversion logic as loadMessages for consistency
    // Wrap event to match the format from database events
    const wrappedEvent = { eventData: event, timestamp: new Date().toISOString() };
    const messages = this.convertEventToMessages(wrappedEvent);

    // Add each message (convertEventToMessages returns an array)
    for (const msg of messages) {
      if (msg) {
        this.addMessage(msg);
      }
    }
  }

  private updateSessionStatus(status: SessionStatus): void {
    if (this.session) {
      this.session.status = status;
      this.updateHeader();
      this.updateSendButton();
    }
  }

  private addMessage(message: ChatMessage): void {
    this.messages.push(message);
    if (!this.showRawJson) {
      this.renderMessages();
    }
    this.scrollToBottom();
  }

  /**
   * Update a tool_use message with its result (for streaming)
   */
  private updateToolResult(toolId: string, result: ToolResult): void {
    const message = this.messages.find(m => m.toolUse?.id === toolId);
    if (message) {
      message.toolResult = result;
      // Re-render to update the tool details
      if (!this.showRawJson) {
        this.renderMessages();
      }
    }
  }

  private addRawEvent(event: RawEvent): void {
    this.rawEvents.push(event);
    if (this.showRawJson) {
      this.renderRawEvents();
      this.scrollToBottom();
    }
  }

  private renderMessages(): void {
    if (!this.messagesContainer) return;

    const empty = this.$('.chat-empty') as HTMLElement;
    const list = this.$('.messages-list') as HTMLElement;
    const eventsList = this.$('.events-list') as HTMLElement;

    // Hide events list in formatted mode
    eventsList?.style.setProperty('display', 'none');

    // Filter messages based on view mode
    let filteredMessages: ChatMessage[];

    if (this.viewMode === 'normal') {
      // Normal Mode: Show only high-level events for a summarized view
      // This hides micro-steps like individual tool_use, thinking, message events
      filteredMessages = this.messages.filter(msg => NORMAL_MODE_EVENTS.has(msg.type));
    } else {
      // Detailed Mode: Use event filters
      // Always show user and assistant messages regardless of filter settings
      const alwaysShowTypes = ['user', 'assistant'];
      filteredMessages = this.messages.filter(msg => {
        if (alwaysShowTypes.includes(msg.type)) return true;
        return this.eventFilters[msg.type] !== false;
      });
    }

    if (filteredMessages.length === 0) {
      empty?.style.setProperty('display', 'flex');
      list?.style.setProperty('display', 'none');
    } else {
      empty?.style.setProperty('display', 'none');
      list?.style.setProperty('display', 'flex');

      // Clear and re-render all messages
      this.messagesContainer.innerHTML = '';

      for (const msg of filteredMessages) {
        // Handle tool_use messages with ToolDetails component
        if (msg.type === 'tool_use' && msg.toolUse) {
          const wrapper = document.createElement('div');
          wrapper.className = 'chat-message message-system';
          wrapper.innerHTML = '<div class="message-bubble"><div class="message-content"></div></div>';
          const contentEl = wrapper.querySelector('.message-content') as HTMLElement;

          const toolDetails = new ToolDetails({
            tool: msg.toolUse,
            result: msg.toolResult,
            showTimestamp: this.showTimestamps,
            timestamp: msg.timestamp,
          });
          contentEl.appendChild(toolDetails.getElement());

          this.messagesContainer.appendChild(wrapper);
        } else {
          // Regular message rendering
          const html = this.renderMessage(msg);
          this.messagesContainer.insertAdjacentHTML('beforeend', html);
        }
      }

      // Add click handlers for expandable thinking messages
      this.setupThinkingClickHandlers();
    }
  }

  /**
   * Set up click handlers for expandable thinking messages
   */
  private setupThinkingClickHandlers(): void {
    if (!this.messagesContainer) return;

    const expandableThinkings = this.messagesContainer.querySelectorAll('.message-thinking-expandable');
    expandableThinkings.forEach((el) => {
      el.addEventListener('click', (e) => {
        // Don't toggle if clicking on a link or other interactive element
        if ((e.target as HTMLElement).tagName === 'A') return;

        const collapsed = el.querySelector('.thinking-collapsed') as HTMLElement;
        const expanded = el.querySelector('.thinking-expanded') as HTMLElement;

        if (collapsed && expanded) {
          const isExpanded = collapsed.style.display === 'none';
          if (isExpanded) {
            // Collapse
            collapsed.style.display = '';
            expanded.style.display = 'none';
          } else {
            // Expand
            collapsed.style.display = 'none';
            expanded.style.display = '';
          }
        }
      });
    });
  }

  private renderRawEvents(): void {
    const empty = this.$('.chat-empty') as HTMLElement;
    const messagesList = this.$('.messages-list') as HTMLElement;
    const eventsList = this.$('.events-list') as HTMLElement;

    // Hide messages list in raw mode
    messagesList?.style.setProperty('display', 'none');

    // Filter events based on event filters
    const filteredEvents = this.rawEvents.filter(event => {
      return this.eventFilters[event.type] !== false;
    });

    if (filteredEvents.length === 0) {
      empty?.style.setProperty('display', 'flex');
      eventsList?.style.setProperty('display', 'none');
    } else {
      empty?.style.setProperty('display', 'none');
      eventsList?.style.setProperty('display', 'flex');

      if (eventsList) {
        eventsList.innerHTML = filteredEvents
          .map((event) => this.renderRawEvent(event))
          .join('');
      }
    }
  }

  private renderRawEvent(event: RawEvent): string {
    const emoji = EVENT_EMOJIS[event.type] || '📦';
    const timestamp = this.showTimestamps
      ? `<span class="event-timestamp">${event.timestamp.toLocaleTimeString()}</span>`
      : '';

    // Pretty print JSON
    const jsonContent = JSON.stringify(event.data, null, 2);
    const escapedJson = this.escapeHtml(jsonContent);

    return `
      <div class="raw-event event-type-${event.type}">
        <div class="event-header">
          <span class="event-emoji">${emoji}</span>
          <span class="event-type">${event.type}</span>
          ${timestamp}
        </div>
        <pre class="event-json"><code>${escapedJson}</code></pre>
      </div>
    `;
  }

  private renderMessage(message: ChatMessage): string {
    const user = authStore.getUser();
    const time = message.timestamp.toLocaleTimeString();
    const escapedContent = this.escapeHtml(message.content);

    // Status message types get compact single-line rendering with emoji
    // Note: tool_use is handled separately in renderMessages() with ToolDetails component
    const statusTypes = [
      'message', 'input_preview', 'submission_preview', 'system', 'thinking',
      'title_generation', 'session_created', 'session_name', 'result', 'completed'
    ];
    if (statusTypes.includes(message.type)) {
      const emoji = EVENT_EMOJIS[message.type] || '📦';
      const timestampHtml = this.showTimestamps
        ? `<span class="status-timestamp">${time}</span>`
        : '';

      // Thinking messages with fullContent are expandable
      if (message.type === 'thinking' && message.fullContent) {
        const escapedFullContent = this.escapeHtml(message.fullContent);
        return `
          <div class="chat-message message-system message-thinking-expandable" data-message-id="${message.id}">
            <div class="message-bubble">
              <div class="message-content">
                ${timestampHtml}
                <span class="status-emoji">${emoji}</span>
                <span class="status-text thinking-collapsed">${escapedContent}</span>
                <span class="status-text thinking-expanded" style="display: none;">${escapedFullContent}</span>
              </div>
            </div>
          </div>
        `;
      }

      return `
        <div class="chat-message message-system">
          <div class="message-bubble">
            <div class="message-content">
              ${timestampHtml}
              <span class="status-emoji">${emoji}</span>
              <span class="status-text">${escapedContent}</span>
            </div>
          </div>
        </div>
      `;
    }

    // User, assistant, error get bubble treatment
    const typeClass = `message-${message.type}`;
    const senderName = message.type === 'user'
      ? (user?.displayName || user?.email || 'You')
      : message.type === 'assistant'
        ? (message.model ? `Claude (${message.model})` : 'Claude')
        : 'Error';

    const formattedContent = this.formatMarkdown(escapedContent);

    // Show timestamp only when enabled
    const timeHtml = this.showTimestamps
      ? `<span class="message-time">${time}</span>`
      : '';

    return `
      <div class="chat-message ${typeClass}">
        <div class="message-bubble">
          <div class="message-content">${formattedContent}</div>
          <div class="message-meta">
            <span class="message-sender">${senderName}</span>
            ${timeHtml}
          </div>
        </div>
      </div>
    `;
  }

  private formatMarkdown(text: string): string {
    // Process code blocks first (store and replace with placeholders)
    const codeBlocks: string[] = [];
    let formatted = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
      const idx = codeBlocks.length;
      const trimmedCode = code.trim();
      const highlightedCode = highlightCode(trimmedCode, lang || undefined);
      const languageLabel = lang ? `<span class="code-lang">${getLanguageDisplayName(lang)}</span>` : '';
      const langClass = lang ? ` language-${lang.toLowerCase()}` : '';
      codeBlocks.push(`<div class="code-block">${languageLabel}<pre><code class="hljs${langClass}">${highlightedCode}</code></pre></div>`);
      return `__CODE_BLOCK_${idx}__`;
    });

    // Process tables (before other markdown to avoid conflicts)
    const tables: string[] = [];
    formatted = formatted.replace(/^(\|.+\|)\n(\|[-:| ]+\|)\n((?:\|.+\|\n?)+)/gm, (match) => {
      const idx = tables.length;
      const lines = match.trim().split('\n');
      if (lines.length < 2) return match;

      // Parse header row
      const headerCells = lines[0].split('|').filter(cell => cell.trim());
      // Skip separator row (lines[1])
      // Parse data rows
      const dataRows = lines.slice(2).map(line =>
        line.split('|').filter(cell => cell.trim())
      );

      let tableHtml = '<table class="md-table"><thead><tr>';
      headerCells.forEach(cell => {
        tableHtml += `<th>${cell.trim()}</th>`;
      });
      tableHtml += '</tr></thead><tbody>';
      dataRows.forEach(row => {
        tableHtml += '<tr>';
        row.forEach(cell => {
          tableHtml += `<td>${cell.trim()}</td>`;
        });
        tableHtml += '</tr>';
      });
      tableHtml += '</tbody></table>';

      tables.push(tableHtml);
      return `__TABLE_${idx}__`;
    });

    // Process other markdown
    formatted = formatted
      // Inline code
      .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
      // Headers (must be at start of line)
      .replace(/^### (.+)$/gm, '<h4 class="md-heading">$1</h4>')
      .replace(/^## (.+)$/gm, '<h3 class="md-heading">$1</h3>')
      .replace(/^# (.+)$/gm, '<h2 class="md-heading">$1</h2>')
      // Bold
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      // Italic
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      // Strikethrough
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      // Links
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      // Horizontal rules
      .replace(/^---$/gm, '<hr class="md-hr">')
      // Unordered lists
      .replace(/^[\*\-] (.+)$/gm, '<li class="md-li">$1</li>')
      // Numbered lists
      .replace(/^\d+\. (.+)$/gm, '<li class="md-li-num">$1</li>')
      // Wrap consecutive li items
      .replace(/(<li class="md-li">[\s\S]*?<\/li>)(\s*<li class="md-li">)/g, '$1$2')
      // Line breaks (but not after block elements)
      .replace(/\n(?!<)/g, '<br>');

    // Restore tables
    tables.forEach((table, idx) => {
      formatted = formatted.replace(`__TABLE_${idx}__`, table);
    });

    // Restore code blocks
    codeBlocks.forEach((block, idx) => {
      formatted = formatted.replace(`__CODE_BLOCK_${idx}__`, block);
    });

    return formatted;
  }

  private updateLoadingState(): void {
    const loading = this.$('.chat-loading') as HTMLElement;
    const empty = this.$('.chat-empty') as HTMLElement;
    const list = this.$('.messages-list') as HTMLElement;

    if (this.isLoading) {
      loading?.style.setProperty('display', 'flex');
      empty?.style.setProperty('display', 'none');
      list?.style.setProperty('display', 'none');
    } else {
      loading?.style.setProperty('display', 'none');
    }
  }

  private handleInputChange(): void {
    if (!this.inputElement) return;

    this.inputValue = this.inputElement.value;

    // Update send/stop button state
    this.updateSendButton();

    // Auto-resize textarea
    this.inputElement.style.height = 'auto';
    this.inputElement.style.height = Math.min(this.inputElement.scrollHeight, 200) + 'px';
  }

  private handleKeyDown(e: KeyboardEvent): void {
    // Enter without shift = send
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.handleSend();
    }
  }

  /**
   * Handle paste events to detect and attach images from clipboard
   */
  private async handlePaste(e: ClipboardEvent): Promise<void> {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Check for image files in the clipboard
    const items = clipboardData.items;
    const imageItems: DataTransferItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        imageItems.push(item);
      }
    }

    // If there are images, handle them
    if (imageItems.length > 0) {
      e.preventDefault(); // Prevent default paste behavior for images

      for (const item of imageItems) {
        const file = item.getAsFile();
        if (file) {
          await this.addImageFromFile(file);
        }
      }
    }
  }

  /**
   * Convert a file to base64 and add to attached images
   */
  private async addImageFromFile(file: File): Promise<void> {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Only image files are supported');
      return;
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('Image too large. Maximum size is 10MB');
      return;
    }

    try {
      const base64 = await this.fileToBase64(file);
      const imageId = `img-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      this.attachedImages.push({
        id: imageId,
        data: base64,
        mediaType: file.type,
      });

      this.renderImagePreviews();
      this.updateSendButton();
      toast.success('Image attached');
    } catch (error) {
      console.error('Failed to process image:', error);
      toast.error('Failed to process image');
    }
  }

  /**
   * Convert a file to base64 data URL (without the data: prefix)
   */
  private fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Extract base64 data without the data:image/xxx;base64, prefix
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Render image previews in the preview container
   */
  private renderImagePreviews(): void {
    const container = this.$('.image-preview-container') as HTMLElement;
    if (!container) return;

    if (this.attachedImages.length === 0) {
      container.style.display = 'none';
      container.innerHTML = '';
      return;
    }

    container.style.display = 'flex';
    container.innerHTML = this.attachedImages.map(img => `
      <div class="image-preview-item" data-image-id="${img.id}">
        <img src="data:${img.mediaType};base64,${img.data}" alt="Attached image" />
        <button class="image-preview-remove" data-action="remove-image" data-image-id="${img.id}" title="Remove image">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    `).join('');

    // Add click handlers for remove buttons
    container.querySelectorAll('[data-action="remove-image"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const imageId = (btn as HTMLElement).dataset.imageId;
        if (imageId) {
          this.removeImage(imageId);
        }
      });
    });
  }

  /**
   * Remove an attached image by ID
   */
  private removeImage(imageId: string): void {
    this.attachedImages = this.attachedImages.filter(img => img.id !== imageId);
    this.renderImagePreviews();
    this.updateSendButton();
  }

  private async handleSend(): Promise<void> {
    const hasText = this.inputValue.trim().length > 0;
    const hasImages = this.attachedImages.length > 0;

    // Need at least text or images to send
    if ((!hasText && !hasImages) || this.isSending || !this.session) return;

    const content = this.inputValue.trim();
    const imagesToSend = [...this.attachedImages]; // Copy images before clearing

    // Clear input and images
    this.inputValue = '';
    this.attachedImages = [];
    if (this.inputElement) {
      this.inputElement.value = '';
      this.inputElement.style.height = 'auto';
    }
    this.renderImagePreviews();

    // Build display content for optimistic message
    const displayContent = hasImages && hasText
      ? `${content}\n\n[${imagesToSend.length} image${imagesToSend.length > 1 ? 's' : ''} attached]`
      : hasImages
        ? `[${imagesToSend.length} image${imagesToSend.length > 1 ? 's' : ''} attached]`
        : content;

    // Add user message optimistically and track it to avoid duplicates
    this.shownOptimisticUserMessage = displayContent;
    this.addMessage({
      id: `user-${Date.now()}`,
      type: 'user',
      content: displayContent,
      timestamp: new Date(),
    });

    this.isSending = true;
    this.updateSendButton();

    try {
      // Format images for API (remove the id field, keep only data and mediaType)
      const imagesForApi = imagesToSend.map(img => ({
        data: img.data,
        mediaType: img.mediaType,
      }));

      // Send message to execute endpoint with images
      const response = await sessionsApi.sendMessage(
        this.session.id,
        content,
        imagesForApi.length > 0 ? imagesForApi : undefined
      );

      if (!response.success) {
        throw new Error(response.error || 'Failed to send message');
      }

      // Connect to stream for response
      this.connectToStream();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send message';
      toast.error(message);

      this.addMessage({
        id: `error-${Date.now()}`,
        type: 'error',
        content: message,
        timestamp: new Date(),
      });
    } finally {
      this.isSending = false;
      this.updateSendButton();
    }
  }

  /**
   * Check if the session is currently running
   */
  private isSessionRunning(): boolean {
    return this.session?.status === 'running' || workerStore.isExecuting();
  }

  /**
   * Handle stop button click - interrupt the running session
   */
  private async handleStop(): Promise<void> {
    if (!this.session) return;

    // Update local state FIRST to prevent "Connection lost" error from showing
    // This must happen before the interrupt API call because the abort will
    // trigger the EventSource onerror before the API response is received
    this.updateSessionStatus('completed');
    workerStore.stopExecution();

    // Close the event source immediately
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    try {
      // Call the interrupt API
      const response = await sessionsApi.interrupt(this.session.id);

      if (response.success) {
        toast.success('Session interrupted');
        // Update button state
        this.updateSendButton();
      } else {
        // Revert status if interrupt failed
        this.updateSessionStatus('running');
        toast.error(response.error || 'Failed to interrupt session');
      }
    } catch (error) {
      // Revert status if interrupt failed
      this.updateSessionStatus('running');
      const message = error instanceof Error ? error.message : 'Failed to interrupt session';
      toast.error(message);
      console.error('Failed to interrupt session:', error);
    }
  }

  private updateSendButton(): void {
    const sendBtn = this.$('[data-action="send"]') as HTMLButtonElement;
    if (!sendBtn) return;

    const sendIcon = sendBtn.querySelector('.send-icon') as SVGElement;
    const stopIcon = sendBtn.querySelector('.stop-icon') as SVGElement;
    const isRunning = this.isSessionRunning();
    const hasInput = !!this.inputValue.trim();
    const hasImages = this.attachedImages.length > 0;
    const hasContent = hasInput || hasImages;

    // Show stop button when running and no content, otherwise show send
    const showStop = isRunning && !hasContent;

    if (sendIcon) sendIcon.style.display = showStop ? 'none' : '';
    if (stopIcon) stopIcon.style.display = showStop ? '' : 'none';

    // Update button styling
    sendBtn.classList.toggle('stop-mode', showStop);

    // Enable button if we can stop OR if we have content to send (and not already sending)
    sendBtn.disabled = showStop ? false : (!hasContent || this.isSending);
    sendBtn.classList.toggle('loading', this.isSending);
  }

  private scrollToBottom(): void {
    const container = this.$('.chat-messages') as HTMLElement;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  protected onUnmount(): void {
    // Close event source
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Stop execution tracking
    workerStore.stopExecution();
  }
}
