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
    daemon: {
        loopIntervalMs: number;
        pauseBetweenCycles: boolean;
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
}>;
export type Config = z.infer<typeof ConfigSchema>;
/**
 * Validate that a config object doesn't contain embedded credentials
 * Returns an array of warning messages for any potential credential leaks
 */
export declare function validateNoCredentialsInConfig(config: Partial<Config>): string[];
export declare const defaultConfig: Partial<Config>;
//# sourceMappingURL=schema.d.ts.map