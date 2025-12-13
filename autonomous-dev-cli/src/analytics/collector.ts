/**
 * Analytics Collector Module
 *
 * Collects and persists metrics after each daemon cycle.
 * Designed for zero impact on daemon execution flow.
 */

import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import {
  insertCycleMetrics,
  insertTaskMetricsBatch,
  type NewCycleMetric,
  type NewTaskMetric,
} from '../db/index.js';
import type { Issue } from '../github/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Task execution result for analytics tracking
 */
export interface TaskExecutionData {
  issue: Issue;
  branchName: string;
  success: boolean;
  error?: string;
  durationMs?: number;
  workerId?: string;
  claudeApiCalls?: number;
  claudeToolUses?: number;
  prNumber?: number;
  prMerged?: boolean;
}

/**
 * Cycle analytics data collected during execution
 */
export interface CycleAnalyticsData {
  correlationId: string;
  cycleNumber: number;
  repository: string;

  // Timing
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  discoveryDurationMs?: number;

  // Discovery metrics
  tasksDiscovered: number;
  tasksFromIssues: number;
  tasksFromDiscovery: number;

  // Execution results
  taskResults: TaskExecutionData[];

  // API usage (from metrics registry)
  githubApiCalls: number;
  claudeApiCalls: number;

  // Resource usage
  peakMemoryMb?: number;
  memoryDeltaMb?: number;

  // Service health
  degraded: boolean;
  serviceHealthSnapshot?: {
    github: { status: string; circuitState: string; rateLimitRemaining?: number } | null;
    overallStatus: string;
  };

  // Errors collected during cycle
  errors: Array<{
    code: string;
    message: string;
    component: string;
    isRetryable: boolean;
  }>;
}

/**
 * Configuration for the analytics collector
 */
export interface AnalyticsCollectorConfig {
  enabled: boolean;
  asyncPersistence: boolean; // If true, persists analytics in background
  logErrors: boolean;
}

const DEFAULT_CONFIG: AnalyticsCollectorConfig = {
  enabled: true,
  asyncPersistence: true,
  logErrors: true,
};

// ============================================================================
// Analytics Collector
// ============================================================================

/**
 * Collects cycle analytics and persists to database.
 * Designed for minimal overhead on the main daemon loop.
 */
export class AnalyticsCollector {
  private config: AnalyticsCollectorConfig;
  private pendingWrites: Promise<void>[] = [];

  constructor(config: Partial<AnalyticsCollectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Collect and persist analytics for a completed cycle.
   * Non-blocking by default to avoid impacting daemon performance.
   */
  async collectCycleAnalytics(data: CycleAnalyticsData): Promise<void> {
    if (!this.config.enabled) {
      return;
    }

    const persistTask = this.persistCycleAnalytics(data);

    if (this.config.asyncPersistence) {
      // Track for potential flush on shutdown
      this.pendingWrites.push(persistTask);
      persistTask.finally(() => {
        this.pendingWrites = this.pendingWrites.filter((p) => p !== persistTask);
      });
    } else {
      await persistTask;
    }
  }

  /**
   * Internal method to persist cycle analytics to database
   */
  private async persistCycleAnalytics(data: CycleAnalyticsData): Promise<void> {
    try {
      // Calculate derived metrics
      const tasksAttempted = data.taskResults.length;
      const tasksCompleted = data.taskResults.filter((t) => t.success).length;
      const tasksFailed = data.taskResults.filter((t) => !t.success).length;
      const prsCreated = data.taskResults.filter((t) => t.prNumber).length;
      const prsMerged = data.taskResults.filter((t) => t.prMerged).length;
      const successRate = tasksAttempted > 0 ? (tasksCompleted / tasksAttempted) * 100 : null;

      // Prepare cycle metrics record
      const cycleMetric: NewCycleMetric = {
        correlationId: data.correlationId,
        cycleNumber: data.cycleNumber,
        repository: data.repository,
        startedAt: data.startedAt,
        completedAt: data.completedAt,
        durationMs: data.durationMs,
        discoveryDurationMs: data.discoveryDurationMs,
        tasksDiscovered: data.tasksDiscovered,
        tasksFromIssues: data.tasksFromIssues,
        tasksFromDiscovery: data.tasksFromDiscovery,
        tasksAttempted,
        tasksCompleted,
        tasksFailed,
        tasksSkipped: 0,
        prsCreated,
        prsMerged,
        prsRejected: prsCreated - prsMerged,
        githubApiCalls: data.githubApiCalls,
        claudeApiCalls: data.claudeApiCalls,
        totalApiCalls: data.githubApiCalls + data.claudeApiCalls,
        peakMemoryMb: data.peakMemoryMb,
        memoryDeltaMb: data.memoryDeltaMb,
        degraded: data.degraded,
        serviceHealthSnapshot: data.serviceHealthSnapshot,
        errorCount: data.errors.length,
        errors: data.errors,
        successRate,
      };

      // Insert cycle metrics and get the ID
      const insertedCycle = await insertCycleMetrics(cycleMetric);

      // Prepare task metrics records
      const taskMetrics: NewTaskMetric[] = data.taskResults.map((task) => ({
        cycleMetricsId: insertedCycle.id,
        correlationId: data.correlationId,
        issueNumber: task.issue.number,
        taskTitle: task.issue.title,
        branchName: task.branchName,
        category: this.extractCategory(task.issue),
        complexity: this.extractComplexity(task.issue),
        priority: this.extractPriority(task.issue),
        affectedPaths: this.extractAffectedPaths(task.issue),
        outcome: task.success ? 'success' : 'failure',
        startedAt: data.startedAt, // Approximate - could be enhanced with per-task timing
        completedAt: task.success ? data.completedAt : undefined,
        durationMs: task.durationMs,
        workerId: task.workerId,
        claudeApiCalls: task.claudeApiCalls ?? 0,
        claudeToolUses: task.claudeToolUses ?? 0,
        errorCode: task.error ? this.extractErrorCode(task.error) : undefined,
        errorMessage: task.error,
        isRetryable: task.error ? this.isRetryableError(task.error) : undefined,
        prNumber: task.prNumber,
        prMerged: task.prMerged,
      }));

      // Batch insert task metrics
      if (taskMetrics.length > 0) {
        await insertTaskMetricsBatch(taskMetrics);
      }

      logger.debug('Persisted cycle analytics', {
        correlationId: data.correlationId,
        cycleNumber: data.cycleNumber,
        tasksAttempted,
        tasksCompleted,
        successRate: successRate?.toFixed(1),
      });
    } catch (error: any) {
      if (this.config.logErrors) {
        logger.warn('Failed to persist cycle analytics', {
          correlationId: data.correlationId,
          error: error.message,
        });
      }
      // Don't throw - analytics failures should not impact daemon operation
    }
  }

  /**
   * Extract task category from issue labels
   */
  private extractCategory(issue: Issue): string {
    const categoryLabels = ['feature', 'bugfix', 'refactor', 'docs', 'test', 'chore'];

    for (const label of issue.labels) {
      const normalized = label.toLowerCase();
      // Check for direct matches
      if (categoryLabels.includes(normalized)) {
        return normalized;
      }
      // Check for prefixed labels like "type:feature"
      for (const category of categoryLabels) {
        if (normalized.includes(category)) {
          return category;
        }
      }
    }

    return 'other';
  }

  /**
   * Extract complexity level from issue labels
   */
  private extractComplexity(issue: Issue): string {
    const complexityLevels = ['trivial', 'low', 'medium', 'high', 'critical'];

    for (const label of issue.labels) {
      const normalized = label.toLowerCase();
      // Check for prefixed labels like "complexity:high"
      for (const level of complexityLevels) {
        if (normalized.includes(`complexity:${level}`) || normalized === level) {
          return level;
        }
      }
    }

    return 'medium';
  }

  /**
   * Extract priority from issue labels
   */
  private extractPriority(issue: Issue): string | undefined {
    const priorities = ['critical', 'high', 'medium', 'low'];

    for (const label of issue.labels) {
      const normalized = label.toLowerCase();
      for (const priority of priorities) {
        if (normalized.includes(`priority:${priority}`)) {
          return priority;
        }
      }
    }

    return undefined;
  }

  /**
   * Extract affected paths from issue body
   */
  private extractAffectedPaths(issue: Issue): string[] {
    if (!issue.body) return [];

    const paths: string[] = [];
    const pathPattern = /`([^`]+\.[a-z]+)`|[\s]+(src\/[^\s]+)/g;

    let match;
    while ((match = pathPattern.exec(issue.body)) !== null) {
      const path = match[1] || match[2];
      if (path && !paths.includes(path)) {
        paths.push(path);
      }
    }

    return paths;
  }

  /**
   * Extract error code from error message
   */
  private extractErrorCode(error: string): string {
    // Look for bracketed error codes like [GITHUB_API_ERROR]
    const match = error.match(/\[([A-Z_]+)\]/);
    return match ? match[1] : 'UNKNOWN_ERROR';
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryableError(error: string): boolean {
    const retryablePatterns = [
      'rate limit',
      'timeout',
      'network',
      'connection',
      '429',
      '502',
      '503',
      '504',
      'ECONNRESET',
      'ETIMEDOUT',
    ];

    const lowerError = error.toLowerCase();
    return retryablePatterns.some((pattern) => lowerError.includes(pattern.toLowerCase()));
  }

  /**
   * Wait for all pending analytics writes to complete.
   * Call this during shutdown to ensure all data is persisted.
   */
  async flush(): Promise<void> {
    if (this.pendingWrites.length > 0) {
      logger.debug(`Flushing ${this.pendingWrites.length} pending analytics writes`);
      await Promise.allSettled(this.pendingWrites);
      this.pendingWrites = [];
    }
  }

  /**
   * Enable or disable analytics collection
   */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /**
   * Check if analytics collection is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an analytics collector instance
 */
export function createAnalyticsCollector(
  config: Partial<AnalyticsCollectorConfig> = {}
): AnalyticsCollector {
  return new AnalyticsCollector(config);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Build cycle analytics data from daemon cycle results.
 * Helper function for integrating with the daemon.
 */
export function buildCycleAnalyticsData(params: {
  correlationId: string;
  cycleNumber: number;
  repository: string;
  startTime: Date;
  endTime: Date;
  discoveryDurationMs?: number;
  existingIssueCount: number;
  discoveredTaskCount: number;
  taskResults: TaskExecutionData[];
  degraded: boolean;
  serviceHealth?: {
    github: { status: string; circuitState: string; rateLimitRemaining?: number } | null;
    overallStatus: string;
  };
  errors: Array<{ code: string; message: string; component: string; isRetryable: boolean }>;
  memoryDeltaMb?: number;
  peakMemoryMb?: number;
}): CycleAnalyticsData {
  const durationMs = params.endTime.getTime() - params.startTime.getTime();

  // Get API call counts from metrics (approximation based on current session)
  // In practice, you would track these during the cycle
  const githubApiCalls = 0; // Would be tracked during cycle
  const claudeApiCalls = 0; // Would be tracked during cycle

  return {
    correlationId: params.correlationId,
    cycleNumber: params.cycleNumber,
    repository: params.repository,
    startedAt: params.startTime,
    completedAt: params.endTime,
    durationMs,
    discoveryDurationMs: params.discoveryDurationMs,
    tasksDiscovered: params.existingIssueCount + params.discoveredTaskCount,
    tasksFromIssues: params.existingIssueCount,
    tasksFromDiscovery: params.discoveredTaskCount,
    taskResults: params.taskResults,
    githubApiCalls,
    claudeApiCalls,
    peakMemoryMb: params.peakMemoryMb,
    memoryDeltaMb: params.memoryDeltaMb,
    degraded: params.degraded,
    serviceHealthSnapshot: params.serviceHealth,
    errors: params.errors,
  };
}
