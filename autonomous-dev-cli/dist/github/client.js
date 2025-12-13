import { Octokit } from '@octokit/rest';
import { logger, getCorrelationId, timeOperation, recordPhaseOperation, recordPhaseError, DEFAULT_TIMING_THRESHOLD_MS, } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { GitHubError, ErrorCode, createGitHubErrorFromResponse, withRetry, StructuredError, } from '../utils/errors.js';
import { withTimeout, DEFAULT_TIMEOUTS, getTimeoutFromEnv, TimeoutError, } from '../utils/timeout.js';
import { createRateLimiter, createEnterpriseRateLimiter, } from '../utils/rateLimiter.js';
import { createGitHubCache, } from '../utils/githubCache.js';
const DEFAULT_GITHUB_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
};
const DEFAULT_CIRCUIT_BREAKER_CONFIG = {
    failureThreshold: 5,
    successThreshold: 3,
    resetTimeoutMs: 30000,
    halfOpenMaxAttempts: 3,
};
const DEFAULT_RATE_LIMIT_CONFIG = {
    queueThreshold: 100,
    maxQueueSize: 50,
    maxQueueWaitMs: 120000,
    preemptiveWait: true,
    logRateLimitStatus: true,
};
export class GitHubClient {
    octokit;
    owner;
    repo;
    retryConfig;
    circuitBreakerConfig;
    rateLimitConfig;
    requestTimeoutMs;
    // Circuit breaker state
    circuitState = 'closed';
    consecutiveFailures = 0;
    consecutiveSuccesses = 0;
    lastFailureTime;
    lastSuccessTime;
    lastErrorMessage;
    halfOpenAttempts = 0;
    // Rate limit tracking (enhanced)
    rateLimitRemaining;
    rateLimitResetAt;
    rateLimitState = {
        remaining: 5000,
        limit: 5000,
        resetAt: 0,
        resource: 'core',
        isLimited: false,
    };
    // Request queue for rate limiting
    requestQueue = [];
    isProcessingQueue = false;
    queueProcessorInterval = null;
    // Enhanced rate limiter and cache
    rateLimiter;
    cache;
    isEnterprise;
    log = logger.child('GitHubClient');
    constructor(options) {
        // Support custom base URL for GitHub Enterprise
        const octokitOptions = { auth: options.token };
        if (options.baseUrl) {
            octokitOptions.baseUrl = options.baseUrl;
        }
        this.octokit = new Octokit(octokitOptions);
        this.owner = options.owner;
        this.repo = options.repo;
        this.retryConfig = { ...DEFAULT_GITHUB_RETRY_CONFIG, ...options.retryConfig };
        this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...options.circuitBreakerConfig };
        this.rateLimitConfig = { ...DEFAULT_RATE_LIMIT_CONFIG, ...options.rateLimitConfig };
        this.isEnterprise = options.isEnterprise ?? false;
        // Configure request timeout from options or environment variable or default
        this.requestTimeoutMs = options.requestTimeoutMs
            ?? getTimeoutFromEnv('GITHUB_API', DEFAULT_TIMEOUTS.GITHUB_API);
        // Initialize enhanced rate limiter (use enterprise config for stricter limits)
        this.rateLimiter = this.isEnterprise
            ? createEnterpriseRateLimiter()
            : createRateLimiter(options.rateLimiterConfig);
        // Initialize cache
        this.cache = createGitHubCache(options.cacheConfig);
        // Add hook to capture rate limit headers from all responses
        this.octokit.hook.after('request', (response) => {
            if (response.headers) {
                const headers = response.headers;
                this.updateRateLimitFromHeaders(headers);
                // Also update the enhanced rate limiter
                this.rateLimiter.updateFromHeaders(headers);
            }
        });
        // Add hook to handle errors and update rate limiter
        this.octokit.hook.error('request', (error) => {
            this.rateLimiter.updateFromError(error);
            throw error;
        });
        this.log.debug('GitHubClient initialized', {
            owner: this.owner,
            repo: this.repo,
            retryConfig: this.retryConfig,
            rateLimitConfig: this.rateLimitConfig,
            isEnterprise: this.isEnterprise,
            hasCustomBaseUrl: !!options.baseUrl,
        });
    }
    get client() {
        return this.octokit;
    }
    /**
     * Get the current service health status
     */
    getServiceHealth() {
        let status = 'healthy';
        if (this.circuitState === 'open') {
            status = 'unavailable';
        }
        else if (this.circuitState === 'half-open' || this.consecutiveFailures > 0) {
            status = 'degraded';
        }
        else if (this.rateLimitState.isLimited) {
            status = 'degraded';
        }
        else if (this.requestQueue.length > 0) {
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
    getRateLimitState() {
        return { ...this.rateLimitState };
    }
    /**
     * Get the current queue status
     */
    getQueueStatus() {
        return {
            size: this.requestQueue.length,
            isProcessing: this.isProcessingQueue,
            config: { ...this.rateLimitConfig },
        };
    }
    /**
     * Get the enhanced rate limiter instance
     */
    getRateLimiter() {
        return this.rateLimiter;
    }
    /**
     * Get the enhanced rate limit status from the rate limiter
     */
    getEnhancedRateLimitStatus() {
        return this.rateLimiter.getStatus();
    }
    /**
     * Get the cache instance
     */
    getCache() {
        return this.cache;
    }
    /**
     * Get cache statistics
     */
    getCacheStats() {
        return this.cache.getStats();
    }
    /**
     * Invalidate all cached data for this repository
     */
    invalidateCache() {
        return this.cache.invalidateRepo(this.owner, this.repo);
    }
    /**
     * Invalidate cached data of a specific type
     */
    invalidateCacheType(type) {
        return this.cache.invalidateType(type, this.owner, this.repo);
    }
    /**
     * Get a cached value or fetch it
     */
    async getCachedOrFetch(type, key, fetcher, options) {
        const cacheKey = this.cache.generateKey(type, this.owner, this.repo, key);
        const cached = this.cache.get(cacheKey, type);
        if (cached !== undefined) {
            return cached;
        }
        const result = await fetcher();
        this.cache.set(cacheKey, type, result, { customTtlMs: options?.customTtlMs });
        return result;
    }
    /**
     * Clear the request queue (e.g., on shutdown)
     */
    clearQueue() {
        const queueSize = this.requestQueue.length;
        for (const request of this.requestQueue) {
            request.reject(new GitHubError(ErrorCode.GITHUB_SERVICE_DEGRADED, 'Request queue cleared', {
                statusCode: 503,
                endpoint: request.endpoint,
                context: request.context,
            }));
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
    canMakeRequest() {
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
    recordSuccess() {
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
    recordFailure(error) {
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
        }
        else if (this.consecutiveFailures >= this.circuitBreakerConfig.failureThreshold) {
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
    updateRateLimitFromHeaders(headers) {
        if (!headers)
            return;
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
    updateRateLimitState(error) {
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
    getRequiredDelay() {
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
    async waitForRateLimitReset() {
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
    shouldQueueRequest() {
        return (this.rateLimitState.remaining <= this.rateLimitConfig.queueThreshold &&
            this.rateLimitState.remaining > 0 &&
            !this.rateLimitState.isLimited);
    }
    /**
     * Add a request to the queue when rate limit is approaching
     */
    async enqueueRequest(operation, endpoint, context) {
        // Check queue size limit
        if (this.requestQueue.length >= this.rateLimitConfig.maxQueueSize) {
            this.log.warn('Request queue full, rejecting request', {
                queueSize: this.requestQueue.length,
                maxQueueSize: this.rateLimitConfig.maxQueueSize,
                endpoint,
            });
            throw new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, `Request queue full (${this.requestQueue.length}/${this.rateLimitConfig.maxQueueSize}). Rate limit approaching.`, {
                statusCode: 429,
                endpoint,
                context: {
                    ...context,
                    queueSize: this.requestQueue.length,
                    rateLimitRemaining: this.rateLimitState.remaining,
                },
            });
        }
        this.log.debug('Queuing request due to rate limit threshold', {
            endpoint,
            queueSize: this.requestQueue.length + 1,
            rateLimitRemaining: this.rateLimitState.remaining,
            threshold: this.rateLimitConfig.queueThreshold,
        });
        return new Promise((resolve, reject) => {
            const queuedRequest = {
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
    startQueueProcessor() {
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
    stopQueueProcessor() {
        if (this.queueProcessorInterval) {
            clearInterval(this.queueProcessorInterval);
            this.queueProcessorInterval = null;
            this.log.debug('Stopped request queue processor');
        }
    }
    /**
     * Process queued requests when rate limit allows
     */
    async processQueue() {
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
            const timedOutRequests = [];
            const validRequests = [];
            for (const request of this.requestQueue) {
                const waitTime = now - request.queuedAt;
                if (waitTime > this.rateLimitConfig.maxQueueWaitMs) {
                    timedOutRequests.push(request);
                }
                else {
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
                request.reject(new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, `Request timed out waiting in rate limit queue (waited ${Math.round(waitTime / 1000)}s)`, {
                    statusCode: 429,
                    endpoint: request.endpoint,
                    context: {
                        ...request.context,
                        waitTimeMs: waitTime,
                    },
                }));
            }
            this.requestQueue = validRequests;
            // Process one request if we have remaining capacity
            if (this.requestQueue.length > 0 && this.rateLimitState.remaining > 10) {
                const request = this.requestQueue.shift();
                this.log.debug('Processing queued request', {
                    endpoint: request.endpoint,
                    queuedFor: now - request.queuedAt,
                    remainingInQueue: this.requestQueue.length,
                });
                try {
                    const result = await this.executeWithRetry(request.operation, request.endpoint, request.context);
                    request.resolve(result);
                }
                catch (error) {
                    request.reject(error);
                }
            }
        }
        finally {
            this.isProcessingQueue = false;
        }
    }
    /**
     * Log rate limit status at debug level
     */
    logRateLimitStatus(endpoint) {
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
    async execute(operation, endpoint, context) {
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
    async executeWithRetry(operation, endpoint, context) {
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
            const error = new GitHubError(ErrorCode.GITHUB_API_ERROR, `GitHub API unavailable (circuit breaker open). Will retry after ${this.circuitBreakerConfig.resetTimeoutMs / 1000}s`, {
                statusCode: 503,
                endpoint,
                context: {
                    ...context,
                    circuitState: this.circuitState,
                    lastFailure: this.lastFailureTime?.toISOString(),
                },
            });
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
            const timedResult = await timeOperation(() => withTimeout(async () => withRetry(operation, {
                config: this.retryConfig,
                onRetry: (error, attempt, delay) => {
                    this.updateRateLimitState(error);
                    const statusCode = error.status ?? error.response?.status;
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
                    const statusCode = error.status ?? error.response?.status;
                    if (statusCode === 429)
                        return true; // Rate limited
                    if (statusCode >= 500)
                        return true; // Server errors
                    // Network errors
                    const code = error.code;
                    if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'ECONNRESET') {
                        return true;
                    }
                    return false;
                },
            }), {
                timeoutMs: this.requestTimeoutMs,
                operationName: `GitHub API: ${endpoint}`,
                context: { endpoint, method, owner: this.owner, repo: this.repo },
            }), `github:${endpoint}`);
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
        }
        catch (error) {
            const duration = Date.now() - startTime;
            const statusCode = error.status ?? error.response?.status ?? 500;
            // Failure - record it and update rate limit state
            this.updateRateLimitState(error);
            this.recordFailure(error);
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
                error: error.message,
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
    extractMethodFromEndpoint(endpoint) {
        const match = endpoint.match(/^(GET|POST|PUT|PATCH|DELETE)\s/);
        return match ? match[1] : 'GET';
    }
    /**
     * Execute a GitHub API request with graceful degradation support.
     * Returns the fallback value if the circuit breaker is open or all retries fail.
     */
    async executeWithFallback(operation, fallback, endpoint, context) {
        try {
            const value = await this.executeWithRetry(operation, endpoint, context);
            return { value, degraded: false };
        }
        catch (error) {
            logger.warn(`GitHub API degraded - using fallback for ${endpoint}`, {
                error: error.message,
                circuitState: this.circuitState,
            });
            return { value: fallback, degraded: true };
        }
    }
    /**
     * Check if the GitHub API is currently available
     */
    isAvailable() {
        return this.circuitState !== 'open';
    }
    /**
     * Reset the circuit breaker state (for testing or manual recovery)
     */
    resetCircuitBreaker() {
        this.circuitState = 'closed';
        this.consecutiveFailures = 0;
        this.consecutiveSuccesses = 0;
        this.halfOpenAttempts = 0;
        logger.info('Circuit breaker manually reset', { component: 'GitHubClient' });
    }
    /**
     * Convert an error to a structured GitHubError
     */
    handleError(error, endpoint, context) {
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
    async verifyAuth() {
        return this.executeWithRetry(async () => {
            const { data } = await this.octokit.users.getAuthenticated();
            return { login: data.login, name: data.name || data.login };
        }, 'GET /user', { operation: 'verifyAuth' });
    }
    /**
     * Get repository info (cached)
     */
    async getRepo() {
        return this.getCachedOrFetch('repo-info', 'info', async () => {
            return this.executeWithRetry(async () => {
                const { data } = await this.octokit.repos.get({
                    owner: this.owner,
                    repo: this.repo,
                });
                return {
                    defaultBranch: data.default_branch,
                    fullName: data.full_name,
                    private: data.private,
                };
            }, `GET /repos/${this.owner}/${this.repo}`, { operation: 'getRepo' });
        });
    }
    /**
     * Check rate limit status
     */
    async getRateLimit() {
        return this.executeWithRetry(async () => {
            const { data } = await this.octokit.rateLimit.get();
            return {
                limit: data.rate.limit,
                remaining: data.rate.remaining,
                resetAt: new Date(data.rate.reset * 1000),
            };
        }, 'GET /rate_limit', { operation: 'getRateLimit' });
    }
    /**
     * Wait for rate limit to reset if necessary
     */
    async waitForRateLimitIfNeeded() {
        try {
            const rateLimit = await this.getRateLimit();
            if (rateLimit.remaining < 10) {
                const waitMs = Math.max(0, rateLimit.resetAt.getTime() - Date.now());
                if (waitMs > 0) {
                    logger.warn(`Rate limit low (${rateLimit.remaining} remaining), waiting ${Math.ceil(waitMs / 1000)}s`);
                    await new Promise((resolve) => setTimeout(resolve, waitMs + 1000));
                }
            }
        }
        catch (error) {
            logger.debug('Failed to check rate limit', { error: error.message });
        }
    }
    /**
     * Execute an operation with automatic rate limit backoff.
     * Waits for rate limit reset when receiving 429 status, using header-based timing.
     */
    async executeWithRateLimitBackoff(operation, endpoint, context) {
        const maxRateLimitRetries = 3;
        let attempt = 0;
        while (attempt < maxRateLimitRetries) {
            try {
                // Check if we're currently rate limited before making request
                if (this.rateLimitState.isLimited) {
                    await this.waitForRateLimitReset();
                }
                return await this.executeWithRetry(operation, endpoint, context);
            }
            catch (error) {
                const statusCode = error.status ?? error.response?.status;
                // Handle 429 rate limit specifically with header-based timing
                if (statusCode === 429) {
                    attempt++;
                    const headers = error.response?.headers;
                    // Extract rate limit reset time from headers
                    let waitMs = this.getRequiredDelay();
                    // If we have a Retry-After header, use that instead
                    const retryAfter = headers?.['retry-after'] ?? headers?.['Retry-After'];
                    if (retryAfter) {
                        waitMs = parseInt(retryAfter, 10) * 1000;
                    }
                    // Ensure minimum wait time with exponential backoff for subsequent attempts
                    const backoffMultiplier = Math.pow(2, attempt - 1);
                    waitMs = Math.max(waitMs, 1000 * backoffMultiplier);
                    // Cap at 5 minutes to prevent indefinite waits
                    waitMs = Math.min(waitMs, 5 * 60 * 1000);
                    if (attempt < maxRateLimitRetries) {
                        this.log.warn(`Rate limited (429), waiting ${Math.ceil(waitMs / 1000)}s before retry ${attempt}/${maxRateLimitRetries}`, {
                            endpoint,
                            waitMs,
                            retryAfterHeader: retryAfter,
                            resetAt: this.rateLimitResetAt?.toISOString(),
                        });
                        await new Promise(resolve => setTimeout(resolve, waitMs));
                        // Reset rate limit state after waiting
                        this.rateLimitState.isLimited = false;
                        continue;
                    }
                }
                throw error;
            }
        }
        throw new GitHubError(ErrorCode.GITHUB_RATE_LIMITED, `GitHub API rate limited after ${maxRateLimitRetries} retry attempts`, { endpoint, context });
    }
    /**
     * Preemptively check rate limit and wait if running low.
     * Uses header-based timing from the last response.
     */
    async preemptiveRateLimitCheck() {
        const { remaining, limit, resetAt, isLimited } = this.rateLimitState;
        // If already limited, wait for reset
        if (isLimited) {
            await this.waitForRateLimitReset();
            return;
        }
        // Calculate threshold (10% of limit or minimum 50 requests)
        const threshold = Math.max(Math.floor(limit * 0.1), 50);
        if (remaining <= threshold && remaining > 0) {
            // Calculate proportional wait time based on remaining requests
            const resetMs = resetAt * 1000;
            const now = Date.now();
            const timeToReset = Math.max(0, resetMs - now);
            // Spread remaining requests over time to reset
            const delayPerRequest = timeToReset / (remaining || 1);
            const waitMs = Math.min(delayPerRequest, 5000); // Cap at 5 seconds
            if (waitMs > 100) {
                this.log.debug(`Throttling requests to avoid rate limit`, {
                    remaining,
                    threshold,
                    delayMs: Math.round(waitMs),
                });
                await new Promise(resolve => setTimeout(resolve, waitMs));
            }
        }
    }
}
export function createGitHubClient(options) {
    return new GitHubClient(options);
}
//# sourceMappingURL=client.js.map