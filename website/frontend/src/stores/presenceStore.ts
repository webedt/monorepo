/**
 * Presence Store
 * Manages collaborative presence state for real-time cursor tracking
 */

import { Store } from '../lib/store';
import { workspacePresenceApi } from '../lib/api';
import type { PresenceUser } from '../lib/api';

// Generate a consistent color for a user based on their ID
function getUserColor(userId: string): string {
  // Predefined set of distinct colors for collaborative cursors
  const colors = [
    '#E91E63', // Pink
    '#9C27B0', // Purple
    '#673AB7', // Deep Purple
    '#3F51B5', // Indigo
    '#2196F3', // Blue
    '#00BCD4', // Cyan
    '#009688', // Teal
    '#4CAF50', // Green
    '#FF9800', // Orange
    '#FF5722', // Deep Orange
  ];

  // Hash the userId to get a consistent color index
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash & hash; // Convert to 32-bit integer
  }

  return colors[Math.abs(hash) % colors.length];
}

interface PresenceState {
  // Connection state
  isConnected: boolean;
  isConnecting: boolean;

  // Workspace context
  owner: string | null;
  repo: string | null;
  branch: string | null;

  // Users present in the workspace (excluding current user)
  otherUsers: PresenceUser[];

  // Current user's cursor state
  currentFilePath: string | null;
  currentCursorLine: number | null;
  currentCursorCol: number | null;

  // Selection range
  selectionStartLine: number | null;
  selectionEndLine: number | null;
  selectionStartCol: number | null;
  selectionEndCol: number | null;

  // Error state
  error: string | null;
}

class PresenceStore extends Store<PresenceState> {
  private heartbeatInterval: number | null = null;
  private eventSource: EventSource | null = null;
  private reconnectTimeout: number | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor() {
    super({
      isConnected: false,
      isConnecting: false,
      owner: null,
      repo: null,
      branch: null,
      otherUsers: [],
      currentFilePath: null,
      currentCursorLine: null,
      currentCursorCol: null,
      selectionStartLine: null,
      selectionEndLine: null,
      selectionStartCol: null,
      selectionEndCol: null,
      error: null,
    });
  }

  /**
   * Get color for a specific user
   */
  getUserColor(userId: string): string {
    return getUserColor(userId);
  }

  /**
   * Get other users with their colors
   */
  getOtherUsersWithColors(): Array<PresenceUser & { color: string }> {
    return this.getState().otherUsers.map(user => ({
      ...user,
      color: getUserColor(user.userId),
    }));
  }

  /**
   * Connect to a workspace and start presence tracking
   */
  async connect(owner: string, repo: string, branch: string): Promise<void> {
    // Disconnect from any previous workspace
    this.disconnect();

    this.setState({
      isConnecting: true,
      error: null,
      owner,
      repo,
      branch,
    });

    try {
      // Initial presence update
      await this.sendPresenceUpdate();

      // Start SSE connection for real-time updates
      this.startEventSource(owner, repo, branch);

      // Start heartbeat (every 5 seconds)
      this.heartbeatInterval = window.setInterval(() => {
        this.sendPresenceUpdate().catch(console.error);
      }, 5000);

      this.setState({
        isConnected: true,
        isConnecting: false,
      });

      console.log('[Presence] Connected to workspace:', `${owner}/${repo}/${branch}`);
    } catch (error) {
      this.setState({
        isConnecting: false,
        error: error instanceof Error ? error.message : 'Failed to connect',
      });
      console.error('[Presence] Failed to connect:', error);
    }
  }

  /**
   * Start SSE connection for real-time presence updates
   */
  private startEventSource(owner: string, repo: string, branch: string): void {
    const url = workspacePresenceApi.getStreamUrl(owner, repo, branch);

    this.eventSource = new EventSource(url, { withCredentials: true });

    this.eventSource.addEventListener('connected', () => {
      console.log('[Presence] SSE connected');
      this.reconnectAttempts = 0;
    });

    this.eventSource.addEventListener('presence_update', (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { users: PresenceUser[] };
        // Filter out current user
        const otherUsers = data.users.filter(u => !u.isCurrentUser);
        this.setState({ otherUsers });
      } catch (error) {
        console.error('[Presence] Failed to parse presence update:', error);
      }
    });

    this.eventSource.onerror = () => {
      // Guard: don't reconnect if we've already disconnected
      if (!this.eventSource) {
        return;
      }
      console.error('[Presence] SSE error, attempting reconnect...');
      this.handleReconnect(owner, repo, branch);
    };
  }

  /**
   * Handle SSE reconnection with exponential backoff
   */
  private handleReconnect(owner: string, repo: string, branch: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setState({
        isConnected: false,
        error: 'Lost connection to presence server',
      });
      return;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectAttempts++;

    console.log(`[Presence] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

    this.reconnectTimeout = window.setTimeout(() => {
      this.startEventSource(owner, repo, branch);
    }, delay);
  }

  /**
   * Update cursor position
   */
  updateCursor(filePath: string | null, line: number | null, col: number | null): void {
    this.setState({
      currentFilePath: filePath,
      currentCursorLine: line,
      currentCursorCol: col,
    });

    // Debounce the presence update
    this.debouncedPresenceUpdate();
  }

  /**
   * Update text selection
   */
  updateSelection(
    filePath: string | null,
    startLine: number | null,
    endLine: number | null,
    startCol: number | null,
    endCol: number | null
  ): void {
    this.setState({
      currentFilePath: filePath,
      selectionStartLine: startLine,
      selectionEndLine: endLine,
      selectionStartCol: startCol,
      selectionEndCol: endCol,
    });

    this.debouncedPresenceUpdate();
  }

  private debounceTimer: number | null = null;

  /**
   * Debounced presence update (150ms)
   */
  private debouncedPresenceUpdate(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = window.setTimeout(() => {
      this.sendPresenceUpdate().catch(console.error);
    }, 150);
  }

  /**
   * Send presence update to server
   */
  private async sendPresenceUpdate(): Promise<void> {
    const state = this.getState();

    if (!state.owner || !state.repo || !state.branch) {
      return;
    }

    const selection = state.currentFilePath ? {
      filePath: state.currentFilePath,
      startLine: state.selectionStartLine ?? state.currentCursorLine ?? undefined,
      endLine: state.selectionEndLine ?? state.currentCursorLine ?? undefined,
      startCol: state.selectionStartCol ?? state.currentCursorCol ?? undefined,
      endCol: state.selectionEndCol ?? state.currentCursorCol ?? undefined,
    } : undefined;

    await workspacePresenceApi.updatePresence({
      owner: state.owner,
      repo: state.repo,
      branch: state.branch,
      page: 'code',
      cursorX: state.currentCursorCol ?? undefined,
      cursorY: state.currentCursorLine ?? undefined,
      selection,
    });
  }

  /**
   * Disconnect from workspace
   */
  disconnect(): void {
    const state = this.getState();

    // Clear timers
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Close SSE connection
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    // Notify server of departure
    if (state.owner && state.repo && state.branch) {
      workspacePresenceApi.removePresence(state.owner, state.repo, state.branch).catch(() => {
        // Ignore errors when leaving
      });
    }

    // Reset state
    this.setState({
      isConnected: false,
      isConnecting: false,
      owner: null,
      repo: null,
      branch: null,
      otherUsers: [],
      currentFilePath: null,
      currentCursorLine: null,
      currentCursorCol: null,
      selectionStartLine: null,
      selectionEndLine: null,
      selectionStartCol: null,
      selectionEndCol: null,
      error: null,
    });

    this.reconnectAttempts = 0;

    console.log('[Presence] Disconnected from workspace');
  }

  /**
   * Check if presence is enabled for the current workspace
   */
  isEnabled(): boolean {
    return this.getState().isConnected;
  }

  /**
   * Get users currently editing a specific file
   */
  getUsersInFile(filePath: string): Array<PresenceUser & { color: string }> {
    return this.getOtherUsersWithColors().filter(
      user => user.selection?.filePath === filePath
    );
  }
}

// Singleton instance
export const presenceStore = new PresenceStore();

// HMR setup
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    // Clean up all timers and connections to prevent memory leaks on HMR
    presenceStore.disconnect();
  });
}
