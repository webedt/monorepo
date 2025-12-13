import chalk from 'chalk';
import { StructuredError, type ErrorContext, formatError } from './errors.js';
import { randomUUID } from 'crypto';
import { memoryUsage } from 'process';
import { existsSync, mkdirSync, appendFileSync, statSync, renameSync, readdirSync, unlinkSync } from 'fs';
import { join, basename } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Default timing threshold in ms for logging slow operations
 * Operations exceeding this threshold will be automatically logged
 */
export const DEFAULT_TIMING_THRESHOLD_MS = 100;

/**
 * Request lifecycle phase for tracking request flow
 */
export type RequestPhase = 'discovery' | 'execution' | 'evaluation' | 'github' | 'claude';

/**
 * Request lifecycle tracking for end-to-end tracing
 */
export interface RequestLifecycle {
  correlationId: string;
  startTime: number;
  phases: Map<RequestPhase, PhaseMetrics>;
  totalDuration?: number;
  success?: boolean;
  errorCode?: string;
}

/**
 * Metrics for a specific phase in the request lifecycle
 */
export interface PhaseMetrics {
  phase: RequestPhase;
  startTime: number;
  endTime?: number;
  duration?: number;
  success?: boolean;
  operationCount: number;
  errorCount: number;
  metadata: Record<string, any>;
}

/**
 * Operation metadata for tracking execution context
 */
export interface OperationMetadata {
  correlationId?: string;
  component?: string;
  operation?: string;
  startTime?: number;
  duration?: number;
  memoryUsageMB?: number;
  success?: boolean;
  error?: string;
  phase?: RequestPhase;
  [key: string]: any;
}

/**
 * Timed operation result with metadata
 */
export interface TimedOperationResult<T> {
  result: T;
  duration: number;
  memoryDelta: number;
  startMemory: number;
  endMemory: number;
}

/**
 * Performance metrics for an operation
 */
export interface PerformanceMetrics {
  duration: number;
  memoryUsageMB: number;
  memoryDeltaMB: number;
  timestamp: string;
}

export type LogFormat = 'pretty' | 'json';

interface LoggerOptions {
  level: LogLevel;
  prefix?: string;
  format?: LogFormat;
  correlationId?: string;
  cycleNumber?: number;
  workerId?: string;
  includeCorrelationId?: boolean;
  includeTimestamp?: boolean;
}

interface ErrorLogOptions {
  context?: ErrorContext;
  includeStack?: boolean;
  includeRecovery?: boolean;
}

/**
 * Structured JSON log entry schema for consistent logging
 */
export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId?: string;
  component?: string;
  cycleNumber?: number;
  workerId?: string;
  meta?: Record<string, any>;
  error?: {
    code?: string;
    message: string;
    severity?: string;
    isRetryable?: boolean;
    stack?: string;
    cause?: string;
    context?: Record<string, any>;
    recoveryActions?: Array<{ description: string; automatic: boolean }>;
  };
}

/**
 * Correlation context for tracking requests across the daemon lifecycle
 */
export interface CorrelationContext {
  correlationId: string;
  cycleNumber?: number;
  workerId?: string;
  component?: string;
  startTime?: number;
}

/**
 * Configuration for structured file logging
 */
export interface StructuredFileLoggerConfig {
  /** Directory path for log files */
  logDir: string;
  /** Maximum file size in bytes before rotation (default: 10MB) */
  maxFileSizeBytes: number;
  /** Number of rotated files to keep (default: 5) */
  maxFiles: number;
  /** Include performance metrics in logs (default: true) */
  includeMetrics: boolean;
}

/**
 * Aggregated metrics for tracking operational statistics
 */
export interface AggregatedMetrics {
  /** Total number of cycles executed */
  totalCycles: number;
  /** Successful cycles count */
  successfulCycles: number;
  /** Failed cycles count */
  failedCycles: number;
  /** Total tasks discovered */
  totalTasksDiscovered: number;
  /** Total tasks completed */
  totalTasksCompleted: number;
  /** Total tasks failed */
  totalTasksFailed: number;
  /** Total errors recorded */
  totalErrors: number;
  /** Total PRs merged */
  totalPRsMerged: number;
  /** Array of cycle durations for average calculation */
  cycleDurations: number[];
  /** Timestamp when tracking started */
  startTime: number;
  /** Last cycle timestamp */
  lastCycleTime?: number;
  /** Error counts by error code */
  errorsByCode: Record<string, number>;
  /** Success rate percentage (0-100) */
  successRate: number;
  /** Average cycle duration in ms */
  avgCycleDurationMs: number;
  /** Cycles per hour rate */
  cyclesPerHour: number;
}

/**
 * Structured log entry with extended fields for file logging
 */
export interface ExtendedLogEntry extends StructuredLogEntry {
  /** Operation type for categorization */
  operationType?: 'cycle' | 'task' | 'discovery' | 'evaluation' | 'merge' | 'api' | 'system';
  /** Duration of operation in ms */
  durationMs?: number;
  /** Issue number if applicable */
  issueNumber?: number;
  /** Memory usage at time of log */
  memoryUsageMB?: number;
  /** Performance metrics snapshot */
  metrics?: Partial<AggregatedMetrics>;
}

/**
 * Aggregated metrics tracker for observability
 */
export class MetricsAggregator {
  private metrics: AggregatedMetrics;

  constructor() {
    this.metrics = this.createInitialMetrics();
  }

  private createInitialMetrics(): AggregatedMetrics {
    return {
      totalCycles: 0,
      successfulCycles: 0,
      failedCycles: 0,
      totalTasksDiscovered: 0,
      totalTasksCompleted: 0,
      totalTasksFailed: 0,
      totalErrors: 0,
      totalPRsMerged: 0,
      cycleDurations: [],
      startTime: Date.now(),
      errorsByCode: {},
      successRate: 0,
      avgCycleDurationMs: 0,
      cyclesPerHour: 0,
    };
  }

  /**
   * Record a cycle completion
   */
  recordCycle(
    success: boolean,
    durationMs: number,
    tasksDiscovered: number,
    tasksCompleted: number,
    tasksFailed: number,
    prsMerged: number
  ): void {
    this.metrics.totalCycles++;
    if (success) {
      this.metrics.successfulCycles++;
    } else {
      this.metrics.failedCycles++;
    }
    this.metrics.totalTasksDiscovered += tasksDiscovered;
    this.metrics.totalTasksCompleted += tasksCompleted;
    this.metrics.totalTasksFailed += tasksFailed;
    this.metrics.totalPRsMerged += prsMerged;
    this.metrics.cycleDurations.push(durationMs);
    this.metrics.lastCycleTime = Date.now();

    // Keep only last 100 durations for average calculation
    if (this.metrics.cycleDurations.length > 100) {
      this.metrics.cycleDurations = this.metrics.cycleDurations.slice(-100);
    }

    this.recalculateRates();
  }

  /**
   * Record an error occurrence
   */
  recordError(errorCode: string): void {
    this.metrics.totalErrors++;
    this.metrics.errorsByCode[errorCode] = (this.metrics.errorsByCode[errorCode] || 0) + 1;
  }

  /**
   * Recalculate derived metrics
   */
  private recalculateRates(): void {
    // Calculate success rate
    if (this.metrics.totalCycles > 0) {
      this.metrics.successRate = Math.round(
        (this.metrics.successfulCycles / this.metrics.totalCycles) * 100
      );
    }

    // Calculate average duration
    if (this.metrics.cycleDurations.length > 0) {
      const sum = this.metrics.cycleDurations.reduce((a, b) => a + b, 0);
      this.metrics.avgCycleDurationMs = Math.round(sum / this.metrics.cycleDurations.length);
    }

    // Calculate cycles per hour
    const elapsedHours = (Date.now() - this.metrics.startTime) / (1000 * 60 * 60);
    if (elapsedHours > 0) {
      this.metrics.cyclesPerHour = Math.round((this.metrics.totalCycles / elapsedHours) * 100) / 100;
    }
  }

  /**
   * Get current aggregated metrics
   */
  getMetrics(): AggregatedMetrics {
    this.recalculateRates();
    return { ...this.metrics };
  }

  /**
   * Get a summary suitable for logging
   */
  getMetricsSummary(): Record<string, any> {
    const m = this.getMetrics();
    return {
      cycles: {
        total: m.totalCycles,
        successful: m.successfulCycles,
        failed: m.failedCycles,
        successRate: `${m.successRate}%`,
        avgDurationMs: m.avgCycleDurationMs,
        perHour: m.cyclesPerHour,
      },
      tasks: {
        discovered: m.totalTasksDiscovered,
        completed: m.totalTasksCompleted,
        failed: m.totalTasksFailed,
        completionRate: m.totalTasksDiscovered > 0
          ? `${Math.round((m.totalTasksCompleted / m.totalTasksDiscovered) * 100)}%`
          : '0%',
      },
      errors: {
        total: m.totalErrors,
        byCode: m.errorsByCode,
      },
      prsMerged: m.totalPRsMerged,
      uptimeMs: Date.now() - m.startTime,
    };
  }

  /**
   * Reset metrics (useful for testing)
   */
  reset(): void {
    this.metrics = this.createInitialMetrics();
  }
}

/**
 * Structured file logger that writes JSON logs to files with rotation
 */
export class StructuredFileLogger {
  private config: StructuredFileLoggerConfig;
  private currentLogFile: string;
  private metricsAggregator: MetricsAggregator;
  private enabled: boolean = false;

  constructor(config: Partial<StructuredFileLoggerConfig> = {}) {
    this.config = {
      logDir: config.logDir || './logs',
      maxFileSizeBytes: config.maxFileSizeBytes || 10 * 1024 * 1024,
      maxFiles: config.maxFiles || 5,
      includeMetrics: config.includeMetrics !== false,
    };
    this.currentLogFile = this.getLogFilePath();
    this.metricsAggregator = new MetricsAggregator();
  }

  /**
   * Enable structured file logging
   */
  enable(): void {
    this.ensureLogDirectory();
    this.enabled = true;
  }

  /**
   * Disable structured file logging
   */
  disable(): void {
    this.enabled = false;
  }

  /**
   * Check if structured file logging is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get the metrics aggregator for recording metrics
   */
  getMetricsAggregator(): MetricsAggregator {
    return this.metricsAggregator;
  }

  /**
   * Get current log file path
   */
  private getLogFilePath(): string {
    return join(this.config.logDir, 'autonomous-dev.log');
  }

  /**
   * Ensure log directory exists
   */
  private ensureLogDirectory(): void {
    if (!existsSync(this.config.logDir)) {
      mkdirSync(this.config.logDir, { recursive: true });
    }
  }

  /**
   * Check if log rotation is needed
   */
  private needsRotation(): boolean {
    if (!existsSync(this.currentLogFile)) {
      return false;
    }
    try {
      const stats = statSync(this.currentLogFile);
      return stats.size >= this.config.maxFileSizeBytes;
    } catch {
      return false;
    }
  }

  /**
   * Rotate log files
   */
  private rotateLogFiles(): void {
    // Delete oldest file if at max
    const oldestFile = `${this.currentLogFile}.${this.config.maxFiles}`;
    if (existsSync(oldestFile)) {
      unlinkSync(oldestFile);
    }

    // Rotate existing files
    for (let i = this.config.maxFiles - 1; i >= 1; i--) {
      const current = `${this.currentLogFile}.${i}`;
      const next = `${this.currentLogFile}.${i + 1}`;
      if (existsSync(current)) {
        renameSync(current, next);
      }
    }

    // Move current log to .1
    if (existsSync(this.currentLogFile)) {
      renameSync(this.currentLogFile, `${this.currentLogFile}.1`);
    }
  }

  /**
   * Write a structured log entry to file
   */
  writeLog(entry: ExtendedLogEntry): void {
    if (!this.enabled) {
      return;
    }

    try {
      // Check for rotation
      if (this.needsRotation()) {
        this.rotateLogFiles();
      }

      // Add metrics if configured
      if (this.config.includeMetrics && !entry.metrics) {
        entry.metrics = this.metricsAggregator.getMetrics();
      }

      // Add memory usage if not present
      if (entry.memoryUsageMB === undefined) {
        entry.memoryUsageMB = getMemoryUsageMB();
      }

      const logLine = JSON.stringify(entry) + '\n';
      appendFileSync(this.currentLogFile, logLine);
    } catch (error) {
      // Silently fail to avoid disrupting main operation
      console.error(`[StructuredFileLogger] Failed to write log: ${error}`);
    }
  }

  /**
   * Write a cycle completion log with all metrics
   */
  writeCycleLog(
    cycleNumber: number,
    correlationId: string,
    success: boolean,
    tasksDiscovered: number,
    tasksCompleted: number,
    tasksFailed: number,
    prsMerged: number,
    durationMs: number,
    errors: string[]
  ): void {
    // Record in aggregator
    this.metricsAggregator.recordCycle(
      success,
      durationMs,
      tasksDiscovered,
      tasksCompleted,
      tasksFailed,
      prsMerged
    );

    // Record errors
    for (const error of errors) {
      const codeMatch = error.match(/\[([^\]]+)\]/);
      if (codeMatch) {
        this.metricsAggregator.recordError(codeMatch[1]);
      }
    }

    const entry: ExtendedLogEntry = {
      timestamp: new Date().toISOString(),
      level: success ? 'info' : 'error',
      message: `Cycle #${cycleNumber} ${success ? 'completed' : 'failed'}`,
      correlationId,
      cycleNumber,
      operationType: 'cycle',
      durationMs,
      meta: {
        tasksDiscovered,
        tasksCompleted,
        tasksFailed,
        prsMerged,
        errors: errors.length > 0 ? errors : undefined,
      },
      metrics: this.metricsAggregator.getMetrics(),
    };

    this.writeLog(entry);
  }

  /**
   * Write a task completion log
   */
  writeTaskLog(
    issueNumber: number,
    correlationId: string,
    workerId: string,
    success: boolean,
    durationMs: number,
    branchName?: string,
    commitSha?: string,
    error?: string
  ): void {
    const entry: ExtendedLogEntry = {
      timestamp: new Date().toISOString(),
      level: success ? 'info' : 'error',
      message: `Task #${issueNumber} ${success ? 'completed' : 'failed'}`,
      correlationId,
      workerId,
      issueNumber,
      operationType: 'task',
      durationMs,
      meta: {
        branchName,
        commitSha,
        error,
      },
    };

    this.writeLog(entry);
  }

  /**
   * Write a discovery log
   */
  writeDiscoveryLog(
    correlationId: string,
    cycleNumber: number,
    tasksFound: number,
    durationMs: number,
    existingIssues: number
  ): void {
    const entry: ExtendedLogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: `Discovery completed: ${tasksFound} tasks found`,
      correlationId,
      cycleNumber,
      operationType: 'discovery',
      durationMs,
      meta: {
        tasksFound,
        existingIssues,
      },
    };

    this.writeLog(entry);
  }

  /**
   * Write an API call log
   */
  writeApiLog(
    service: 'github' | 'claude',
    endpoint: string,
    correlationId: string,
    success: boolean,
    durationMs: number,
    statusCode?: number,
    error?: string
  ): void {
    const entry: ExtendedLogEntry = {
      timestamp: new Date().toISOString(),
      level: success ? 'debug' : 'warn',
      message: `${service.toUpperCase()} API call: ${endpoint}`,
      correlationId,
      operationType: 'api',
      durationMs,
      meta: {
        service,
        endpoint,
        success,
        statusCode,
        error,
      },
    };

    this.writeLog(entry);
  }

  /**
   * Write a system event log
   */
  writeSystemLog(
    level: LogLevel,
    message: string,
    meta?: Record<string, any>
  ): void {
    const entry: ExtendedLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      operationType: 'system',
      meta,
    };

    this.writeLog(entry);
  }

  /**
   * Get list of log files in the log directory
   */
  getLogFiles(): string[] {
    if (!existsSync(this.config.logDir)) {
      return [];
    }

    return readdirSync(this.config.logDir)
      .filter(f => f.startsWith('autonomous-dev.log'))
      .map(f => join(this.config.logDir, f))
      .sort();
  }

  /**
   * Get current metrics summary
   */
  getMetricsSummary(): Record<string, any> {
    return this.metricsAggregator.getMetricsSummary();
  }
}

// Global structured file logger instance
let structuredFileLogger: StructuredFileLogger | null = null;

/**
 * Get or create the global structured file logger
 */
export function getStructuredFileLogger(): StructuredFileLogger {
  if (!structuredFileLogger) {
    structuredFileLogger = new StructuredFileLogger();
  }
  return structuredFileLogger;
}

/**
 * Initialize structured file logging with config
 */
export function initStructuredFileLogging(config: Partial<StructuredFileLoggerConfig>): StructuredFileLogger {
  structuredFileLogger = new StructuredFileLogger(config);
  structuredFileLogger.enable();
  return structuredFileLogger;
}

/**
 * Get the metrics aggregator from the structured logger
 */
export function getMetricsAggregator(): MetricsAggregator {
  return getStructuredFileLogger().getMetricsAggregator();
}

const levelPriority: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const levelColors: Record<LogLevel, (text: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
};

const levelIcons: Record<LogLevel, string> = {
  debug: '🔍',
  info: '📋',
  warn: '⚠️',
  error: '❌',
};

// Global correlation context for request tracing across components
let globalCorrelationContext: CorrelationContext | undefined;

/**
 * Generate a new correlation ID
 */
export function generateCorrelationId(): string {
  return randomUUID();
}

/**
 * Set the global correlation ID for the current execution context
 */
export function setCorrelationId(id: string): void {
  if (globalCorrelationContext) {
    globalCorrelationContext.correlationId = id;
  } else {
    globalCorrelationContext = { correlationId: id };
  }
}

/**
 * Get the current global correlation ID
 */
export function getCorrelationId(): string | undefined {
  return globalCorrelationContext?.correlationId;
}

/**
 * Clear the global correlation ID
 */
export function clearCorrelationId(): void {
  globalCorrelationContext = undefined;
}

/**
 * Set the full global correlation context (including cycle number and worker ID)
 */
export function setCorrelationContext(context: CorrelationContext): void {
  globalCorrelationContext = context;
}

/**
 * Get the current global correlation context
 */
export function getCorrelationContext(): CorrelationContext | undefined {
  return globalCorrelationContext;
}

/**
 * Update the global correlation context with additional fields
 */
export function updateCorrelationContext(updates: Partial<CorrelationContext>): void {
  if (globalCorrelationContext) {
    globalCorrelationContext = { ...globalCorrelationContext, ...updates };
  } else if (updates.correlationId) {
    globalCorrelationContext = { correlationId: updates.correlationId, ...updates };
  }
}

/**
 * Set the cycle number in the global correlation context
 */
export function setCycleNumber(cycleNumber: number): void {
  if (globalCorrelationContext) {
    globalCorrelationContext.cycleNumber = cycleNumber;
  }
}

/**
 * Get the current cycle number from the global correlation context
 */
export function getCycleNumber(): number | undefined {
  return globalCorrelationContext?.cycleNumber;
}

/**
 * Set the worker ID in the global correlation context
 */
export function setWorkerId(workerId: string): void {
  if (globalCorrelationContext) {
    globalCorrelationContext.workerId = workerId;
  }
}

/**
 * Get the current worker ID from the global correlation context
 */
export function getWorkerId(): string | undefined {
  return globalCorrelationContext?.workerId;
}

// Request lifecycle tracking for end-to-end tracing
const requestLifecycles: Map<string, RequestLifecycle> = new Map();

/**
 * Start tracking a request lifecycle
 */
export function startRequestLifecycle(correlationId: string): RequestLifecycle {
  const lifecycle: RequestLifecycle = {
    correlationId,
    startTime: Date.now(),
    phases: new Map(),
  };
  requestLifecycles.set(correlationId, lifecycle);
  return lifecycle;
}

/**
 * Start a phase in the request lifecycle
 */
export function startPhase(correlationId: string, phase: RequestPhase, metadata: Record<string, any> = {}): PhaseMetrics {
  const lifecycle = requestLifecycles.get(correlationId);
  if (!lifecycle) {
    // Auto-create lifecycle if not exists
    startRequestLifecycle(correlationId);
  }

  const phaseMetrics: PhaseMetrics = {
    phase,
    startTime: Date.now(),
    operationCount: 0,
    errorCount: 0,
    metadata,
  };

  requestLifecycles.get(correlationId)?.phases.set(phase, phaseMetrics);
  return phaseMetrics;
}

/**
 * End a phase in the request lifecycle
 */
export function endPhase(correlationId: string, phase: RequestPhase, success: boolean, additionalMetadata: Record<string, any> = {}): PhaseMetrics | undefined {
  const lifecycle = requestLifecycles.get(correlationId);
  const phaseMetrics = lifecycle?.phases.get(phase);

  if (phaseMetrics) {
    phaseMetrics.endTime = Date.now();
    phaseMetrics.duration = phaseMetrics.endTime - phaseMetrics.startTime;
    phaseMetrics.success = success;
    phaseMetrics.metadata = { ...phaseMetrics.metadata, ...additionalMetadata };

    // Log slow phases automatically
    if (phaseMetrics.duration > DEFAULT_TIMING_THRESHOLD_MS) {
      logger.debug(`Slow phase detected: ${phase}`, {
        phase,
        duration: phaseMetrics.duration,
        threshold: DEFAULT_TIMING_THRESHOLD_MS,
        correlationId,
        success,
      });
    }
  }

  return phaseMetrics;
}

/**
 * Record an operation within a phase
 */
export function recordPhaseOperation(correlationId: string, phase: RequestPhase, operationName: string): void {
  const lifecycle = requestLifecycles.get(correlationId);
  const phaseMetrics = lifecycle?.phases.get(phase);

  if (phaseMetrics) {
    phaseMetrics.operationCount++;
  }
}

/**
 * Record an error within a phase
 */
export function recordPhaseError(correlationId: string, phase: RequestPhase, errorCode?: string): void {
  const lifecycle = requestLifecycles.get(correlationId);
  const phaseMetrics = lifecycle?.phases.get(phase);

  if (phaseMetrics) {
    phaseMetrics.errorCount++;
    if (errorCode) {
      phaseMetrics.metadata.lastErrorCode = errorCode;
    }
  }
}

/**
 * End the request lifecycle and return summary
 */
export function endRequestLifecycle(correlationId: string, success: boolean, errorCode?: string): RequestLifecycle | undefined {
  const lifecycle = requestLifecycles.get(correlationId);

  if (lifecycle) {
    lifecycle.totalDuration = Date.now() - lifecycle.startTime;
    lifecycle.success = success;
    lifecycle.errorCode = errorCode;

    // Log lifecycle summary
    const phaseSummary: Record<string, { duration: number; success: boolean; operations: number; errors: number }> = {};
    lifecycle.phases.forEach((metrics, phase) => {
      phaseSummary[phase] = {
        duration: metrics.duration || 0,
        success: metrics.success || false,
        operations: metrics.operationCount,
        errors: metrics.errorCount,
      };
    });

    logger.info('Request lifecycle completed', {
      correlationId,
      totalDuration: lifecycle.totalDuration,
      success,
      errorCode,
      phases: phaseSummary,
    });

    // Clean up after logging
    requestLifecycles.delete(correlationId);
  }

  return lifecycle;
}

/**
 * Get the current request lifecycle for a correlation ID
 */
export function getRequestLifecycle(correlationId: string): RequestLifecycle | undefined {
  return requestLifecycles.get(correlationId);
}

/**
 * Get current memory usage in megabytes
 */
export function getMemoryUsageMB(): number {
  const usage = memoryUsage();
  return Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100;
}

/**
 * Get detailed memory statistics
 */
export function getMemoryStats(): { heapUsedMB: number; heapTotalMB: number; externalMB: number; rssMB: number } {
  const usage = memoryUsage();
  return {
    heapUsedMB: Math.round((usage.heapUsed / 1024 / 1024) * 100) / 100,
    heapTotalMB: Math.round((usage.heapTotal / 1024 / 1024) * 100) / 100,
    externalMB: Math.round((usage.external / 1024 / 1024) * 100) / 100,
    rssMB: Math.round((usage.rss / 1024 / 1024) * 100) / 100,
  };
}

/**
 * Options for timed operations
 */
export interface TimedOperationOptions {
  /** Operation name for logging */
  operationName?: string;
  /** Component name for structured logging */
  component?: string;
  /** Request phase for lifecycle tracking */
  phase?: RequestPhase;
  /** Custom timing threshold in ms (defaults to DEFAULT_TIMING_THRESHOLD_MS) */
  timingThreshold?: number;
  /** Whether to log slow operations automatically (default: true) */
  logSlowOperations?: boolean;
  /** Additional metadata to include in logs */
  metadata?: Record<string, any>;
}

/**
 * Time an async operation and return result with timing info
 * Automatically logs operations that exceed the timing threshold
 */
export async function timeOperation<T>(
  operation: () => Promise<T>,
  operationNameOrOptions?: string | TimedOperationOptions
): Promise<TimedOperationResult<T>> {
  const options: TimedOperationOptions = typeof operationNameOrOptions === 'string'
    ? { operationName: operationNameOrOptions }
    : operationNameOrOptions || {};

  const {
    operationName,
    component,
    phase,
    timingThreshold = DEFAULT_TIMING_THRESHOLD_MS,
    logSlowOperations = true,
    metadata = {},
  } = options;

  const startMemory = getMemoryUsageMB();
  const startTime = Date.now();
  const correlationId = getCorrelationId();

  // Record operation in phase if tracking
  if (correlationId && phase && operationName) {
    recordPhaseOperation(correlationId, phase, operationName);
  }

  try {
    const result = await operation();
    const duration = Date.now() - startTime;
    const endMemory = getMemoryUsageMB();
    const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;

    // Log slow operations automatically
    if (logSlowOperations && duration > timingThreshold) {
      logger.debug(`Slow operation: ${operationName || 'unnamed'}`, {
        operation: operationName,
        component,
        phase,
        duration,
        threshold: timingThreshold,
        memoryDeltaMB: memoryDelta,
        correlationId,
        ...metadata,
      });
    }

    return {
      result,
      duration,
      memoryDelta,
      startMemory,
      endMemory,
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const endMemory = getMemoryUsageMB();

    // Record error in phase tracking
    if (correlationId && phase) {
      const errorCode = error instanceof StructuredError ? error.code : undefined;
      recordPhaseError(correlationId, phase, errorCode);
    }

    // Re-throw with timing info attached
    if (error instanceof Error) {
      (error as any).operationDuration = duration;
      (error as any).operationName = operationName;
    }
    throw error;
  }
}

/**
 * Time a synchronous operation and return result with timing info
 * Automatically logs operations that exceed the timing threshold
 */
export function timeOperationSync<T>(
  operation: () => T,
  operationNameOrOptions?: string | TimedOperationOptions
): TimedOperationResult<T> {
  const options: TimedOperationOptions = typeof operationNameOrOptions === 'string'
    ? { operationName: operationNameOrOptions }
    : operationNameOrOptions || {};

  const {
    operationName,
    component,
    phase,
    timingThreshold = DEFAULT_TIMING_THRESHOLD_MS,
    logSlowOperations = true,
    metadata = {},
  } = options;

  const startMemory = getMemoryUsageMB();
  const startTime = Date.now();
  const correlationId = getCorrelationId();

  // Record operation in phase if tracking
  if (correlationId && phase && operationName) {
    recordPhaseOperation(correlationId, phase, operationName);
  }

  try {
    const result = operation();
    const duration = Date.now() - startTime;
    const endMemory = getMemoryUsageMB();
    const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;

    // Log slow operations automatically
    if (logSlowOperations && duration > timingThreshold) {
      logger.debug(`Slow operation: ${operationName || 'unnamed'}`, {
        operation: operationName,
        component,
        phase,
        duration,
        threshold: timingThreshold,
        memoryDeltaMB: memoryDelta,
        correlationId,
        ...metadata,
      });
    }

    return {
      result,
      duration,
      memoryDelta,
      startMemory,
      endMemory,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    // Record error in phase tracking
    if (correlationId && phase) {
      const errorCode = error instanceof StructuredError ? error.code : undefined;
      recordPhaseError(correlationId, phase, errorCode);
    }

    if (error instanceof Error) {
      (error as any).operationDuration = duration;
      (error as any).operationName = operationName;
    }
    throw error;
  }
}

/**
 * Create a scoped operation context for structured logging
 */
export interface OperationContext {
  correlationId: string;
  component: string;
  operation: string;
  startTime: number;
  metadata: Record<string, any>;
}

/**
 * Create a new operation context for tracing
 */
export function createOperationContext(
  component: string,
  operation: string,
  metadata: Record<string, any> = {}
): OperationContext {
  return {
    correlationId: getCorrelationId() || generateCorrelationId(),
    component,
    operation,
    startTime: Date.now(),
    metadata,
  };
}

/**
 * Finalize an operation context and return performance metrics
 */
export function finalizeOperationContext(
  context: OperationContext,
  success: boolean,
  additionalMetadata: Record<string, any> = {}
): OperationMetadata {
  const duration = Date.now() - context.startTime;
  const memoryUsageMB = getMemoryUsageMB();

  return {
    correlationId: context.correlationId,
    component: context.component,
    operation: context.operation,
    startTime: context.startTime,
    duration,
    memoryUsageMB,
    success,
    ...context.metadata,
    ...additionalMetadata,
  };
}

class Logger {
  private level: LogLevel;
  private prefix: string;
  private format: LogFormat;
  private correlationId?: string;
  private cycleNumber?: number;
  private workerId?: string;
  private includeCorrelationId: boolean;
  private includeTimestamp: boolean;

  constructor(options: LoggerOptions = { level: 'info' }) {
    this.level = options.level;
    this.prefix = options.prefix || '';
    this.format = options.format || 'pretty';
    this.correlationId = options.correlationId;
    this.cycleNumber = options.cycleNumber;
    this.workerId = options.workerId;
    this.includeCorrelationId = options.includeCorrelationId ?? true;
    this.includeTimestamp = options.includeTimestamp ?? true;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setFormat(format: LogFormat): void {
    this.format = format;
  }

  /**
   * Set the correlation ID for this logger instance
   */
  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  /**
   * Set the cycle number for this logger instance
   */
  setCycleNumber(cycleNumber: number): void {
    this.cycleNumber = cycleNumber;
  }

  /**
   * Set the worker ID for this logger instance
   */
  setWorkerId(workerId: string): void {
    this.workerId = workerId;
  }

  /**
   * Configure whether to include correlation ID in logs
   */
  setIncludeCorrelationId(include: boolean): void {
    this.includeCorrelationId = include;
  }

  /**
   * Configure whether to include timestamp in logs
   */
  setIncludeTimestamp(include: boolean): void {
    this.includeTimestamp = include;
  }

  /**
   * Get the effective correlation ID (instance or global)
   */
  private getEffectiveCorrelationId(): string | undefined {
    if (!this.includeCorrelationId) return undefined;
    return this.correlationId || globalCorrelationContext?.correlationId;
  }

  /**
   * Get the effective cycle number (instance or global)
   */
  private getEffectiveCycleNumber(): number | undefined {
    return this.cycleNumber ?? globalCorrelationContext?.cycleNumber;
  }

  /**
   * Get the effective worker ID (instance or global)
   */
  private getEffectiveWorkerId(): string | undefined {
    return this.workerId || globalCorrelationContext?.workerId;
  }

  private shouldLog(level: LogLevel): boolean {
    return levelPriority[level] >= levelPriority[this.level];
  }

  /**
   * Create a structured log entry
   */
  private createLogEntry(level: LogLevel, message: string, meta?: object): StructuredLogEntry {
    const entry: StructuredLogEntry = {
      timestamp: this.includeTimestamp ? new Date().toISOString() : '',
      level,
      message,
    };

    // Remove empty timestamp for cleaner JSON output
    if (!this.includeTimestamp) {
      delete (entry as any).timestamp;
    }

    const correlationId = this.getEffectiveCorrelationId();
    if (correlationId) {
      entry.correlationId = correlationId;
    }

    if (this.prefix) {
      entry.component = this.prefix;
    }

    const cycleNumber = this.getEffectiveCycleNumber();
    if (cycleNumber !== undefined) {
      entry.cycleNumber = cycleNumber;
    }

    const workerId = this.getEffectiveWorkerId();
    if (workerId) {
      entry.workerId = workerId;
    }

    if (meta && Object.keys(meta).length > 0) {
      entry.meta = meta as Record<string, any>;
    }

    return entry;
  }

  /**
   * Format a log entry as pretty output for terminal
   */
  private formatPretty(level: LogLevel, message: string, meta?: object): string {
    const timestamp = this.includeTimestamp ? new Date().toISOString() : '';
    const icon = levelIcons[level];
    const colorFn = levelColors[level];
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    const correlationId = this.getEffectiveCorrelationId();
    const cycleNumber = this.getEffectiveCycleNumber();
    const workerId = this.getEffectiveWorkerId();

    // Build context string with cycle, worker, and correlation info
    const contextParts: string[] = [];
    if (cycleNumber !== undefined) {
      contextParts.push(`c${cycleNumber}`);
    }
    if (workerId) {
      contextParts.push(workerId);
    }
    if (correlationId) {
      contextParts.push(correlationId.slice(0, 8));
    }
    const contextStr = contextParts.length > 0 ? chalk.gray(` [${contextParts.join(':')}]`) : '';

    const timestampStr = timestamp ? `${chalk.gray(timestamp)} ` : '';
    let formatted = `${timestampStr}${icon} ${colorFn(level.toUpperCase().padEnd(5))} ${prefix}${message}${contextStr}`;

    if (meta && Object.keys(meta).length > 0) {
      formatted += ` ${chalk.gray(JSON.stringify(meta))}`;
    }

    return formatted;
  }

  /**
   * Format a log entry as JSON
   */
  private formatJson(entry: StructuredLogEntry): string {
    return JSON.stringify(entry);
  }

  /**
   * Write a log entry to output
   */
  private writeLog(level: LogLevel, message: string, meta?: object): void {
    if (this.format === 'json') {
      const entry = this.createLogEntry(level, message, meta);
      const output = level === 'error' ? console.error : console.log;
      output(this.formatJson(entry));
    } else {
      const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      output(this.formatPretty(level, message, meta));
    }
  }

  debug(message: string, meta?: object): void {
    if (this.shouldLog('debug')) {
      this.writeLog('debug', message, meta);
    }
  }

  info(message: string, meta?: object): void {
    if (this.shouldLog('info')) {
      this.writeLog('info', message, meta);
    }
  }

  warn(message: string, meta?: object): void {
    if (this.shouldLog('warn')) {
      this.writeLog('warn', message, meta);
    }
  }

  error(message: string, meta?: object): void {
    if (this.shouldLog('error')) {
      this.writeLog('error', message, meta);
    }
  }

  /**
   * Log a structured error with full context, recovery suggestions, and optional stack trace
   */
  structuredError(error: StructuredError, options: ErrorLogOptions = {}): void {
    if (!this.shouldLog('error')) return;

    const { context, includeStack = false, includeRecovery = true } = options;

    // Merge additional context if provided
    const mergedContext = context ? { ...error.context, ...context } : error.context;

    if (this.format === 'json') {
      const entry = this.createLogEntry('error', error.message);
      entry.error = {
        code: error.code,
        message: error.message,
        severity: error.severity,
        isRetryable: error.isRetryable,
        context: mergedContext,
      };

      if (includeStack && error.stack) {
        entry.error.stack = error.stack;
      }

      if (includeRecovery && error.recoveryActions.length > 0) {
        entry.error.recoveryActions = error.recoveryActions;
      }

      if (error.cause) {
        entry.error.cause = error.cause.message;
      }

      console.error(this.formatJson(entry));
      return;
    }

    // Pretty format
    const timestamp = new Date().toISOString();
    const prefix = this.prefix ? `[${this.prefix}] ` : '';
    const severityColor = this.getSeverityColor(error.severity);
    const correlationId = this.getEffectiveCorrelationId();
    const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

    console.error();
    console.error(
      chalk.gray(timestamp),
      levelIcons.error,
      levelColors.error('ERROR'),
      prefix,
      chalk.bold(`[${error.code}]`),
      error.message,
      correlationStr
    );
    console.error(chalk.gray('  Severity:'), severityColor(error.severity));
    console.error(chalk.gray('  Retryable:'), error.isRetryable ? chalk.green('yes') : chalk.red('no'));

    // Log context details
    if (Object.keys(mergedContext).length > 0) {
      console.error(chalk.gray('  Context:'));
      for (const [key, value] of Object.entries(mergedContext)) {
        if (value !== undefined && key !== 'timestamp') {
          const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
          console.error(chalk.gray(`    ${key}:`), displayValue);
        }
      }
    }

    // Log recovery suggestions
    if (includeRecovery && error.recoveryActions.length > 0) {
      console.error(chalk.yellow('  Recovery suggestions:'));
      for (const action of error.recoveryActions) {
        const actionType = action.automatic ? chalk.cyan('(auto)') : chalk.magenta('(manual)');
        console.error(`    ${actionType} ${action.description}`);
      }
    }

    // Log stack trace if requested
    if (includeStack && error.stack) {
      console.error(chalk.gray('  Stack trace:'));
      const stackLines = error.stack.split('\n').slice(1);
      for (const line of stackLines.slice(0, 5)) {
        console.error(chalk.gray(`  ${line}`));
      }
      if (stackLines.length > 5) {
        console.error(chalk.gray(`    ... ${stackLines.length - 5} more lines`));
      }
    }

    // Log cause chain if present
    if (error.cause) {
      console.error(chalk.gray('  Caused by:'), error.cause.message);
    }

    console.error();
  }

  /**
   * Log error with full context for debugging (includes config, system state)
   */
  errorWithContext(
    message: string,
    error: Error | StructuredError,
    context: ErrorContext
  ): void {
    if (!this.shouldLog('error')) return;

    if (error instanceof StructuredError) {
      this.structuredError(error, { context, includeStack: true, includeRecovery: true });
    } else {
      if (this.format === 'json') {
        const entry = this.createLogEntry('error', message);
        entry.error = {
          message: error.message,
          stack: error.stack,
          context,
        };
        console.error(this.formatJson(entry));
        return;
      }

      // Pretty format
      const timestamp = new Date().toISOString();
      const prefix = this.prefix ? `[${this.prefix}] ` : '';
      const correlationId = this.getEffectiveCorrelationId();
      const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

      console.error();
      console.error(
        chalk.gray(timestamp),
        levelIcons.error,
        levelColors.error('ERROR'),
        prefix,
        message,
        correlationStr
      );
      console.error(chalk.gray('  Error:'), error.message);

      if (Object.keys(context).length > 0) {
        console.error(chalk.gray('  Context:'));
        for (const [key, value] of Object.entries(context)) {
          if (value !== undefined) {
            const displayValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
            console.error(chalk.gray(`    ${key}:`), displayValue);
          }
        }
      }

      if (error.stack) {
        console.error(chalk.gray('  Stack trace:'));
        const stackLines = error.stack.split('\n').slice(1, 4);
        for (const line of stackLines) {
          console.error(chalk.gray(`  ${line}`));
        }
      }

      console.error();
    }
  }

  private getSeverityColor(severity: string): (text: string) => string {
    switch (severity) {
      case 'critical':
        return chalk.red.bold;
      case 'error':
        return chalk.red;
      case 'warning':
        return chalk.yellow;
      case 'transient':
        return chalk.cyan;
      default:
        return chalk.white;
    }
  }

  // Special formatted outputs (only in pretty mode)
  success(message: string): void {
    if (this.format === 'json') {
      const entry = this.createLogEntry('info', message);
      entry.meta = { status: 'success' };
      console.log(this.formatJson(entry));
    } else {
      console.log(`${chalk.green('✓')} ${message}`);
    }
  }

  failure(message: string): void {
    if (this.format === 'json') {
      const entry = this.createLogEntry('error', message);
      entry.meta = { status: 'failure' };
      console.log(this.formatJson(entry));
    } else {
      console.log(`${chalk.red('✗')} ${message}`);
    }
  }

  step(step: number, total: number, message: string): void {
    if (this.format === 'json') {
      const entry = this.createLogEntry('info', message);
      entry.meta = { step, total };
      console.log(this.formatJson(entry));
    } else {
      console.log(`${chalk.cyan(`[${step}/${total}]`)} ${message}`);
    }
  }

  divider(): void {
    if (this.format !== 'json') {
      console.log(chalk.gray('─'.repeat(60)));
    }
  }

  /**
   * Log service degradation event
   */
  degraded(service: string, message: string, meta?: object): void {
    if (!this.shouldLog('warn')) return;

    if (this.format === 'json') {
      const entry = this.createLogEntry('warn', message);
      entry.meta = { ...meta, service, degraded: true };
      console.log(this.formatJson(entry));
    } else {
      const timestamp = new Date().toISOString();
      const correlationId = this.getEffectiveCorrelationId();
      const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

      console.warn(
        chalk.gray(timestamp),
        chalk.yellow('⚡'),
        chalk.yellow('DEGRADED'),
        chalk.bold(`[${service}]`),
        message,
        correlationStr
      );
      if (meta && Object.keys(meta).length > 0) {
        console.warn(chalk.gray(`  ${JSON.stringify(meta)}`));
      }
    }
  }

  /**
   * Log service recovery event
   */
  recovered(service: string, message: string, meta?: object): void {
    if (!this.shouldLog('info')) return;

    if (this.format === 'json') {
      const entry = this.createLogEntry('info', message);
      entry.meta = { ...meta, service, recovered: true };
      console.log(this.formatJson(entry));
    } else {
      const timestamp = new Date().toISOString();
      const correlationId = this.getEffectiveCorrelationId();
      const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

      console.log(
        chalk.gray(timestamp),
        chalk.green('✓'),
        chalk.green('RECOVERED'),
        chalk.bold(`[${service}]`),
        message,
        correlationStr
      );
      if (meta && Object.keys(meta).length > 0) {
        console.log(chalk.gray(`  ${JSON.stringify(meta)}`));
      }
    }
  }

  /**
   * Log service health status
   */
  serviceStatus(service: string, status: 'healthy' | 'degraded' | 'unavailable', details?: object): void {
    if (!this.shouldLog('info')) return;

    const statusColors: Record<string, (text: string) => string> = {
      healthy: chalk.green,
      degraded: chalk.yellow,
      unavailable: chalk.red,
    };

    const statusIcons: Record<string, string> = {
      healthy: '🟢',
      degraded: '🟡',
      unavailable: '🔴',
    };

    if (this.format === 'json') {
      const entry = this.createLogEntry('info', `${service} status: ${status}`);
      entry.meta = { service, status, ...details };
      console.log(this.formatJson(entry));
    } else {
      const colorFn = statusColors[status] || chalk.white;
      const icon = statusIcons[status] || '⚪';
      console.log(`${icon} ${chalk.bold(service)}: ${colorFn(status)}`);
      if (details && Object.keys(details).length > 0) {
        for (const [key, value] of Object.entries(details)) {
          console.log(chalk.gray(`   ${key}: ${JSON.stringify(value)}`));
        }
      }
    }
  }

  /**
   * Log an operation completion with timing and memory metrics
   */
  operationComplete(
    component: string,
    operation: string,
    success: boolean,
    metadata: OperationMetadata
  ): void {
    if (!this.shouldLog('info')) return;

    const level = success ? 'info' : 'error';
    const message = `${operation} ${success ? 'completed' : 'failed'}`;

    if (this.format === 'json') {
      const entry = this.createLogEntry(level, message);
      entry.meta = {
        type: 'operation',
        component,
        operation,
        success,
        ...metadata,
      };
      const output = level === 'error' ? console.error : console.log;
      output(this.formatJson(entry));
    } else {
      const timestamp = new Date().toISOString();
      const icon = success ? '✓' : '✗';
      const colorFn = success ? chalk.green : chalk.red;
      const correlationId = metadata.correlationId || this.getEffectiveCorrelationId();
      const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

      const durationStr = metadata.duration ? chalk.cyan(`${metadata.duration}ms`) : '';
      const memoryStr = metadata.memoryUsageMB ? chalk.gray(`${metadata.memoryUsageMB}MB`) : '';
      const metricsStr = [durationStr, memoryStr].filter(Boolean).join(' | ');

      console.log(
        chalk.gray(timestamp),
        colorFn(icon),
        chalk.bold(`[${component}]`),
        message,
        metricsStr ? `(${metricsStr})` : '',
        correlationStr
      );
    }
  }

  /**
   * Log an API call with request/response details
   */
  apiCall(
    service: string,
    endpoint: string,
    method: string,
    metadata: {
      statusCode?: number;
      duration?: number;
      success: boolean;
      error?: string;
      requestId?: string;
      correlationId?: string;
    }
  ): void {
    if (!this.shouldLog('debug')) return;

    const level = metadata.success ? 'debug' : 'warn';
    const message = `${method} ${endpoint}`;

    if (this.format === 'json') {
      const entry = this.createLogEntry(level, message);
      entry.meta = {
        type: 'api_call',
        service,
        endpoint,
        method,
        ...metadata,
      };
      const output = level === 'warn' ? console.warn : console.log;
      output(this.formatJson(entry));
    } else {
      const timestamp = new Date().toISOString();
      const icon = metadata.success ? '→' : '✗';
      const colorFn = metadata.success ? chalk.cyan : chalk.red;
      const correlationId = metadata.correlationId || this.getEffectiveCorrelationId();
      const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

      const statusStr = metadata.statusCode ? `[${metadata.statusCode}]` : '';
      const durationStr = metadata.duration ? `${metadata.duration}ms` : '';

      const output = metadata.success ? console.log : console.warn;
      output(
        chalk.gray(timestamp),
        colorFn(icon),
        chalk.bold(`[${service}]`),
        message,
        statusStr,
        durationStr ? chalk.gray(durationStr) : '',
        correlationStr
      );

      if (metadata.error) {
        output(chalk.red(`  Error: ${metadata.error}`));
      }
    }
  }

  /**
   * Log memory usage snapshot
   */
  memorySnapshot(component: string, context?: string): void {
    if (!this.shouldLog('debug')) return;

    const stats = getMemoryStats();
    const message = context ? `Memory snapshot: ${context}` : 'Memory snapshot';

    if (this.format === 'json') {
      const entry = this.createLogEntry('debug', message);
      entry.meta = {
        type: 'memory_snapshot',
        component,
        ...stats,
      };
      console.log(this.formatJson(entry));
    } else {
      const timestamp = new Date().toISOString();
      const correlationId = this.getEffectiveCorrelationId();
      const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

      console.log(
        chalk.gray(timestamp),
        chalk.magenta('📊'),
        chalk.bold(`[${component}]`),
        message,
        chalk.gray(`heap: ${stats.heapUsedMB}/${stats.heapTotalMB}MB, rss: ${stats.rssMB}MB`),
        correlationStr
      );
    }
  }

  /**
   * Log performance metrics for a batch of operations
   */
  performanceSummary(
    component: string,
    metrics: {
      totalOperations: number;
      successCount: number;
      failureCount: number;
      totalDuration: number;
      averageDuration: number;
      memoryUsageMB: number;
    }
  ): void {
    if (!this.shouldLog('info')) return;

    const successRate = metrics.totalOperations > 0
      ? Math.round((metrics.successCount / metrics.totalOperations) * 100)
      : 0;
    const message = `Performance summary: ${metrics.totalOperations} operations, ${successRate}% success rate`;

    if (this.format === 'json') {
      const entry = this.createLogEntry('info', message);
      entry.meta = {
        type: 'performance_summary',
        component,
        ...metrics,
        successRate,
      };
      console.log(this.formatJson(entry));
    } else {
      const timestamp = new Date().toISOString();
      const correlationId = this.getEffectiveCorrelationId();
      const correlationStr = correlationId ? chalk.gray(` [${correlationId.slice(0, 8)}]`) : '';

      console.log(
        chalk.gray(timestamp),
        chalk.cyan('📈'),
        chalk.bold(`[${component}]`),
        'Performance Summary',
        correlationStr
      );
      console.log(chalk.gray(`  Total: ${metrics.totalOperations} ops`));
      console.log(chalk.green(`  Success: ${metrics.successCount}`), chalk.red(`Failures: ${metrics.failureCount}`));
      console.log(chalk.gray(`  Duration: ${metrics.totalDuration}ms total, ${metrics.averageDuration}ms avg`));
      console.log(chalk.gray(`  Memory: ${metrics.memoryUsageMB}MB`));
    }
  }

  header(title: string): void {
    if (this.format === 'json') {
      const entry = this.createLogEntry('info', title);
      entry.meta = { type: 'header' };
      console.log(this.formatJson(entry));
    } else {
      console.log();
      console.log(chalk.bold.cyan(`═══ ${title} ${'═'.repeat(Math.max(0, 50 - title.length))}`));
      console.log();
    }
  }

  /**
   * Create a child logger with a prefix and optionally inherit correlation context
   */
  child(prefix: string): Logger {
    const child = new Logger({
      level: this.level,
      prefix,
      format: this.format,
      correlationId: this.correlationId,
      cycleNumber: this.cycleNumber,
      workerId: this.workerId,
      includeCorrelationId: this.includeCorrelationId,
      includeTimestamp: this.includeTimestamp,
    });
    return child;
  }

  /**
   * Create a child logger with a specific correlation ID for request tracing
   */
  withCorrelationId(correlationId: string): Logger {
    const child = new Logger({
      level: this.level,
      prefix: this.prefix,
      format: this.format,
      correlationId,
      cycleNumber: this.cycleNumber,
      workerId: this.workerId,
      includeCorrelationId: this.includeCorrelationId,
      includeTimestamp: this.includeTimestamp,
    });
    return child;
  }

  /**
   * Create a child logger with a specific worker ID for worker context tracking
   */
  withWorkerId(workerId: string): Logger {
    const child = new Logger({
      level: this.level,
      prefix: this.prefix,
      format: this.format,
      correlationId: this.correlationId,
      cycleNumber: this.cycleNumber,
      workerId,
      includeCorrelationId: this.includeCorrelationId,
      includeTimestamp: this.includeTimestamp,
    });
    return child;
  }

  /**
   * Create a child logger with a specific cycle number for cycle context tracking
   */
  withCycleNumber(cycleNumber: number): Logger {
    const child = new Logger({
      level: this.level,
      prefix: this.prefix,
      format: this.format,
      correlationId: this.correlationId,
      cycleNumber,
      workerId: this.workerId,
      includeCorrelationId: this.includeCorrelationId,
      includeTimestamp: this.includeTimestamp,
    });
    return child;
  }

  /**
   * Create a child logger with full correlation context
   */
  withContext(context: { correlationId?: string; cycleNumber?: number; workerId?: string }): Logger {
    const child = new Logger({
      level: this.level,
      prefix: this.prefix,
      format: this.format,
      correlationId: context.correlationId ?? this.correlationId,
      cycleNumber: context.cycleNumber ?? this.cycleNumber,
      workerId: context.workerId ?? this.workerId,
      includeCorrelationId: this.includeCorrelationId,
      includeTimestamp: this.includeTimestamp,
    });
    return child;
  }

  /**
   * Get the current log entry as a structured object (for testing/inspection)
   */
  getLogEntry(level: LogLevel, message: string, meta?: object): StructuredLogEntry {
    return this.createLogEntry(level, message, meta);
  }
}

export const logger = new Logger({ level: 'info' });

/**
 * Conversation history entry for Claude SDK debugging
 */
export interface ConversationHistoryEntry {
  timestamp: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  type: 'message' | 'tool_use' | 'tool_result' | 'error' | 'timeout';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Claude execution attempt record for retry debugging
 */
export interface ClaudeExecutionAttempt {
  attemptNumber: number;
  startTime: string;
  endTime?: string;
  durationMs?: number;
  success: boolean;
  error?: {
    code: string;
    message: string;
    isRetryable: boolean;
  };
  toolUseCount: number;
  turnCount: number;
  conversationHistory: ConversationHistoryEntry[];
}

/**
 * Claude execution history logger for debugging failed attempts
 */
export class ClaudeExecutionLogger {
  private correlationId: string;
  private taskId: string;
  private attempts: ClaudeExecutionAttempt[] = [];
  private currentAttempt: ClaudeExecutionAttempt | null = null;
  private log: Logger;

  constructor(correlationId: string, taskId: string) {
    this.correlationId = correlationId;
    this.taskId = taskId;
    this.log = logger.child('ClaudeExecutionLogger').withCorrelationId(correlationId);
  }

  /**
   * Start a new execution attempt
   */
  startAttempt(attemptNumber: number): void {
    this.currentAttempt = {
      attemptNumber,
      startTime: new Date().toISOString(),
      success: false,
      toolUseCount: 0,
      turnCount: 0,
      conversationHistory: [],
    };
    this.log.debug(`Starting Claude execution attempt ${attemptNumber}`, {
      taskId: this.taskId,
      attemptNumber,
    });
  }

  /**
   * Record a message in the conversation history
   */
  recordMessage(
    role: ConversationHistoryEntry['role'],
    type: ConversationHistoryEntry['type'],
    content: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.currentAttempt) return;

    const entry: ConversationHistoryEntry = {
      timestamp: new Date().toISOString(),
      role,
      type,
      content: this.truncateContent(content),
      metadata,
    };

    this.currentAttempt.conversationHistory.push(entry);

    // Track tool use and turn counts
    if (type === 'tool_use') {
      this.currentAttempt.toolUseCount++;
    }
    if (role === 'assistant' && type === 'message') {
      this.currentAttempt.turnCount++;
    }
  }

  /**
   * Record tool use
   */
  recordToolUse(toolName: string, input?: Record<string, unknown>): void {
    this.recordMessage('assistant', 'tool_use', toolName, {
      tool: toolName,
      inputSummary: input ? this.summarizeInput(input) : undefined,
    });
  }

  /**
   * Record tool result
   */
  recordToolResult(toolName: string, success: boolean, output?: string): void {
    this.recordMessage('tool', 'tool_result', output ? this.truncateContent(output) : '', {
      tool: toolName,
      success,
    });
  }

  /**
   * Record assistant text response
   */
  recordAssistantText(text: string): void {
    this.recordMessage('assistant', 'message', text);
  }

  /**
   * Record an error in the current attempt
   */
  recordError(code: string, message: string, isRetryable: boolean): void {
    if (!this.currentAttempt) return;

    this.currentAttempt.error = { code, message, isRetryable };
    this.recordMessage('system', 'error', message, { code, isRetryable });

    this.log.warn(`Claude execution error in attempt ${this.currentAttempt.attemptNumber}`, {
      taskId: this.taskId,
      attemptNumber: this.currentAttempt.attemptNumber,
      errorCode: code,
      errorMessage: message,
      isRetryable,
    });
  }

  /**
   * Record a timeout in the current attempt
   */
  recordTimeout(timeoutMs: number): void {
    if (!this.currentAttempt) return;

    this.recordMessage('system', 'timeout', `Execution timed out after ${timeoutMs}ms`, {
      timeoutMs,
    });
    this.currentAttempt.error = {
      code: 'CLAUDE_TIMEOUT',
      message: `Execution timed out after ${Math.round(timeoutMs / 1000)}s`,
      isRetryable: true,
    };

    this.log.warn(`Claude execution timeout in attempt ${this.currentAttempt.attemptNumber}`, {
      taskId: this.taskId,
      attemptNumber: this.currentAttempt.attemptNumber,
      timeoutMs,
    });
  }

  /**
   * End the current attempt
   */
  endAttempt(success: boolean): void {
    if (!this.currentAttempt) return;

    this.currentAttempt.endTime = new Date().toISOString();
    this.currentAttempt.durationMs = new Date(this.currentAttempt.endTime).getTime() -
      new Date(this.currentAttempt.startTime).getTime();
    this.currentAttempt.success = success;

    this.attempts.push(this.currentAttempt);

    this.log.info(`Claude execution attempt ${this.currentAttempt.attemptNumber} ${success ? 'succeeded' : 'failed'}`, {
      taskId: this.taskId,
      attemptNumber: this.currentAttempt.attemptNumber,
      durationMs: this.currentAttempt.durationMs,
      toolUseCount: this.currentAttempt.toolUseCount,
      turnCount: this.currentAttempt.turnCount,
      success,
      errorCode: this.currentAttempt.error?.code,
    });

    this.currentAttempt = null;
  }

  /**
   * Get all execution attempts for debugging
   */
  getAttempts(): ClaudeExecutionAttempt[] {
    return [...this.attempts];
  }

  /**
   * Get a summary of all attempts for logging
   */
  getSummary(): {
    totalAttempts: number;
    successfulAttempts: number;
    totalDurationMs: number;
    totalToolUses: number;
    totalTurns: number;
    lastError?: { code: string; message: string };
  } {
    const totalAttempts = this.attempts.length;
    const successfulAttempts = this.attempts.filter(a => a.success).length;
    const totalDurationMs = this.attempts.reduce((sum, a) => sum + (a.durationMs || 0), 0);
    const totalToolUses = this.attempts.reduce((sum, a) => sum + a.toolUseCount, 0);
    const totalTurns = this.attempts.reduce((sum, a) => sum + a.turnCount, 0);

    const lastFailedAttempt = this.attempts.filter(a => !a.success).pop();

    return {
      totalAttempts,
      successfulAttempts,
      totalDurationMs,
      totalToolUses,
      totalTurns,
      lastError: lastFailedAttempt?.error,
    };
  }

  /**
   * Log the full execution history for debugging
   */
  logFullHistory(level: LogLevel = 'debug'): void {
    const summary = this.getSummary();

    this.log[level]('Claude execution history', {
      taskId: this.taskId,
      correlationId: this.correlationId,
      summary,
    });

    // In debug mode, log each attempt's conversation history
    if (level === 'debug') {
      for (const attempt of this.attempts) {
        this.log.debug(`Attempt ${attempt.attemptNumber} conversation history`, {
          attemptNumber: attempt.attemptNumber,
          startTime: attempt.startTime,
          endTime: attempt.endTime,
          durationMs: attempt.durationMs,
          success: attempt.success,
          toolUseCount: attempt.toolUseCount,
          turnCount: attempt.turnCount,
          error: attempt.error,
          conversationLength: attempt.conversationHistory.length,
        });
      }
    }
  }

  /**
   * Truncate content for logging
   */
  private truncateContent(content: string, maxLength: number = 500): string {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + `... (${content.length} chars total)`;
  }

  /**
   * Summarize tool input for logging
   */
  private summarizeInput(input: Record<string, unknown>): Record<string, string> {
    const summary: Record<string, string> = {};
    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string') {
        summary[key] = value.length > 100 ? `${value.slice(0, 100)}...` : value;
      } else if (value !== undefined && value !== null) {
        summary[key] = typeof value;
      }
    }
    return summary;
  }
}
