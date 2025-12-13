/**
 * Mock implementations for external dependencies used in testing.
 * Provides mocks for GitHub API, Claude SDK, and database operations.
 */
import { type Issue } from '../github/issues.js';
import { type PullRequest, type MergeResult } from '../github/pulls.js';
import { type ServiceHealth } from '../github/index.js';
/**
 * Create a mock Issue
 */
export declare function createMockIssue(overrides?: Partial<Issue>): Issue;
/**
 * Create a mock Pull Request
 */
export declare function createMockPR(overrides?: Partial<PullRequest>): PullRequest;
/**
 * Create a mock merge result
 */
export declare function createMockMergeResult(overrides?: Partial<MergeResult>): MergeResult;
/**
 * Create a mock service health status
 */
export declare function createMockServiceHealth(overrides?: Partial<ServiceHealth>): ServiceHealth;
/**
 * Create mock GitHub Issues manager
 */
export declare function createMockIssuesManager(overrides?: Record<string, any>): {
    listOpenIssues: import("node:test").Mock<() => Promise<Issue[]>>;
    listOpenIssuesWithFallback: import("node:test").Mock<() => Promise<{
        value: Issue[];
        degraded: boolean;
    }>>;
    getIssue: import("node:test").Mock<(number: number) => Promise<Issue>>;
    createIssue: import("node:test").Mock<(params: any) => Promise<Issue>>;
    updateIssue: import("node:test").Mock<() => Promise<Issue>>;
    closeIssue: import("node:test").Mock<() => Promise<void>>;
    addComment: import("node:test").Mock<() => Promise<{
        id: number;
        body: string;
    }>>;
    addCommentWithFallback: import("node:test").Mock<() => Promise<{
        value: {
            id: number;
            body: string;
        };
        degraded: boolean;
    }>>;
    addLabels: import("node:test").Mock<() => Promise<never[]>>;
    addLabelsWithFallback: import("node:test").Mock<() => Promise<{
        value: never[];
        degraded: boolean;
    }>>;
    removeLabel: import("node:test").Mock<() => Promise<void>>;
};
/**
 * Create mock GitHub Pulls manager
 */
export declare function createMockPullsManager(overrides?: Record<string, any>): {
    listOpenPRs: import("node:test").Mock<() => Promise<PullRequest[]>>;
    getPR: import("node:test").Mock<(number: number) => Promise<PullRequest>>;
    findPRForBranch: import("node:test").Mock<() => Promise<PullRequest>>;
    createPR: import("node:test").Mock<(params: any) => Promise<PullRequest>>;
    createPRWithFallback: import("node:test").Mock<() => Promise<{
        value: PullRequest;
        degraded: boolean;
    }>>;
    mergePR: import("node:test").Mock<() => Promise<MergeResult>>;
    closePR: import("node:test").Mock<() => Promise<void>>;
    updatePRFromBase: import("node:test").Mock<() => Promise<boolean>>;
    waitForMergeable: import("node:test").Mock<() => Promise<boolean>>;
    getChecksStatus: import("node:test").Mock<() => Promise<{
        state: string;
        statuses: never[];
    }>>;
};
/**
 * Create mock GitHub Branches manager
 */
export declare function createMockBranchesManager(overrides?: Record<string, any>): {
    getBranch: import("node:test").Mock<() => Promise<{
        name: string;
        sha: string;
        protected: boolean;
    }>>;
    listBranches: import("node:test").Mock<() => Promise<never[]>>;
    createBranch: import("node:test").Mock<() => Promise<{
        name: string;
        sha: string;
        protected: boolean;
    }>>;
    deleteBranch: import("node:test").Mock<() => Promise<void>>;
    branchExists: import("node:test").Mock<() => Promise<boolean>>;
};
/**
 * Create mock GitHub client
 */
export declare function createMockGitHubClient(overrides?: Record<string, any>): {
    verifyAuth: import("node:test").Mock<() => Promise<{
        login: string;
    }>>;
    getRepo: import("node:test").Mock<() => Promise<{
        fullName: string;
        defaultBranch: string;
    }>>;
    getServiceHealth: import("node:test").Mock<() => ServiceHealth>;
    isAvailable: import("node:test").Mock<() => boolean>;
    client: {};
    owner: string;
    repo: string;
};
/**
 * Create mock GitHub module (combines client, issues, pulls, branches)
 */
export declare function createMockGitHub(overrides?: Record<string, any>): {
    client: {
        verifyAuth: import("node:test").Mock<() => Promise<{
            login: string;
        }>>;
        getRepo: import("node:test").Mock<() => Promise<{
            fullName: string;
            defaultBranch: string;
        }>>;
        getServiceHealth: import("node:test").Mock<() => ServiceHealth>;
        isAvailable: import("node:test").Mock<() => boolean>;
        client: {};
        owner: string;
        repo: string;
    };
    issues: {
        listOpenIssues: import("node:test").Mock<() => Promise<Issue[]>>;
        listOpenIssuesWithFallback: import("node:test").Mock<() => Promise<{
            value: Issue[];
            degraded: boolean;
        }>>;
        getIssue: import("node:test").Mock<(number: number) => Promise<Issue>>;
        createIssue: import("node:test").Mock<(params: any) => Promise<Issue>>;
        updateIssue: import("node:test").Mock<() => Promise<Issue>>;
        closeIssue: import("node:test").Mock<() => Promise<void>>;
        addComment: import("node:test").Mock<() => Promise<{
            id: number;
            body: string;
        }>>;
        addCommentWithFallback: import("node:test").Mock<() => Promise<{
            value: {
                id: number;
                body: string;
            };
            degraded: boolean;
        }>>;
        addLabels: import("node:test").Mock<() => Promise<never[]>>;
        addLabelsWithFallback: import("node:test").Mock<() => Promise<{
            value: never[];
            degraded: boolean;
        }>>;
        removeLabel: import("node:test").Mock<() => Promise<void>>;
    };
    pulls: {
        listOpenPRs: import("node:test").Mock<() => Promise<PullRequest[]>>;
        getPR: import("node:test").Mock<(number: number) => Promise<PullRequest>>;
        findPRForBranch: import("node:test").Mock<() => Promise<PullRequest>>;
        createPR: import("node:test").Mock<(params: any) => Promise<PullRequest>>;
        createPRWithFallback: import("node:test").Mock<() => Promise<{
            value: PullRequest;
            degraded: boolean;
        }>>;
        mergePR: import("node:test").Mock<() => Promise<MergeResult>>;
        closePR: import("node:test").Mock<() => Promise<void>>;
        updatePRFromBase: import("node:test").Mock<() => Promise<boolean>>;
        waitForMergeable: import("node:test").Mock<() => Promise<boolean>>;
        getChecksStatus: import("node:test").Mock<() => Promise<{
            state: string;
            statuses: never[];
        }>>;
    };
    branches: {
        getBranch: import("node:test").Mock<() => Promise<{
            name: string;
            sha: string;
            protected: boolean;
        }>>;
        listBranches: import("node:test").Mock<() => Promise<never[]>>;
        createBranch: import("node:test").Mock<() => Promise<{
            name: string;
            sha: string;
            protected: boolean;
        }>>;
        deleteBranch: import("node:test").Mock<() => Promise<void>>;
        branchExists: import("node:test").Mock<() => Promise<boolean>>;
    };
};
/**
 * Create mock Claude query stream
 */
export declare function createMockClaudeStream(): {
    [Symbol.asyncIterator]: () => AsyncGenerator<{
        type: string;
        message: {
            content: {
                type: string;
                text: string;
            }[];
        };
        duration_ms?: undefined;
    } | {
        type: string;
        duration_ms: number;
        message?: undefined;
    }, void, unknown>;
};
/**
 * Create mock Claude API response
 */
export declare function createMockClaudeResponse(tasks?: any[]): {
    ok: boolean;
    json: () => Promise<{
        content: {
            text: string;
        }[];
    }>;
};
/**
 * Create mock database session
 */
export declare function createMockChatSession(overrides?: Record<string, any>): {
    id: string;
    userId: string;
    repositoryOwner: string;
    repositoryName: string;
    repositoryUrl: string;
    baseBranch: string;
    branch: null;
    status: string;
    provider: string;
    userRequest: string;
    createdAt: Date;
    completedAt: null;
    sessionPath: null;
};
/**
 * Create mock database operations
 */
export declare function createMockDatabase(overrides?: Record<string, any>): {
    initDatabase: import("node:test").Mock<() => Promise<void>>;
    closeDatabase: import("node:test").Mock<() => Promise<void>>;
    getUserCredentials: import("node:test").Mock<() => Promise<{
        userId: string;
        githubAccessToken: string;
        claudeAuth: {
            accessToken: string;
            refreshToken: string;
            expiresAt: number;
        };
    }>>;
    createChatSession: import("node:test").Mock<() => Promise<{
        id: string;
        userId: string;
        repositoryOwner: string;
        repositoryName: string;
        repositoryUrl: string;
        baseBranch: string;
        branch: null;
        status: string;
        provider: string;
        userRequest: string;
        createdAt: Date;
        completedAt: null;
        sessionPath: null;
    }>>;
    updateChatSession: import("node:test").Mock<() => Promise<{
        id: string;
        userId: string;
        repositoryOwner: string;
        repositoryName: string;
        repositoryUrl: string;
        baseBranch: string;
        branch: null;
        status: string;
        provider: string;
        userRequest: string;
        createdAt: Date;
        completedAt: null;
        sessionPath: null;
    }>>;
    addMessage: import("node:test").Mock<() => Promise<{
        id: string;
    }>>;
    addEvent: import("node:test").Mock<() => Promise<{
        id: string;
    }>>;
    generateSessionPath: import("node:test").Mock<() => string>;
};
/**
 * Create mock worker result
 */
export declare function createMockWorkerResult(overrides?: Record<string, any>): {
    success: boolean;
    issue: Issue;
    branchName: string;
    commitSha: string;
    duration: number;
    chatSessionId: string;
};
/**
 * Create mock worker pool
 */
export declare function createMockWorkerPool(overrides?: Record<string, any>): {
    executeTasks: import("node:test").Mock<(tasks: any[]) => Promise<{
        success: boolean;
        issue: Issue;
        branchName: string;
        commitSha: string;
        duration: number;
        chatSessionId: string;
    }[]>>;
    getStatus: import("node:test").Mock<() => {
        active: number;
        queued: number;
        completed: number;
        succeeded: number;
        failed: number;
    }>;
    stop: import("node:test").Mock<() => undefined>;
};
/**
 * Create mock merge attempt result
 */
export declare function createMockMergeAttemptResult(overrides?: Record<string, any>): {
    success: boolean;
    pr: PullRequest;
    merged: boolean;
    sha: string;
    attempts: number;
};
/**
 * Create mock conflict resolver
 */
export declare function createMockConflictResolver(overrides?: Record<string, any>): {
    attemptMerge: import("node:test").Mock<() => Promise<{
        success: boolean;
        pr: PullRequest;
        merged: boolean;
        sha: string;
        attempts: number;
    }>>;
    mergeSequentially: import("node:test").Mock<(branches: any[]) => Promise<Map<any, any>>>;
};
/**
 * Create mock discovered task
 */
export declare function createMockDiscoveredTask(overrides?: Record<string, any>): {
    title: string;
    description: string;
    priority: "medium";
    category: "feature";
    estimatedComplexity: "simple";
    affectedPaths: string[];
    estimatedDurationMinutes: number;
};
/**
 * Create mock codebase analysis
 */
export declare function createMockCodebaseAnalysis(overrides?: Record<string, any>): {
    structure: ({
        name: string;
        path: string;
        type: "directory";
        children: never[];
    } | {
        name: string;
        path: string;
        type: "file";
        children?: undefined;
    })[];
    fileCount: number;
    todoComments: never[];
    recentChanges: never[];
    packages: {
        name: string;
        path: string;
        dependencies: string[];
        scripts: {
            test: string;
            build: string;
        };
    }[];
    configFiles: string[];
};
/**
 * Create mock simple-git instance
 */
export declare function createMockGit(overrides?: Record<string, any>): {
    clone: import("node:test").Mock<() => Promise<void>>;
    init: import("node:test").Mock<() => Promise<void>>;
    addRemote: import("node:test").Mock<() => Promise<void>>;
    raw: import("node:test").Mock<() => Promise<string>>;
    fetch: import("node:test").Mock<() => Promise<void>>;
    checkout: import("node:test").Mock<() => Promise<void>>;
    checkoutLocalBranch: import("node:test").Mock<() => Promise<void>>;
    add: import("node:test").Mock<() => Promise<void>>;
    commit: import("node:test").Mock<() => Promise<{
        commit: string;
    }>>;
    push: import("node:test").Mock<() => Promise<void>>;
    status: import("node:test").Mock<() => Promise<{
        isClean: () => false;
    }>>;
    addConfig: import("node:test").Mock<() => Promise<void>>;
};
/**
 * Create mock metrics
 */
export declare function createMockMetrics(overrides?: Record<string, any>): {
    updateHealthStatus: import("node:test").Mock<() => undefined>;
    recordCycleCompletion: import("node:test").Mock<() => undefined>;
    recordTaskCompletion: import("node:test").Mock<() => undefined>;
    recordToolUsage: import("node:test").Mock<() => undefined>;
    recordError: import("node:test").Mock<() => undefined>;
    githubApiCallsTotal: {
        inc: import("node:test").Mock<(...args: any[]) => undefined>;
    };
    githubApiErrorsTotal: {
        inc: import("node:test").Mock<(...args: any[]) => undefined>;
    };
    claudeApiCallsTotal: {
        inc: import("node:test").Mock<(...args: any[]) => undefined>;
    };
    claudeApiErrorsTotal: {
        inc: import("node:test").Mock<(...args: any[]) => undefined>;
    };
    prsCreatedTotal: {
        inc: import("node:test").Mock<(...args: any[]) => undefined>;
    };
    prsMergedTotal: {
        inc: import("node:test").Mock<(...args: any[]) => undefined>;
    };
};
/**
 * Reset all mock function calls
 */
export declare function resetMocks(...mocks: any[]): void;
/**
 * Create a delay promise for testing async operations
 */
export declare function delay(ms: number): Promise<void>;
/**
 * Create a mock fetch function
 */
export declare function createMockFetch(response: any): import("node:test").Mock<() => Promise<any>>;
//# sourceMappingURL=mocks.d.ts.map