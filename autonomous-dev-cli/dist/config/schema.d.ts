import { z } from 'zod';
/**
 * Current configuration schema version
 * Increment this when making breaking changes to the config format
 */
export declare const CURRENT_CONFIG_VERSION = 2;
/**
 * Supported configuration versions for migration
 */
export declare const SUPPORTED_CONFIG_VERSIONS: readonly [1, 2];
export type ConfigVersion = typeof SUPPORTED_CONFIG_VERSIONS[number];
export declare const ConfigSchema: z.ZodObject<{
    /**
     * Configuration Version
     * Used for migration and compatibility checking.
     * If not specified, config is treated as v1 (legacy).
     */
    version: z.ZodDefault<z.ZodNumber>;
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
     * Analysis Cache Settings
     * Control caching of codebase analysis results for improved performance.
     */
    cache: z.ZodDefault<z.ZodObject<{
        /** Enable caching of analysis results (default: true) */
        enabled: z.ZodDefault<z.ZodBoolean>;
        /** Maximum number of cached analysis entries (1-1000, default: 100) */
        maxEntries: z.ZodDefault<z.ZodNumber>;
        /** Time-to-live for cache entries in minutes (1-1440, default: 30) */
        ttlMinutes: z.ZodDefault<z.ZodNumber>;
        /** Maximum total cache size in megabytes (10-1000, default: 100) */
        maxSizeMB: z.ZodDefault<z.ZodNumber>;
        /** Directory for persistent cache storage (default: .autonomous-dev-cache) */
        cacheDir: z.ZodDefault<z.ZodString>;
        /** Enable persistent file-based caching across restarts (default: true) */
        persistToDisk: z.ZodDefault<z.ZodBoolean>;
        /** Use git commit hash for cache invalidation (default: true) */
        useGitInvalidation: z.ZodDefault<z.ZodBoolean>;
        /** Enable incremental analysis for changed files only (default: true) */
        enableIncrementalAnalysis: z.ZodDefault<z.ZodBoolean>;
        /** Warm cache during daemon startup (default: true) */
        warmOnStartup: z.ZodDefault<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        maxEntries: number;
        ttlMinutes: number;
        maxSizeMB: number;
        cacheDir: string;
        persistToDisk: boolean;
        useGitInvalidation: boolean;
        enableIncrementalAnalysis: boolean;
        warmOnStartup: boolean;
    }, {
        enabled?: boolean | undefined;
        maxEntries?: number | undefined;
        ttlMinutes?: number | undefined;
        maxSizeMB?: number | undefined;
        cacheDir?: string | undefined;
        persistToDisk?: boolean | undefined;
        useGitInvalidation?: boolean | undefined;
        enableIncrementalAnalysis?: boolean | undefined;
        warmOnStartup?: boolean | undefined;
    }>>;
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
        /** Log rotation policy: 'size' for size-based, 'time' for time-based, 'both' for combined */
        rotationPolicy: z.ZodDefault<z.ZodEnum<["size", "time", "both"]>>;
        /** Time-based rotation interval: 'hourly', 'daily', or 'weekly' */
        rotationInterval: z.ZodDefault<z.ZodEnum<["hourly", "daily", "weekly"]>>;
        /** Maximum age of log files in days before cleanup (default: 30) */
        maxLogAgeDays: z.ZodDefault<z.ZodNumber>;
        /**
         * Enable debug mode for detailed troubleshooting.
         * When enabled, logs additional information including:
         * - Claude SDK tool invocations and responses
         * - GitHub API request/response details
         * - Internal state snapshots at decision points
         * - Timing data for all operations
         * Can also be enabled via DEBUG_MODE or AUTONOMOUS_DEV_DEBUG environment variables.
         * (default: false)
         */
        debugMode: z.ZodDefault<z.ZodBoolean>;
        /**
         * Log Claude SDK interactions in detail (tool use, responses, timing).
         * Useful for debugging Claude execution issues.
         * Automatically enabled when debugMode is true.
         * (default: false)
         */
        logClaudeInteractions: z.ZodDefault<z.ZodBoolean>;
        /**
         * Log GitHub API request/response details including headers and timing.
         * Useful for debugging GitHub integration issues.
         * Automatically enabled when debugMode is true.
         * (default: false)
         */
        logApiDetails: z.ZodDefault<z.ZodBoolean>;
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
        rotationPolicy: "size" | "time" | "both";
        rotationInterval: "hourly" | "daily" | "weekly";
        maxLogAgeDays: number;
        debugMode: boolean;
        logClaudeInteractions: boolean;
        logApiDetails: boolean;
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
        rotationPolicy?: "size" | "time" | "both" | undefined;
        rotationInterval?: "hourly" | "daily" | "weekly" | undefined;
        maxLogAgeDays?: number | undefined;
        debugMode?: boolean | undefined;
        logClaudeInteractions?: boolean | undefined;
        logApiDetails?: boolean | undefined;
    }>>;
    /**
     * Alerting Settings
     * Configure alerting hooks for critical failures and monitoring.
     */
    alerting: z.ZodDefault<z.ZodObject<{
        /** Enable alerting system (default: true) */
        enabled: z.ZodDefault<z.ZodBoolean>;
        /** Webhook URL for sending alerts (optional) */
        webhookUrl: z.ZodOptional<z.ZodString>;
        /** File path for alert logs (optional) */
        alertLogPath: z.ZodOptional<z.ZodString>;
        /** Minimum interval between repeated alerts in milliseconds (default: 60000 = 1 minute) */
        cooldownMs: z.ZodDefault<z.ZodNumber>;
        /** Maximum alerts per minute for rate limiting (default: 30) */
        maxAlertsPerMinute: z.ZodDefault<z.ZodNumber>;
        /** Enable console output for alerts (default: true) */
        consoleOutput: z.ZodDefault<z.ZodBoolean>;
        /** Minimum severity for webhook notifications: 'info', 'warning', 'error', 'critical' */
        webhookMinSeverity: z.ZodDefault<z.ZodEnum<["info", "warning", "error", "critical"]>>;
    }, "strip", z.ZodTypeAny, {
        enabled: boolean;
        cooldownMs: number;
        maxAlertsPerMinute: number;
        consoleOutput: boolean;
        webhookMinSeverity: "critical" | "info" | "error" | "warning";
        webhookUrl?: string | undefined;
        alertLogPath?: string | undefined;
    }, {
        enabled?: boolean | undefined;
        webhookUrl?: string | undefined;
        alertLogPath?: string | undefined;
        cooldownMs?: number | undefined;
        maxAlertsPerMinute?: number | undefined;
        consoleOutput?: boolean | undefined;
        webhookMinSeverity?: "critical" | "info" | "error" | "warning" | undefined;
    }>>;
    /**
     * Metrics Settings
     * Configure metrics collection and dashboard integration.
     */
    metrics: z.ZodDefault<z.ZodObject<{
        /** Enable performance regression detection (default: true) */
        enableRegressionDetection: z.ZodDefault<z.ZodBoolean>;
        /** Percentage threshold for regression detection (default: 20) */
        regressionThresholdPercent: z.ZodDefault<z.ZodNumber>;
        /** Enable task complexity distribution tracking (default: true) */
        enableComplexityTracking: z.ZodDefault<z.ZodBoolean>;
        /** Number of samples for baseline calculation (default: 100) */
        baselineSampleSize: z.ZodDefault<z.ZodNumber>;
        /** Enable dashboard metrics endpoint (default: true) */
        enableDashboard: z.ZodDefault<z.ZodBoolean>;
        /** HTTP port for metrics endpoint (default: 9090) */
        metricsPort: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        enableRegressionDetection: boolean;
        regressionThresholdPercent: number;
        enableComplexityTracking: boolean;
        baselineSampleSize: number;
        enableDashboard: boolean;
        metricsPort: number;
    }, {
        enableRegressionDetection?: boolean | undefined;
        regressionThresholdPercent?: number | undefined;
        enableComplexityTracking?: boolean | undefined;
        baselineSampleSize?: number | undefined;
        enableDashboard?: boolean | undefined;
        metricsPort?: number | undefined;
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
        enabled: boolean;
        failureThreshold: number;
        resetTimeoutMs: number;
        baseDelayMs: number;
        maxDelayMs: number;
        successThreshold: number;
    }, {
        enabled?: boolean | undefined;
        failureThreshold?: number | undefined;
        resetTimeoutMs?: number | undefined;
        baseDelayMs?: number | undefined;
        maxDelayMs?: number | undefined;
        successThreshold?: number | undefined;
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
    version: number;
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
    cache: {
        enabled: boolean;
        maxEntries: number;
        ttlMinutes: number;
        maxSizeMB: number;
        cacheDir: string;
        persistToDisk: boolean;
        useGitInvalidation: boolean;
        enableIncrementalAnalysis: boolean;
        warmOnStartup: boolean;
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
        rotationPolicy: "size" | "time" | "both";
        rotationInterval: "hourly" | "daily" | "weekly";
        maxLogAgeDays: number;
        debugMode: boolean;
        logClaudeInteractions: boolean;
        logApiDetails: boolean;
    };
    alerting: {
        enabled: boolean;
        cooldownMs: number;
        maxAlertsPerMinute: number;
        consoleOutput: boolean;
        webhookMinSeverity: "critical" | "info" | "error" | "warning";
        webhookUrl?: string | undefined;
        alertLogPath?: string | undefined;
    };
    metrics: {
        enableRegressionDetection: boolean;
        regressionThresholdPercent: number;
        enableComplexityTracking: boolean;
        baselineSampleSize: number;
        enableDashboard: boolean;
        metricsPort: number;
    };
    circuitBreaker: {
        enabled: boolean;
        failureThreshold: number;
        resetTimeoutMs: number;
        baseDelayMs: number;
        maxDelayMs: number;
        successThreshold: number;
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
    version?: number | undefined;
    cache?: {
        enabled?: boolean | undefined;
        maxEntries?: number | undefined;
        ttlMinutes?: number | undefined;
        maxSizeMB?: number | undefined;
        cacheDir?: string | undefined;
        persistToDisk?: boolean | undefined;
        useGitInvalidation?: boolean | undefined;
        enableIncrementalAnalysis?: boolean | undefined;
        warmOnStartup?: boolean | undefined;
    } | undefined;
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
        rotationPolicy?: "size" | "time" | "both" | undefined;
        rotationInterval?: "hourly" | "daily" | "weekly" | undefined;
        maxLogAgeDays?: number | undefined;
        debugMode?: boolean | undefined;
        logClaudeInteractions?: boolean | undefined;
        logApiDetails?: boolean | undefined;
    } | undefined;
    alerting?: {
        enabled?: boolean | undefined;
        webhookUrl?: string | undefined;
        alertLogPath?: string | undefined;
        cooldownMs?: number | undefined;
        maxAlertsPerMinute?: number | undefined;
        consoleOutput?: boolean | undefined;
        webhookMinSeverity?: "critical" | "info" | "error" | "warning" | undefined;
    } | undefined;
    metrics?: {
        enableRegressionDetection?: boolean | undefined;
        regressionThresholdPercent?: number | undefined;
        enableComplexityTracking?: boolean | undefined;
        baselineSampleSize?: number | undefined;
        enableDashboard?: boolean | undefined;
        metricsPort?: number | undefined;
    } | undefined;
    circuitBreaker?: {
        enabled?: boolean | undefined;
        failureThreshold?: number | undefined;
        resetTimeoutMs?: number | undefined;
        baseDelayMs?: number | undefined;
        maxDelayMs?: number | undefined;
        successThreshold?: number | undefined;
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