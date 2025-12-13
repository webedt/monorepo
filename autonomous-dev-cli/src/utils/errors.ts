/**
 * Structured error handling system with error codes, severity levels, and recovery suggestions.
 */

/**
 * Error severity levels
 */
export type ErrorSeverity = 'critical' | 'error' | 'warning' | 'transient';

/**
 * Error codes for all known error types
 */
export enum ErrorCode {
  // GitHub errors (1000-1999)
  GITHUB_AUTH_FAILED = 'GITHUB_AUTH_FAILED',
  GITHUB_RATE_LIMITED = 'GITHUB_RATE_LIMITED',
  GITHUB_REPO_NOT_FOUND = 'GITHUB_REPO_NOT_FOUND',
  GITHUB_PERMISSION_DENIED = 'GITHUB_PERMISSION_DENIED',
  GITHUB_API_ERROR = 'GITHUB_API_ERROR',
  GITHUB_NETWORK_ERROR = 'GITHUB_NETWORK_ERROR',
  GITHUB_BRANCH_NOT_FOUND = 'GITHUB_BRANCH_NOT_FOUND',
  GITHUB_PR_CONFLICT = 'GITHUB_PR_CONFLICT',
  GITHUB_ISSUE_NOT_FOUND = 'GITHUB_ISSUE_NOT_FOUND',

  // Claude/AI errors (2000-2999)
  CLAUDE_AUTH_FAILED = 'CLAUDE_AUTH_FAILED',
  CLAUDE_QUOTA_EXCEEDED = 'CLAUDE_QUOTA_EXCEEDED',
  CLAUDE_TIMEOUT = 'CLAUDE_TIMEOUT',
  CLAUDE_API_ERROR = 'CLAUDE_API_ERROR',
  CLAUDE_INVALID_RESPONSE = 'CLAUDE_INVALID_RESPONSE',

  // Configuration errors (3000-3999)
  CONFIG_INVALID = 'CONFIG_INVALID',
  CONFIG_MISSING_REQUIRED = 'CONFIG_MISSING_REQUIRED',
  CONFIG_FILE_NOT_FOUND = 'CONFIG_FILE_NOT_FOUND',
  CONFIG_PARSE_ERROR = 'CONFIG_PARSE_ERROR',
  CONFIG_VALIDATION_FAILED = 'CONFIG_VALIDATION_FAILED',

  // Database errors (4000-4999)
  DB_CONNECTION_FAILED = 'DB_CONNECTION_FAILED',
  DB_USER_NOT_FOUND = 'DB_USER_NOT_FOUND',
  DB_QUERY_FAILED = 'DB_QUERY_FAILED',

  // Execution errors (5000-5999)
  EXEC_WORKSPACE_FAILED = 'EXEC_WORKSPACE_FAILED',
  EXEC_CLONE_FAILED = 'EXEC_CLONE_FAILED',
  EXEC_BRANCH_FAILED = 'EXEC_BRANCH_FAILED',
  EXEC_NO_CHANGES = 'EXEC_NO_CHANGES',
  EXEC_COMMIT_FAILED = 'EXEC_COMMIT_FAILED',
  EXEC_PUSH_FAILED = 'EXEC_PUSH_FAILED',
  EXEC_TIMEOUT = 'EXEC_TIMEOUT',

  // General errors (9000-9999)
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
  NOT_INITIALIZED = 'NOT_INITIALIZED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',
}

/**
 * Recovery action that can be taken for an error
 */
export interface RecoveryAction {
  description: string;
  automatic: boolean;
  action?: () => Promise<void>;
}

/**
 * Context information for debugging
 */
export interface ErrorContext {
  operation?: string;
  component?: string;
  config?: Record<string, unknown>;
  systemState?: Record<string, unknown>;
  timestamp?: string;
  requestId?: string;
  [key: string]: unknown;
}

/**
 * Base structured error class
 */
export class StructuredError extends Error {
  public readonly code: ErrorCode;
  public readonly severity: ErrorSeverity;
  public readonly recoveryActions: RecoveryAction[];
  public readonly context: ErrorContext;
  public readonly cause?: Error;
  public readonly isRetryable: boolean;
  public readonly timestamp: string;

  constructor(
    code: ErrorCode,
    message: string,
    options: {
      severity?: ErrorSeverity;
      recoveryActions?: RecoveryAction[];
      context?: ErrorContext;
      cause?: Error;
      isRetryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = 'StructuredError';
    this.code = code;
    this.severity = options.severity ?? this.inferSeverity(code);
    this.recoveryActions = options.recoveryActions ?? [];
    this.context = {
      ...options.context,
      timestamp: new Date().toISOString(),
    };
    this.cause = options.cause;
    this.isRetryable = options.isRetryable ?? this.inferRetryable(code);
    this.timestamp = new Date().toISOString();

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, StructuredError);
    }
  }

  private inferSeverity(code: ErrorCode): ErrorSeverity {
    // Transient errors that typically resolve on retry
    const transientCodes = [
      ErrorCode.GITHUB_RATE_LIMITED,
      ErrorCode.GITHUB_NETWORK_ERROR,
      ErrorCode.NETWORK_ERROR,
      ErrorCode.CLAUDE_TIMEOUT,
      ErrorCode.DB_CONNECTION_FAILED,
    ];
    if (transientCodes.includes(code)) return 'transient';

    // Critical errors requiring immediate attention
    const criticalCodes = [
      ErrorCode.GITHUB_AUTH_FAILED,
      ErrorCode.CLAUDE_AUTH_FAILED,
      ErrorCode.CONFIG_INVALID,
      ErrorCode.CONFIG_MISSING_REQUIRED,
    ];
    if (criticalCodes.includes(code)) return 'critical';

    return 'error';
  }

  private inferRetryable(code: ErrorCode): boolean {
    const retryableCodes = [
      ErrorCode.GITHUB_RATE_LIMITED,
      ErrorCode.GITHUB_NETWORK_ERROR,
      ErrorCode.NETWORK_ERROR,
      ErrorCode.CLAUDE_TIMEOUT,
      ErrorCode.DB_CONNECTION_FAILED,
      ErrorCode.EXEC_CLONE_FAILED,
      ErrorCode.EXEC_PUSH_FAILED,
    ];
    return retryableCodes.includes(code);
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      isRetryable: this.isRetryable,
      recoveryActions: this.recoveryActions.map((a) => ({
        description: a.description,
        automatic: a.automatic,
      })),
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause?.message,
    };
  }

  getRecoverySuggestions(): string[] {
    return this.recoveryActions.map((a) => a.description);
  }
}

/**
 * GitHub-specific error
 */
export class GitHubError extends StructuredError {
  constructor(
    code: ErrorCode,
    message: string,
    options: {
      statusCode?: number;
      endpoint?: string;
      recoveryActions?: RecoveryAction[];
      context?: ErrorContext;
      cause?: Error;
    } = {}
  ) {
    const recoveryActions = options.recoveryActions ?? getGitHubRecoveryActions(code, options.statusCode);
    super(code, message, {
      severity: getGitHubSeverity(code, options.statusCode),
      recoveryActions,
      context: {
        ...options.context,
        statusCode: options.statusCode,
        endpoint: options.endpoint,
      },
      cause: options.cause,
      isRetryable: isGitHubRetryable(code, options.statusCode),
    });
    this.name = 'GitHubError';
  }
}

function getGitHubSeverity(code: ErrorCode, statusCode?: number): ErrorSeverity {
  if (statusCode === 429) return 'transient';
  if (statusCode === 401 || statusCode === 403) return 'critical';
  if (statusCode && statusCode >= 500) return 'transient';
  return 'error';
}

function isGitHubRetryable(code: ErrorCode, statusCode?: number): boolean {
  if (statusCode === 429) return true;
  if (statusCode && statusCode >= 500) return true;
  if (code === ErrorCode.GITHUB_NETWORK_ERROR) return true;
  return false;
}

function getGitHubRecoveryActions(code: ErrorCode, statusCode?: number): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  switch (code) {
    case ErrorCode.GITHUB_AUTH_FAILED:
      actions.push({
        description: 'Verify your GitHub token is valid and not expired',
        automatic: false,
      });
      actions.push({
        description: 'Generate a new token at https://github.com/settings/tokens',
        automatic: false,
      });
      actions.push({
        description: 'Ensure the token has required scopes: repo, workflow',
        automatic: false,
      });
      break;

    case ErrorCode.GITHUB_RATE_LIMITED:
      actions.push({
        description: 'Wait for rate limit reset (check X-RateLimit-Reset header)',
        automatic: true,
      });
      actions.push({
        description: 'Consider using a GitHub App for higher rate limits',
        automatic: false,
      });
      break;

    case ErrorCode.GITHUB_REPO_NOT_FOUND:
      actions.push({
        description: 'Verify the repository owner and name are correct',
        automatic: false,
      });
      actions.push({
        description: 'Check that your token has access to the repository',
        automatic: false,
      });
      break;

    case ErrorCode.GITHUB_PERMISSION_DENIED:
      actions.push({
        description: 'Request access to the repository from the owner',
        automatic: false,
      });
      actions.push({
        description: 'Verify your token has the required permissions',
        automatic: false,
      });
      break;

    case ErrorCode.GITHUB_NETWORK_ERROR:
      actions.push({
        description: 'Check your network connection',
        automatic: false,
      });
      actions.push({
        description: 'Retry the operation',
        automatic: true,
      });
      break;

    case ErrorCode.GITHUB_PR_CONFLICT:
      actions.push({
        description: 'Rebase the branch on the latest base branch',
        automatic: true,
      });
      actions.push({
        description: 'Resolve conflicts manually if automatic rebase fails',
        automatic: false,
      });
      break;
  }

  return actions;
}

/**
 * Claude/AI-specific error
 */
export class ClaudeError extends StructuredError {
  constructor(
    code: ErrorCode,
    message: string,
    options: {
      recoveryActions?: RecoveryAction[];
      context?: ErrorContext;
      cause?: Error;
    } = {}
  ) {
    const recoveryActions = options.recoveryActions ?? getClaudeRecoveryActions(code);
    super(code, message, {
      severity: getClaudeSeverity(code),
      recoveryActions,
      context: options.context,
      cause: options.cause,
    });
    this.name = 'ClaudeError';
  }
}

function getClaudeSeverity(code: ErrorCode): ErrorSeverity {
  switch (code) {
    case ErrorCode.CLAUDE_AUTH_FAILED:
    case ErrorCode.CLAUDE_QUOTA_EXCEEDED:
      return 'critical';
    case ErrorCode.CLAUDE_TIMEOUT:
      return 'transient';
    default:
      return 'error';
  }
}

function getClaudeRecoveryActions(code: ErrorCode): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  switch (code) {
    case ErrorCode.CLAUDE_AUTH_FAILED:
      actions.push({
        description: 'Verify your Claude API credentials are valid',
        automatic: false,
      });
      actions.push({
        description: 'Refresh your Claude access token if expired',
        automatic: true,
      });
      actions.push({
        description: 'Re-authenticate with Claude using the auth command',
        automatic: false,
      });
      break;

    case ErrorCode.CLAUDE_QUOTA_EXCEEDED:
      actions.push({
        description: 'Wait for your quota to reset',
        automatic: false,
      });
      actions.push({
        description: 'Upgrade your Claude subscription for higher limits',
        automatic: false,
      });
      actions.push({
        description: 'Reduce task complexity to use fewer tokens',
        automatic: false,
      });
      break;

    case ErrorCode.CLAUDE_TIMEOUT:
      actions.push({
        description: 'Increase the timeout setting in configuration',
        automatic: false,
      });
      actions.push({
        description: 'Retry with a simpler task',
        automatic: true,
      });
      break;
  }

  return actions;
}

/**
 * Configuration-specific error
 */
export class ConfigError extends StructuredError {
  constructor(
    code: ErrorCode,
    message: string,
    options: {
      field?: string;
      value?: unknown;
      expectedType?: string;
      recoveryActions?: RecoveryAction[];
      context?: ErrorContext;
      cause?: Error;
    } = {}
  ) {
    const recoveryActions = options.recoveryActions ?? getConfigRecoveryActions(code, options.field);
    super(code, message, {
      severity: 'critical',
      recoveryActions,
      context: {
        ...options.context,
        field: options.field,
        invalidValue: options.value,
        expectedType: options.expectedType,
      },
      cause: options.cause,
      isRetryable: false,
    });
    this.name = 'ConfigError';
  }
}

function getConfigRecoveryActions(code: ErrorCode, field?: string): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  actions.push({
    description: 'Run "autonomous-dev help-config" for configuration documentation',
    automatic: false,
  });
  actions.push({
    description: 'Run "autonomous-dev init" to create a new configuration file',
    automatic: false,
  });

  if (field) {
    actions.push({
      description: `Check the value of "${field}" in your configuration`,
      automatic: false,
    });
  }

  return actions;
}

/**
 * Execution-specific error
 */
export class ExecutionError extends StructuredError {
  constructor(
    code: ErrorCode,
    message: string,
    options: {
      issueNumber?: number;
      branchName?: string;
      recoveryActions?: RecoveryAction[];
      context?: ErrorContext;
      cause?: Error;
    } = {}
  ) {
    const recoveryActions = options.recoveryActions ?? getExecutionRecoveryActions(code);
    super(code, message, {
      recoveryActions,
      context: {
        ...options.context,
        issueNumber: options.issueNumber,
        branchName: options.branchName,
      },
      cause: options.cause,
    });
    this.name = 'ExecutionError';
  }
}

function getExecutionRecoveryActions(code: ErrorCode): RecoveryAction[] {
  const actions: RecoveryAction[] = [];

  switch (code) {
    case ErrorCode.EXEC_CLONE_FAILED:
      actions.push({
        description: 'Verify network connectivity',
        automatic: false,
      });
      actions.push({
        description: 'Check that the repository URL is correct',
        automatic: false,
      });
      actions.push({
        description: 'Retry the clone operation',
        automatic: true,
      });
      break;

    case ErrorCode.EXEC_NO_CHANGES:
      actions.push({
        description: 'Review the issue description for clarity',
        automatic: false,
      });
      actions.push({
        description: 'Add more context to the issue',
        automatic: false,
      });
      break;

    case ErrorCode.EXEC_PUSH_FAILED:
      actions.push({
        description: 'Check for branch protection rules',
        automatic: false,
      });
      actions.push({
        description: 'Verify push permissions',
        automatic: false,
      });
      actions.push({
        description: 'Retry the push operation',
        automatic: true,
      });
      break;

    case ErrorCode.EXEC_TIMEOUT:
      actions.push({
        description: 'Increase the timeout configuration',
        automatic: false,
      });
      actions.push({
        description: 'Break down the task into smaller issues',
        automatic: false,
      });
      break;
  }

  return actions;
}

/**
 * Retry configuration for exponential backoff
 */
export interface RetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
};

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calculate delay for exponential backoff
 */
function calculateBackoffDelay(attempt: number, config: RetryConfig): number {
  const delay = config.baseDelayMs * Math.pow(config.backoffMultiplier, attempt);
  // Add jitter (±10%)
  const jitter = delay * 0.1 * (Math.random() * 2 - 1);
  return Math.min(delay + jitter, config.maxDelayMs);
}

/**
 * Execute a function with automatic retry and exponential backoff
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: {
    config?: Partial<RetryConfig>;
    onRetry?: (error: Error, attempt: number, delay: number) => void;
    shouldRetry?: (error: Error) => boolean;
  } = {}
): Promise<T> {
  const config = { ...DEFAULT_RETRY_CONFIG, ...options.config };

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if we should retry
      const isRetryable =
        options.shouldRetry?.(lastError) ??
        (lastError instanceof StructuredError && lastError.isRetryable);

      if (!isRetryable || attempt >= config.maxRetries) {
        throw lastError;
      }

      // Calculate delay and wait
      const delay = calculateBackoffDelay(attempt, config);
      options.onRetry?.(lastError, attempt + 1, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Wrap an error as a StructuredError if it isn't already
 */
export function wrapError(
  error: unknown,
  defaultCode: ErrorCode = ErrorCode.UNKNOWN_ERROR,
  context?: ErrorContext
): StructuredError {
  if (error instanceof StructuredError) {
    // Add additional context if provided
    if (context) {
      return new StructuredError(error.code, error.message, {
        severity: error.severity,
        recoveryActions: error.recoveryActions,
        context: { ...error.context, ...context },
        cause: error.cause,
        isRetryable: error.isRetryable,
      });
    }
    return error;
  }

  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? error : undefined;

  return new StructuredError(defaultCode, message, {
    context,
    cause,
  });
}

/**
 * Create a GitHub error from an Octokit error response
 */
export function createGitHubErrorFromResponse(
  error: any,
  endpoint?: string,
  context?: ErrorContext
): GitHubError {
  const statusCode = error.status ?? error.response?.status;
  const message = error.message ?? 'GitHub API request failed';

  let code: ErrorCode;

  switch (statusCode) {
    case 401:
      code = ErrorCode.GITHUB_AUTH_FAILED;
      break;
    case 403:
      if (message.toLowerCase().includes('rate limit')) {
        code = ErrorCode.GITHUB_RATE_LIMITED;
      } else {
        code = ErrorCode.GITHUB_PERMISSION_DENIED;
      }
      break;
    case 404:
      code = ErrorCode.GITHUB_REPO_NOT_FOUND;
      break;
    case 409:
      code = ErrorCode.GITHUB_PR_CONFLICT;
      break;
    default:
      if (error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        code = ErrorCode.GITHUB_NETWORK_ERROR;
      } else {
        code = ErrorCode.GITHUB_API_ERROR;
      }
  }

  return new GitHubError(code, message, {
    statusCode,
    endpoint,
    context: {
      ...context,
      originalError: error.message,
      responseData: error.response?.data,
    },
    cause: error,
  });
}

/**
 * Format a StructuredError for display
 */
export function formatError(error: StructuredError): string {
  const lines: string[] = [];

  lines.push(`[${error.code}] ${error.message}`);
  lines.push(`  Severity: ${error.severity}`);
  lines.push(`  Retryable: ${error.isRetryable ? 'yes' : 'no'}`);

  if (error.recoveryActions.length > 0) {
    lines.push('  Recovery suggestions:');
    for (const action of error.recoveryActions) {
      const prefix = action.automatic ? '(auto)' : '(manual)';
      lines.push(`    ${prefix} ${action.description}`);
    }
  }

  if (Object.keys(error.context).length > 0) {
    lines.push('  Context:');
    for (const [key, value] of Object.entries(error.context)) {
      if (value !== undefined) {
        lines.push(`    ${key}: ${JSON.stringify(value)}`);
      }
    }
  }

  return lines.join('\n');
}
