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
 *
 * INPUT VALIDATION:
 * - All user inputs are validated using Zod schemas
 * - Path traversal attacks are prevented
 * - Numeric bounds are enforced
 * - Email format is validated
 * - GitHub owner/name format is validated
 */

/**
 * Path traversal patterns to reject
 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,           // ../
  /\.\.\\/,           // ..\
  /\.\.$/,            // ends with ..
  /%2e%2e/i,          // URL encoded ..
  /%2f/i,             // URL encoded /
  /%5c/i,             // URL encoded \
  /\0/,               // null byte
];

/**
 * Custom refinement for safe paths (no traversal)
 */
const safePathString = z.string().refine(
  (val) => !PATH_TRAVERSAL_PATTERNS.some(pattern => pattern.test(val)),
  { message: 'Path contains potentially dangerous traversal patterns. Use absolute paths without ".." sequences.' }
);

/**
 * GitHub repository owner validation
 * - Must be 1-39 characters
 * - Alphanumeric with hyphens
 * - Cannot start or end with hyphen
 */
const githubOwnerString = z.string()
  .min(1, 'Repository owner is required')
  .max(39, 'GitHub username cannot exceed 39 characters')
  .regex(
    /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/,
    'Repository owner must be alphanumeric with hyphens, cannot start or end with hyphen'
  );

/**
 * GitHub repository name validation
 * - Must be 1-100 characters
 * - Alphanumeric, dots, underscores, and hyphens allowed
 */
const githubRepoNameString = z.string()
  .min(1, 'Repository name is required')
  .max(100, 'Repository name cannot exceed 100 characters')
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    'Repository name must contain only alphanumeric characters, dots, underscores, and hyphens'
  );

/**
 * Patterns that indicate potential credentials that should not be in config files
 */
const CREDENTIAL_PATTERNS = [
  /^sk-ant-/i,           // Anthropic API keys
  /^ghp_/i,              // GitHub personal access tokens
  /^gho_/i,              // GitHub OAuth tokens
  /^github_pat_/i,       // GitHub PATs
  /^sk-[a-zA-Z0-9]{20,}$/i,  // OpenAI-style keys
  /^Bearer\s+/i,         // Bearer tokens
  /^Basic\s+/i,          // Basic auth
];

/**
 * Custom refinement to reject credentials in config values
 */
const noCredentialString = z.string().refine(
  (val) => {
    if (!val || val.length < 10) return true;
    return !CREDENTIAL_PATTERNS.some(pattern => pattern.test(val));
  },
  { message: 'Credentials should not be stored in config files. Use environment variables instead.' }
);
/**
 * Current configuration schema version
 * Increment this when making breaking changes to the config format
 */
export const CURRENT_CONFIG_VERSION = 2;

/**
 * Supported configuration versions for migration
 */
export const SUPPORTED_CONFIG_VERSIONS = [1, 2] as const;
export type ConfigVersion = typeof SUPPORTED_CONFIG_VERSIONS[number];

export const ConfigSchema = z.object({
  /**
   * Configuration Version
   * Used for migration and compatibility checking.
   * If not specified, config is treated as v1 (legacy).
   */
  version: z.number()
    .min(1, 'Configuration version must be at least 1')
    .max(CURRENT_CONFIG_VERSION, `Configuration version cannot exceed ${CURRENT_CONFIG_VERSION}`)
    .default(CURRENT_CONFIG_VERSION)
    .describe('Configuration schema version for migration support'),

  /**
   * Target Repository Settings
   * Configure the GitHub repository that autonomous-dev will work with.
   */
  repo: z.object({
    /** GitHub username or organization that owns the repository (required) */
    owner: githubOwnerString.describe('GitHub username or organization (1-39 chars, alphanumeric with hyphens)'),
    /** Repository name (required) */
    name: githubRepoNameString.describe('Repository name (1-100 chars, alphanumeric with dots, underscores, hyphens)'),
    /** Base branch for pull requests (default: 'main') */
    baseBranch: z.string()
      .max(255, 'Branch name cannot exceed 255 characters')
      .regex(/^[a-zA-Z0-9._/-]+$/, 'Branch name contains invalid characters')
      .default('main'),
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
      '*.test.ts',
      '*.test.js',
      '*.spec.ts',
      '*.spec.js',
      '__tests__',
      '__mocks__',
      'test-utils',
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
    /** Analysis cache settings for incremental updates */
    cache: z.object({
      /** Whether caching is enabled (default: true) */
      enabled: z.boolean().default(true),
      /** Directory to store cache files relative to repo (default: .autonomous-dev-cache) */
      cacheDir: z.string().optional(),
      /** Maximum age of cache in milliseconds before forced refresh (default: 3600000 = 1 hour) */
      maxAgeMs: z.number()
        .min(0, 'maxAgeMs cannot be negative')
        .max(86400000, 'maxAgeMs cannot exceed 24 hours')
        .default(3600000),
      /** Whether to use git-based cache invalidation (default: true) */
      useGitInvalidation: z.boolean().default(true),
    }).default({
      enabled: true,
      maxAgeMs: 3600000,
      useGitInvalidation: true,
    }),
  }).describe('Task discovery configuration'),

  /**
   * Analysis Cache Settings
   * Control caching of codebase analysis results for improved performance.
   */
  cache: z.object({
    /** Enable caching of analysis results (default: true) */
    enabled: z.boolean().default(true),
    /** Maximum number of cached analysis entries (1-1000, default: 100) */
    maxEntries: z.number()
      .min(1, 'maxEntries must be at least 1')
      .max(1000, 'maxEntries cannot exceed 1000')
      .default(100),
    /** Time-to-live for cache entries in minutes (1-1440, default: 30) */
    ttlMinutes: z.number()
      .min(1, 'ttlMinutes must be at least 1')
      .max(1440, 'ttlMinutes cannot exceed 24 hours (1440 minutes)')
      .default(30),
    /** Maximum total cache size in megabytes (10-1000, default: 100) */
    maxSizeMB: z.number()
      .min(10, 'maxSizeMB must be at least 10MB')
      .max(1000, 'maxSizeMB cannot exceed 1GB')
      .default(100),
    /** Directory for persistent cache storage - validated for path traversal (default: .autonomous-dev-cache) */
    cacheDir: safePathString.default('.autonomous-dev-cache'),
    /** Enable persistent file-based caching across restarts (default: true) */
    persistToDisk: z.boolean().default(true),
    /** Use git commit hash for cache invalidation (default: true) */
    useGitInvalidation: z.boolean().default(true),
    /** Enable incremental analysis for changed files only (default: true) */
    enableIncrementalAnalysis: z.boolean().default(true),
    /** Warm cache during daemon startup (default: true) */
    warmOnStartup: z.boolean().default(true),
  }).describe('Analysis cache configuration').default({}),

  /**
   * Execution Settings
   * Control how tasks are executed.
   */
  execution: z.object({
    /** Number of parallel workers (1-10, default: 4) */
    parallelWorkers: z.number()
      .int('Worker count must be an integer')
      .min(1, 'Must have at least 1 worker')
      .max(10, 'Maximum 10 workers to prevent resource exhaustion')
      .default(4),
    /** Task timeout in minutes (5-120, default: 30) */
    timeoutMinutes: z.number()
      .int('Timeout must be an integer')
      .min(5, 'Timeout must be at least 5 minutes')
      .max(120, 'Timeout cannot exceed 120 minutes (2 hours)')
      .default(30),
    /** Working directory for task execution - validated for path traversal */
    workDir: safePathString.default('/tmp/autonomous-dev'),
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
   * Pull Request Management Settings
   * Configure advanced PR handling for autonomous workflows.
   */
  pullRequest: z.object({
    /** Create PRs as drafts initially, then convert to ready when complete (default: false) */
    useDraftPRs: z.boolean().default(false),
    /** Automatically assign reviewers from CODEOWNERS file (default: true) */
    autoAssignReviewers: z.boolean().default(true),
    /** Use PR template from .github/pull_request_template.md if available (default: true) */
    usePRTemplate: z.boolean().default(true),
    /** Generate AI-powered PR descriptions summarizing changes (default: true) */
    generateDescription: z.boolean().default(true),
    /** Add category-based labels to PRs (feature/bugfix/etc.) (default: true) */
    addCategoryLabels: z.boolean().default(true),
    /** Add priority-based labels to PRs (default: false) */
    addPriorityLabels: z.boolean().default(false),
    /** Default priority level for PRs: 'low', 'medium', 'high', 'critical' */
    defaultPriority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'),
    /** Check branch protection rules before attempting merge (default: true) */
    checkBranchProtection: z.boolean().default(true),
    /** Additional labels to add to all PRs created by the CLI */
    additionalLabels: z.array(z.string()).default(['autonomous-dev']),
    /** Default reviewers to request (in addition to CODEOWNERS) */
    defaultReviewers: z.array(z.string()).default([]),
    /** Maximum number of reviewers to request (default: 5) */
    maxReviewers: z.number().min(1).max(15).default(5),
    /** Include linked issue in PR description (default: true) */
    linkIssue: z.boolean().default(true),
    /** Include changed files list in PR description (default: true) */
    includeChangedFiles: z.boolean().default(true),
    /** Maximum number of changed files to list in description (default: 10) */
    maxChangedFilesInDescription: z.number().min(1).max(50).default(10),
  }).describe('Pull request management settings').default({}),

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
   * Logging Settings
   * Configure log output format and level for production/development environments.
   */
  logging: z.object({
    /** Log output format: 'pretty' for human-readable colored output, 'json' for structured JSON logs */
    format: z.enum(['pretty', 'json']).default('pretty'),
    /** Minimum log level to output: 'debug' (most verbose), 'info', 'warn', 'error' (least verbose) */
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    /** Include correlation ID prefix in all log entries (default: true) */
    includeCorrelationId: z.boolean().default(true),
    /** Include timestamps in log entries (default: true) */
    includeTimestamp: z.boolean().default(true),
    /** Enable structured JSON logging to file alongside console output (default: false) */
    enableStructuredFileLogging: z.boolean().default(false),
    /** Directory path for structured log files - validated for path traversal (default: './logs') */
    structuredLogDir: safePathString.default('./logs'),
    /** Maximum size of each log file in bytes before rotation (default: 10MB) */
    maxLogFileSizeBytes: z.number().min(1024 * 1024).max(1024 * 1024 * 1024).default(10 * 1024 * 1024),
    /** Number of rotated log files to retain (default: 5) */
    maxLogFiles: z.number().min(1).max(100).default(5),
    /** Include performance metrics in structured logs (default: true when structured logging enabled) */
    includeMetrics: z.boolean().default(true),
    /** Log rotation policy: 'size' for size-based, 'time' for time-based, 'both' for combined */
    rotationPolicy: z.enum(['size', 'time', 'both']).default('size'),
    /** Time-based rotation interval: 'hourly', 'daily', or 'weekly' */
    rotationInterval: z.enum(['hourly', 'daily', 'weekly']).default('daily'),
    /** Maximum age of log files in days before cleanup (default: 30) */
    maxLogAgeDays: z.number().min(1).max(365).default(30),
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
    debugMode: z.boolean().default(false),
    /**
     * Log Claude SDK interactions in detail (tool use, responses, timing).
     * Useful for debugging Claude execution issues.
     * Automatically enabled when debugMode is true.
     * (default: false)
     */
    logClaudeInteractions: z.boolean().default(false),
    /**
     * Log GitHub API request/response details including headers and timing.
     * Useful for debugging GitHub integration issues.
     * Automatically enabled when debugMode is true.
     * (default: false)
     */
    logApiDetails: z.boolean().default(false),
  }).describe('Logging configuration').default({}),

  /**
   * Alerting Settings
   * Configure alerting hooks for critical failures and monitoring.
   */
  alerting: z.object({
    /** Enable alerting system (default: true) */
    enabled: z.boolean().default(true),
    /** Webhook URL for sending alerts (optional) */
    webhookUrl: z.string().url().optional(),
    /** File path for alert logs - validated for path traversal (optional) */
    alertLogPath: safePathString.optional(),
    /** Minimum interval between repeated alerts in milliseconds (default: 60000 = 1 minute) */
    cooldownMs: z.number().min(1000).max(3600000).default(60000),
    /** Maximum alerts per minute for rate limiting (default: 30) */
    maxAlertsPerMinute: z.number().min(1).max(100).default(30),
    /** Enable console output for alerts (default: true) */
    consoleOutput: z.boolean().default(true),
    /** Minimum severity for webhook notifications: 'info', 'warning', 'error', 'critical' */
    webhookMinSeverity: z.enum(['info', 'warning', 'error', 'critical']).default('error'),
  }).describe('Alerting configuration').default({}),

  /**
   * Metrics Settings
   * Configure metrics collection and dashboard integration.
   */
  metrics: z.object({
    /** Enable performance regression detection (default: true) */
    enableRegressionDetection: z.boolean().default(true),
    /** Percentage threshold for regression detection (default: 20) */
    regressionThresholdPercent: z.number().min(5).max(100).default(20),
    /** Enable task complexity distribution tracking (default: true) */
    enableComplexityTracking: z.boolean().default(true),
    /** Number of samples for baseline calculation (default: 100) */
    baselineSampleSize: z.number().min(10).max(1000).default(100),
    /** Enable dashboard metrics endpoint (default: true) */
    enableDashboard: z.boolean().default(true),
    /** HTTP port for metrics endpoint (default: 9090) */
    metricsPort: z.number().min(1024).max(65535).default(9090),
  }).describe('Metrics configuration').default({}),

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
   * Retry Strategy Settings
   * Configure exponential backoff retry behavior for worker execution and API calls.
   */
  retryStrategy: z.object({
    /** Maximum number of retry attempts (1-10, default: 3) */
    maxRetries: z.number()
      .min(1, 'Max retries must be at least 1')
      .max(10, 'Max retries cannot exceed 10')
      .default(3),
    /** Base delay for exponential backoff in milliseconds (500-5000, default: 1000) */
    baseDelayMs: z.number()
      .min(500, 'Base delay must be at least 500ms')
      .max(5000, 'Base delay cannot exceed 5 seconds')
      .default(1000),
    /** Maximum delay cap in milliseconds (10000-300000, default: 60000 = 60s) */
    maxDelayMs: z.number()
      .min(10000, 'Max delay must be at least 10 seconds')
      .max(300000, 'Max delay cannot exceed 5 minutes')
      .default(60000),
    /** Backoff multiplier for exponential growth (1.5-4, default: 2) */
    backoffMultiplier: z.number()
      .min(1.5, 'Backoff multiplier must be at least 1.5')
      .max(4, 'Backoff multiplier cannot exceed 4')
      .default(2),
    /** Enable jitter to prevent thundering herd (default: true) */
    jitterEnabled: z.boolean().default(true),
    /** Jitter factor as percentage of delay (0.05-0.5, default: 0.25 for ±25%) */
    jitterFactor: z.number()
      .min(0.05, 'Jitter factor must be at least 0.05 (5%)')
      .max(0.5, 'Jitter factor cannot exceed 0.5 (50%)')
      .default(0.25),
    /** Enable retry for worker task execution (default: true) */
    enableWorkerRetry: z.boolean().default(true),
    /** Enable retry for GitHub API calls (default: true) */
    enableGitHubRetry: z.boolean().default(true),
  }).describe('Exponential backoff retry strategy settings').default({}),

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

export type Config = z.infer<typeof ConfigSchema>;

/**
 * Validate that a config object doesn't contain embedded credentials
 * Returns an array of warning messages for any potential credential leaks
 */
export function validateNoCredentialsInConfig(config: Partial<Config>): string[] {
  const warnings: string[] = [];

  const checkValue = (value: unknown, path: string): void => {
    if (typeof value === 'string' && value.length >= 10) {
      if (CREDENTIAL_PATTERNS.some(pattern => pattern.test(value))) {
        warnings.push(`${path}: Potential credential detected. Use environment variables instead.`);
      }
    } else if (typeof value === 'object' && value !== null) {
      for (const [key, val] of Object.entries(value)) {
        checkValue(val, `${path}.${key}`);
      }
    }
  };

  checkValue(config, 'config');
  return warnings;
}

export const defaultConfig: Partial<Config> = {
  version: CURRENT_CONFIG_VERSION,
  discovery: {
    tasksPerCycle: 5,
    maxOpenIssues: 10,
    excludePaths: [
      'node_modules',
      'dist',
      '.git',
      'coverage',
      '*.lock',
      '*.test.ts',
      '*.test.js',
      '*.spec.ts',
      '*.spec.js',
      '__tests__',
      '__mocks__',
      'test-utils',
    ],
    issueLabel: 'autonomous-dev',
    maxDepth: 10,
    maxFiles: 10000,
    cache: {
      enabled: true,
      maxAgeMs: 3600000,
      useGitInvalidation: true,
    },
  },
  cache: {
    enabled: true,
    maxEntries: 100,
    ttlMinutes: 30,
    maxSizeMB: 100,
    cacheDir: '.autonomous-dev-cache',
    persistToDisk: true,
    useGitInvalidation: true,
    enableIncrementalAnalysis: true,
    warmOnStartup: true,
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
  pullRequest: {
    useDraftPRs: false,
    autoAssignReviewers: true,
    usePRTemplate: true,
    generateDescription: true,
    addCategoryLabels: true,
    addPriorityLabels: false,
    defaultPriority: 'medium',
    checkBranchProtection: true,
    additionalLabels: ['autonomous-dev'],
    defaultReviewers: [],
    maxReviewers: 5,
    linkIssue: true,
    includeChangedFiles: true,
    maxChangedFilesInDescription: 10,
  },
  daemon: {
    loopIntervalMs: 60000,
    pauseBetweenCycles: true,
  },
  logging: {
    format: 'pretty',
    level: 'info',
    includeCorrelationId: true,
    includeTimestamp: true,
    enableStructuredFileLogging: false,
    structuredLogDir: './logs',
    maxLogFileSizeBytes: 10 * 1024 * 1024,
    maxLogFiles: 5,
    includeMetrics: true,
    rotationPolicy: 'size',
    rotationInterval: 'daily',
    maxLogAgeDays: 30,
    debugMode: false,
    logClaudeInteractions: false,
    logApiDetails: false,
  },
  alerting: {
    enabled: true,
    cooldownMs: 60000,
    maxAlertsPerMinute: 30,
    consoleOutput: true,
    webhookMinSeverity: 'error',
  },
  metrics: {
    enableRegressionDetection: true,
    regressionThresholdPercent: 20,
    enableComplexityTracking: true,
    baselineSampleSize: 100,
    enableDashboard: true,
    metricsPort: 9090,
  },
  circuitBreaker: {
    failureThreshold: 5,
    resetTimeoutMs: 60000,
    baseDelayMs: 100,
    maxDelayMs: 30000,
    successThreshold: 1,
    enabled: true,
  },
  retryStrategy: {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterEnabled: true,
    jitterFactor: 0.25,
    enableWorkerRetry: true,
    enableGitHubRetry: true,
  },
};
