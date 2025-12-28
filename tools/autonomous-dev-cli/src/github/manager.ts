/**
 * GitHub API Manager
 *
 * Centralized manager for coordinating all GitHub API operations with:
 * - Exponential backoff with jitter for all API calls
 * - Rate limit header parsing and adaptive throttling
 * - Request queuing to prevent burst limit violations
 * - Automatic retry logic for transient failures
 * - Graceful degradation during rate limit periods
 * - Unified health monitoring and status reporting
 */

import { GitHubClient, createGitHubClient, type GitHubClientOptions, type ServiceHealth, type RateLimitState } from './client.js';
import { createPRManager, type PRManager } from './pulls.js';
import { createIssueManager, type IssueManager } from './issues.js';
import { createBranchManager, type BranchManager } from './branches.js';
import { createChecksManager, type ChecksManager } from './checks.js';
import { createCodeReviewerManager, type CodeReviewerManager } from './codeReviewer.js';
import { logger } from '../utils/logger.js';
import {
  GitHubRateLimiter,
  type RateLimitStatus,
  type RateLimiterConfig,
} from '../utils/rateLimiter.js';
import {
  retryWithBackoff,
  RATE_LIMIT_RETRY_CONFIG,
  extractRetryAfterMs,
  type RetryContext,
} from '../utils/retry.js';
import { GitHubError, ErrorCode } from '../utils/errors.js';

/**
 * Configuration for the GitHub API Manager
 */
export interface GitHubManagerConfig extends GitHubClientOptions {
  /** Configuration for rate limiting behavior */
  rateLimiter?: Partial<RateLimiterConfig>;
  /** Whether to enable request queuing (default: true) */
  enableQueuing?: boolean;
  /** Maximum concurrent requests (default: 10) */
  maxConcurrentRequests?: number;
  /** Enable adaptive throttling based on rate limit state (default: true) */
  adaptiveThrottling?: boolean;
  /** Threshold (percentage of limit remaining) to start throttling (default: 0.2 = 20%) */
  throttleThresholdPercent?: number;
}

/**
 * Operation priority levels for queue ordering
 */
export enum OperationPriority {
  /** Critical operations that should be processed first */
  CRITICAL = 100,
  /** High priority operations (e.g., merges, PR creation) */
  HIGH = 75,
  /** Normal priority operations (default) */
  NORMAL = 50,
  /** Low priority operations (e.g., listing, fetching) */
  LOW = 25,
  /** Background operations that can wait */
  BACKGROUND = 0,
}

/**
 * Request statistics for monitoring
 */
export interface RequestStats {
  /** Total requests made */
  totalRequests: number;
  /** Successful requests */
  successfulRequests: number;
  /** Failed requests */
  failedRequests: number;
  /** Requests that were rate limited */
  rateLimitedRequests: number;
  /** Requests that were retried */
  retriedRequests: number;
  /** Requests currently in queue */
  queuedRequests: number;
  /** Average response time in ms */
  averageResponseTimeMs: number;
  /** Last request timestamp */
  lastRequestAt: Date | null;
}

/**
 * Manager health status
 */
export interface ManagerHealth {
  /** Overall health status */
  status: 'healthy' | 'degraded' | 'unavailable';
  /** Client health */
  clientHealth: ServiceHealth;
  /** Rate limit status */
  rateLimitStatus: RateLimitStatus;
  /** Request statistics */
  requestStats: RequestStats;
  /** Number of operations in queue */
  queueSize: number;
  /** Whether rate limiting is active */
  isThrottling: boolean;
  /** Time until rate limit resets (ms) */
  rateLimitResetInMs: number;
}

/**
 * Queued operation
 */
interface QueuedOperation<T> {
  id: string;
  operation: () => Promise<T>;
  priority: OperationPriority;
  resource: string;
  description: string;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  queuedAt: number;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * GitHub API Manager
 *
 * Provides unified access to all GitHub API operations with:
 * - Centralized rate limiting and request queuing
 * - Automatic retry with exponential backoff
 * - Graceful degradation during outages
 * - Comprehensive health monitoring
 */
export class GitHubManager {
  public readonly client: GitHubClient;
  public readonly pulls: PRManager;
  public readonly issues: IssueManager;
  public readonly branches: BranchManager;
  public readonly checks: ChecksManager;
  public readonly codeReviewer: CodeReviewerManager;

  private readonly config: GitHubManagerConfig;
  private readonly rateLimiter: GitHubRateLimiter;
  private readonly log = logger.child('GitHubManager');

  private operationQueue: QueuedOperation<unknown>[] = [];
  private isProcessingQueue = false;
  private queueProcessorInterval: ReturnType<typeof setInterval> | null = null;
  private operationCounter = 0;
  private activeRequests = 0;

  // Request statistics
  private stats: RequestStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    rateLimitedRequests: 0,
    retriedRequests: 0,
    queuedRequests: 0,
    averageResponseTimeMs: 0,
    lastRequestAt: null,
  };
  private totalResponseTimeMs = 0;

  constructor(config: GitHubManagerConfig) {
    this.config = {
      enableQueuing: true,
      maxConcurrentRequests: 10,
      adaptiveThrottling: true,
      throttleThresholdPercent: 0.2,
      ...config,
    };

    // Create the underlying client
    this.client = createGitHubClient(config);

    // Get the rate limiter from client or create new one
    this.rateLimiter = this.client.getRateLimiter();

    // Create all sub-managers
    this.pulls = createPRManager(this.client);
    this.issues = createIssueManager(this.client);
    this.branches = createBranchManager(this.client);
    this.checks = createChecksManager(this.client);
    this.codeReviewer = createCodeReviewerManager(this.client);

    this.log.debug('GitHubManager initialized', {
      owner: config.owner,
      repo: config.repo,
      enableQueuing: this.config.enableQueuing,
      maxConcurrentRequests: this.config.maxConcurrentRequests,
      adaptiveThrottling: this.config.adaptiveThrottling,
    });
  }

  /**
   * Get comprehensive health status
   */
  getHealth(): ManagerHealth {
    const clientHealth = this.client.getServiceHealth();
    const rateLimitStatus = this.rateLimiter.getStatus();
    const queueStats = this.rateLimiter.getQueueStats();

    // Calculate time until rate limit reset
    const now = Date.now();
    let rateLimitResetInMs = 0;
    if (rateLimitStatus.core.isLimited) {
      rateLimitResetInMs = Math.max(0, rateLimitStatus.core.resetAt * 1000 - now);
    }

    // Determine overall status
    let status: ManagerHealth['status'] = 'healthy';
    if (clientHealth.status === 'unavailable' || rateLimitStatus.isAnyLimited) {
      status = 'unavailable';
    } else if (
      clientHealth.status === 'degraded' ||
      this.isThrottling() ||
      this.operationQueue.length > 0
    ) {
      status = 'degraded';
    }

    return {
      status,
      clientHealth,
      rateLimitStatus,
      requestStats: { ...this.stats, queuedRequests: this.operationQueue.length },
      queueSize: this.operationQueue.length + queueStats.size,
      isThrottling: this.isThrottling(),
      rateLimitResetInMs,
    };
  }

  /**
   * Check if rate limiting is currently active
   */
  isThrottling(): boolean {
    const status = this.rateLimiter.getStatus();

    if (status.isAnyLimited) {
      return true;
    }

    if (this.config.adaptiveThrottling) {
      const threshold = this.config.throttleThresholdPercent ?? 0.2;
      const remainingPercent = status.core.remaining / status.core.limit;
      return remainingPercent <= threshold;
    }

    return false;
  }

  /**
   * Check if the service is available
   */
  isAvailable(): boolean {
    return this.client.isAvailable() && !this.rateLimiter.getStatus().isAnyLimited;
  }

  /**
   * Get current rate limit state
   */
  getRateLimitState(): RateLimitState {
    return this.client.getRateLimitState();
  }

  /**
   * Get rate limit status
   */
  getRateLimitStatus(): RateLimitStatus {
    return this.rateLimiter.getStatus();
  }

  /**
   * Get request statistics
   */
  getStats(): RequestStats {
    return {
      ...this.stats,
      queuedRequests: this.operationQueue.length,
    };
  }

  /**
   * Execute an operation with full rate limiting, retry, and queuing support
   */
  async execute<T>(
    operation: () => Promise<T>,
    options: {
      description?: string;
      priority?: OperationPriority;
      resource?: string;
      skipQueue?: boolean;
      maxRetries?: number;
    } = {}
  ): Promise<T> {
    const {
      description = 'GitHub API operation',
      priority = OperationPriority.NORMAL,
      resource = 'core',
      skipQueue = false,
      maxRetries = RATE_LIMIT_RETRY_CONFIG.maxRetries,
    } = options;

    const startTime = Date.now();
    this.stats.totalRequests++;
    this.stats.lastRequestAt = new Date();

    // Check if we should queue this request
    if (
      this.config.enableQueuing &&
      !skipQueue &&
      (this.isThrottling() || this.activeRequests >= (this.config.maxConcurrentRequests ?? 10))
    ) {
      return this.enqueueOperation(operation, description, priority, resource);
    }

    // Execute with retry
    try {
      this.activeRequests++;

      const result = await retryWithBackoff(
        async (context: RetryContext) => {
          if (context.attempt > 0) {
            this.stats.retriedRequests++;
          }
          return operation();
        },
        {
          config: {
            ...RATE_LIMIT_RETRY_CONFIG,
            maxRetries,
          },
          operationName: description,
          getRetryAfterMs: extractRetryAfterMs,
          onRetry: (error, attempt, delay, context) => {
            this.log.warn(`Retrying ${description}`, {
              attempt,
              delay,
              error: error.message,
              totalElapsedMs: context.elapsedMs,
            });
          },
          onExhausted: (error, context) => {
            this.log.error(`Exhausted retries for ${description}`, {
              totalAttempts: context.attempt + 1,
              totalElapsedMs: context.elapsedMs,
              finalError: error.message,
            });
          },
        }
      );

      this.stats.successfulRequests++;
      this.recordResponseTime(Date.now() - startTime);

      return result;
    } catch (error) {
      this.stats.failedRequests++;

      // Check if rate limited
      const statusCode = (error as any).status ?? (error as any).response?.status;
      if (statusCode === 429) {
        this.stats.rateLimitedRequests++;
      }

      throw error;
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Execute an operation with fallback for graceful degradation
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T,
    options: {
      description?: string;
      priority?: OperationPriority;
      resource?: string;
    } = {}
  ): Promise<{ value: T; degraded: boolean }> {
    try {
      const value = await this.execute(operation, options);
      return { value, degraded: false };
    } catch (error) {
      this.log.warn(`Operation degraded, using fallback: ${options.description ?? 'unknown'}`, {
        error: (error as Error).message,
      });
      return { value: fallback, degraded: true };
    }
  }

  /**
   * Enqueue an operation for later execution
   */
  private enqueueOperation<T>(
    operation: () => Promise<T>,
    description: string,
    priority: OperationPriority,
    resource: string
  ): Promise<T> {
    const maxQueueSize = 100;
    if (this.operationQueue.length >= maxQueueSize) {
      this.log.warn('Operation queue full, rejecting request', {
        queueSize: this.operationQueue.length,
        maxQueueSize,
        description,
      });
      throw new GitHubError(
        ErrorCode.GITHUB_RATE_LIMITED,
        `Operation queue full (${this.operationQueue.length}/${maxQueueSize}). ${description}`,
        {
          statusCode: 429,
          context: {
            queueSize: this.operationQueue.length,
            description,
            resource,
          },
        }
      );
    }

    const operationId = `op-${++this.operationCounter}`;

    this.log.debug('Queuing operation', {
      operationId,
      description,
      priority,
      resource,
      queueSize: this.operationQueue.length + 1,
    });

    return new Promise<T>((resolve, reject) => {
      const queuedOp: QueuedOperation<T> = {
        id: operationId,
        operation,
        priority,
        resource,
        description,
        resolve,
        reject,
        queuedAt: Date.now(),
      };

      // Set timeout (5 minutes max wait)
      const maxWaitMs = 300000;
      queuedOp.timeout = setTimeout(() => {
        const index = this.operationQueue.findIndex(op => op.id === operationId);
        if (index !== -1) {
          this.operationQueue.splice(index, 1);
          const waitTime = Date.now() - queuedOp.queuedAt;
          this.log.warn('Operation timed out in queue', {
            operationId,
            description,
            waitTimeMs: waitTime,
          });
          reject(new GitHubError(
            ErrorCode.GITHUB_RATE_LIMITED,
            `Operation timed out waiting in queue (waited ${Math.round(waitTime / 1000)}s): ${description}`,
            {
              statusCode: 429,
              context: { operationId, description, waitTimeMs: waitTime },
            }
          ));
        }
      }, maxWaitMs);

      this.operationQueue.push(queuedOp as QueuedOperation<unknown>);
      this.startQueueProcessor();
    });
  }

  /**
   * Start the queue processor
   */
  private startQueueProcessor(): void {
    if (this.queueProcessorInterval) return;

    this.log.debug('Starting operation queue processor');
    this.queueProcessorInterval = setInterval(() => {
      this.processQueue();
    }, 1000);

    // Also process immediately
    this.processQueue();
  }

  /**
   * Stop the queue processor
   */
  private stopQueueProcessor(): void {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
      this.queueProcessorInterval = null;
      this.log.debug('Stopped operation queue processor');
    }
  }

  /**
   * Process queued operations
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.operationQueue.length === 0) {
      if (this.operationQueue.length === 0) {
        this.stopQueueProcessor();
      }
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Check if we can make requests
      if (this.isThrottling()) {
        const status = this.rateLimiter.getStatus();
        this.log.debug('Queue processor waiting for rate limit', {
          requiredDelayMs: status.requiredDelayMs,
          queueSize: this.operationQueue.length,
        });
        this.isProcessingQueue = false;
        return;
      }

      // Check concurrent request limit
      if (this.activeRequests >= (this.config.maxConcurrentRequests ?? 10)) {
        this.log.debug('Queue processor waiting for concurrent requests', {
          activeRequests: this.activeRequests,
          maxConcurrent: this.config.maxConcurrentRequests,
          queueSize: this.operationQueue.length,
        });
        this.isProcessingQueue = false;
        return;
      }

      // Sort by priority (highest first)
      this.operationQueue.sort((a, b) => b.priority - a.priority);

      // Process one operation
      const operation = this.operationQueue.shift();
      if (!operation) {
        this.isProcessingQueue = false;
        return;
      }

      // Clear timeout
      if (operation.timeout) {
        clearTimeout(operation.timeout);
      }

      this.log.debug('Processing queued operation', {
        operationId: operation.id,
        description: operation.description,
        priority: operation.priority,
        queuedFor: Date.now() - operation.queuedAt,
        remainingInQueue: this.operationQueue.length,
      });

      // Execute the operation
      try {
        const result = await this.execute(
          operation.operation,
          {
            description: operation.description,
            priority: operation.priority,
            resource: operation.resource,
            skipQueue: true, // Already dequeued, don't re-queue
          }
        );
        operation.resolve(result);
      } catch (error) {
        operation.reject(error);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Record response time for statistics
   */
  private recordResponseTime(responseTimeMs: number): void {
    this.totalResponseTimeMs += responseTimeMs;
    this.stats.averageResponseTimeMs = Math.round(
      this.totalResponseTimeMs / this.stats.successfulRequests
    );
  }

  /**
   * Clear the operation queue
   */
  clearQueue(): void {
    const queueSize = this.operationQueue.length;

    for (const operation of this.operationQueue) {
      if (operation.timeout) {
        clearTimeout(operation.timeout);
      }
      operation.reject(new GitHubError(
        ErrorCode.GITHUB_SERVICE_DEGRADED,
        'Operation queue cleared',
        { statusCode: 503, context: { operationId: operation.id } }
      ));
    }

    this.operationQueue = [];
    this.stopQueueProcessor();

    // Also clear client queue
    this.client.clearQueue();

    if (queueSize > 0) {
      this.log.info(`Cleared ${queueSize} operations from queue`);
    }
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      rateLimitedRequests: 0,
      retriedRequests: 0,
      queuedRequests: 0,
      averageResponseTimeMs: 0,
      lastRequestAt: null,
    };
    this.totalResponseTimeMs = 0;
  }

  /**
   * Wait for rate limit to reset
   */
  async waitForRateLimitReset(): Promise<void> {
    await this.client.waitForRateLimitReset();
  }

  /**
   * Verify authentication
   */
  async verifyAuth(): Promise<{ login: string; name: string }> {
    return this.client.verifyAuth();
  }

  /**
   * Get repository information
   */
  async getRepo(): Promise<{
    defaultBranch: string;
    fullName: string;
    private: boolean;
  }> {
    return this.client.getRepo();
  }

  /**
   * Get rate limit from API
   */
  async getRateLimit(): Promise<{
    limit: number;
    remaining: number;
    resetAt: Date;
  }> {
    return this.client.getRateLimit();
  }

  /**
   * Invalidate cache
   */
  invalidateCache(): number {
    return this.client.invalidateCache();
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.client.getCacheStats();
  }

  /**
   * Shutdown the manager, clearing queues and stopping processors
   */
  shutdown(): void {
    this.log.info('Shutting down GitHubManager');
    this.clearQueue();
    this.stopQueueProcessor();
  }
}

/**
 * Create a GitHubManager instance
 */
export function createGitHubManager(config: GitHubManagerConfig): GitHubManager {
  return new GitHubManager(config);
}
