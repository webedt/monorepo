import { Octokit } from '@octokit/rest';
import {
  logger,
  getCorrelationId,
  timeOperation,
  getMemoryUsageMB,
  recordPhaseOperation,
  recordPhaseError,
  isApiLoggingEnabled,
  DEFAULT_TIMING_THRESHOLD_MS,
} from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import {
  GitHubError,
  ErrorCode,
  createGitHubErrorFromResponse,
  withRetry,
  type RetryConfig,
  type ErrorContext,
  StructuredError,
} from '../utils/errors.js';
import {
  retryWithBackoff,
  RATE_LIMIT_RETRY_CONFIG,
  extractRetryAfterMs,
  type RetryContext,
} from '../utils/retry.js';
import {
  withTimeout,
  DEFAULT_TIMEOUTS,
  getTimeoutFromEnv,
  TimeoutError,
} from '../utils/timeout.js';

export interface GitHubClientOptions {
  token: string;
  owner: string;
  repo: string;
  retryConfig?: Partial<RetryConfig>;
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  /** Timeout for individual API calls in milliseconds (default: 30000) */
  requestTimeoutMs?: number;
  /** Configuration for rate limit handling */
  rateLimitConfig?: Partial<RateLimitConfig>;
}

/**
 * Configuration options for rate limit handling
 */
export interface RateLimitConfig {
  /** Threshold (remaining requests) at which to start queuing requests (default: 100) */
  queueThreshold: number;
  /** Maximum number of requests to queue before rejecting (default: 50) */
  maxQueueSize: number;
  /** Maximum time to wait in queue in milliseconds (default: 120000 = 2 minutes) */
  maxQueueWaitMs: number;
  /** Whether to preemptively wait when approaching rate limit (default: true) */
  preemptiveWait: boolean;
  /** Log rate limit status at debug level on every request (default: true) */
  logRateLimitStatus: boolean;
}

/**
 * Queued request waiting for rate limit to reset
 */
interface QueuedRequest<T> {
  operation: () => Promise<T>;
  endpoint: string;
  context?: ErrorContext;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
  queuedAt: number;
}

/**
 * Circuit breaker configuration for graceful degradation
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;      // Number of failures before opening circuit
  successThreshold: number;      // Number of successes to close circuit
  resetTimeoutMs: number;        // Time to wait before attempting half-open
  halfOpenMaxAttempts: number;   // Max attempts in half-open state
}

/**
 * Circuit breaker state
 */
export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Rate limit state tracking
 */
export interface RateLimitState {
  /** Remaining requests in current window */
  remaining: number;
  /** Total limit for current window */
  limit: number;
  /** When the rate limit resets (Unix timestamp in seconds) */
  resetAt: number;
  /** Resource type (core, search, graphql, etc.) */
  resource: string;
  /** Whether currently rate limited */
  isLimited: boolean;
  /** Delay until rate limit resets in ms */
  retryAfterMs?: number;
}

/**
 * Service health status for monitoring
 */
export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unavailable';
  circuitState: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  lastError?: string;
  rateLimitRemaining?: number;
  rateLimitResetAt?: Date;
  rateLimitState?: RateLimitState;
  /** Number of requests currently queued due to rate limiting */
  queuedRequests?: number;
}

const DEFAULT_GITHUB_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60000,
  backoffMultiplier: 2,
};

const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
};

const DEFAULT_RATE_LIMIT_CONFIG: RateLimitConfig = {
  queueThreshold: 100,
  maxQueueSize: 50,
  maxQueueWaitMs: 120000,
  preemptiveWait: true,
  logRateLimitStatus: true,
};

export class GitHubClient {
  private octokit: Octokit;
  public readonly owner: string;
  public readonly repo: string;
  private retryConfig: Partial<RetryConfig>;
  private circuitBreakerConfig: CircuitBreakerConfig;
  private rateLimitConfig: RateLimitConfig;
  private requestTimeoutMs: number;

  // Circuit breaker state
  private circuitState: CircuitState = 'closed';
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private lastFailureTime: Date | undefined;
  private lastSuccessTime: Date | undefined;
  private lastErrorMessage: string | undefined;
  private halfOpenAttempts: number = 0;

  // Rate limit tracking (enhanced)
  private rateLimitRemaining: number | undefined;
  private rateLimitResetAt: Date | undefined;
  private rateLimitState: RateLimitState = {
    remaining: 5000,
    limit: 5000,
    resetAt: 0,
    resource: 'core',
    isLimited: false,
  };

  // Request queue for rate limiting
  private requestQueue: QueuedRequest<any>[] = [];
  private isProcessingQueue: boolean = false;
  private queueProcessorInterval: ReturnType<typeof setInterval> | null = null;

  private log = logger.child('GitHubClient');

  constructor(options: GitHubClientOptions) {
    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.owner;
    this.repo = options.repo;
    this.retryConfig = { ...DEFAULT_GITHUB_RETRY_CONFIG, ...options.retryConfig };
    this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...options.circuitBreakerConfig };
    this.rateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...options.rateLimitConfig };
    // Configure request timeout from options or environment variable or default
    this.requestTimeoutMs = options.requestTimeoutMs
      ?? getTimeoutFromEnv('GITHUB_API', DEFAULT_TIMEOUTS.GITHUB_API);

    // Add hook to capture rate limit headers from all responses
    this.octokit.hook.after('request', (response) => {
      if (response.headers) {
        this.updateRateLimitFromHeaders(response.headers as Record<string, any>);
      }
    });

    this.log.debug('GitHubClient initialized', {
      owner: this.owner,
      repo: this.repo,
      retryConfig: this.retryConfig,
      rateLimitConfig: this.rateLimitConfig,
    });
  }

  get client(): Octokit {
    return this.octokit;
  }

  /**
   * Get the current service health status
   */
  getServiceHealth(): ServiceHealth {
    let status: ServiceHealth['status'] = 'healthy';

    if (this.circuitState === 'open') {
      status = 'unavailable';
    } else if (this.circuitState === 'half-open' || this.consecutiveFailures > 0) {
      status = 'degraded';
    } else if (this.rateLimitState.isLimited) {
      status = 'degraded';
    } else if (this.requestQueue.length > 0) {
      status = 'degraded';
    }

    return {
      status,
      circuitState: this.circuitState,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailure: this.lastFailureTime,
      lastSuccess: this.lastSuccessTime,
      lastError: this.lastErrorMessage,
      rateLimitRemaining: this.rateLimitRemaining,
      rateLimitResetAt: this.rateLimitResetAt,
      rateLimitState: { ...this.rateLimitState },
      queuedRequests: this.requestQueue.length,
    };
  }

  /**
   * Get the current rate limit state
   */
  getRateLimitState(): RateLimitState {
    return { ...this.rateLimitState };
  }

  /**
   * Get the current queue status
   */
  getQueueStatus(): { size: number; isProcessing: boolean; config: RateLimitConfig } {
    return {
      size: this.requestQueue.length,
      isProcessing: this.isProcessingQueue,
      config: { ...this.rateLimitConfig },
    };
  }

  /**
   * Clear the request queue (e.g., on shutdown)
   */
  clearQueue(): void {
    const queueSize = this.requestQueue.length;
    for (const request of this.requestQueue) {
      request.reject(
        new GitHubError(
          ErrorCode.GITHUB_SERVICE_DEGRADED,
          'Request queue cleared',
          {
            statusCode: 503,
            endpoint: request.endpoint,
            context: request.context,
          }
        )
      );
    }
    this.requestQueue = [];
    this.stopQueueProcessor();
    if (queueSize > 0) {
      this.log.info(`Cleared ${queueSize} requests from queue`);
    }
  }

  /**
   * Check if the circuit breaker allows requests
   */
  private canMakeRequest(): boolean {
    if (this.circuitState === 'closed') {
      return true;
    }

    if (this.circuitState === 'open') {
      // Check if enough time has passed to try half-open
      const timeSinceFailure = this.lastFailureTime
        ? Date.now() - this.lastFailureTime.getTime()
        : Infinity;

      if (timeSinceFailure >= this.circuitBreakerConfig.resetTimeoutMs) {
        this.circuitState = 'half-open';
        this.halfOpenAttempts = 0;
        logger.info('Circuit breaker transitioning to half-open state', {
          component: 'GitHubClient',
          timeSinceLastFailure: timeSinceFailure,
        });
        return true;
      }
      return false;
    }

    // Half-open state: allow limited attempts
    return this.halfOpenAttempts < this.circuitBreakerConfig.halfOpenMaxAttempts;
  }

  /**
   * Record a successful request
   */
  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = new Date();

    if (this.circuitState === 'half-open') {
      if (this.consecutiveSuccesses >= this.circuitBreakerConfig.successThreshold) {
        this.circuitState = 'closed';
        logger.info('Circuit breaker closed after successful recovery', {
          component: 'GitHubClient',
          consecutiveSuccesses: this.consecutiveSuccesses,
        });
      }
    }
  }

  /**
   * Record a failed request
   */
  private recordFailure(error: Error): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    this.lastFailureTime = new Date();
    this.lastErrorMessage = error.message;

    if (this.circuitState === 'half-open') {
      this.halfOpenAttempts++;
      if (this.halfOpenAttempts >= this.circuitBreakerConfig.halfOpenMaxAttempts) {
        this.circuitState = 'open';
        logger.warn('Circuit breaker reopened after half-open failures', {
          component: 'GitHubClient',
          halfOpenAttempts: this.halfOpenAttempts,
        });
      }
    } else if (this.consecutiveFailures >= this.circuitBreakerConfig.failureThreshold) {
      this.circuitState = 'open';
      logger.warn('Circuit breaker opened due to consecutive failures', {
        component: 'GitHubClient',
        consecutiveFailures: this.consecutiveFailures,
        lastError: error.message,
      });
    }
  }

  /**
   * Update rate limit state from response headers
   */
  private updateRateLimitFromHeaders(headers: Record<string, any> | undefined): void {
    if (!headers) return;

    // Extract all rate limit headers (case-insensitive)
    const remaining = headers['x-ratelimit-remaining'] ?? headers['X-RateLimit-Remaining'];
    const limit = headers['x-ratelimit-limit'] ?? headers['X-RateLimit-Limit'];
    const reset = headers['x-ratelimit-reset'] ?? headers['X-RateLimit-Reset'];
    const resource = headers['x-ratelimit-resource'] ?? headers['X-RateLimit-Resource'] ?? 'core';
    const used = headers['x-ratelimit-used'] ?? headers['X-RateLimit-Used'];

    if (remaining !== undefined) {
      const remainingNum = parseInt(remaining, 10);
      this.rateLimitState.remaining = remainingNum;
      this.rateLimitRemaining = remainingNum;
      this.rateLimitState.isLimited = remainingNum === 0;
    }

    if (limit !== undefined) {
      this.rateLimitState.limit = parseInt(limit, 10);
    }

    if (reset !== undefined) {
      const resetTimestamp = parseInt(reset, 10);
      this.rateLimitState.resetAt = resetTimestamp;
      this.rateLimitResetAt = new Date(resetTimestamp * 1000);

      // Calculate retry delay
      if (this.rateLimitState.isLimited) {
        const now = Date.now();
        const resetMs = resetTimestamp * 1000;
        this.rateLimitState.retryAfterMs = Math.max(0, resetMs - now + 1000); // +1s buffer
      }
    }

    if (resource) {
      this.rateLimitState.resource = resource;
    }

    // Log warning if rate limit is low
    if (this.rateLimitState.remaining < 100 && this.rateLimitState.remaining > 0) {
      this.log.warn('GitHub rate limit running low', {
        remaining: this.rateLimitState.remaining,
        limit: this.rateLimitState.limit,
        resetAt: this.rateLimitResetAt?.toISOString(),
        resource: this.rateLimitState.resource,
      });
    }
  }

  /**
   * Check if an error is due to rate limiting and update rate limit state
   */
  private updateRateLimitState(error: any): void {
    const statusCode = error.status ?? error.response?.status;

    // Update from response headers if available
    const headers = error.response?.headers;
    if (headers) {
      this.updateRateLimitFromHeaders(headers);
    }

    if (statusCode === 429 || error.message?.toLowerCase().includes('rate limit')) {
      this.rateLimitState.isLimited = true;
      this.rateLimitState.remaining = 0;

      // Check for Retry-After header
      const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
      if (retryAfter) {
        const retryAfterMs = parseInt(retryAfter, 10) * 1000;
        this.rateLimitState.retryAfterMs = retryAfterMs;
      }

      // Log rate limit hit
      this.log.warn('GitHub rate limit exceeded', {
        statusCode,
        retryAfterMs: this.rateLimitState.retryAfterMs,
        resetAt: this.rateLimitResetAt?.toISOString(),
        resource: this.rateLimitState.resource,
      });
    }
  }

  /**
   * Get the delay needed before making a request (respects rate limits)
   */
  getRequiredDelay(): number {
    if (!this.rateLimitState.isLimited) {
      return 0;
    }

    if (this.rateLimitState.retryAfterMs) {
      return this.rateLimitState.retryAfterMs;
    }

    if (this.rateLimitState.resetAt) {
      const now = Date.now();
      const resetMs = this.rateLimitState.resetAt * 1000;
      return Math.max(0, resetMs - now + 1000);
    }

    return 0;
  }

  /**
   * Wait for rate limit if needed before making a request
   */
  async waitForRateLimitReset(): Promise<void> {
    const delay = this.getRequiredDelay();
    if (delay > 0) {
      this.log.info(`Waiting ${Math.ceil(delay / 1000)}s for rate limit reset`, {
        resetAt: this.rateLimitResetAt?.toISOString(),
        resource: this.rateLimitState.resource,
      });
      await new Promise(resolve => setTimeout(resolve, delay));
      this.rateLimitState.isLimited = false;
    }
  }

  /**
   * Check if rate limit is approaching and requests should be queued
   */
  private shouldQueueRequest(): boolean {
    return (
      this.rateLimitState.remaining <= this.rateLimitConfig.queueThreshold &&
      this.rateLimitState.remaining > 0 &&
      !this.rateLimitState.isLimited
    );
  }

  /**
   * Add a request to the queue when rate limit is approaching
   */
  private async enqueueRequest<T>(
    operation: () => Promise<T>,
    endpoint: string,
    context?: ErrorContext
  ): Promise<T> {
    // Check queue size limit
    if (this.requestQueue.length >= this.rateLimitConfig.maxQueueSize) {
      this.log.warn('Request queue full, rejecting request', {
        queueSize: this.requestQueue.length,
        maxQueueSize: this.rateLimitConfig.maxQueueSize,
        endpoint,
      });
      throw new GitHubError(
        ErrorCode.GITHUB_RATE_LIMITED,
        `Request queue full (${this.requestQueue.length}/${this.rateLimitConfig.maxQueueSize}). Rate limit approaching.`,
        {
          statusCode: 429,
          endpoint,
          context: {
            ...context,
            queueSize: this.requestQueue.length,
            rateLimitRemaining: this.rateLimitState.remaining,
          },
        }
      );
    }

    this.log.debug('Queuing request due to rate limit threshold', {
      endpoint,
      queueSize: this.requestQueue.length + 1,
      rateLimitRemaining: this.rateLimitState.remaining,
      threshold: this.rateLimitConfig.queueThreshold,
    });

    return new Promise<T>((resolve, reject) => {
      const queuedRequest: QueuedRequest<T> = {
        operation,
        endpoint,
        context,
        resolve,
        reject,
        queuedAt: Date.now(),
      };
      this.requestQueue.push(queuedRequest);
      this.startQueueProcessor();
    });
  }

  /**
   * Start the queue processor if not already running
   */
  private startQueueProcessor(): void {
    if (this.queueProcessorInterval) {
      return;
    }

    this.log.debug('Starting request queue processor');

    // Process queue every second
    this.queueProcessorInterval = setInterval(() => {
      this.processQueue();
    }, 1000);

    // Also trigger immediate processing
    this.processQueue();
  }

  /**
   * Stop the queue processor
   */
  private stopQueueProcessor(): void {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
      this.queueProcessorInterval = null;
      this.log.debug('Stopped request queue processor');
    }
  }

  /**
   * Process queued requests when rate limit allows
   */
  private async processQueue(): Promise<void> {
    // Don't process if already processing or queue is empty
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      if (this.requestQueue.length === 0) {
        this.stopQueueProcessor();
      }
      return;
    }

    // Check if we can make requests now
    if (this.rateLimitState.isLimited) {
      const delay = this.getRequiredDelay();
      if (delay > 0) {
        this.log.debug('Queue processor waiting for rate limit reset', {
          delayMs: delay,
          queueSize: this.requestQueue.length,
        });
        return;
      }
      this.rateLimitState.isLimited = false;
    }

    // Check if we're still below threshold (but not limited)
    if (this.rateLimitState.remaining <= 10 && this.rateLimitState.remaining > 0) {
      this.log.debug('Rate limit very low, delaying queue processing', {
        remaining: this.rateLimitState.remaining,
        queueSize: this.requestQueue.length,
      });
      return;
    }

    this.isProcessingQueue = true;

    try {
      const now = Date.now();

      // Process timed out requests first
      const timedOutRequests: QueuedRequest<any>[] = [];
      const validRequests: QueuedRequest<any>[] = [];

      for (const request of this.requestQueue) {
        const waitTime = now - request.queuedAt;
        if (waitTime > this.rateLimitConfig.maxQueueWaitMs) {
          timedOutRequests.push(request);
        } else {
          validRequests.push(request);
        }
      }

      // Reject timed out requests
      for (const request of timedOutRequests) {
        const waitTime = now - request.queuedAt;
        this.log.warn('Request timed out in queue', {
          endpoint: request.endpoint,
          waitTimeMs: waitTime,
          maxWaitMs: this.rateLimitConfig.maxQueueWaitMs,
        });
        request.reject(
          new GitHubError(
            ErrorCode.GITHUB_RATE_LIMITED,
            `Request timed out waiting in rate limit queue (waited ${Math.round(waitTime / 1000)}s)`,
            {
              statusCode: 429,
              endpoint: request.endpoint,
              context: {
                ...request.context,
                waitTimeMs: waitTime,
              },
            }
          )
        );
      }

      this.requestQueue = validRequests;

      // Process one request if we have remaining capacity
      if (this.requestQueue.length > 0 && this.rateLimitState.remaining > 10) {
        const request = this.requestQueue.shift()!;
        this.log.debug('Processing queued request', {
          endpoint: request.endpoint,
          queuedFor: now - request.queuedAt,
          remainingInQueue: this.requestQueue.length,
        });

        try {
          const result = await this.executeWithRetry(
            request.operation,
            request.endpoint,
            request.context
          );
          request.resolve(result);
        } catch (error) {
          request.reject(error);
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Log rate limit status at debug level
   */
  private logRateLimitStatus(endpoint: string): void {
    if (!this.rateLimitConfig.logRateLimitStatus) {
      return;
    }

    this.log.debug('Rate limit status', {
      endpoint,
      remaining: this.rateLimitState.remaining,
      limit: this.rateLimitState.limit,
      used: this.rateLimitState.limit - this.rateLimitState.remaining,
      percentUsed: ((this.rateLimitState.limit - this.rateLimitState.remaining) / this.rateLimitState.limit * 100).toFixed(1),
      resetAt: this.rateLimitResetAt?.toISOString(),
      resource: this.rateLimitState.resource,
      isLimited: this.rateLimitState.isLimited,
      queueSize: this.requestQueue.length,
    });
  }

  /**
   * Execute a GitHub API request with rate limit awareness
   * Routes requests through the queue when approaching rate limits
   */
  async execute<T>(
    operation: () => Promise<T>,
    endpoint: string,
    context?: ErrorContext
  ): Promise<T> {
    // Log rate limit status before request
    this.logRateLimitStatus(endpoint);

    // Check if we should queue this request
    if (this.rateLimitConfig.preemptiveWait && this.shouldQueueRequest()) {
      return this.enqueueRequest(operation, endpoint, context);
    }

    // If rate limited, wait for reset
    if (this.rateLimitState.isLimited) {
      await this.waitForRateLimitReset();
    }

    return this.executeWithRetry(operation, endpoint, context);
  }

  /**
   * Execute a GitHub API request with automatic retry for transient failures
   * Integrates with circuit breaker for graceful degradation
   */
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    endpoint: string,
    context?: ErrorContext
  ): Promise<T> {
    const startTime = Date.now();
    const correlationId = getCorrelationId();
    const method = this.extractMethodFromEndpoint(endpoint);
    const repository = `${this.owner}/${this.repo}`;
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Log detailed API request (debug mode)
    this.log.githubApiRequest(method, endpoint, {
      correlationId,
      requestId,
    });

    // Record operation in github phase if tracking
    if (correlationId) {
      recordPhaseOperation(correlationId, 'github', endpoint);
    }

    // Check circuit breaker state
    if (!this.canMakeRequest()) {
      const error = new GitHubError(
        ErrorCode.GITHUB_API_ERROR,
        `GitHub API unavailable (circuit breaker open). Will retry after ${this.circuitBreakerConfig.resetTimeoutMs / 1000}s`,
        {
          statusCode: 503,
          endpoint,
          context: {
            ...context,
            circuitState: this.circuitState,
            lastFailure: this.lastFailureTime?.toISOString(),
          },
        }
      );

      // Log the blocked request
      logger.apiCall('GitHub', endpoint, method, {
        statusCode: 503,
        duration: Date.now() - startTime,
        success: false,
        error: 'Circuit breaker open',
        correlationId,
      });

      // Record metrics for blocked request
      metrics.recordGitHubApiCall(endpoint, method, false, Date.now() - startTime, {
        repository,
        statusCode: 503,
      });

      logger.warn('GitHub API request blocked by circuit breaker', {
        endpoint,
        circuitState: this.circuitState,
        lastFailure: this.lastFailureTime?.toISOString(),
      });
      throw error;
    }

    try {
      // Wrap the operation with timeout protection
      const timedResult = await timeOperation(
        () => withTimeout(
          async () => withRetry(operation, {
            config: this.retryConfig,
            onRetry: (error, attempt, delay) => {
              this.updateRateLimitState(error);
              const statusCode = (error as any).status ?? (error as any).response?.status;

              logger.apiCall('GitHub', endpoint, method, {
                statusCode,
                duration: Date.now() - startTime,
                success: false,
                error: `Retry ${attempt}: ${error.message}`,
                correlationId,
              });

              logger.warn(`GitHub API retry (attempt ${attempt}): ${endpoint}`, {
                error: error.message,
                retryInMs: delay,
                circuitState: this.circuitState,
              });
            },
            shouldRetry: (error) => {
              // Timeout errors are retryable
              if (error instanceof TimeoutError) {
                return true;
              }
              // Check if it's a StructuredError with retry flag
              if (error instanceof StructuredError) {
                return error.isRetryable;
              }
              // Check for common retryable HTTP status codes
              const statusCode = (error as any).status ?? (error as any).response?.status;
              if (statusCode === 429) return true; // Rate limited
              if (statusCode >= 500) return true; // Server errors
              // Network errors
              const code = (error as any).code;
              if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
                return true;
              }
              return false;
            },
          }),
          {
            timeoutMs: this.requestTimeoutMs,
            operationName: `GitHub API: ${endpoint}`,
            context: { endpoint, method, owner: this.owner, repo: this.repo },
          }
        ),
        `github:${endpoint}`
      );

      // Success - record it
      this.recordSuccess();

      // Log detailed API response (debug mode)
      this.log.githubApiResponse(method, endpoint, 200, timedResult.duration, {
        correlationId,
        requestId,
        rateLimitRemaining: this.rateLimitState.remaining,
        rateLimitReset: this.rateLimitResetAt,
      });

      // Log successful API call
      logger.apiCall('GitHub', endpoint, method, {
        statusCode: 200,
        duration: timedResult.duration,
        success: true,
        correlationId,
      });

      // Record metrics
      metrics.recordGitHubApiCall(endpoint, method, true, timedResult.duration, {
        repository,
        statusCode: 200,
      });

      return timedResult.result;
    } catch (error) {
      const duration = Date.now() - startTime;
      const statusCode = (error as any).status ?? (error as any).response?.status ?? 500;

      // Failure - record it and update rate limit state
      this.updateRateLimitState(error);
      this.recordFailure(error as Error);

      // Log detailed API response (debug mode) - for failures too
      this.log.githubApiResponse(method, endpoint, statusCode, duration, {
        correlationId,
        requestId,
        rateLimitRemaining: this.rateLimitState.remaining,
        rateLimitReset: this.rateLimitResetAt,
      });

      // Record error in phase tracking
      if (correlationId) {
        const errorCode = error instanceof StructuredError ? error.code : `HTTP_${statusCode || 'UNKNOWN'}`;
        recordPhaseError(correlationId, 'github', errorCode);
      }

      // Log failed API call with enhanced context
      logger.apiCall('GitHub', endpoint, method, {
        statusCode,
        duration,
        success: false,
        error: (error as Error).message,
        correlationId,
        circuitState: this.circuitState,
        consecutiveFailures: this.consecutiveFailures,
      });

      // Log slow failed operations for debugging
      if (duration > DEFAULT_TIMING_THRESHOLD_MS) {
        logger.debug('Slow GitHub API failure', {
          endpoint,
          method,
          duration,
          threshold: DEFAULT_TIMING_THRESHOLD_MS,
          statusCode,
          correlationId,
        });
      }

      // Record metrics
      metrics.recordGitHubApiCall(endpoint, method, false, duration, {
        repository,
        statusCode,
      });

      throw this.handleError(error, endpoint, context);
    }
  }

  /**
   * Extract HTTP method from endpoint string
   */
  private extractMethodFromEndpoint(endpoint: string): string {
    const match = endpoint.match(/^(GET|POST|PUT|PATCH|DELETE)\s/);
    return match ? match[1] : 'GET';
  }

  /**
   * Execute a GitHub API request with graceful degradation support.
   * Returns the fallback value if the circuit breaker is open or all retries fail.
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T,
    endpoint: string,
    context?: ErrorContext
  ): Promise<{ value: T; degraded: boolean }> {
    try {
      const value = await this.executeWithRetry(operation, endpoint, context);
      return { value, degraded: false };
    } catch (error) {
      logger.warn(`GitHub API degraded - using fallback for ${endpoint}`, {
        error: (error as Error).message,
        circuitState: this.circuitState,
      });
      return { value: fallback, degraded: true };
    }
  }

  /**
   * Check if the GitHub API is currently available
   */
  isAvailable(): boolean {
    return this.circuitState !== 'open';
  }

  /**
   * Reset the circuit breaker state (for testing or manual recovery)
   */
  resetCircuitBreaker(): void {
    this.circuitState = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenAttempts = 0;
    logger.info('Circuit breaker manually reset', { component: 'GitHubClient' });
  }

  /**
   * Convert an error to a structured GitHubError
   */
  private handleError(error: any, endpoint: string, context?: ErrorContext): GitHubError {
    if (error instanceof GitHubError) {
      return error;
    }
    return createGitHubErrorFromResponse(error, endpoint, {
      ...context,
      owner: this.owner,
      repo: this.repo,
    });
  }

  /**
   * Verify authentication works
   */
  async verifyAuth(): Promise<{ login: string; name: string }> {
    return this.executeWithRetry(
      async () => {
        const { data } = await this.octokit.users.getAuthenticated();
        return { login: data.login, name: data.name || data.login };
      },
      'GET /user',
      { operation: 'verifyAuth' }
    );
  }

  /**
   * Get repository info
   */
  async getRepo(): Promise<{
    defaultBranch: string;
    fullName: string;
    private: boolean;
  }> {
    return this.executeWithRetry(
      async () => {
        const { data } = await this.octokit.repos.get({
          owner: this.owner,
          repo: this.repo,
        });
        return {
          defaultBranch: data.default_branch,
          fullName: data.full_name,
          private: data.private,
        };
      },
      `GET /repos/${this.owner}/${this.repo}`,
      { operation: 'getRepo' }
    );
  }

  /**
   * Check rate limit status
   */
  async getRateLimit(): Promise<{
    limit: number;
    remaining: number;
    resetAt: Date;
  }> {
    return this.executeWithRetry(
      async () => {
        const { data } = await this.octokit.rateLimit.get();
        return {
          limit: data.rate.limit,
          remaining: data.rate.remaining,
          resetAt: new Date(data.rate.reset * 1000),
        };
      },
      'GET /rate_limit',
      { operation: 'getRateLimit' }
    );
  }

  /**
   * Wait for rate limit to reset if necessary
   */
  async waitForRateLimitIfNeeded(): Promise<void> {
    try {
      const rateLimit = await this.getRateLimit();
      if (rateLimit.remaining < 10) {
        const waitMs = Math.max(0, rateLimit.resetAt.getTime() - Date.now());
        if (waitMs > 0) {
          logger.warn(`Rate limit low (${rateLimit.remaining} remaining), waiting ${Math.ceil(waitMs / 1000)}s`);
          await new Promise((resolve) => setTimeout(resolve, waitMs + 1000));
        }
      }
    } catch (error) {
      logger.debug('Failed to check rate limit', { error: (error as Error).message });
    }
  }
}

export function createGitHubClient(options: GitHubClientOptions): GitHubClient {
  return new GitHubClient(options);
}
