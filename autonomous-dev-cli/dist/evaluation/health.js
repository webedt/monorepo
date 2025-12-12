import { logger } from '../utils/logger.js';
export async function runHealthChecks(options) {
    const { urls, timeout = 10000, expectedStatus = 200, retries = 2, retryDelay = 1000, } = options;
    const startTime = Date.now();
    if (urls.length === 0) {
        logger.info('No health check URLs configured, skipping');
        return {
            success: true,
            checks: [],
            duration: 0,
        };
    }
    logger.info(`Running health checks for ${urls.length} URL(s)...`);
    const checks = [];
    let allPassed = true;
    for (const url of urls) {
        const check = await checkUrl(url, { timeout, expectedStatus, retries, retryDelay });
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