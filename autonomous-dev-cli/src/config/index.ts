import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigSchema, defaultConfig, validateNoCredentialsInConfig, type Config } from './schema.js';
import { logger } from '../utils/logger.js';
import { ZodError, ZodIssue } from 'zod';
import {
  ConfigError,
  ErrorCode,
  type ErrorContext,
  type RecoveryAction,
} from '../utils/errors.js';

// Load .env file
loadEnv();

/**
 * Configuration field metadata for help and validation suggestions
 */
const configFieldHelp: Record<string, { description: string; envVar?: string; suggestion?: string; example?: string }> = {
  'repo.owner': {
    description: 'GitHub repository owner (username or organization)',
    envVar: 'REPO_OWNER',
    suggestion: 'Set the GitHub username or organization that owns the repository',
    example: 'myusername',
  },
  'repo.name': {
    description: 'GitHub repository name',
    envVar: 'REPO_NAME',
    suggestion: 'Set the name of your GitHub repository',
    example: 'my-project',
  },
  'repo.baseBranch': {
    description: 'Base branch for pull requests',
    envVar: 'REPO_BASE_BRANCH',
    suggestion: 'Typically "main" or "master"',
    example: 'main',
  },
  'discovery.tasksPerCycle': {
    description: 'Number of tasks to discover per cycle (1-10)',
    envVar: 'TASKS_PER_CYCLE',
    suggestion: 'Start with 3-5 tasks for balanced discovery',
    example: '5',
  },
  'discovery.maxOpenIssues': {
    description: 'Maximum number of open issues before pausing discovery',
    envVar: 'MAX_OPEN_ISSUES',
    suggestion: 'Set higher for faster development, lower for more control',
    example: '10',
  },
  'discovery.excludePaths': {
    description: 'Paths to exclude from analysis',
    envVar: 'EXCLUDE_PATHS',
    suggestion: 'Comma-separated list of paths/patterns to ignore',
    example: 'node_modules,dist,.git',
  },
  'discovery.issueLabel': {
    description: 'Label applied to auto-created issues',
    envVar: 'ISSUE_LABEL',
    suggestion: 'Use a unique label to track autonomous issues',
    example: 'autonomous-dev',
  },
  'execution.parallelWorkers': {
    description: 'Number of parallel task workers (1-10)',
    envVar: 'PARALLEL_WORKERS',
    suggestion: 'Match to available CPU cores, typically 2-4',
    example: '4',
  },
  'execution.timeoutMinutes': {
    description: 'Task execution timeout in minutes (5-120)',
    envVar: 'TIMEOUT_MINUTES',
    suggestion: 'Allow enough time for complex tasks, typically 30-60 minutes',
    example: '30',
  },
  'execution.workDir': {
    description: 'Working directory for task execution',
    envVar: 'WORK_DIR',
    suggestion: 'Use a temporary directory with sufficient space',
    example: '/tmp/autonomous-dev',
  },
  'evaluation.requireBuild': {
    description: 'Require build to pass before merging',
    envVar: 'REQUIRE_BUILD',
    suggestion: 'Set to "true" for production repos, "false" for experimentation',
    example: 'true',
  },
  'evaluation.requireTests': {
    description: 'Require tests to pass before merging',
    envVar: 'REQUIRE_TESTS',
    suggestion: 'Recommended to keep enabled for code quality',
    example: 'true',
  },
  'evaluation.requireHealthCheck': {
    description: 'Require health checks to pass',
    envVar: 'REQUIRE_HEALTH_CHECK',
    suggestion: 'Enable if you have health check endpoints configured',
    example: 'false',
  },
  'merge.autoMerge': {
    description: 'Automatically merge PRs that pass all checks',
    envVar: 'AUTO_MERGE',
    suggestion: 'Disable for manual review of all changes',
    example: 'true',
  },
  'merge.mergeMethod': {
    description: 'Git merge method (merge, squash, rebase)',
    envVar: 'MERGE_METHOD',
    suggestion: 'Use "squash" for clean history, "merge" for detailed commits',
    example: 'squash',
  },
  'merge.conflictStrategy': {
    description: 'Strategy for handling merge conflicts (rebase, merge, manual)',
    envVar: 'CONFLICT_STRATEGY',
    suggestion: 'Use "rebase" for automatic resolution, "manual" for complex repos',
    example: 'rebase',
  },
  'credentials.githubToken': {
    description: 'GitHub personal access token',
    envVar: 'GITHUB_TOKEN',
    suggestion: 'Create a token at https://github.com/settings/tokens with repo scope',
    example: 'ghp_xxxxxxxxxxxx',
  },
  'credentials.claudeAuth': {
    description: 'Claude API authentication credentials',
    envVar: 'CLAUDE_ACCESS_TOKEN',
    suggestion: 'Set CLAUDE_ACCESS_TOKEN and optionally CLAUDE_REFRESH_TOKEN',
    example: 'sk-ant-xxxxxxxxxxxx',
  },
  'credentials.databaseUrl': {
    description: 'Database connection URL (optional)',
    envVar: 'DATABASE_URL',
    suggestion: 'PostgreSQL connection string for credential storage',
    example: 'postgresql://user:pass@host:5432/db',
  },
  'credentials.userEmail': {
    description: 'User email for credential lookup',
    envVar: 'USER_EMAIL',
    suggestion: 'Email address associated with stored credentials',
    example: 'user@example.com',
  },
  'daemon.loopIntervalMs': {
    description: 'Interval between daemon cycles in milliseconds',
    envVar: 'LOOP_INTERVAL_MS',
    suggestion: 'Default is 60000 (1 minute), increase for less frequent runs',
    example: '60000',
  },
  'daemon.pauseBetweenCycles': {
    description: 'Whether to pause between development cycles',
    envVar: 'PAUSE_BETWEEN_CYCLES',
    suggestion: 'Enable to allow time for review between cycles',
    example: 'true',
  },
};

/**
 * Get helpful suggestion for a validation error
 */
function getValidationSuggestion(issue: ZodIssue): string {
  const path = issue.path.join('.');
  const help = configFieldHelp[path];

  let suggestion = '';

  // Add field-specific help if available
  if (help) {
    suggestion += `\n    Description: ${help.description}`;
    if (help.envVar) {
      suggestion += `\n    Environment variable: ${help.envVar}`;
    }
    if (help.suggestion) {
      suggestion += `\n    Suggestion: ${help.suggestion}`;
    }
    if (help.example) {
      suggestion += `\n    Example: ${help.example}`;
    }
  }

  // Add error-type specific suggestions
  switch (issue.code) {
    case 'invalid_type':
      if (issue.expected === 'string' && issue.received === 'undefined') {
        suggestion += '\n    This field is required but was not provided.';
      } else {
        suggestion += `\n    Expected ${issue.expected}, but received ${issue.received}.`;
      }
      break;
    case 'too_small':
      suggestion += `\n    Value is too small. Minimum: ${(issue as any).minimum}`;
      break;
    case 'too_big':
      suggestion += `\n    Value is too large. Maximum: ${(issue as any).maximum}`;
      break;
    case 'invalid_enum_value':
      suggestion += `\n    Valid options: ${(issue as any).options?.join(', ') || 'see documentation'}`;
      break;
    case 'invalid_string':
      if ((issue as any).validation === 'email') {
        suggestion += '\n    Please provide a valid email address.';
      }
      break;
  }

  return suggestion;
}

/**
 * Build recovery actions from validation errors
 */
function buildRecoveryActionsFromValidation(errors: ZodIssue[]): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  // Add field-specific actions
  for (const issue of errors) {
    const path = issue.path.join('.');
    const help = configFieldHelp[path];

    if (help?.envVar) {
      actions.push({
        description: `Set the ${help.envVar} environment variable`,
        automatic: false,
      });
    }
  }

  // Add general recovery actions
  actions.push({
    description: 'Run "autonomous-dev init" to create a new configuration file',
    automatic: false,
  });
  actions.push({
    description: 'Run "autonomous-dev help-config" for detailed configuration documentation',
    automatic: false,
  });
  actions.push({
    description: 'Check that environment variables are set correctly',
    automatic: false,
  });
  actions.push({
    description: 'Verify your config file is valid JSON',
    automatic: false,
  });

  return actions;
}

/**
 * Format validation errors with helpful suggestions
 */
function formatValidationErrors(error: ZodError): void {
  logger.error('Configuration validation failed:');
  console.log();

  for (const issue of error.errors) {
    const path = issue.path.join('.') || 'root';
    logger.error(`  ${path}: ${issue.message}`);

    const suggestion = getValidationSuggestion(issue);
    if (suggestion) {
      console.log(suggestion);
    }
    console.log();
  }

  // Add general troubleshooting tips
  console.log('Troubleshooting tips:');
  console.log('  1. Run "autonomous-dev init" to create a new configuration file');
  console.log('  2. Run "autonomous-dev help-config" for detailed configuration documentation');
  console.log('  3. Check that environment variables are set correctly');
  console.log('  4. Verify your config file is valid JSON');
  console.log();
}

/**
 * Create a structured ConfigError from Zod validation errors
 */
function createConfigValidationError(zodError: ZodError, configPath?: string): ConfigError {
  const errorMessages = zodError.errors.map((e) => {
    const path = e.path.join('.') || 'root';
    return `${path}: ${e.message}`;
  });

  const firstError = zodError.errors[0];
  const field = firstError?.path.join('.') || undefined;

  return new ConfigError(
    ErrorCode.CONFIG_VALIDATION_FAILED,
    `Configuration validation failed: ${errorMessages.join('; ')}`,
    {
      field,
      recoveryActions: buildRecoveryActionsFromValidation(zodError.errors),
      context: {
        validationErrors: zodError.errors.map((e) => ({
          path: e.path.join('.'),
          message: e.message,
          code: e.code,
        })),
        configPath,
        configSourcesChecked: [
          './autonomous-dev.config.json',
          './autonomous-dev.json',
          './.autonomous-dev.json',
        ],
      },
    }
  );
}

/**
 * Generate comprehensive configuration help text
 */
export function getConfigHelp(): string {
  const sections = [
    {
      title: 'REPOSITORY SETTINGS (repo.*)',
      fields: ['repo.owner', 'repo.name', 'repo.baseBranch'],
    },
    {
      title: 'DISCOVERY SETTINGS (discovery.*)',
      fields: ['discovery.tasksPerCycle', 'discovery.maxOpenIssues', 'discovery.excludePaths', 'discovery.issueLabel'],
    },
    {
      title: 'EXECUTION SETTINGS (execution.*)',
      fields: ['execution.parallelWorkers', 'execution.timeoutMinutes', 'execution.workDir'],
    },
    {
      title: 'EVALUATION SETTINGS (evaluation.*)',
      fields: ['evaluation.requireBuild', 'evaluation.requireTests', 'evaluation.requireHealthCheck'],
    },
    {
      title: 'MERGE SETTINGS (merge.*)',
      fields: ['merge.autoMerge', 'merge.mergeMethod', 'merge.conflictStrategy'],
    },
    {
      title: 'DAEMON SETTINGS (daemon.*)',
      fields: ['daemon.loopIntervalMs', 'daemon.pauseBetweenCycles'],
    },
    {
      title: 'CREDENTIALS (credentials.*)',
      fields: ['credentials.githubToken', 'credentials.claudeAuth', 'credentials.databaseUrl', 'credentials.userEmail'],
    },
  ];

  let output = '';

  for (const section of sections) {
    output += `${section.title}\n`;
    output += '─'.repeat(60) + '\n\n';

    for (const field of section.fields) {
      const help = configFieldHelp[field];
      if (help) {
        const fieldName = field.split('.').pop();
        output += `  ${fieldName}\n`;
        output += `    ${help.description}\n`;
        if (help.envVar) {
          output += `    Environment: ${help.envVar}\n`;
        }
        if (help.suggestion) {
          output += `    Tip: ${help.suggestion}\n`;
        }
        if (help.example) {
          output += `    Example: ${help.example}\n`;
        }
        output += '\n';
      }
    }
  }

  output += 'CONFIGURATION FILES\n';
  output += '─'.repeat(60) + '\n\n';
  output += '  Config files are searched in this order:\n';
  output += '    1. Path specified with -c/--config option\n';
  output += '    2. ./autonomous-dev.config.json\n';
  output += '    3. ./autonomous-dev.json\n';
  output += '    4. ./.autonomous-dev.json\n\n';
  output += '  Configuration precedence (highest to lowest):\n';
  output += '    1. Environment variables\n';
  output += '    2. Config file values\n';
  output += '    3. Default values\n\n';

  output += 'QUICK START\n';
  output += '─'.repeat(60) + '\n\n';
  output += '  1. Run "autonomous-dev init" to create a config file\n';
  output += '  2. Set GITHUB_TOKEN environment variable\n';
  output += '  3. Set CLAUDE_ACCESS_TOKEN environment variable\n';
  output += '  4. Run "autonomous-dev config --validate" to verify\n';
  output += '  5. Run "autonomous-dev discover" to test discovery\n';
  output += '  6. Run "autonomous-dev start" to begin\n';

  return output;
}

function deepMerge<T extends object>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key in source) {
    if (source[key] !== undefined) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key])
      ) {
        result[key] = deepMerge(
          (target[key] as object) || {},
          source[key] as object
        ) as T[typeof key];
      } else {
        result[key] = source[key] as T[typeof key];
      }
    }
  }
  return result;
}

export function loadConfig(configPath?: string): Config {
  let fileConfig: Partial<Config> = {};

  // Try to load config file
  const possiblePaths = configPath
    ? [configPath]
    : [
        './autonomous-dev.config.json',
        './autonomous-dev.json',
        './.autonomous-dev.json',
      ];

  let configLoadPath: string | undefined;
  for (const path of possiblePaths) {
    const fullPath = resolve(path);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        fileConfig = JSON.parse(content);
        configLoadPath = fullPath;
        logger.info(`Loaded config from ${fullPath}`);
        break;
      } catch (error: any) {
        const parseError = new ConfigError(
          ErrorCode.CONFIG_PARSE_ERROR,
          `Failed to parse config file ${fullPath}: ${error.message}`,
          {
            context: { configPath: fullPath },
            recoveryActions: [
              {
                description: 'Verify your config file is valid JSON',
                automatic: false,
              },
              {
                description: 'Use a JSON validator to check for syntax errors',
                automatic: false,
              },
              {
                description: 'Run "autonomous-dev init" to create a new configuration file',
                automatic: false,
              },
            ],
            cause: error,
          }
        );
        logger.structuredError(parseError);
      }
    }
  }

  // Build config from env vars (only include repo if set, use file config values as fallback)
  const envConfig: Partial<Config> = {};

  // Repo config - prioritize file config, then env, then empty
  const repoOwner = process.env.REPO_OWNER || fileConfig.repo?.owner || '';
  const repoName = process.env.REPO_NAME || fileConfig.repo?.name || '';
  const baseBranch = process.env.REPO_BASE_BRANCH || fileConfig.repo?.baseBranch || 'main';

  if (repoOwner || repoName) {
    envConfig.repo = { owner: repoOwner, name: repoName, baseBranch };
  }

  envConfig.discovery = {
    tasksPerCycle: parseInt(process.env.TASKS_PER_CYCLE || '5', 10),
    maxOpenIssues: parseInt(process.env.MAX_OPEN_ISSUES || '10', 10),
    excludePaths: process.env.EXCLUDE_PATHS?.split(',') || defaultConfig.discovery?.excludePaths || [],
    issueLabel: process.env.ISSUE_LABEL || 'autonomous-dev',
    maxDepth: parseInt(process.env.MAX_DEPTH || '10', 10),
    maxFiles: parseInt(process.env.MAX_FILES || '10000', 10),
  };

  envConfig.execution = {
    parallelWorkers: parseInt(process.env.PARALLEL_WORKERS || '4', 10),
    timeoutMinutes: parseInt(process.env.TIMEOUT_MINUTES || '30', 10),
    workDir: process.env.WORK_DIR || '/tmp/autonomous-dev',
  };

  envConfig.evaluation = {
    requireBuild: process.env.REQUIRE_BUILD !== 'false',
    requireTests: process.env.REQUIRE_TESTS !== 'false',
    requireHealthCheck: process.env.REQUIRE_HEALTH_CHECK !== 'false',
    requireSmokeTests: process.env.REQUIRE_SMOKE_TESTS === 'true',
    healthCheckUrls: process.env.HEALTH_CHECK_URLS?.split(',') || [],
    smokeTestUrls: process.env.SMOKE_TEST_URLS?.split(',') || [],
    previewUrlPattern: process.env.PREVIEW_URL_PATTERN || defaultConfig.evaluation?.previewUrlPattern || '',
  };

  envConfig.merge = {
    autoMerge: process.env.AUTO_MERGE !== 'false',
    requireAllChecks: process.env.REQUIRE_ALL_CHECKS !== 'false',
    maxRetries: parseInt(process.env.MAX_RETRIES || '3', 10),
    conflictStrategy: (process.env.CONFLICT_STRATEGY as 'rebase' | 'merge' | 'manual') || 'rebase',
    mergeMethod: (process.env.MERGE_METHOD as 'merge' | 'squash' | 'rebase') || 'squash',
  };

  envConfig.daemon = {
    loopIntervalMs: parseInt(process.env.LOOP_INTERVAL_MS || '60000', 10),
    pauseBetweenCycles: process.env.PAUSE_BETWEEN_CYCLES !== 'false',
  };

  envConfig.credentials = {
    githubToken: process.env.GITHUB_TOKEN,
    claudeAuth: process.env.CLAUDE_ACCESS_TOKEN
      ? {
          accessToken: process.env.CLAUDE_ACCESS_TOKEN,
          refreshToken: process.env.CLAUDE_REFRESH_TOKEN || '',
          expiresAt: process.env.CLAUDE_EXPIRES_AT
            ? parseInt(process.env.CLAUDE_EXPIRES_AT, 10)
            : undefined,
        }
      : undefined,
    databaseUrl: process.env.DATABASE_URL,
    userEmail: process.env.USER_EMAIL,
  };

  // Merge configs: defaults < file < env
  const mergedConfig = deepMerge(
    deepMerge(defaultConfig as Config, fileConfig),
    envConfig
  );

  // Check for credentials in config file (security warning)
  if (fileConfig && Object.keys(fileConfig).length > 0) {
    const credentialWarnings = validateNoCredentialsInConfig(fileConfig);
    if (credentialWarnings.length > 0) {
      logger.warn('Security Warning: Potential credentials detected in config file');
      for (const warning of credentialWarnings) {
        logger.warn(`  ${warning}`);
      }
      console.log('\nSECURITY BEST PRACTICE:');
      console.log('  Credentials should be set via environment variables, not config files.');
      console.log('  This prevents accidental exposure in version control or logs.\n');
    }
  }

  // Validate
  const result = ConfigSchema.safeParse(mergedConfig);
  if (!result.success) {
    formatValidationErrors(result.error);
    throw createConfigValidationError(result.error, configPath);
  }

  return result.data;
}

export type { Config } from './schema.js';
