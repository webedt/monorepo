/**
 * Shared Package Interfaces
 *
 * This module exports all interface definitions for the shared package classes.
 * Interfaces provide a high-level view of each class's API without implementation details.
 *
 * ## Naming Convention
 *
 * All interfaces use the `I` prefix pattern:
 * - `IClaudeRemoteClient` → implemented by `ClaudeRemoteClient`
 * - `IGitHelper` → implemented by `GitHelper`
 *
 * ## Usage
 *
 * ```typescript
 * import type { IClaudeRemoteClient, IGitHelper } from '@webedt/shared/interfaces';
 *
 * function processSession(client: IClaudeRemoteClient): Promise<void> {
 *   // Use the interface for type safety
 * }
 * ```
 *
 * @module interfaces
 */

// Claude Remote Client
export type { IClaudeRemoteClient } from './IClaudeRemoteClient.js';

// Git Operations
export type { IGitHelper } from './IGitHelper.js';
export type {
  IGitHubClient,
  GitHubPullOptions,
  GitHubPullResult,
} from './IGitHubClient.js';

// Logging
export type { ILogger, LogContext } from './ILogger.js';
export type {
  ILogCapture,
  CapturedLog,
  LogFilter,
  LogCaptureStatus,
} from './ILogCapture.js';

// Resilience Patterns
export type {
  ICircuitBreaker,
  ICircuitBreakerRegistry,
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitBreakerResult,
} from './ICircuitBreaker.js';

// Health Monitoring
export type {
  IHealthMonitor,
  HealthCheckResult,
  ServiceHealth,
  DetailedHealthStatus,
  HealthCheckFunction,
} from './IHealthMonitor.js';

// Metrics
export type {
  IMetricsRegistry,
  MetricLabels,
  MetricsSummary,
} from './IMetricsRegistry.js';

// Session Broadcasting
export type {
  ISessionEventBroadcaster,
  SessionEvent,
} from './ISessionEventBroadcaster.js';

export type {
  ISessionListBroadcaster,
  SessionUpdateType,
  SessionListEvent,
} from './ISessionListBroadcaster.js';
