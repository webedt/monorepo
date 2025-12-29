/**
 * SSE/EventSource Utilities
 * Manages Server-Sent Events connections with retry logic
 */

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
}

export class EventSourceManager {
  private url: string;
  private options: SSEOptions;
  private eventSource: EventSource | null = null;
  private retryCount = 0;
  private pendingTimeouts: number[] = [];
  private isClosed = false;
  private lastEventId: string | null = null;

  constructor(url: string, options: SSEOptions = {}) {
    this.url = url;
    this.options = {
      reconnect: true,
      maxRetries: 5,
      retryDelay: 1000,
      ...options,
    };
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
      // Track last event ID for reliable resumption on reconnect
      if (event.lastEventId) {
        this.lastEventId = event.lastEventId;
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

    for (const type of eventTypes) {
      this.eventSource.addEventListener(type, (event: MessageEvent) => {
        // Track last event ID for reliable resumption on reconnect
        if (event.lastEventId) {
          this.lastEventId = event.lastEventId;
        }
        this.handleEventData(type, event.data);
      });
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
   */
  close(): void {
    this.isClosed = true;

    // Clear ALL pending reconnect timeouts to prevent memory leaks
    this.clearPendingTimeouts();

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
      console.log('[SSE] Closed');
    }

    // Reset state for potential reuse
    this.retryCount = 0;
    this.lastEventId = null;
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
        manager.close();
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
    close: () => manager.close(),
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
