import { ZodError, ZodIssue } from 'zod';
import chalk from 'chalk';
import { fieldMetadata, type FieldMetadata } from './schema.js';
import { logger } from '../utils/logger.js';
import { GitHubClient } from '../github/client.js';

export interface FormattedError {
  path: string;
  message: string;
  currentValue: unknown;
  expected: string;
  example: string;
  envVar?: string;
  description: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: FormattedError[];
}

export interface DependencyValidationResult {
  github: {
    valid: boolean;
    login?: string;
    error?: string;
    permissions?: string[];
  };
  claude: {
    valid: boolean;
    error?: string;
  };
  database?: {
    valid: boolean;
    error?: string;
  };
}

function getExpectedType(issue: ZodIssue): string {
  switch (issue.code) {
    case 'invalid_type':
      return `Expected ${issue.expected}, received ${issue.received}`;
    case 'too_small':
      if (issue.type === 'string') return `String must have at least ${issue.minimum} character(s)`;
      if (issue.type === 'number') return `Number must be at least ${issue.minimum}`;
      if (issue.type === 'array') return `Array must have at least ${issue.minimum} item(s)`;
      return `Must be at least ${issue.minimum}`;
    case 'too_big':
      if (issue.type === 'string') return `String must have at most ${issue.maximum} character(s)`;
      if (issue.type === 'number') return `Number must be at most ${issue.maximum}`;
      if (issue.type === 'array') return `Array must have at most ${issue.maximum} item(s)`;
      return `Must be at most ${issue.maximum}`;
    case 'invalid_enum_value':
      return `Must be one of: ${issue.options.join(', ')}`;
    case 'invalid_string':
      if (issue.validation === 'email') return 'Must be a valid email address';
      if (issue.validation === 'url') return 'Must be a valid URL';
      return `Invalid string format: ${issue.validation}`;
    case 'invalid_literal':
      return `Expected literal value: ${JSON.stringify(issue.expected)}`;
    default:
      return issue.message;
  }
}

function getCurrentValue(config: unknown, path: (string | number)[]): unknown {
  let current = config;
  for (const key of path) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === 'object') {
      current = (current as Record<string | number, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function formatValue(value: unknown): string {
  if (value === undefined) return chalk.gray('(undefined)');
  if (value === null) return chalk.gray('(null)');
  if (value === '') return chalk.gray('(empty string)');
  if (typeof value === 'string') return chalk.yellow(`"${value}"`);
  if (typeof value === 'number') return chalk.cyan(String(value));
  if (typeof value === 'boolean') return chalk.magenta(String(value));
  if (Array.isArray(value)) {
    if (value.length === 0) return chalk.gray('[]');
    return chalk.gray(`[${value.length} items]`);
  }
  if (typeof value === 'object') return chalk.gray('[object]');
  return String(value);
}

export function formatZodErrors(error: ZodError, config: unknown): FormattedError[] {
  return error.errors.map((issue) => {
    const path = issue.path.join('.');
    const metadata: FieldMetadata = fieldMetadata[path] || {
      description: 'Configuration field',
      example: '',
    };
    const currentValue = getCurrentValue(config, issue.path);

    return {
      path,
      message: issue.message,
      currentValue,
      expected: getExpectedType(issue),
      example: metadata.example,
      envVar: metadata.envVar,
      description: metadata.description,
    };
  });
}

export function printValidationErrors(errors: FormattedError[]): void {
  logger.error('Configuration validation failed:\n');

  for (const error of errors) {
    console.log(chalk.red(`  ✗ ${chalk.bold(error.path)}`));
    console.log(chalk.gray(`    ${error.description}`));
    console.log();
    console.log(`    ${chalk.gray('Current:')}  ${formatValue(error.currentValue)}`);
    console.log(`    ${chalk.gray('Expected:')} ${error.expected}`);
    if (error.example) {
      console.log(`    ${chalk.gray('Example:')}  ${chalk.green(error.example)}`);
    }
    if (error.envVar) {
      console.log(`    ${chalk.gray('Env var:')}  ${chalk.cyan(error.envVar)}`);
    }
    console.log();
  }

  // Summary with how to fix
  console.log(chalk.yellow('How to fix:'));
  console.log(chalk.gray('  1. Set the values via environment variables'));
  console.log(chalk.gray('  2. Or add them to autonomous-dev.config.json'));
  console.log(chalk.gray('  3. Or use a profile: dev.config.json, prod.config.json'));
  console.log();
}

export async function validateGitHubToken(
  token: string,
  owner: string,
  repo: string
): Promise<{ valid: boolean; login?: string; error?: string; permissions?: string[] }> {
  try {
    const client = new GitHubClient({ token, owner, repo });

    // Verify authentication
    const user = await client.verifyAuth();

    // Verify repository access
    const repoInfo = await client.getRepo();

    // Get token scopes from a simple request
    const permissions: string[] = [];

    // Check if we can access the repo
    if (repoInfo.fullName) {
      permissions.push('repo:read');
    }

    // Try to check if we have write access by checking collaborator status
    try {
      const octokit = client.client;
      await octokit.repos.getCollaboratorPermissionLevel({
        owner,
        repo,
        username: user.login,
      });
      permissions.push('repo:write');
    } catch {
      // Write access not available or not a collaborator
    }

    return {
      valid: true,
      login: user.login,
      permissions,
    };
  } catch (error: any) {
    let errorMessage = error.message;

    // Provide more helpful error messages
    if (error.status === 401) {
      errorMessage = 'Invalid or expired GitHub token. Generate a new token at https://github.com/settings/tokens';
    } else if (error.status === 403) {
      errorMessage = 'Token lacks required permissions. Ensure the token has "repo" scope.';
    } else if (error.status === 404) {
      errorMessage = `Repository ${owner}/${repo} not found or not accessible with this token.`;
    }

    return {
      valid: false,
      error: errorMessage,
    };
  }
}

export async function validateClaudeAuth(
  accessToken: string,
  refreshToken?: string,
  expiresAt?: number
): Promise<{ valid: boolean; error?: string; expired?: boolean }> {
  // Check if token appears to be valid format
  if (!accessToken || accessToken.length < 10) {
    return {
      valid: false,
      error: 'Claude access token appears to be invalid or too short',
    };
  }

  // Check expiration
  if (expiresAt) {
    const now = Date.now();
    if (expiresAt < now) {
      if (refreshToken) {
        return {
          valid: false,
          expired: true,
          error: 'Claude access token has expired. Token will be refreshed automatically.',
        };
      }
      return {
        valid: false,
        expired: true,
        error: 'Claude access token has expired and no refresh token is available.',
      };
    }

    // Warn if expiring soon (within 1 hour)
    const oneHour = 60 * 60 * 1000;
    if (expiresAt - now < oneHour) {
      logger.warn('Claude access token will expire within 1 hour');
    }
  }

  // Note: We can't fully validate Claude API tokens without making an actual API call
  // which would consume API credits. We do basic format validation instead.
  return {
    valid: true,
  };
}

export async function validateDependencies(
  config: {
    credentials: {
      githubToken?: string;
      claudeAuth?: {
        accessToken: string;
        refreshToken: string;
        expiresAt?: number;
      };
    };
    repo: {
      owner: string;
      name: string;
    };
  }
): Promise<DependencyValidationResult> {
  const result: DependencyValidationResult = {
    github: { valid: false, error: 'GitHub token not configured' },
    claude: { valid: false, error: 'Claude auth not configured' },
  };

  // Validate GitHub token
  if (config.credentials.githubToken) {
    result.github = await validateGitHubToken(
      config.credentials.githubToken,
      config.repo.owner,
      config.repo.name
    );
  }

  // Validate Claude auth
  if (config.credentials.claudeAuth) {
    result.claude = await validateClaudeAuth(
      config.credentials.claudeAuth.accessToken,
      config.credentials.claudeAuth.refreshToken,
      config.credentials.claudeAuth.expiresAt
    );
  }

  return result;
}

export function printDependencyValidation(result: DependencyValidationResult): void {
  logger.header('External Dependency Validation');
  console.log();

  // GitHub
  if (result.github.valid) {
    console.log(chalk.green(`  ✓ GitHub: Authenticated as ${result.github.login}`));
    if (result.github.permissions && result.github.permissions.length > 0) {
      console.log(chalk.gray(`    Permissions: ${result.github.permissions.join(', ')}`));
    }
  } else {
    console.log(chalk.red(`  ✗ GitHub: ${result.github.error}`));
  }

  // Claude
  if (result.claude.valid) {
    console.log(chalk.green('  ✓ Claude: Access token configured'));
  } else {
    console.log(chalk.red(`  ✗ Claude: ${result.claude.error}`));
  }

  // Database (if present)
  if (result.database) {
    if (result.database.valid) {
      console.log(chalk.green('  ✓ Database: Connected'));
    } else {
      console.log(chalk.red(`  ✗ Database: ${result.database.error}`));
    }
  }

  console.log();
}
