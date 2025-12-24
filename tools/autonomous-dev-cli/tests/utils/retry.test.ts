/**
 * Tests for the retry utilities module.
 * Covers exponential backoff, error classification, and retry context management.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import {
  retryWithBackoff,
  retryWithBackoffDetailed,
  calculateBackoffDelay,
  calculateProgressiveTimeout,
  createRetryContext,
  updateRetryContext,
  markContextFailed,
  classifyError,
  isErrorCodeRetryable,
  isHttpStatusRetryable,
  isNetworkErrorRetryable,
  extractHttpStatus,
  extractNetworkErrorCode,
  extractRetryAfterMs,
  createClaudeErrorFromResponse,
  isClaudeErrorRetryable,
  API_RETRY_CONFIG,
  NETWORK_RETRY_CONFIG,
  RATE_LIMIT_RETRY_CONFIG,
  CLAUDE_RETRY_CONFIG,
  DATABASE_RETRY_CONFIG,
  type ExtendedRetryConfig,
  type RetryContext,
  type RetryAttemptRecord,
} from '../../src/utils/retry.js';
import { ErrorCode, StructuredError, ClaudeError } from '../../src/utils/errors.js';

describe('calculateBackoffDelay', () => {
  const defaultConfig: ExtendedRetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitter: false,
  };

  it('should calculate exponential delay', () => {
    const delay0 = calculateBackoffDelay(0, defaultConfig);
    const delay1 = calculateBackoffDelay(1, defaultConfig);
    const delay2 = calculateBackoffDelay(2, defaultConfig);

    assert.strictEqual(delay0, 1000);
    assert.strictEqual(delay1, 2000);
    assert.strictEqual(delay2, 4000);
  });

  it('should cap delay at maxDelayMs', () => {
    const delay = calculateBackoffDelay(10, defaultConfig);

    assert.strictEqual(delay, 30000);
  });

  it('should add jitter when enabled', () => {
    const configWithJitter: ExtendedRetryConfig = {
      ...defaultConfig,
      jitter: true,
      jitterFactor: 0.1,
    };

    const delays = new Set<number>();
    for (let i = 0; i < 10; i++) {
      delays.add(calculateBackoffDelay(0, configWithJitter));
    }

    // With jitter, we should get different values
    assert.ok(delays.size > 1, 'Jitter should produce varying delays');
  });

  it('should use default jitter factor', () => {
    const configWithJitter: ExtendedRetryConfig = {
      ...defaultConfig,
      jitter: true,
    };

    const delay = calculateBackoffDelay(0, configWithJitter);

    // Should be within ±10% of base
    assert.ok(delay >= 900 && delay <= 1100);
  });

  it('should handle zero base delay', () => {
    const config: ExtendedRetryConfig = {
      ...defaultConfig,
      baseDelayMs: 0,
    };

    const delay = calculateBackoffDelay(0, config);

    assert.strictEqual(delay, 0);
  });
});

describe('calculateProgressiveTimeout', () => {
  const config: ExtendedRetryConfig = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    progressiveTimeout: true,
    timeoutIncreaseFactor: 1.5,
    initialTimeoutMs: 30000,
    maxTimeoutMs: 120000,
  };

  it('should increase timeout with each attempt', () => {
    const timeout0 = calculateProgressiveTimeout(0, config);
    const timeout1 = calculateProgressiveTimeout(1, config);
    const timeout2 = calculateProgressiveTimeout(2, config);

    assert.strictEqual(timeout0, 30000);
    assert.strictEqual(timeout1, 45000);
    assert.strictEqual(timeout2, 67500);
  });

  it('should cap at maxTimeoutMs', () => {
    const timeout = calculateProgressiveTimeout(10, config);

    assert.strictEqual(timeout, 120000);
  });

  it('should return initial timeout when progressive is disabled', () => {
    const configDisabled: ExtendedRetryConfig = {
      ...config,
      progressiveTimeout: false,
    };

    const timeout = calculateProgressiveTimeout(5, configDisabled);

    assert.strictEqual(timeout, 30000);
  });

  it('should use default values when not specified', () => {
    const minimalConfig: ExtendedRetryConfig = {
      maxRetries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30000,
      backoffMultiplier: 2,
    };

    const timeout = calculateProgressiveTimeout(0, minimalConfig);

    assert.strictEqual(timeout, 30000);
  });
});

describe('createRetryContext', () => {
  it('should create initial context', () => {
    const context = createRetryContext(API_RETRY_CONFIG);

    assert.strictEqual(context.attempt, 0);
    assert.strictEqual(context.maxRetries, API_RETRY_CONFIG.maxRetries);
    assert.ok(context.firstAttemptAt instanceof Date);
    assert.strictEqual(context.elapsedMs, 0);
    assert.deepStrictEqual(context.attemptHistory, []);
    assert.strictEqual(context.permanentlyFailed, false);
  });

  it('should use config max retries', () => {
    const context = createRetryContext(NETWORK_RETRY_CONFIG);

    assert.strictEqual(context.maxRetries, NETWORK_RETRY_CONFIG.maxRetries);
  });
});

describe('updateRetryContext', () => {
  it('should update context with attempt info', () => {
    const context = createRetryContext(API_RETRY_CONFIG);
    const error = new Error('Test error');
    const classification = { isRetryable: true, errorType: 'network' as const };

    updateRetryContext(context, API_RETRY_CONFIG, error, 1000, classification);

    assert.strictEqual(context.attempt, 1);
    assert.ok(context.elapsedMs >= 0);
    assert.strictEqual(context.attemptHistory.length, 1);
  });

  it('should record attempt in history', () => {
    const context = createRetryContext(API_RETRY_CONFIG);
    const error = new StructuredError(ErrorCode.NETWORK_ERROR, 'Network failed');
    const classification = { isRetryable: true, errorType: 'structured' as const };

    updateRetryContext(context, API_RETRY_CONFIG, error, 2000, classification);

    const record = context.attemptHistory[0];
    assert.strictEqual(record.attempt, 1);
    assert.strictEqual(record.errorMessage, 'Network failed');
    assert.strictEqual(record.delayMs, 2000);
    assert.strictEqual(record.classification.isRetryable, true);
  });
});

describe('markContextFailed', () => {
  it('should mark context as permanently failed', () => {
    const context = createRetryContext(API_RETRY_CONFIG);
    const error = new Error('Final error');

    markContextFailed(context, error);

    assert.strictEqual(context.permanentlyFailed, true);
    assert.strictEqual(context.finalError, error);
  });
});

describe('isErrorCodeRetryable', () => {
  it('should return true for retryable error codes', () => {
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.GITHUB_RATE_LIMITED), true);
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.NETWORK_ERROR), true);
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.CLAUDE_TIMEOUT), true);
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.GITHUB_NETWORK_ERROR), true);
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.DB_CONNECTION_FAILED), true);
  });

  it('should return false for non-retryable error codes', () => {
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.GITHUB_AUTH_FAILED), false);
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.CONFIG_INVALID), false);
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.GITHUB_REPO_NOT_FOUND), false);
    assert.strictEqual(isErrorCodeRetryable(ErrorCode.CLAUDE_INVALID_RESPONSE), false);
  });

  it('should return false for unknown codes', () => {
    assert.strictEqual(isErrorCodeRetryable('UNKNOWN_CODE' as ErrorCode), false);
  });
});

describe('isHttpStatusRetryable', () => {
  it('should return true for retryable status codes', () => {
    assert.strictEqual(isHttpStatusRetryable(408), true);
    assert.strictEqual(isHttpStatusRetryable(429), true);
    assert.strictEqual(isHttpStatusRetryable(500), true);
    assert.strictEqual(isHttpStatusRetryable(502), true);
    assert.strictEqual(isHttpStatusRetryable(503), true);
    assert.strictEqual(isHttpStatusRetryable(504), true);
  });

  it('should return false for non-retryable status codes', () => {
    assert.strictEqual(isHttpStatusRetryable(400), false);
    assert.strictEqual(isHttpStatusRetryable(401), false);
    assert.strictEqual(isHttpStatusRetryable(403), false);
    assert.strictEqual(isHttpStatusRetryable(404), false);
    assert.strictEqual(isHttpStatusRetryable(409), false);
    assert.strictEqual(isHttpStatusRetryable(422), false);
  });

  it('should return true for 5xx codes not in list', () => {
    assert.strictEqual(isHttpStatusRetryable(507), true);
    assert.strictEqual(isHttpStatusRetryable(599), true);
  });
});

describe('isNetworkErrorRetryable', () => {
  it('should return true for network error codes', () => {
    assert.strictEqual(isNetworkErrorRetryable('ENOTFOUND'), true);
    assert.strictEqual(isNetworkErrorRetryable('ETIMEDOUT'), true);
    assert.strictEqual(isNetworkErrorRetryable('ECONNRESET'), true);
    assert.strictEqual(isNetworkErrorRetryable('ECONNREFUSED'), true);
    assert.strictEqual(isNetworkErrorRetryable('EPIPE'), true);
  });

  it('should be case-insensitive', () => {
    assert.strictEqual(isNetworkErrorRetryable('enotfound'), true);
    assert.strictEqual(isNetworkErrorRetryable('ENotFound'), true);
  });

  it('should return false for unknown codes', () => {
    assert.strictEqual(isNetworkErrorRetryable('UNKNOWN'), false);
    assert.strictEqual(isNetworkErrorRetryable('EPERM'), false);
  });
});

describe('extractHttpStatus', () => {
  it('should extract status from error.status', () => {
    const error = { status: 404 };
    assert.strictEqual(extractHttpStatus(error), 404);
  });

  it('should extract status from error.response.status', () => {
    const error = { response: { status: 500 } };
    assert.strictEqual(extractHttpStatus(error), 500);
  });

  it('should extract status from error.statusCode', () => {
    const error = { statusCode: 403 };
    assert.strictEqual(extractHttpStatus(error), 403);
  });

  it('should return undefined for errors without status', () => {
    assert.strictEqual(extractHttpStatus(new Error('No status')), undefined);
    assert.strictEqual(extractHttpStatus(null), undefined);
    assert.strictEqual(extractHttpStatus(undefined), undefined);
    assert.strictEqual(extractHttpStatus('string error'), undefined);
  });
});

describe('extractNetworkErrorCode', () => {
  it('should extract code from error.code', () => {
    const error = { code: 'ECONNREFUSED' };
    assert.strictEqual(extractNetworkErrorCode(error), 'ECONNREFUSED');
  });

  it('should extract code from error.cause.code', () => {
    const error = { cause: { code: 'ETIMEDOUT' } };
    assert.strictEqual(extractNetworkErrorCode(error), 'ETIMEDOUT');
  });

  it('should return undefined for errors without code', () => {
    assert.strictEqual(extractNetworkErrorCode(new Error('No code')), undefined);
    assert.strictEqual(extractNetworkErrorCode(null), undefined);
  });
});

describe('extractRetryAfterMs', () => {
  it('should extract from retry-after header (seconds)', () => {
    const error = {
      response: {
        headers: { 'retry-after': '60' },
      },
    };
    assert.strictEqual(extractRetryAfterMs(error), 60000);
  });

  it('should extract from Retry-After header (seconds as number)', () => {
    const error = {
      headers: { 'Retry-After': 30 },
    };
    assert.strictEqual(extractRetryAfterMs(error), 30000);
  });

  it('should extract from x-ratelimit-reset header', () => {
    const futureTime = Math.floor(Date.now() / 1000) + 60;
    const error = {
      headers: { 'x-ratelimit-reset': String(futureTime) },
    };
    const result = extractRetryAfterMs(error);
    assert.ok(result !== undefined && result > 50000 && result < 70000);
  });

  it('should return undefined when no headers', () => {
    assert.strictEqual(extractRetryAfterMs(new Error('No headers')), undefined);
  });
});

describe('classifyError', () => {
  it('should classify StructuredError', () => {
    const error = new StructuredError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limited');
    const result = classifyError(error);

    assert.strictEqual(result.errorType, 'structured');
    assert.strictEqual(result.isRetryable, true);
  });

  it('should classify HTTP errors', () => {
    const error = { status: 503, message: 'Service unavailable' };
    const result = classifyError(error);

    assert.strictEqual(result.errorType, 'http');
    assert.strictEqual(result.isRetryable, true);
  });

  it('should classify network errors', () => {
    const error = { code: 'ECONNRESET', message: 'Connection reset' };
    const result = classifyError(error);

    assert.strictEqual(result.errorType, 'network');
    assert.strictEqual(result.isRetryable, true);
  });

  it('should classify errors by message patterns', () => {
    const timeoutError = new Error('Connection timeout');
    assert.strictEqual(classifyError(timeoutError).isRetryable, true);

    const networkError = new Error('Network error occurred');
    assert.strictEqual(classifyError(networkError).isRetryable, true);

    const authError = new Error('Unauthorized access');
    assert.strictEqual(classifyError(authError).isRetryable, false);
  });

  it('should return unknown for unclassifiable errors', () => {
    const error = new Error('Some random error');
    const result = classifyError(error);

    assert.strictEqual(result.errorType, 'unknown');
    assert.strictEqual(result.isRetryable, false);
  });
});

describe('retryWithBackoff', () => {
  it('should succeed on first attempt', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(async () => {
      attempts++;
      return 'success';
    });

    assert.strictEqual(result, 'success');
    assert.strictEqual(attempts, 1);
  });

  it('should retry on retryable error', async () => {
    let attempts = 0;
    const result = await retryWithBackoff(
      async () => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('Temporary error');
          error.status = 503;
          throw error;
        }
        return 'success';
      },
      {
        config: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
      }
    );

    assert.strictEqual(result, 'success');
    assert.strictEqual(attempts, 3);
  });

  it('should not retry on non-retryable error', async () => {
    let attempts = 0;

    await assert.rejects(
      async () => {
        await retryWithBackoff(
          async () => {
            attempts++;
            const error: any = new Error('Auth failed');
            error.status = 401;
            throw error;
          },
          {
            config: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
          }
        );
      },
      /Auth failed/
    );

    assert.strictEqual(attempts, 1);
  });

  it('should call onRetry callback', async () => {
    const retryCalls: Array<{ attempt: number; delay: number }> = [];

    await retryWithBackoff(
      async (context) => {
        if (context.attempt < 2) {
          const error: any = new Error('Error');
          error.status = 500;
          throw error;
        }
        return 'done';
      },
      {
        config: { maxRetries: 3, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
        onRetry: (error, attempt, delay) => {
          retryCalls.push({ attempt, delay });
        },
      }
    );

    assert.strictEqual(retryCalls.length, 2);
    assert.strictEqual(retryCalls[0].attempt, 1);
    assert.strictEqual(retryCalls[1].attempt, 2);
  });

  it('should call onExhausted callback', async () => {
    let exhaustedCalled = false;
    let exhaustedContext: RetryContext | undefined;

    await assert.rejects(async () => {
      await retryWithBackoff(
        async () => {
          const error: any = new Error('Always fails');
          error.status = 500;
          throw error;
        },
        {
          config: { maxRetries: 2, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
          onExhausted: (error, context) => {
            exhaustedCalled = true;
            exhaustedContext = context;
          },
        }
      );
    });

    assert.strictEqual(exhaustedCalled, true);
    assert.ok(exhaustedContext);
    assert.strictEqual(exhaustedContext?.permanentlyFailed, true);
  });

  it('should respect custom shouldRetry function', async () => {
    let attempts = 0;

    await assert.rejects(async () => {
      await retryWithBackoff(
        async () => {
          attempts++;
          throw new Error('Custom error');
        },
        {
          config: { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
          shouldRetry: (error) => error.message === 'Retry me',
        }
      );
    });

    assert.strictEqual(attempts, 1);
  });

  it('should respect abort signal', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      async () => {
        await retryWithBackoff(
          async () => 'success',
          {
            abortSignal: controller.signal,
          }
        );
      },
      /aborted/
    );
  });

  it('should use retryAfterMs from error', async () => {
    let attempts = 0;
    const startTime = Date.now();

    await retryWithBackoff(
      async () => {
        attempts++;
        if (attempts < 2) {
          const error: any = new Error('Rate limited');
          error.status = 429;
          error.headers = { 'retry-after': '0.05' }; // 50ms
          throw error;
        }
        return 'done';
      },
      {
        config: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 5000, backoffMultiplier: 2 },
      }
    );

    const elapsed = Date.now() - startTime;
    // Should use retry-after delay (50ms) instead of base delay (1000ms)
    assert.ok(elapsed < 500, `Should be quick, but took ${elapsed}ms`);
  });
});

describe('retryWithBackoffDetailed', () => {
  it('should return result with context', async () => {
    const result = await retryWithBackoffDetailed(async () => 'value');

    assert.strictEqual(result.result, 'value');
    assert.ok(result.context);
    assert.strictEqual(result.totalAttempts, 1);
    assert.ok(result.totalDurationMs >= 0);
  });

  it('should track multiple attempts', async () => {
    let attempts = 0;

    const result = await retryWithBackoffDetailed(
      async () => {
        attempts++;
        if (attempts < 3) {
          const error: any = new Error('Error');
          error.status = 500;
          throw error;
        }
        return 'done';
      },
      {
        config: { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 100, backoffMultiplier: 2 },
      }
    );

    assert.strictEqual(result.totalAttempts, 3);
    assert.ok(result.context.attemptHistory.length > 0);
  });
});

describe('createClaudeErrorFromResponse', () => {
  it('should create auth error for 401', () => {
    const error = { status: 401, message: 'Unauthorized' };
    const result = createClaudeErrorFromResponse(error);

    assert.strictEqual(result.code, ErrorCode.CLAUDE_AUTH_FAILED);
    assert.ok(result instanceof ClaudeError);
  });

  it('should create quota error for 429', () => {
    const error = { status: 429, message: 'Rate limit exceeded' };
    const result = createClaudeErrorFromResponse(error);

    assert.strictEqual(result.code, ErrorCode.CLAUDE_QUOTA_EXCEEDED);
  });

  it('should create timeout error for 504', () => {
    const error = { status: 504, message: 'Gateway timeout' };
    const result = createClaudeErrorFromResponse(error);

    assert.strictEqual(result.code, ErrorCode.CLAUDE_TIMEOUT);
  });

  it('should create network error for network codes', () => {
    const error = { code: 'ECONNRESET', message: 'Connection reset' };
    const result = createClaudeErrorFromResponse(error);

    assert.strictEqual(result.code, ErrorCode.NETWORK_ERROR);
  });

  it('should include context', () => {
    const error = { status: 500, message: 'Server error' };
    const result = createClaudeErrorFromResponse(error, { operation: 'test' });

    assert.strictEqual(result.context.operation, 'test');
  });
});

describe('isClaudeErrorRetryable', () => {
  it('should return true for 429', () => {
    const error = { status: 429 };
    assert.strictEqual(isClaudeErrorRetryable(error), true);
  });

  it('should return true for 5xx', () => {
    assert.strictEqual(isClaudeErrorRetryable({ status: 500 }), true);
    assert.strictEqual(isClaudeErrorRetryable({ status: 502 }), true);
    assert.strictEqual(isClaudeErrorRetryable({ status: 503 }), true);
  });

  it('should return true for network errors', () => {
    assert.strictEqual(isClaudeErrorRetryable({ code: 'ETIMEDOUT' }), true);
    assert.strictEqual(isClaudeErrorRetryable({ code: 'ECONNRESET' }), true);
  });

  it('should return true for timeout message', () => {
    assert.strictEqual(isClaudeErrorRetryable(new Error('Request timeout')), true);
    assert.strictEqual(isClaudeErrorRetryable(new Error('Connection timeout')), true);
  });

  it('should return false for auth errors', () => {
    assert.strictEqual(isClaudeErrorRetryable({ status: 401 }), false);
    assert.strictEqual(isClaudeErrorRetryable({ status: 403 }), false);
  });

  it('should return false for validation errors', () => {
    assert.strictEqual(isClaudeErrorRetryable({ status: 400 }), false);
    assert.strictEqual(isClaudeErrorRetryable({ status: 422 }), false);
  });
});

describe('Retry Config Presets', () => {
  it('should have API_RETRY_CONFIG preset', () => {
    assert.ok(API_RETRY_CONFIG.maxRetries >= 1);
    assert.ok(API_RETRY_CONFIG.baseDelayMs > 0);
    assert.ok(API_RETRY_CONFIG.maxDelayMs >= API_RETRY_CONFIG.baseDelayMs);
  });

  it('should have NETWORK_RETRY_CONFIG preset', () => {
    assert.ok(NETWORK_RETRY_CONFIG.maxRetries >= 1);
    assert.ok(NETWORK_RETRY_CONFIG.maxTimeoutMs! > NETWORK_RETRY_CONFIG.initialTimeoutMs!);
  });

  it('should have RATE_LIMIT_RETRY_CONFIG preset', () => {
    assert.ok(RATE_LIMIT_RETRY_CONFIG.maxRetries >= 3);
    assert.ok(RATE_LIMIT_RETRY_CONFIG.maxDelayMs >= 60000);
  });

  it('should have CLAUDE_RETRY_CONFIG preset', () => {
    assert.ok(CLAUDE_RETRY_CONFIG.initialTimeoutMs! >= 60000);
    assert.ok(CLAUDE_RETRY_CONFIG.maxTimeoutMs! >= 300000);
  });

  it('should have DATABASE_RETRY_CONFIG preset', () => {
    assert.ok(DATABASE_RETRY_CONFIG.maxRetries >= 1);
    assert.ok(DATABASE_RETRY_CONFIG.baseDelayMs <= 1000);
  });
});
