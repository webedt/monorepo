/**
 * SSE Handler Utilities
 *
 * Provides standardized SSE (Server-Sent Events) setup for route handlers.
 * Consolidates duplicated SSE code from executeRemote.ts, resume.ts, and liveChat.ts.
 *
 * Features:
 * - Standard SSE header configuration
 * - Automatic heartbeat management (15-second interval)
 * - Client disconnect detection and cleanup
 * - Connection state tracking
 */

import type { Request, Response } from 'express';
import { ASseHelper, ServiceProvider, SSEWriter } from '@webedt/shared';
import type { SSEWriterOptions } from '@webedt/shared';

/**
 * Options for SSE response setup.
 */
export interface SSESetupOptions {
  /**
   * Correlation/request ID to include in X-Request-ID header.
   * If not provided, the header is not set.
   */
  correlationId?: string;

  /**
   * Additional custom headers to set on the response.
   */
  customHeaders?: Record<string, string>;
}

/**
 * Options for creating an SSE writer with disconnect handling.
 */
export interface SSEWriterWithDisconnectOptions extends SSEWriterOptions {
  /**
   * Callback invoked when the client disconnects.
   * Use this to perform cleanup (unsubscribe from events, clear intervals, etc.)
   */
  onDisconnect?: () => void;
}

/**
 * Set up standard SSE headers on a response.
 *
 * Headers set:
 * - Content-Type: text/event-stream
 * - Cache-Control: no-cache
 * - Connection: keep-alive
 * - X-Accel-Buffering: no (prevents nginx/traefik buffering)
 * - X-Request-ID: <correlationId> (if provided)
 *
 * @example
 * ```typescript
 * setupSSEResponse(res);
 * // or with options
 * setupSSEResponse(res, { correlationId: req.correlationId });
 * ```
 */
export function setupSSEResponse(res: Response, options?: SSESetupOptions): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  if (options?.correlationId) {
    res.setHeader('X-Request-ID', options.correlationId);
  }

  if (options?.customHeaders) {
    for (const [key, value] of Object.entries(options.customHeaders)) {
      res.setHeader(key, value);
    }
  }
}

/**
 * Set up standard SSE headers using writeHead (for 200 status).
 * Useful when you want to send all headers at once.
 *
 * @example
 * ```typescript
 * writeSSEHeaders(res, { correlationId: req.correlationId });
 * ```
 */
export function writeSSEHeaders(res: Response, options?: SSESetupOptions): void {
  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  };

  if (options?.correlationId) {
    headers['X-Request-ID'] = options.correlationId;
  }

  if (options?.customHeaders) {
    Object.assign(headers, options.customHeaders);
  }

  res.writeHead(200, headers);
}

/**
 * Register a callback to be called when the client disconnects.
 *
 * This is useful for cleaning up resources like:
 * - Clearing heartbeat intervals
 * - Unsubscribing from event broadcasters
 * - Setting `clientDisconnected` flags
 *
 * @example
 * ```typescript
 * let clientDisconnected = false;
 * onClientDisconnect(req, () => {
 *   clientDisconnected = true;
 *   unsubscribe();
 * });
 * ```
 */
export function onClientDisconnect(req: Request, callback: () => void): void {
  req.on('close', callback);
}

/**
 * Create a client disconnect tracker.
 *
 * Returns an object with:
 * - `isDisconnected`: Function that returns true if client has disconnected
 * - `cleanup`: Function to call when you're done (optional but good practice)
 *
 * @example
 * ```typescript
 * const disconnect = createDisconnectTracker(req);
 *
 * // In your event loop or async operations:
 * if (disconnect.isDisconnected()) return;
 *
 * // When done:
 * disconnect.cleanup();
 * ```
 */
export function createDisconnectTracker(req: Request): {
  isDisconnected: () => boolean;
  cleanup: () => void;
} {
  let disconnected = false;

  const handler = () => {
    disconnected = true;
  };

  req.on('close', handler);

  return {
    isDisconnected: () => disconnected,
    cleanup: () => {
      req.off('close', handler);
    },
  };
}

/**
 * Create an SSE writer with automatic heartbeat management.
 *
 * This is the recommended approach for SSE routes. The writer:
 * - Sets up SSE headers
 * - Manages 15-second heartbeats automatically
 * - Tracks connection state
 * - Provides type-safe event writing methods
 *
 * @example
 * ```typescript
 * const writer = createSSEWriter(res);
 * writer.setup(); // Set headers
 *
 * writer.writeEvent({ type: 'connected' });
 * writer.writeNamedEvent('status', { phase: 'running' });
 *
 * // When done:
 * writer.end();
 * ```
 */
export function createSSEWriter(res: Response, options?: SSEWriterOptions): SSEWriter {
  const sseHelper = ServiceProvider.get(ASseHelper);
  return SSEWriter.create(res, sseHelper, options);
}

/**
 * Create an SSE writer with client disconnect handling.
 *
 * Extends createSSEWriter with automatic cleanup on client disconnect.
 * The onDisconnect callback is called when the client closes the connection.
 *
 * @example
 * ```typescript
 * const writer = createSSEWriterWithDisconnect(req, res, {
 *   onDisconnect: () => {
 *     unsubscribeFromEvents();
 *     clearInterval(myInterval);
 *   }
 * });
 * writer.setup();
 * ```
 */
export function createSSEWriterWithDisconnect(
  req: Request,
  res: Response,
  options?: SSEWriterWithDisconnectOptions
): SSEWriter {
  const { onDisconnect, ...writerOptions } = options || {};

  const writer = createSSEWriter(res, writerOptions);

  if (onDisconnect) {
    onClientDisconnect(req, onDisconnect);
  }

  return writer;
}

/**
 * Managed heartbeat for SSE connections.
 *
 * If you need more control over heartbeats than SSEWriter provides,
 * use this to create a standalone heartbeat manager.
 *
 * @example
 * ```typescript
 * const heartbeat = createHeartbeat(res, {
 *   intervalMs: 15000,
 *   isDisconnected: () => clientDisconnected
 * });
 *
 * // When done:
 * heartbeat.stop();
 * ```
 */
export function createHeartbeat(
  res: Response,
  options: {
    intervalMs?: number;
    isDisconnected?: () => boolean;
    onError?: (error: unknown) => void;
  } = {}
): { stop: () => void } {
  const intervalMs = options.intervalMs ?? 15000;
  const isDisconnected = options.isDisconnected ?? (() => false);
  const onError = options.onError;

  const intervalId = setInterval(() => {
    if (isDisconnected()) {
      clearInterval(intervalId);
      return;
    }

    try {
      res.write(': heartbeat\n\n');
    } catch (error) {
      if (onError) {
        onError(error);
      }
      clearInterval(intervalId);
    }
  }, intervalMs);

  // Prevent the timer from keeping Node.js event loop active
  intervalId.unref();

  return {
    stop: () => {
      clearInterval(intervalId);
    },
  };
}
