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
 * Default rate limiter configuration
 */
export const DEFAULT_RATE_LIMITER_CONFIG = {
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
export const ENTERPRISE_RATE_LIMITER_CONFIG = {
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
function createDefaultResource(name) {
    // Default GitHub API limits
    const defaultLimits = {
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
    config;
    resources = new Map();
    requestQueue = [];
    batches = new Map();
    isProcessingQueue = false;
    queueProcessorInterval = null;
    requestCounter = 0;
    log = logger.child('GitHubRateLimiter');
    constructor(config = {}) {
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
    getStatus() {
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
    getResourceLimit(resource) {
        return this.resources.get(resource) ?? createDefaultResource(resource);
    }
    /**
     * Update rate limit status from GitHub API response headers
     */
    updateFromHeaders(headers) {
        // Extract rate limit headers (case-insensitive)
        const getHeader = (name) => {
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
    updateFromError(error) {
        if (!error || typeof error !== 'object')
            return;
        const err = error;
        const statusCode = err.status ?? err.response?.status;
        if (statusCode === 429 || err.message?.toLowerCase().includes('rate limit')) {
            // Mark core resource as limited
            const core = this.resources.get('core') ?? createDefaultResource('core');
            core.isLimited = true;
            core.remaining = 0;
            // Check for Retry-After header
            const headers = err.response?.headers;
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
    calculateRequiredDelay() {
        let maxDelay = 0;
        for (const [, resource] of this.resources) {
            if (resource.isLimited) {
                const delay = this.calculateDelayForResource(resource);
                maxDelay = Math.max(maxDelay, delay);
            }
            else if (resource.remaining <= this.config.throttleThreshold) {
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
    calculateDelayForResource(resource) {
        if (!resource.isLimited)
            return 0;
        const now = Date.now();
        const resetMs = resource.resetAt * 1000;
        return Math.max(0, resetMs - now + 1000); // +1s buffer
    }
    /**
     * Check if we should throttle requests
     */
    shouldThrottle(resource = 'core') {
        const res = this.resources.get(resource);
        if (!res)
            return false;
        return res.isLimited || res.remaining <= this.config.throttleThreshold;
    }
    /**
     * Wait for rate limit to reset if needed
     */
    async waitForRateLimitReset(resource = 'core') {
        const res = this.resources.get(resource);
        if (!res?.isLimited)
            return;
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
    async execute(operation, options = {}) {
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
    async enqueueRequest(operation, resource, priority) {
        // Check queue size limit
        if (this.requestQueue.length >= this.config.maxQueueSize) {
            this.log.warn('Request queue full, rejecting request', {
                queueSize: this.requestQueue.length,
                maxQueueSize: this.config.maxQueueSize,
                resource,
            });
            throw new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, `Request queue full (${this.requestQueue.length}/${this.config.maxQueueSize}). Rate limit in effect.`, {
                statusCode: 429,
                context: {
                    queueSize: this.requestQueue.length,
                    resource,
                },
            });
        }
        const requestId = `req-${++this.requestCounter}`;
        this.log.debug('Queuing request due to rate limit', {
            requestId,
            resource,
            priority,
            queueSize: this.requestQueue.length + 1,
        });
        return new Promise((resolve, reject) => {
            const queuedRequest = {
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
                    reject(new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, `Request timed out waiting in rate limit queue (waited ${Math.round(waitTime / 1000)}s)`, {
                        statusCode: 429,
                        context: { requestId, resource, waitTimeMs: waitTime },
                    }));
                }
            }, this.config.maxQueueWaitMs);
            this.requestQueue.push(queuedRequest);
            this.startQueueProcessor();
        });
    }
    /**
     * Start the queue processor
     */
    startQueueProcessor() {
        if (this.queueProcessorInterval)
            return;
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
    stopQueueProcessor() {
        if (this.queueProcessorInterval) {
            clearInterval(this.queueProcessorInterval);
            this.queueProcessorInterval = null;
            this.log.debug('Stopped request queue processor');
        }
    }
    /**
     * Process queued requests
     */
    async processQueue() {
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
            }
            catch (error) {
                request.reject(error);
            }
        }
        finally {
            this.isProcessingQueue = false;
        }
    }
    /**
     * Add a request to a batch for combined execution
     */
    async addToBatch(batchKey, operation, resource = 'core') {
        if (!this.config.enableBatching) {
            return this.execute(operation, { resource });
        }
        const batch = this.batches.get(batchKey) ?? {
            id: batchKey,
            requests: [],
            resource,
            createdAt: Date.now(),
        };
        return new Promise((resolve, reject) => {
            batch.requests.push({
                operation,
                resolve: resolve,
                reject,
            });
            // If batch is full, process immediately
            if (batch.requests.length >= this.config.maxBatchSize) {
                this.processBatch(batchKey);
            }
            else if (!batch.timer) {
                // Set timer to process batch after delay
                batch.timer = setTimeout(() => {
                    this.processBatch(batchKey);
                }, this.config.batchDelayMs);
            }
            this.batches.set(batchKey, batch);
        });
    }
    /**
     * Process a batch of requests
     */
    async processBatch(batchKey) {
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
            }
            catch (error) {
                request.reject(error);
            }
        }
    }
    /**
     * Clear all queued requests
     */
    clearQueue() {
        const queueSize = this.requestQueue.length;
        for (const request of this.requestQueue) {
            if (request.timeout) {
                clearTimeout(request.timeout);
            }
            request.reject(new GitHubError(ErrorCode.GITHUB_SERVICE_DEGRADED, 'Request queue cleared', { statusCode: 503, context: { requestId: request.id } }));
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
    getQueueStats() {
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
    reset() {
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
export function createRateLimiter(config = {}) {
    return new GitHubRateLimiter(config);
}
/**
 * Create a rate limiter for enterprise GitHub instances
 */
export function createEnterpriseRateLimiter() {
    return new GitHubRateLimiter(ENTERPRISE_RATE_LIMITER_CONFIG);
}
//# sourceMappingURL=rateLimiter.js.map