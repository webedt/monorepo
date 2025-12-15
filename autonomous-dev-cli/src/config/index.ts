import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { config as loadEnv } from 'dotenv';
import { ConfigSchema, defaultConfig, validateNoCredentialsInConfig, type Config, CURRENT_CONFIG_VERSION } from './schema.js';
import { logger } from '../utils/logger.js';
import { ZodError, ZodIssue } from 'zod';
import {
  ConfigError,
  ErrorCode,
  type ErrorContext,
  type RecoveryAction,
} from '../utils/errors.js';
import {
  migrateConfig,
  needsMigration,
  checkDeprecatedFields,
  formatMigrationSummary,
  detectConfigVersion,
  type MigrationResult,
} from './migrations.js';

// Load .env file
loadEnv();

/**
 * Configuration field metadata for help and validation suggestions
 */
const configFieldHelp: Record<string, { description: string; envVar?: string; suggestion?: string; example?: string }> = {
  'version': {
    description: 'Configuration schema version for migration support',
    suggestion: `Current version is ${CURRENT_CONFIG_VERSION}. Run "autonomous-dev config --upgrade" to migrate older configs.`,
    example: String(CURRENT_CONFIG_VERSION),
  },
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
  'logging.format': {
    description: 'Log output format: pretty (colored text) or json (structured)',
    envVar: 'LOG_FORMAT',
    suggestion: 'Use "json" for production environments with log aggregation systems',
    example: 'json',
  },
  'logging.level': {
    description: 'Minimum log level to output (debug, info, warn, error)',
    envVar: 'LOG_LEVEL',
    suggestion: 'Use "info" for production, "debug" for development',
    example: 'info',
  },
  'logging.includeCorrelationId': {
    description: 'Include correlation ID in log entries for request tracing',
    envVar: 'LOG_INCLUDE_CORRELATION_ID',
    suggestion: 'Keep enabled for production environments to trace requests',
    example: 'true',
  },
  'logging.includeTimestamp': {
    description: 'Include timestamps in log entries',
    envVar: 'LOG_INCLUDE_TIMESTAMP',
    suggestion: 'Keep enabled unless external logging adds timestamps',
    example: 'true',
  },
  'logging.enableStructuredFileLogging': {
    description: 'Enable structured JSON logging to file alongside console output',
    envVar: 'LOG_ENABLE_STRUCTURED_FILE',
    suggestion: 'Enable for production environments to capture machine-readable logs',
    example: 'true',
  },
  'logging.structuredLogDir': {
    description: 'Directory path for structured log files',
    envVar: 'LOG_STRUCTURED_DIR',
    suggestion: 'Use a persistent directory for log retention',
    example: './logs',
  },
  'logging.maxLogFileSizeBytes': {
    description: 'Maximum size of each log file in bytes before rotation',
    envVar: 'LOG_MAX_FILE_SIZE_BYTES',
    suggestion: 'Default is 10MB, increase for high-volume environments',
    example: '10485760',
  },
  'logging.maxLogFiles': {
    description: 'Number of rotated log files to retain',
    envVar: 'LOG_MAX_FILES',
    suggestion: 'Keep enough files for debugging, default is 5',
    example: '5',
  },
  'logging.includeMetrics': {
    description: 'Include performance metrics in structured logs',
    envVar: 'LOG_INCLUDE_METRICS',
    suggestion: 'Keep enabled for observability',
    example: 'true',
  },
};

/**
 * Example values for common configuration types
 */
const exampleValues: Record<string, { correct: string; incorrect?: string; jsonExample?: string }> = {
  'repo.owner': {
    correct: '"myusername" or "my-organization"',
    incorrect: '123 (must be a string)',
    jsonExample: '{ "repo": { "owner": "myusername" } }',
  },
  'repo.name': {
    correct: '"my-project" or "awesome-app"',
    incorrect: 'empty string',
    jsonExample: '{ "repo": { "name": "my-project" } }',
  },
  'repo.baseBranch': {
    correct: '"main", "master", or "develop"',
    jsonExample: '{ "repo": { "baseBranch": "main" } }',
  },
  'discovery.tasksPerCycle': {
    correct: '5 (number between 1-10)',
    incorrect: '"5" (string) or 15 (out of range)',
    jsonExample: '{ "discovery": { "tasksPerCycle": 5 } }',
  },
  'discovery.maxOpenIssues': {
    correct: '10 (number, minimum 1)',
    incorrect: '0 or negative numbers',
    jsonExample: '{ "discovery": { "maxOpenIssues": 10 } }',
  },
  'execution.parallelWorkers': {
    correct: '4 (number between 1-10)',
    incorrect: '"four" (string) or 20 (out of range)',
    jsonExample: '{ "execution": { "parallelWorkers": 4 } }',
  },
  'execution.timeoutMinutes': {
    correct: '30 (number between 5-120)',
    incorrect: '2 (too small) or 200 (too large)',
    jsonExample: '{ "execution": { "timeoutMinutes": 30 } }',
  },
  'merge.mergeMethod': {
    correct: '"merge", "squash", or "rebase"',
    incorrect: '"fast-forward" (not a valid option)',
    jsonExample: '{ "merge": { "mergeMethod": "squash" } }',
  },
  'merge.conflictStrategy': {
    correct: '"rebase", "merge", or "manual"',
    jsonExample: '{ "merge": { "conflictStrategy": "rebase" } }',
  },
  'logging.level': {
    correct: '"debug", "info", "warn", or "error"',
    incorrect: '"verbose" or "trace" (not valid options)',
    jsonExample: '{ "logging": { "level": "info" } }',
  },
  'logging.format': {
    correct: '"pretty" (colored terminal) or "json" (structured)',
    jsonExample: '{ "logging": { "format": "json" } }',
  },
  'version': {
    correct: `${CURRENT_CONFIG_VERSION} (current version)`,
    incorrect: '0 or versions higher than current',
    jsonExample: `{ "version": ${CURRENT_CONFIG_VERSION} }`,
  },
  'evaluation.requireBuild': {
    correct: 'true or false',
    incorrect: '"yes" or "no" (must be boolean)',
    jsonExample: '{ "evaluation": { "requireBuild": true } }',
  },
  'credentials.userEmail': {
    correct: '"user@example.com"',
    incorrect: '"not-an-email"',
    jsonExample: '{ "credentials": { "userEmail": "user@example.com" } }',
  },
};

/**
 * Get helpful suggestion for a validation error
 */
function getValidationSuggestion(issue: ZodIssue): string {
  const path = issue.path.join('.');
  const help = configFieldHelp[path];
  const examples = exampleValues[path];

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
  }

  // Add error-type specific suggestions with detailed examples
  switch (issue.code) {
    case 'invalid_type':
      if (issue.expected === 'string' && issue.received === 'undefined') {
        suggestion += '\n    ❌ This field is required but was not provided.';
        if (examples?.jsonExample) {
          suggestion += `\n    ✓ Add to your config file: ${examples.jsonExample}`;
        }
      } else {
        suggestion += `\n    ❌ Expected type "${issue.expected}", but received "${issue.received}".`;
        if (examples?.correct) {
          suggestion += `\n    ✓ Correct value: ${examples.correct}`;
        }
        if (examples?.incorrect) {
          suggestion += `\n    ✗ Common mistake: ${examples.incorrect}`;
        }
      }
      break;
    case 'too_small':
      const minimum = (issue as any).minimum;
      const inclusiveMin = (issue as any).inclusive;
      suggestion += `\n    ❌ Value is too small. Minimum: ${minimum}${inclusiveMin ? ' (inclusive)' : ' (exclusive)'}`;
      if (examples?.correct) {
        suggestion += `\n    ✓ Valid range: ${examples.correct}`;
      }
      if (examples?.incorrect) {
        suggestion += `\n    ✗ Invalid: ${examples.incorrect}`;
      }
      break;
    case 'too_big':
      const maximum = (issue as any).maximum;
      const inclusiveMax = (issue as any).inclusive;
      suggestion += `\n    ❌ Value is too large. Maximum: ${maximum}${inclusiveMax ? ' (inclusive)' : ' (exclusive)'}`;
      if (examples?.correct) {
        suggestion += `\n    ✓ Valid range: ${examples.correct}`;
      }
      break;
    case 'invalid_enum_value':
      const options = (issue as any).options || [];
      suggestion += `\n    ❌ Invalid value. Valid options are: ${options.map((o: string) => `"${o}"`).join(', ')}`;
      if (examples?.correct) {
        suggestion += `\n    ✓ Example: ${examples.correct}`;
      }
      if (examples?.incorrect) {
        suggestion += `\n    ✗ Not valid: ${examples.incorrect}`;
      }
      if (examples?.jsonExample) {
        suggestion += `\n    ✓ Config example: ${examples.jsonExample}`;
      }
      break;
    case 'invalid_string':
      if ((issue as any).validation === 'email') {
        suggestion += '\n    ❌ Please provide a valid email address.';
        suggestion += '\n    ✓ Example: "user@example.com"';
        suggestion += '\n    ✗ Invalid: "not-an-email" or "user@" or "@domain.com"';
      } else if ((issue as any).validation === 'url') {
        suggestion += '\n    ❌ Please provide a valid URL.';
        suggestion += '\n    ✓ Example: "https://example.com/webhook"';
        suggestion += '\n    ✗ Invalid: "not-a-url" or "example.com" (missing protocol)';
      }
      break;
    case 'custom':
      // Handle custom refinement errors (like credential detection)
      if (issue.message.includes('credential')) {
        suggestion += '\n    ⚠️ Security: Credentials should not be stored in config files.';
        suggestion += '\n    ✓ Use environment variables instead:';
        suggestion += '\n      export GITHUB_TOKEN="your-token"';
        suggestion += '\n      export CLAUDE_ACCESS_TOKEN="your-token"';
      } else {
        suggestion += `\n    ${issue.message}`;
      }
      break;
    default:
      if (examples?.correct) {
        suggestion += `\n    ✓ Expected: ${examples.correct}`;
      }
  }

  // Add JSON example if available and not already added
  if (examples?.jsonExample && !suggestion.includes('Config example:') && !suggestion.includes('Add to your config')) {
    suggestion += `\n    ✓ Config example: ${examples.jsonExample}`;
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
      title: 'LOGGING SETTINGS (logging.*)',
      fields: ['logging.format', 'logging.level', 'logging.includeCorrelationId', 'logging.includeTimestamp'],
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

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Path to configuration file */
  configPath?: string;
  /** Whether to automatically migrate old configs (default: true) */
  autoMigrate?: boolean;
  /** Whether to show deprecation warnings (default: true) */
  showDeprecationWarnings?: boolean;
}

export function loadConfig(configPath?: string, options: Omit<LoadConfigOptions, 'configPath'> = {}): Config {
  const { autoMigrate = true, showDeprecationWarnings = true } = options;
  let fileConfig: Partial<Config> = {};
  let rawFileConfig: Record<string, unknown> = {};

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
        rawFileConfig = JSON.parse(content);
        fileConfig = rawFileConfig as Partial<Config>;
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

  // Check for deprecated fields and show warnings
  if (showDeprecationWarnings && Object.keys(rawFileConfig).length > 0) {
    const deprecationWarnings = checkDeprecatedFields(rawFileConfig);
    if (deprecationWarnings.length > 0) {
      logger.warn('Deprecated configuration options detected:');
      for (const warning of deprecationWarnings) {
        logger.warn(`  ⚠ ${warning}`);
      }
      console.log();
    }
  }

  // Check if migration is needed
  if (autoMigrate && Object.keys(rawFileConfig).length > 0 && needsMigration(rawFileConfig)) {
    const currentVersion = detectConfigVersion(rawFileConfig);
    logger.warn(`Configuration file is at version ${currentVersion}, current version is ${CURRENT_CONFIG_VERSION}`);
    logger.warn('Automatically migrating configuration in memory...');
    logger.info('Run "autonomous-dev config --upgrade" to save the migrated configuration to disk.');
    console.log();

    const migrationResult = migrateConfig(rawFileConfig);
    if (migrationResult.success && migrationResult.config) {
      fileConfig = migrationResult.config as Partial<Config>;

      // Show migration warnings
      if (migrationResult.warnings.length > 0) {
        logger.warn('Migration warnings:');
        for (const warning of migrationResult.warnings) {
          logger.warn(`  ⚠ ${warning}`);
        }
        console.log();
      }
    } else {
      // Migration failed - show errors but continue with original config
      logger.error('Configuration migration failed:');
      for (const error of migrationResult.errors) {
        logger.error(`  ✗ ${error}`);
      }
      console.log();
      logger.warn('Continuing with original configuration. Some features may not work correctly.');
      console.log();
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
    cache: {
      enabled: process.env.CACHE_ENABLED !== 'false',
      cacheDir: process.env.CACHE_DIR,
      maxAgeMs: parseInt(process.env.CACHE_MAX_AGE_MS || '3600000', 10),
      useGitInvalidation: process.env.CACHE_USE_GIT !== 'false',
    },
  };

  envConfig.execution = {
    parallelWorkers: parseInt(process.env.PARALLEL_WORKERS || '4', 10),
    timeoutMinutes: parseInt(process.env.TIMEOUT_MINUTES || '30', 10),
    workDir: process.env.WORK_DIR || '/tmp/autonomous-dev',
    useRemoteSessions: process.env.USE_REMOTE_SESSIONS === 'true',
    claudeEnvironmentId: process.env.CLAUDE_ENVIRONMENT_ID,
    claudeModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
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
    loopIntervalMs: parseInt(process.env.LOOP_INTERVAL_MS || '5000', 10),
    pauseBetweenCycles: process.env.PAUSE_BETWEEN_CYCLES !== 'false',
  };

  envConfig.logging = {
    format: (process.env.LOG_FORMAT as 'pretty' | 'json') || 'pretty',
    level: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
    includeCorrelationId: process.env.LOG_INCLUDE_CORRELATION_ID !== 'false',
    includeTimestamp: process.env.LOG_INCLUDE_TIMESTAMP !== 'false',
    enableStructuredFileLogging: process.env.LOG_ENABLE_STRUCTURED_FILE === 'true',
    structuredLogDir: process.env.LOG_STRUCTURED_DIR || './logs',
    maxLogFileSizeBytes: parseInt(process.env.LOG_MAX_FILE_SIZE_BYTES || String(10 * 1024 * 1024), 10),
    maxLogFiles: parseInt(process.env.LOG_MAX_FILES || '5', 10),
    includeMetrics: process.env.LOG_INCLUDE_METRICS !== 'false',
    rotationPolicy: (process.env.LOG_ROTATION_POLICY as 'size' | 'time' | 'both') || 'size',
    rotationInterval: (process.env.LOG_ROTATION_INTERVAL as 'hourly' | 'daily' | 'weekly') || 'daily',
    maxLogAgeDays: parseInt(process.env.LOG_MAX_AGE_DAYS || '30', 10),
    debugMode: process.env.DEBUG_MODE === 'true' || process.env.AUTONOMOUS_DEV_DEBUG === 'true',
    logClaudeInteractions: process.env.LOG_CLAUDE_INTERACTIONS === 'true',
    logApiDetails: process.env.LOG_API_DETAILS === 'true',
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

/**
 * Result of an upgrade operation
 */
export interface UpgradeResult {
  success: boolean;
  configPath: string;
  migrationResult: MigrationResult;
  backupPath?: string;
}

/**
 * Upgrade a configuration file to the latest version
 * Creates a backup of the original file before modifying
 */
export function upgradeConfig(configPath?: string): UpgradeResult {
  // Find the config file
  const possiblePaths = configPath
    ? [configPath]
    : [
        './autonomous-dev.config.json',
        './autonomous-dev.json',
        './.autonomous-dev.json',
      ];

  let foundPath: string | undefined;
  let rawConfig: Record<string, unknown> | undefined;

  for (const path of possiblePaths) {
    const fullPath = resolve(path);
    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        rawConfig = JSON.parse(content);
        foundPath = fullPath;
        break;
      } catch (error) {
        // Continue to next path
      }
    }
  }

  if (!foundPath || !rawConfig) {
    return {
      success: false,
      configPath: configPath || '(not found)',
      migrationResult: {
        success: false,
        fromVersion: 0,
        toVersion: CURRENT_CONFIG_VERSION,
        changes: [],
        warnings: [],
        errors: ['No configuration file found. Run "autonomous-dev init" to create one.'],
      },
    };
  }

  // Check if migration is needed
  if (!needsMigration(rawConfig)) {
    const version = detectConfigVersion(rawConfig);
    return {
      success: true,
      configPath: foundPath,
      migrationResult: {
        success: true,
        config: rawConfig,
        fromVersion: version,
        toVersion: version,
        changes: [],
        warnings: [],
        errors: [],
      },
    };
  }

  // Perform migration
  const migrationResult = migrateConfig(rawConfig);

  if (!migrationResult.success || !migrationResult.config) {
    return {
      success: false,
      configPath: foundPath,
      migrationResult,
    };
  }

  // Create backup
  const backupPath = `${foundPath}.backup.${Date.now()}`;
  try {
    const originalContent = readFileSync(foundPath, 'utf-8');
    writeFileSync(backupPath, originalContent);
  } catch (error) {
    migrationResult.warnings.push(
      `Could not create backup at ${backupPath}. Proceeding without backup.`
    );
  }

  // Write migrated config
  try {
    writeFileSync(foundPath, JSON.stringify(migrationResult.config, null, 2) + '\n');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      configPath: foundPath,
      migrationResult: {
        ...migrationResult,
        success: false,
        errors: [...migrationResult.errors, `Failed to write migrated config: ${errorMessage}`],
      },
      backupPath,
    };
  }

  return {
    success: true,
    configPath: foundPath,
    migrationResult,
    backupPath,
  };
}

// Re-export migration utilities for use in CLI
export {
  migrateConfig,
  needsMigration,
  checkDeprecatedFields,
  formatMigrationSummary,
  detectConfigVersion,
  CURRENT_CONFIG_VERSION,
  type MigrationResult,
} from './migrations.js';

export { CURRENT_CONFIG_VERSION as CONFIG_VERSION } from './schema.js';
