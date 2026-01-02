/**
 * SSE/EventSource Utilities
 * Manages Server-Sent Events connections with retry logic
 */

/** Storage key prefix for lastEventId persistence */
const STORAGE_KEY_PREFIX = 'sse_lastEventId_';

/** TTL for stored lastEventId in milliseconds (5 minutes) */
const LAST_EVENT_ID_TTL_MS = 5 * 60 * 1000;

interface StoredEventId {
  eventId: string;
  timestamp: number;
}

/**
 * Generate a storage key from URL
 * Uses URL pathname to create a unique key per session endpoint
 */
function getStorageKey(url: string): string {
  try {
    // Handle both absolute and relative URLs
    const urlObj = new URL(url, window.location.origin);
    // Use pathname + search params as key (excludes lastEventId param)
    const params = new URLSearchParams(urlObj.search);
    params.delete('lastEventId'); // Remove lastEventId from key generation
    const cleanSearch = params.toString();
    const keyBase = cleanSearch ? `${urlObj.pathname}?${cleanSearch}` : urlObj.pathname;
    return `${STORAGE_KEY_PREFIX}${keyBase}`;
  } catch {
    // Fallback to using URL as-is
    return `${STORAGE_KEY_PREFIX}${url}`;
  }
}

/**
 * Persist lastEventId to sessionStorage with timestamp
 */
function persistLastEventId(url: string, eventId: string): void {
  try {
    const key = getStorageKey(url);
    const data: StoredEventId = {
      eventId,
      timestamp: Date.now(),
    };
    sessionStorage.setItem(key, JSON.stringify(data));
  } catch (error) {
    // sessionStorage may be unavailable (private browsing, quota exceeded)
    console.warn('[SSE] Failed to persist lastEventId:', error);
  }
}

/**
 * Restore lastEventId from sessionStorage if not expired
 */
function restoreLastEventId(url: string): string | null {
  try {
    const key = getStorageKey(url);
    const stored = sessionStorage.getItem(key);
    if (!stored) return null;

    const data: StoredEventId = JSON.parse(stored);
    const age = Date.now() - data.timestamp;

    if (age > LAST_EVENT_ID_TTL_MS) {
      // Expired - remove and return null
      sessionStorage.removeItem(key);
      console.log('[SSE] Stored lastEventId expired, discarding');
      return null;
    }

    console.log('[SSE] Restored lastEventId from storage:', data.eventId);
    return data.eventId;
  } catch (error) {
    console.warn('[SSE] Failed to restore lastEventId:', error);
    return null;
  }
}

/**
 * Clear stored lastEventId for a URL
 */
function clearStoredEventId(url: string): void {
  try {
    const key = getStorageKey(url);
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Clear all stored lastEventIds (for logout)
 */
export function clearAllStoredEventIds(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(STORAGE_KEY_PREFIX)) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      sessionStorage.removeItem(key);
    }
    console.log('[SSE] Cleared all stored lastEventIds');
  } catch {
    // Ignore storage errors
  }
}

export interface SSEOptions {
  /** Called when connection is established */
  onOpen?: () => void;
  /** Called for each message event */
  onMessage?: (event: MessageEvent) => void;
  /** Called for typed events (e.g., 'message', 'error', 'completed') */
  onEvent?: (type: string, data: unknown) => void;
  /** Called on error */
  onError?: (error: Event) => void;
  /** Called when connection closes */
  onClose?: () => void;
  /** Auto-reconnect on error */
  reconnect?: boolean;
  /** Max reconnect attempts (default: 5) */
  maxRetries?: number;
  /** Base delay between retries in ms (default: 1000) */
  retryDelay?: number;
  /** Event types to listen for (default: all) */
  eventTypes?: string[];
  /** Clear stored lastEventId when connection closes (default: false) */
  clearStorageOnClose?: boolean;
}

export class EventSourceManager {
  private url: string;
  private options: SSEOptions;
  private eventSource: EventSource | null = null;
  private retryCount = 0;
  private pendingTimeouts: number[] = [];
  private isClosed = false;
  private lastEventId: string | null = null;
  /** Track registered event listeners for proper cleanup */
  private registeredListeners: Array<{ type: string; handler: EventListener }> = [];

  constructor(url: string, options: SSEOptions = {}) {
    this.url = url;
    this.options = {
      reconnect: true,
      maxRetries: 5,
      retryDelay: 1000,
      clearStorageOnClose: false,
      ...options,
    };

    // Restore lastEventId from sessionStorage for seamless resume across page reloads
    this.lastEventId = restoreLastEventId(url);
  }

  /**
   * Connect to the SSE endpoint
   */
  connect(): void {
    if (this.eventSource) {
      this.close();
    }

    this.isClosed = false;

    // Include Last-Event-ID as query parameter for reliable resumption after reconnect
    // This allows the server to resume from where the client left off
    let connectUrl = this.url;
    if (this.lastEventId) {
      const separator = this.url.includes('?') ? '&' : '?';
      connectUrl = `${this.url}${separator}lastEventId=${encodeURIComponent(this.lastEventId)}`;
      console.log('[SSE] Reconnecting with Last-Event-ID:', this.lastEventId);
    } else {
      console.log('[SSE] Connecting to:', this.url);
    }

    this.eventSource = new EventSource(connectUrl, { withCredentials: true });

    this.eventSource.onopen = () => {
      console.log('[SSE] Connected');
      this.retryCount = 0;
      this.options.onOpen?.();
    };

    this.eventSource.onmessage = (event) => {
      // Track last event ID for reliable resumption on reconnect and page reload
      if (event.lastEventId) {
        this.lastEventId = event.lastEventId;
        persistLastEventId(this.url, event.lastEventId);
      }
      this.options.onMessage?.(event);
      this.handleEventData('message', event.data);
    };

    this.eventSource.onerror = (error) => {
      console.error('[SSE] Error:', error);
      this.options.onError?.(error);

      // Check if connection is closed
      if (this.eventSource?.readyState === EventSource.CLOSED) {
        this.handleDisconnect();
      }
    };

    // Listen for specific event types
    const eventTypes = this.options.eventTypes || [
      'connected',
      'message',
      'session_name',
      'assistant_message',
      'tool_use',
      'tool_result',
      'completed',
      'error',
    ];

    // Clear any previously registered listeners
    this.registeredListeners = [];

    for (const type of eventTypes) {
      const handler: EventListener = (evt: Event) => {
        const event = evt as MessageEvent;
        // Track last event ID for reliable resumption on reconnect and page reload
        if (event.lastEventId) {
          this.lastEventId = event.lastEventId;
          persistLastEventId(this.url, event.lastEventId);
        }
        this.handleEventData(type, event.data);
      };
      this.eventSource.addEventListener(type, handler);
      // Track for cleanup
      this.registeredListeners.push({ type, handler });
    }
  }

  /**
   * Handle event data parsing and dispatch
   */
  private handleEventData(type: string, rawData: string): void {
    try {
      const data = JSON.parse(rawData);
      this.options.onEvent?.(type, data);
    } catch {
      // If not JSON, pass as string
      this.options.onEvent?.(type, rawData);
    }
  }

  /**
   * Clear all pending reconnect timeouts to prevent memory leaks
   */
  private clearPendingTimeouts(): void {
    for (const timeoutId of this.pendingTimeouts) {
      clearTimeout(timeoutId);
    }
    this.pendingTimeouts = [];
  }

  /**
   * Handle disconnect with optional retry
   */
  private handleDisconnect(): void {
    if (this.isClosed) return;

    this.options.onClose?.();

    if (this.options.reconnect && this.retryCount < (this.options.maxRetries || 5)) {
      // Clear any existing pending timeouts before scheduling a new one
      // This prevents timeout stacking during rapid disconnect/reconnect cycles
      this.clearPendingTimeouts();

      const delay = (this.options.retryDelay || 1000) * Math.pow(2, this.retryCount);
      console.log(`[SSE] Reconnecting in ${delay}ms (attempt ${this.retryCount + 1})`);

      const timeoutId = window.setTimeout(() => {
        // Remove this timeout from tracking since it fired
        this.pendingTimeouts = this.pendingTimeouts.filter(id => id !== timeoutId);
        this.retryCount++;
        this.connect();
      }, delay);

      // Track the new timeout
      this.pendingTimeouts.push(timeoutId);
    }
  }

  /**
   * Close the connection and clean up all resources
   * @param clearStorage - Override clearStorageOnClose option for this call
   */
  close(clearStorage?: boolean): void {
    this.isClosed = true;

    // Clear ALL pending reconnect timeouts to prevent memory leaks
    this.clearPendingTimeouts();

    if (this.eventSource) {
      // Remove all registered event listeners to prevent memory leaks
      for (const { type, handler } of this.registeredListeners) {
        this.eventSource.removeEventListener(type, handler);
      }
      this.registeredListeners = [];

      this.eventSource.close();
      this.eventSource = null;
      console.log('[SSE] Closed');
    }

    // Clear storage if requested (explicit param or option)
    const shouldClearStorage = clearStorage ?? this.options.clearStorageOnClose;
    if (shouldClearStorage) {
      clearStoredEventId(this.url);
      console.log('[SSE] Cleared stored lastEventId');
    }

    // Reset state for potential reuse
    this.retryCount = 0;
    this.lastEventId = null;
  }

  /**
   * Clear the stored lastEventId without closing the connection
   * Useful for explicit session completion
   */
  clearStoredEventId(): void {
    clearStoredEventId(this.url);
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.eventSource?.readyState === EventSource.OPEN;
  }

  /**
   * Get connection state
   */
  getState(): 'connecting' | 'open' | 'closed' {
    if (!this.eventSource) return 'closed';
    switch (this.eventSource.readyState) {
      case EventSource.CONNECTING:
        return 'connecting';
      case EventSource.OPEN:
        return 'open';
      default:
        return 'closed';
    }
  }
}

/**
 * Create a simple one-shot SSE connection
 * Useful for execution endpoints that complete
 */
export function createSSEConnection(
  url: string,
  handlers: {
    onEvent: (type: string, data: unknown) => void;
    onComplete?: () => void;
    onError?: (error: string) => void;
  }
): { close: () => void } {
  const manager = new EventSourceManager(url, {
    reconnect: false,
    onEvent: (type, data) => {
      handlers.onEvent(type, data);

      // Auto-close on completion or error
      if (type === 'completed' || type === 'error') {
        if (type === 'error') {
          const errorMsg = typeof data === 'object' && data !== null && 'message' in data
            ? String((data as { message: string }).message)
            : 'Unknown error';
          handlers.onError?.(errorMsg);
        } else {
          handlers.onComplete?.();
        }
        // Clear storage on completion/error since session is done
        manager.close(true);
      }
    },
    onClose: () => {
      handlers.onComplete?.();
    },
    onError: () => {
      handlers.onError?.('Connection error');
    },
  });

  manager.connect();

  return {
    close: () => manager.close(true),
  };
}

/**
 * Event type definitions for execution events
 */
export interface ExecutionEventHandlers {
  onConnected?: () => void;
  onMessage?: (content: string, stage?: string, emoji?: string) => void;
  onSessionName?: (name: string) => void;
  onAssistantMessage?: (content: string) => void;
  onToolUse?: (tool: string, input: unknown) => void;
  onToolResult?: (result: unknown) => void;
  onCompleted?: () => void;
  onError?: (error: string) => void;
}

/**
 * Create an execution SSE connection with typed handlers
 */
export function createExecutionConnection(
  url: string,
  handlers: ExecutionEventHandlers
): { close: () => void } {
  return createSSEConnection(url, {
    onEvent: (type, data) => {
      const eventData = data as Record<string, unknown>;

      switch (type) {
        case 'connected':
          handlers.onConnected?.();
          break;
        case 'message':
          handlers.onMessage?.(
            String(eventData.content || ''),
            eventData.stage as string | undefined,
            eventData.emoji as string | undefined
          );
          break;
        case 'session_name':
          handlers.onSessionName?.(String(eventData.name || eventData.content || ''));
          break;
        case 'assistant_message':
          handlers.onAssistantMessage?.(String(eventData.content || ''));
          break;
        case 'tool_use':
          handlers.onToolUse?.(
            String(eventData.tool || eventData.name || ''),
            eventData.input
          );
          break;
        case 'tool_result':
          handlers.onToolResult?.(eventData.result || eventData);
          break;
        case 'completed':
          handlers.onCompleted?.();
          break;
        case 'error':
          handlers.onError?.(String(eventData.message || eventData.error || 'Unknown error'));
          break;
      }
    },
    onComplete: handlers.onCompleted,
    onError: handlers.onError,
  });
}
