import { Octokit } from '@octokit/rest';
import { logger, getCorrelationId, timeOperation, recordPhaseOperation, recordPhaseError, DEFAULT_TIMING_THRESHOLD_MS, } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { GitHubError, ErrorCode, createGitHubErrorFromResponse, withRetry, StructuredError, } from '../utils/errors.js';
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
export class GitHubClient {
    octokit;
    owner;
    repo;
    retryConfig;
    circuitBreakerConfig;
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
    log = logger.child('GitHubClient');
    constructor(options) {
        this.octokit = new Octokit({ auth: options.token });
        this.owner = options.owner;
        this.repo = options.repo;
        this.retryConfig = { ...DEFAULT_GITHUB_RETRY_CONFIG, ...options.retryConfig };
        this.circuitBreakerConfig = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...options.circuitBreakerConfig };
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
        };
    }
    /**
     * Get the current rate limit state
     */
    getRateLimitState() {
        return { ...this.rateLimitState };
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
     * Execute a GitHub API request with automatic retry for transient failures
     * Integrates with circuit breaker for graceful degradation
     */
    async executeWithRetry(operation, endpoint, context) {
        const startTime = Date.now();
        const correlationId = getCorrelationId();
        const method = this.extractMethodFromEndpoint(endpoint);
        const repository = `${this.owner}/${this.repo}`;
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
            const timedResult = await timeOperation(() => withRetry(operation, {
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
            }), `github:${endpoint}`);
            // Success - record it
            this.recordSuccess();
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
            const statusCode = error.status ?? error.response?.status;
            // Failure - record it and update rate limit state
            this.updateRateLimitState(error);
            this.recordFailure(error);
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
     * Get repository info
     */
    async getRepo() {
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
}
export function createGitHubClient(options) {
    return new GitHubClient(options);
}
//# sourceMappingURL=client.js.map