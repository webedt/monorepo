/**
 * Database schema definitions for analytics tables.
 * Extends the main database with cycle metrics and pattern effectiveness tracking.
 */

import { pgTable, serial, text, timestamp, boolean, integer, json, real, pgEnum } from 'drizzle-orm/pg-core';

// ============================================================================
// Enums
// ============================================================================

export const taskCategoryEnum = pgEnum('task_category', ['feature', 'bugfix', 'refactor', 'docs', 'test', 'chore', 'other']);
export const complexityLevelEnum = pgEnum('complexity_level', ['trivial', 'low', 'medium', 'high', 'critical']);
export const outcomeEnum = pgEnum('task_outcome', ['success', 'failure', 'timeout', 'skipped']);

// ============================================================================
// Cycle Metrics Table
// ============================================================================

/**
 * Stores metrics for each daemon cycle execution.
 * Used to track performance trends and identify bottlenecks.
 */
export const cycleMetrics = pgTable('cycle_metrics', {
  id: serial('id').primaryKey(),

  // Cycle identification
  correlationId: text('correlation_id').notNull().unique(),
  cycleNumber: integer('cycle_number').notNull(),
  repository: text('repository').notNull(),

  // Timing metrics
  startedAt: timestamp('started_at').notNull(),
  completedAt: timestamp('completed_at').notNull(),
  durationMs: integer('duration_ms').notNull(),

  // Discovery metrics
  tasksDiscovered: integer('tasks_discovered').notNull().default(0),
  tasksFromIssues: integer('tasks_from_issues').notNull().default(0),
  tasksFromDiscovery: integer('tasks_from_discovery').notNull().default(0),
  discoveryDurationMs: integer('discovery_duration_ms'),

  // Execution metrics
  tasksAttempted: integer('tasks_attempted').notNull().default(0),
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  tasksFailed: integer('tasks_failed').notNull().default(0),
  tasksSkipped: integer('tasks_skipped').notNull().default(0),

  // PR metrics
  prsCreated: integer('prs_created').notNull().default(0),
  prsMerged: integer('prs_merged').notNull().default(0),
  prsRejected: integer('prs_rejected').notNull().default(0),

  // Cost metrics
  githubApiCalls: integer('github_api_calls').notNull().default(0),
  claudeApiCalls: integer('claude_api_calls').notNull().default(0),
  totalApiCalls: integer('total_api_calls').notNull().default(0),

  // Resource usage
  peakMemoryMb: real('peak_memory_mb'),
  memoryDeltaMb: real('memory_delta_mb'),

  // Service health
  degraded: boolean('degraded').notNull().default(false),
  serviceHealthSnapshot: json('service_health_snapshot').$type<{
    github: { status: string; circuitState: string; rateLimitRemaining?: number } | null;
    overallStatus: string;
  }>(),

  // Error tracking
  errorCount: integer('error_count').notNull().default(0),
  errors: json('errors').$type<Array<{
    code: string;
    message: string;
    component: string;
    isRetryable: boolean;
  }>>().default([]),

  // Computed success rate for the cycle
  successRate: real('success_rate'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// Task Metrics Table
// ============================================================================

/**
 * Stores individual task execution metrics.
 * Used to track task-level performance by category and complexity.
 */
export const taskMetrics = pgTable('task_metrics', {
  id: serial('id').primaryKey(),

  // Link to cycle
  cycleMetricsId: integer('cycle_metrics_id').notNull(),
  correlationId: text('correlation_id').notNull(),

  // Task identification
  issueNumber: integer('issue_number'),
  taskTitle: text('task_title').notNull(),
  branchName: text('branch_name'),

  // Classification
  category: text('category').notNull().default('other'),
  complexity: text('complexity').notNull().default('medium'),
  priority: text('priority'),

  // Affected paths for pattern analysis
  affectedPaths: json('affected_paths').$type<string[]>().default([]),

  // Outcome
  outcome: text('outcome').notNull(),

  // Timing
  startedAt: timestamp('started_at').notNull(),
  completedAt: timestamp('completed_at'),
  durationMs: integer('duration_ms'),

  // Worker info
  workerId: text('worker_id'),

  // API usage for this task
  claudeApiCalls: integer('claude_api_calls').notNull().default(0),
  claudeToolUses: integer('claude_tool_uses').notNull().default(0),

  // Error details if failed
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  isRetryable: boolean('is_retryable'),

  // PR info if created
  prNumber: integer('pr_number'),
  prMerged: boolean('pr_merged').default(false),

  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================================
// Pattern Effectiveness Table
// ============================================================================

/**
 * Tracks which codebase patterns lead to successful implementations.
 * Aggregated periodically to identify effective discovery patterns.
 */
export const patternEffectiveness = pgTable('pattern_effectiveness', {
  id: serial('id').primaryKey(),

  // Pattern identification
  repository: text('repository').notNull(),
  pattern: text('pattern').notNull(),
  patternType: text('pattern_type').notNull(), // 'path', 'file_extension', 'directory', 'file_pattern'

  // Period for aggregation
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),

  // Success metrics
  totalTasks: integer('total_tasks').notNull().default(0),
  successfulTasks: integer('successful_tasks').notNull().default(0),
  failedTasks: integer('failed_tasks').notNull().default(0),

  // Success rate as percentage
  successRate: real('success_rate').notNull().default(0),

  // Average metrics
  avgDurationMs: real('avg_duration_ms'),
  avgApiCalls: real('avg_api_calls'),

  // Breakdown by category
  categoryBreakdown: json('category_breakdown').$type<Record<string, {
    total: number;
    successful: number;
    successRate: number;
  }>>(),

  // Breakdown by complexity
  complexityBreakdown: json('complexity_breakdown').$type<Record<string, {
    total: number;
    successful: number;
    successRate: number;
  }>>(),

  // Common failure reasons
  failureReasons: json('failure_reasons').$type<Record<string, number>>(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Monthly Summary Table
// ============================================================================

/**
 * Monthly aggregated analytics for trend analysis.
 * Pre-computed to enable fast dashboard queries.
 */
export const monthlySummary = pgTable('monthly_summary', {
  id: serial('id').primaryKey(),

  repository: text('repository').notNull(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),

  // Cycle summary
  totalCycles: integer('total_cycles').notNull().default(0),
  avgCycleDurationMs: real('avg_cycle_duration_ms'),
  maxCycleDurationMs: integer('max_cycle_duration_ms'),
  minCycleDurationMs: integer('min_cycle_duration_ms'),

  // Task discovery summary
  totalTasksDiscovered: integer('total_tasks_discovered').notNull().default(0),
  discoverySuccessRate: real('discovery_success_rate'),

  // Task execution summary
  totalTasksAttempted: integer('total_tasks_attempted').notNull().default(0),
  totalTasksCompleted: integer('total_tasks_completed').notNull().default(0),
  totalTasksFailed: integer('total_tasks_failed').notNull().default(0),
  overallSuccessRate: real('overall_success_rate'),

  // PR summary
  totalPrsCreated: integer('total_prs_created').notNull().default(0),
  totalPrsMerged: integer('total_prs_merged').notNull().default(0),
  prMergeRate: real('pr_merge_rate'),

  // Cost efficiency
  totalApiCalls: integer('total_api_calls').notNull().default(0),
  successfulImplementationsPerApiCall: real('successful_implementations_per_api_call'),
  avgApiCallsPerTask: real('avg_api_calls_per_task'),

  // Success by category
  successRateByCategory: json('success_rate_by_category').$type<Record<string, {
    attempted: number;
    completed: number;
    successRate: number;
  }>>(),

  // Success by complexity
  successRateByComplexity: json('success_rate_by_complexity').$type<Record<string, {
    attempted: number;
    completed: number;
    successRate: number;
  }>>(),

  // Top performing patterns
  topPatterns: json('top_patterns').$type<Array<{
    pattern: string;
    patternType: string;
    successRate: number;
    taskCount: number;
  }>>(),

  // Common failure categories
  failureCategories: json('failure_categories').$type<Record<string, {
    count: number;
    percentage: number;
    examples: string[];
  }>>(),

  // Trend indicators (compared to previous month)
  successRateTrend: real('success_rate_trend'), // Positive = improvement
  efficiencyTrend: real('efficiency_trend'),

  // Service reliability
  degradedCycleCount: integer('degraded_cycle_count').notNull().default(0),
  avgErrorsPerCycle: real('avg_errors_per_cycle'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ============================================================================
// Types
// ============================================================================

export type CycleMetric = typeof cycleMetrics.$inferSelect;
export type NewCycleMetric = typeof cycleMetrics.$inferInsert;

export type TaskMetric = typeof taskMetrics.$inferSelect;
export type NewTaskMetric = typeof taskMetrics.$inferInsert;

export type PatternEffectiveness = typeof patternEffectiveness.$inferSelect;
export type NewPatternEffectiveness = typeof patternEffectiveness.$inferInsert;

export type MonthlySummary = typeof monthlySummary.$inferSelect;
export type NewMonthlySummary = typeof monthlySummary.$inferInsert;
