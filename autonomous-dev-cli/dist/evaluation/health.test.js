import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { runHealthChecks, generatePreviewUrl } from './health.js';
describe('runHealthChecks', () => {
    let originalFetch;
    beforeEach(() => {
        originalFetch = globalThis.fetch;
    });
    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
    describe('empty URL list', () => {
        it('should return success when no URLs configured', async () => {
            const result = await runHealthChecks({ urls: [] });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.checks.length, 0);
            assert.strictEqual(result.duration, 0);
        });
    });
    describe('successful health checks', () => {
        it('should pass when URL returns expected status', async () => {
            globalThis.fetch = mock.fn(async () => ({
                status: 200,
            }));
            const result = await runHealthChecks({
                urls: ['https://example.com/health'],
                timeout: 5000,
            });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.checks.length, 1);
            assert.strictEqual(result.checks[0].ok, true);
            assert.strictEqual(result.checks[0].status, 200);
        });
        it('should check multiple URLs', async () => {
            let callCount = 0;
            globalThis.fetch = mock.fn(async () => {
                callCount++;
                return { status: 200 };
            });
            const result = await runHealthChecks({
                urls: ['https://example1.com', 'https://example2.com', 'https://example3.com'],
                timeout: 5000,
            });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.checks.length, 3);
            assert.ok(result.checks.every((c) => c.ok));
        });
        it('should track response time', async () => {
            globalThis.fetch = mock.fn(async () => {
                await new Promise((r) => setTimeout(r, 10));
                return { status: 200 };
            });
            const result = await runHealthChecks({
                urls: ['https://example.com'],
                timeout: 5000,
            });
            assert.ok(result.checks[0].responseTime >= 10);
        });
    });
    describe('failed health checks', () => {
        it('should fail when URL returns unexpected status', async () => {
            globalThis.fetch = mock.fn(async () => ({
                status: 500,
            }));
            const result = await runHealthChecks({
                urls: ['https://example.com'],
                expectedStatus: 200,
                retries: 0,
            });
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.checks[0].ok, false);
            assert.strictEqual(result.checks[0].status, 500);
            assert.ok(result.checks[0].error?.includes('Expected status 200'));
        });
        it('should fail when fetch throws error', async () => {
            globalThis.fetch = mock.fn(async () => {
                throw new Error('Network error');
            });
            const result = await runHealthChecks({
                urls: ['https://example.com'],
                retries: 0,
            });
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.checks[0].ok, false);
            assert.strictEqual(result.checks[0].status, null);
            assert.ok(result.checks[0].error?.includes('Network error'));
        });
        it('should handle timeout errors', async () => {
            globalThis.fetch = mock.fn(async (url, options) => {
                const error = new Error('Aborted');
                error.name = 'AbortError';
                throw error;
            });
            const result = await runHealthChecks({
                urls: ['https://example.com'],
                timeout: 100,
                retries: 0,
            });
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.checks[0].ok, false);
            assert.ok(result.checks[0].error?.includes('timed out'));
        });
    });
    describe('retry behavior', () => {
        it('should retry on failure', async () => {
            let attempts = 0;
            globalThis.fetch = mock.fn(async () => {
                attempts++;
                if (attempts < 2) {
                    throw new Error('Temporary failure');
                }
                return { status: 200 };
            });
            const result = await runHealthChecks({
                urls: ['https://example.com'],
                retries: 2,
                retryDelay: 10,
            });
            assert.strictEqual(result.success, true);
            assert.strictEqual(attempts, 2);
        });
        it('should fail after all retries exhausted', async () => {
            globalThis.fetch = mock.fn(async () => {
                throw new Error('Persistent failure');
            });
            const result = await runHealthChecks({
                urls: ['https://example.com'],
                retries: 2,
                retryDelay: 10,
            });
            assert.strictEqual(result.success, false);
            // Should have tried 3 times (initial + 2 retries)
            assert.strictEqual(globalThis.fetch.mock.callCount(), 3);
        });
    });
    describe('custom expected status', () => {
        it('should accept custom expected status', async () => {
            globalThis.fetch = mock.fn(async () => ({
                status: 201,
            }));
            const result = await runHealthChecks({
                urls: ['https://example.com'],
                expectedStatus: 201,
            });
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.checks[0].ok, true);
        });
    });
    describe('parallel vs sequential', () => {
        it('should run checks in parallel by default', async () => {
            const callTimes = [];
            globalThis.fetch = mock.fn(async () => {
                callTimes.push(Date.now());
                await new Promise((r) => setTimeout(r, 50));
                return { status: 200 };
            });
            await runHealthChecks({
                urls: ['https://example1.com', 'https://example2.com'],
                parallel: true,
            });
            // In parallel, calls should start close together
            const timeDiff = Math.abs(callTimes[1] - callTimes[0]);
            assert.ok(timeDiff < 30, `Expected parallel execution, but time diff was ${timeDiff}ms`);
        });
        it('should run checks sequentially when parallel is false', async () => {
            const callTimes = [];
            globalThis.fetch = mock.fn(async () => {
                callTimes.push(Date.now());
                await new Promise((r) => setTimeout(r, 50));
                return { status: 200 };
            });
            await runHealthChecks({
                urls: ['https://example1.com', 'https://example2.com'],
                parallel: false,
            });
            // In sequential, second call should start after first finishes
            const timeDiff = Math.abs(callTimes[1] - callTimes[0]);
            assert.ok(timeDiff >= 50, `Expected sequential execution, but time diff was ${timeDiff}ms`);
        });
    });
    describe('concurrency limiting', () => {
        it('should respect concurrency limit', async () => {
            let concurrent = 0;
            let maxConcurrent = 0;
            globalThis.fetch = mock.fn(async () => {
                concurrent++;
                maxConcurrent = Math.max(maxConcurrent, concurrent);
                await new Promise((r) => setTimeout(r, 50));
                concurrent--;
                return { status: 200 };
            });
            await runHealthChecks({
                urls: Array(10).fill('https://example.com'),
                concurrency: 3,
                parallel: true,
            });
            assert.ok(maxConcurrent <= 3, `Max concurrent was ${maxConcurrent}, expected <= 3`);
        });
    });
});
describe('generatePreviewUrl', () => {
    it('should replace {owner} placeholder', () => {
        const result = generatePreviewUrl('https://preview.example.com/{owner}/', { owner: 'myorg', repo: 'myrepo', branch: 'main' });
        assert.strictEqual(result, 'https://preview.example.com/myorg/');
    });
    it('should replace {repo} placeholder', () => {
        const result = generatePreviewUrl('https://preview.example.com/{repo}/', { owner: 'myorg', repo: 'myrepo', branch: 'main' });
        assert.strictEqual(result, 'https://preview.example.com/myrepo/');
    });
    it('should replace {branch} placeholder', () => {
        const result = generatePreviewUrl('https://preview.example.com/{branch}/', { owner: 'myorg', repo: 'myrepo', branch: 'feature-test' });
        assert.strictEqual(result, 'https://preview.example.com/feature-test/');
    });
    it('should replace all placeholders', () => {
        const result = generatePreviewUrl('https://{branch}.{owner}.example.com/{repo}/', { owner: 'myorg', repo: 'myrepo', branch: 'main' });
        assert.strictEqual(result, 'https://main.myorg.example.com/myrepo/');
    });
    it('should replace slashes in branch names with dashes', () => {
        const result = generatePreviewUrl('https://preview.example.com/{branch}/', { owner: 'myorg', repo: 'myrepo', branch: 'feature/my-feature' });
        assert.strictEqual(result, 'https://preview.example.com/feature-my-feature/');
    });
    it('should handle multiple slashes in branch names', () => {
        const result = generatePreviewUrl('https://preview.example.com/{branch}/', { owner: 'myorg', repo: 'myrepo', branch: 'feat/scope/ticket-123' });
        assert.strictEqual(result, 'https://preview.example.com/feat-scope-ticket-123/');
    });
    it('should preserve URL without placeholders', () => {
        const result = generatePreviewUrl('https://preview.example.com/static/', { owner: 'myorg', repo: 'myrepo', branch: 'main' });
        assert.strictEqual(result, 'https://preview.example.com/static/');
    });
});
//# sourceMappingURL=health.test.js.map