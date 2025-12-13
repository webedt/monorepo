import { z } from 'zod';
export declare const ConfigSchema: z.ZodObject<{
    /**
     * Target Repository Settings
     * Configure the GitHub repository that autonomous-dev will work with.
     */
    repo: z.ZodObject<{
        /** GitHub username or organization that owns the repository (required) */
        owner: z.ZodString;
        /** Repository name (required) */
        name: z.ZodString;
        /** Base branch for pull requests (default: 'main') */
        baseBranch: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        owner: string;
        name: string;
        baseBranch: string;
    }, {
        owner: string;
        name: string;
        baseBranch?: string | undefined;
    }>;
    /**
     * Task Discovery Settings
     * Control how tasks are discovered and managed.
     */
    discovery: z.ZodObject<{
        /** Number of tasks to discover per cycle (1-10, default: 5) */
        tasksPerCycle: z.ZodDefault<z.ZodNumber>;
        /** Maximum open issues before pausing discovery (min: 1, default: 10) */
        maxOpenIssues: z.ZodDefault<z.ZodNumber>;
        /** File paths/patterns to exclude from analysis */
        excludePaths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Label applied to auto-created GitHub issues */
        issueLabel: z.ZodDefault<z.ZodString>;
        /** Maximum directory depth for codebase scanning (1-20, default: 10) */
        maxDepth: z.ZodDefault<z.ZodNumber>;
        /** Maximum number of files to scan (100-50000, default: 10000) */
        maxFiles: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        tasksPerCycle: number;
        maxOpenIssues: number;
        excludePaths: string[];
        issueLabel: string;
        maxDepth: number;
        maxFiles: number;
    }, {
        tasksPerCycle?: number | undefined;
        maxOpenIssues?: number | undefined;
        excludePaths?: string[] | undefined;
        issueLabel?: string | undefined;
        maxDepth?: number | undefined;
        maxFiles?: number | undefined;
    }>;
    /**
     * Execution Settings
     * Control how tasks are executed.
     */
    execution: z.ZodObject<{
        /** Number of parallel workers (1-10, default: 4) */
        parallelWorkers: z.ZodDefault<z.ZodNumber>;
        /** Task timeout in minutes (5-120, default: 30) */
        timeoutMinutes: z.ZodDefault<z.ZodNumber>;
        /** Working directory for task execution */
        workDir: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        parallelWorkers: number;
        timeoutMinutes: number;
        workDir: string;
    }, {
        parallelWorkers?: number | undefined;
        timeoutMinutes?: number | undefined;
        workDir?: string | undefined;
    }>;
    /**
     * Evaluation Settings
     * Control quality checks before merging.
     */
    evaluation: z.ZodObject<{
        /** Require build to pass before merging (default: true) */
        requireBuild: z.ZodDefault<z.ZodBoolean>;
        /** Require tests to pass before merging (default: true) */
        requireTests: z.ZodDefault<z.ZodBoolean>;
        /** Require health checks to pass (default: true) */
        requireHealthCheck: z.ZodDefault<z.ZodBoolean>;
        /** Require smoke tests to pass (default: false) */
        requireSmokeTests: z.ZodDefault<z.ZodBoolean>;
        /** URLs to check for health (array of URLs) */
        healthCheckUrls: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** URLs for smoke tests (array of URLs) */
        smokeTestUrls: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** URL pattern for preview deployments. Use {owner}, {repo}, {branch} placeholders */
        previewUrlPattern: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        requireBuild: boolean;
        requireTests: boolean;
        requireHealthCheck: boolean;
        requireSmokeTests: boolean;
        healthCheckUrls: string[];
        smokeTestUrls: string[];
        previewUrlPattern: string;
    }, {
        requireBuild?: boolean | undefined;
        requireTests?: boolean | undefined;
        requireHealthCheck?: boolean | undefined;
        requireSmokeTests?: boolean | undefined;
        healthCheckUrls?: string[] | undefined;
        smokeTestUrls?: string[] | undefined;
        previewUrlPattern?: string | undefined;
    }>;
    /**
     * Auto-merge Settings
     * Control how pull requests are merged.
     */
    merge: z.ZodObject<{
        /** Automatically merge PRs that pass all checks (default: true) */
        autoMerge: z.ZodDefault<z.ZodBoolean>;
        /** Require all status checks to pass before merging (default: true) */
        requireAllChecks: z.ZodDefault<z.ZodBoolean>;
        /** Maximum merge retry attempts (1-5, default: 3) */
        maxRetries: z.ZodDefault<z.ZodNumber>;
        /** Strategy for handling merge conflicts: 'rebase', 'merge', or 'manual' */
        conflictStrategy: z.ZodDefault<z.ZodEnum<["rebase", "merge", "manual"]>>;
        /** Git merge method: 'merge', 'squash', or 'rebase' */
        mergeMethod: z.ZodDefault<z.ZodEnum<["merge", "squash", "rebase"]>>;
    }, "strip", z.ZodTypeAny, {
        autoMerge: boolean;
        requireAllChecks: boolean;
        maxRetries: number;
        conflictStrategy: "rebase" | "merge" | "manual";
        mergeMethod: "rebase" | "merge" | "squash";
    }, {
        autoMerge?: boolean | undefined;
        requireAllChecks?: boolean | undefined;
        maxRetries?: number | undefined;
        conflictStrategy?: "rebase" | "merge" | "manual" | undefined;
        mergeMethod?: "rebase" | "merge" | "squash" | undefined;
    }>;
    /**
     * Pull Request Management Settings
     * Configure advanced PR handling for autonomous workflows.
     */
    pullRequest: z.ZodDefault<z.ZodObject<{
        /** Create PRs as drafts initially, then convert to ready when complete (default: false) */
        useDraftPRs: z.ZodDefault<z.ZodBoolean>;
        /** Automatically assign reviewers from CODEOWNERS file (default: true) */
        autoAssignReviewers: z.ZodDefault<z.ZodBoolean>;
        /** Use PR template from .github/pull_request_template.md if available (default: true) */
        usePRTemplate: z.ZodDefault<z.ZodBoolean>;
        /** Generate AI-powered PR descriptions summarizing changes (default: true) */
        generateDescription: z.ZodDefault<z.ZodBoolean>;
        /** Add category-based labels to PRs (feature/bugfix/etc.) (default: true) */
        addCategoryLabels: z.ZodDefault<z.ZodBoolean>;
        /** Add priority-based labels to PRs (default: false) */
        addPriorityLabels: z.ZodDefault<z.ZodBoolean>;
        /** Default priority level for PRs: 'low', 'medium', 'high', 'critical' */
        defaultPriority: z.ZodDefault<z.ZodEnum<["low", "medium", "high", "critical"]>>;
        /** Check branch protection rules before attempting merge (default: true) */
        checkBranchProtection: z.ZodDefault<z.ZodBoolean>;
        /** Additional labels to add to all PRs created by the CLI */
        additionalLabels: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Default reviewers to request (in addition to CODEOWNERS) */
        defaultReviewers: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        /** Maximum number of reviewers to request (default: 5) */
        maxReviewers: z.ZodDefault<z.ZodNumber>;
        /** Include linked issue in PR description (default: true) */
        linkIssue: z.ZodDefault<z.ZodBoolean>;
        /** Include changed files list in PR description (default: true) */
        includeChangedFiles: z.ZodDefault<z.ZodBoolean>;
        /** Maximum number of changed files to list in description (default: 10) */
        maxChangedFilesInDescription: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        useDraftPRs: boolean;
        autoAssignReviewers: boolean;
        usePRTemplate: boolean;
        generateDescription: boolean;
        addCategoryLabels: boolean;
        addPriorityLabels: boolean;
        defaultPriority: "low" | "medium" | "high" | "critical";
        checkBranchProtection: boolean;
        additionalLabels: string[];
        defaultReviewers: string[];
        maxReviewers: number;
        linkIssue: boolean;
        includeChangedFiles: boolean;
        maxChangedFilesInDescription: number;
    }, {
        useDraftPRs?: boolean | undefined;
        autoAssignReviewers?: boolean | undefined;
        usePRTemplate?: boolean | undefined;
        generateDescription?: boolean | undefined;
        addCategoryLabels?: boolean | undefined;
        addPriorityLabels?: boolean | undefined;
        defaultPriority?: "low" | "medium" | "high" | "critical" | undefined;
        checkBranchProtection?: boolean | undefined;
        additionalLabels?: string[] | undefined;
        defaultReviewers?: string[] | undefined;
        maxReviewers?: number | undefined;
        linkIssue?: boolean | undefined;
        includeChangedFiles?: boolean | undefined;
        maxChangedFilesInDescription?: number | undefined;
    }>>;
    /**
     * Daemon Settings
     * Control the continuous daemon mode.
     */
    daemon: z.ZodObject<{
        /** Interval between daemon cycles in milliseconds (min: 0, default: 60000 = 1 minute) */
        loopIntervalMs: z.ZodDefault<z.ZodNumber>;
        /** Pause between development cycles (default: true) */
        pauseBetweenCycles: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        loopIntervalMs: number;
        pauseBetweenCycles: boolean;
    }, {
        loopIntervalMs?: number | undefined;
        pauseBetweenCycles?: boolean | undefined;
    }>;
    /**
     * Logging Settings
     * Configure log output format and level for production/development environments.
     */
    logging: z.ZodDefault<z.ZodObject<{
        /** Log output format: 'pretty' for human-readable colored output, 'json' for structured JSON logs */
        format: z.ZodDefault<z.ZodEnum<["pretty", "json"]>>;
        /** Minimum log level to output: 'debug' (most verbose), 'info', 'warn', 'error' (least verbose) */
        level: z.ZodDefault<z.ZodEnum<["debug", "info", "warn", "error"]>>;
        /** Include correlation ID prefix in all log entries (default: true) */
        includeCorrelationId: z.ZodDefault<z.ZodBoolean>;
        /** Include timestamps in log entries (default: true) */
        includeTimestamp: z.ZodDefault<z.ZodBoolean>;
        /** Enable structured JSON logging to file alongside console output (default: false) */
        enableStructuredFileLogging: z.ZodDefault<z.ZodBoolean>;
        /** Directory path for structured log files (default: './logs') */
        structuredLogDir: z.ZodDefault<z.ZodString>;
        /** Maximum size of each log file in bytes before rotation (default: 10MB) */
        maxLogFileSizeBytes: z.ZodDefault<z.ZodNumber>;
        /** Number of rotated log files to retain (default: 5) */
        maxLogFiles: z.ZodDefault<z.ZodNumber>;
        /** Include performance metrics in structured logs (default: true when structured logging enabled) */
        includeMetrics: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        format: "pretty" | "json";
        level: "debug" | "info" | "warn" | "error";
        includeCorrelationId: boolean;
        includeTimestamp: boolean;
        enableStructuredFileLogging: boolean;
        structuredLogDir: string;
        maxLogFileSizeBytes: number;
        maxLogFiles: number;
        includeMetrics: boolean;
    }, {
        format?: "pretty" | "json" | undefined;
        level?: "debug" | "info" | "warn" | "error" | undefined;
        includeCorrelationId?: boolean | undefined;
        includeTimestamp?: boolean | undefined;
        enableStructuredFileLogging?: boolean | undefined;
        structuredLogDir?: string | undefined;
        maxLogFileSizeBytes?: number | undefined;
        maxLogFiles?: number | undefined;
        includeMetrics?: boolean | undefined;
    }>>;
    /**
     * Circuit Breaker Settings
     * Configure resilience for Claude API calls.
     */
    circuitBreaker: z.ZodDefault<z.ZodObject<{
        /** Number of consecutive failures before opening circuit (1-20, default: 5) */
        failureThreshold: z.ZodDefault<z.ZodNumber>;
        /** Time in milliseconds to keep circuit open before testing (10000-300000, default: 60000 = 60s) */
        resetTimeoutMs: z.ZodDefault<z.ZodNumber>;
        /** Base delay for exponential backoff in milliseconds (50-1000, default: 100) */
        baseDelayMs: z.ZodDefault<z.ZodNumber>;
        /** Maximum delay for exponential backoff in milliseconds (5000-60000, default: 30000 = 30s) */
        maxDelayMs: z.ZodDefault<z.ZodNumber>;
        /** Number of successful requests in half-open to close circuit (1-5, default: 1) */
        successThreshold: z.ZodDefault<z.ZodNumber>;
        /** Enable circuit breaker for Claude API calls (default: true) */
        enabled: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        failureThreshold: number;
        resetTimeoutMs: number;
        baseDelayMs: number;
        maxDelayMs: number;
        successThreshold: number;
        enabled: boolean;
    }, {
        failureThreshold?: number | undefined;
        resetTimeoutMs?: number | undefined;
        baseDelayMs?: number | undefined;
        maxDelayMs?: number | undefined;
        successThreshold?: number | undefined;
        enabled?: boolean | undefined;
    }>>;
    /**
     * Credentials
     * Authentication credentials (MUST be set via environment variables, NOT config files).
     *
     * SECURITY WARNING: Never store credentials in config files.
     * Use environment variables exclusively:
     *   - GITHUB_TOKEN for GitHub authentication
     *   - CLAUDE_ACCESS_TOKEN and CLAUDE_REFRESH_TOKEN for Claude
     *   - DATABASE_URL for database connections
     */
    credentials: z.ZodObject<{
        /** GitHub personal access token (env: GITHUB_TOKEN) - DO NOT set in config file */
        githubToken: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        /** Claude API authentication */
        claudeAuth: z.ZodOptional<z.ZodObject<{
            /** Claude access token (env: CLAUDE_ACCESS_TOKEN) - DO NOT set in config file */
            accessToken: z.ZodEffects<z.ZodString, string, string>;
            /** Claude refresh token (env: CLAUDE_REFRESH_TOKEN) - DO NOT set in config file */
            refreshToken: z.ZodEffects<z.ZodString, string, string>;
            /** Token expiration timestamp */
            expiresAt: z.ZodOptional<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        }, {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        }>>;
        /** Database URL for credential storage (env: DATABASE_URL) - DO NOT set in config file */
        databaseUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        /** User email for credential lookup (env: USER_EMAIL) */
        userEmail: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    }, {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    }>;
}, "strip", z.ZodTypeAny, {
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
        maxDepth: number;
        maxFiles: number;
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
        requireSmokeTests: boolean;
        healthCheckUrls: string[];
        smokeTestUrls: string[];
        previewUrlPattern: string;
    };
    merge: {
        autoMerge: boolean;
        requireAllChecks: boolean;
        maxRetries: number;
        conflictStrategy: "rebase" | "merge" | "manual";
        mergeMethod: "rebase" | "merge" | "squash";
    };
    pullRequest: {
        useDraftPRs: boolean;
        autoAssignReviewers: boolean;
        usePRTemplate: boolean;
        generateDescription: boolean;
        addCategoryLabels: boolean;
        addPriorityLabels: boolean;
        defaultPriority: "low" | "medium" | "high" | "critical";
        checkBranchProtection: boolean;
        additionalLabels: string[];
        defaultReviewers: string[];
        maxReviewers: number;
        linkIssue: boolean;
        includeChangedFiles: boolean;
        maxChangedFilesInDescription: number;
    };
    daemon: {
        loopIntervalMs: number;
        pauseBetweenCycles: boolean;
    };
    logging: {
        format: "pretty" | "json";
        level: "debug" | "info" | "warn" | "error";
        includeCorrelationId: boolean;
        includeTimestamp: boolean;
        enableStructuredFileLogging: boolean;
        structuredLogDir: string;
        maxLogFileSizeBytes: number;
        maxLogFiles: number;
        includeMetrics: boolean;
    };
    circuitBreaker: {
        failureThreshold: number;
        resetTimeoutMs: number;
        baseDelayMs: number;
        maxDelayMs: number;
        successThreshold: number;
        enabled: boolean;
    };
    credentials: {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    };
}, {
    repo: {
        owner: string;
        name: string;
        baseBranch?: string | undefined;
    };
    discovery: {
        tasksPerCycle?: number | undefined;
        maxOpenIssues?: number | undefined;
        excludePaths?: string[] | undefined;
        issueLabel?: string | undefined;
        maxDepth?: number | undefined;
        maxFiles?: number | undefined;
    };
    execution: {
        parallelWorkers?: number | undefined;
        timeoutMinutes?: number | undefined;
        workDir?: string | undefined;
    };
    evaluation: {
        requireBuild?: boolean | undefined;
        requireTests?: boolean | undefined;
        requireHealthCheck?: boolean | undefined;
        requireSmokeTests?: boolean | undefined;
        healthCheckUrls?: string[] | undefined;
        smokeTestUrls?: string[] | undefined;
        previewUrlPattern?: string | undefined;
    };
    merge: {
        autoMerge?: boolean | undefined;
        requireAllChecks?: boolean | undefined;
        maxRetries?: number | undefined;
        conflictStrategy?: "rebase" | "merge" | "manual" | undefined;
        mergeMethod?: "rebase" | "merge" | "squash" | undefined;
    };
    daemon: {
        loopIntervalMs?: number | undefined;
        pauseBetweenCycles?: boolean | undefined;
    };
    credentials: {
        githubToken?: string | undefined;
        claudeAuth?: {
            accessToken: string;
            refreshToken: string;
            expiresAt?: number | undefined;
        } | undefined;
        databaseUrl?: string | undefined;
        userEmail?: string | undefined;
    };
    pullRequest?: {
        useDraftPRs?: boolean | undefined;
        autoAssignReviewers?: boolean | undefined;
        usePRTemplate?: boolean | undefined;
        generateDescription?: boolean | undefined;
        addCategoryLabels?: boolean | undefined;
        addPriorityLabels?: boolean | undefined;
        defaultPriority?: "low" | "medium" | "high" | "critical" | undefined;
        checkBranchProtection?: boolean | undefined;
        additionalLabels?: string[] | undefined;
        defaultReviewers?: string[] | undefined;
        maxReviewers?: number | undefined;
        linkIssue?: boolean | undefined;
        includeChangedFiles?: boolean | undefined;
        maxChangedFilesInDescription?: number | undefined;
    } | undefined;
    logging?: {
        format?: "pretty" | "json" | undefined;
        level?: "debug" | "info" | "warn" | "error" | undefined;
        includeCorrelationId?: boolean | undefined;
        includeTimestamp?: boolean | undefined;
        enableStructuredFileLogging?: boolean | undefined;
        structuredLogDir?: string | undefined;
        maxLogFileSizeBytes?: number | undefined;
        maxLogFiles?: number | undefined;
        includeMetrics?: boolean | undefined;
    } | undefined;
    circuitBreaker?: {
        failureThreshold?: number | undefined;
        resetTimeoutMs?: number | undefined;
        baseDelayMs?: number | undefined;
        maxDelayMs?: number | undefined;
        successThreshold?: number | undefined;
        enabled?: boolean | undefined;
    } | undefined;
}>;
export type Config = z.infer<typeof ConfigSchema>;
/**
 * Validate that a config object doesn't contain embedded credentials
 * Returns an array of warning messages for any potential credential leaks
 */
export declare function validateNoCredentialsInConfig(config: Partial<Config>): string[];
export declare const defaultConfig: Partial<Config>;
//# sourceMappingURL=schema.d.ts.map