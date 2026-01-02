/**
 * OpenTelemetry Distributed Tracing
 *
 * This module provides distributed tracing capabilities for the WebEDT backend.
 *
 * ## Quick Start
 *
 * 1. Initialize telemetry FIRST (before other imports):
 *    ```typescript
 *    import { initializeTelemetry } from './telemetry/index.js';
 *    initializeTelemetry();
 *    ```
 *
 * 2. Add the telemetry middleware after correlationIdMiddleware:
 *    ```typescript
 *    app.use(correlationIdMiddleware);
 *    app.use(telemetryMiddleware);
 *    ```
 *
 * 3. Create custom spans for SSE streams:
 *    ```typescript
 *    const { span, ctx } = startSseSpan('session.stream', sessionId, req);
 *    const manager = new SseSpanManager(span);
 *    // ... stream events ...
 *    manager.end();
 *    ```
 *
 * ## Configuration
 *
 * Environment variables:
 * - OTEL_ENABLED: Enable/disable telemetry (default: true in dev)
 * - OTEL_EXPORTER_TYPE: 'console' | 'otlp' | 'none'
 * - OTEL_EXPORTER_OTLP_ENDPOINT: OTLP endpoint URL
 * - OTEL_SAMPLE_RATE: Sampling rate 0.0-1.0 (default: 1.0 in dev, 0.1 in prod)
 * - OTEL_DEBUG_SPANS: Enable span debug logging
 *
 * ## Auto-Instrumentation
 *
 * The following are automatically instrumented:
 * - Express routes and middleware
 * - HTTP outbound requests
 * - PostgreSQL queries (via pg driver)
 *
 * ## Custom Spans
 *
 * Use the span helpers for:
 * - SSE streams: startSseSpan, SseSpanManager
 * - Claude API calls: startClaudeSpan
 * - GitHub operations: startGitHubSpan
 * - Database operations: startDbSpan
 * - Generic operations: withSpan, withSpanSync
 */

// Initialization (must be called first)
export { initializeTelemetry, shutdownTelemetry, isTelemetryInitialized } from './init.js';

// Configuration
export { loadTelemetryConfig, logTelemetryConfig } from './config.js';
export type { TelemetryConfig } from './config.js';

// Middleware
export { telemetryMiddleware, createRequestSpan, injectTraceContext, extractTraceContextFromHeaders } from './middleware.js';

// Span helpers
export {
  SpanAttributes,
  getTracer,
  getCurrentSpan,
  addCorrelationIdToSpan,
  startSseSpan,
  SseSpanManager,
  startClaudeSpan,
  startGitHubSpan,
  startDbSpan,
  withSpan,
  withSpanSync,
  propagateTraceContext,
  extractTraceContext,
} from './spans.js';
