/**
 * Test Fixtures
 *
 * Pre-configured test data and scenarios for common testing patterns.
 * These fixtures provide consistent, realistic test data for unit and integration tests.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
// ============================================================================
// Configuration Fixtures
// ============================================================================
/**
 * Minimal valid configuration for testing
 */
export const minimalConfig = {
    repo: {
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
    },
};
/**
 * Full configuration with all options
 */
export const fullConfig = {
    repo: {
        owner: 'test-owner',
        name: 'test-repo',
        baseBranch: 'main',
    },
    discovery: {
        tasksPerCycle: 3,
        maxOpenIssues: 5,
        excludePaths: ['node_modules', 'dist', '.git'],
        issueLabel: 'autonomous-dev',
    },
    execution: {
        parallelWorkers: 2,
        timeoutMinutes: 30,
        workDir: '/tmp/test-work',
    },
    merge: {
        autoMerge: true,
        mergeMethod: 'squash',
        conflictStrategy: 'rebase',
        maxRetries: 3,
        requireAllChecks: true,
    },
    evaluation: {
        requireBuild: true,
        requireTests: true,
        requireHealthCheck: false,
        healthCheckUrls: [],
        previewUrlPattern: '',
    },
    daemon: {
        loopIntervalMs: 60000,
        pauseBetweenCycles: true,
    },
    logging: {
        format: 'json',
        level: 'info',
        includeCorrelationId: true,
        includeTimestamp: true,
        enableStructuredFileLogging: false,
    },
};
/**
 * Configuration for dry run mode
 */
export const dryRunConfig = {
    ...fullConfig,
    merge: {
        ...fullConfig.merge,
        autoMerge: false,
    },
};
// ============================================================================
// Issue Fixtures
// ============================================================================
/**
 * Sample issues with various states
 */
export const issueFixtures = {
    /**
     * New issue without labels
     */
    newIssue: {
        number: 1,
        title: 'Add user authentication',
        body: 'Implement JWT-based authentication for the API.',
        state: 'open',
        labels: [],
        htmlUrl: 'https://github.com/test-owner/test-repo/issues/1',
        createdAt: new Date().toISOString(),
        assignee: null,
    },
    /**
     * Issue marked for autonomous development
     */
    autonomousIssue: {
        number: 2,
        title: 'Fix navigation bug',
        body: 'Navigation menu does not collapse on mobile devices.',
        state: 'open',
        labels: ['autonomous-dev', 'bug', 'priority:high'],
        htmlUrl: 'https://github.com/test-owner/test-repo/issues/2',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        assignee: null,
    },
    /**
     * Issue being worked on
     */
    inProgressIssue: {
        number: 3,
        title: 'Update dependencies',
        body: 'Upgrade all npm dependencies to their latest versions.',
        state: 'open',
        labels: ['autonomous-dev', 'in-progress', 'maintenance'],
        htmlUrl: 'https://github.com/test-owner/test-repo/issues/3',
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        assignee: null,
    },
    /**
     * Closed issue
     */
    closedIssue: {
        number: 4,
        title: 'Completed feature',
        body: 'This feature has been implemented.',
        state: 'closed',
        labels: ['autonomous-dev', 'completed'],
        htmlUrl: 'https://github.com/test-owner/test-repo/issues/4',
        createdAt: new Date(Date.now() - 604800000).toISOString(),
        assignee: null,
    },
};
// ============================================================================
// Pull Request Fixtures
// ============================================================================
/**
 * Sample pull requests
 */
export const prFixtures = {
    /**
     * Open PR ready for review
     */
    openPR: {
        number: 10,
        title: 'Add user authentication',
        body: 'Implements #1\n\nAdds JWT-based authentication.',
        state: 'open',
        head: { ref: 'auto/1-add-user-authentication', sha: 'abc123' },
        base: { ref: 'main', sha: 'def456' },
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/10',
        mergeable: true,
        merged: false,
        draft: false,
    },
    /**
     * PR with merge conflicts
     */
    conflictingPR: {
        number: 11,
        title: 'Fix navigation bug',
        body: 'Implements #2\n\nFixes mobile navigation.',
        state: 'open',
        head: { ref: 'auto/2-fix-navigation-bug', sha: 'ghi789' },
        base: { ref: 'main', sha: 'jkl012' },
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/11',
        mergeable: false,
        merged: false,
        draft: false,
    },
    /**
     * Successfully merged PR
     */
    mergedPR: {
        number: 12,
        title: 'Update dependencies',
        body: 'Implements #3\n\nUpgrades all dependencies.',
        state: 'closed',
        head: { ref: 'auto/3-update-dependencies', sha: 'mno345' },
        base: { ref: 'main', sha: 'pqr678' },
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/12',
        mergeable: null,
        merged: true,
        draft: false,
    },
    /**
     * Draft PR
     */
    draftPR: {
        number: 13,
        title: 'Work in progress',
        body: 'This is still being worked on.',
        state: 'open',
        head: { ref: 'feature/wip', sha: 'stu901' },
        base: { ref: 'main', sha: 'vwx234' },
        htmlUrl: 'https://github.com/test-owner/test-repo/pull/13',
        mergeable: true,
        merged: false,
        draft: true,
    },
};
// ============================================================================
// Task Fixtures
// ============================================================================
/**
 * Sample discovered tasks
 */
export const taskFixtures = {
    /**
     * Simple feature task
     */
    simpleFeature: {
        title: 'Add loading spinner component',
        description: 'Create a reusable loading spinner component for async operations.',
        priority: 'medium',
        category: 'feature',
        estimatedComplexity: 'simple',
        affectedPaths: ['src/components/'],
        estimatedDurationMinutes: 30,
    },
    /**
     * Critical bug fix
     */
    criticalBugfix: {
        title: 'Fix memory leak in event handler',
        description: 'Event listeners are not being cleaned up properly, causing memory leaks.',
        priority: 'critical',
        category: 'bugfix',
        estimatedComplexity: 'moderate',
        affectedPaths: ['src/hooks/useEventListener.ts', 'src/utils/events.ts'],
        estimatedDurationMinutes: 60,
    },
    /**
     * Refactoring task
     */
    refactoring: {
        title: 'Extract API client into separate module',
        description: 'The API client code is duplicated across multiple files. Extract it into a dedicated module.',
        priority: 'low',
        category: 'refactoring',
        estimatedComplexity: 'complex',
        affectedPaths: ['src/api/', 'src/services/', 'src/utils/http.ts'],
        estimatedDurationMinutes: 120,
    },
    /**
     * Documentation task
     */
    documentation: {
        title: 'Add JSDoc comments to public API',
        description: 'Add comprehensive JSDoc comments to all exported functions and types.',
        priority: 'low',
        category: 'documentation',
        estimatedComplexity: 'simple',
        affectedPaths: ['src/'],
        estimatedDurationMinutes: 45,
    },
    /**
     * Test task
     */
    testing: {
        title: 'Add unit tests for user service',
        description: 'Create comprehensive unit tests for the user service module.',
        priority: 'high',
        category: 'testing',
        estimatedComplexity: 'moderate',
        affectedPaths: ['src/services/user.ts', 'src/services/user.test.ts'],
        estimatedDurationMinutes: 90,
    },
};
// ============================================================================
// Error Fixtures
// ============================================================================
/**
 * Sample error scenarios
 */
export const errorFixtures = {
    /**
     * GitHub rate limit error
     */
    rateLimitError: {
        code: 'GITHUB_RATE_LIMITED',
        message: 'API rate limit exceeded. Please wait before making more requests.',
        severity: 'transient',
    },
    /**
     * Authentication error
     */
    authError: {
        code: 'GITHUB_AUTH_FAILED',
        message: 'Authentication failed. Please check your GitHub token.',
        severity: 'critical',
    },
    /**
     * Network error
     */
    networkError: {
        code: 'GITHUB_NETWORK_ERROR',
        message: 'Network error occurred while connecting to GitHub API.',
        severity: 'transient',
    },
    /**
     * Timeout error
     */
    timeoutError: {
        code: 'CLAUDE_TIMEOUT',
        message: 'Claude API request timed out after 30 seconds.',
        severity: 'transient',
    },
    /**
     * Configuration error
     */
    configError: {
        code: 'CONFIG_INVALID',
        message: 'Invalid configuration: repo.owner is required.',
        severity: 'critical',
    },
};
// ============================================================================
// File System Fixtures
// ============================================================================
/**
 * Create a temporary test directory with a basic project structure
 */
export function createTestDirectory(prefix = 'test') {
    const testDir = join(tmpdir(), `${prefix}-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    return testDir;
}
/**
 * Create a mock project structure in a directory
 */
export function createMockProjectStructure(baseDir) {
    // Create directories
    const dirs = [
        'src',
        'src/components',
        'src/utils',
        'src/services',
        'tests',
        'node_modules',
    ];
    for (const dir of dirs) {
        mkdirSync(join(baseDir, dir), { recursive: true });
    }
    // Create package.json
    writeFileSync(join(baseDir, 'package.json'), JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
            build: 'tsc',
            test: 'jest',
        },
        dependencies: {
            react: '^18.0.0',
        },
        devDependencies: {
            typescript: '^5.0.0',
        },
    }, null, 2));
    // Create tsconfig.json
    writeFileSync(join(baseDir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
            strict: true,
        },
    }, null, 2));
    // Create sample source files
    writeFileSync(join(baseDir, 'src', 'index.ts'), 'export const main = () => console.log("Hello");');
    writeFileSync(join(baseDir, 'src', 'components', 'Button.tsx'), 'export const Button = () => <button>Click me</button>;');
    writeFileSync(join(baseDir, 'src', 'utils', 'helpers.ts'), '// TODO: Add more helpers\nexport const noop = () => {};');
}
/**
 * Clean up a test directory
 */
export function cleanupTestDirectory(dir) {
    if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
    }
}
// ============================================================================
// Service Health Fixtures
// ============================================================================
/**
 * Sample service health states
 */
export const serviceHealthFixtures = {
    /**
     * Healthy state
     */
    healthy: {
        status: 'healthy',
        circuitState: 'closed',
        consecutiveFailures: 0,
        consecutiveSuccesses: 10,
        rateLimitRemaining: 5000,
        lastSuccess: new Date(),
    },
    /**
     * Degraded state
     */
    degraded: {
        status: 'degraded',
        circuitState: 'half-open',
        consecutiveFailures: 3,
        consecutiveSuccesses: 0,
        rateLimitRemaining: 100,
        lastSuccess: new Date(Date.now() - 60000),
    },
    /**
     * Unavailable state
     */
    unavailable: {
        status: 'unavailable',
        circuitState: 'open',
        consecutiveFailures: 10,
        consecutiveSuccesses: 0,
        rateLimitRemaining: 0,
        lastSuccess: new Date(Date.now() - 300000),
    },
};
// ============================================================================
// Cycle Result Fixtures
// ============================================================================
/**
 * Sample cycle results
 */
export const cycleResultFixtures = {
    /**
     * Successful cycle
     */
    success: {
        success: true,
        tasksDiscovered: 3,
        tasksCompleted: 3,
        tasksFailed: 0,
        prsMerged: 3,
        duration: 60000,
        errors: [],
        degraded: false,
        serviceHealth: {
            github: serviceHealthFixtures.healthy,
            overallStatus: 'healthy',
            lastCheck: new Date(),
        },
    },
    /**
     * Partial success
     */
    partialSuccess: {
        success: false,
        tasksDiscovered: 5,
        tasksCompleted: 3,
        tasksFailed: 2,
        prsMerged: 2,
        duration: 120000,
        errors: [
            '[EXEC_TIMEOUT] Task 4 execution timed out',
            '[GITHUB_PR_CONFLICT] PR for task 5 has merge conflicts',
        ],
        degraded: true,
        serviceHealth: {
            github: serviceHealthFixtures.degraded,
            overallStatus: 'degraded',
            lastCheck: new Date(),
        },
    },
    /**
     * Complete failure
     */
    failure: {
        success: false,
        tasksDiscovered: 0,
        tasksCompleted: 0,
        tasksFailed: 0,
        prsMerged: 0,
        duration: 5000,
        errors: ['[GITHUB_AUTH_FAILED] Authentication failed'],
        degraded: true,
        serviceHealth: {
            github: serviceHealthFixtures.unavailable,
            overallStatus: 'unavailable',
            lastCheck: new Date(),
        },
    },
};
export default {
    config: {
        minimal: minimalConfig,
        full: fullConfig,
        dryRun: dryRunConfig,
    },
    issues: issueFixtures,
    prs: prFixtures,
    tasks: taskFixtures,
    errors: errorFixtures,
    serviceHealth: serviceHealthFixtures,
    cycleResults: cycleResultFixtures,
    createTestDirectory,
    createMockProjectStructure,
    cleanupTestDirectory,
};
//# sourceMappingURL=fixtures.js.map