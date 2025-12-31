/**
 * Telemetry Middleware
 *
 * Integrates OpenTelemetry spans with the existing correlation ID middleware,
 * ensuring trace context is properly linked to request correlation IDs.
 */

import { trace, context, propagation } from '@opentelemetry/api';

import type { Request, Response, NextFunction } from 'express';
import type { Span } from '@opentelemetry/api';
import { SpanAttributes, propagateTraceContext } from './spans.js';

/**
 * Middleware to link correlation IDs with trace context
 *
 * This middleware should be applied AFTER the correlationIdMiddleware
 * to ensure req.correlationId is available.
 *
 * It performs the following:
 * 1. Adds correlation ID as a span attribute to the current span
 * 2. Extracts incoming trace context from headers (W3C Trace Context)
 * 3. Sets trace context response headers for downstream propagation
 */
export function telemetryMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Get the current span created by auto-instrumentation
  const span = trace.getActiveSpan();

  if (span) {
    // Link correlation ID to the trace span
    if (req.correlationId) {
      span.setAttribute(SpanAttributes.CORRELATION_ID, req.correlationId);
    }

    // Add user context if available (from auth middleware)
    // Note: authMiddleware runs before this, so req.user may be set
    const user = (req as Request & { user?: { id: string; email?: string } }).user;
    if (user) {
      span.setAttribute(SpanAttributes.USER_ID, user.id);
      if (user.email) {
        span.setAttribute(SpanAttributes.USER_EMAIL, user.email);
      }
    }

    // Propagate trace context in response headers
    propagateTraceContext(res);
  }

  next();
}

/**
 * Create a child span that inherits context from the current request
 *
 * This is useful for creating spans for sub-operations within a request handler.
 *
 * @param name - Span name
 * @param attributes - Additional span attributes
 * @returns The created span
 */
export function createRequestSpan(
  name: string,
  req: Request,
  attributes: Record<string, string | number | boolean> = {}
): Span {
  const tracer = trace.getTracer('webedt-backend');

  const span = tracer.startSpan(name, {
    attributes: {
      [SpanAttributes.CORRELATION_ID]: req.correlationId,
      ...attributes,
    },
  });

  return span;
}

/**
 * Inject trace context into headers for outbound requests
 *
 * Use this when making HTTP requests to external services to propagate
 * the trace context.
 *
 * @param headers - Headers object to inject trace context into
 * @returns Modified headers with trace context
 */
export function injectTraceContext(
  headers: Record<string, string>
): Record<string, string> {
  const carrier: Record<string, string> = { ...headers };

  // Use the W3C Trace Context propagator
  propagation.inject(context.active(), carrier, {
    set(carrier, key, value) {
      carrier[key] = value;
    },
  });

  return carrier;
}

/**
 * Extract trace context from incoming request headers
 *
 * Use this to continue a trace from an upstream service.
 *
 * @param headers - Request headers
 * @returns Context with extracted trace information
 */
export function extractTraceContextFromHeaders(
  headers: Record<string, string | string[] | undefined>
): ReturnType<typeof context.active> {
  // Normalize headers to single-value format
  const normalizedHeaders: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    normalizedHeaders[key] = Array.isArray(value) ? value[0] : value || '';
  }

  return propagation.extract(context.active(), normalizedHeaders, {
    get(carrier, key) {
      return carrier[key];
    },
    keys(carrier) {
      return Object.keys(carrier);
    },
  });
}
