/**
 * Database Query Analyzer for Development Mode
 *
 * Provides EXPLAIN ANALYZE wrapper to detect performance issues:
 * - Slow queries exceeding configurable threshold
 * - Sequential scans indicating missing indexes
 * - N+1 query patterns
 *
 * Features:
 * - Automatic EXPLAIN ANALYZE in development mode
 * - Configurable slow query threshold
 * - Sequential scan detection
 * - Integration with metrics system
 * - Query pattern logging for analysis
 */

import pg from 'pg';

import {
  NODE_ENV,
  QUERY_ANALYSIS_ENABLED,
  QUERY_ANALYSIS_SLOW_THRESHOLD_MS,
  QUERY_ANALYSIS_EXPLAIN_ENABLED,
  QUERY_ANALYSIS_LOG_ALL,
  QUERY_ANALYSIS_MAX_LOG_ENTRIES,
} from '../config/env.js';
import { logger } from '../utils/logging/logger.js';
import { metrics } from '../utils/monitoring/metrics.js';

// ============================================================================
// TYPES
// ============================================================================

export interface QueryAnalyzerConfig {
  /** Enable query analysis (default: true in development) */
  enabled?: boolean;
  /** Threshold for slow query detection in ms (default: 100) */
  slowQueryThresholdMs?: number;
  /** Log all queries, not just slow ones (default: false) */
  logAllQueries?: boolean;
  /** Enable EXPLAIN ANALYZE for slow queries (default: true) */
  explainEnabled?: boolean;
  /** Maximum queries to keep in log (default: 1000) */
  maxLogEntries?: number;
  /** Callback for slow query alerts */
  onSlowQuery?: (entry: QueryAnalysisEntry) => void;
  /** Callback for sequential scan detection */
  onSequentialScan?: (entry: QueryAnalysisEntry) => void;
}

export interface ExplainNode {
  /** Node type (e.g., 'Seq Scan', 'Index Scan', 'Hash Join') */
  nodeType: string;
  /** Relation/table name if applicable */
  relationName?: string;
  /** Estimated startup cost */
  startupCost: number;
  /** Estimated total cost */
  totalCost: number;
  /** Estimated rows */
  planRows: number;
  /** Actual rows returned */
  actualRows?: number;
  /** Actual time in ms */
  actualTime?: number;
  /** Number of loops */
  loops?: number;
  /** Index name if using index scan */
  indexName?: string;
  /** Index condition */
  indexCond?: string;
  /** Filter condition */
  filter?: string;
  /** Rows removed by filter */
  rowsRemovedByFilter?: number;
  /** Child nodes */
  plans?: ExplainNode[];
}

export interface ExplainResult {
  /** Top-level plan node */
  plan: ExplainNode;
  /** Total planning time in ms */
  planningTime: number;
  /** Total execution time in ms */
  executionTime: number;
  /** Detected issues */
  issues: QueryIssue[];
}

export interface QueryIssue {
  /** Issue type */
  type: 'sequential_scan' | 'slow_query' | 'high_rows_estimate' | 'filter_inefficiency';
  /** Issue severity */
  severity: 'warning' | 'error';
  /** Human-readable message */
  message: string;
  /** Table/relation involved */
  table?: string;
  /** Suggested fix */
  suggestion?: string;
}

export interface QueryAnalysisEntry {
  /** Unique query ID */
  id: string;
  /** Original query SQL */
  query: string;
  /** Query parameters */
  params?: unknown[];
  /** Normalized query for pattern matching */
  normalizedQuery: string;
  /** Query execution duration in ms */
  durationMs: number;
  /** Timestamp when query was executed */
  timestamp: Date;
  /** EXPLAIN ANALYZE result if available */
  explainResult?: ExplainResult;
  /** Detected issues */
  issues: QueryIssue[];
  /** Stack trace for debugging */
  stackTrace?: string;
  /** Query operation type (SELECT, INSERT, UPDATE, DELETE) */
  operation: string;
}

export interface QueryPatternStats {
  /** Normalized query pattern */
  pattern: string;
  /** Number of times executed */
  count: number;
  /** Average duration in ms */
  avgDurationMs: number;
  /** Maximum duration in ms */
  maxDurationMs: number;
  /** Minimum duration in ms */
  minDurationMs: number;
  /** Total duration across all executions */
  totalDurationMs: number;
  /** First seen timestamp */
  firstSeen: Date;
  /** Last seen timestamp */
  lastSeen: Date;
  /** Common issues detected */
  issues: Map<string, number>;
}

export interface QueryAnalysisSummary {
  /** Total queries analyzed */
  totalQueries: number;
  /** Total slow queries */
  slowQueries: number;
  /** Total queries with sequential scans */
  sequentialScanQueries: number;
  /** Query patterns with stats */
  patterns: Map<string, QueryPatternStats>;
  /** Potential N+1 patterns (same query executed multiple times) */
  potentialN1Patterns: string[];
  /** Top slow queries */
  topSlowQueries: QueryAnalysisEntry[];
  /** Analysis time range */
  timeRange: {
    start: Date;
    end: Date;
  };
}

// ============================================================================
// QUERY ANALYZER
// ============================================================================

/**
 * Query Analyzer for detecting database performance issues
 *
 * @example
 * const analyzer = new QueryAnalyzer({ slowQueryThresholdMs: 50 });
 *
 * // Analyze a query
 * const result = await analyzer.analyzeQuery(
 *   pool,
 *   'SELECT * FROM users WHERE email = $1',
 *   ['user@example.com']
 * );
 *
 * // Get summary
 * const summary = analyzer.getSummary();
 */
export class QueryAnalyzer {
  private config: Required<QueryAnalyzerConfig>;
  private entries: QueryAnalysisEntry[] = [];
  private patterns: Map<string, QueryPatternStats> = new Map();
  private idCounter = 0;

  constructor(config: QueryAnalyzerConfig = {}) {
    const isDev = NODE_ENV === 'development';

    // Use environment configuration as defaults, with explicit config overrides
    this.config = {
      enabled: config.enabled ?? QUERY_ANALYSIS_ENABLED ?? isDev,
      slowQueryThresholdMs: config.slowQueryThresholdMs ?? QUERY_ANALYSIS_SLOW_THRESHOLD_MS,
      logAllQueries: config.logAllQueries ?? QUERY_ANALYSIS_LOG_ALL,
      explainEnabled: config.explainEnabled ?? QUERY_ANALYSIS_EXPLAIN_ENABLED,
      maxLogEntries: config.maxLogEntries ?? QUERY_ANALYSIS_MAX_LOG_ENTRIES,
      onSlowQuery: config.onSlowQuery ?? (() => {}),
      onSequentialScan: config.onSequentialScan ?? (() => {}),
    };
  }

  /**
   * Check if query analysis is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Analyze a query execution
   */
  async analyzeQuery(
    pool: pg.Pool,
    query: string,
    params?: unknown[],
    durationMs?: number
  ): Promise<QueryAnalysisEntry | null> {
    if (!this.config.enabled) {
      return null;
    }

    const normalizedQuery = this.normalizeQuery(query);
    const operation = this.extractOperation(query);
    const actualDuration = durationMs ?? 0;

    const entry: QueryAnalysisEntry = {
      id: `q_${++this.idCounter}`,
      query,
      params,
      normalizedQuery,
      durationMs: actualDuration,
      timestamp: new Date(),
      issues: [],
      operation,
      stackTrace: this.captureStackTrace(),
    };

    // Check if query is slow
    const isSlow = actualDuration >= this.config.slowQueryThresholdMs;

    if (isSlow) {
      entry.issues.push({
        type: 'slow_query',
        severity: actualDuration >= this.config.slowQueryThresholdMs * 5 ? 'error' : 'warning',
        message: `Query took ${actualDuration}ms (threshold: ${this.config.slowQueryThresholdMs}ms)`,
        suggestion: 'Consider adding indexes or optimizing the query',
      });

      // Record slow query metric
      metrics.recordDbQuery(operation, true, actualDuration);
    }

    // Run EXPLAIN ANALYZE for slow queries (only for SELECT queries to avoid side effects)
    if (isSlow && this.config.explainEnabled && operation === 'SELECT') {
      try {
        entry.explainResult = await this.runExplainAnalyze(pool, query, params);
        entry.issues.push(...entry.explainResult.issues);
      } catch (error) {
        // EXPLAIN failed - query might be too complex or have side effects
        logger.debug('EXPLAIN ANALYZE failed', {
          component: 'QueryAnalyzer',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Update pattern stats
    this.updatePatternStats(entry);

    // Store entry
    this.entries.push(entry);
    if (this.entries.length > this.config.maxLogEntries) {
      this.entries.shift();
    }

    // Log if slow or logging all queries
    if (isSlow || this.config.logAllQueries) {
      this.logQueryAnalysis(entry);
    }

    // Callbacks
    if (isSlow) {
      this.config.onSlowQuery(entry);
    }

    const hasSequentialScan = entry.issues.some(i => i.type === 'sequential_scan');
    if (hasSequentialScan) {
      this.config.onSequentialScan(entry);
    }

    return entry;
  }

  /**
   * Run EXPLAIN ANALYZE on a query
   */
  async runExplainAnalyze(
    pool: pg.Pool,
    query: string,
    params?: unknown[]
  ): Promise<ExplainResult> {
    const explainQuery = `EXPLAIN (ANALYZE, FORMAT JSON, BUFFERS) ${query}`;
    const result = await pool.query(explainQuery, params);

    if (!result.rows?.[0]?.['QUERY PLAN']?.[0]) {
      throw new Error('Invalid EXPLAIN ANALYZE result');
    }

    const planData = result.rows[0]['QUERY PLAN'][0];
    const plan = this.parseExplainNode(planData.Plan);
    const issues = this.detectIssues(plan);

    return {
      plan,
      planningTime: planData['Planning Time'] ?? 0,
      executionTime: planData['Execution Time'] ?? 0,
      issues,
    };
  }

  /**
   * Parse EXPLAIN node from JSON output
   */
  private parseExplainNode(node: Record<string, unknown>): ExplainNode {
    const result: ExplainNode = {
      nodeType: node['Node Type'] as string,
      relationName: node['Relation Name'] as string | undefined,
      startupCost: node['Startup Cost'] as number,
      totalCost: node['Total Cost'] as number,
      planRows: node['Plan Rows'] as number,
      actualRows: node['Actual Rows'] as number | undefined,
      actualTime: node['Actual Total Time'] as number | undefined,
      loops: node['Actual Loops'] as number | undefined,
      indexName: node['Index Name'] as string | undefined,
      indexCond: node['Index Cond'] as string | undefined,
      filter: node['Filter'] as string | undefined,
      rowsRemovedByFilter: node['Rows Removed by Filter'] as number | undefined,
    };

    if (Array.isArray(node['Plans'])) {
      result.plans = node['Plans'].map((p: Record<string, unknown>) => this.parseExplainNode(p));
    }

    return result;
  }

  /**
   * Detect performance issues from EXPLAIN plan
   */
  private detectIssues(node: ExplainNode, issues: QueryIssue[] = []): QueryIssue[] {
    // Detect sequential scans on large tables
    if (node.nodeType === 'Seq Scan') {
      const rowThreshold = 1000; // Consider seq scan problematic for tables with many rows
      if ((node.actualRows ?? node.planRows) > rowThreshold) {
        issues.push({
          type: 'sequential_scan',
          severity: 'warning',
          message: `Sequential scan on "${node.relationName}" (${node.actualRows ?? node.planRows} rows)`,
          table: node.relationName,
          suggestion: `Consider adding an index on "${node.relationName}" for the filtered columns`,
        });
      }
    }

    // Detect filter inefficiency
    if (node.rowsRemovedByFilter && node.actualRows) {
      const filterRatio = node.rowsRemovedByFilter / (node.actualRows + node.rowsRemovedByFilter);
      if (filterRatio > 0.9) {
        issues.push({
          type: 'filter_inefficiency',
          severity: 'warning',
          message: `Filter removed ${(filterRatio * 100).toFixed(1)}% of rows on "${node.relationName}"`,
          table: node.relationName,
          suggestion: 'The filter is removing most rows - an index might help',
        });
      }
    }

    // Detect high row estimates vs actual
    if (node.actualRows !== undefined && node.planRows > 0) {
      const estimateRatio = node.actualRows / node.planRows;
      if (estimateRatio > 10 || estimateRatio < 0.1) {
        issues.push({
          type: 'high_rows_estimate',
          severity: 'warning',
          message: `Row estimate inaccurate: planned ${node.planRows}, actual ${node.actualRows}`,
          table: node.relationName,
          suggestion: 'Consider running ANALYZE on the table to update statistics',
        });
      }
    }

    // Recursively check child nodes
    if (node.plans) {
      for (const child of node.plans) {
        this.detectIssues(child, issues);
      }
    }

    return issues;
  }

  /**
   * Update pattern statistics
   */
  private updatePatternStats(entry: QueryAnalysisEntry): void {
    const pattern = entry.normalizedQuery;
    const existing = this.patterns.get(pattern);

    if (existing) {
      existing.count++;
      existing.totalDurationMs += entry.durationMs;
      existing.avgDurationMs = existing.totalDurationMs / existing.count;
      existing.maxDurationMs = Math.max(existing.maxDurationMs, entry.durationMs);
      existing.minDurationMs = Math.min(existing.minDurationMs, entry.durationMs);
      existing.lastSeen = entry.timestamp;

      for (const issue of entry.issues) {
        existing.issues.set(issue.type, (existing.issues.get(issue.type) ?? 0) + 1);
      }
    } else {
      this.patterns.set(pattern, {
        pattern,
        count: 1,
        avgDurationMs: entry.durationMs,
        maxDurationMs: entry.durationMs,
        minDurationMs: entry.durationMs,
        totalDurationMs: entry.durationMs,
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
        issues: new Map(entry.issues.map(i => [i.type, 1])),
      });
    }
  }

  /**
   * Get analysis summary
   */
  getSummary(): QueryAnalysisSummary {
    const n1Threshold = 3; // Queries executed 3+ times are potential N+1

    const potentialN1Patterns = Array.from(this.patterns.entries())
      .filter(([_, stats]) => stats.count >= n1Threshold)
      .map(([pattern, stats]) => `${pattern} (${stats.count}x, avg ${stats.avgDurationMs.toFixed(1)}ms)`);

    const topSlowQueries = [...this.entries]
      .filter(e => e.durationMs >= this.config.slowQueryThresholdMs)
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 10);

    const timestamps = this.entries.map(e => e.timestamp.getTime());
    const minTime = timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date();
    const maxTime = timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date();

    return {
      totalQueries: this.entries.length,
      slowQueries: this.entries.filter(e => e.durationMs >= this.config.slowQueryThresholdMs).length,
      sequentialScanQueries: this.entries.filter(e => e.issues.some(i => i.type === 'sequential_scan')).length,
      patterns: new Map(this.patterns),
      potentialN1Patterns,
      topSlowQueries,
      timeRange: {
        start: minTime,
        end: maxTime,
      },
    };
  }

  /**
   * Get all entries
   */
  getEntries(): QueryAnalysisEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all logged entries and patterns
   */
  clear(): void {
    this.entries = [];
    this.patterns.clear();
    this.idCounter = 0;
  }

  /**
   * Format summary for display
   */
  formatSummary(): string {
    const summary = this.getSummary();
    const lines: string[] = [];

    lines.push('=== Query Analysis Summary ===');
    lines.push(`Total Queries: ${summary.totalQueries}`);
    lines.push(`Slow Queries: ${summary.slowQueries} (threshold: ${this.config.slowQueryThresholdMs}ms)`);
    lines.push(`Sequential Scans: ${summary.sequentialScanQueries}`);
    lines.push(`Time Range: ${summary.timeRange.start.toISOString()} - ${summary.timeRange.end.toISOString()}`);

    if (summary.potentialN1Patterns.length > 0) {
      lines.push('');
      lines.push('Potential N+1 Patterns:');
      for (const pattern of summary.potentialN1Patterns) {
        lines.push(`  - ${pattern}`);
      }
    }

    if (summary.topSlowQueries.length > 0) {
      lines.push('');
      lines.push('Top Slow Queries:');
      for (const entry of summary.topSlowQueries) {
        lines.push(`  ${entry.durationMs}ms: ${entry.normalizedQuery.slice(0, 80)}...`);
        for (const issue of entry.issues) {
          lines.push(`    [${issue.severity.toUpperCase()}] ${issue.message}`);
        }
      }
    }

    lines.push('==============================');

    return lines.join('\n');
  }

  /**
   * Print summary to console
   */
  printSummary(): void {
    console.log(this.formatSummary());
  }

  /**
   * Log query analysis entry
   */
  private logQueryAnalysis(entry: QueryAnalysisEntry): void {
    const level = entry.issues.some(i => i.severity === 'error') ? 'warn' : 'info';
    const issueTypes = entry.issues.map(i => i.type).join(', ');

    logger[level](`Slow query: ${entry.durationMs}ms`, {
      component: 'QueryAnalyzer',
      queryId: entry.id,
      operation: entry.operation,
      durationMs: entry.durationMs,
      issues: issueTypes || 'none',
      normalizedQuery: entry.normalizedQuery.slice(0, 100),
    });

    // Log individual issues
    for (const issue of entry.issues) {
      if (issue.type === 'sequential_scan') {
        logger.warn(`Sequential scan detected on "${issue.table}"`, {
          component: 'QueryAnalyzer',
          queryId: entry.id,
          suggestion: issue.suggestion,
        });
      }
    }
  }

  /**
   * Normalize query for pattern matching
   */
  private normalizeQuery(query: string): string {
    return query
      // Replace UUID-like strings
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        '<uuid>'
      )
      // Replace numeric values
      .replace(/\b\d+\b/g, '<n>')
      // Replace string literals
      .replace(/'[^']*'/g, "'<str>'")
      // Replace parameter placeholders ($1, $2, etc.)
      .replace(/\$\d+/g, '$?')
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Extract operation type from query
   */
  private extractOperation(query: string): string {
    const trimmed = query.trim().toUpperCase();
    if (trimmed.startsWith('SELECT')) return 'SELECT';
    if (trimmed.startsWith('INSERT')) return 'INSERT';
    if (trimmed.startsWith('UPDATE')) return 'UPDATE';
    if (trimmed.startsWith('DELETE')) return 'DELETE';
    if (trimmed.startsWith('WITH')) return 'WITH';
    return 'OTHER';
  }

  /**
   * Capture stack trace for debugging
   */
  private captureStackTrace(): string {
    const stack = new Error().stack ?? '';
    // Remove the first few frames (this method and analyzeQuery)
    const lines = stack.split('\n').slice(3);
    return lines.slice(0, 5).join('\n');
  }
}

// ============================================================================
// GLOBAL INSTANCE
// ============================================================================

let globalAnalyzer: QueryAnalyzer | null = null;

/**
 * Get or create the global query analyzer
 */
export function getQueryAnalyzer(config?: QueryAnalyzerConfig): QueryAnalyzer {
  if (!globalAnalyzer) {
    globalAnalyzer = new QueryAnalyzer(config);
  }
  return globalAnalyzer;
}

/**
 * Create a new query analyzer instance
 */
export function createQueryAnalyzer(config?: QueryAnalyzerConfig): QueryAnalyzer {
  return new QueryAnalyzer(config);
}

// ============================================================================
// INSTRUMENTED POOL
// ============================================================================

export interface InstrumentedPoolConfig extends QueryAnalyzerConfig {
  /** The underlying pg pool */
  pool: pg.Pool;
}

/**
 * Create an instrumented pool wrapper that automatically analyzes queries
 *
 * @example
 * const instrumentedPool = createInstrumentedPool({
 *   pool: originalPool,
 *   slowQueryThresholdMs: 50,
 * });
 *
 * // Use like a regular pool - queries are automatically analyzed
 * await instrumentedPool.query('SELECT * FROM users');
 */
export function createInstrumentedPool(config: InstrumentedPoolConfig): pg.Pool {
  const analyzer = new QueryAnalyzer(config);
  const { pool } = config;

  // Create a proxy to intercept query calls
  return new Proxy(pool, {
    get(target, prop) {
      if (prop === 'query') {
        return async function instrumentedQuery(
          queryTextOrConfig: string | pg.QueryConfig,
          values?: unknown[]
        ) {
          const queryText = typeof queryTextOrConfig === 'string'
            ? queryTextOrConfig
            : queryTextOrConfig.text;

          const queryValues = typeof queryTextOrConfig === 'string'
            ? values
            : queryTextOrConfig.values;

          const start = Date.now();
          try {
            const result = await target.query(queryTextOrConfig, values);
            const duration = Date.now() - start;

            // Analyze the query asynchronously (don't block the result)
            setImmediate(() => {
              analyzer.analyzeQuery(target, queryText, queryValues, duration).catch(() => {
                // Ignore analysis errors
              });
            });

            return result;
          } catch (error) {
            const duration = Date.now() - start;
            // Still log failed queries
            setImmediate(() => {
              analyzer.analyzeQuery(target, queryText, queryValues, duration).catch(() => {
                // Ignore analysis errors
              });
            });
            throw error;
          }
        };
      }

      const value = target[prop as keyof typeof target];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// ============================================================================
// QUERY LOG PERSISTENCE
// ============================================================================

export interface QueryLogEntry {
  /** Entry ID */
  id: string;
  /** Normalized query pattern */
  pattern: string;
  /** Operation type */
  operation: string;
  /** Average duration */
  avgDurationMs: number;
  /** Max duration */
  maxDurationMs: number;
  /** Execution count */
  count: number;
  /** Issues detected */
  issues: string[];
  /** Last seen */
  lastSeen: Date;
}

/**
 * Export query log entries for persistence or analysis
 */
export function exportQueryLog(analyzer: QueryAnalyzer): QueryLogEntry[] {
  const summary = analyzer.getSummary();
  const entries: QueryLogEntry[] = [];

  for (const [pattern, stats] of summary.patterns) {
    entries.push({
      id: `log_${entries.length + 1}`,
      pattern,
      operation: pattern.split(' ')[0] || 'UNKNOWN',
      avgDurationMs: Math.round(stats.avgDurationMs * 100) / 100,
      maxDurationMs: stats.maxDurationMs,
      count: stats.count,
      issues: Array.from(stats.issues.keys()),
      lastSeen: stats.lastSeen,
    });
  }

  return entries.sort((a, b) => b.count - a.count);
}

/**
 * Format query log as JSON for file export
 */
export function exportQueryLogAsJson(analyzer: QueryAnalyzer): string {
  const log = exportQueryLog(analyzer);
  const summary = analyzer.getSummary();

  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    summary: {
      totalQueries: summary.totalQueries,
      slowQueries: summary.slowQueries,
      sequentialScanQueries: summary.sequentialScanQueries,
      timeRange: {
        start: summary.timeRange.start.toISOString(),
        end: summary.timeRange.end.toISOString(),
      },
    },
    potentialN1Patterns: summary.potentialN1Patterns,
    patterns: log,
  }, null, 2);
}
