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
 */
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
   * Credentials
   * Authentication credentials (typically set via environment variables).
   */
  credentials: z.object({
    /** GitHub personal access token (env: GITHUB_TOKEN) */
    githubToken: z.string().optional(),
    /** Claude API authentication */
    claudeAuth: z.object({
      /** Claude access token (env: CLAUDE_ACCESS_TOKEN) */
      accessToken: z.string(),
      /** Claude refresh token (env: CLAUDE_REFRESH_TOKEN) */
      refreshToken: z.string(),
      /** Token expiration timestamp */
      expiresAt: z.number().optional(),
    }).optional(),
    /** Database URL for credential storage (env: DATABASE_URL) */
    databaseUrl: z.string().optional(),
    /** User email for credential lookup (env: USER_EMAIL) */
    userEmail: z.string().email('Invalid email format').optional(),
  }).describe('Authentication credentials'),
});

export type Config = z.infer<typeof ConfigSchema>;

export const defaultConfig: Partial<Config> = {
  discovery: {
    tasksPerCycle: 5,
    maxOpenIssues: 10,
    excludePaths: ['node_modules', 'dist', '.git', 'coverage', '*.lock'],
    issueLabel: 'autonomous-dev',
    maxDepth: 10,
    maxFiles: 10000,
    cache: {
      enabled: true,
      maxAgeMs: 3600000,
      useGitInvalidation: true,
    },
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
};
