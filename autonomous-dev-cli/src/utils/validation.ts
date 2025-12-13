/**
 * Input validation utilities for CLI commands
 * Provides validation for command options with user-friendly error messages
 */

import { existsSync, accessSync, constants } from 'fs';
import { resolve } from 'path';
import chalk from 'chalk';
import { ErrorCode, ValidationError } from './errors.js';

/**
 * Validation result with error details
 */
export interface ValidationResult {
  valid: boolean;
  error?: ValidationError;
  suggestion?: string;
}

/**
 * Numeric range configuration
 */
export interface NumericRange {
  min: number;
  max: number;
  default: number;
}

/**
 * Common numeric ranges for CLI options
 */
export const NUMERIC_RANGES = {
  workerCount: { min: 1, max: 10, default: 4 },
  taskCount: { min: 1, max: 10, default: 5 },
  port: { min: 1, max: 65535, default: 9091 },
  timeoutMinutes: { min: 5, max: 120, default: 30 },
  maxOpenIssues: { min: 1, max: 100, default: 10 },
} as const;

/**
 * Validate a config file path
 * @param configPath - Path to the config file
 * @returns ValidationResult with error details if invalid
 */
export function validateConfigPath(configPath: string | undefined): ValidationResult {
  if (!configPath) {
    return { valid: true }; // Optional, will use default paths
  }

  const resolvedPath = resolve(configPath);

  // Check if path exists
  if (!existsSync(resolvedPath)) {
    return {
      valid: false,
      error: new ValidationError(
        ErrorCode.CONFIG_FILE_NOT_FOUND,
        `Configuration file not found: ${configPath}`,
        {
          field: 'config',
          value: configPath,
          recoveryActions: [
            {
              description: `Create a config file at "${configPath}" or use --config with a valid path`,
              automatic: false,
            },
            {
              description: 'Run "autonomous-dev init" to create a new configuration file',
              automatic: false,
            },
            {
              description: 'Check that the file path is correct and the file exists',
              automatic: false,
            },
          ],
          context: {
            providedPath: configPath,
            resolvedPath,
            suggestedLocations: [
              './autonomous-dev.config.json',
              './autonomous-dev.json',
              './.autonomous-dev.json',
            ],
          },
        }
      ),
      suggestion: `Try one of these default locations:\n` +
        `  • ./autonomous-dev.config.json\n` +
        `  • ./autonomous-dev.json\n` +
        `  • ./.autonomous-dev.json`,
    };
  }

  // Check if file is readable
  try {
    accessSync(resolvedPath, constants.R_OK);
  } catch {
    return {
      valid: false,
      error: new ValidationError(
        ErrorCode.CONFIG_FILE_NOT_FOUND,
        `Configuration file is not readable: ${configPath}`,
        {
          field: 'config',
          value: configPath,
          recoveryActions: [
            {
              description: 'Check file permissions - the file must be readable',
              automatic: false,
            },
            {
              description: `Run: chmod +r "${configPath}" to make it readable`,
              automatic: false,
            },
          ],
          context: {
            providedPath: configPath,
            resolvedPath,
          },
        }
      ),
      suggestion: 'Check that the file has read permissions',
    };
  }

  // Check if file has .json extension (warning only)
  if (!resolvedPath.endsWith('.json')) {
    return {
      valid: true, // Still valid, but warn
      suggestion: 'Config file should have a .json extension',
    };
  }

  return { valid: true };
}

/**
 * Validate a numeric parameter within a range
 * @param value - The value to validate (string from CLI or number)
 * @param paramName - Name of the parameter for error messages
 * @param range - The allowed range
 * @returns ValidationResult with parsed number or error
 */
export function validateNumericParam(
  value: string | number | undefined,
  paramName: string,
  range: NumericRange
): ValidationResult & { parsedValue?: number } {
  if (value === undefined) {
    return { valid: true, parsedValue: range.default };
  }

  const numValue = typeof value === 'string' ? parseInt(value, 10) : value;

  // Check if it's a valid number
  if (isNaN(numValue)) {
    return {
      valid: false,
      parsedValue: undefined,
      error: new ValidationError(
        ErrorCode.VALIDATION_INVALID_TYPE,
        `Invalid value for ${paramName}: "${value}" is not a valid number`,
        {
          field: paramName,
          value,
          expectedType: 'number',
          constraints: [`Must be a number between ${range.min} and ${range.max}`],
          recoveryActions: [
            {
              description: `Provide a valid number between ${range.min} and ${range.max}`,
              automatic: false,
            },
            {
              description: `Example: --${paramName.replace(/([A-Z])/g, '-$1').toLowerCase()} ${range.default}`,
              automatic: false,
            },
          ],
        }
      ),
      suggestion: `Provide a valid number between ${range.min} and ${range.max} (default: ${range.default})`,
    };
  }

  // Check if it's within range
  if (numValue < range.min || numValue > range.max) {
    return {
      valid: false,
      parsedValue: undefined,
      error: new ValidationError(
        ErrorCode.VALIDATION_OUT_OF_RANGE,
        `${paramName} must be between ${range.min} and ${range.max}, got ${numValue}`,
        {
          field: paramName,
          value: numValue,
          constraints: [`Minimum: ${range.min}`, `Maximum: ${range.max}`],
          recoveryActions: [
            {
              description: `Use a value between ${range.min} and ${range.max}`,
              automatic: false,
            },
            {
              description: `Recommended default: ${range.default}`,
              automatic: false,
            },
          ],
        }
      ),
      suggestion: `Value must be between ${range.min} and ${range.max}. Using default: ${range.default}`,
    };
  }

  return { valid: true, parsedValue: numValue };
}

/**
 * Validate repository information format (owner/name)
 * @param owner - Repository owner
 * @param name - Repository name
 * @returns ValidationResult with error details if invalid
 */
export function validateRepoInfo(owner: string | undefined, name: string | undefined): ValidationResult {
  const errors: string[] = [];
  const suggestions: string[] = [];

  if (!owner) {
    errors.push('Repository owner is required');
    suggestions.push('Set repo.owner in your config file or REPO_OWNER environment variable');
  } else if (!/^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(owner)) {
    errors.push(`Invalid repository owner format: "${owner}"`);
    suggestions.push('Owner should contain only alphanumeric characters and hyphens');
  }

  if (!name) {
    errors.push('Repository name is required');
    suggestions.push('Set repo.name in your config file or REPO_NAME environment variable');
  } else if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    errors.push(`Invalid repository name format: "${name}"`);
    suggestions.push('Name should contain only alphanumeric characters, dots, underscores, and hyphens');
  }

  if (errors.length > 0) {
    return {
      valid: false,
      error: new ValidationError(
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        errors.join('; '),
        {
          field: 'repo',
          constraints: [
            'Owner: alphanumeric and hyphens, cannot start/end with hyphen',
            'Name: alphanumeric, dots, underscores, and hyphens',
          ],
          recoveryActions: suggestions.map(s => ({ description: s, automatic: false })),
          context: {
            providedOwner: owner,
            providedName: name,
          },
        }
      ),
      suggestion: suggestions.join('\n'),
    };
  }

  return { valid: true };
}

/**
 * Validate GitHub token format
 * @param token - The GitHub token
 * @returns ValidationResult with error details if invalid
 */
export function validateGitHubToken(token: string | undefined): ValidationResult {
  if (!token) {
    return {
      valid: false,
      error: new ValidationError(
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        'GitHub token is required but not configured',
        {
          field: 'credentials.githubToken',
          recoveryActions: [
            {
              description: 'Set the GITHUB_TOKEN environment variable',
              automatic: false,
            },
            {
              description: 'Create a personal access token at https://github.com/settings/tokens',
              automatic: false,
            },
            {
              description: 'Required token scopes: repo, workflow',
              automatic: false,
            },
          ],
        }
      ),
      suggestion: formatCredentialSetupInstructions('GITHUB_TOKEN', 'GitHub personal access token'),
    };
  }

  // Basic format validation for common token patterns
  const validPatterns = [
    /^ghp_[a-zA-Z0-9]{36}$/, // Classic personal access token
    /^github_pat_[a-zA-Z0-9_]{22,}$/, // Fine-grained personal access token
    /^gho_[a-zA-Z0-9]{36}$/, // OAuth access token
    /^ghs_[a-zA-Z0-9]{36}$/, // GitHub App server-to-server token
    /^ghr_[a-zA-Z0-9]{36}$/, // GitHub App refresh token
  ];

  const isValidFormat = validPatterns.some(pattern => pattern.test(token));

  if (!isValidFormat && token.length < 20) {
    return {
      valid: false,
      error: new ValidationError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        'GitHub token appears to be invalid or malformed',
        {
          field: 'credentials.githubToken',
          recoveryActions: [
            {
              description: 'Verify the token was copied completely',
              automatic: false,
            },
            {
              description: 'Generate a new token at https://github.com/settings/tokens',
              automatic: false,
            },
            {
              description: 'Ensure the token has not expired',
              automatic: false,
            },
          ],
        }
      ),
      suggestion: 'Token format looks incorrect. Please verify it was copied completely.',
    };
  }

  return { valid: true };
}

/**
 * Validate Claude authentication
 * @param claudeAuth - Claude auth object
 * @returns ValidationResult with error details if invalid
 */
export function validateClaudeAuth(claudeAuth: { accessToken: string; refreshToken?: string } | undefined): ValidationResult {
  if (!claudeAuth || !claudeAuth.accessToken) {
    return {
      valid: false,
      error: new ValidationError(
        ErrorCode.VALIDATION_REQUIRED_FIELD,
        'Claude authentication is required but not configured',
        {
          field: 'credentials.claudeAuth',
          recoveryActions: [
            {
              description: 'Set the CLAUDE_ACCESS_TOKEN environment variable',
              automatic: false,
            },
            {
              description: 'Optionally set CLAUDE_REFRESH_TOKEN for automatic token refresh',
              automatic: false,
            },
            {
              description: 'Obtain credentials from https://console.anthropic.com/',
              automatic: false,
            },
          ],
        }
      ),
      suggestion: formatCredentialSetupInstructions('CLAUDE_ACCESS_TOKEN', 'Claude API access token'),
    };
  }

  return { valid: true };
}

/**
 * Validate port number
 * @param port - Port number (string or number)
 * @returns ValidationResult with parsed port
 */
export function validatePort(port: string | number | undefined): ValidationResult & { parsedValue?: number } {
  return validateNumericParam(port, 'port', NUMERIC_RANGES.port);
}

/**
 * Validate host/hostname format
 * @param host - The hostname
 * @returns ValidationResult
 */
export function validateHost(host: string | undefined): ValidationResult {
  if (!host) {
    return { valid: true }; // Will use default
  }

  // Simple validation - hostname or IP
  const hostnameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)*$/;
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  const localhostRegex = /^localhost$/i;

  if (!hostnameRegex.test(host) && !ipv4Regex.test(host) && !localhostRegex.test(host)) {
    return {
      valid: false,
      error: new ValidationError(
        ErrorCode.VALIDATION_INVALID_FORMAT,
        `Invalid host format: "${host}"`,
        {
          field: 'host',
          value: host,
          recoveryActions: [
            {
              description: 'Use a valid hostname (e.g., localhost, myserver.com)',
              automatic: false,
            },
            {
              description: 'Or use a valid IP address (e.g., 127.0.0.1)',
              automatic: false,
            },
          ],
        }
      ),
      suggestion: 'Use a valid hostname (e.g., localhost) or IP address (e.g., 127.0.0.1)',
    };
  }

  return { valid: true };
}

/**
 * Format credential setup instructions for display
 * @param envVar - Environment variable name
 * @param description - Human-readable description
 * @returns Formatted instruction string
 */
export function formatCredentialSetupInstructions(envVar: string, description: string): string {
  return [
    `\n${chalk.bold.yellow('Credential Setup Required')}`,
    ``,
    `${description} is not configured.`,
    ``,
    `${chalk.bold('To fix this, set the environment variable:')}`,
    ``,
    `  ${chalk.cyan(`export ${envVar}="your-token-here"`)}`,
    ``,
    `${chalk.bold('Or add it to your .env file:')}`,
    ``,
    `  ${chalk.gray(`${envVar}=your-token-here`)}`,
    ``,
    `For more help, run: ${chalk.cyan('autonomous-dev help-config')}`,
  ].join('\n');
}

/**
 * Display a validation error with formatting
 * @param result - The validation result to display
 */
export function displayValidationError(result: ValidationResult): void {
  if (result.valid || !result.error) return;

  console.error();
  console.error(chalk.red.bold('Validation Error:'));
  console.error(chalk.red(`  ${result.error.message}`));
  console.error();

  if (result.error.recoveryActions && result.error.recoveryActions.length > 0) {
    console.error(chalk.yellow.bold('How to fix:'));
    for (const action of result.error.recoveryActions) {
      const prefix = action.automatic ? chalk.cyan('(auto)') : chalk.magenta('(manual)');
      console.error(`  ${prefix} ${action.description}`);
    }
    console.error();
  }

  if (result.suggestion) {
    console.error(chalk.gray(result.suggestion));
    console.error();
  }
}

/**
 * Validate all common CLI options at once
 * @param options - CLI options object
 * @returns Object with validation results for each option
 */
export function validateCLIOptions(options: {
  config?: string;
  count?: string;
  port?: string;
  host?: string;
}): {
  isValid: boolean;
  errors: ValidationResult[];
} {
  const results: ValidationResult[] = [];

  // Validate config path
  if (options.config) {
    const configResult = validateConfigPath(options.config);
    if (!configResult.valid) {
      results.push(configResult);
    }
  }

  // Validate count (if provided)
  if (options.count) {
    const countResult = validateNumericParam(options.count, 'count', NUMERIC_RANGES.taskCount);
    if (!countResult.valid) {
      results.push(countResult);
    }
  }

  // Validate port (if provided)
  if (options.port) {
    const portResult = validatePort(options.port);
    if (!portResult.valid) {
      results.push(portResult);
    }
  }

  // Validate host (if provided)
  if (options.host) {
    const hostResult = validateHost(options.host);
    if (!hostResult.valid) {
      results.push(hostResult);
    }
  }

  return {
    isValid: results.filter(r => !r.valid).length === 0,
    errors: results.filter(r => !r.valid),
  };
}

/**
 * Create a user-friendly error message for missing credentials
 * @param credentialType - Type of credential (github, claude, database)
 * @returns Formatted error message string
 */
export function createMissingCredentialMessage(credentialType: 'github' | 'claude' | 'database'): string {
  const configs: Record<string, { envVar: string; description: string; url: string; scopes?: string }> = {
    github: {
      envVar: 'GITHUB_TOKEN',
      description: 'GitHub personal access token',
      url: 'https://github.com/settings/tokens',
      scopes: 'repo, workflow',
    },
    claude: {
      envVar: 'CLAUDE_ACCESS_TOKEN',
      description: 'Claude API access token',
      url: 'https://console.anthropic.com/',
    },
    database: {
      envVar: 'DATABASE_URL',
      description: 'Database connection URL',
      url: 'postgresql://user:password@host:5432/database',
    },
  };

  const config = configs[credentialType];
  if (!config) return 'Unknown credential type';

  const lines = [
    '',
    chalk.red.bold(`❌ ${config.description} not configured`),
    '',
    chalk.bold('Setup instructions:'),
    '',
    `  1. ${credentialType === 'database' ? 'Get your database connection string' : `Create a token at ${chalk.cyan(config.url)}`}`,
  ];

  if (config.scopes) {
    lines.push(`     Required scopes: ${chalk.yellow(config.scopes)}`);
  }

  lines.push(
    '',
    `  2. Set the environment variable:`,
    '',
    `     ${chalk.cyan(`export ${config.envVar}="your-token-here"`)}`,
    '',
    `     Or add to your ${chalk.cyan('.env')} file:`,
    '',
    `     ${chalk.gray(`${config.envVar}=your-token-here`)}`,
    ''
  );

  return lines.join('\n');
}
