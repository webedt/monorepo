/**
 * Database Query Logger for Development Mode
 *
 * Helps detect N+1 query patterns by tracking and analyzing
 * query patterns within a request lifecycle.
 *
 * Features:
 * - Query count tracking per request
 * - Similar query detection (potential N+1)
 * - Query timing and performance metrics
 * - Configurable thresholds and verbosity
 */

import { NODE_ENV, DEBUG_SQL } from '../config/env.js';

export interface QueryLogEntry {
  query: string;
  params?: unknown[];
  duration: number;
  timestamp: Date;
  stackTrace?: string;
}

export interface QueryAnalysis {
  totalQueries: number;
  totalDuration: number;
  similarQueries: Map<string, number>;
  potentialN1: string[];
  slowQueries: QueryLogEntry[];
}

export interface QueryLoggerOptions {
  /** Enable logging (default: true in development) */
  enabled?: boolean;
  /** Log each query to console (default: false) */
  verbose?: boolean;
  /** Threshold for slow query detection in ms (default: 100) */
  slowQueryThresholdMs?: number;
  /** Threshold for potential N+1 detection (default: 3) */
  n1ThresholdCount?: number;
  /** Include stack traces (default: true in development) */
  includeStackTraces?: boolean;
  /** Maximum entries to keep (default: 1000) */
  maxEntries?: number;
}

/**
 * Query logger for tracking database queries within a request
 *
 * @example
 * const logger = new QueryLogger();
 *
 * // Wrap your queries
 * logger.logQuery('SELECT * FROM users WHERE id = $1', [userId], 5);
 *
 * // At the end of request, analyze
 * const analysis = logger.analyze();
 * if (analysis.potentialN1.length > 0) {
 *   console.warn('Potential N+1 queries detected:', analysis.potentialN1);
 * }
 */
export class QueryLogger {
  private entries: QueryLogEntry[] = [];
  private options: Required<QueryLoggerOptions>;

  constructor(options: QueryLoggerOptions = {}) {
    const isDev = NODE_ENV === 'development';

    this.options = {
      enabled: options.enabled ?? (isDev && DEBUG_SQL),
      verbose: options.verbose ?? false,
      slowQueryThresholdMs: options.slowQueryThresholdMs ?? 100,
      n1ThresholdCount: options.n1ThresholdCount ?? 3,
      includeStackTraces: options.includeStackTraces ?? isDev,
      maxEntries: options.maxEntries ?? 1000,
    };
  }

  /**
   * Log a query execution
   */
  logQuery(query: string, params?: unknown[], durationMs?: number): void {
    if (!this.options.enabled) {
      return;
    }

    const entry: QueryLogEntry = {
      query: this.normalizeQuery(query),
      params,
      duration: durationMs ?? 0,
      timestamp: new Date(),
    };

    if (this.options.includeStackTraces) {
      entry.stackTrace = this.captureStackTrace();
    }

    this.entries.push(entry);

    // Prevent unbounded growth
    if (this.entries.length > this.options.maxEntries) {
      this.entries.shift();
    }

    if (this.options.verbose) {
      console.log(`[DB] ${durationMs}ms: ${query}`);
    }
  }

  /**
   * Wrap an async query function with logging
   */
  async wrapQuery<T>(
    queryFn: () => Promise<T>,
    queryDescription?: string
  ): Promise<T> {
    if (!this.options.enabled) {
      return queryFn();
    }

    const start = Date.now();
    try {
      const result = await queryFn();
      this.logQuery(queryDescription ?? 'unknown', undefined, Date.now() - start);
      return result;
    } catch (error) {
      this.logQuery(
        `ERROR: ${queryDescription ?? 'unknown'}`,
        undefined,
        Date.now() - start
      );
      throw error;
    }
  }

  /**
   * Analyze logged queries for patterns
   */
  analyze(): QueryAnalysis {
    const similarQueries = new Map<string, number>();
    const slowQueries: QueryLogEntry[] = [];
    let totalDuration = 0;

    for (const entry of this.entries) {
      totalDuration += entry.duration;

      // Track similar queries (already normalized when stored)
      similarQueries.set(entry.query, (similarQueries.get(entry.query) ?? 0) + 1);

      // Track slow queries
      if (entry.duration >= this.options.slowQueryThresholdMs) {
        slowQueries.push(entry);
      }
    }

    // Detect potential N+1 patterns
    const potentialN1: string[] = [];
    // Use Array.from for ES5 compatibility
    const entries = Array.from(similarQueries.entries());
    for (const [query, count] of entries) {
      if (count >= this.options.n1ThresholdCount) {
        potentialN1.push(`${query} (executed ${count} times)`);
      }
    }

    return {
      totalQueries: this.entries.length,
      totalDuration,
      similarQueries,
      potentialN1,
      slowQueries,
    };
  }

  /**
   * Get query count
   */
  getQueryCount(): number {
    return this.entries.length;
  }

  /**
   * Get all logged entries
   */
  getEntries(): QueryLogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all logged entries
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Print analysis summary to console
   */
  printSummary(): void {
    const analysis = this.analyze();

    console.log('\n=== Database Query Analysis ===');
    console.log(`Total Queries: ${analysis.totalQueries}`);
    console.log(`Total Duration: ${analysis.totalDuration}ms`);

    if (analysis.potentialN1.length > 0) {
      console.log('\n⚠️  Potential N+1 Queries:');
      for (const query of analysis.potentialN1) {
        console.log(`  - ${query}`);
      }
    }

    if (analysis.slowQueries.length > 0) {
      console.log(`\n🐢 Slow Queries (>${this.options.slowQueryThresholdMs}ms):`);
      for (const entry of analysis.slowQueries) {
        console.log(`  - ${entry.duration}ms: ${entry.query}`);
      }
    }

    console.log('===============================\n');
  }

  /**
   * Normalize a query for pattern matching
   * Replaces specific values with placeholders
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
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * Capture stack trace for debugging
   */
  private captureStackTrace(): string {
    const stack = new Error().stack ?? '';
    // Remove the first few frames (this method and logQuery)
    const lines = stack.split('\n').slice(3);
    return lines.slice(0, 5).join('\n');
  }
}

/**
 * Global query logger instance for development
 * Disabled in production
 */
let globalLogger: QueryLogger | null = null;

/**
 * Get or create the global query logger
 */
export function getQueryLogger(): QueryLogger {
  if (!globalLogger) {
    globalLogger = new QueryLogger();
  }
  return globalLogger;
}

/**
 * Create a request-scoped query logger
 * Use this for per-request tracking
 */
export function createRequestLogger(options?: QueryLoggerOptions): QueryLogger {
  return new QueryLogger(options);
}

/**
 * Middleware helper to attach query logger to request context
 * For use with Express or similar frameworks
 */
export function createQueryLoggerMiddleware(
  options?: QueryLoggerOptions
): (req: unknown, res: unknown, next: () => void) => void {
  return (req: unknown, res: unknown, next: () => void) => {
    const reqWithLogger = req as { queryLogger?: QueryLogger };
    reqWithLogger.queryLogger = new QueryLogger(options);

    // Print summary after response if N+1 detected
    const resWithEvents = res as { on?: (event: string, fn: () => void) => void };
    if (resWithEvents.on) {
      resWithEvents.on('finish', () => {
        const logger = reqWithLogger.queryLogger;
        if (logger) {
          const analysis = logger.analyze();
          if (analysis.potentialN1.length > 0) {
            logger.printSummary();
          }
        }
      });
    }

    next();
  };
}
