import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  type ContentBlock,
  type ClaudeSDKMessage,
  type ResultMessage,
  isTextBlock,
  isToolUseBlock,
  isResultMessage,
  validateSDKMessage,
  extractToolUseInfo,
  extractTextContent,
  extractResultDuration,
} from '../types/claude-sdk.js';
import { simpleGit } from 'simple-git';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  logger,
  generateCorrelationId,
  getMemoryUsageMB,
  timeOperation,
  createOperationContext,
  finalizeOperationContext,
  ClaudeExecutionLogger,
  type OperationMetadata,
} from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import {
  StructuredError,
  ExecutionError,
  ClaudeError,
  ErrorCode,
  wrapError,
  withRetry,
  type ErrorContext,
  type RecoveryAction,
} from '../utils/errors.js';
import {
  CircuitBreaker,
  getClaudeSDKCircuitBreaker,
  type CircuitBreakerConfig,
} from '../utils/circuit-breaker.js';
import {
  retryWithBackoff,
  NETWORK_RETRY_CONFIG,
  CLAUDE_RETRY_CONFIG,
  type RetryContext,
  type RetryAttemptRecord,
} from '../utils/retry.js';
import {
  getDeadLetterQueue,
  type RetryAttempt,
} from '../utils/dead-letter-queue.js';
import { type Issue } from '../github/issues.js';
import {
  createChatSession,
  updateChatSession,
  addMessage,
  addEvent,
  generateSessionPath,
  type CreateChatSessionParams,
} from '../db/index.js';

/**
 * Default timeout for Claude execution (5 minutes as per issue requirements)
 */
const DEFAULT_CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Maximum retries for Claude execution (3 attempts as per issue requirements)
 */
const DEFAULT_MAX_CLAUDE_RETRIES = 3;

/**
 * Exponential backoff delays for retries (2s, 4s, 8s as per issue requirements)
 */
const CLAUDE_RETRY_DELAYS_MS = [2000, 4000, 8000];

/**
 * Configuration for Claude execution error recovery
 */
export interface ClaudeRetryConfig {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries: number;
  /** Base delay in milliseconds for exponential backoff (default: 2000) */
  baseDelayMs: number;
  /** Maximum delay in milliseconds (default: 8000) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Timeout in milliseconds for each attempt (default: 5 minutes) */
  timeoutMs: number;
}

/**
 * Default Claude retry configuration aligned with issue requirements
 */
const DEFAULT_CLAUDE_RETRY_CONFIG: ClaudeRetryConfig = {
  maxRetries: DEFAULT_MAX_CLAUDE_RETRIES,
  baseDelayMs: 2000,
  maxDelayMs: 8000,
  backoffMultiplier: 2,
  timeoutMs: DEFAULT_CLAUDE_TIMEOUT_MS,
};

/**
 * Result of Claude execution with validation details
 */
export interface ClaudeExecutionResult {
  success: boolean;
  toolUseCount: number;
  turnCount: number;
  durationMs: number;
  hasChanges: boolean;
  validationIssues: string[];
  error?: {
    code: string;
    message: string;
    isRetryable: boolean;
  };
}

/**
 * Validation result for Claude response
 */
export interface ResponseValidation {
  isValid: boolean;
  hasChanges: boolean;
  issues: string[];
  severity: 'none' | 'warning' | 'error';
}

export interface WorkerOptions {
  workDir: string;
  repoUrl: string;
  baseBranch: string;
  githubToken: string;
  claudeAuth: {
    accessToken: string;
    refreshToken: string;
    expiresAt?: number;
  };
  timeoutMinutes: number;
  // Database integration
  userId?: string;
  repoOwner?: string;
  repoName?: string;
  enableDatabaseLogging?: boolean;
  // Performance options
  sparseCheckout?: {
    enabled: boolean;
    paths?: string[]; // Paths to include in sparse checkout
  };
  useShallowClone?: boolean; // Use --depth 1 (default: true)
  // Circuit breaker configuration
  circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
  // Retry configuration
  retryConfig?: {
    /** Max retries for transient failures (default: 3) */
    maxRetries?: number;
    /** Enable dead letter queue for failed tasks (default: true) */
    enableDeadLetterQueue?: boolean;
    /** Enable progressive timeout increases (default: true) */
    progressiveTimeout?: boolean;
  };
  // Claude execution retry configuration
  claudeRetryConfig?: Partial<ClaudeRetryConfig>;
}

/**
 * Retry state preserved across retry attempts
 */
export interface WorkerRetryState {
  taskId: string;
  issueNumber: number;
  branchName: string;
  retryCount: number;
  maxRetries: number;
  firstAttemptAt: Date;
  lastAttemptAt: Date;
  attemptHistory: RetryAttempt[];
  totalElapsedMs: number;
  currentTimeoutMs: number;
}

export interface WorkerTask {
  issue: Issue;
  branchName: string;
}

export interface WorkerResult {
  success: boolean;
  issue: Issue;
  branchName: string;
  commitSha?: string;
  error?: string;
  duration: number;
  chatSessionId?: string;
}

export class Worker {
  private options: WorkerOptions;
  private workerId: string;
  private log: ReturnType<typeof logger.child>;
  private repository: string;
  private circuitBreaker: CircuitBreaker;
  private claudeRetryConfig: ClaudeRetryConfig;

  constructor(options: WorkerOptions, workerId: string) {
    this.options = options;
    this.workerId = workerId;
    this.log = logger.child(`Worker-${workerId}`);
    // Extract repository identifier from URL for metrics
    this.repository = this.extractRepoName(options.repoUrl);
    // Get or create the Claude SDK circuit breaker with optional config overrides
    this.circuitBreaker = getClaudeSDKCircuitBreaker(options.circuitBreakerConfig);
    // Initialize Claude retry configuration
    this.claudeRetryConfig = {
      ...DEFAULT_CLAUDE_RETRY_CONFIG,
      ...options.claudeRetryConfig,
    };
  }

  /**
   * Get the circuit breaker health status
   */
  getCircuitBreakerHealth() {
    return this.circuitBreaker.getHealth();
  }

  /**
   * Extract repository name from URL for metrics labeling
   */
  private extractRepoName(repoUrl: string): string {
    const match = repoUrl.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
    return match ? match[1] : repoUrl;
  }

  /**
   * Get error context for debugging
   */
  private getErrorContext(operation: string, task?: WorkerTask): ErrorContext {
    return {
      operation,
      component: 'Worker',
      workerId: this.workerId,
      repoUrl: this.options.repoUrl,
      baseBranch: this.options.baseBranch,
      timeoutMinutes: this.options.timeoutMinutes,
      issueNumber: task?.issue.number,
      branchName: task?.branchName,
    };
  }

  /**
   * Wrap an error with execution context
   */
  private wrapExecutionError(
    error: any,
    code: ErrorCode,
    message: string,
    task?: WorkerTask
  ): ExecutionError {
    if (error instanceof StructuredError) {
      return error as ExecutionError;
    }
    return new ExecutionError(code, message, {
      issueNumber: task?.issue.number,
      branchName: task?.branchName,
      context: this.getErrorContext('execute', task),
      cause: error,
    });
  }

  async execute(task: WorkerTask): Promise<WorkerResult> {
    const startTime = Date.now();
    const startMemory = getMemoryUsageMB();
    const { issue, branchName } = task;

    // Generate correlation ID for this task execution
    const correlationId = generateCorrelationId();
    const taskLog = this.log.withCorrelationId(correlationId);

    // Start correlation tracking in metrics
    metrics.startCorrelation(correlationId);

    // Create operation context for structured logging
    const operationContext = createOperationContext('Worker', 'executeTask', {
      issueNumber: issue.number,
      branchName,
      workerId: this.workerId,
    });

    taskLog.info(`Starting task: ${issue.title}`, {
      issueNumber: issue.number,
      branchName,
      workerId: this.workerId,
      correlationId,
      startMemoryMB: startMemory,
    });

    // Log memory snapshot at start
    taskLog.memorySnapshot('Worker', `Task start: Issue #${issue.number}`);

    // Track Claude API call
    metrics.claudeApiCallsTotal.inc({ repository: this.repository });
    metrics.recordCorrelationOperation(correlationId, 'task_start');

    // Create workspace directory for this task
    const taskDir = join(this.options.workDir, `task-${issue.number}-${Date.now()}`);

    // Create chat session if database logging is enabled
    let chatSessionId: string | undefined;
    if (this.options.enableDatabaseLogging && this.options.userId && this.options.repoOwner && this.options.repoName) {
      try {
        const session = await createChatSession({
          userId: this.options.userId,
          repositoryOwner: this.options.repoOwner,
          repositoryName: this.options.repoName,
          repositoryUrl: this.options.repoUrl,
          baseBranch: this.options.baseBranch,
          userRequest: `[Auto] Issue #${issue.number}: ${issue.title}\n\n${issue.body || 'No description'}`,
          provider: 'claude',
        });
        chatSessionId = session.id;
        taskLog.debug(`Created chat session: ${chatSessionId}`);

        // Log initial user message with correlation ID
        await addMessage(chatSessionId, 'user', `Implement GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body || 'No description provided.'}`);
        await addEvent(chatSessionId, 'session_start', {
          type: 'session_start',
          message: 'Autonomous worker starting task',
          correlationId,
          workerId: this.workerId,
        });
      } catch (error: any) {
        taskLog.warn(`Failed to create chat session: ${error.message}`);
      }
    }

    try {
      // Setup workspace
      await this.setupWorkspace(taskDir);
      if (chatSessionId) {
        await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'workspace', message: 'Created workspace directory' });
      }

      // Clone repository
      if (chatSessionId) {
        await updateChatSession(chatSessionId, { status: 'running' });
        await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'clone', message: 'Cloning repository...' });
      }
      const repoDir = await this.cloneRepo(taskDir);
      if (chatSessionId) {
        await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'clone', message: 'Repository cloned successfully' });
      }

      // Create and checkout branch
      await this.createBranch(repoDir, branchName);
      if (chatSessionId) {
        await updateChatSession(chatSessionId, { branch: branchName, sessionPath: generateSessionPath(this.options.repoOwner!, this.options.repoName!, branchName) });
        await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'branch', message: `Created branch: ${branchName}` });
      }

      // Write Claude credentials
      this.writeClaudeCredentials();

      // Execute task with Claude
      if (chatSessionId) {
        await addEvent(chatSessionId, 'claude_start', { type: 'claude_start', message: 'Starting Claude Agent SDK...' });
      }
      await this.executeWithClaude(repoDir, issue, chatSessionId);

      // Check if there are any changes
      const hasChanges = await this.hasChanges(repoDir);
      if (!hasChanges) {
        taskLog.warn('No changes made by Claude');
        if (chatSessionId) {
          await addMessage(chatSessionId, 'system', 'No changes were made by Claude');
          await updateChatSession(chatSessionId, { status: 'completed', completedAt: new Date() });
        }

        const duration = Date.now() - startTime;
        // Record task completion (failure - no changes)
        metrics.recordTaskCompletion(false, duration, {
          repository: this.repository,
          taskType: 'issue',
          workerId: this.workerId,
        });

        return {
          success: false,
          issue,
          branchName,
          error: 'No changes were made',
          duration,
          chatSessionId,
        };
      }

      // Commit and push
      if (chatSessionId) {
        await addEvent(chatSessionId, 'commit_progress', { type: 'commit_progress', stage: 'committing', message: 'Committing changes...' });
      }
      const commitSha = await this.commitAndPush(repoDir, issue, branchName);
      if (chatSessionId) {
        await addEvent(chatSessionId, 'commit_progress', { type: 'commit_progress', stage: 'pushed', message: `Pushed commit ${commitSha}`, data: { commitSha, branch: branchName } });
        await addMessage(chatSessionId, 'assistant', `Successfully committed and pushed changes.\n\nCommit: ${commitSha}\nBranch: ${branchName}`);
        await updateChatSession(chatSessionId, { status: 'completed', completedAt: new Date() });
      }

      const duration = Date.now() - startTime;
      const endMemory = getMemoryUsageMB();
      const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;

      // Record successful task completion
      metrics.recordTaskCompletion(true, duration, {
        repository: this.repository,
        taskType: 'issue',
        workerId: this.workerId,
      });

      // Record worker-specific metrics
      metrics.recordWorkerTask(this.workerId, true, duration, {
        repository: this.repository,
        issueNumber: issue.number,
      });

      // End correlation tracking and log summary
      const correlationSummary = metrics.endCorrelation(correlationId);

      // Log operation completion with full metrics
      const operationMetadata = finalizeOperationContext(operationContext, true, {
        commitSha,
        memoryDeltaMB: memoryDelta,
        correlationSummary,
      });

      taskLog.operationComplete('Worker', 'executeTask', true, operationMetadata);
      taskLog.success(`Task completed: ${issue.title}`);

      // Log memory snapshot at end
      taskLog.memorySnapshot('Worker', `Task complete: Issue #${issue.number}`);

      taskLog.info(`Task metrics`, {
        duration,
        issueNumber: issue.number,
        commitSha,
        memoryDeltaMB: memoryDelta,
        operations: correlationSummary?.operationCount,
      });

      return {
        success: true,
        issue,
        branchName,
        commitSha,
        duration,
        chatSessionId,
      };
    } catch (error: any) {
      // Wrap the error with structured context
      const structuredError = this.wrapExecutionError(
        error,
        ErrorCode.INTERNAL_ERROR,
        `Task execution failed: ${error.message}`,
        task
      );

      const duration = Date.now() - startTime;
      const endMemory = getMemoryUsageMB();
      const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;

      // Record error in correlation tracking
      metrics.recordCorrelationError(correlationId);

      // Record error metrics
      metrics.recordError({
        repository: this.repository,
        taskType: 'issue',
        workerId: this.workerId,
        issueNumber: issue.number,
        branchName,
        errorCode: structuredError.code,
        severity: structuredError.severity,
        isRetryable: structuredError.isRetryable,
        component: 'Worker',
        operation: 'execute',
      });

      // Record Claude API error if applicable
      if (structuredError.code.startsWith('CLAUDE_')) {
        metrics.claudeApiErrorsTotal.inc({ repository: this.repository });
      }

      // Record failed task completion
      metrics.recordTaskCompletion(false, duration, {
        repository: this.repository,
        taskType: 'issue',
        workerId: this.workerId,
      });

      // Record worker-specific metrics
      metrics.recordWorkerTask(this.workerId, false, duration, {
        repository: this.repository,
        issueNumber: issue.number,
      });

      // End correlation tracking
      const correlationSummary = metrics.endCorrelation(correlationId);

      // Log operation failure with full metrics
      const operationMetadata = finalizeOperationContext(operationContext, false, {
        errorCode: structuredError.code,
        errorMessage: structuredError.message,
        memoryDeltaMB: memoryDelta,
        correlationSummary,
      });

      taskLog.operationComplete('Worker', 'executeTask', false, operationMetadata);

      // Log memory snapshot at error
      taskLog.memorySnapshot('Worker', `Task failed: Issue #${issue.number}`);

      taskLog.structuredError(structuredError, {
        context: this.getErrorContext('execute', task),
        includeStack: true,
        includeRecovery: true,
      });

      if (chatSessionId) {
        await addMessage(chatSessionId, 'error', `Task failed: [${structuredError.code}] ${structuredError.message}`);
        await addEvent(chatSessionId, 'error', {
          type: 'error',
          code: structuredError.code,
          message: structuredError.message,
          severity: structuredError.severity,
          isRetryable: structuredError.isRetryable,
          recoveryActions: structuredError.getRecoverySuggestions(),
          stack: structuredError.stack,
          correlationId,
          duration,
          memoryDeltaMB: memoryDelta,
        });
        await updateChatSession(chatSessionId, { status: 'error', completedAt: new Date() });
      }

      // Add to dead letter queue if enabled and max retries exceeded
      if (this.options.retryConfig?.enableDeadLetterQueue !== false) {
        const dlq = getDeadLetterQueue({}, this.options.workDir);
        const dlqId = dlq.createEntryFromRetryContext(
          `task-${issue.number}`,
          'issue',
          this.repository,
          [{
            attemptNumber: 1,
            timestamp: new Date().toISOString(),
            errorCode: structuredError.code,
            errorMessage: structuredError.message,
            delayMs: 0,
            duration,
          }],
          {
            code: structuredError.code,
            message: structuredError.message,
            severity: structuredError.severity,
            isRetryable: structuredError.isRetryable,
            stack: structuredError.stack,
          },
          {
            workerId: this.workerId,
            correlationId,
            originalTimeout: this.options.timeoutMinutes * 60 * 1000,
            chatSessionId,
            memoryDeltaMB: memoryDelta,
          },
          {
            issueNumber: issue.number,
            branchName,
            maxRetries: this.options.retryConfig?.maxRetries ?? 3,
          }
        );

        taskLog.info('Task added to dead letter queue', {
          dlqId,
          issueNumber: issue.number,
          errorCode: structuredError.code,
          canReprocess: structuredError.isRetryable,
        });
      }

      return {
        success: false,
        issue,
        branchName,
        error: `[${structuredError.code}] ${structuredError.message}`,
        duration,
        chatSessionId,
      };
    } finally {
      // Cleanup workspace
      this.cleanupWorkspace(taskDir);
    }
  }

  private async setupWorkspace(taskDir: string): Promise<void> {
    if (existsSync(taskDir)) {
      rmSync(taskDir, { recursive: true, force: true });
    }
    mkdirSync(taskDir, { recursive: true });
    this.log.debug(`Created workspace: ${taskDir}`);
  }

  private cleanupWorkspace(taskDir: string): void {
    try {
      if (existsSync(taskDir)) {
        rmSync(taskDir, { recursive: true, force: true });
        this.log.debug(`Cleaned up workspace: ${taskDir}`);
      }
    } catch (error) {
      this.log.warn(`Failed to cleanup workspace: ${taskDir}`);
    }
  }

  private async cloneRepo(taskDir: string): Promise<string> {
    this.log.info('Cloning repository...');

    // Add token to URL for authentication
    const urlWithAuth = this.options.repoUrl.replace(
      'https://github.com',
      `https://${this.options.githubToken}@github.com`
    );

    const useShallow = this.options.useShallowClone !== false; // Default true
    const sparseConfig = this.options.sparseCheckout;
    const maxRetries = this.options.retryConfig?.maxRetries ?? 3;

    // Clone with retry for transient network failures using enhanced retry
    return retryWithBackoff(
      async (retryContext: RetryContext) => {
        const git = simpleGit(taskDir);
        const repoDir = join(taskDir, 'repo');

        // Log retry context for debugging
        if (retryContext.attempt > 0) {
          this.log.info(`Clone attempt ${retryContext.attempt + 1}/${maxRetries + 1}`, {
            elapsedMs: retryContext.elapsedMs,
            currentTimeoutMs: retryContext.currentTimeoutMs,
          });
        }

        // Use sparse checkout for targeted cloning (faster for large repos)
        if (sparseConfig?.enabled) {
          this.log.info('Using sparse checkout for optimized cloning');

          // Initialize empty repo
          mkdirSync(repoDir, { recursive: true });
          const repoGit = simpleGit(repoDir);
          await repoGit.init();
          await repoGit.addRemote('origin', urlWithAuth);

          // Enable sparse checkout
          await repoGit.raw(['config', 'core.sparseCheckout', 'true']);

          // Write sparse checkout patterns
          const sparseCheckoutPath = join(repoDir, '.git', 'info', 'sparse-checkout');
          const patterns = sparseConfig.paths?.length
            ? sparseConfig.paths
            : ['/*', '!/node_modules']; // Default: all except node_modules
          writeFileSync(sparseCheckoutPath, patterns.join('\n'));

          // Fetch and checkout with optional shallow clone
          const fetchArgs = useShallow
            ? ['fetch', '--depth', '1', 'origin', this.options.baseBranch]
            : ['fetch', 'origin', this.options.baseBranch];
          await repoGit.raw(fetchArgs);
          await repoGit.raw(['checkout', this.options.baseBranch]);

          this.log.debug('Repository cloned with sparse checkout');
        } else {
          // Standard clone (shallow by default)
          const cloneArgs = useShallow
            ? ['--depth', '1', '--branch', this.options.baseBranch]
            : ['--branch', this.options.baseBranch];
          await git.clone(urlWithAuth, 'repo', cloneArgs);
          this.log.debug('Repository cloned');
        }

        // Configure git identity
        const repoGit = simpleGit(repoDir);
        await repoGit.addConfig('user.name', 'Autonomous Dev Bot');
        await repoGit.addConfig('user.email', 'bot@autonomous-dev.local');

        return repoDir;
      },
      {
        config: {
          ...NETWORK_RETRY_CONFIG,
          maxRetries,
          progressiveTimeout: this.options.retryConfig?.progressiveTimeout ?? true,
        },
        operationName: 'git-clone',
        onRetry: (error, attempt, delay, context) => {
          this.log.warn(`Clone retry (attempt ${attempt}): ${error.message}, waiting ${delay}ms`, {
            totalElapsedMs: context.elapsedMs,
            nextTimeoutMs: context.currentTimeoutMs,
            attemptHistory: context.attemptHistory.length,
          });

          // Record retry metrics
          metrics.recordError({
            repository: this.repository,
            errorCode: 'EXEC_CLONE_RETRY',
            severity: 'transient',
            isRetryable: true,
            component: 'Worker',
            operation: 'cloneRepo',
          });
        },
        onExhausted: (error, context) => {
          this.log.error('Clone failed after all retries', {
            totalAttempts: context.attemptHistory.length + 1,
            totalElapsedMs: context.elapsedMs,
            attemptHistory: context.attemptHistory,
          });
        },
        shouldRetry: (error) => {
          // Retry network-related errors
          const message = error.message.toLowerCase();
          return (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('enotfound') ||
            message.includes('etimedout') ||
            message.includes('econnreset') ||
            message.includes('econnrefused')
          );
        },
      }
    ).catch((error) => {
      throw new ExecutionError(
        ErrorCode.EXEC_CLONE_FAILED,
        `Failed to clone repository: ${error.message}`,
        {
          context: {
            repoUrl: this.options.repoUrl,
            baseBranch: this.options.baseBranch,
            taskDir,
            sparseCheckout: sparseConfig?.enabled,
          },
          cause: error,
        }
      );
    });
  }

  private async createBranch(repoDir: string, branchName: string): Promise<void> {
    const git = simpleGit(repoDir);
    await git.checkoutLocalBranch(branchName);
    this.log.debug(`Created branch: ${branchName}`);
  }

  private writeClaudeCredentials(): void {
    const claudeDir = join(homedir(), '.claude');
    const credentialsPath = join(claudeDir, '.credentials.json');

    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    const credentials = {
      claudeAiOauth: {
        accessToken: this.options.claudeAuth.accessToken,
        refreshToken: this.options.claudeAuth.refreshToken,
        expiresAt: this.options.claudeAuth.expiresAt || Date.now() + 3600000,
        scopes: ['user:inference', 'user:profile'],
        subscriptionType: 'max',
      },
    };

    writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
    this.log.debug('Claude credentials written');
  }

  /**
   * Execute task with Claude Agent SDK with retry mechanism and error recovery.
   * Implements:
   * - Exponential backoff retry (3 attempts with 2s, 4s, 8s delays)
   * - Timeout handling with 5-minute limit
   * - Conversation history logging for debugging
   * - Response validation to detect incomplete implementations
   */
  private async executeWithClaude(repoDir: string, issue: Issue, chatSessionId?: string): Promise<void> {
    const correlationId = generateCorrelationId();
    const executionLogger = new ClaudeExecutionLogger(correlationId, `issue-${issue.number}`);

    // Check circuit breaker before starting
    if (!this.circuitBreaker.canExecute()) {
      const error = this.circuitBreaker.createCircuitOpenError({
        component: 'Worker',
        operation: 'executeWithClaude',
        issueNumber: issue.number,
        workerId: this.workerId,
      });

      this.log.warn('Claude Agent SDK execution blocked by circuit breaker', {
        circuitState: this.circuitBreaker.getState(),
        issueNumber: issue.number,
        circuitHealth: this.circuitBreaker.getHealth(),
      });

      metrics.recordCircuitBreakerRejection('claude-sdk');
      throw error;
    }

    const { maxRetries, timeoutMs } = this.claudeRetryConfig;
    let lastError: Error | undefined;
    let attemptResult: ClaudeExecutionResult | undefined;

    // Retry loop with exponential backoff
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const isLastAttempt = attempt === maxRetries;

      this.log.info(`Claude execution attempt ${attempt}/${maxRetries}`, {
        issueNumber: issue.number,
        repoDir,
        timeoutMs,
        circuitState: this.circuitBreaker.getState(),
      });

      executionLogger.startAttempt(attempt);

      if (chatSessionId) {
        await addEvent(chatSessionId, 'claude_attempt', {
          type: 'claude_attempt',
          attempt,
          maxRetries,
          timeoutMs,
          message: `Starting Claude execution attempt ${attempt}/${maxRetries}`,
        });
      }

      try {
        attemptResult = await this.executeSingleClaudeAttempt(
          repoDir,
          issue,
          timeoutMs,
          chatSessionId,
          executionLogger
        );

        // Validate the response
        const validation = this.validateClaudeResponse(attemptResult, repoDir);

        if (validation.severity === 'error' && !isLastAttempt) {
          // Response validation failed - retry if possible
          const validationError = new ClaudeError(
            ErrorCode.CLAUDE_INVALID_RESPONSE,
            `Claude response validation failed: ${validation.issues.join(', ')}`,
            {
              context: {
                issueNumber: issue.number,
                toolUseCount: attemptResult.toolUseCount,
                turnCount: attemptResult.turnCount,
                validationIssues: validation.issues,
              },
            }
          );

          executionLogger.recordError(
            ErrorCode.CLAUDE_INVALID_RESPONSE,
            validationError.message,
            true
          );
          executionLogger.endAttempt(false);

          lastError = validationError;
          await this.handleRetryDelay(attempt, chatSessionId);
          continue;
        }

        // Success or acceptable response
        executionLogger.endAttempt(true);
        this.circuitBreaker.recordSuccess();

        // Log validation warnings if any
        if (validation.issues.length > 0) {
          this.log.warn('Claude execution completed with warnings', {
            issueNumber: issue.number,
            warnings: validation.issues,
            toolUseCount: attemptResult.toolUseCount,
            turnCount: attemptResult.turnCount,
          });
        }

        // Log successful execution history
        executionLogger.logFullHistory('debug');
        return;
      } catch (error) {
        lastError = error as Error;
        const errorCode = this.extractErrorCode(lastError);
        const isRetryable = this.isClaudeErrorRetryable(lastError);

        executionLogger.recordError(errorCode, lastError.message, isRetryable);
        executionLogger.endAttempt(false);

        this.circuitBreaker.recordFailure(lastError);

        this.log.warn(`Claude execution attempt ${attempt} failed`, {
          issueNumber: issue.number,
          error: lastError.message,
          errorCode,
          isRetryable,
          isLastAttempt,
        });

        if (chatSessionId) {
          await addEvent(chatSessionId, 'claude_error', {
            type: 'claude_error',
            attempt,
            error: lastError.message,
            errorCode,
            isRetryable,
          });
        }

        if (!isRetryable || isLastAttempt) {
          // Non-retryable error or exhausted retries
          break;
        }

        await this.handleRetryDelay(attempt, chatSessionId);
      }
    }

    // All retries exhausted - log full history for debugging
    executionLogger.logFullHistory('warn');

    const summary = executionLogger.getSummary();
    const finalError = new ClaudeError(
      ErrorCode.CLAUDE_API_ERROR,
      `Claude execution failed after ${summary.totalAttempts} attempts: ${lastError?.message || 'Unknown error'}`,
      {
        context: {
          issueNumber: issue.number,
          totalAttempts: summary.totalAttempts,
          totalDurationMs: summary.totalDurationMs,
          totalToolUses: summary.totalToolUses,
          totalTurns: summary.totalTurns,
          lastErrorCode: summary.lastError?.code,
        },
        cause: lastError,
        recoveryActions: [
          {
            description: 'Check Claude API status at https://status.anthropic.com',
            automatic: false,
          },
          {
            description: 'Review issue description for clarity and completeness',
            automatic: false,
          },
          {
            description: 'Task will be added to dead letter queue for manual review',
            automatic: true,
          },
        ],
      }
    );

    if (chatSessionId) {
      await addMessage(chatSessionId, 'error', finalError.message);
      await addEvent(chatSessionId, 'claude_failed', {
        type: 'claude_failed',
        summary,
        error: finalError.message,
      });
    }

    throw finalError;
  }

  /**
   * Execute a single Claude attempt with timeout handling
   */
  private async executeSingleClaudeAttempt(
    repoDir: string,
    issue: Issue,
    timeoutMs: number,
    chatSessionId: string | undefined,
    executionLogger: ClaudeExecutionLogger
  ): Promise<ClaudeExecutionResult> {
    const attemptStartTime = Date.now();
    const startMemory = getMemoryUsageMB();

    const prompt = this.buildPrompt(issue);
    const abortController = new AbortController();

    // Set up timeout with clear error messaging
    let timeoutTriggered = false;
    const timeoutId = setTimeout(() => {
      timeoutTriggered = true;
      abortController.abort();
      executionLogger.recordTimeout(timeoutMs);
    }, timeoutMs);

    let toolUseCount = 0;
    let turnCount = 0;
    let assistantTextBuffer = '';
    let hasWriteOperations = false;

    try {
      const stream = query({
        prompt,
        options: {
          cwd: repoDir,
          allowedTools: [
            'Read', 'Write', 'Edit', 'MultiEdit',
            'Bash', 'Glob', 'Grep',
            'LS', 'WebFetch',
          ],
          permissionMode: 'bypassPermissions',
          maxTurns: 50,
          abortController,
        },
      });

      for await (const message of stream) {
        const typedMessage = message as unknown as ClaudeSDKMessage;

        if (!validateSDKMessage(typedMessage)) {
          this.log.warn('Received invalid SDK message structure', {
            messageType: typeof message === 'object' && message !== null
              ? (message as Record<string, unknown>).type
              : 'unknown',
          });
          continue;
        }

        if (typedMessage.type === 'assistant') {
          turnCount++;

          if (typedMessage.message?.content) {
            for (const block of typedMessage.message.content) {
              const typedBlock = block as ContentBlock;

              if (isToolUseBlock(typedBlock)) {
                toolUseCount++;
                const { name: toolName, input: toolInput } = extractToolUseInfo(typedBlock);

                // Track write operations for validation
                if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
                  hasWriteOperations = true;
                }

                this.log.debug(`Tool: ${toolName}`, {
                  toolCount: toolUseCount,
                  turnCount,
                });

                metrics.recordToolUsage(toolName, {
                  repository: this.repository,
                  workerId: this.workerId,
                });

                // Record in execution logger
                executionLogger.recordToolUse(toolName, toolInput as Record<string, unknown>);

                if (chatSessionId) {
                  await addEvent(chatSessionId, 'tool_use', {
                    type: 'tool_use',
                    tool: toolName,
                    input: this.sanitizeToolInput(toolName, toolInput),
                    toolCount: toolUseCount,
                    turnCount,
                  });
                }
              } else if (isTextBlock(typedBlock)) {
                const text = extractTextContent(typedBlock);
                assistantTextBuffer += text + '\n';
                executionLogger.recordAssistantText(text);
              }
            }
          }

          // Periodically flush assistant text
          if (chatSessionId && assistantTextBuffer.length > 500) {
            await addMessage(chatSessionId, 'assistant', assistantTextBuffer.trim());
            assistantTextBuffer = '';
          }
        } else if (isResultMessage(typedMessage)) {
          const duration = extractResultDuration(typedMessage, Date.now() - attemptStartTime);
          const endMemory = getMemoryUsageMB();

          this.log.info(`Claude execution completed`, {
            duration,
            toolUseCount,
            turnCount,
            memoryDeltaMB: Math.round((endMemory - startMemory) * 100) / 100,
            circuitState: this.circuitBreaker.getState(),
          });

          metrics.recordClaudeApiCall('executeTask', true, duration, {
            repository: this.repository,
            workerId: this.workerId,
          });

          if (chatSessionId) {
            if (assistantTextBuffer.trim()) {
              await addMessage(chatSessionId, 'assistant', assistantTextBuffer.trim());
            }
            await addEvent(chatSessionId, 'claude_complete', {
              type: 'claude_complete',
              message: `Claude completed in ${Math.round(duration / 1000)}s`,
              duration_ms: duration,
              toolUseCount,
              turnCount,
            });
          }

          return {
            success: true,
            toolUseCount,
            turnCount,
            durationMs: duration,
            hasChanges: hasWriteOperations,
            validationIssues: [],
          };
        }
      }

      // Stream ended without explicit result
      const duration = Date.now() - attemptStartTime;
      return {
        success: true,
        toolUseCount,
        turnCount,
        durationMs: duration,
        hasChanges: hasWriteOperations,
        validationIssues: ['Stream ended without explicit completion'],
      };
    } catch (error) {
      const duration = Date.now() - attemptStartTime;

      // Check if this was a timeout
      if (timeoutTriggered) {
        const timeoutError = new ClaudeError(
          ErrorCode.CLAUDE_TIMEOUT,
          `Claude execution timed out after ${Math.round(timeoutMs / 1000)} seconds (5-minute limit). The task may be too complex or Claude may be experiencing delays.`,
          {
            context: {
              issueNumber: issue.number,
              timeoutMs,
              toolUseCount,
              turnCount,
              durationMs: duration,
            },
            recoveryActions: [
              {
                description: 'Retry with exponential backoff',
                automatic: true,
              },
              {
                description: 'Break down the task into smaller issues',
                automatic: false,
              },
              {
                description: 'Increase timeout configuration if tasks are consistently timing out',
                automatic: false,
              },
            ],
          }
        );

        metrics.recordClaudeApiCall('executeTask', false, duration, {
          repository: this.repository,
          workerId: this.workerId,
        });

        throw timeoutError;
      }

      // Record failed API call
      metrics.recordClaudeApiCall('executeTask', false, duration, {
        repository: this.repository,
        workerId: this.workerId,
      });

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Validate Claude response to detect incomplete implementations
   */
  private validateClaudeResponse(result: ClaudeExecutionResult, repoDir: string): ResponseValidation {
    const issues: string[] = [];
    let severity: ResponseValidation['severity'] = 'none';

    // Check if Claude made any changes
    if (!result.hasChanges && result.toolUseCount === 0) {
      issues.push('Claude made no file changes and used no tools');
      severity = 'error';
    } else if (!result.hasChanges) {
      issues.push('Claude used tools but made no file changes');
      severity = 'warning';
    }

    // Check for very short execution (might indicate immediate failure)
    if (result.durationMs < 5000 && result.turnCount < 2) {
      issues.push('Execution was very short, might indicate early failure');
      severity = severity === 'error' ? 'error' : 'warning';
    }

    // Check for excessive tool use without changes (might indicate stuck loop)
    if (result.toolUseCount > 20 && !result.hasChanges) {
      issues.push('Many tool uses but no changes made, possible stuck loop');
      severity = 'warning';
    }

    // Add any validation issues from the result itself
    issues.push(...result.validationIssues);

    return {
      isValid: severity !== 'error',
      hasChanges: result.hasChanges,
      issues,
      severity,
    };
  }

  /**
   * Handle retry delay with exponential backoff
   */
  private async handleRetryDelay(attempt: number, chatSessionId: string | undefined): Promise<void> {
    // Calculate delay: 2s, 4s, 8s (as per issue requirements)
    const delayIndex = Math.min(attempt - 1, CLAUDE_RETRY_DELAYS_MS.length - 1);
    const delay = CLAUDE_RETRY_DELAYS_MS[delayIndex];

    this.log.info(`Waiting ${delay}ms before retry attempt ${attempt + 1}`, {
      attempt,
      delay,
    });

    if (chatSessionId) {
      await addEvent(chatSessionId, 'retry_delay', {
        type: 'retry_delay',
        attempt,
        delayMs: delay,
        message: `Waiting ${delay / 1000}s before retry`,
      });
    }

    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * Extract error code from an error
   */
  private extractErrorCode(error: Error): string {
    if (error instanceof StructuredError) {
      return error.code;
    }

    // Check for common error patterns
    const message = error.message.toLowerCase();
    if (message.includes('timeout') || message.includes('abort')) {
      return ErrorCode.CLAUDE_TIMEOUT;
    }
    if (message.includes('rate limit') || message.includes('429')) {
      return ErrorCode.CLAUDE_RATE_LIMITED;
    }
    if (message.includes('network') || message.includes('connection')) {
      return ErrorCode.CLAUDE_NETWORK_ERROR;
    }
    if (message.includes('auth') || message.includes('unauthorized')) {
      return ErrorCode.CLAUDE_AUTH_FAILED;
    }

    return ErrorCode.CLAUDE_API_ERROR;
  }

  /**
   * Determine if a Claude error is retryable
   */
  private isClaudeErrorRetryable(error: Error): boolean {
    if (error instanceof StructuredError) {
      return error.isRetryable;
    }

    const message = error.message.toLowerCase();

    // Retryable errors
    if (
      message.includes('timeout') ||
      message.includes('rate limit') ||
      message.includes('429') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('504') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('temporarily unavailable') ||
      message.includes('overloaded')
    ) {
      return true;
    }

    // Non-retryable errors
    if (
      message.includes('auth') ||
      message.includes('unauthorized') ||
      message.includes('forbidden') ||
      message.includes('invalid token') ||
      message.includes('quota exceeded')
    ) {
      return false;
    }

    // Default to retryable for unknown errors
    return true;
  }

  private sanitizeToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
    // Truncate large inputs for logging
    if (!input) return input;

    const sanitized: Record<string, unknown> = { ...input };

    // Truncate file contents
    const content = sanitized.content;
    if (typeof content === 'string' && content.length > 500) {
      sanitized.content = content.slice(0, 500) + `... (${content.length} chars total)`;
    }

    // Truncate new_string/old_string for Edit tools
    const newString = sanitized.new_string;
    if (typeof newString === 'string' && newString.length > 200) {
      sanitized.new_string = newString.slice(0, 200) + '...';
    }
    const oldString = sanitized.old_string;
    if (typeof oldString === 'string' && oldString.length > 200) {
      sanitized.old_string = oldString.slice(0, 200) + '...';
    }

    return sanitized;
  }

  private buildPrompt(issue: Issue): string {
    return `You are an expert developer working on implementing a GitHub issue.

## Issue #${issue.number}: ${issue.title}

${issue.body || 'No description provided.'}

## Instructions

1. First, explore the codebase to understand the structure and existing patterns
2. Implement the changes described in the issue
3. Follow existing code style and conventions
4. Make sure your changes are complete and working
5. Do NOT create or modify test files unless specifically asked
6. Do NOT modify unrelated files
7. Keep changes focused and minimal

## Important

- Make real, working changes - not placeholder code
- Ensure the code compiles/builds successfully
- Follow TypeScript best practices if the project uses TypeScript
- Add appropriate comments only where they add value

Start by exploring the codebase, then implement the required changes.`;
  }

  private async hasChanges(repoDir: string): Promise<boolean> {
    const git = simpleGit(repoDir);
    const status = await git.status();
    return !status.isClean();
  }

  private async commitAndPush(repoDir: string, issue: Issue, branchName: string): Promise<string> {
    this.log.info('Committing and pushing changes...');

    const git = simpleGit(repoDir);

    // Stage all changes
    await git.add('.');

    // Create commit message
    const commitMessage = `${issue.title}

Implements #${issue.number}

🤖 Generated by Autonomous Dev CLI`;

    // Commit
    let commitSha: string;
    try {
      const commitResult = await git.commit(commitMessage);
      commitSha = commitResult.commit;
    } catch (error: any) {
      throw new ExecutionError(
        ErrorCode.EXEC_COMMIT_FAILED,
        `Failed to commit changes: ${error.message}`,
        {
          issueNumber: issue.number,
          branchName,
          context: { repoDir },
          cause: error,
        }
      );
    }

    // Push with retry for transient failures using enhanced retry
    const maxRetries = this.options.retryConfig?.maxRetries ?? 3;
    await retryWithBackoff(
      async (retryContext: RetryContext) => {
        // Log retry context for debugging
        if (retryContext.attempt > 0) {
          this.log.info(`Push attempt ${retryContext.attempt + 1}/${maxRetries + 1}`, {
            elapsedMs: retryContext.elapsedMs,
            currentTimeoutMs: retryContext.currentTimeoutMs,
          });
        }
        await git.push(['-u', 'origin', branchName]);
      },
      {
        config: {
          ...NETWORK_RETRY_CONFIG,
          maxRetries,
          progressiveTimeout: this.options.retryConfig?.progressiveTimeout ?? true,
        },
        operationName: 'git-push',
        onRetry: (error, attempt, delay, context) => {
          this.log.warn(`Push retry (attempt ${attempt}): ${error.message}, waiting ${delay}ms`, {
            totalElapsedMs: context.elapsedMs,
            nextTimeoutMs: context.currentTimeoutMs,
            commitSha,
          });

          // Record retry metrics
          metrics.recordError({
            repository: this.repository,
            errorCode: 'EXEC_PUSH_RETRY',
            severity: 'transient',
            isRetryable: true,
            component: 'Worker',
            operation: 'commitAndPush',
          });
        },
        onExhausted: (error, context) => {
          this.log.error('Push failed after all retries', {
            totalAttempts: context.attemptHistory.length + 1,
            totalElapsedMs: context.elapsedMs,
            commitSha,
            branchName,
          });
        },
        shouldRetry: (error) => {
          const message = error.message.toLowerCase();
          return (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('could not read from remote') ||
            message.includes('econnreset') ||
            message.includes('econnrefused')
          );
        },
      }
    ).catch((error) => {
      throw new ExecutionError(
        ErrorCode.EXEC_PUSH_FAILED,
        `Failed to push changes: ${error.message}`,
        {
          issueNumber: issue.number,
          branchName,
          context: {
            repoDir,
            commitSha,
          },
          cause: error,
        }
      );
    });

    this.log.info(`Pushed commit ${commitSha} to ${branchName}`);
    return commitSha;
  }
}
