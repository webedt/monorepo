import { z } from 'zod';
/**
 * Configuration Schema for Autonomous Dev CLI
 *
 * This schema defines all configuration options available for the CLI.
 * Configuration can be provided via:
 *   1. JSON config file (autonomous-dev.config.json)
 *   2. Environment variables
 *   3. Default values
 *
 * Priority: Environment variables > Config file > Defaults
 *
 * SECURITY: Credentials should NEVER be stored in config files.
 * Use environment variables exclusively for production credentials.
 */
/**
 * Patterns that indicate potential credentials that should not be in config files
 */
const CREDENTIAL_PATTERNS = [
    /^sk-ant-/i, // Anthropic API keys
    /^ghp_/i, // GitHub personal access tokens
    /^gho_/i, // GitHub OAuth tokens
    /^github_pat_/i, // GitHub PATs
    /^sk-[a-zA-Z0-9]{20,}$/i, // OpenAI-style keys
    /^Bearer\s+/i, // Bearer tokens
    /^Basic\s+/i, // Basic auth
];
/**
 * Custom refinement to reject credentials in config values
 */
const noCredentialString = z.string().refine((val) => {
    if (!val || val.length < 10)
        return true;
    return !CREDENTIAL_PATTERNS.some(pattern => pattern.test(val));
}, { message: 'Credentials should not be stored in config files. Use environment variables instead.' });
export const ConfigSchema = z.object({
    /**
     * Target Repository Settings
     * Configure the GitHub repository that autonomous-dev will work with.
     */
    repo: z.object({
        /** GitHub username or organization that owns the repository (required) */
        owner: z.string().min(1, 'Repository owner is required'),
        /** Repository name (required) */
        name: z.string().min(1, 'Repository name is required'),
        /** Base branch for pull requests (default: 'main') */
        baseBranch: z.string().default('main'),
    }).describe('GitHub repository settings'),
    /**
     * Task Discovery Settings
     * Control how tasks are discovered and managed.
     */
    discovery: z.object({
        /** Number of tasks to discover per cycle (1-10, default: 5) */
        tasksPerCycle: z.number().min(1, 'Must discover at least 1 task').max(10, 'Maximum 10 tasks per cycle').default(5),
        /** Maximum open issues before pausing discovery (min: 1, default: 10) */
        maxOpenIssues: z.number().min(1, 'Must allow at least 1 open issue').default(10),
        /** File paths/patterns to exclude from analysis */
        excludePaths: z.array(z.string()).default([
            'node_modules',
            'dist',
            '.git',
            'coverage',
            '*.lock',
        ]),
        /** Label applied to auto-created GitHub issues */
        issueLabel: z.string().default('autonomous-dev'),
        /** Maximum directory depth for codebase scanning (1-20, default: 10) */
        maxDepth: z.number()
            .min(1, 'maxDepth must be at least 1')
            .max(20, 'maxDepth cannot exceed 20 to prevent excessive recursion')
            .default(10),
        /** Maximum number of files to scan (100-50000, default: 10000) */
        maxFiles: z.number()
            .min(100, 'maxFiles must be at least 100')
            .max(50000, 'maxFiles cannot exceed 50000 to prevent memory issues')
            .default(10000),
    }).describe('Task discovery configuration'),
    /**
     * Execution Settings
     * Control how tasks are executed.
     */
    execution: z.object({
        /** Number of parallel workers (1-10, default: 4) */
        parallelWorkers: z.number().min(1, 'Must have at least 1 worker').max(10, 'Maximum 10 workers').default(4),
        /** Task timeout in minutes (5-120, default: 30) */
        timeoutMinutes: z.number().min(5, 'Timeout must be at least 5 minutes').max(120, 'Timeout cannot exceed 120 minutes').default(30),
        /** Working directory for task execution */
        workDir: z.string().default('/tmp/autonomous-dev'),
    }).describe('Task execution settings'),
    /**
     * Evaluation Settings
     * Control quality checks before merging.
     */
    evaluation: z.object({
        /** Require build to pass before merging (default: true) */
        requireBuild: z.boolean().default(true),
        /** Require tests to pass before merging (default: true) */
        requireTests: z.boolean().default(true),
        /** Require health checks to pass (default: true) */
        requireHealthCheck: z.boolean().default(true),
        /** Require smoke tests to pass (default: false) */
        requireSmokeTests: z.boolean().default(false),
        /** URLs to check for health (array of URLs) */
        healthCheckUrls: z.array(z.string()).default([]),
        /** URLs for smoke tests (array of URLs) */
        smokeTestUrls: z.array(z.string()).default([]),
        /** URL pattern for preview deployments. Use {owner}, {repo}, {branch} placeholders */
        previewUrlPattern: z.string().default('https://github.etdofresh.com/{owner}/{repo}/{branch}/'),
    }).describe('Quality evaluation settings'),
    /**
     * Auto-merge Settings
     * Control how pull requests are merged.
     */
    merge: z.object({
        /** Automatically merge PRs that pass all checks (default: true) */
        autoMerge: z.boolean().default(true),
        /** Require all status checks to pass before merging (default: true) */
        requireAllChecks: z.boolean().default(true),
        /** Maximum merge retry attempts (1-5, default: 3) */
        maxRetries: z.number().min(1, 'Must retry at least once').max(5, 'Maximum 5 retries').default(3),
        /** Strategy for handling merge conflicts: 'rebase', 'merge', or 'manual' */
        conflictStrategy: z.enum(['rebase', 'merge', 'manual']).default('rebase'),
        /** Git merge method: 'merge', 'squash', or 'rebase' */
        mergeMethod: z.enum(['merge', 'squash', 'rebase']).default('squash'),
    }).describe('Pull request merge settings'),
    /**
     * Daemon Settings
     * Control the continuous daemon mode.
     */
    daemon: z.object({
        /** Interval between daemon cycles in milliseconds (min: 0, default: 60000 = 1 minute) */
        loopIntervalMs: z.number().min(0, 'Interval cannot be negative').default(60000),
        /** Pause between development cycles (default: true) */
        pauseBetweenCycles: z.boolean().default(true),
    }).describe('Daemon mode settings'),
    /**
     * Circuit Breaker Settings
     * Configure resilience for Claude API calls.
     */
    circuitBreaker: z.object({
        /** Number of consecutive failures before opening circuit (1-20, default: 5) */
        failureThreshold: z.number()
            .min(1, 'Failure threshold must be at least 1')
            .max(20, 'Failure threshold cannot exceed 20')
            .default(5),
        /** Time in milliseconds to keep circuit open before testing (10000-300000, default: 60000 = 60s) */
        resetTimeoutMs: z.number()
            .min(10000, 'Reset timeout must be at least 10 seconds')
            .max(300000, 'Reset timeout cannot exceed 5 minutes')
            .default(60000),
        /** Base delay for exponential backoff in milliseconds (50-1000, default: 100) */
        baseDelayMs: z.number()
            .min(50, 'Base delay must be at least 50ms')
            .max(1000, 'Base delay cannot exceed 1 second')
            .default(100),
        /** Maximum delay for exponential backoff in milliseconds (5000-60000, default: 30000 = 30s) */
        maxDelayMs: z.number()
            .min(5000, 'Max delay must be at least 5 seconds')
            .max(60000, 'Max delay cannot exceed 1 minute')
            .default(30000),
        /** Number of successful requests in half-open to close circuit (1-5, default: 1) */
        successThreshold: z.number()
            .min(1, 'Success threshold must be at least 1')
            .max(5, 'Success threshold cannot exceed 5')
            .default(1),
        /** Enable circuit breaker for Claude API calls (default: true) */
        enabled: z.boolean().default(true),
    }).describe('Circuit breaker resilience settings').default({}),
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
    credentials: z.object({
        /** GitHub personal access token (env: GITHUB_TOKEN) - DO NOT set in config file */
        githubToken: noCredentialString.optional(),
        /** Claude API authentication */
        claudeAuth: z.object({
            /** Claude access token (env: CLAUDE_ACCESS_TOKEN) - DO NOT set in config file */
            accessToken: noCredentialString,
            /** Claude refresh token (env: CLAUDE_REFRESH_TOKEN) - DO NOT set in config file */
            refreshToken: noCredentialString,
            /** Token expiration timestamp */
            expiresAt: z.number().optional(),
        }).optional(),
        /** Database URL for credential storage (env: DATABASE_URL) - DO NOT set in config file */
        databaseUrl: noCredentialString.optional(),
        /** User email for credential lookup (env: USER_EMAIL) */
        userEmail: z.string().email('Invalid email format').optional(),
    }).describe('Authentication credentials - USE ENVIRONMENT VARIABLES ONLY'),
});
/**
 * Validate that a config object doesn't contain embedded credentials
 * Returns an array of warning messages for any potential credential leaks
 */
export function validateNoCredentialsInConfig(config) {
    const warnings = [];
    const checkValue = (value, path) => {
        if (typeof value === 'string' && value.length >= 10) {
            if (CREDENTIAL_PATTERNS.some(pattern => pattern.test(value))) {
                warnings.push(`${path}: Potential credential detected. Use environment variables instead.`);
            }
        }
        else if (typeof value === 'object' && value !== null) {
            for (const [key, val] of Object.entries(value)) {
                checkValue(val, `${path}.${key}`);
            }
        }
    };
    checkValue(config, 'config');
    return warnings;
}
export const defaultConfig = {
    discovery: {
        tasksPerCycle: 5,
        maxOpenIssues: 10,
        excludePaths: ['node_modules', 'dist', '.git', 'coverage', '*.lock'],
        issueLabel: 'autonomous-dev',
        maxDepth: 10,
        maxFiles: 10000,
    },
    execution: {
        parallelWorkers: 4,
        timeoutMinutes: 30,
        workDir: '/tmp/autonomous-dev',
    },
    evaluation: {
        requireBuild: true,
        requireTests: true,
        requireHealthCheck: true,
        requireSmokeTests: false,
        healthCheckUrls: [],
        smokeTestUrls: [],
        previewUrlPattern: 'https://github.etdofresh.com/{owner}/{repo}/{branch}/',
    },
    merge: {
        autoMerge: true,
        requireAllChecks: true,
        maxRetries: 3,
        conflictStrategy: 'rebase',
        mergeMethod: 'squash',
    },
    daemon: {
        loopIntervalMs: 60000,
        pauseBetweenCycles: true,
    },
    circuitBreaker: {
        failureThreshold: 5,
        resetTimeoutMs: 60000,
        baseDelayMs: 100,
        maxDelayMs: 30000,
        successThreshold: 1,
        enabled: true,
    },
};
//# sourceMappingURL=schema.js.map