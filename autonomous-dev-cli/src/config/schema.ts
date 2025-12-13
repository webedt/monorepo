import { z } from 'zod';

// Field metadata for enhanced error messages
export interface FieldMetadata {
  description: string;
  example: string;
  envVar?: string;
}

export const fieldMetadata: Record<string, FieldMetadata> = {
  'repo.owner': {
    description: 'GitHub repository owner (username or organization)',
    example: 'my-org',
    envVar: 'REPO_OWNER',
  },
  'repo.name': {
    description: 'GitHub repository name',
    example: 'my-project',
    envVar: 'REPO_NAME',
  },
  'repo.baseBranch': {
    description: 'Base branch for pull requests',
    example: 'main',
    envVar: 'REPO_BASE_BRANCH',
  },
  'discovery.tasksPerCycle': {
    description: 'Number of tasks to discover per cycle (1-10)',
    example: '5',
    envVar: 'TASKS_PER_CYCLE',
  },
  'discovery.maxOpenIssues': {
    description: 'Maximum number of open issues to maintain',
    example: '10',
    envVar: 'MAX_OPEN_ISSUES',
  },
  'discovery.excludePaths': {
    description: 'Glob patterns for paths to exclude from analysis',
    example: 'node_modules,dist,.git',
    envVar: 'EXCLUDE_PATHS',
  },
  'discovery.issueLabel': {
    description: 'Label to apply to auto-created issues',
    example: 'autonomous-dev',
    envVar: 'ISSUE_LABEL',
  },
  'execution.parallelWorkers': {
    description: 'Number of parallel workers for task execution (1-10)',
    example: '4',
    envVar: 'PARALLEL_WORKERS',
  },
  'execution.timeoutMinutes': {
    description: 'Timeout for task execution in minutes (5-120)',
    example: '30',
    envVar: 'TIMEOUT_MINUTES',
  },
  'execution.workDir': {
    description: 'Working directory for task execution',
    example: '/tmp/autonomous-dev',
    envVar: 'WORK_DIR',
  },
  'evaluation.requireBuild': {
    description: 'Whether to require successful build before merge',
    example: 'true',
    envVar: 'REQUIRE_BUILD',
  },
  'evaluation.requireTests': {
    description: 'Whether to require passing tests before merge',
    example: 'true',
    envVar: 'REQUIRE_TESTS',
  },
  'evaluation.requireHealthCheck': {
    description: 'Whether to require health check before merge',
    example: 'true',
    envVar: 'REQUIRE_HEALTH_CHECK',
  },
  'evaluation.requireSmokeTests': {
    description: 'Whether to require smoke tests before merge',
    example: 'false',
    envVar: 'REQUIRE_SMOKE_TESTS',
  },
  'evaluation.healthCheckUrls': {
    description: 'URLs to check for health verification',
    example: 'http://localhost:3000/health',
    envVar: 'HEALTH_CHECK_URLS',
  },
  'evaluation.smokeTestUrls': {
    description: 'URLs to check for smoke testing',
    example: 'http://localhost:3000/api/status',
    envVar: 'SMOKE_TEST_URLS',
  },
  'evaluation.previewUrlPattern': {
    description: 'URL pattern for preview deployments',
    example: 'https://preview-{branch}.example.com',
    envVar: 'PREVIEW_URL_PATTERN',
  },
  'merge.autoMerge': {
    description: 'Whether to automatically merge approved PRs',
    example: 'true',
    envVar: 'AUTO_MERGE',
  },
  'merge.requireAllChecks': {
    description: 'Whether to require all checks to pass before merge',
    example: 'true',
    envVar: 'REQUIRE_ALL_CHECKS',
  },
  'merge.maxRetries': {
    description: 'Maximum number of merge retry attempts (1-5)',
    example: '3',
    envVar: 'MAX_RETRIES',
  },
  'merge.conflictStrategy': {
    description: 'Strategy for handling merge conflicts',
    example: 'rebase',
    envVar: 'CONFLICT_STRATEGY',
  },
  'merge.mergeMethod': {
    description: 'Git merge method to use',
    example: 'squash',
    envVar: 'MERGE_METHOD',
  },
  'daemon.loopIntervalMs': {
    description: 'Interval between daemon cycles in milliseconds',
    example: '60000',
    envVar: 'LOOP_INTERVAL_MS',
  },
  'daemon.pauseBetweenCycles': {
    description: 'Whether to pause between daemon cycles',
    example: 'true',
    envVar: 'PAUSE_BETWEEN_CYCLES',
  },
  'credentials.githubToken': {
    description: 'GitHub personal access token with repo scope',
    example: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    envVar: 'GITHUB_TOKEN',
  },
  'credentials.claudeAuth.accessToken': {
    description: 'Claude API access token',
    example: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    envVar: 'CLAUDE_ACCESS_TOKEN',
  },
  'credentials.claudeAuth.refreshToken': {
    description: 'Claude API refresh token for token renewal',
    example: 'rt-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
    envVar: 'CLAUDE_REFRESH_TOKEN',
  },
  'credentials.claudeAuth.expiresAt': {
    description: 'Claude token expiration timestamp (Unix ms)',
    example: '1704067200000',
    envVar: 'CLAUDE_EXPIRES_AT',
  },
  'credentials.databaseUrl': {
    description: 'PostgreSQL connection string for credential storage',
    example: 'postgresql://user:pass@localhost:5432/db',
    envVar: 'DATABASE_URL',
  },
  'credentials.userEmail': {
    description: 'User email for database credential lookup',
    example: 'user@example.com',
    envVar: 'USER_EMAIL',
  },
};

export const ConfigSchema = z.object({
  // Target repository
  repo: z.object({
    owner: z.string().min(1, 'Repository owner is required'),
    name: z.string().min(1, 'Repository name is required'),
    baseBranch: z.string().default('main'),
  }),

  // Task discovery
  discovery: z.object({
    tasksPerCycle: z.number().min(1, 'Must be at least 1').max(10, 'Cannot exceed 10').default(5),
    maxOpenIssues: z.number().min(1, 'Must be at least 1').default(10),
    excludePaths: z.array(z.string()).default([
      'node_modules',
      'dist',
      '.git',
      'coverage',
      '*.lock',
    ]),
    issueLabel: z.string().default('autonomous-dev'),
  }),

  // Execution
  execution: z.object({
    parallelWorkers: z.number().min(1, 'Must be at least 1').max(10, 'Cannot exceed 10').default(4),
    timeoutMinutes: z.number().min(5, 'Must be at least 5 minutes').max(120, 'Cannot exceed 120 minutes').default(30),
    workDir: z.string().default('/tmp/autonomous-dev'),
  }),

  // Evaluation
  evaluation: z.object({
    requireBuild: z.boolean().default(true),
    requireTests: z.boolean().default(true),
    requireHealthCheck: z.boolean().default(true),
    requireSmokeTests: z.boolean().default(false),
    healthCheckUrls: z.array(z.string().url('Must be a valid URL')).default([]),
    smokeTestUrls: z.array(z.string().url('Must be a valid URL')).default([]),
    previewUrlPattern: z.string().default('https://github.etdofresh.com/{owner}/{repo}/{branch}/'),
  }),

  // Auto-merge
  merge: z.object({
    autoMerge: z.boolean().default(true),
    requireAllChecks: z.boolean().default(true),
    maxRetries: z.number().min(1, 'Must be at least 1').max(5, 'Cannot exceed 5').default(3),
    conflictStrategy: z.enum(['rebase', 'merge', 'manual'], {
      errorMap: () => ({ message: 'Must be one of: rebase, merge, manual' }),
    }).default('rebase'),
    mergeMethod: z.enum(['merge', 'squash', 'rebase'], {
      errorMap: () => ({ message: 'Must be one of: merge, squash, rebase' }),
    }).default('squash'),
  }),

  // Daemon
  daemon: z.object({
    loopIntervalMs: z.number().min(0, 'Must be non-negative').default(60000),
    pauseBetweenCycles: z.boolean().default(true),
  }),

  // Credentials (populated from DB or env)
  credentials: z.object({
    githubToken: z.string().optional(),
    claudeAuth: z.object({
      accessToken: z.string().min(1, 'Access token is required'),
      refreshToken: z.string(),
      expiresAt: z.number().optional(),
    }).optional(),
    databaseUrl: z.string().optional(),
    userEmail: z.string().email('Must be a valid email address').optional(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

// Profile schema for environment-specific configs
export const ProfileSchema = z.object({
  extends: z.string().optional(),
  ...ConfigSchema.shape,
}).partial().extend({
  extends: z.string().optional(),
});

export type ConfigProfile = z.infer<typeof ProfileSchema>;

export const defaultConfig: Partial<Config> = {
  discovery: {
    tasksPerCycle: 5,
    maxOpenIssues: 10,
    excludePaths: ['node_modules', 'dist', '.git', 'coverage', '*.lock'],
    issueLabel: 'autonomous-dev',
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
