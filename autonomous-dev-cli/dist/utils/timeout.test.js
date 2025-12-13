import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { DEFAULT_TIMEOUTS, TIMEOUT_ENV_VARS, getTimeoutFromEnv, getTimeoutConfig, TimeoutError, withTimeout, withTimeoutDetailed, withGitHubTimeout, withGitTimeout, withDatabaseTimeout, withMergeTimeout, raceWithTimeout, createTimedAbortController, withCleanup, withTimeoutAll, } from './timeout.js';
import { ErrorCode } from './errors.js';
describe('timeout utilities', () => {
    let originalEnv;
    beforeEach(() => {
        originalEnv = { ...process.env };
    });
    afterEach(() => {
        process.env = originalEnv;
    });
    describe('DEFAULT_TIMEOUTS', () => {
        it('should have correct default values', () => {
            assert.strictEqual(DEFAULT_TIMEOUTS.GITHUB_API, 30_000);
            assert.strictEqual(DEFAULT_TIMEOUTS.GIT_OPERATION, 30_000);
            assert.strictEqual(DEFAULT_TIMEOUTS.DATABASE_QUERY, 10_000);
            assert.strictEqual(DEFAULT_TIMEOUTS.PR_MERGE, 30_000);
            assert.strictEqual(DEFAULT_TIMEOUTS.EXTERNAL_OPERATION, 30_000);
        });
    });
    describe('TIMEOUT_ENV_VARS', () => {
        it('should have correct environment variable names', () => {
            assert.strictEqual(TIMEOUT_ENV_VARS.GITHUB_API, 'TIMEOUT_GITHUB_API_MS');
            assert.strictEqual(TIMEOUT_ENV_VARS.GIT_OPERATION, 'TIMEOUT_GIT_OPERATION_MS');
            assert.strictEqual(TIMEOUT_ENV_VARS.DATABASE_QUERY, 'TIMEOUT_DATABASE_QUERY_MS');
            assert.strictEqual(TIMEOUT_ENV_VARS.PR_MERGE, 'TIMEOUT_PR_MERGE_MS');
            assert.strictEqual(TIMEOUT_ENV_VARS.EXTERNAL_OPERATION, 'TIMEOUT_EXTERNAL_OPERATION_MS');
        });
    });
    describe('getTimeoutFromEnv', () => {
        it('should return default value when env var is not set', () => {
            delete process.env.TIMEOUT_GITHUB_API_MS;
            const result = getTimeoutFromEnv('GITHUB_API', 30000);
            assert.strictEqual(result, 30000);
        });
        it('should return env var value when set', () => {
            process.env.TIMEOUT_GITHUB_API_MS = '60000';
            const result = getTimeoutFromEnv('GITHUB_API', 30000);
            assert.strictEqual(result, 60000);
        });
        it('should return default when env var is invalid', () => {
            process.env.TIMEOUT_GITHUB_API_MS = 'not-a-number';
            const result = getTimeoutFromEnv('GITHUB_API', 30000);
            assert.strictEqual(result, 30000);
        });
        it('should return default when env var is negative', () => {
            process.env.TIMEOUT_GITHUB_API_MS = '-1000';
            const result = getTimeoutFromEnv('GITHUB_API', 30000);
            assert.strictEqual(result, 30000);
        });
        it('should return default when env var is zero', () => {
            process.env.TIMEOUT_GITHUB_API_MS = '0';
            const result = getTimeoutFromEnv('GITHUB_API', 30000);
            assert.strictEqual(result, 30000);
        });
    });
    describe('getTimeoutConfig', () => {
        it('should return all timeout configurations', () => {
            const config = getTimeoutConfig();
            assert.ok(config.GITHUB_API);
            assert.ok(config.GIT_OPERATION);
            assert.ok(config.DATABASE_QUERY);
            assert.ok(config.PR_MERGE);
            assert.ok(config.EXTERNAL_OPERATION);
        });
        it('should use env vars when available', () => {
            process.env.TIMEOUT_GITHUB_API_MS = '5000';
            process.env.TIMEOUT_GIT_OPERATION_MS = '10000';
            const config = getTimeoutConfig();
            assert.strictEqual(config.GITHUB_API, 5000);
            assert.strictEqual(config.GIT_OPERATION, 10000);
        });
    });
    describe('TimeoutError', () => {
        it('should create error with correct properties', () => {
            const error = new TimeoutError('testOperation', 5000);
            assert.strictEqual(error.name, 'TimeoutError');
            assert.strictEqual(error.operationName, 'testOperation');
            assert.strictEqual(error.timeoutMs, 5000);
            assert.strictEqual(error.code, ErrorCode.EXEC_TIMEOUT);
            assert.ok(error.message.includes('testOperation'));
            assert.ok(error.message.includes('5 seconds'));
        });
        it('should include context in error', () => {
            const error = new TimeoutError('testOperation', 5000, {
                context: { key: 'value' },
            });
            assert.strictEqual(error.context.key, 'value');
            assert.strictEqual(error.context.operationName, 'testOperation');
            assert.strictEqual(error.context.timeoutMs, 5000);
        });
        it('should include cause when provided', () => {
            const cause = new Error('Original error');
            const error = new TimeoutError('testOperation', 5000, { cause });
            assert.strictEqual(error.cause, cause);
        });
        it('should be retryable', () => {
            const error = new TimeoutError('testOperation', 5000);
            assert.strictEqual(error.isRetryable, true);
        });
        it('should have recovery actions', () => {
            const error = new TimeoutError('testOperation', 5000);
            assert.ok(error.recoveryActions);
            assert.ok(error.recoveryActions.length > 0);
        });
    });
    describe('withTimeout', () => {
        it('should complete operation before timeout', async () => {
            const result = await withTimeout(async () => 'success', { timeoutMs: 1000, operationName: 'test' });
            assert.strictEqual(result, 'success');
        });
        it('should throw TimeoutError when operation times out', async () => {
            await assert.rejects(async () => {
                await withTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, { timeoutMs: 50, operationName: 'slowOperation' });
            }, (error) => {
                assert.ok(error instanceof TimeoutError);
                assert.strictEqual(error.operationName, 'slowOperation');
                return true;
            });
        });
        it('should pass abort signal to operation', async () => {
            let signalReceived = null;
            await withTimeout(async (signal) => {
                signalReceived = signal;
                return 'done';
            }, { timeoutMs: 1000, operationName: 'test' });
            assert.ok(signalReceived);
            assert.ok(signalReceived instanceof AbortSignal);
        });
        it('should call onTimeout callback', async () => {
            let callbackCalled = false;
            let callbackTimeoutMs = 0;
            let callbackOperationName = '';
            try {
                await withTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, {
                    timeoutMs: 50,
                    operationName: 'testOp',
                    onTimeout: (timeoutMs, operationName) => {
                        callbackCalled = true;
                        callbackTimeoutMs = timeoutMs;
                        callbackOperationName = operationName;
                    },
                });
            }
            catch {
                // Expected to throw
            }
            assert.strictEqual(callbackCalled, true);
            assert.strictEqual(callbackTimeoutMs, 50);
            assert.strictEqual(callbackOperationName, 'testOp');
        });
        it('should call cleanup on success', async () => {
            let cleanupCalled = false;
            await withTimeout(async () => 'success', {
                timeoutMs: 1000,
                operationName: 'test',
                cleanup: () => { cleanupCalled = true; },
            });
            assert.strictEqual(cleanupCalled, true);
        });
        it('should call cleanup on timeout', async () => {
            let cleanupCalled = false;
            try {
                await withTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, {
                    timeoutMs: 50,
                    operationName: 'test',
                    cleanup: () => { cleanupCalled = true; },
                });
            }
            catch {
                // Expected
            }
            assert.strictEqual(cleanupCalled, true);
        });
        it('should call cleanup on error', async () => {
            let cleanupCalled = false;
            try {
                await withTimeout(async () => { throw new Error('Operation failed'); }, {
                    timeoutMs: 1000,
                    operationName: 'test',
                    cleanup: () => { cleanupCalled = true; },
                });
            }
            catch {
                // Expected
            }
            assert.strictEqual(cleanupCalled, true);
        });
        it('should re-throw non-timeout errors', async () => {
            await assert.rejects(async () => {
                await withTimeout(async () => { throw new Error('Custom error'); }, { timeoutMs: 1000, operationName: 'test' });
            }, (error) => {
                assert.strictEqual(error.message, 'Custom error');
                assert.ok(!(error instanceof TimeoutError));
                return true;
            });
        });
        it('should use provided AbortController', async () => {
            const controller = new AbortController();
            let signalReceived = null;
            await withTimeout(async (signal) => {
                signalReceived = signal;
                return 'done';
            }, {
                timeoutMs: 1000,
                operationName: 'test',
                abortController: controller,
            });
            assert.strictEqual(signalReceived, controller.signal);
        });
        it('should include context in TimeoutError', async () => {
            try {
                await withTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, {
                    timeoutMs: 50,
                    operationName: 'test',
                    context: { customKey: 'customValue' },
                });
            }
            catch (error) {
                assert.ok(error instanceof TimeoutError);
                assert.strictEqual(error.context.customKey, 'customValue');
            }
        });
    });
    describe('withTimeoutDetailed', () => {
        it('should return result with duration', async () => {
            const result = await withTimeoutDetailed(async () => 'success', { timeoutMs: 1000, operationName: 'test' });
            assert.strictEqual(result.result, 'success');
            assert.strictEqual(result.aborted, false);
            assert.ok(result.durationMs >= 0);
        });
        it('should throw TimeoutError on timeout', async () => {
            await assert.rejects(async () => {
                await withTimeoutDetailed(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, { timeoutMs: 50, operationName: 'test' });
            }, TimeoutError);
        });
    });
    describe('withGitHubTimeout', () => {
        it('should use GitHub API timeout', async () => {
            process.env.TIMEOUT_GITHUB_API_MS = '100';
            await assert.rejects(async () => {
                await withGitHubTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, 'test');
            }, (error) => {
                assert.ok(error instanceof TimeoutError);
                assert.ok(error.message.includes('GitHub API'));
                return true;
            });
        });
        it('should complete before timeout', async () => {
            const result = await withGitHubTimeout(async () => 'success', 'test');
            assert.strictEqual(result, 'success');
        });
    });
    describe('withGitTimeout', () => {
        it('should use Git operation timeout', async () => {
            process.env.TIMEOUT_GIT_OPERATION_MS = '100';
            await assert.rejects(async () => {
                await withGitTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, 'test');
            }, (error) => {
                assert.ok(error instanceof TimeoutError);
                assert.ok(error.message.includes('Git'));
                return true;
            });
        });
    });
    describe('withDatabaseTimeout', () => {
        it('should use database query timeout', async () => {
            process.env.TIMEOUT_DATABASE_QUERY_MS = '100';
            await assert.rejects(async () => {
                await withDatabaseTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, 'test');
            }, (error) => {
                assert.ok(error instanceof TimeoutError);
                assert.ok(error.message.includes('Database'));
                return true;
            });
        });
    });
    describe('withMergeTimeout', () => {
        it('should use PR merge timeout', async () => {
            process.env.TIMEOUT_PR_MERGE_MS = '100';
            await assert.rejects(async () => {
                await withMergeTimeout(async (signal) => {
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => resolve('done'), 5000);
                        signal.addEventListener('abort', () => {
                            clearTimeout(timeoutId);
                            reject(new Error('Aborted'));
                        });
                    });
                }, 'test');
            }, (error) => {
                assert.ok(error instanceof TimeoutError);
                assert.ok(error.message.includes('PR Merge'));
                return true;
            });
        });
    });
    describe('raceWithTimeout', () => {
        it('should return success when operation completes first', async () => {
            const result = await raceWithTimeout(Promise.resolve('success'), 1000, 'test');
            assert.strictEqual(result.success, true);
            if (result.success) {
                assert.strictEqual(result.result, 'success');
            }
        });
        it('should return timeout result when timeout fires first', async () => {
            const result = await raceWithTimeout(new Promise((resolve) => setTimeout(() => resolve('done'), 5000)), 50, 'test');
            assert.strictEqual(result.success, false);
            if (!result.success) {
                assert.strictEqual(result.timedOut, true);
                assert.strictEqual(result.timeoutMs, 50);
            }
        });
    });
    describe('createTimedAbortController', () => {
        it('should create controller and cleanup function', () => {
            const { controller, cleanup, isTimedOut } = createTimedAbortController(1000);
            assert.ok(controller instanceof AbortController);
            assert.ok(typeof cleanup === 'function');
            assert.ok(typeof isTimedOut === 'function');
            assert.strictEqual(isTimedOut(), false);
            cleanup();
        });
        it('should abort after timeout', async () => {
            const { controller, cleanup, isTimedOut } = createTimedAbortController(50, 'test');
            assert.strictEqual(controller.signal.aborted, false);
            assert.strictEqual(isTimedOut(), false);
            await new Promise((resolve) => setTimeout(resolve, 100));
            assert.strictEqual(controller.signal.aborted, true);
            assert.strictEqual(isTimedOut(), true);
            cleanup();
        });
        it('should not abort if cleaned up early', async () => {
            const { controller, cleanup, isTimedOut } = createTimedAbortController(100);
            cleanup();
            await new Promise((resolve) => setTimeout(resolve, 150));
            assert.strictEqual(controller.signal.aborted, false);
            assert.strictEqual(isTimedOut(), false);
        });
    });
    describe('withCleanup', () => {
        it('should call cleanup on success', async () => {
            let cleanupCalled = false;
            const result = await withCleanup(async () => 'success', () => { cleanupCalled = true; });
            assert.strictEqual(result, 'success');
            assert.strictEqual(cleanupCalled, true);
        });
        it('should call cleanup on error and re-throw', async () => {
            let cleanupCalled = false;
            await assert.rejects(async () => {
                await withCleanup(async () => { throw new Error('Operation failed'); }, () => { cleanupCalled = true; });
            }, { message: 'Operation failed' });
            assert.strictEqual(cleanupCalled, true);
        });
        it('should handle async cleanup', async () => {
            let cleanupCalled = false;
            await withCleanup(async () => 'success', async () => {
                await new Promise((resolve) => setTimeout(resolve, 10));
                cleanupCalled = true;
            });
            assert.strictEqual(cleanupCalled, true);
        });
        it('should not throw if cleanup fails', async () => {
            const result = await withCleanup(async () => 'success', () => { throw new Error('Cleanup failed'); });
            assert.strictEqual(result, 'success');
        });
    });
    describe('withTimeoutAll', () => {
        it('should return results for all completed operations', async () => {
            const results = await withTimeoutAll([
                { operation: async () => 'result1', timeoutMs: 1000, operationName: 'op1' },
                { operation: async () => 'result2', timeoutMs: 1000, operationName: 'op2' },
            ]);
            assert.strictEqual(results.length, 2);
            assert.strictEqual(results[0].success, true);
            if (results[0].success)
                assert.strictEqual(results[0].result, 'result1');
            assert.strictEqual(results[1].success, true);
            if (results[1].success)
                assert.strictEqual(results[1].result, 'result2');
        });
        it('should return errors for timed out operations', async () => {
            const results = await withTimeoutAll([
                { operation: async () => 'quick', timeoutMs: 1000, operationName: 'quickOp' },
                {
                    operation: async (signal) => {
                        return new Promise((resolve, reject) => {
                            const timeoutId = setTimeout(() => resolve('done'), 5000);
                            signal.addEventListener('abort', () => {
                                clearTimeout(timeoutId);
                                reject(new Error('Aborted'));
                            });
                        });
                    },
                    timeoutMs: 50,
                    operationName: 'slowOp',
                },
            ]);
            assert.strictEqual(results[0].success, true);
            assert.strictEqual(results[1].success, false);
            if (!results[1].success) {
                assert.ok(results[1].error instanceof TimeoutError);
                assert.strictEqual(results[1].error.operationName, 'slowOp');
            }
        });
        it('should handle all operations timing out', async () => {
            const results = await withTimeoutAll([
                {
                    operation: async (signal) => {
                        return new Promise((resolve, reject) => {
                            const timeoutId = setTimeout(() => resolve('done'), 5000);
                            signal.addEventListener('abort', () => {
                                clearTimeout(timeoutId);
                                reject(new Error('Aborted'));
                            });
                        });
                    },
                    timeoutMs: 50,
                    operationName: 'op1',
                },
                {
                    operation: async (signal) => {
                        return new Promise((resolve, reject) => {
                            const timeoutId = setTimeout(() => resolve('done'), 5000);
                            signal.addEventListener('abort', () => {
                                clearTimeout(timeoutId);
                                reject(new Error('Aborted'));
                            });
                        });
                    },
                    timeoutMs: 50,
                    operationName: 'op2',
                },
            ]);
            assert.strictEqual(results.every((r) => !r.success), true);
        });
        it('should handle empty array', async () => {
            const results = await withTimeoutAll([]);
            assert.strictEqual(results.length, 0);
        });
        it('should wrap non-TimeoutError errors', async () => {
            const results = await withTimeoutAll([
                {
                    operation: async () => { throw new Error('Custom error'); },
                    timeoutMs: 1000,
                    operationName: 'failingOp',
                },
            ]);
            assert.strictEqual(results[0].success, false);
            if (!results[0].success) {
                assert.ok(results[0].error instanceof TimeoutError);
            }
        });
    });
});
//# sourceMappingURL=timeout.test.js.map