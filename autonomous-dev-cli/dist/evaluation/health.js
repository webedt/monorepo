import { logger, getCorrelationId, createOperationContext, finalizeOperationContext, startPhase, endPhase, recordPhaseOperation, recordPhaseError, } from '../utils/logger.js';
export async function runHealthChecks(options) {
    const { urls, timeout = 10000, expectedStatus = 200, retries = 2, retryDelay = 1000, concurrency = 5, parallel = true, } = options;
    const startTime = Date.now();
    const correlationId = getCorrelationId();
    // Start evaluation phase if tracking
    if (correlationId) {
        startPhase(correlationId, 'evaluation', {
            operation: 'healthCheck',
            urlCount: urls.length,
            parallel,
        });
        recordPhaseOperation(correlationId, 'evaluation', 'runHealthChecks');
    }
    // Create operation context for structured logging
    const operationContext = createOperationContext('HealthCheck', 'runHealthChecks', {
        urlCount: urls.length,
        timeout,
        expectedStatus,
        retries,
        parallel,
        concurrency,
    });
    if (urls.length === 0) {
        logger.info('No health check URLs configured, skipping', { correlationId });
        // End phase successfully for empty checks
        if (correlationId) {
            endPhase(correlationId, 'evaluation', true, {
                operation: 'healthCheck',
                skipped: true,
            });
        }
        return {
            success: true,
            checks: [],
            duration: 0,
        };
    }
    const checkOptions = { timeout, expectedStatus, retries, retryDelay };
    if (parallel) {
        logger.info(`Running ${urls.length} health check(s) in parallel (concurrency: ${concurrency})...`, {
            correlationId,
            urlCount: urls.length,
            concurrency,
        });
        const result = await runParallelHealthChecks(urls, checkOptions, concurrency, startTime);
        // End phase and log completion
        const passedCount = result.checks.filter(c => c.ok).length;
        const failedCount = result.checks.filter(c => !c.ok).length;
        if (correlationId) {
            if (result.success) {
                endPhase(correlationId, 'evaluation', true, {
                    operation: 'healthCheck',
                    passed: passedCount,
                    failed: failedCount,
                    duration: result.duration,
                });
            }
            else {
                recordPhaseError(correlationId, 'evaluation', 'HEALTH_CHECK_FAILED');
                endPhase(correlationId, 'evaluation', false, {
                    operation: 'healthCheck',
                    passed: passedCount,
                    failed: failedCount,
                    duration: result.duration,
                });
            }
        }
        const operationMetadata = finalizeOperationContext(operationContext, result.success, {
            passed: passedCount,
            failed: failedCount,
            duration: result.duration,
        });
        logger.operationComplete('HealthCheck', 'runHealthChecks', result.success, operationMetadata);
        return result;
    }
    else {
        logger.info(`Running ${urls.length} health check(s) sequentially...`, {
            correlationId,
            urlCount: urls.length,
        });
        const result = await runSequentialHealthChecks(urls, checkOptions, startTime);
        // End phase and log completion
        const passedCount = result.checks.filter(c => c.ok).length;
        const failedCount = result.checks.filter(c => !c.ok).length;
        if (correlationId) {
            if (result.success) {
                endPhase(correlationId, 'evaluation', true, {
                    operation: 'healthCheck',
                    passed: passedCount,
                    failed: failedCount,
                    duration: result.duration,
                });
            }
            else {
                recordPhaseError(correlationId, 'evaluation', 'HEALTH_CHECK_FAILED');
                endPhase(correlationId, 'evaluation', false, {
                    operation: 'healthCheck',
                    passed: passedCount,
                    failed: failedCount,
                    duration: result.duration,
                });
            }
        }
        const operationMetadata = finalizeOperationContext(operationContext, result.success, {
            passed: passedCount,
            failed: failedCount,
            duration: result.duration,
        });
        logger.operationComplete('HealthCheck', 'runHealthChecks', result.success, operationMetadata);
        return result;
    }
}
/**
 * Run health checks sequentially (original behavior)
 */
async function runSequentialHealthChecks(urls, options, startTime) {
    const checks = [];
    let allPassed = true;
    for (const url of urls) {
        const check = await checkUrl(url, options);
        checks.push(check);
        if (check.ok) {
            logger.success(`Health check passed: ${url} (${check.status}, ${check.responseTime}ms)`);
        }
        else {
            logger.failure(`Health check failed: ${url} - ${check.error || `Status ${check.status}`}`);
            allPassed = false;
        }
    }
    return {
        success: allPassed,
        checks,
        duration: Date.now() - startTime,
    };
}
/**
 * Run health checks in parallel with configurable concurrency
 * Uses a semaphore pattern for true concurrent execution with limits
 */
async function runParallelHealthChecks(urls, options, concurrency, startTime) {
    // Create a semaphore to limit concurrent requests
    let activeCount = 0;
    const waiting = [];
    const acquire = () => {
        if (activeCount < concurrency) {
            activeCount++;
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            waiting.push(resolve);
        });
    };
    const release = () => {
        activeCount--;
        const next = waiting.shift();
        if (next) {
            activeCount++;
            next();
        }
    };
    // Execute all health checks in parallel with semaphore-controlled concurrency
    const checkPromises = urls.map(async (url) => {
        await acquire();
        try {
            const check = await checkUrl(url, options);
            if (check.ok) {
                logger.success(`Health check passed: ${url} (${check.status}, ${check.responseTime}ms)`);
            }
            else {
                logger.failure(`Health check failed: ${url} - ${check.error || `Status ${check.status}`}`);
            }
            return check;
        }
        finally {
            release();
        }
    });
    // Wait for all checks to complete in parallel
    const checks = await Promise.all(checkPromises);
    const allPassed = checks.every((check) => check.ok);
    return {
        success: allPassed,
        checks,
        duration: Date.now() - startTime,
    };
}
async function checkUrl(url, options) {
    const { timeout, expectedStatus, retries, retryDelay } = options;
    let lastError;
    let lastStatus = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        if (attempt > 0) {
            logger.debug(`Retrying health check for ${url} (attempt ${attempt + 1}/${retries + 1})`);
            await sleep(retryDelay);
        }
        const startTime = Date.now();
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeout);
            const response = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: {
                    'User-Agent': 'AutonomousDev-HealthCheck/1.0',
                    'Accept': 'text/html,application/json,*/*',
                },
            });
            clearTimeout(timeoutId);
            const responseTime = Date.now() - startTime;
            lastStatus = response.status;
            if (response.status === expectedStatus) {
                return {
                    url,
                    status: response.status,
                    ok: true,
                    responseTime,
                };
            }
            lastError = `Expected status ${expectedStatus}, got ${response.status}`;
        }
        catch (error) {
            const responseTime = Date.now() - startTime;
            if (error.name === 'AbortError') {
                lastError = `Request timed out after ${timeout}ms`;
            }
            else {
                lastError = error.message || 'Unknown error';
            }
            if (attempt === retries) {
                return {
                    url,
                    status: null,
                    ok: false,
                    responseTime,
                    error: lastError,
                };
            }
        }
    }
    return {
        url,
        status: lastStatus,
        ok: false,
        responseTime: 0,
        error: lastError,
    };
}
// Generate preview URL from pattern
export function generatePreviewUrl(pattern, params) {
    return pattern
        .replace('{owner}', params.owner)
        .replace('{repo}', params.repo)
        .replace('{branch}', params.branch.replace(/\//g, '-')); // Replace / with - in branch names
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
//# sourceMappingURL=health.js.map