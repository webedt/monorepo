/**
 * GitHub API Rate Limiter Utility
 *
 * Provides intelligent rate limiting for GitHub API operations:
 * - Tracks rate limit status from API response headers
 * - Queues requests during rate limit periods with exponential backoff
 * - Supports multiple rate limit resources (core, search, graphql)
 * - Handles enterprise GitHub instances with stricter limits
 * - Provides batch operation support to reduce total API calls
 */

import { logger } from './logger.js';
import { GitHubError, ErrorCode } from './errors.js';

/**
 * Rate limit status for a specific GitHub API resource
 */
export interface RateLimitResource {
  /** Name of the resource (core, search, graphql, etc.) */
  name: string;
  /** Total request limit for the current window */
  limit: number;
  /** Remaining requests in current window */
  remaining: number;
  /** When the rate limit resets (Unix timestamp in seconds) */
  resetAt: number;
  /** Number of requests used in current window */
  used: number;
  /** Whether currently rate limited */
  isLimited: boolean;
  /** Last updated timestamp */
  lastUpdated: number;
}

/**
 * Combined rate limit status for all resources
 */
export interface RateLimitStatus {
  /** Core API rate limit (most common) */
  core: RateLimitResource;
  /** Search API rate limit (more restrictive) */
  search: RateLimitResource;
  /** GraphQL API rate limit */
  graphql: RateLimitResource;
  /** Whether any resource is currently rate limited */
  isAnyLimited: boolean;
  /** Delay in ms until next request is allowed */
  requiredDelayMs: number;
}

/**
 * Configuration for the rate limiter
 */
export interface RateLimiterConfig {
  /** Threshold (remaining requests) at which to start throttling (default: 100) */
  throttleThreshold: number;
  /** Maximum number of requests to queue before rejecting (default: 100) */
  maxQueueSize: number;
  /** Maximum time to wait in queue in milliseconds (default: 300000 = 5 minutes) */
  maxQueueWaitMs: number;
  /** Minimum delay between requests in ms when throttling (default: 100) */
  minThrottleDelayMs: number;
  /** Whether to enable request batching (default: true) */
  enableBatching: boolean;
  /** Maximum batch size for combined requests (default: 10) */
  maxBatchSize: number;
  /** Delay before processing a batch in ms (default: 50) */
  batchDelayMs: number;
  /** Enterprise instance configuration (stricter limits) */
  enterprise?: {
    /** Whether this is an enterprise instance */
    enabled: boolean;
    /** Custom rate limit threshold for enterprise */
    throttleThreshold?: number;
    /** Custom max queue wait for enterprise */
    maxQueueWaitMs?: number;
  };
}

/**
 * Queued request waiting for rate limit to clear
 */
interface QueuedRequest<T> {
  id: string;
  operation: () => Promise<T>;
  resource: string;
  priority: number;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  queuedAt: number;
  timeout?: ReturnType<typeof setTimeout>;
}

/**
 * Request batch for combining multiple operations
 */
interface RequestBatch<T> {
  id: string;
  requests: Array<{
    operation: () => Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  }>;
  resource: string;
  createdAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * Default rate limiter configuration
 */
export const DEFAULT_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  throttleThreshold: 100,
  maxQueueSize: 100,
  maxQueueWaitMs: 300000, // 5 minutes
  minThrottleDelayMs: 100,
  enableBatching: true,
  maxBatchSize: 10,
  batchDelayMs: 50,
};

/**
 * Enterprise rate limiter configuration (more conservative)
 */
export const ENTERPRISE_RATE_LIMITER_CONFIG: RateLimiterConfig = {
  throttleThreshold: 50,
  maxQueueSize: 50,
  maxQueueWaitMs: 180000, // 3 minutes
  minThrottleDelayMs: 200,
  enableBatching: true,
  maxBatchSize: 5,
  batchDelayMs: 100,
  enterprise: {
    enabled: true,
  },
};

/**
 * Create a default rate limit resource
 */
function createDefaultResource(name: string): RateLimitResource {
  // Default GitHub API limits
  const defaultLimits: Record<string, number> = {
    core: 5000,
    search: 30,
    graphql: 5000,
    integration_manifest: 5000,
    source_import: 100,
    code_scanning_upload: 500,
    actions_runner_registration: 10000,
    scim: 15000,
  };

  return {
    name,
    limit: defaultLimits[name] ?? 5000,
    remaining: defaultLimits[name] ?? 5000,
    resetAt: 0,
    used: 0,
    isLimited: false,
    lastUpdated: Date.now(),
  };
}

/**
 * GitHub API Rate Limiter
 *
 * Manages rate limiting for GitHub API operations with:
 * - Automatic throttling based on remaining quota
 * - Request queuing during rate limit periods
 * - Exponential backoff for retries
 * - Support for multiple rate limit resources
 * - Batch operation support
 */
export class GitHubRateLimiter {
  private config: RateLimiterConfig;
  private resources: Map<string, RateLimitResource> = new Map();
  private requestQueue: QueuedRequest<unknown>[] = [];
  private batches: Map<string, RequestBatch<unknown>> = new Map();
  private isProcessingQueue = false;
  private queueProcessorInterval: ReturnType<typeof setInterval> | null = null;
  private requestCounter = 0;
  private log = logger.child('GitHubRateLimiter');

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = {
      ...DEFAULT_RATE_LIMITER_CONFIG,
      ...config,
    };

    // Apply enterprise settings if enabled
    if (this.config.enterprise?.enabled) {
      this.config.throttleThreshold = this.config.enterprise.throttleThreshold ?? 50;
      this.config.maxQueueWaitMs = this.config.enterprise.maxQueueWaitMs ?? 180000;
    }

    // Initialize default resources
    this.resources.set('core', createDefaultResource('core'));
    this.resources.set('search', createDefaultResource('search'));
    this.resources.set('graphql', createDefaultResource('graphql'));

    this.log.debug('Rate limiter initialized', { config: this.config });
  }

  /**
   * Get current rate limit status
   */
  getStatus(): RateLimitStatus {
    const core = this.resources.get('core') ?? createDefaultResource('core');
    const search = this.resources.get('search') ?? createDefaultResource('search');
    const graphql = this.resources.get('graphql') ?? createDefaultResource('graphql');

    const isAnyLimited = core.isLimited || search.isLimited || graphql.isLimited;
    const requiredDelayMs = this.calculateRequiredDelay();

    return {
      core,
      search,
      graphql,
      isAnyLimited,
      requiredDelayMs,
    };
  }

  /**
   * Get rate limit for a specific resource
   */
  getResourceLimit(resource: string): RateLimitResource {
    return this.resources.get(resource) ?? createDefaultResource(resource);
  }

  /**
   * Update rate limit status from GitHub API response headers
   */
  updateFromHeaders(headers: Record<string, string | undefined>): void {
    // Extract rate limit headers (case-insensitive)
    const getHeader = (name: string): string | undefined => {
      const key = Object.keys(headers).find(k => k.toLowerCase() === name.toLowerCase());
      return key ? headers[key] : undefined;
    };

    const remaining = getHeader('x-ratelimit-remaining');
    const limit = getHeader('x-ratelimit-limit');
    const reset = getHeader('x-ratelimit-reset');
    const used = getHeader('x-ratelimit-used');
    const resource = getHeader('x-ratelimit-resource') ?? 'core';

    if (remaining === undefined && limit === undefined) {
      return;
    }

    const resourceData = this.resources.get(resource) ?? createDefaultResource(resource);

    if (remaining !== undefined) {
      resourceData.remaining = parseInt(remaining, 10);
    }
    if (limit !== undefined) {
      resourceData.limit = parseInt(limit, 10);
    }
    if (reset !== undefined) {
      resourceData.resetAt = parseInt(reset, 10);
    }
    if (used !== undefined) {
      resourceData.used = parseInt(used, 10);
    }

    resourceData.isLimited = resourceData.remaining === 0;
    resourceData.lastUpdated = Date.now();

    this.resources.set(resource, resourceData);

    // Log warning if rate limit is low
    if (resourceData.remaining <= this.config.throttleThreshold && resourceData.remaining > 0) {
      this.log.warn('Rate limit running low', {
        resource,
        remaining: resourceData.remaining,
        limit: resourceData.limit,
        resetAt: new Date(resourceData.resetAt * 1000).toISOString(),
      });
    }

    // Log if rate limited
    if (resourceData.isLimited) {
      this.log.warn('Rate limited', {
        resource,
        resetAt: new Date(resourceData.resetAt * 1000).toISOString(),
        delayMs: this.calculateDelayForResource(resourceData),
      });
    }
  }

  /**
   * Update rate limit status from error response
   */
  updateFromError(error: unknown): void {
    if (!error || typeof error !== 'object') return;

    const err = error as Record<string, unknown>;
    const statusCode = err.status ?? (err.response as Record<string, unknown>)?.status;

    if (statusCode === 429 || (err.message as string)?.toLowerCase().includes('rate limit')) {
      // Mark core resource as limited
      const core = this.resources.get('core') ?? createDefaultResource('core');
      core.isLimited = true;
      core.remaining = 0;

      // Check for Retry-After header
      const headers = (err.response as Record<string, unknown>)?.headers as Record<string, string> | undefined;
      if (headers) {
        this.updateFromHeaders(headers);

        const retryAfter = headers['retry-after'];
        if (retryAfter) {
          const retryAfterSeconds = parseInt(retryAfter, 10);
          if (!isNaN(retryAfterSeconds)) {
            core.resetAt = Math.floor(Date.now() / 1000) + retryAfterSeconds;
          }
        }
      }

      this.resources.set('core', core);
    }
  }

  /**
   * Calculate delay needed before making a request
   */
  private calculateRequiredDelay(): number {
    let maxDelay = 0;

    for (const [, resource] of this.resources) {
      if (resource.isLimited) {
        const delay = this.calculateDelayForResource(resource);
        maxDelay = Math.max(maxDelay, delay);
      } else if (resource.remaining <= this.config.throttleThreshold) {
        // Throttle when approaching limit
        const throttleRatio = resource.remaining / this.config.throttleThreshold;
        const throttleDelay = this.config.minThrottleDelayMs * (1 - throttleRatio);
        maxDelay = Math.max(maxDelay, throttleDelay);
      }
    }

    return maxDelay;
  }

  /**
   * Calculate delay for a specific resource
   */
  private calculateDelayForResource(resource: RateLimitResource): number {
    if (!resource.isLimited) return 0;

    const now = Date.now();
    const resetMs = resource.resetAt * 1000;
    return Math.max(0, resetMs - now + 1000); // +1s buffer
  }

  /**
   * Check if we should throttle requests
   */
  shouldThrottle(resource = 'core'): boolean {
    const res = this.resources.get(resource);
    if (!res) return false;

    return res.isLimited || res.remaining <= this.config.throttleThreshold;
  }

  /**
   * Wait for rate limit to reset if needed
   */
  async waitForRateLimitReset(resource = 'core'): Promise<void> {
    const res = this.resources.get(resource);
    if (!res?.isLimited) return;

    const delay = this.calculateDelayForResource(res);
    if (delay > 0) {
      this.log.info(`Waiting ${Math.ceil(delay / 1000)}s for ${resource} rate limit reset`, {
        resetAt: new Date(res.resetAt * 1000).toISOString(),
      });
      await new Promise(resolve => setTimeout(resolve, delay));
      res.isLimited = false;
      this.resources.set(resource, res);
    }
  }

  /**
   * Execute a request with rate limiting awareness
   */
  async execute<T>(
    operation: () => Promise<T>,
    options: {
      resource?: string;
      priority?: number;
      skipQueue?: boolean;
    } = {}
  ): Promise<T> {
    const { resource = 'core', priority = 0, skipQueue = false } = options;
    const res = this.resources.get(resource) ?? createDefaultResource(resource);

    // If rate limited, queue the request
    if (res.isLimited && !skipQueue) {
      return this.enqueueRequest(operation, resource, priority);
    }

    // If approaching limit, add throttle delay
    if (this.shouldThrottle(resource) && !skipQueue) {
      const delay = this.calculateRequiredDelay();
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // Decrement remaining (optimistic)
    if (res.remaining > 0) {
      res.remaining--;
      res.used++;
      this.resources.set(resource, res);
    }

    return operation();
  }

  /**
   * Enqueue a request to be executed when rate limit allows
   */
  private async enqueueRequest<T>(
    operation: () => Promise<T>,
    resource: string,
    priority: number
  ): Promise<T> {
    // Check queue size limit
    if (this.requestQueue.length >= this.config.maxQueueSize) {
      this.log.warn('Request queue full, rejecting request', {
        queueSize: this.requestQueue.length,
        maxQueueSize: this.config.maxQueueSize,
        resource,
      });
      throw new GitHubError(
        ErrorCode.GITHUB_RATE_LIMITED,
        `Request queue full (${this.requestQueue.length}/${this.config.maxQueueSize}). Rate limit in effect.`,
        {
          statusCode: 429,
          context: {
            queueSize: this.requestQueue.length,
            resource,
          },
        }
      );
    }

    const requestId = `req-${++this.requestCounter}`;

    this.log.debug('Queuing request due to rate limit', {
      requestId,
      resource,
      priority,
      queueSize: this.requestQueue.length + 1,
    });

    return new Promise<T>((resolve, reject) => {
      const queuedRequest: QueuedRequest<T> = {
        id: requestId,
        operation,
        resource,
        priority,
        resolve,
        reject,
        queuedAt: Date.now(),
      };

      // Set timeout for queue wait
      queuedRequest.timeout = setTimeout(() => {
        const index = this.requestQueue.findIndex(r => r.id === requestId);
        if (index !== -1) {
          this.requestQueue.splice(index, 1);
          const waitTime = Date.now() - queuedRequest.queuedAt;
          this.log.warn('Request timed out in queue', {
            requestId,
            resource,
            waitTimeMs: waitTime,
            maxWaitMs: this.config.maxQueueWaitMs,
          });
          reject(new GitHubError(
            ErrorCode.GITHUB_RATE_LIMITED,
            `Request timed out waiting in rate limit queue (waited ${Math.round(waitTime / 1000)}s)`,
            {
              statusCode: 429,
              context: { requestId, resource, waitTimeMs: waitTime },
            }
          ));
        }
      }, this.config.maxQueueWaitMs);

      this.requestQueue.push(queuedRequest as QueuedRequest<unknown>);
      this.startQueueProcessor();
    });
  }

  /**
   * Start the queue processor
   */
  private startQueueProcessor(): void {
    if (this.queueProcessorInterval) return;

    this.log.debug('Starting request queue processor');
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
      this.log.debug('Stopped request queue processor');
    }
  }

  /**
   * Process queued requests
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.requestQueue.length === 0) {
      if (this.requestQueue.length === 0) {
        this.stopQueueProcessor();
      }
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Sort queue by priority (higher first)
      this.requestQueue.sort((a, b) => b.priority - a.priority);

      // Check if we can make requests now
      const delay = this.calculateRequiredDelay();
      if (delay > 0) {
        this.log.debug('Queue processor waiting for rate limit', {
          delayMs: delay,
          queueSize: this.requestQueue.length,
        });
        this.isProcessingQueue = false;
        return;
      }

      // Process one request
      const request = this.requestQueue.shift();
      if (!request) {
        this.isProcessingQueue = false;
        return;
      }

      // Clear timeout
      if (request.timeout) {
        clearTimeout(request.timeout);
      }

      this.log.debug('Processing queued request', {
        requestId: request.id,
        resource: request.resource,
        queuedFor: Date.now() - request.queuedAt,
        remainingInQueue: this.requestQueue.length,
      });

      try {
        const result = await request.operation();
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  /**
   * Add a request to a batch for combined execution
   */
  async addToBatch<T>(
    batchKey: string,
    operation: () => Promise<T>,
    resource = 'core'
  ): Promise<T> {
    if (!this.config.enableBatching) {
      return this.execute(operation, { resource });
    }

    const batch = this.batches.get(batchKey) ?? {
      id: batchKey,
      requests: [],
      resource,
      createdAt: Date.now(),
    };

    return new Promise<T>((resolve, reject) => {
      batch.requests.push({
        operation,
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      // If batch is full, process immediately
      if (batch.requests.length >= this.config.maxBatchSize) {
        this.processBatch(batchKey);
      } else if (!batch.timer) {
        // Set timer to process batch after delay
        batch.timer = setTimeout(() => {
          this.processBatch(batchKey);
        }, this.config.batchDelayMs);
      }

      this.batches.set(batchKey, batch as RequestBatch<unknown>);
    });
  }

  /**
   * Process a batch of requests
   */
  private async processBatch(batchKey: string): Promise<void> {
    const batch = this.batches.get(batchKey);
    if (!batch || batch.requests.length === 0) {
      this.batches.delete(batchKey);
      return;
    }

    // Clear timer
    if (batch.timer) {
      clearTimeout(batch.timer);
    }

    // Remove batch from map
    this.batches.delete(batchKey);

    this.log.debug('Processing request batch', {
      batchKey,
      requestCount: batch.requests.length,
      resource: batch.resource,
    });

    // Execute all requests in parallel
    for (const request of batch.requests) {
      try {
        const result = await this.execute(request.operation, {
          resource: batch.resource,
        });
        request.resolve(result);
      } catch (error) {
        request.reject(error);
      }
    }
  }

  /**
   * Clear all queued requests
   */
  clearQueue(): void {
    const queueSize = this.requestQueue.length;

    for (const request of this.requestQueue) {
      if (request.timeout) {
        clearTimeout(request.timeout);
      }
      request.reject(new GitHubError(
        ErrorCode.GITHUB_SERVICE_DEGRADED,
        'Request queue cleared',
        { statusCode: 503, context: { requestId: request.id } }
      ));
    }

    this.requestQueue = [];
    this.stopQueueProcessor();

    if (queueSize > 0) {
      this.log.info(`Cleared ${queueSize} requests from queue`);
    }
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    size: number;
    isProcessing: boolean;
    oldestRequestAge: number | null;
    batchCount: number;
  } {
    const oldestRequest = this.requestQueue[0];
    return {
      size: this.requestQueue.length,
      isProcessing: this.isProcessingQueue,
      oldestRequestAge: oldestRequest ? Date.now() - oldestRequest.queuedAt : null,
      batchCount: this.batches.size,
    };
  }

  /**
   * Reset all rate limit state
   */
  reset(): void {
    this.clearQueue();
    this.resources.clear();
    this.batches.clear();
    this.resources.set('core', createDefaultResource('core'));
    this.resources.set('search', createDefaultResource('search'));
    this.resources.set('graphql', createDefaultResource('graphql'));
    this.log.debug('Rate limiter reset');
  }
}

/**
 * Create a rate limiter instance
 */
export function createRateLimiter(config: Partial<RateLimiterConfig> = {}): GitHubRateLimiter {
  return new GitHubRateLimiter(config);
}

/**
 * Create a rate limiter for enterprise GitHub instances
 */
export function createEnterpriseRateLimiter(): GitHubRateLimiter {
  return new GitHubRateLimiter(ENTERPRISE_RATE_LIMITER_CONFIG);
}
