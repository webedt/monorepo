/**
 * Mock implementations for external dependencies used in testing.
 * Provides mocks for GitHub API, Claude SDK, and database operations.
 */
import { mock } from 'node:test';
// ============================================================================
// GitHub API Mocks
// ============================================================================
/**
 * Create a mock Issue
 */
export function createMockIssue(overrides = {}) {
    return {
        number: 1,
        title: 'Test Issue',
        body: 'Test description for the issue',
        state: 'open',
        labels: [],
        htmlUrl: 'https://github.com/owner/repo/issues/1',
        createdAt: new Date().toISOString(),
        assignee: null,
        ...overrides,
    };
}
/**
 * Create a mock Pull Request
 */
export function createMockPR(overrides = {}) {
    return {
        number: 1,
        title: 'Test PR',
        body: 'Test PR description',
        state: 'open',
        head: { ref: 'feature-branch', sha: 'abc123' },
        base: { ref: 'main', sha: 'def456' },
        htmlUrl: 'https://github.com/owner/repo/pull/1',
        mergeable: true,
        merged: false,
        draft: false,
        ...overrides,
    };
}
/**
 * Create a mock merge result
 */
export function createMockMergeResult(overrides = {}) {
    return {
        merged: true,
        sha: 'merged-sha-123',
        message: 'Pull Request successfully merged',
        ...overrides,
    };
}
/**
 * Create a mock service health status
 */
export function createMockServiceHealth(overrides = {}) {
    return {
        status: 'healthy',
        circuitState: 'closed',
        consecutiveFailures: 0,
        consecutiveSuccesses: 0,
        rateLimitRemaining: 5000,
        lastSuccess: new Date(),
        ...overrides,
    };
}
/**
 * Create mock GitHub Issues manager
 */
export function createMockIssuesManager(overrides = {}) {
    return {
        listOpenIssues: mock.fn(async (_label) => [createMockIssue()]),
        listOpenIssuesWithFallback: mock.fn(async (_label, _fallback) => ({
            value: [createMockIssue()],
            degraded: false,
        })),
        getIssue: mock.fn(async (number) => createMockIssue({ number })),
        createIssue: mock.fn(async (params) => createMockIssue({
            title: params.title,
            body: params.body,
            labels: params.labels,
        })),
        updateIssue: mock.fn(async () => createMockIssue()),
        closeIssue: mock.fn(async (_issueNumber, _comment) => { }),
        addComment: mock.fn(async (_issueNumber, _body) => { }),
        addCommentWithFallback: mock.fn(async (_issueNumber, _body) => ({
            value: undefined,
            degraded: false,
        })),
        addLabels: mock.fn(async (_issueNumber, _labels) => { }),
        addLabelsWithFallback: mock.fn(async (_issueNumber, _labels) => ({
            value: undefined,
            degraded: false,
        })),
        removeLabel: mock.fn(async (_issueNumber, _label) => { }),
        getServiceHealth: mock.fn(() => createMockServiceHealth()),
        isAvailable: mock.fn(() => true),
        ...overrides,
    };
}
/**
 * Create mock GitHub Pulls manager
 */
export function createMockPullsManager(overrides = {}) {
    return {
        listOpenPRs: mock.fn(async () => [createMockPR()]),
        getPR: mock.fn(async (number) => createMockPR({ number })),
        findPRForBranch: mock.fn(async (_branch) => createMockPR()),
        createPR: mock.fn(async (params) => createMockPR({
            title: params.title,
            body: params.body,
        })),
        createPRWithFallback: mock.fn(async (_params) => ({
            value: createMockPR(),
            degraded: false,
        })),
        mergePR: mock.fn(async (_prNumber, _mergeMethod) => createMockMergeResult()),
        closePR: mock.fn(async (_prNumber) => { }),
        updatePRFromBase: mock.fn(async (_prNumber) => true),
        waitForMergeable: mock.fn(async (_prNumber) => true),
        getChecksStatus: mock.fn(async (_prNumber) => ({ state: 'success', statuses: [] })),
        ...overrides,
    };
}
/**
 * Create mock GitHub Branches manager
 */
export function createMockBranchesManager(overrides = {}) {
    return {
        getBranch: mock.fn(async () => ({ name: 'main', sha: 'sha123', protected: false })),
        listBranches: mock.fn(async () => []),
        createBranch: mock.fn(async () => ({ name: 'new-branch', sha: 'sha456', protected: false })),
        deleteBranch: mock.fn(async () => { }),
        branchExists: mock.fn(async () => true),
        ...overrides,
    };
}
/**
 * Create mock GitHub client
 */
export function createMockGitHubClient(overrides = {}) {
    return {
        verifyAuth: mock.fn(async () => ({ login: 'test-user' })),
        getRepo: mock.fn(async () => ({
            fullName: 'owner/repo',
            defaultBranch: 'main',
        })),
        getServiceHealth: mock.fn(() => createMockServiceHealth()),
        isAvailable: mock.fn(() => true),
        client: {},
        owner: 'test-owner',
        repo: 'test-repo',
        ...overrides,
    };
}
/**
 * Create mock GitHub module (combines client, issues, pulls, branches)
 */
export function createMockGitHub(overrides = {}) {
    return {
        client: createMockGitHubClient(overrides.client),
        issues: createMockIssuesManager(overrides.issues),
        pulls: createMockPullsManager(overrides.pulls),
        branches: createMockBranchesManager(overrides.branches),
        ...overrides,
    };
}
// ============================================================================
// Claude SDK Mocks
// ============================================================================
/**
 * Create mock Claude query stream
 */
export function createMockClaudeStream() {
    return {
        [Symbol.asyncIterator]: async function* () {
            yield { type: 'assistant', message: { content: [{ type: 'text', text: 'Working on task...' }] } };
            yield { type: 'result', duration_ms: 5000 };
        },
    };
}
/**
 * Create mock Claude API response
 */
export function createMockClaudeResponse(tasks = []) {
    return {
        ok: true,
        json: async () => ({
            content: [{
                    text: JSON.stringify(tasks.length > 0 ? tasks : [
                        {
                            title: 'Add feature',
                            description: 'Feature description',
                            priority: 'medium',
                            category: 'feature',
                            estimatedComplexity: 'moderate',
                            affectedPaths: ['src/'],
                        },
                    ]),
                }],
        }),
    };
}
// ============================================================================
// Database Mocks
// ============================================================================
/**
 * Create mock database session
 */
export function createMockChatSession(overrides = {}) {
    return {
        id: 'session-123',
        userId: 'user-123',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        repositoryUrl: 'https://github.com/owner/repo',
        baseBranch: 'main',
        branch: null,
        status: 'pending',
        provider: 'claude',
        userRequest: 'Test request',
        createdAt: new Date(),
        completedAt: null,
        sessionPath: null,
        ...overrides,
    };
}
/**
 * Create mock database operations
 */
export function createMockDatabase(overrides = {}) {
    return {
        initDatabase: mock.fn(async () => { }),
        closeDatabase: mock.fn(async () => { }),
        getUserCredentials: mock.fn(async () => ({
            userId: 'user-123',
            githubAccessToken: 'github-token',
            claudeAuth: {
                accessToken: 'claude-token',
                refreshToken: 'claude-refresh',
                expiresAt: Date.now() + 3600000,
            },
        })),
        createChatSession: mock.fn(async () => createMockChatSession()),
        updateChatSession: mock.fn(async () => createMockChatSession()),
        addMessage: mock.fn(async () => ({ id: 'msg-123' })),
        addEvent: mock.fn(async () => ({ id: 'event-123' })),
        generateSessionPath: mock.fn(() => 'owner/repo/branch'),
        ...overrides,
    };
}
// ============================================================================
// Worker Pool Mocks
// ============================================================================
/**
 * Create mock worker result
 */
export function createMockWorkerResult(overrides = {}) {
    return {
        success: true,
        issue: createMockIssue(),
        branchName: 'auto/1-test-feature',
        commitSha: 'abc123def456',
        duration: 5000,
        chatSessionId: 'session-123',
        ...overrides,
    };
}
/**
 * Create mock worker pool
 */
export function createMockWorkerPool(overrides = {}) {
    return {
        executeTasks: mock.fn(async (tasks) => tasks.map((task) => createMockWorkerResult({
            issue: task.issue,
            branchName: task.branchName,
        }))),
        getStatus: mock.fn(() => ({
            active: 0,
            queued: 0,
            completed: 0,
            succeeded: 0,
            failed: 0,
        })),
        stop: mock.fn(() => { }),
        ...overrides,
    };
}
// ============================================================================
// Conflict Resolver Mocks
// ============================================================================
/**
 * Create mock merge attempt result
 */
export function createMockMergeAttemptResult(overrides = {}) {
    return {
        success: true,
        pr: createMockPR(),
        merged: true,
        sha: 'merge-sha-123',
        attempts: 1,
        ...overrides,
    };
}
/**
 * Create mock conflict resolver
 */
export function createMockConflictResolver(overrides = {}) {
    return {
        attemptMerge: mock.fn(async (_branchName, _prNumber) => createMockMergeAttemptResult()),
        mergeSequentially: mock.fn(async (branches) => {
            const results = new Map();
            for (const { branchName } of branches) {
                results.set(branchName, createMockMergeAttemptResult());
            }
            return results;
        }),
        ...overrides,
    };
}
// ============================================================================
// Task Discovery Mocks
// ============================================================================
/**
 * Create mock discovered task
 */
export function createMockDiscoveredTask(overrides = {}) {
    return {
        title: 'Add loading states to dashboard',
        description: 'Add loading indicators while data is being fetched',
        priority: 'medium',
        category: 'feature',
        estimatedComplexity: 'simple',
        affectedPaths: ['src/components/dashboard/'],
        estimatedDurationMinutes: 30,
        ...overrides,
    };
}
/**
 * Create mock codebase analysis
 */
export function createMockCodebaseAnalysis(overrides = {}) {
    return {
        structure: [
            { name: 'src', path: 'src', type: 'directory', children: [] },
            { name: 'package.json', path: 'package.json', type: 'file' },
        ],
        fileCount: 10,
        todoComments: [],
        recentChanges: [],
        packages: [
            {
                name: 'test-project',
                path: '.',
                dependencies: ['react', 'typescript'],
                scripts: { test: 'jest', build: 'tsc' },
            },
        ],
        configFiles: ['package.json', 'tsconfig.json'],
        ...overrides,
    };
}
// ============================================================================
// Git Mocks
// ============================================================================
/**
 * Create mock simple-git instance
 */
export function createMockGit(overrides = {}) {
    return {
        clone: mock.fn(async () => { }),
        init: mock.fn(async () => { }),
        addRemote: mock.fn(async () => { }),
        raw: mock.fn(async () => ''),
        fetch: mock.fn(async () => { }),
        checkout: mock.fn(async () => { }),
        checkoutLocalBranch: mock.fn(async () => { }),
        add: mock.fn(async () => { }),
        commit: mock.fn(async () => ({ commit: 'abc123' })),
        push: mock.fn(async () => { }),
        status: mock.fn(async () => ({ isClean: () => false })),
        addConfig: mock.fn(async () => { }),
        ...overrides,
    };
}
// ============================================================================
// Metrics Mocks
// ============================================================================
/**
 * Create mock metrics
 */
export function createMockMetrics(overrides = {}) {
    return {
        updateHealthStatus: mock.fn(() => { }),
        recordCycleCompletion: mock.fn(() => { }),
        recordTaskCompletion: mock.fn(() => { }),
        recordToolUsage: mock.fn(() => { }),
        recordError: mock.fn(() => { }),
        githubApiCallsTotal: { inc: mock.fn() },
        githubApiErrorsTotal: { inc: mock.fn() },
        claudeApiCallsTotal: { inc: mock.fn() },
        claudeApiErrorsTotal: { inc: mock.fn() },
        prsCreatedTotal: { inc: mock.fn() },
        prsMergedTotal: { inc: mock.fn() },
        ...overrides,
    };
}
// ============================================================================
// Test Helpers
// ============================================================================
/**
 * Reset all mock function calls
 */
export function resetMocks(...mocks) {
    for (const m of mocks) {
        if (m && typeof m === 'object') {
            for (const key of Object.keys(m)) {
                if (m[key]?.mock?.resetCalls) {
                    m[key].mock.resetCalls();
                }
            }
        }
    }
}
/**
 * Create a delay promise for testing async operations
 */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Create a mock fetch function
 */
export function createMockFetch(response) {
    return mock.fn(async () => response);
}
//# sourceMappingURL=mocks.js.map