import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  type ContentBlock,
  type ClaudeSDKMessage,
  type ResultMessage,
  type ToolResultBlock,
  isTextBlock,
  isToolUseBlock,
  isToolResultBlock,
  isResultMessage,
  isUserMessage,
  isErrorMessage,
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
  getStructuredFileLogger,
  isClaudeLoggingEnabled,
  isDebugModeEnabled,
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
  getErrorMessage,
  type ErrorContext,
  type RecoveryAction,
} from '../utils/errors.js';
import {
  ExecutorError,
  NetworkExecutorError,
  TimeoutExecutorError,
  GitExecutorError,
  ClaudeExecutorError,
  WorkspaceExecutorError,
  createExecutorError,
  getErrorAggregator,
  type TaskExecutionState,
  type ExecutionPhase,
  type ExecutorErrorContext,
  type ClaudeExecutionContext,
  type ToolCallInfo,
  type FileChangesSummary,
} from '../errors/executor-errors.js';
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
  withTimeout,
  createTimedAbortController,
  withCleanup,
  DEFAULT_TIMEOUTS,
  getTimeoutFromEnv,
  TimeoutError,
} from '../utils/timeout.js';
import {
  getDeadLetterQueue,
  type RetryAttempt,
} from '../utils/dead-letter-queue.js';
import { type Issue } from '../github/issues.js';
import { createGitHub } from '../github/index.js';
import { createConflictResolver, type MergeAttemptResult } from '../conflicts/resolver.js';
import {
  createChatSession,
  updateChatSession,
  addMessage,
  addEvent,
  generateSessionPath,
  softDeleteSessionsByIssue,
  type CreateChatSessionParams,
} from '../db/index.js';
import { loadSpecContext, type SpecContext } from '../discovery/spec-reader.js';
import { refreshClaudeToken, shouldRefreshToken, InvalidRefreshTokenError } from '../utils/claudeAuth.js';
import {
  ClaudeWebClient,
  type ClaudeSessionEvent as SessionEvent,
  type SessionResult,
} from '@webedt/shared';

/**
 * Callback for refreshing Claude OAuth tokens.
 * Returns the new tokens after successful refresh.
 */
export type TokenRefreshCallback = (
  currentRefreshToken: string
) => Promise<{ accessToken: string; refreshToken: string; expiresAt: number }>;

/**
 * Default timeout for Claude execution (30 minutes for complex tasks)
 */
const DEFAULT_CLAUDE_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Maximum number of recent tool calls to track for error context
 */
const MAX_RECENT_TOOL_CALLS = 10;

/**
 * Tracker for Claude execution context to provide comprehensive error debugging
 */
class ClaudeExecutionTracker {
  private taskDescription: string;
  private startTime: number;
  private currentTool: string | null = null;
  private currentToolInput: Record<string, unknown> | null = null;
  private recentToolCalls: ToolCallInfo[] = [];
  private createdFiles: Set<string> = new Set();
  private modifiedFiles: Set<string> = new Set();
  private deletedFiles: Set<string> = new Set();
  private turnsCompleted: number = 0;
  private totalToolsUsed: number = 0;
  private lastAssistantText: string = '';
  private hadWriteOperations: boolean = false;

  constructor(taskDescription: string) {
    this.taskDescription = taskDescription;
    this.startTime = Date.now();
  }

  /**
   * Record a tool call for tracking
   */
  recordToolCall(toolName: string, input: Record<string, unknown>): void {
    this.currentTool = toolName;
    this.currentToolInput = input;
    this.totalToolsUsed++;

    // Determine if this is a write operation and extract file path
    const isWriteOperation = ['Write', 'Edit', 'MultiEdit'].includes(toolName);
    const filePath = this.extractFilePath(toolName, input);

    if (isWriteOperation) {
      this.hadWriteOperations = true;

      // Track file changes
      if (filePath) {
        if (toolName === 'Write') {
          // Write could be create or modify - we'll track as create if new
          this.createdFiles.add(filePath);
        } else {
          // Edit/MultiEdit modify existing files
          this.modifiedFiles.add(filePath);
        }
      }
    }

    // Track deletion through Bash commands
    if (toolName === 'Bash') {
      const command = (input.command as string) || '';
      const deletePaths = this.extractDeletePaths(command);
      deletePaths.forEach(path => this.deletedFiles.add(path));
    }

    // Add to recent tool calls (keep last N)
    const toolCallInfo: ToolCallInfo = {
      toolName,
      input: this.sanitizeInput(toolName, input),
      timestamp: Date.now(),
      filePath,
      isWriteOperation,
    };

    this.recentToolCalls.push(toolCallInfo);
    if (this.recentToolCalls.length > MAX_RECENT_TOOL_CALLS) {
      this.recentToolCalls.shift();
    }
  }

  /**
   * Record a turn completion
   */
  recordTurn(): void {
    this.turnsCompleted++;
    // Clear current tool after turn
    this.currentTool = null;
    this.currentToolInput = null;
  }

  /**
   * Record assistant text output
   */
  recordAssistantText(text: string): void {
    this.lastAssistantText = text;
  }

  /**
   * Get the current execution context for error reporting
   */
  getContext(phase: ExecutionPhase): ClaudeExecutionContext {
    return {
      taskDescription: this.taskDescription,
      executionPhase: phase,
      currentTool: this.currentTool || undefined,
      currentToolInput: this.currentToolInput || undefined,
      recentToolCalls: [...this.recentToolCalls],
      fileChangesSummary: this.getFileChangesSummary(),
      turnsCompleted: this.turnsCompleted,
      totalToolsUsed: this.totalToolsUsed,
      executionDurationMs: Date.now() - this.startTime,
      lastAssistantText: this.lastAssistantText || undefined,
      hadWriteOperations: this.hadWriteOperations,
    };
  }

  /**
   * Get summary of file changes
   */
  private getFileChangesSummary(): FileChangesSummary {
    return {
      created: Array.from(this.createdFiles),
      modified: Array.from(this.modifiedFiles),
      deleted: Array.from(this.deletedFiles),
      totalOperations: this.createdFiles.size + this.modifiedFiles.size + this.deletedFiles.size,
    };
  }

  /**
   * Extract file path from tool input
   */
  private extractFilePath(toolName: string, input: Record<string, unknown>): string | undefined {
    switch (toolName) {
      case 'Write':
      case 'Edit':
      case 'Read':
        return (input.file_path as string) || (input.path as string);
      case 'MultiEdit':
        // MultiEdit operates on multiple files, return first one
        const edits = input.edits as Array<{ file_path?: string }>;
        return edits?.[0]?.file_path;
      case 'Glob':
      case 'Grep':
        return (input.path as string);
      default:
        return undefined;
    }
  }

  /**
   * Extract delete paths from Bash commands
   */
  private extractDeletePaths(command: string): string[] {
    const paths: string[] = [];
    // Match rm commands
    const rmMatch = command.match(/rm\s+(?:-[rf]+\s+)?([^\s&|;]+)/g);
    if (rmMatch) {
      rmMatch.forEach(match => {
        const pathMatch = match.match(/rm\s+(?:-[rf]+\s+)?(.+)/);
        if (pathMatch) {
          paths.push(pathMatch[1].trim());
        }
      });
    }
    return paths;
  }

  /**
   * Sanitize tool input for logging (truncate large content)
   */
  private sanitizeInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> {
    const sanitized: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(input)) {
      if (typeof value === 'string' && value.length > 200) {
        sanitized[key] = value.slice(0, 200) + `... (${value.length} chars)`;
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

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
  /** When true, Claude determined the feature was already implemented */
  alreadyImplemented: boolean;
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
  // Correlation tracking
  cycleCorrelationId?: string;
  cycleNumber?: number;
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
  // Spec-driven context for richer implementation guidance
  specContext?: {
    /** Relevant SPEC.md content for this task */
    specContent?: string;
    /** Existing implementation files to reference */
    existingFiles?: string[];
    /** Priority tier (P0-P3) */
    priorityTier?: string;
    /** Additional implementation notes */
    notes?: string;
  };
  // Merge configuration for auto-merge after PR creation
  mergeConfig?: {
    /** Automatically merge PRs after creation (default: true) */
    autoMerge?: boolean;
    /** Maximum merge retry attempts (default: 3) */
    maxRetries?: number;
    /** Strategy for handling merge conflicts: 'rebase', 'merge', 'manual', or 'ai' */
    conflictStrategy?: 'rebase' | 'merge' | 'manual' | 'ai';
    /** Git merge method: 'merge', 'squash', or 'rebase' */
    mergeMethod?: 'merge' | 'squash' | 'rebase';
  };
  /**
   * Callback to refresh Claude OAuth tokens when they expire.
   * If provided, tokens will be proactively refreshed before Claude execution
   * and the refreshed tokens will be persisted.
   */
  onTokenRefresh?: TokenRefreshCallback;
  /**
   * Use Claude Remote Sessions API instead of local Claude Agent SDK.
   * When enabled, execution is delegated to Anthropic's hosted infrastructure.
   */
  useRemoteSessions?: boolean;
  /**
   * Environment ID for Claude Remote Sessions (required when useRemoteSessions is true).
   * Example: env_011CUubbAJQDeejWqiLomwqf
   */
  claudeEnvironmentId?: string;
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
  pullRequest?: {
    number: number;
    htmlUrl: string;
    merged?: boolean;
    mergeSha?: string;
  };
  error?: string;
  duration: number;
  chatSessionId?: string;
  /** When true, Claude determined the feature was already implemented - issue should be closed */
  alreadyImplemented?: boolean;
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
    // Use timeoutMinutes from options, falling back to default
    const timeoutMs = options.timeoutMinutes ? options.timeoutMinutes * 60 * 1000 : DEFAULT_CLAUDE_TIMEOUT_MS;
    this.claudeRetryConfig = {
      ...DEFAULT_CLAUDE_RETRY_CONFIG,
      timeoutMs,
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
   * Get enhanced error context with execution state for debugging
   */
  private getErrorContext(
    operation: string,
    task?: WorkerTask,
    executionState?: Partial<TaskExecutionState>
  ): ExecutorErrorContext {
    return {
      operation,
      component: 'Worker',
      workerId: this.workerId,
      repoUrl: this.options.repoUrl,
      baseBranch: this.options.baseBranch,
      timeoutMinutes: this.options.timeoutMinutes,
      issueNumber: task?.issue.number,
      branchName: task?.branchName,
      circuitBreakerState: this.circuitBreaker.getState(),
      executionState: executionState ? {
        taskId: `task-${task?.issue.number}`,
        issueNumber: task?.issue.number,
        branchName: task?.branchName,
        workerId: this.workerId,
        ...executionState,
      } : undefined,
    };
  }

  /**
   * Wrap an error with execution context using typed executor errors.
   * Classifies the error based on its characteristics and returns
   * an appropriate typed error with recovery strategy.
   */
  private wrapExecutionError(
    error: any,
    code: ErrorCode,
    message: string,
    task?: WorkerTask,
    executionState?: Partial<TaskExecutionState>
  ): ExecutorError | ExecutionError {
    // If already a typed executor error, return as-is
    if (error instanceof ExecutorError) {
      // Add to error aggregator for pattern analysis
      getErrorAggregator().addError(error, {
        taskId: `task-${task?.issue.number}`,
        workerId: this.workerId,
      });
      return error;
    }

    if (error instanceof StructuredError) {
      // Add to error aggregator for pattern analysis
      getErrorAggregator().addError(error, {
        taskId: `task-${task?.issue.number}`,
        workerId: this.workerId,
      });
      return error as ExecutionError;
    }

    const context = this.getErrorContext('execute', task, executionState);

    // Create typed executor error based on error characteristics
    const typedError = createExecutorError(error, context);

    // Add to error aggregator for pattern analysis
    getErrorAggregator().addError(typedError, {
      taskId: `task-${task?.issue.number}`,
      workerId: this.workerId,
    });

    return typedError;
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
          issueNumber: issue.number,
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
      } catch (error: unknown) {
        taskLog.warn(`Failed to create chat session: ${getErrorMessage(error)}`);
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

      // Refresh tokens if needed and write Claude credentials
      await this.refreshTokensIfNeeded();
      this.writeClaudeCredentials();

      // Execute task with Claude
      if (chatSessionId) {
        await addEvent(chatSessionId, 'claude_start', { type: 'claude_start', message: 'Starting Claude Agent SDK...' });
      }
      const claudeValidation = await this.executeWithClaude(repoDir, issue, chatSessionId);

      // Check if there are any changes
      const hasChanges = await this.hasChanges(repoDir);
      if (!hasChanges) {
        const duration = Date.now() - startTime;

        // Check if Claude determined the feature was already implemented
        if (claudeValidation.alreadyImplemented) {
          taskLog.info('Feature already implemented - no changes needed', {
            issueNumber: issue.number,
            validationIssues: claudeValidation.issues,
          });
          if (chatSessionId) {
            await addMessage(chatSessionId, 'system', 'Feature already implemented - no changes needed');
            await updateChatSession(chatSessionId, { status: 'completed', completedAt: new Date() });
          }

          // Record as success (feature exists, just needs issue closure)
          metrics.recordTaskCompletion(true, duration, {
            repository: this.repository,
            taskType: 'issue',
            workerId: this.workerId,
          });

          return {
            success: false, // Still false since no PR was created, but with alreadyImplemented flag
            issue,
            branchName,
            error: 'Feature already implemented',
            duration,
            chatSessionId,
            alreadyImplemented: true,
          };
        }

        // Regular "no changes" failure
        taskLog.warn('No changes made by Claude');
        if (chatSessionId) {
          await addMessage(chatSessionId, 'system', 'No changes were made by Claude');
          await updateChatSession(chatSessionId, { status: 'completed', completedAt: new Date() });
        }

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
      }

      // Create Pull Request to base branch
      let pullRequest: { number: number; htmlUrl: string; merged?: boolean; mergeSha?: string } | undefined;
      try {
        if (chatSessionId) {
          await addEvent(chatSessionId, 'pr_progress', { type: 'pr_progress', stage: 'creating', message: 'Creating pull request...' });
        }
        pullRequest = await this.createPullRequest(issue, branchName);
        taskLog.info(`Created PR #${pullRequest.number}`, {
          prNumber: pullRequest.number,
          htmlUrl: pullRequest.htmlUrl,
          branchName,
        });
        if (chatSessionId) {
          await addEvent(chatSessionId, 'pr_progress', { type: 'pr_progress', stage: 'created', message: `Created PR #${pullRequest.number}`, data: { prNumber: pullRequest.number, htmlUrl: pullRequest.htmlUrl } });
        }

        // Attempt auto-merge if enabled
        const mergeConfig = this.options.mergeConfig;
        if (mergeConfig?.autoMerge !== false) {
          try {
            if (chatSessionId) {
              await addEvent(chatSessionId, 'merge_progress', { type: 'merge_progress', stage: 'merging', message: 'Attempting auto-merge...' });
            }
            const mergeResult = await this.attemptAutoMerge(issue, branchName, pullRequest.number);
            if (mergeResult.merged) {
              pullRequest.merged = true;
              pullRequest.mergeSha = mergeResult.sha;
              taskLog.success(`PR #${pullRequest.number} auto-merged successfully`, {
                prNumber: pullRequest.number,
                mergeSha: mergeResult.sha,
              });

              // Close the issue after successful merge (GitHub only auto-closes on merge to default branch)
              try {
                await this.closeIssue(issue.number, pullRequest.number, pullRequest.mergeSha || undefined);
                taskLog.success(`Issue #${issue.number} closed`, { issueNumber: issue.number });
                if (chatSessionId) {
                  await addEvent(chatSessionId, 'issue_progress', { type: 'issue_progress', stage: 'closed', message: `Issue #${issue.number} closed`, data: { issueNumber: issue.number } });
                }
              } catch (closeError: unknown) {
                taskLog.warn(`Failed to close issue #${issue.number}: ${getErrorMessage(closeError)}`, {
                  issueNumber: issue.number,
                });
              }

              if (chatSessionId) {
                await addEvent(chatSessionId, 'merge_progress', { type: 'merge_progress', stage: 'merged', message: `PR #${pullRequest.number} merged!`, data: { prNumber: pullRequest.number, mergeSha: mergeResult.sha } });
                await addMessage(chatSessionId, 'assistant', `Successfully completed task!\n\nCommit: ${commitSha}\nBranch: ${branchName}\nPR: #${pullRequest.number} - ${pullRequest.htmlUrl}\n\n✅ PR was auto-merged to ${this.options.baseBranch}\n✅ Issue #${issue.number} closed`);
              }
            } else {
              taskLog.info(`PR #${pullRequest.number} not merged: ${mergeResult.error}`, {
                prNumber: pullRequest.number,
                attempts: mergeResult.attempts,
              });
              if (chatSessionId) {
                await addEvent(chatSessionId, 'merge_progress', { type: 'merge_progress', stage: 'pending', message: `PR created but not merged: ${mergeResult.error}` });
                await addMessage(chatSessionId, 'assistant', `Successfully committed, pushed, and created pull request.\n\nCommit: ${commitSha}\nBranch: ${branchName}\nPR: #${pullRequest.number} - ${pullRequest.htmlUrl}\n\nNote: Auto-merge was attempted but not completed: ${mergeResult.error}`);
              }
            }
          } catch (mergeError: unknown) {
            taskLog.warn(`Auto-merge failed: ${getErrorMessage(mergeError)}`, {
              prNumber: pullRequest.number,
              issueNumber: issue.number,
            });
            if (chatSessionId) {
              await addEvent(chatSessionId, 'merge_progress', { type: 'merge_progress', stage: 'failed', message: `Auto-merge failed: ${getErrorMessage(mergeError)}` });
              await addMessage(chatSessionId, 'assistant', `Successfully committed, pushed, and created pull request.\n\nCommit: ${commitSha}\nBranch: ${branchName}\nPR: #${pullRequest.number} - ${pullRequest.htmlUrl}\n\nNote: Auto-merge failed - manual review may be needed.`);
            }
          }
        } else {
          // Auto-merge disabled
          if (chatSessionId) {
            await addMessage(chatSessionId, 'assistant', `Successfully committed, pushed, and created pull request.\n\nCommit: ${commitSha}\nBranch: ${branchName}\nPR: #${pullRequest.number} - ${pullRequest.htmlUrl}`);
          }
        }
      } catch (prError: unknown) {
        // PR creation failure is not fatal - log and continue
        taskLog.warn(`Failed to create PR: ${getErrorMessage(prError)}`, {
          issueNumber: issue.number,
          branchName,
        });
        if (chatSessionId) {
          await addEvent(chatSessionId, 'pr_progress', { type: 'pr_progress', stage: 'failed', message: `PR creation failed: ${getErrorMessage(prError)}` });
          await addMessage(chatSessionId, 'assistant', `Successfully committed and pushed changes.\n\nCommit: ${commitSha}\nBranch: ${branchName}\n\nNote: PR creation failed - you may need to create the PR manually.`);
        }
      }

      if (chatSessionId) {
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

      // Write to structured file log if enabled
      const structuredLogger = getStructuredFileLogger();
      if (structuredLogger.isEnabled()) {
        structuredLogger.writeTaskLog(
          issue.number,
          correlationId,
          this.workerId,
          true,
          duration,
          branchName,
          commitSha
        );
      }

      return {
        success: true,
        issue,
        branchName,
        commitSha,
        pullRequest,
        duration,
        chatSessionId,
      };
    } catch (error: unknown) {
      // Track execution state at time of failure
      const executionState: Partial<TaskExecutionState> = {
        taskId: `task-${issue.number}`,
        issueNumber: issue.number,
        branchName,
        workerId: this.workerId,
        durationMs: Date.now() - startTime,
        memoryUsageMB: getMemoryUsageMB(),
        requiresCleanup: true,
      };

      // Wrap the error with structured context using typed executor errors
      const structuredError = this.wrapExecutionError(
        error,
        ErrorCode.INTERNAL_ERROR,
        `Task execution failed: ${getErrorMessage(error)}`,
        task,
        executionState
      );

      const duration = Date.now() - startTime;
      const endMemory = getMemoryUsageMB();
      const memoryDelta = Math.round((endMemory - startMemory) * 100) / 100;

      // Record error in correlation tracking
      metrics.recordCorrelationError(correlationId);

      // Record error metrics with recovery strategy information
      const recoveryStrategy = structuredError instanceof ExecutorError
        ? structuredError.recoveryStrategy.strategy
        : (structuredError.isRetryable ? 'retry' : 'escalate');

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
        recoveryStrategy,
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

      // Write to structured file log if enabled
      const structuredLogger = getStructuredFileLogger();
      if (structuredLogger.isEnabled()) {
        structuredLogger.writeTaskLog(
          issue.number,
          correlationId,
          this.workerId,
          false,
          duration,
          branchName,
          undefined,
          `[${structuredError.code}] ${structuredError.message}`
        );
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
    // Get git operation timeout from environment or use default (30 seconds)
    const gitTimeoutMs = getTimeoutFromEnv('GIT_OPERATION', DEFAULT_TIMEOUTS.GIT_OPERATION);

    // Clone with retry for transient network failures using enhanced retry
    // Each individual clone attempt is wrapped with timeout protection
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

        // Wrap the clone operation with timeout protection
        return withTimeout(
          async () => {
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
            timeoutMs: gitTimeoutMs,
            operationName: 'git-clone',
            context: {
              repoUrl: this.options.repoUrl,
              baseBranch: this.options.baseBranch,
              attempt: retryContext.attempt,
            },
            onTimeout: (timeoutMs, operationName) => {
              this.log.warn(`Git clone timed out after ${timeoutMs}ms`, {
                attempt: retryContext.attempt,
                repoUrl: this.options.repoUrl,
              });
            },
          }
        );
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
            errorCode: error instanceof TimeoutError ? 'EXEC_CLONE_TIMEOUT' : 'EXEC_CLONE_RETRY',
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
          // Timeout errors are retryable
          if (error instanceof TimeoutError) {
            return true;
          }
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
      // Use typed GitExecutorError for clone failures
      throw new GitExecutorError(
        `Failed to clone repository: ${error.message}`,
        {
          operation: 'clone',
          context: {
            repoUrl: this.options.repoUrl,
            baseBranch: this.options.baseBranch,
            operation: 'repository_clone',
          },
          executionState: {
            phase: 'repository_clone',
            workerId: this.workerId,
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

  /**
   * Refresh Claude tokens if they are about to expire.
   * Updates this.options.claudeAuth with fresh tokens and persists via callback.
   * Throws InvalidRefreshTokenError if the refresh token is permanently invalid.
   */
  private async refreshTokensIfNeeded(): Promise<void> {
    const expiresAt = this.options.claudeAuth.expiresAt;

    // Skip if no expiry info or token is still valid
    if (!expiresAt || !shouldRefreshToken(expiresAt)) {
      return;
    }

    this.log.info('Claude token expiring soon, refreshing before execution', {
      expiresAt: new Date(expiresAt).toISOString(),
      expiresIn: Math.round((expiresAt - Date.now()) / 1000),
    });

    // If we have a callback, use it (it will also persist to database)
    if (this.options.onTokenRefresh) {
      try {
        const newAuth = await this.options.onTokenRefresh(this.options.claudeAuth.refreshToken);

        // Update our local copy
        this.options.claudeAuth = {
          accessToken: newAuth.accessToken,
          refreshToken: newAuth.refreshToken,
          expiresAt: newAuth.expiresAt,
        };

        this.log.info('Claude tokens refreshed successfully via callback', {
          newExpiresAt: new Date(newAuth.expiresAt).toISOString(),
        });
      } catch (error) {
        // Re-throw InvalidRefreshTokenError - this is unrecoverable
        if (error instanceof InvalidRefreshTokenError) {
          this.log.error('Refresh token is invalid or expired - cannot continue', {
            error: error.message,
          });
          throw error;
        }

        // For other errors, log warning and try direct refresh
        this.log.warn('Token refresh via callback failed, attempting direct refresh', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // If no callback or callback failed (non-fatally), try direct refresh
    // This won't persist to DB but will at least work for this execution
    if (shouldRefreshToken(this.options.claudeAuth.expiresAt || 0)) {
      try {
        const newAuth = await refreshClaudeToken(this.options.claudeAuth.refreshToken);

        // Update our local copy
        this.options.claudeAuth = {
          accessToken: newAuth.accessToken,
          refreshToken: newAuth.refreshToken,
          expiresAt: newAuth.expiresAt,
        };

        this.log.info('Claude tokens refreshed via direct API call', {
          newExpiresAt: new Date(newAuth.expiresAt).toISOString(),
        });
      } catch (error) {
        // Re-throw InvalidRefreshTokenError - this is unrecoverable
        if (error instanceof InvalidRefreshTokenError) {
          throw error;
        }

        this.log.warn('Direct token refresh failed, proceeding with existing token', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
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
   * @returns ResponseValidation with alreadyImplemented flag when Claude determines feature exists
   */
  private async executeWithClaude(repoDir: string, issue: Issue, chatSessionId?: string): Promise<ResponseValidation> {
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
        // Choose execution method based on options
        if (this.options.useRemoteSessions) {
          // Use Claude Remote Sessions API (Anthropic-hosted)
          attemptResult = await this.executeRemoteClaudeAttempt(
            issue,
            timeoutMs,
            chatSessionId,
            executionLogger
          );
        } else {
          // Use local Claude Agent SDK
          attemptResult = await this.executeSingleClaudeAttempt(
            repoDir,
            issue,
            timeoutMs,
            chatSessionId,
            executionLogger
          );
        }

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
            alreadyImplemented: validation.alreadyImplemented,
          });
        }

        // Log successful execution history
        executionLogger.logFullHistory('debug');
        return validation;
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

    // Extract Claude execution context from last error if available
    const lastClaudeError = lastError instanceof ClaudeExecutorError ? lastError : undefined;
    const lastExecutionContext = lastClaudeError?.claudeExecutionContext;

    // Use typed ClaudeExecutorError for final failure after retries exhausted
    const finalError = new ClaudeExecutorError(
      `Claude execution failed after ${summary.totalAttempts} attempts: ${lastError?.message || 'Unknown error'}`,
      {
        claudeErrorType: lastClaudeError?.claudeErrorType ?? 'api',
        toolsUsed: summary.totalToolUses,
        turnsCompleted: summary.totalTurns,
        context: {
          operation: 'claude_execution',
          issueNumber: issue.number,
        },
        executionState: {
          phase: 'claude_execution',
          issueNumber: issue.number,
          toolsUsed: summary.totalToolUses,
          durationMs: summary.totalDurationMs,
          retryAttempt: summary.totalAttempts,
          maxRetries: maxRetries,
          workerId: this.workerId,
          claudeExecutionContext: lastExecutionContext,
        },
        claudeExecutionContext: lastExecutionContext,
        recoveryStrategy: {
          strategy: 'escalate',
          escalateAfterRetries: true,
          manualInstructions: [
            'Check Claude API status at https://status.anthropic.com',
            'Review issue description for clarity and completeness',
            'Task will be added to dead letter queue for manual review',
          ],
        },
        cause: lastError,
      }
    );

    // Log comprehensive error context if available
    if (lastExecutionContext) {
      this.log.error('Claude execution failed after all retries with context', {
        issueNumber: issue.number,
        totalAttempts: summary.totalAttempts,
        totalToolUses: summary.totalToolUses,
        currentTool: lastExecutionContext.currentTool,
        recentToolCount: lastExecutionContext.recentToolCalls.length,
        fileChanges: lastExecutionContext.fileChangesSummary,
        hadWriteOperations: lastExecutionContext.hadWriteOperations,
      });
    }

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
    const correlationId = generateCorrelationId();

    // Create task description for error context
    const taskDescription = `Issue #${issue.number}: ${issue.title}`;

    // Initialize execution tracker for comprehensive error context
    const executionTracker = new ClaudeExecutionTracker(taskDescription);

    // Log internal state snapshot for debugging
    this.log.debugState('ClaudeExecution', 'Starting execution attempt', {
      issueNumber: issue.number,
      repoDir,
      timeoutMs,
      startMemory,
      workerId: this.workerId,
      circuitBreakerState: this.circuitBreaker.getState(),
      claudeRetryConfig: this.claudeRetryConfig,
    });

    const prompt = this.buildPrompt(issue, repoDir);

    // Use createTimedAbortController for proper cleanup management
    // This ensures the timeout is always cleared even if an error occurs
    const { controller: abortController, cleanup: cleanupAbort, isTimedOut } = createTimedAbortController(
      timeoutMs,
      `Claude execution for issue #${issue.number}`
    );

    // Track timeout separately for logging
    let timeoutTriggered = false;
    const timeoutId = setTimeout(() => {
      timeoutTriggered = true;
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
          executionTracker.recordTurn();

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

                // Record in execution tracker for error context
                executionTracker.recordToolCall(toolName, toolInput as Record<string, unknown>);

                // Log progress every 10 tool uses to show activity
                if (toolUseCount % 10 === 0 || toolUseCount <= 3) {
                  const elapsed = Math.round((Date.now() - attemptStartTime) / 1000);
                  this.log.info(`Claude progress: ${toolUseCount} tools, ${turnCount} turns (${elapsed}s)`, {
                    issueNumber: issue.number,
                    workerId: this.workerId,
                  });
                }

                // Enhanced debug logging for Claude tool use
                this.log.claudeToolUse(toolName, toolInput as Record<string, unknown>, {
                  correlationId,
                  workerId: this.workerId,
                  issueNumber: issue.number,
                  turnCount,
                  toolCount: toolUseCount,
                });

                // Also log at debug level for standard logging
                if (!isClaudeLoggingEnabled()) {
                  this.log.debug(`Tool: ${toolName}`, {
                    toolCount: toolUseCount,
                    turnCount,
                  });
                }

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
                executionTracker.recordAssistantText(text);

                // Log assistant thinking/text in verbose mode
                if (isDebugModeEnabled() && text.trim()) {
                  // Truncate very long text for console output
                  const displayText = text.length > 500 ? text.slice(0, 500) + '...' : text;
                  this.log.debug(`Claude thinking: ${displayText.replace(/\n/g, ' ').trim()}`, {
                    workerId: this.workerId,
                    textLength: text.length,
                  });
                }
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
        } else if (isUserMessage(typedMessage)) {
          // User messages contain tool results - log them in verbose mode
          if (isDebugModeEnabled()) {
            const content = typedMessage.content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (isToolResultBlock(block as ContentBlock)) {
                  const resultBlock = block as ToolResultBlock;
                  const resultContent = typeof resultBlock.content === 'string'
                    ? resultBlock.content
                    : JSON.stringify(resultBlock.content);
                  const displayContent = resultContent.length > 300
                    ? resultContent.slice(0, 300) + '...'
                    : resultContent;
                  this.log.debug(`Tool result${resultBlock.is_error ? ' (ERROR)' : ''}: ${displayContent.replace(/\n/g, ' ').trim()}`, {
                    workerId: this.workerId,
                    toolUseId: resultBlock.tool_use_id,
                    isError: resultBlock.is_error,
                    contentLength: resultContent.length,
                  });
                }
              }
            }
          }
        } else if (isErrorMessage(typedMessage)) {
          // Log error messages from Claude
          this.log.error(`Claude error: ${typedMessage.error.message}`, {
            workerId: this.workerId,
            errorType: typedMessage.error.type,
          });
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

      // Get comprehensive execution context for error reporting
      const claudeExecutionContext = executionTracker.getContext('claude_execution');

      // Check if this was a timeout (using both tracking methods for reliability)
      if (timeoutTriggered || isTimedOut()) {
        // Use typed ClaudeExecutorError for timeout failures with comprehensive context
        const timeoutError = new ClaudeExecutorError(
          `Claude execution timed out after ${Math.round(timeoutMs / 1000)} seconds (${Math.round(timeoutMs / 60000)}-minute limit). The task may be too complex or Claude may be experiencing delays.`,
          {
            claudeErrorType: 'timeout',
            toolsUsed: toolUseCount,
            turnsCompleted: turnCount,
            context: {
              operation: 'claude_execution',
              issueNumber: issue.number,
            },
            executionState: {
              phase: 'claude_execution',
              issueNumber: issue.number,
              toolsUsed: toolUseCount,
              durationMs: duration,
              workerId: this.workerId,
              claudeExecutionContext,
            },
            claudeExecutionContext,
          }
        );

        // Log comprehensive error context for debugging
        this.log.error('Claude execution timeout with context', {
          issueNumber: issue.number,
          duration,
          toolUseCount,
          turnCount,
          currentTool: claudeExecutionContext.currentTool,
          recentToolCount: claudeExecutionContext.recentToolCalls.length,
          fileChanges: claudeExecutionContext.fileChangesSummary,
        });

        metrics.recordClaudeApiCall('executeTask', false, duration, {
          repository: this.repository,
          workerId: this.workerId,
        });

        throw timeoutError;
      }

      // For non-timeout errors, wrap with comprehensive context
      const wrappedError = new ClaudeExecutorError(
        `Claude execution failed: ${getErrorMessage(error)}`,
        {
          claudeErrorType: 'api',
          toolsUsed: toolUseCount,
          turnsCompleted: turnCount,
          context: {
            operation: 'claude_execution',
            issueNumber: issue.number,
          },
          executionState: {
            phase: 'claude_execution',
            issueNumber: issue.number,
            toolsUsed: toolUseCount,
            durationMs: duration,
            workerId: this.workerId,
            claudeExecutionContext,
          },
          claudeExecutionContext,
          cause: error instanceof Error ? error : undefined,
        }
      );

      // Log comprehensive error context for debugging
      this.log.error('Claude execution failed with context', {
        issueNumber: issue.number,
        duration,
        toolUseCount,
        turnCount,
        currentTool: claudeExecutionContext.currentTool,
        recentToolCount: claudeExecutionContext.recentToolCalls.length,
        fileChanges: claudeExecutionContext.fileChangesSummary,
        originalError: getErrorMessage(error),
      });

      // Record failed API call
      metrics.recordClaudeApiCall('executeTask', false, duration, {
        repository: this.repository,
        workerId: this.workerId,
      });

      throw wrappedError;
    } finally {
      // Always clean up both timeouts to prevent leaks
      // This ensures cleanup happens even when errors occur
      clearTimeout(timeoutId);
      cleanupAbort();
    }
  }

  /**
   * Execute Claude task using Remote Sessions API (Anthropic-hosted infrastructure).
   * This delegates all execution to Anthropic's servers.
   */
  private async executeRemoteClaudeAttempt(
    issue: Issue,
    timeoutMs: number,
    chatSessionId: string | undefined,
    executionLogger: ClaudeExecutionLogger
  ): Promise<ClaudeExecutionResult> {
    const attemptStartTime = Date.now();
    const correlationId = generateCorrelationId();

    // Validate required options for remote sessions
    if (!this.options.claudeEnvironmentId) {
      throw new ClaudeExecutorError(
        'Claude Environment ID is required for remote sessions. Set claudeEnvironmentId in worker options.',
        {
          claudeErrorType: 'api',
          toolsUsed: 0,
          turnsCompleted: 0,
          context: { operation: 'remote_session_init', issueNumber: issue.number },
        }
      );
    }

    this.log.info('Starting Claude Remote Session execution', {
      issueNumber: issue.number,
      workerId: this.workerId,
      correlationId,
      environmentId: this.options.claudeEnvironmentId,
    });

    const prompt = this.buildPrompt(issue);

    // Create the remote client
    const client = new ClaudeWebClient({
      accessToken: this.options.claudeAuth.accessToken,
      environmentId: this.options.claudeEnvironmentId,
    });

    let toolUseCount = 0;
    let turnCount = 0;
    let hasWriteOperations = false;
    let assistantTextBuffer = '';
    let sessionResult: SessionResult | undefined;

    try {
      // Create abort controller for timeout
      const abortController = new AbortController();
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, timeoutMs);

      // Event callback to process remote session events
      const onEvent = async (event: SessionEvent): Promise<void> => {
        if (event.type === 'tool_use' && event.tool_use) {
          toolUseCount++;
          const toolName = event.tool_use.name;
          const toolInput = event.tool_use.input as Record<string, unknown>;

          // Track write operations
          if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
            hasWriteOperations = true;
          }

          // Log progress
          if (toolUseCount % 10 === 0 || toolUseCount <= 3) {
            const elapsed = Math.round((Date.now() - attemptStartTime) / 1000);
            this.log.info(`Claude Remote progress: ${toolUseCount} tools, ${turnCount} turns (${elapsed}s)`, {
              issueNumber: issue.number,
              workerId: this.workerId,
            });
          }

          this.log.claudeToolUse(toolName, toolInput, {
            correlationId,
            workerId: this.workerId,
            issueNumber: issue.number,
            turnCount,
            toolCount: toolUseCount,
          });

          metrics.recordToolUsage(toolName, {
            repository: this.repository,
            workerId: this.workerId,
          });

          executionLogger.recordToolUse(toolName, toolInput);

          if (chatSessionId) {
            await addEvent(chatSessionId, 'tool_use', {
              type: 'tool_use',
              tool: toolName,
              input: this.sanitizeToolInput(toolName, toolInput),
              toolCount: toolUseCount,
              turnCount,
              source: 'claude-remote',
            });
          }
        } else if (event.type === 'assistant' && event.message) {
          turnCount++;
          const content = event.message.content;
          if (typeof content === 'string') {
            assistantTextBuffer += content + '\n';
            executionLogger.recordAssistantText(content);
          } else if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text' && block.text) {
                assistantTextBuffer += block.text + '\n';
                executionLogger.recordAssistantText(block.text);
              }
            }
          }

          // Periodically flush assistant text
          if (chatSessionId && assistantTextBuffer.length > 500) {
            await addMessage(chatSessionId, 'assistant', assistantTextBuffer.trim());
            assistantTextBuffer = '';
          }
        } else if (event.type === 'result') {
          // Extract result info if available
          if (event.total_cost_usd !== undefined) {
            this.log.info('Claude Remote session cost', {
              totalCost: event.total_cost_usd,
              issueNumber: issue.number,
            });
          }
        } else if (event.type === 'env_manager_log' && event.data?.message) {
          // Log environment manager events (cloning, etc.)
          this.log.debug(`Remote env: ${event.data.message}`, {
            issueNumber: issue.number,
            workerId: this.workerId,
          });
        }
      };

      // Execute the remote session
      sessionResult = await client.execute(
        {
          prompt,
          gitUrl: this.options.repoUrl,
        },
        onEvent,
        {
          pollIntervalMs: 2000,
          abortSignal: abortController.signal,
        }
      );

      clearTimeout(timeoutId);

      const duration = Date.now() - attemptStartTime;

      this.log.info('Claude Remote execution completed', {
        duration,
        toolUseCount,
        turnCount,
        sessionId: sessionResult.sessionId,
        branch: sessionResult.branch,
        totalCost: sessionResult.totalCost,
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
          message: `Claude Remote completed in ${Math.round(duration / 1000)}s`,
          duration_ms: duration,
          toolUseCount,
          turnCount,
          remoteSessionId: sessionResult.sessionId,
          branch: sessionResult.branch,
          totalCost: sessionResult.totalCost,
        });
      }

      return {
        success: sessionResult.status === 'completed' || sessionResult.status === 'idle',
        toolUseCount,
        turnCount,
        durationMs: duration,
        hasChanges: hasWriteOperations || !!sessionResult.branch,
        validationIssues: [],
      };

    } catch (error) {
      const duration = Date.now() - attemptStartTime;

      // Check for abort/timeout
      if (error instanceof Error && error.name === 'AbortError') {
        const timeoutError = new ClaudeExecutorError(
          `Claude Remote execution timed out after ${Math.round(timeoutMs / 1000)} seconds`,
          {
            claudeErrorType: 'timeout',
            toolsUsed: toolUseCount,
            turnsCompleted: turnCount,
            context: {
              operation: 'remote_session_execution',
              issueNumber: issue.number,
            },
          }
        );

        this.log.error('Claude Remote execution timeout', {
          issueNumber: issue.number,
          duration,
          toolUseCount,
          turnCount,
        });

        metrics.recordClaudeApiCall('executeTask', false, duration, {
          repository: this.repository,
          workerId: this.workerId,
        });

        throw timeoutError;
      }

      // Wrap other errors
      const wrappedError = new ClaudeExecutorError(
        `Claude Remote execution failed: ${getErrorMessage(error)}`,
        {
          claudeErrorType: 'api',
          toolsUsed: toolUseCount,
          turnsCompleted: turnCount,
          context: {
            operation: 'remote_session_execution',
            issueNumber: issue.number,
          },
          cause: error instanceof Error ? error : undefined,
        }
      );

      this.log.error('Claude Remote execution failed', {
        issueNumber: issue.number,
        duration,
        toolUseCount,
        turnCount,
        error: getErrorMessage(error),
      });

      metrics.recordClaudeApiCall('executeTask', false, duration, {
        repository: this.repository,
        workerId: this.workerId,
      });

      throw wrappedError;
    }
  }

  /**
   * Validate Claude response to detect incomplete implementations
   */
  private validateClaudeResponse(result: ClaudeExecutionResult, repoDir: string): ResponseValidation {
    const issues: string[] = [];
    let severity: ResponseValidation['severity'] = 'none';
    let alreadyImplemented = false;

    // Check if Claude made any changes
    if (!result.hasChanges && result.toolUseCount === 0) {
      issues.push('Claude made no file changes and used no tools');
      severity = 'error';
    } else if (!result.hasChanges) {
      // If Claude used tools but made no changes, check if it's a reasonable amount
      // This could indicate the feature was already implemented (valid) or a stuck loop (invalid)
      if (result.toolUseCount <= 15) {
        // Reasonable tool use count - likely checked and found already implemented
        issues.push('Claude used tools but made no file changes (feature may already be implemented)');
        severity = 'warning'; // Warning, not error - this is acceptable
        // Mark as already implemented - Claude investigated and found the feature exists
        alreadyImplemented = true;
      } else if (result.toolUseCount > 30) {
        // Too many tools without changes - likely stuck in a loop
        issues.push('Many tool uses but no changes made, possible stuck loop');
        severity = 'warning';
      } else {
        // 16-30 tools used without changes - could be either
        // Check if it looks like investigation (reads/greps) vs failed implementation
        issues.push('Claude used tools but made no file changes');
        severity = 'warning';
        // Conservative: if between 16-30 tools and no changes, likely already implemented
        // Claude typically uses many read/grep tools to investigate before concluding
        alreadyImplemented = true;
      }
    }

    // Check for very short execution (might indicate immediate failure)
    // But only if no tools were used - quick completion with some tools is fine
    if (result.durationMs < 5000 && result.turnCount < 2 && result.toolUseCount < 3) {
      issues.push('Execution was very short with minimal tool use, might indicate early failure');
      severity = severity === 'error' ? 'error' : 'warning';
      // Short execution with minimal tools is NOT "already implemented" - it's a failure
      alreadyImplemented = false;
    }

    // Add any validation issues from the result itself
    issues.push(...result.validationIssues);

    return {
      isValid: severity !== 'error',
      hasChanges: result.hasChanges,
      issues,
      severity,
      alreadyImplemented,
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
   * Extract error code from an error using type-based classification.
   * Classifies errors based on their type hierarchy rather than string matching.
   */
  private extractErrorCode(error: Error): string {
    // First check for typed executor errors
    if (error instanceof ClaudeExecutorError) {
      return error.code;
    }
    if (error instanceof NetworkExecutorError) {
      return error.code;
    }
    if (error instanceof TimeoutExecutorError) {
      return ErrorCode.CLAUDE_TIMEOUT;
    }
    if (error instanceof ExecutorError) {
      return error.code;
    }
    if (error instanceof StructuredError) {
      return error.code;
    }

    // Fall back to pattern matching for untyped errors
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
   * Determine if a Claude error is retryable using type-based classification.
   * Uses recovery strategy from typed errors when available.
   */
  private isClaudeErrorRetryable(error: Error): boolean {
    // First check for typed executor errors with recovery strategy
    if (error instanceof ExecutorError) {
      // Use the recovery strategy to determine retryability
      const strategy = error.recoveryStrategy;
      if (strategy.strategy === 'retry' && (strategy.maxRetries ?? 0) > 0) {
        return true;
      }
      return error.isRetryable;
    }

    if (error instanceof StructuredError) {
      return error.isRetryable;
    }

    const message = error.message.toLowerCase();

    // Retryable error patterns (fallback for untyped errors)
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

    // Non-retryable error patterns
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

  private buildPrompt(issue: Issue, repoDir?: string): string {
    // Try to load spec context from the cloned repo if available
    let specContext = this.options.specContext;
    if (repoDir) {
      const repoSpecContext = loadSpecContext(repoDir, 5);
      if (repoSpecContext && repoSpecContext.nextTasks.length > 0) {
        // Build spec context from the cloned repo's SPEC.md/STATUS.md
        const firstTask = repoSpecContext.nextTasks[0];
        specContext = {
          specContent: repoSpecContext.nextTasks.map(t => t.specContent).filter(Boolean).join('\n\n---\n\n').slice(0, 3000),
          existingFiles: repoSpecContext.nextTasks.flatMap(t => t.existingFiles).filter(Boolean),
          priorityTier: firstTask?.priority,
          notes: 'This task is part of the spec-driven roadmap. Check SPEC.md for detailed requirements.',
        };
        this.log.info('Loaded spec context from cloned repository', {
          tasksFound: repoSpecContext.nextTasks.length,
          priorityTier: firstTask?.priority,
        });
      }
    }
    const hasSpecContext = specContext && (specContext.specContent || specContext.existingFiles?.length);

    // Build spec context section if available
    let specSection = '';
    let hasExistingFiles = false;
    if (hasSpecContext && specContext) {
      hasExistingFiles = !!(specContext.existingFiles?.length);
      specSection = `
## Specification Context
${specContext.priorityTier ? `**Priority:** ${specContext.priorityTier}` : ''}

${specContext.specContent ? `### From SPEC.md:
${specContext.specContent}
` : ''}
${hasExistingFiles ? `### Existing Implementation Files:
Review these files before making changes:
${specContext.existingFiles!.map(f => `- ${f}`).join('\n')}
` : ''}
${specContext.notes ? `### Implementation Notes:
${specContext.notes}
` : ''}
`;
    }

    return `You are an expert developer working on implementing a GitHub issue.

## Working Directory

**IMPORTANT:** Your current working directory is: \`${repoDir || '.'}\`

All file operations (Read, Write, Edit, Glob, Grep, Bash) should use paths relative to this directory or absolute paths starting with \`${repoDir || '.'}\`.

Do NOT use paths like \`/code/\`, \`/workspace/\`, or any other assumed paths. Always use \`pwd\` first if unsure, or use relative paths like \`./CLAUDE.md\` or \`./website/client/src/\`.

## Issue #${issue.number}: ${issue.title}

${issue.body || 'No description provided.'}
${specSection}
## CRITICAL: Check If Already Implemented

**BEFORE doing any implementation work**, you MUST check if the feature described in this issue is already implemented:

1. Search for existing files/components mentioned in the issue (e.g., if issue says "Create Store.tsx", check if \`Store.tsx\` already exists)
2. Read the existing files to verify they implement the requested functionality
3. Check the router/routes to see if the page/feature is already wired up

**If the feature is ALREADY IMPLEMENTED:**
- Do NOT make any changes
- Do NOT run npm install or npm build
- Simply finish immediately - the task is already done
- The system will detect "no changes" and handle it appropriately

**Only proceed with implementation if the feature is genuinely missing or incomplete.**

## Instructions

1. First, run \`pwd\` to confirm your working directory, then explore the codebase
2. Read \`./CLAUDE.md\` (relative path) if it exists for project-specific guidelines
3. **Check if the feature already exists** (see above) - if yes, stop here
4. ${hasExistingFiles ? 'Review the existing implementation files listed above' : 'Identify related files that may need modification'}
5. Implement the changes described in the issue
6. Follow existing code style and conventions
7. Make sure your changes are complete and working
8. Do NOT create or modify test files unless specifically asked
9. Do NOT modify unrelated files
10. Keep changes focused and minimal

## Build Verification (REQUIRED)

After making your changes, you MUST verify the code compiles:

1. Run \`npm install\` to ensure dependencies are up to date
2. Run \`npm run build\` to verify no compilation errors
3. If the build fails, fix the errors before completing

This is a monorepo, so run these commands in the appropriate project directory:
- For website changes: \`cd website && npm install && npm run build\`
- For internal-api-server changes: \`cd internal-api-server && npm install && npm run build\`
- For ai-coding-worker changes: \`cd ai-coding-worker && npm install && npm run build\`
- For autonomous-dev-cli changes: \`cd autonomous-dev-cli && npm install && npm run build\`

## Testing & Verification (REQUIRED)

You MUST verify your changes actually work. Use ANY method necessary:

1. **Run the application** - Start the dev server and verify functionality works
   - \`npm run dev\` to start the application
   - Check that pages load without errors
   - Test the specific feature you implemented

2. **Write a test script** - Create a temporary test script to verify behavior
   - Write a simple script that exercises your code
   - Run it to confirm it works as expected
   - DELETE the test script after verification (do not commit test scripts)

3. **Query endpoints** - For API changes, test the endpoints directly
   - Use curl or fetch to test API endpoints
   - Verify responses are correct
   - Check error handling works

4. **Console verification** - Add temporary console.logs to verify flow
   - Add logging to confirm code paths are hit
   - Remove console.logs after verification

5. **Interactive testing** - If it's a UI change:
   - Start the dev server
   - Navigate to the page
   - Interact with the feature
   - Verify it works visually

**The key principle: DO NOT assume your code works. VERIFY IT ACTUALLY WORKS.**

If you cannot test something directly, explain in your completion message why and what manual testing would be needed.

## Important

- Make real, working changes - not placeholder code
- Ensure the code compiles/builds successfully (run the build commands above!)
- VERIFY your changes work using one of the testing methods above
- Follow TypeScript best practices if the project uses TypeScript
- Add appropriate comments only where they add value
- Do NOT update STATUS.md - this will be done automatically after successful implementation

## Completion Checklist

Before finishing, verify:
- [ ] All changes implement the issue requirements
- [ ] \`npm install && npm run build\` passes without errors
- [ ] Changes have been TESTED and verified to work
- [ ] No unrelated files were modified
- [ ] Code follows existing patterns and conventions
- [ ] Any temporary test scripts have been deleted

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
      // Use typed GitExecutorError for commit failures
      throw new GitExecutorError(
        `Failed to commit changes: ${error.message}`,
        {
          operation: 'commit',
          context: {
            operation: 'commit',
            issueNumber: issue.number,
            branchName,
          },
          executionState: {
            phase: 'commit',
            issueNumber: issue.number,
            branchName,
            workerId: this.workerId,
          },
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
      // Use typed GitExecutorError for push failures
      throw new GitExecutorError(
        `Failed to push changes: ${error.message}`,
        {
          operation: 'push',
          context: {
            operation: 'push',
            issueNumber: issue.number,
            branchName,
          },
          executionState: {
            phase: 'push',
            issueNumber: issue.number,
            branchName,
            commitSha,
            workerId: this.workerId,
          },
          cause: error,
        }
      );
    });

    this.log.info(`Pushed commit ${commitSha} to ${branchName}`);
    return commitSha;
  }

  /**
   * Create a pull request for the completed task.
   * Creates a PR from the feature branch back to the base branch (typically 'dev').
   */
  private async createPullRequest(issue: Issue, branchName: string): Promise<{ number: number; htmlUrl: string }> {
    // Extract owner and repo from repoUrl
    const repoMatch = this.options.repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!repoMatch) {
      throw new Error(`Cannot parse repository URL: ${this.options.repoUrl}`);
    }
    const [, owner, repo] = repoMatch;

    this.log.info('Creating pull request', {
      owner,
      repo,
      head: branchName,
      base: this.options.baseBranch,
      issueNumber: issue.number,
    });

    // Create GitHub client
    const github = createGitHub({
      owner,
      repo,
      token: this.options.githubToken,
    });

    // Generate PR title and body
    const prTitle = issue.title;
    const prBody = github.pulls.generatePRDescription({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body || undefined,
      summary: `This PR implements the changes for issue #${issue.number}.`,
    });

    // Create the PR
    const pr = await github.pulls.createPR({
      title: prTitle,
      body: prBody,
      head: branchName,
      base: this.options.baseBranch,
      draft: false,
      issueNumber: issue.number,
    });

    this.log.info(`Created PR #${pr.number}`, {
      prNumber: pr.number,
      htmlUrl: pr.htmlUrl,
      head: branchName,
      base: this.options.baseBranch,
    });

    return {
      number: pr.number,
      htmlUrl: pr.htmlUrl,
    };
  }

  /**
   * Attempt to auto-merge a PR using the ConflictResolver.
   * This will:
   * 1. Wait for the PR to become mergeable
   * 2. Merge base branch into feature branch if needed (to resolve conflicts)
   * 3. Merge the PR
   * 4. Delete the feature branch
   */
  private async attemptAutoMerge(
    issue: Issue,
    branchName: string,
    prNumber: number
  ): Promise<MergeAttemptResult> {
    // Extract owner and repo from repoUrl
    const repoMatch = this.options.repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!repoMatch) {
      throw new Error(`Cannot parse repository URL: ${this.options.repoUrl}`);
    }
    const [, owner, repo] = repoMatch;

    const mergeConfig = this.options.mergeConfig || {};

    this.log.info('Attempting auto-merge', {
      owner,
      repo,
      prNumber,
      branchName,
      strategy: mergeConfig.conflictStrategy || 'rebase',
      method: mergeConfig.mergeMethod || 'squash',
    });

    // Create GitHub client
    const github = createGitHub({
      owner,
      repo,
      token: this.options.githubToken,
    });

    // Create conflict resolver
    const resolver = createConflictResolver({
      prManager: github.pulls,
      branchManager: github.branches,
      maxRetries: mergeConfig.maxRetries || 3,
      strategy: mergeConfig.conflictStrategy || 'rebase',
      mergeMethod: mergeConfig.mergeMethod || 'squash',
      owner,
      repo,
      baseBranch: this.options.baseBranch,
      // For AI conflict resolution (if strategy is 'ai')
      githubToken: this.options.githubToken,
      claudeAuth: this.options.claudeAuth,
      workDir: this.options.workDir,
    });

    // Attempt to merge
    const result = await resolver.attemptMerge(branchName, prNumber);

    if (result.merged) {
      this.log.success(`PR #${prNumber} merged to ${this.options.baseBranch}`, {
        prNumber,
        branchName,
        sha: result.sha,
        attempts: result.attempts,
      });
    } else {
      this.log.info(`PR #${prNumber} merge pending`, {
        prNumber,
        branchName,
        error: result.error,
        attempts: result.attempts,
      });
    }

    return result;
  }

  /**
   * Close an issue after successful PR merge.
   * Adds a comment linking to the PR and merge commit.
   */
  private async closeIssue(issueNumber: number, prNumber: number, mergeSha?: string): Promise<void> {
    // Extract owner and repo from repoUrl
    const repoMatch = this.options.repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
    if (!repoMatch) {
      throw new Error(`Cannot parse repository URL: ${this.options.repoUrl}`);
    }
    const [, owner, repo] = repoMatch;

    this.log.info('Closing issue', {
      owner,
      repo,
      issueNumber,
      prNumber,
      mergeSha,
    });

    // Create GitHub client
    const github = createGitHub({
      owner,
      repo,
      token: this.options.githubToken,
    });

    // Close the issue with a comment referencing the PR
    const comment = mergeSha
      ? `Closed by PR #${prNumber} (merged in ${mergeSha.substring(0, 7)})`
      : `Closed by PR #${prNumber}`;

    await github.issues.closeIssue(issueNumber, comment);

    this.log.info(`Closed issue #${issueNumber}`, {
      issueNumber,
      prNumber,
      mergeSha,
    });

    // Soft-delete associated chat sessions to free up storage
    if (this.options.enableDatabaseLogging) {
      try {
        const deletedCount = await softDeleteSessionsByIssue(issueNumber, owner, repo);
        if (deletedCount > 0) {
          this.log.info(`Soft-deleted ${deletedCount} session(s) for issue #${issueNumber}`, {
            issueNumber,
            owner,
            repo,
            deletedCount,
          });
        }
      } catch (error: unknown) {
        // Don't fail the close operation if session cleanup fails
        this.log.warn(`Failed to delete sessions for issue #${issueNumber}: ${getErrorMessage(error)}`);
      }
    }
  }
}
