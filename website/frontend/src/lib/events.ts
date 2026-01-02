/**
 * SSE/EventSource Utilities
 * Manages Server-Sent Events connections with retry logic and stream recovery
 *
 * Features:
 * - Connection state management with auto-reconnect
 * - Event buffering with sequence validation
 * - Gap detection and automatic replay requests
 * - Connection quality monitoring
 * - Last-Event-ID persistence for reliable resumption
 */

/** Storage key prefix for lastEventId persistence */
const STORAGE_KEY_PREFIX = 'sse_lastEventId_';

/** TTL for stored lastEventId in milliseconds (5 minutes) */
const LAST_EVENT_ID_TTL_MS = 5 * 60 * 1000;

/** Maximum events to buffer for sequence validation */
const MAX_EVENT_BUFFER_SIZE = 100;

/** Time window to check for gaps (ms) */
const GAP_DETECTION_WINDOW_MS = 5000;

/** Minimum time between replay requests to avoid flooding (ms) */
const MIN_REPLAY_REQUEST_INTERVAL_MS = 2000;

interface StoredEventId {
  eventId: string;
  timestamp: number;
}

/** Connection quality states */
export type ConnectionQuality = 'excellent' | 'good' | 'poor' | 'disconnected';

/** Connection quality metrics */
export interface ConnectionMetrics {
  /** Current connection quality */
  quality: ConnectionQuality;
  /** Number of reconnection attempts */
  reconnectAttempts: number;
  /** Total events received in current session */
  eventsReceived: number;
  /** Number of events that were replayed (recovered) */
  eventsReplayed: number;
  /** Number of detected gaps */
  gapsDetected: number;
  /** Last event ID received */
  lastEventId: string | null;
  /** Latency estimate (ms) based on heartbeat */
  latencyMs: number | null;
  /** Whether currently replaying events */
  isReplaying: boolean;
  /** Time of last successful event */
  lastEventTime: number | null;
}

/** Buffered event for sequence tracking */
interface BufferedEvent {
  id: string;
  sequenceNumber: number;
  type: string;
  data: unknown;
  timestamp: number;
}

/** Event buffer for sequence validation and gap detection */
class EventBuffer {
  private buffer: BufferedEvent[] = [];
  private lastProcessedSequence: number = 0;
  private gapsDetected: number = 0;

  /**
   * Add an event to the buffer and check for gaps
   * @returns true if a gap was detected
   */
  add(eventId: string, type: string, data: unknown): { hasGap: boolean; missingFrom?: number; missingTo?: number } {
    // Parse sequence number from event ID (expected format: numeric ID or "sequence_X")
    const sequenceNumber = this.parseSequenceNumber(eventId);
    if (sequenceNumber === null) {
      // Non-sequential event, just track it
      this.buffer.push({
        id: eventId,
        sequenceNumber: -1,
        type,
        data,
        timestamp: Date.now(),
      });
      this.trimBuffer();
      return { hasGap: false };
    }

    const expectedSequence = this.lastProcessedSequence + 1;
    const hasGap = this.lastProcessedSequence > 0 && sequenceNumber > expectedSequence;

    if (hasGap) {
      this.gapsDetected++;
    }

    this.buffer.push({
      id: eventId,
      sequenceNumber,
      type,
      data,
      timestamp: Date.now(),
    });

    this.lastProcessedSequence = Math.max(this.lastProcessedSequence, sequenceNumber);
    this.trimBuffer();

    return hasGap
      ? { hasGap: true, missingFrom: expectedSequence, missingTo: sequenceNumber - 1 }
      : { hasGap: false };
  }

  /**
   * Parse sequence number from event ID
   */
  private parseSequenceNumber(eventId: string): number | null {
    // Direct numeric ID (database ID)
    const numericId = parseInt(eventId, 10);
    if (!isNaN(numericId) && numericId > 0) {
      return numericId;
    }

    // Format: "sequence_X" or similar
    const match = eventId.match(/(?:sequence[_-])?(\d+)/i);
    if (match) {
      return parseInt(match[1], 10);
    }

    return null;
  }

  /**
   * Keep buffer size manageable
   */
  private trimBuffer(): void {
    if (this.buffer.length > MAX_EVENT_BUFFER_SIZE) {
      this.buffer = this.buffer.slice(-MAX_EVENT_BUFFER_SIZE);
    }
  }

  /**
   * Get the last known sequence number
   */
  getLastSequence(): number {
    return this.lastProcessedSequence;
  }

  /**
   * Get total gaps detected
   */
  getGapsDetected(): number {
    return this.gapsDetected;
  }

  /**
   * Reset the buffer (e.g., on new connection)
   */
  reset(): void {
    this.buffer = [];
    this.lastProcessedSequence = 0;
  }

  /**
   * Check if there are recent events (for staleness detection)
   */
  hasRecentEvents(windowMs: number = GAP_DETECTION_WINDOW_MS): boolean {
    if (this.buffer.length === 0) return false;
    const latest = this.buffer[this.buffer.length - 1];
    return Date.now() - latest.timestamp < windowMs;
  }
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
  /** Called when connection quality changes */
  onQualityChange?: (quality: ConnectionQuality, metrics: ConnectionMetrics) => void;
  /** Called when a gap is detected in event sequence */
  onGapDetected?: (fromId: number, toId: number) => void;
  /** Called during replay (recovery) of missed events */
  onReplayStart?: (fromEventId: string) => void;
  /** Called when replay completes */
  onReplayEnd?: (eventsReplayed: number) => void;
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
  /** Enable automatic gap detection and replay (default: true) */
  enableGapDetection?: boolean;
  /** Session ID for replay requests */
  sessionId?: string;
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
  /** Event buffer for sequence tracking and gap detection */
  private eventBuffer: EventBuffer = new EventBuffer();
  /** Connection quality metrics */
  private metrics: ConnectionMetrics = {
    quality: 'disconnected',
    reconnectAttempts: 0,
    eventsReceived: 0,
    eventsReplayed: 0,
    gapsDetected: 0,
    lastEventId: null,
    latencyMs: null,
    isReplaying: false,
    lastEventTime: null,
  };
  /** Last time a replay was requested (to prevent flooding) */
  private lastReplayRequestTime: number = 0;
  /** Heartbeat check interval */
  private heartbeatCheckInterval: number | null = null;
  /** Last known quality for change detection */
  private lastReportedQuality: ConnectionQuality = 'disconnected';

  constructor(url: string, options: SSEOptions = {}) {
    this.url = url;
    this.options = {
      reconnect: true,
      maxRetries: 5,
      retryDelay: 1000,
      clearStorageOnClose: false,
      enableGapDetection: true,
      ...options,
    };

    // Restore lastEventId from sessionStorage for seamless resume across page reloads
    this.lastEventId = restoreLastEventId(url);
    this.metrics.lastEventId = this.lastEventId;
  }

  /**
   * Get current connection metrics
   */
  getMetrics(): ConnectionMetrics {
    return { ...this.metrics };
  }

  /**
   * Update connection quality based on current state
   */
  private updateConnectionQuality(): void {
    let quality: ConnectionQuality;

    if (!this.eventSource || this.eventSource.readyState === EventSource.CLOSED) {
      quality = 'disconnected';
    } else if (this.eventSource.readyState === EventSource.CONNECTING) {
      quality = 'poor';
    } else if (this.retryCount > 2 || this.metrics.gapsDetected > 2) {
      quality = 'poor';
    } else if (this.retryCount > 0 || this.metrics.gapsDetected > 0) {
      quality = 'good';
    } else {
      quality = 'excellent';
    }

    this.metrics.quality = quality;

    // Notify if quality changed
    if (quality !== this.lastReportedQuality) {
      this.lastReportedQuality = quality;
      this.options.onQualityChange?.(quality, this.getMetrics());
    }
  }

  /**
   * Request replay of missing events from server
   */
  private async requestReplay(fromEventId: string): Promise<void> {
    const now = Date.now();
    if (now - this.lastReplayRequestTime < MIN_REPLAY_REQUEST_INTERVAL_MS) {
      console.log('[SSE] Skipping replay request - too soon after last request');
      return;
    }

    this.lastReplayRequestTime = now;
    this.metrics.isReplaying = true;
    this.options.onReplayStart?.(fromEventId);

    try {
      // Extract session ID from URL or use provided sessionId
      const sessionId = this.options.sessionId || this.extractSessionId();
      if (!sessionId) {
        console.warn('[SSE] Cannot request replay: no session ID available');
        return;
      }

      // Request replay from server
      const replayUrl = `/api/resume/resume/${sessionId}?lastEventId=${encodeURIComponent(fromEventId)}`;
      console.log('[SSE] Requesting replay from:', replayUrl);

      const response = await fetch(replayUrl, { credentials: 'include' });
      if (!response.ok) {
        console.error('[SSE] Replay request failed:', response.status);
        return;
      }

      // The replay will come through the SSE stream - we just need to trigger it
      // Actually for reconnection, we already pass lastEventId in the URL
      // This method is for explicit replay requests when we detect a gap
      console.log('[SSE] Replay requested successfully');
    } catch (error) {
      console.error('[SSE] Error requesting replay:', error);
    } finally {
      this.metrics.isReplaying = false;
    }
  }

  /**
   * Extract session ID from URL
   */
  private extractSessionId(): string | null {
    try {
      const urlObj = new URL(this.url, window.location.origin);
      // Try to match /resume/:sessionId or /sessions/:sessionId patterns
      const match = urlObj.pathname.match(/\/(?:resume|sessions)\/([^/]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }

  /**
   * Start heartbeat monitoring for connection quality
   */
  private startHeartbeatMonitoring(): void {
    this.stopHeartbeatMonitoring();
    this.heartbeatCheckInterval = window.setInterval(() => {
      this.checkConnectionHealth();
    }, 5000);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeatMonitoring(): void {
    if (this.heartbeatCheckInterval !== null) {
      clearInterval(this.heartbeatCheckInterval);
      this.heartbeatCheckInterval = null;
    }
  }

  /**
   * Check connection health based on recent activity
   */
  private checkConnectionHealth(): void {
    // If we haven't received any events recently and connection is supposedly open
    if (this.eventSource?.readyState === EventSource.OPEN) {
      const timeSinceLastEvent = this.metrics.lastEventTime
        ? Date.now() - this.metrics.lastEventTime
        : null;

      // If no events in 30 seconds (and heartbeats should be every 15s), consider it poor
      if (timeSinceLastEvent && timeSinceLastEvent > 30000) {
        if (this.metrics.quality !== 'poor') {
          this.metrics.quality = 'poor';
          this.options.onQualityChange?.('poor', this.getMetrics());
        }
      }
    }
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
      this.metrics.reconnectAttempts = this.retryCount;
      this.updateConnectionQuality();
      this.startHeartbeatMonitoring();
      this.options.onOpen?.();
    };

    this.eventSource.onmessage = (event) => {
      // Track last event ID for reliable resumption on reconnect and page reload
      if (event.lastEventId) {
        this.trackEventId(event.lastEventId, 'message', event.data);
      }
      this.metrics.lastEventTime = Date.now();
      this.options.onMessage?.(event);
      this.handleEventData('message', event.data);
    };

    this.eventSource.onerror = (error) => {
      console.error('[SSE] Error:', error);
      this.updateConnectionQuality();
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
      'replay_start',
      'replay_end',
      'heartbeat',
    ];

    // Clear any previously registered listeners
    this.registeredListeners = [];

    for (const type of eventTypes) {
      const handler: EventListener = (evt: Event) => {
        const event = evt as MessageEvent;
        this.metrics.lastEventTime = Date.now();
        this.metrics.eventsReceived++;

        // Handle special event types
        if (type === 'replay_start') {
          this.metrics.isReplaying = true;
          this.options.onReplayStart?.(this.lastEventId || '0');
        } else if (type === 'replay_end') {
          this.metrics.isReplaying = false;
          try {
            const data = JSON.parse(event.data);
            this.metrics.eventsReplayed += data.totalEvents || 0;
            this.options.onReplayEnd?.(data.totalEvents || 0);
          } catch {
            this.options.onReplayEnd?.(0);
          }
        } else if (type === 'heartbeat') {
          // Update latency estimate if we can calculate it
          this.updateConnectionQuality();
        }

        // Track last event ID for reliable resumption on reconnect and page reload
        if (event.lastEventId) {
          this.trackEventId(event.lastEventId, type, event.data);
        }
        this.handleEventData(type, event.data);
      };
      this.eventSource.addEventListener(type, handler);
      // Track for cleanup
      this.registeredListeners.push({ type, handler });
    }
  }

  /**
   * Track event ID and check for gaps
   */
  private trackEventId(eventId: string, type: string, data: unknown): void {
    this.lastEventId = eventId;
    this.metrics.lastEventId = eventId;
    persistLastEventId(this.url, eventId);

    // Check for gaps if enabled
    if (this.options.enableGapDetection) {
      const result = this.eventBuffer.add(eventId, type, data);
      if (result.hasGap && result.missingFrom !== undefined && result.missingTo !== undefined) {
        console.warn(`[SSE] Gap detected: missing events from ${result.missingFrom} to ${result.missingTo}`);
        this.metrics.gapsDetected++;
        this.options.onGapDetected?.(result.missingFrom, result.missingTo);
        this.updateConnectionQuality();

        // Auto-request replay if we have a session ID
        if (this.options.sessionId || this.extractSessionId()) {
          this.requestReplay(String(result.missingFrom - 1));
        }
      }
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

    this.stopHeartbeatMonitoring();
    this.updateConnectionQuality();
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
        this.metrics.reconnectAttempts = this.retryCount;
        this.updateConnectionQuality();
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

    // Stop heartbeat monitoring
    this.stopHeartbeatMonitoring();

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
    this.eventBuffer.reset();

    // Update metrics to show disconnected state
    this.metrics.quality = 'disconnected';
    this.metrics.lastEventId = null;
    this.updateConnectionQuality();
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
