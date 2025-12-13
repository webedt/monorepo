import { logger } from '../utils/logger.js';

export interface HealthCheckResult {
  success: boolean;
  checks: HealthCheck[];
  duration: number;
}

export interface HealthCheck {
  url: string;
  status: number | null;
  ok: boolean;
  responseTime: number;
  error?: string;
}

export interface HealthCheckOptions {
  urls: string[];
  timeout?: number; // Per-request timeout in ms (default: 10 seconds)
  expectedStatus?: number; // Expected HTTP status (default: 200)
  retries?: number; // Number of retries (default: 2)
  retryDelay?: number; // Delay between retries in ms (default: 1000)
  concurrency?: number; // Max concurrent checks (default: 5)
  parallel?: boolean; // Run checks in parallel (default: true)
}

export async function runHealthChecks(options: HealthCheckOptions): Promise<HealthCheckResult> {
  const {
    urls,
    timeout = 10000,
    expectedStatus = 200,
    retries = 2,
    retryDelay = 1000,
    concurrency = 5,
    parallel = true,
  } = options;

  const startTime = Date.now();

  if (urls.length === 0) {
    logger.info('No health check URLs configured, skipping');
    return {
      success: true,
      checks: [],
      duration: 0,
    };
  }

  const checkOptions = { timeout, expectedStatus, retries, retryDelay };

  if (parallel) {
    logger.info(`Running ${urls.length} health check(s) in parallel (concurrency: ${concurrency})...`);
    return runParallelHealthChecks(urls, checkOptions, concurrency, startTime);
  } else {
    logger.info(`Running ${urls.length} health check(s) sequentially...`);
    return runSequentialHealthChecks(urls, checkOptions, startTime);
  }
}

/**
 * Run health checks sequentially (original behavior)
 */
async function runSequentialHealthChecks(
  urls: string[],
  options: { timeout: number; expectedStatus: number; retries: number; retryDelay: number },
  startTime: number
): Promise<HealthCheckResult> {
  const checks: HealthCheck[] = [];
  let allPassed = true;

  for (const url of urls) {
    const check = await checkUrl(url, options);
    checks.push(check);

    if (check.ok) {
      logger.success(`Health check passed: ${url} (${check.status}, ${check.responseTime}ms)`);
    } else {
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
 * Uses a worker pool pattern to limit concurrent requests
 */
async function runParallelHealthChecks(
  urls: string[],
  options: { timeout: number; expectedStatus: number; retries: number; retryDelay: number },
  concurrency: number,
  startTime: number
): Promise<HealthCheckResult> {
  const checks: HealthCheck[] = [];
  let allPassed = true;

  // Process URLs in batches based on concurrency limit
  const batches: string[][] = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    batches.push(urls.slice(i, i + concurrency));
  }

  for (const batch of batches) {
    // Run batch of checks concurrently
    const batchPromises = batch.map(async (url) => {
      const check = await checkUrl(url, options);

      if (check.ok) {
        logger.success(`Health check passed: ${url} (${check.status}, ${check.responseTime}ms)`);
      } else {
        logger.failure(`Health check failed: ${url} - ${check.error || `Status ${check.status}`}`);
      }

      return check;
    });

    const batchResults = await Promise.all(batchPromises);

    for (const check of batchResults) {
      checks.push(check);
      if (!check.ok) {
        allPassed = false;
      }
    }
  }

  return {
    success: allPassed,
    checks,
    duration: Date.now() - startTime,
  };
}

async function checkUrl(
  url: string,
  options: {
    timeout: number;
    expectedStatus: number;
    retries: number;
    retryDelay: number;
  }
): Promise<HealthCheck> {
  const { timeout, expectedStatus, retries, retryDelay } = options;

  let lastError: string | undefined;
  let lastStatus: number | null = null;

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
    } catch (error: any) {
      const responseTime = Date.now() - startTime;

      if (error.name === 'AbortError') {
        lastError = `Request timed out after ${timeout}ms`;
      } else {
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
export function generatePreviewUrl(
  pattern: string,
  params: { owner: string; repo: string; branch: string }
): string {
  return pattern
    .replace('{owner}', params.owner)
    .replace('{repo}', params.repo)
    .replace('{branch}', params.branch.replace(/\//g, '-')); // Replace / with - in branch names
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
