/**
 * Test Fixtures
 *
 * Pre-configured test data and scenarios for common testing patterns.
 * These fixtures provide consistent, realistic test data for unit and integration tests.
 */
/**
 * Minimal valid configuration for testing
 */
export declare const minimalConfig: {
    repo: {
        owner: string;
        name: string;
        baseBranch: string;
    };
};
/**
 * Full configuration with all options
 */
export declare const fullConfig: {
    repo: {
        owner: string;
        name: string;
        baseBranch: string;
    };
    discovery: {
        tasksPerCycle: number;
        maxOpenIssues: number;
        excludePaths: string[];
        issueLabel: string;
    };
    execution: {
        parallelWorkers: number;
        timeoutMinutes: number;
        workDir: string;
    };
    merge: {
        autoMerge: boolean;
        mergeMethod: "squash";
        conflictStrategy: "rebase";
        maxRetries: number;
        requireAllChecks: boolean;
    };
    evaluation: {
        requireBuild: boolean;
        requireTests: boolean;
        requireHealthCheck: boolean;
        healthCheckUrls: never[];
        previewUrlPattern: string;
    };
    daemon: {
        loopIntervalMs: number;
        pauseBetweenCycles: boolean;
    };
    logging: {
        format: "json";
        level: "info";
        includeCorrelationId: boolean;
        includeTimestamp: boolean;
        enableStructuredFileLogging: boolean;
    };
};
/**
 * Configuration for dry run mode
 */
export declare const dryRunConfig: {
    merge: {
        autoMerge: boolean;
        mergeMethod: "squash";
        conflictStrategy: "rebase";
        maxRetries: number;
        requireAllChecks: boolean;
    };
    repo: {
        owner: string;
        name: string;
        baseBranch: string;
    };
    discovery: {
        tasksPerCycle: number;
        maxOpenIssues: number;
        excludePaths: string[];
        issueLabel: string;
    };
    execution: {
        parallelWorkers: number;
        timeoutMinutes: number;
        workDir: string;
    };
    evaluation: {
        requireBuild: boolean;
        requireTests: boolean;
        requireHealthCheck: boolean;
        healthCheckUrls: never[];
        previewUrlPattern: string;
    };
    daemon: {
        loopIntervalMs: number;
        pauseBetweenCycles: boolean;
    };
    logging: {
        format: "json";
        level: "info";
        includeCorrelationId: boolean;
        includeTimestamp: boolean;
        enableStructuredFileLogging: boolean;
    };
};
/**
 * Sample issues with various states
 */
export declare const issueFixtures: {
    /**
     * New issue without labels
     */
    newIssue: {
        number: number;
        title: string;
        body: string;
        state: "open";
        labels: never[];
        htmlUrl: string;
        createdAt: string;
        assignee: null;
    };
    /**
     * Issue marked for autonomous development
     */
    autonomousIssue: {
        number: number;
        title: string;
        body: string;
        state: "open";
        labels: string[];
        htmlUrl: string;
        createdAt: string;
        assignee: null;
    };
    /**
     * Issue being worked on
     */
    inProgressIssue: {
        number: number;
        title: string;
        body: string;
        state: "open";
        labels: string[];
        htmlUrl: string;
        createdAt: string;
        assignee: null;
    };
    /**
     * Closed issue
     */
    closedIssue: {
        number: number;
        title: string;
        body: string;
        state: "closed";
        labels: string[];
        htmlUrl: string;
        createdAt: string;
        assignee: null;
    };
};
/**
 * Sample pull requests
 */
export declare const prFixtures: {
    /**
     * Open PR ready for review
     */
    openPR: {
        number: number;
        title: string;
        body: string;
        state: "open";
        head: {
            ref: string;
            sha: string;
        };
        base: {
            ref: string;
            sha: string;
        };
        htmlUrl: string;
        mergeable: boolean;
        merged: boolean;
        draft: boolean;
    };
    /**
     * PR with merge conflicts
     */
    conflictingPR: {
        number: number;
        title: string;
        body: string;
        state: "open";
        head: {
            ref: string;
            sha: string;
        };
        base: {
            ref: string;
            sha: string;
        };
        htmlUrl: string;
        mergeable: boolean;
        merged: boolean;
        draft: boolean;
    };
    /**
     * Successfully merged PR
     */
    mergedPR: {
        number: number;
        title: string;
        body: string;
        state: "closed";
        head: {
            ref: string;
            sha: string;
        };
        base: {
            ref: string;
            sha: string;
        };
        htmlUrl: string;
        mergeable: null;
        merged: boolean;
        draft: boolean;
    };
    /**
     * Draft PR
     */
    draftPR: {
        number: number;
        title: string;
        body: string;
        state: "open";
        head: {
            ref: string;
            sha: string;
        };
        base: {
            ref: string;
            sha: string;
        };
        htmlUrl: string;
        mergeable: boolean;
        merged: boolean;
        draft: boolean;
    };
};
/**
 * Sample discovered tasks
 */
export declare const taskFixtures: {
    /**
     * Simple feature task
     */
    simpleFeature: {
        title: string;
        description: string;
        priority: "medium";
        category: "feature";
        estimatedComplexity: "simple";
        affectedPaths: string[];
        estimatedDurationMinutes: number;
    };
    /**
     * Critical bug fix
     */
    criticalBugfix: {
        title: string;
        description: string;
        priority: "critical";
        category: "bugfix";
        estimatedComplexity: "moderate";
        affectedPaths: string[];
        estimatedDurationMinutes: number;
    };
    /**
     * Refactoring task
     */
    refactoring: {
        title: string;
        description: string;
        priority: "low";
        category: "refactoring";
        estimatedComplexity: "complex";
        affectedPaths: string[];
        estimatedDurationMinutes: number;
    };
    /**
     * Documentation task
     */
    documentation: {
        title: string;
        description: string;
        priority: "low";
        category: "documentation";
        estimatedComplexity: "simple";
        affectedPaths: string[];
        estimatedDurationMinutes: number;
    };
    /**
     * Test task
     */
    testing: {
        title: string;
        description: string;
        priority: "high";
        category: "testing";
        estimatedComplexity: "moderate";
        affectedPaths: string[];
        estimatedDurationMinutes: number;
    };
};
/**
 * Sample error scenarios
 */
export declare const errorFixtures: {
    /**
     * GitHub rate limit error
     */
    rateLimitError: {
        code: string;
        message: string;
        severity: "transient";
    };
    /**
     * Authentication error
     */
    authError: {
        code: string;
        message: string;
        severity: "critical";
    };
    /**
     * Network error
     */
    networkError: {
        code: string;
        message: string;
        severity: "transient";
    };
    /**
     * Timeout error
     */
    timeoutError: {
        code: string;
        message: string;
        severity: "transient";
    };
    /**
     * Configuration error
     */
    configError: {
        code: string;
        message: string;
        severity: "critical";
    };
};
/**
 * Create a temporary test directory with a basic project structure
 */
export declare function createTestDirectory(prefix?: string): string;
/**
 * Create a mock project structure in a directory
 */
export declare function createMockProjectStructure(baseDir: string): void;
/**
 * Clean up a test directory
 */
export declare function cleanupTestDirectory(dir: string): void;
/**
 * Sample service health states
 */
export declare const serviceHealthFixtures: {
    /**
     * Healthy state
     */
    healthy: {
        status: "healthy";
        circuitState: "closed";
        consecutiveFailures: number;
        consecutiveSuccesses: number;
        rateLimitRemaining: number;
        lastSuccess: Date;
    };
    /**
     * Degraded state
     */
    degraded: {
        status: "degraded";
        circuitState: "half-open";
        consecutiveFailures: number;
        consecutiveSuccesses: number;
        rateLimitRemaining: number;
        lastSuccess: Date;
    };
    /**
     * Unavailable state
     */
    unavailable: {
        status: "unavailable";
        circuitState: "open";
        consecutiveFailures: number;
        consecutiveSuccesses: number;
        rateLimitRemaining: number;
        lastSuccess: Date;
    };
};
/**
 * Sample cycle results
 */
export declare const cycleResultFixtures: {
    /**
     * Successful cycle
     */
    success: {
        success: boolean;
        tasksDiscovered: number;
        tasksCompleted: number;
        tasksFailed: number;
        prsMerged: number;
        duration: number;
        errors: never[];
        degraded: boolean;
        serviceHealth: {
            github: {
                status: "healthy";
                circuitState: "closed";
                consecutiveFailures: number;
                consecutiveSuccesses: number;
                rateLimitRemaining: number;
                lastSuccess: Date;
            };
            overallStatus: "healthy";
            lastCheck: Date;
        };
    };
    /**
     * Partial success
     */
    partialSuccess: {
        success: boolean;
        tasksDiscovered: number;
        tasksCompleted: number;
        tasksFailed: number;
        prsMerged: number;
        duration: number;
        errors: string[];
        degraded: boolean;
        serviceHealth: {
            github: {
                status: "degraded";
                circuitState: "half-open";
                consecutiveFailures: number;
                consecutiveSuccesses: number;
                rateLimitRemaining: number;
                lastSuccess: Date;
            };
            overallStatus: "degraded";
            lastCheck: Date;
        };
    };
    /**
     * Complete failure
     */
    failure: {
        success: boolean;
        tasksDiscovered: number;
        tasksCompleted: number;
        tasksFailed: number;
        prsMerged: number;
        duration: number;
        errors: string[];
        degraded: boolean;
        serviceHealth: {
            github: {
                status: "unavailable";
                circuitState: "open";
                consecutiveFailures: number;
                consecutiveSuccesses: number;
                rateLimitRemaining: number;
                lastSuccess: Date;
            };
            overallStatus: "unavailable";
            lastCheck: Date;
        };
    };
};
declare const _default: {
    config: {
        minimal: {
            repo: {
                owner: string;
                name: string;
                baseBranch: string;
            };
        };
        full: {
            repo: {
                owner: string;
                name: string;
                baseBranch: string;
            };
            discovery: {
                tasksPerCycle: number;
                maxOpenIssues: number;
                excludePaths: string[];
                issueLabel: string;
            };
            execution: {
                parallelWorkers: number;
                timeoutMinutes: number;
                workDir: string;
            };
            merge: {
                autoMerge: boolean;
                mergeMethod: "squash";
                conflictStrategy: "rebase";
                maxRetries: number;
                requireAllChecks: boolean;
            };
            evaluation: {
                requireBuild: boolean;
                requireTests: boolean;
                requireHealthCheck: boolean;
                healthCheckUrls: never[];
                previewUrlPattern: string;
            };
            daemon: {
                loopIntervalMs: number;
                pauseBetweenCycles: boolean;
            };
            logging: {
                format: "json";
                level: "info";
                includeCorrelationId: boolean;
                includeTimestamp: boolean;
                enableStructuredFileLogging: boolean;
            };
        };
        dryRun: {
            merge: {
                autoMerge: boolean;
                mergeMethod: "squash";
                conflictStrategy: "rebase";
                maxRetries: number;
                requireAllChecks: boolean;
            };
            repo: {
                owner: string;
                name: string;
                baseBranch: string;
            };
            discovery: {
                tasksPerCycle: number;
                maxOpenIssues: number;
                excludePaths: string[];
                issueLabel: string;
            };
            execution: {
                parallelWorkers: number;
                timeoutMinutes: number;
                workDir: string;
            };
            evaluation: {
                requireBuild: boolean;
                requireTests: boolean;
                requireHealthCheck: boolean;
                healthCheckUrls: never[];
                previewUrlPattern: string;
            };
            daemon: {
                loopIntervalMs: number;
                pauseBetweenCycles: boolean;
            };
            logging: {
                format: "json";
                level: "info";
                includeCorrelationId: boolean;
                includeTimestamp: boolean;
                enableStructuredFileLogging: boolean;
            };
        };
    };
    issues: {
        /**
         * New issue without labels
         */
        newIssue: {
            number: number;
            title: string;
            body: string;
            state: "open";
            labels: never[];
            htmlUrl: string;
            createdAt: string;
            assignee: null;
        };
        /**
         * Issue marked for autonomous development
         */
        autonomousIssue: {
            number: number;
            title: string;
            body: string;
            state: "open";
            labels: string[];
            htmlUrl: string;
            createdAt: string;
            assignee: null;
        };
        /**
         * Issue being worked on
         */
        inProgressIssue: {
            number: number;
            title: string;
            body: string;
            state: "open";
            labels: string[];
            htmlUrl: string;
            createdAt: string;
            assignee: null;
        };
        /**
         * Closed issue
         */
        closedIssue: {
            number: number;
            title: string;
            body: string;
            state: "closed";
            labels: string[];
            htmlUrl: string;
            createdAt: string;
            assignee: null;
        };
    };
    prs: {
        /**
         * Open PR ready for review
         */
        openPR: {
            number: number;
            title: string;
            body: string;
            state: "open";
            head: {
                ref: string;
                sha: string;
            };
            base: {
                ref: string;
                sha: string;
            };
            htmlUrl: string;
            mergeable: boolean;
            merged: boolean;
            draft: boolean;
        };
        /**
         * PR with merge conflicts
         */
        conflictingPR: {
            number: number;
            title: string;
            body: string;
            state: "open";
            head: {
                ref: string;
                sha: string;
            };
            base: {
                ref: string;
                sha: string;
            };
            htmlUrl: string;
            mergeable: boolean;
            merged: boolean;
            draft: boolean;
        };
        /**
         * Successfully merged PR
         */
        mergedPR: {
            number: number;
            title: string;
            body: string;
            state: "closed";
            head: {
                ref: string;
                sha: string;
            };
            base: {
                ref: string;
                sha: string;
            };
            htmlUrl: string;
            mergeable: null;
            merged: boolean;
            draft: boolean;
        };
        /**
         * Draft PR
         */
        draftPR: {
            number: number;
            title: string;
            body: string;
            state: "open";
            head: {
                ref: string;
                sha: string;
            };
            base: {
                ref: string;
                sha: string;
            };
            htmlUrl: string;
            mergeable: boolean;
            merged: boolean;
            draft: boolean;
        };
    };
    tasks: {
        /**
         * Simple feature task
         */
        simpleFeature: {
            title: string;
            description: string;
            priority: "medium";
            category: "feature";
            estimatedComplexity: "simple";
            affectedPaths: string[];
            estimatedDurationMinutes: number;
        };
        /**
         * Critical bug fix
         */
        criticalBugfix: {
            title: string;
            description: string;
            priority: "critical";
            category: "bugfix";
            estimatedComplexity: "moderate";
            affectedPaths: string[];
            estimatedDurationMinutes: number;
        };
        /**
         * Refactoring task
         */
        refactoring: {
            title: string;
            description: string;
            priority: "low";
            category: "refactoring";
            estimatedComplexity: "complex";
            affectedPaths: string[];
            estimatedDurationMinutes: number;
        };
        /**
         * Documentation task
         */
        documentation: {
            title: string;
            description: string;
            priority: "low";
            category: "documentation";
            estimatedComplexity: "simple";
            affectedPaths: string[];
            estimatedDurationMinutes: number;
        };
        /**
         * Test task
         */
        testing: {
            title: string;
            description: string;
            priority: "high";
            category: "testing";
            estimatedComplexity: "moderate";
            affectedPaths: string[];
            estimatedDurationMinutes: number;
        };
    };
    errors: {
        /**
         * GitHub rate limit error
         */
        rateLimitError: {
            code: string;
            message: string;
            severity: "transient";
        };
        /**
         * Authentication error
         */
        authError: {
            code: string;
            message: string;
            severity: "critical";
        };
        /**
         * Network error
         */
        networkError: {
            code: string;
            message: string;
            severity: "transient";
        };
        /**
         * Timeout error
         */
        timeoutError: {
            code: string;
            message: string;
            severity: "transient";
        };
        /**
         * Configuration error
         */
        configError: {
            code: string;
            message: string;
            severity: "critical";
        };
    };
    serviceHealth: {
        /**
         * Healthy state
         */
        healthy: {
            status: "healthy";
            circuitState: "closed";
            consecutiveFailures: number;
            consecutiveSuccesses: number;
            rateLimitRemaining: number;
            lastSuccess: Date;
        };
        /**
         * Degraded state
         */
        degraded: {
            status: "degraded";
            circuitState: "half-open";
            consecutiveFailures: number;
            consecutiveSuccesses: number;
            rateLimitRemaining: number;
            lastSuccess: Date;
        };
        /**
         * Unavailable state
         */
        unavailable: {
            status: "unavailable";
            circuitState: "open";
            consecutiveFailures: number;
            consecutiveSuccesses: number;
            rateLimitRemaining: number;
            lastSuccess: Date;
        };
    };
    cycleResults: {
        /**
         * Successful cycle
         */
        success: {
            success: boolean;
            tasksDiscovered: number;
            tasksCompleted: number;
            tasksFailed: number;
            prsMerged: number;
            duration: number;
            errors: never[];
            degraded: boolean;
            serviceHealth: {
                github: {
                    status: "healthy";
                    circuitState: "closed";
                    consecutiveFailures: number;
                    consecutiveSuccesses: number;
                    rateLimitRemaining: number;
                    lastSuccess: Date;
                };
                overallStatus: "healthy";
                lastCheck: Date;
            };
        };
        /**
         * Partial success
         */
        partialSuccess: {
            success: boolean;
            tasksDiscovered: number;
            tasksCompleted: number;
            tasksFailed: number;
            prsMerged: number;
            duration: number;
            errors: string[];
            degraded: boolean;
            serviceHealth: {
                github: {
                    status: "degraded";
                    circuitState: "half-open";
                    consecutiveFailures: number;
                    consecutiveSuccesses: number;
                    rateLimitRemaining: number;
                    lastSuccess: Date;
                };
                overallStatus: "degraded";
                lastCheck: Date;
            };
        };
        /**
         * Complete failure
         */
        failure: {
            success: boolean;
            tasksDiscovered: number;
            tasksCompleted: number;
            tasksFailed: number;
            prsMerged: number;
            duration: number;
            errors: string[];
            degraded: boolean;
            serviceHealth: {
                github: {
                    status: "unavailable";
                    circuitState: "open";
                    consecutiveFailures: number;
                    consecutiveSuccesses: number;
                    rateLimitRemaining: number;
                    lastSuccess: Date;
                };
                overallStatus: "unavailable";
                lastCheck: Date;
            };
        };
    };
    createTestDirectory: typeof createTestDirectory;
    createMockProjectStructure: typeof createMockProjectStructure;
    cleanupTestDirectory: typeof cleanupTestDirectory;
};
export default _default;
//# sourceMappingURL=fixtures.d.ts.map