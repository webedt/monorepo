/**
 * Custom Span Helpers for Distributed Tracing
 *
 * Provides utilities for creating trace spans around:
 * - SSE (Server-Sent Events) streams
 * - Claude Remote API calls
 * - Database operations
 * - Custom business logic
 */

import { trace, context, SpanKind, SpanStatusCode } from '@opentelemetry/api';

import type { Span, Tracer, Context } from '@opentelemetry/api';
import type { Request, Response } from 'express';

/** Cached tracer instance (lazy initialized after SDK starts) */
let cachedTracer: Tracer | null = null;

/**
 * Get the tracer instance, lazily initialized after SDK starts.
 * This ensures the tracer is created after initializeTelemetry() is called.
 */
function getTracerInstance(): Tracer {
  if (!cachedTracer) {
    cachedTracer = trace.getTracer('webedt-backend');
  }
  return cachedTracer;
}

/**
 * Standard attribute names for WebEDT spans
 *
 * Note: User email is intentionally omitted to avoid PII in trace data.
 * Use user ID for correlation; email can be looked up from the database if needed.
 */
export const SpanAttributes = {
  // Session attributes
  SESSION_ID: 'webedt.session.id',
  SESSION_REMOTE_ID: 'webedt.session.remote_id',
  SESSION_STATUS: 'webedt.session.status',
  SESSION_BRANCH: 'webedt.session.branch',

  // User attributes (ID only - no PII)
  USER_ID: 'webedt.user.id',

  // SSE attributes
  SSE_EVENT_TYPE: 'webedt.sse.event_type',
  SSE_EVENT_COUNT: 'webedt.sse.event_count',
  SSE_STREAM_DURATION_MS: 'webedt.sse.duration_ms',

  // Claude Remote attributes
  CLAUDE_OPERATION: 'webedt.claude.operation',
  CLAUDE_MODEL: 'webedt.claude.model',
  CLAUDE_ENVIRONMENT_ID: 'webedt.claude.environment_id',

  // GitHub attributes
  GITHUB_OPERATION: 'webedt.github.operation',
  GITHUB_REPO: 'webedt.github.repo',
  GITHUB_BRANCH: 'webedt.github.branch',

  // Request correlation
  CORRELATION_ID: 'webedt.correlation_id',
} as const;

/**
 * Get the current tracer instance
 */
export function getTracer(): Tracer {
  return getTracerInstance();
}

/**
 * Get the current active span from context
 */
export function getCurrentSpan(): Span | undefined {
  return trace.getActiveSpan();
}

/**
 * Add correlation ID to the current span
 */
export function addCorrelationIdToSpan(correlationId: string): void {
  const span = getCurrentSpan();
  if (span) {
    span.setAttribute(SpanAttributes.CORRELATION_ID, correlationId);
  }
}

/**
 * Create a new span for SSE stream handling
 *
 * @param name - Span name (e.g., 'sse.stream.session_events')
 * @param sessionId - The session ID being streamed
 * @param req - Express request for extracting context
 * @returns Span and context for the SSE stream
 */
export function startSseSpan(
  name: string,
  sessionId: string,
  req: Request
): { span: Span; ctx: Context } {
  const span = getTracerInstance().startSpan(name, {
    kind: SpanKind.SERVER,
    attributes: {
      [SpanAttributes.SESSION_ID]: sessionId,
      [SpanAttributes.CORRELATION_ID]: req.correlationId,
      'http.method': req.method,
      'http.url': req.originalUrl,
    },
  });

  // Create a new context with this span as the active span
  const ctx = trace.setSpan(context.active(), span);

  return { span, ctx };
}

/**
 * SSE Stream Span Manager
 *
 * Manages the lifecycle of a span for an SSE stream, tracking events
 * and duration until the stream is closed.
 */
export class SseSpanManager {
  private span: Span;
  private eventCount = 0;
  private startTime: number;
  private closed = false;

  constructor(span: Span) {
    this.span = span;
    this.startTime = Date.now();
  }

  /**
   * Record an SSE event being sent
   */
  recordEvent(eventType: string): void {
    if (this.closed) return;

    this.eventCount++;
    this.span.addEvent('sse.event', {
      [SpanAttributes.SSE_EVENT_TYPE]: eventType,
      'event.index': this.eventCount,
    });
  }

  /**
   * Record stream replay phase start
   */
  recordReplayStart(storedEventCount: number): void {
    if (this.closed) return;

    this.span.addEvent('sse.replay.start', {
      'replay.stored_event_count': storedEventCount,
    });
  }

  /**
   * Record stream replay phase complete
   */
  recordReplayComplete(): void {
    if (this.closed) return;

    this.span.addEvent('sse.replay.complete');
  }

  /**
   * Record live streaming phase start
   */
  recordLiveStreamStart(): void {
    if (this.closed) return;

    this.span.addEvent('sse.live.start');
  }

  /**
   * Set session status on span
   */
  setSessionStatus(status: string): void {
    if (this.closed) return;

    this.span.setAttribute(SpanAttributes.SESSION_STATUS, status);
  }

  /**
   * Set user ID on span (email omitted to avoid PII in traces)
   */
  setUser(userId: string): void {
    if (this.closed) return;

    this.span.setAttribute(SpanAttributes.USER_ID, userId);
  }

  /**
   * Record an error in the stream
   */
  recordError(error: Error | string): void {
    if (this.closed) return;

    const message = typeof error === 'string' ? error : error.message;
    this.span.setStatus({
      code: SpanStatusCode.ERROR,
      message,
    });
    this.span.recordException(typeof error === 'string' ? new Error(error) : error);
  }

  /**
   * End the span (call when stream closes)
   */
  end(success = true): void {
    if (this.closed) return;
    this.closed = true;

    const durationMs = Date.now() - this.startTime;

    this.span.setAttribute(SpanAttributes.SSE_EVENT_COUNT, this.eventCount);
    this.span.setAttribute(SpanAttributes.SSE_STREAM_DURATION_MS, durationMs);

    if (success) {
      this.span.setStatus({ code: SpanStatusCode.OK });
    }

    this.span.end();
  }
}

/**
 * Create a span for Claude Remote API operations
 *
 * @param operation - Operation name (e.g., 'createSession', 'sendMessage')
 * @param attributes - Additional attributes
 * @returns Span for the Claude operation
 */
export function startClaudeSpan(
  operation: string,
  attributes: Record<string, string | number | boolean> = {}
): Span {
  return getTracerInstance().startSpan(`claude.${operation}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [SpanAttributes.CLAUDE_OPERATION]: operation,
      ...attributes,
    },
  });
}

/**
 * Create a span for GitHub operations
 *
 * @param operation - Operation name (e.g., 'cloneRepo', 'createBranch')
 * @param repo - Repository name (owner/repo format)
 * @param attributes - Additional attributes
 * @returns Span for the GitHub operation
 */
export function startGitHubSpan(
  operation: string,
  repo: string,
  attributes: Record<string, string | number | boolean> = {}
): Span {
  return getTracerInstance().startSpan(`github.${operation}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      [SpanAttributes.GITHUB_OPERATION]: operation,
      [SpanAttributes.GITHUB_REPO]: repo,
      ...attributes,
    },
  });
}

/**
 * Create a span for database operations
 *
 * This is typically handled by auto-instrumentation, but can be used
 * for custom database operations or batch operations.
 *
 * @param operation - Operation name (e.g., 'findSession', 'updateStatus')
 * @param table - Table name
 * @param attributes - Additional attributes
 * @returns Span for the database operation
 */
export function startDbSpan(
  operation: string,
  table: string,
  attributes: Record<string, string | number | boolean> = {}
): Span {
  return getTracerInstance().startSpan(`db.${operation}`, {
    kind: SpanKind.CLIENT,
    attributes: {
      'db.system': 'postgresql',
      'db.operation': operation,
      'db.sql.table': table,
      ...attributes,
    },
  });
}

/**
 * Execute a function within a new span context
 *
 * @param name - Span name
 * @param fn - Function to execute
 * @param attributes - Additional span attributes
 * @returns Result of the function
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes: Record<string, string | number | boolean> = {}
): Promise<T> {
  const span = getTracerInstance().startSpan(name, { attributes });

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Execute a synchronous function within a new span context
 *
 * @param name - Span name
 * @param fn - Function to execute
 * @param attributes - Additional span attributes
 * @returns Result of the function
 */
export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  attributes: Record<string, string | number | boolean> = {}
): T {
  const span = getTracerInstance().startSpan(name, { attributes });

  try {
    const result = context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error instanceof Error ? error.message : String(error),
    });
    span.recordException(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    span.end();
  }
}

/**
 * Propagate trace context through SSE response headers
 *
 * This allows clients to continue the trace on subsequent requests.
 *
 * @param res - Express response object
 */
export function propagateTraceContext(res: Response): void {
  const span = getCurrentSpan();
  if (!span) return;

  const spanContext = span.spanContext();
  if (spanContext.traceId && spanContext.spanId) {
    // Set W3C Trace Context headers
    const traceParent = `00-${spanContext.traceId}-${spanContext.spanId}-${spanContext.traceFlags.toString(16).padStart(2, '0')}`;
    res.setHeader('traceparent', traceParent);
  }
}

/**
 * Extract trace context from request headers for context propagation
 *
 * @param req - Express request object
 * @returns Extracted trace context or undefined
 */
export function extractTraceContext(req: Request): { traceId: string; spanId: string; traceFlags: number } | undefined {
  const traceParent = req.headers['traceparent'];
  if (typeof traceParent !== 'string') return undefined;

  // Parse W3C Trace Context format: version-traceid-spanid-flags
  const match = traceParent.match(/^00-([a-f0-9]{32})-([a-f0-9]{16})-([a-f0-9]{2})$/);
  if (!match) return undefined;

  return {
    traceId: match[1],
    spanId: match[2],
    traceFlags: parseInt(match[3], 16),
  };
}
