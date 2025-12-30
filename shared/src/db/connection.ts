/**
 * Database Connection Management
 *
 * Provides robust connection handling with:
 * - Health checks with automatic reconnection
 * - Exponential backoff retry logic
 * - Connection pool monitoring
 * - Graceful degradation
 */

import pg from 'pg';

import { TIMEOUTS, LIMITS, RETRY, INTERVALS, CONTEXT_RETRY } from '../config/constants.js';
import { sleep, calculateBackoffDelay } from '../utils/timing.js';

const { Pool } = pg;

export interface ConnectionConfig {
  connectionString: string;
  maxConnections?: number;
  minConnections?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
  statementTimeoutMs?: number;
  maxRetries?: number;
  baseRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface ConnectionStats {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  maxConnections: number;
  healthy: boolean;
  lastHealthCheck: Date | null;
  consecutiveFailures: number;
  uptime: number;
}

export interface DatabaseHealthCheckResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
  timestamp: Date;
}

type ConnectionEventType = 'connect' | 'disconnect' | 'error' | 'reconnect' | 'health_check';

interface ConnectionEventData {
  type: ConnectionEventType;
  timestamp: Date;
  details?: Record<string, unknown>;
  error?: string;
}

type ConnectionEventCallback = (event: ConnectionEventData) => void;

/**
 * Connection manager with health checks and auto-reconnection
 */
export class DatabaseConnection {
  private pool: pg.Pool | null = null;
  private config: Required<ConnectionConfig>;
  private stats: ConnectionStats;
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private reconnecting = false;
  private startTime: Date | null = null;
  private eventCallbacks: ConnectionEventCallback[] = [];

  constructor(config: ConnectionConfig) {
    this.config = {
      connectionString: config.connectionString,
      maxConnections: config.maxConnections ?? LIMITS.DATABASE.MAX_CONNECTIONS,
      minConnections: config.minConnections ?? LIMITS.DATABASE.MIN_CONNECTIONS,
      idleTimeoutMillis: config.idleTimeoutMillis ?? TIMEOUTS.DATABASE.IDLE,
      connectionTimeoutMillis: config.connectionTimeoutMillis ?? TIMEOUTS.DATABASE.CONNECTION,
      statementTimeoutMs: config.statementTimeoutMs ?? TIMEOUTS.DATABASE.STATEMENT,
      maxRetries: config.maxRetries ?? CONTEXT_RETRY.DB_CONNECTION.MAX_RETRIES,
      baseRetryDelayMs: config.baseRetryDelayMs ?? RETRY.DEFAULT.BASE_DELAY_MS,
      maxRetryDelayMs: config.maxRetryDelayMs ?? RETRY.DEFAULT.MAX_DELAY_MS,
    };

    this.stats = {
      totalCount: 0,
      idleCount: 0,
      waitingCount: 0,
      maxConnections: this.config.maxConnections,
      healthy: false,
      lastHealthCheck: null,
      consecutiveFailures: 0,
      uptime: 0,
    };
  }

  /**
   * Register an event callback for connection events
   */
  onEvent(callback: ConnectionEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  /**
   * Emit an event to all registered callbacks
   */
  private emitEvent(type: ConnectionEventType, details?: Record<string, unknown>, error?: string): void {
    const event: ConnectionEventData = {
      type,
      timestamp: new Date(),
      details,
      error,
    };

    for (const callback of this.eventCallbacks) {
      try {
        callback(event);
      } catch (e) {
        // Ignore callback errors
      }
    }
  }

  /**
   * Connect to the database with retry logic
   */
  async connect(): Promise<void> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.attemptConnection();
        this.startTime = new Date();
        this.stats.healthy = true;
        this.stats.consecutiveFailures = 0;
        this.emitEvent('connect', { attempt });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.stats.consecutiveFailures++;

        if (attempt < this.config.maxRetries) {
          const delay = calculateBackoffDelay(attempt, {
            baseDelayMs: this.config.baseRetryDelayMs,
            maxDelayMs: this.config.maxRetryDelayMs,
            jitterMode: 'positive',
          });
          this.emitEvent('error', { attempt, nextRetryMs: delay }, lastError.message);
          await sleep(delay);
        }
      }
    }

    throw new Error(
      `Failed to connect to database after ${this.config.maxRetries} attempts. ` +
      `Last error: ${lastError?.message}`
    );
  }

  /**
   * Attempt a single connection
   */
  private async attemptConnection(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
    }

    const sslConfig = this.config.connectionString.includes('sslmode=require')
      ? { rejectUnauthorized: false }
      : false;

    this.pool = new Pool({
      connectionString: this.config.connectionString,
      max: this.config.maxConnections,
      min: this.config.minConnections,
      idleTimeoutMillis: this.config.idleTimeoutMillis,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis,
      ssl: sslConfig,
      application_name: 'internal-api-server',
      statement_timeout: this.config.statementTimeoutMs,
      query_timeout: this.config.statementTimeoutMs,
    });

    // Set up pool event handlers
    this.pool.on('connect', () => {
      this.updateStats();
    });

    this.pool.on('remove', () => {
      this.updateStats();
    });

    this.pool.on('error', (err) => {
      this.handlePoolError(err);
    });

    // Test the connection
    const client = await this.pool.connect();
    await client.query('SELECT 1');
    client.release();
  }

  /**
   * Handle pool errors
   */
  private handlePoolError(err: Error): void {
    this.stats.consecutiveFailures++;
    this.emitEvent('error', { source: 'pool' }, err.message);

    if (!this.reconnecting && this.stats.consecutiveFailures >= 3) {
      this.attemptReconnect();
    }
  }

  /**
   * Attempt to reconnect after failures
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnecting) return;

    this.reconnecting = true;
    this.stats.healthy = false;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        await this.attemptConnection();
        this.stats.healthy = true;
        this.stats.consecutiveFailures = 0;
        this.reconnecting = false;
        this.emitEvent('reconnect', { attempt });
        return;
      } catch (error) {
        const delay = calculateBackoffDelay(attempt, {
          baseDelayMs: this.config.baseRetryDelayMs,
          maxDelayMs: this.config.maxRetryDelayMs,
          jitterMode: 'positive',
        });
        await sleep(delay);
      }
    }

    this.reconnecting = false;
    this.emitEvent('disconnect', { reason: 'max_retries_exceeded' });
  }

  /**
   * Update connection statistics
   */
  private updateStats(): void {
    if (!this.pool) return;

    this.stats.totalCount = this.pool.totalCount;
    this.stats.idleCount = this.pool.idleCount;
    this.stats.waitingCount = this.pool.waitingCount;

    if (this.startTime) {
      this.stats.uptime = Date.now() - this.startTime.getTime();
    }
  }

  /**
   * Perform a health check
   */
  async healthCheck(): Promise<DatabaseHealthCheckResult> {
    const start = Date.now();

    try {
      if (!this.pool) {
        throw new Error('Database pool not initialized');
      }

      const client = await this.pool.connect();
      try {
        await client.query('SELECT 1');
        const latencyMs = Date.now() - start;

        this.stats.healthy = true;
        this.stats.lastHealthCheck = new Date();
        this.stats.consecutiveFailures = 0;
        this.updateStats();

        this.emitEvent('health_check', { healthy: true, latencyMs });

        return {
          healthy: true,
          latencyMs,
          timestamp: new Date(),
        };
      } finally {
        client.release();
      }
    } catch (error) {
      const latencyMs = Date.now() - start;
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.stats.healthy = false;
      this.stats.lastHealthCheck = new Date();
      this.stats.consecutiveFailures++;

      this.emitEvent('health_check', { healthy: false, latencyMs }, errorMessage);

      // Trigger reconnection if needed
      if (this.stats.consecutiveFailures >= 3) {
        this.attemptReconnect();
      }

      return {
        healthy: false,
        latencyMs,
        error: errorMessage,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Start periodic health checks
   */
  startHealthChecks(intervalMs: number = INTERVALS.HEALTH.DATABASE): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(() => {
      this.healthCheck();
    }, intervalMs);
  }

  /**
   * Stop periodic health checks
   */
  stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): ConnectionStats {
    this.updateStats();
    return { ...this.stats };
  }

  /**
   * Get the underlying pool (for Drizzle)
   */
  getPool(): pg.Pool {
    if (!this.pool) {
      throw new Error('Database pool not initialized. Call connect() first.');
    }
    return this.pool;
  }

  /**
   * Check if connection is healthy
   */
  isHealthy(): boolean {
    return this.stats.healthy && !this.reconnecting;
  }

  /**
   * Close the connection
   */
  async close(): Promise<void> {
    this.stopHealthChecks();

    if (this.pool) {
      await this.pool.end();
      this.pool = null;
    }

    this.stats.healthy = false;
    this.emitEvent('disconnect', { reason: 'manual_close' });
  }
}

/**
 * Create a connection with sensible defaults
 */
export function createConnection(connectionString: string, options?: Partial<ConnectionConfig>): DatabaseConnection {
  return new DatabaseConnection({
    connectionString,
    ...options,
  });
}

/**
 * Execute a query with automatic retry on connection errors
 */
export async function withRetry<T>(
  connection: DatabaseConnection,
  operation: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500 } = options;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Only retry on connection errors
      const isConnectionError =
        lastError.message.includes('connection') ||
        lastError.message.includes('ECONNREFUSED') ||
        lastError.message.includes('timeout');

      if (!isConnectionError || attempt >= maxRetries) {
        throw lastError;
      }

      // Wait with exponential backoff
      const delay = calculateBackoffDelay(attempt, {
        baseDelayMs,
        useJitter: false,
      });
      await sleep(delay);
    }
  }

  throw lastError;
}
