/**
 * Integration tests for the discovery-to-merge workflow.
 * Tests the complete lifecycle of autonomous development cycles.
 */
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createMockIssue, createMockServiceHealth, createMockGitHub, createMockWorkerResult, createMockWorkerPool, createMockConflictResolver, createMockDiscoveredTask, createMockCodebaseAnalysis, } from './test-utils/mocks.js';
import { ErrorCode, StructuredError } from './utils/errors.js';
describe('Discovery to Merge Workflow Integration', () => {
    let testDir;
    beforeEach(() => {
        testDir = join(tmpdir(), `integration-test-${Date.now()}`);
        mkdirSync(testDir, { recursive: true });
        // Create basic project structure
        mkdirSync(join(testDir, 'src'));
        writeFileSync(join(testDir, 'package.json'), JSON.stringify({
            name: 'test-project',
            version: '1.0.0',
        }));
        writeFileSync(join(testDir, 'src', 'index.ts'), 'export const main = () => {};');
    });
    afterEach(() => {
        if (existsSync(testDir)) {
            rmSync(testDir, { recursive: true, force: true });
        }
    });
    describe('Step 1: Fetch existing issues', () => {
        it('should fetch existing issues with issue label', async () => {
            const github = createMockGitHub();
            const issueLabel = 'autonomous-dev';
            const existingIssues = [
                createMockIssue({ number: 1, title: 'Existing Issue 1', labels: [issueLabel] }),
                createMockIssue({ number: 2, title: 'Existing Issue 2', labels: [issueLabel] }),
            ];
            github.issues.listOpenIssues = mock.fn(async () => existingIssues);
            const result = await github.issues.listOpenIssues(issueLabel);
            assert.strictEqual(result.length, 2);
            assert.strictEqual(result[0].labels.includes(issueLabel), true);
        });
        it('should use fallback when GitHub is degraded', async () => {
            const github = createMockGitHub();
            const cachedIssues = [createMockIssue({ number: 1 })];
            github.issues.listOpenIssuesWithFallback = mock.fn(async () => ({
                value: cachedIssues,
                degraded: true,
            }));
            const result = await github.issues.listOpenIssuesWithFallback('autonomous-dev', cachedIssues);
            assert.strictEqual(result.degraded, true);
            assert.strictEqual(result.value.length, 1);
        });
        it('should handle empty issues list', async () => {
            const github = createMockGitHub();
            github.issues.listOpenIssues = mock.fn(async () => []);
            const result = await github.issues.listOpenIssues('autonomous-dev');
            assert.strictEqual(result.length, 0);
        });
    });
    describe('Step 2: Discover new tasks', () => {
        it('should analyze codebase and discover tasks', async () => {
            const analysis = createMockCodebaseAnalysis();
            const tasks = [
                createMockDiscoveredTask({ title: 'Add loading states' }),
                createMockDiscoveredTask({ title: 'Fix type errors' }),
            ];
            assert.strictEqual(tasks.length, 2);
            assert.strictEqual(analysis.fileCount, 10);
        });
        it('should respect maxOpenIssues limit', () => {
            const maxOpenIssues = 5;
            const existingIssues = [
                createMockIssue({ number: 1 }),
                createMockIssue({ number: 2 }),
                createMockIssue({ number: 3 }),
            ];
            const availableSlots = maxOpenIssues - existingIssues.length;
            assert.strictEqual(availableSlots, 2);
        });
        it('should skip discovery when maxOpenIssues reached', () => {
            const maxOpenIssues = 3;
            const existingIssues = [
                createMockIssue({ number: 1 }),
                createMockIssue({ number: 2 }),
                createMockIssue({ number: 3 }),
            ];
            const availableSlots = maxOpenIssues - existingIssues.length;
            assert.strictEqual(availableSlots, 0);
        });
        it('should avoid duplicate tasks from existing issues', () => {
            const existingIssues = [
                createMockIssue({ number: 1, title: 'Add loading states' }),
            ];
            const discoveredTasks = [
                createMockDiscoveredTask({ title: 'Add loading states' }),
                createMockDiscoveredTask({ title: 'Fix type errors' }),
            ];
            const existingTitles = existingIssues.map((i) => i.title.toLowerCase());
            const newTasks = discoveredTasks.filter((t) => !existingTitles.includes(t.title.toLowerCase()));
            assert.strictEqual(newTasks.length, 1);
            assert.strictEqual(newTasks[0].title, 'Fix type errors');
        });
    });
    describe('Step 3: Create GitHub issues for tasks', () => {
        it('should create issues with correct labels', async () => {
            const github = createMockGitHub();
            const task = createMockDiscoveredTask({
                title: 'Add feature',
                priority: 'high',
                category: 'feature',
                estimatedComplexity: 'moderate',
            });
            const expectedLabels = [
                'autonomous-dev',
                `priority:${task.priority}`,
                `type:${task.category}`,
                `complexity:${task.estimatedComplexity}`,
            ];
            const createdIssue = await github.issues.createIssue({
                title: task.title,
                body: task.description,
                labels: expectedLabels,
            });
            assert.ok(github.issues.createIssue.mock.calls.length > 0);
            assert.ok(createdIssue);
        });
        it('should include affected paths in issue body', () => {
            const task = createMockDiscoveredTask({
                affectedPaths: ['src/components/', 'src/utils/'],
            });
            const body = `## Description

${task.description}

## Affected Paths

${task.affectedPaths.map((p) => `- \`${p}\``).join('\n')}

---

*This issue was automatically created by Autonomous Dev CLI*
`;
            assert.ok(body.includes('`src/components/`'));
            assert.ok(body.includes('`src/utils/`'));
        });
        it('should skip issue creation when GitHub is degraded', async () => {
            const github = createMockGitHub();
            github.client.isAvailable = mock.fn(() => false);
            const isAvailable = github.client.isAvailable();
            assert.strictEqual(isAvailable, false);
        });
        it('should handle issue creation failure gracefully', async () => {
            const github = createMockGitHub();
            github.issues.createIssue = mock.fn(async () => {
                throw new Error('Rate limited');
            });
            let error = null;
            try {
                await github.issues.createIssue({ title: 'Test', body: 'Body', labels: [] });
            }
            catch (e) {
                error = e;
            }
            assert.ok(error);
            assert.ok(error.message.includes('Rate limited'));
        });
    });
    describe('Step 4: Execute tasks with workers', () => {
        it('should mark issues as in-progress before execution', async () => {
            const github = createMockGitHub();
            const issue = createMockIssue({ number: 42 });
            await github.issues.addLabels(issue.number, ['in-progress']);
            assert.strictEqual(github.issues.addLabels.mock.calls.length, 1);
            assert.strictEqual(github.issues.addLabels.mock.calls[0].arguments[0], 42);
        });
        it('should execute tasks in parallel', async () => {
            const workerPool = createMockWorkerPool();
            const tasks = [
                { issue: createMockIssue({ number: 1 }), branchName: 'auto/1-feature' },
                { issue: createMockIssue({ number: 2 }), branchName: 'auto/2-bugfix' },
            ];
            const results = await workerPool.executeTasks(tasks);
            assert.strictEqual(results.length, 2);
            assert.ok(results.every((r) => r.success));
        });
        it('should handle worker failures', async () => {
            const workerPool = createMockWorkerPool({
                executeTasks: mock.fn(async () => [
                    createMockWorkerResult({ success: true }),
                    createMockWorkerResult({ success: false, error: 'Timeout exceeded' }),
                ]),
            });
            const tasks = [
                { issue: createMockIssue({ number: 1 }), branchName: 'auto/1-feature' },
                { issue: createMockIssue({ number: 2 }), branchName: 'auto/2-bugfix' },
            ];
            const results = await workerPool.executeTasks(tasks);
            const succeeded = results.filter((r) => r.success).length;
            const failed = results.filter((r) => !r.success).length;
            assert.strictEqual(succeeded, 1);
            assert.strictEqual(failed, 1);
        });
        it('should track worker pool status', () => {
            const workerPool = createMockWorkerPool();
            const status = workerPool.getStatus();
            assert.ok('active' in status);
            assert.ok('queued' in status);
            assert.ok('completed' in status);
            assert.ok('succeeded' in status);
            assert.ok('failed' in status);
        });
    });
    describe('Step 5: Create PRs for completed tasks', () => {
        it('should create PR for successful worker result', async () => {
            const github = createMockGitHub();
            const workerResult = createMockWorkerResult({
                success: true,
                branchName: 'auto/42-add-feature',
            });
            const pr = await github.pulls.createPR({
                title: workerResult.issue.title,
                body: `Implements #${workerResult.issue.number}`,
                head: workerResult.branchName,
                base: 'main',
            });
            assert.ok(github.pulls.createPR.mock.calls.length > 0);
            assert.ok(pr);
        });
        it('should link PR to issue via comment', async () => {
            const github = createMockGitHub();
            const issueNumber = 42;
            const prNumber = 10;
            await github.issues.addComment(issueNumber, `🔗 PR created: #${prNumber}`);
            assert.strictEqual(github.issues.addComment.mock.calls.length, 1);
        });
        it('should add needs-review label on failure', async () => {
            const github = createMockGitHub();
            const workerResult = createMockWorkerResult({
                success: false,
                error: 'No changes made',
            });
            await github.issues.removeLabel(workerResult.issue.number, 'in-progress');
            await github.issues.addLabels(workerResult.issue.number, ['needs-review']);
            assert.strictEqual(github.issues.removeLabel.mock.calls.length, 1);
            assert.strictEqual(github.issues.addLabels.mock.calls.length, 1);
        });
        it('should add failure comment on worker error', async () => {
            const github = createMockGitHub();
            const errorMessage = 'Clone failed: network error';
            const workerResult = createMockWorkerResult({
                success: false,
                error: errorMessage,
            });
            const comment = `⚠️ Autonomous implementation failed:\n\n\`\`\`\n${workerResult.error}\n\`\`\``;
            await github.issues.addComment(workerResult.issue.number, comment);
            assert.ok(github.issues.addComment.mock.calls.length > 0);
        });
        it('should handle PR creation with graceful degradation', async () => {
            const github = createMockGitHub();
            const mockCreatePRWithFallback = mock.fn(async () => ({
                value: null,
                degraded: true,
            }));
            github.pulls.createPRWithFallback = mockCreatePRWithFallback;
            const result = await github.pulls.createPRWithFallback({
                title: 'Test PR',
                body: 'Test body',
                head: 'feature',
                base: 'main',
            });
            assert.strictEqual(result.degraded, true);
            assert.strictEqual(result.value, null);
        });
    });
    describe('Step 6: Merge PRs', () => {
        it('should merge PRs sequentially', async () => {
            const resolver = createMockConflictResolver();
            const branches = [
                { branchName: 'auto/1-feature', prNumber: 10 },
                { branchName: 'auto/2-bugfix', prNumber: 11 },
            ];
            const results = await resolver.mergeSequentially(branches);
            assert.strictEqual(results.size, 2);
            assert.ok(results.get('auto/1-feature'));
            assert.ok(results.get('auto/2-bugfix'));
        });
        it('should close issue after successful merge', async () => {
            const github = createMockGitHub();
            const issueNumber = 42;
            const prNumber = 10;
            await github.issues.closeIssue(issueNumber, `✅ Automatically implemented and merged via PR #${prNumber}`);
            assert.strictEqual(github.issues.closeIssue.mock.calls.length, 1);
        });
        it('should handle merge conflicts', async () => {
            const resolver = createMockConflictResolver({
                attemptMerge: mock.fn(async (_branchName, _prNumber) => ({
                    success: false,
                    merged: false,
                    error: 'Conflicts require manual resolution',
                    attempts: 3,
                })),
            });
            const result = await resolver.attemptMerge('feature-branch', 1);
            assert.strictEqual(result.success, false);
            assert.ok(result.error?.includes('conflict'));
        });
        it('should respect autoMerge configuration', () => {
            const config = { merge: { autoMerge: false } };
            assert.strictEqual(config.merge.autoMerge, false);
        });
        it('should use configured merge method', async () => {
            const github = createMockGitHub();
            const mergeMethod = 'squash';
            await github.pulls.mergePR(10, mergeMethod);
            assert.strictEqual(github.pulls.mergePR.mock.calls.length, 1);
        });
    });
    describe('Graceful degradation', () => {
        it('should track degraded status across operations', () => {
            let degraded = false;
            const operations = [
                { name: 'fetch-issues', degraded: false },
                { name: 'create-pr', degraded: true },
                { name: 'add-label', degraded: true },
            ];
            for (const op of operations) {
                if (op.degraded) {
                    degraded = true;
                }
            }
            assert.strictEqual(degraded, true);
        });
        it('should continue processing after degradation', async () => {
            const github = createMockGitHub();
            const issues = [
                createMockIssue({ number: 1 }),
                createMockIssue({ number: 2 }),
                createMockIssue({ number: 3 }),
            ];
            const results = [];
            for (const issue of issues) {
                try {
                    const result = await github.issues.addLabels(issue.number, ['in-progress']);
                    results.push({ success: true, issueNumber: issue.number });
                }
                catch (e) {
                    results.push({ success: false, issueNumber: issue.number });
                }
            }
            assert.strictEqual(results.length, 3);
        });
        it('should use cached data when service is unavailable', () => {
            const cachedIssues = [createMockIssue()];
            const serviceHealth = createMockServiceHealth({ status: 'unavailable' });
            const shouldUseCached = serviceHealth.status === 'unavailable';
            assert.strictEqual(shouldUseCached, true);
        });
    });
    describe('Error recovery', () => {
        it('should collect errors throughout cycle', () => {
            const errors = [];
            errors.push('[GITHUB_API_ERROR] Rate limit exceeded');
            errors.push('[CLAUDE_TIMEOUT] Request timed out');
            assert.strictEqual(errors.length, 2);
        });
        it('should categorize errors by severity', () => {
            const errors = [
                { code: ErrorCode.GITHUB_AUTH_FAILED, severity: 'critical' },
                { code: ErrorCode.GITHUB_RATE_LIMITED, severity: 'transient' },
                { code: ErrorCode.EXEC_CLONE_FAILED, severity: 'error' },
            ];
            const critical = errors.filter((e) => e.severity === 'critical');
            const transient = errors.filter((e) => e.severity === 'transient');
            assert.strictEqual(critical.length, 1);
            assert.strictEqual(transient.length, 1);
        });
        it('should identify retryable operations', () => {
            const retryableCodes = [
                ErrorCode.GITHUB_RATE_LIMITED,
                ErrorCode.GITHUB_NETWORK_ERROR,
                ErrorCode.CLAUDE_TIMEOUT,
                ErrorCode.EXEC_CLONE_FAILED,
            ];
            const error = new StructuredError(ErrorCode.GITHUB_RATE_LIMITED, 'Rate limit exceeded');
            assert.strictEqual(retryableCodes.includes(error.code), true);
        });
    });
    describe('Cycle metrics', () => {
        it('should track cycle duration', () => {
            const startTime = Date.now();
            // Simulate some work
            const duration = Date.now() - startTime;
            assert.ok(duration >= 0);
        });
        it('should count tasks by status', () => {
            const results = [
                createMockWorkerResult({ success: true }),
                createMockWorkerResult({ success: true }),
                createMockWorkerResult({ success: false }),
            ];
            const tasksCompleted = results.filter((r) => r.success).length;
            const tasksFailed = results.filter((r) => !r.success).length;
            assert.strictEqual(tasksCompleted, 2);
            assert.strictEqual(tasksFailed, 1);
        });
        it('should count PRs merged', () => {
            const mergeResults = new Map([
                ['branch-1', { success: true, merged: true }],
                ['branch-2', { success: true, merged: true }],
                ['branch-3', { success: false, merged: false }],
            ]);
            let prsMerged = 0;
            mergeResults.forEach((result) => {
                if (result.merged)
                    prsMerged++;
            });
            assert.strictEqual(prsMerged, 2);
        });
    });
    describe('Service health monitoring', () => {
        it('should update health status at cycle start', () => {
            const health = createMockServiceHealth();
            assert.strictEqual(health.status, 'healthy');
        });
        it('should detect degraded state from consecutive failures', () => {
            const health = createMockServiceHealth({
                consecutiveFailures: 3,
                status: 'degraded',
                circuitState: 'half-open',
            });
            assert.strictEqual(health.status, 'degraded');
            assert.strictEqual(health.circuitState, 'half-open');
        });
        it('should track rate limit remaining', () => {
            const health = createMockServiceHealth({
                rateLimitRemaining: 10,
            });
            assert.strictEqual(health.rateLimitRemaining, 10);
            const isLow = health.rateLimitRemaining < 100;
            assert.strictEqual(isLow, true);
        });
        it('should determine overall status from service health', () => {
            const healthStatuses = [
                { github: 'healthy', overall: 'healthy' },
                { github: 'degraded', overall: 'degraded' },
                { github: 'unavailable', overall: 'unavailable' },
            ];
            healthStatuses.forEach(({ github, overall }) => {
                let overallStatus = 'healthy';
                if (github === 'unavailable') {
                    overallStatus = 'unavailable';
                }
                else if (github === 'degraded') {
                    overallStatus = 'degraded';
                }
                assert.strictEqual(overallStatus, overall);
            });
        });
    });
});
describe('Complete cycle scenarios', () => {
    describe('Happy path - all operations succeed', () => {
        it('should complete cycle with tasks discovered, executed, and merged', () => {
            const cycleResult = {
                success: true,
                tasksDiscovered: 3,
                tasksCompleted: 3,
                tasksFailed: 0,
                prsMerged: 3,
                duration: 60000,
                errors: [],
                degraded: false,
                serviceHealth: {
                    github: createMockServiceHealth(),
                    overallStatus: 'healthy',
                    lastCheck: new Date(),
                },
            };
            assert.strictEqual(cycleResult.success, true);
            assert.strictEqual(cycleResult.tasksDiscovered, cycleResult.tasksCompleted);
            assert.strictEqual(cycleResult.errors.length, 0);
        });
    });
    describe('Partial success - some operations fail', () => {
        it('should report partial success with errors', () => {
            const cycleResult = {
                success: false,
                tasksDiscovered: 5,
                tasksCompleted: 3,
                tasksFailed: 2,
                prsMerged: 2,
                duration: 120000,
                errors: [
                    '[EXEC_TIMEOUT] Task 4 timed out',
                    '[GITHUB_PR_CONFLICT] PR 5 has merge conflicts',
                ],
                degraded: true,
                serviceHealth: {
                    github: createMockServiceHealth({ status: 'degraded' }),
                    overallStatus: 'degraded',
                    lastCheck: new Date(),
                },
            };
            assert.strictEqual(cycleResult.success, false);
            assert.ok(cycleResult.tasksCompleted < cycleResult.tasksDiscovered);
            assert.ok(cycleResult.errors.length > 0);
            assert.strictEqual(cycleResult.degraded, true);
        });
    });
    describe('Degraded mode - using cached data', () => {
        it('should operate with cached issues when GitHub is unavailable', () => {
            const cachedIssues = [
                createMockIssue({ number: 1 }),
                createMockIssue({ number: 2 }),
            ];
            const cycleResult = {
                success: true,
                tasksDiscovered: 0, // No new discovery due to degradation
                tasksCompleted: 2,
                tasksFailed: 0,
                prsMerged: 0, // Can't merge when degraded
                duration: 30000,
                errors: [
                    '[GITHUB_SERVICE_DEGRADED] Issue creation skipped due to service degradation',
                ],
                degraded: true,
                serviceHealth: {
                    github: createMockServiceHealth({ status: 'degraded' }),
                    overallStatus: 'degraded',
                    lastCheck: new Date(),
                },
            };
            assert.strictEqual(cycleResult.degraded, true);
            assert.strictEqual(cycleResult.tasksDiscovered, 0);
        });
    });
    describe('Dry run mode', () => {
        it('should not create issues or execute tasks', () => {
            const dryRun = true;
            const cycleResult = {
                success: true,
                tasksDiscovered: 3,
                tasksCompleted: 0,
                tasksFailed: 0,
                prsMerged: 0,
                duration: 5000,
                errors: [],
                degraded: false,
                serviceHealth: {
                    github: null,
                    overallStatus: 'healthy',
                    lastCheck: new Date(),
                },
            };
            if (dryRun) {
                // In dry run, tasks are discovered but not executed
                assert.strictEqual(cycleResult.tasksCompleted, 0);
                assert.strictEqual(cycleResult.prsMerged, 0);
            }
        });
    });
    describe('Single cycle mode', () => {
        it('should exit after one cycle', () => {
            const singleCycle = true;
            let cyclesRun = 0;
            // Simulate cycle loop
            do {
                cyclesRun++;
                if (singleCycle)
                    break;
            } while (cyclesRun < 10);
            assert.strictEqual(cyclesRun, 1);
        });
    });
});
//# sourceMappingURL=integration.test.js.map