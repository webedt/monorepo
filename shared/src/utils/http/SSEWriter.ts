import { ASseHelper } from './ASseHelper.js';

import type { SseWritable } from './ASseHelper.js';

/**
 * Default heartbeat interval in milliseconds.
 * 15 seconds is chosen to prevent proxy timeouts (Traefik default is 30-60s).
 */
const DEFAULT_HEARTBEAT_INTERVAL_MS = 15000;

/**
 * Configuration options for SSEWriter.
 */
export interface SSEWriterOptions {
  /**
   * Heartbeat interval in milliseconds. Set to 0 to disable heartbeats.
   * Default: 15000 (15 seconds)
   */
  heartbeatIntervalMs?: number;

  /**
   * Whether to automatically start heartbeats when created.
   * Default: true
   */
  autoStartHeartbeat?: boolean;
}

/**
 * SSEWriter provides a stateful wrapper around SSE responses.
 *
 * Features:
 * - Automatic heartbeat management (15-second interval by default)
 * - Connection state tracking
 * - Automatic JSON serialization
 * - Clean resource cleanup
 *
 * Usage:
 * ```typescript
 * const writer = new SSEWriter(res, sseHelper);
 * writer.setup(); // Set SSE headers
 *
 * writer.writeEvent({ type: 'connected', userId: '123' });
 * writer.writeNamedEvent('status', { phase: 'running' });
 *
 * // When done:
 * writer.end();
 * ```
 */
export class SSEWriter {
  private readonly res: SseWritable;
  private readonly helper: ASseHelper;
  private readonly heartbeatIntervalMs: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ended = false;

  constructor(res: SseWritable, helper: ASseHelper, options: SSEWriterOptions = {}) {
    this.res = res;
    this.helper = helper;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;

    const autoStartHeartbeat = options.autoStartHeartbeat ?? true;
    if (autoStartHeartbeat && this.heartbeatIntervalMs > 0) {
      this.startHeartbeat();
    }
  }

  /**
   * Set up SSE headers on the response.
   * Call this before writing any events.
   */
  setup(): void {
    this.helper.setupSse(this.res);
  }

  /**
   * Check if the connection is still writable.
   */
  isWritable(): boolean {
    return !this.ended && this.helper.isWritable(this.res);
  }

  /**
   * Start the heartbeat timer.
   * Heartbeats are sent as SSE comments to keep the connection alive.
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer || this.heartbeatIntervalMs <= 0) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      if (!this.isWritable()) {
        this.stopHeartbeat();
        return;
      }
      this.writeHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  /**
   * Stop the heartbeat timer.
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Write raw data to the stream.
   * Use this only for non-standard SSE formats.
   */
  write(data: string): boolean {
    if (!this.isWritable()) {
      return false;
    }
    return this.helper.write(this.res, data);
  }

  /**
   * Write a data-only SSE event.
   * Format: data: <json>\n\n
   */
  writeEvent(event: Record<string, unknown>): boolean {
    if (!this.isWritable()) {
      return false;
    }
    return this.helper.writeEvent(this.res, event);
  }

  /**
   * Write a named SSE event with explicit event type.
   * Format: event: <type>\ndata: <json>\n\n
   */
  writeNamedEvent(eventType: string, data: Record<string, unknown>): boolean {
    if (!this.isWritable()) {
      return false;
    }
    return this.helper.writeNamedEvent(this.res, eventType, data);
  }

  /**
   * Write a data-only event with an ID for Last-Event-ID support.
   * Format: id: <eventId>\ndata: <json>\n\n
   */
  writeEventWithId(eventId: string, event: Record<string, unknown>): boolean {
    if (!this.isWritable()) {
      return false;
    }
    return this.helper.writeEventWithId(this.res, eventId, event);
  }

  /**
   * Write a named event with an ID for Last-Event-ID support.
   * Format: id: <eventId>\nevent: <type>\ndata: <json>\n\n
   */
  writeNamedEventWithId(eventId: string, eventType: string, data: Record<string, unknown>): boolean {
    if (!this.isWritable()) {
      return false;
    }
    return this.helper.writeNamedEventWithId(this.res, eventId, eventType, data);
  }

  /**
   * Write a heartbeat comment.
   * Format: : heartbeat\n\n
   */
  writeHeartbeat(): boolean {
    if (!this.isWritable()) {
      return false;
    }
    return this.helper.writeHeartbeat(this.res);
  }

  /**
   * Write an SSE comment.
   * Format: : <comment>\n\n
   */
  writeComment(comment: string): boolean {
    if (!this.isWritable()) {
      return false;
    }
    return this.helper.writeComment(this.res, comment);
  }

  /**
   * End the SSE stream and clean up resources.
   */
  end(): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.stopHeartbeat();
    this.helper.end(this.res);
  }

  /**
   * Static factory to create an SSEWriter from a ServiceProvider.
   * Automatically looks up the ASseHelper service.
   *
   * Usage:
   * ```typescript
   * const writer = SSEWriter.create(res, ServiceProvider.get(ASseHelper));
   * ```
   */
  static create(res: SseWritable, helper: ASseHelper, options?: SSEWriterOptions): SSEWriter {
    return new SSEWriter(res, helper, options);
  }
}
