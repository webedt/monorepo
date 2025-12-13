import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
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
} from '../utils/errors.js';
import {
  CircuitBreaker,
  getClaudeSDKCircuitBreaker,
  type CircuitBreakerConfig,
} from '../utils/circuit-breaker.js';
import { type Issue } from '../github/issues.js';
import {
  createChatSession,
  updateChatSession,
  addMessage,
  addEvent,
  generateSessionPath,
  type CreateChatSessionParams,
} from '../db/index.js';

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

  constructor(options: WorkerOptions, workerId: string) {
    this.options = options;
    this.workerId = workerId;
    this.log = logger.child(`Worker-${workerId}`);
    // Extract repository identifier from URL for metrics
    this.repository = this.extractRepoName(options.repoUrl);
    // Get or create the Claude SDK circuit breaker with optional config overrides
    this.circuitBreaker = getClaudeSDKCircuitBreaker(options.circuitBreakerConfig);
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

    // Clone with retry for transient network failures
    return withRetry(
      async () => {
        const git = simpleGit(taskDir);
        const repoDir = join(taskDir, 'repo');

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
        config: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000, backoffMultiplier: 2 },
        onRetry: (error, attempt, delay) => {
          this.log.warn(`Clone retry (attempt ${attempt}): ${error.message}, waiting ${delay}ms`);
        },
        shouldRetry: (error) => {
          // Retry network-related errors
          const message = error.message.toLowerCase();
          return (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('enotfound') ||
            message.includes('etimedout')
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

  private async executeWithClaude(repoDir: string, issue: Issue, chatSessionId?: string): Promise<void> {
    const claudeStartTime = Date.now();
    const startMemory = getMemoryUsageMB();
    this.log.info('Executing task with Claude Agent SDK...', {
      issueNumber: issue.number,
      repoDir,
      circuitState: this.circuitBreaker.getState(),
    });

    // Check circuit breaker before starting execution
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

      // Record rejection in metrics
      metrics.recordCircuitBreakerRejection('claude-sdk');

      throw error;
    }

    const prompt = this.buildPrompt(issue);

    const timeoutMs = this.options.timeoutMinutes * 60 * 1000;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    let toolUseCount = 0;
    let turnCount = 0;
    let claudeSuccess = true;

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

      let lastMessage: SDKMessage | undefined;
      let assistantTextBuffer = '';

      for await (const message of stream) {
        lastMessage = message;
        if (message.type === 'assistant') {
          turnCount++;
          // Log tool uses and collect assistant text
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                toolUseCount++;
                const toolName = (block as any).name;
                const toolInput = (block as any).input;
                this.log.debug(`Tool: ${toolName}`, {
                  toolCount: toolUseCount,
                  turnCount,
                });

                // Record tool usage in metrics
                metrics.recordToolUsage(toolName, {
                  repository: this.repository,
                  workerId: this.workerId,
                });

                // Log tool use event to database
                if (chatSessionId) {
                  await addEvent(chatSessionId, 'tool_use', {
                    type: 'tool_use',
                    tool: toolName,
                    input: this.sanitizeToolInput(toolName, toolInput),
                    toolCount,
                    turnCount,
                  });
                }
              } else if (block.type === 'text') {
                assistantTextBuffer += (block as any).text + '\n';
              }
            }
          }

          // Periodically flush assistant text to database as messages
          if (chatSessionId && assistantTextBuffer.length > 500) {
            await addMessage(chatSessionId, 'assistant', assistantTextBuffer.trim());
            assistantTextBuffer = '';
          }
        } else if (message.type === 'result') {
          const duration = (message as any).duration_ms || (Date.now() - claudeStartTime);
          const endMemory = getMemoryUsageMB();

          this.log.info(`Claude execution completed`, {
            duration,
            toolUseCount,
            turnCount,
            memoryDeltaMB: Math.round((endMemory - startMemory) * 100) / 100,
            circuitState: this.circuitBreaker.getState(),
          });

          // Record success in circuit breaker
          this.circuitBreaker.recordSuccess();

          // Record Claude API call metrics
          metrics.recordClaudeApiCall('executeTask', true, duration, {
            repository: this.repository,
            workerId: this.workerId,
          });

          // Log final assistant message and completion event
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
        }
      }
    } catch (error) {
      claudeSuccess = false;
      const duration = Date.now() - claudeStartTime;

      // Record failure in circuit breaker
      this.circuitBreaker.recordFailure(error as Error);

      // Record failed Claude API call
      metrics.recordClaudeApiCall('executeTask', false, duration, {
        repository: this.repository,
        workerId: this.workerId,
      });

      this.log.error('Claude execution failed', {
        duration,
        toolUseCount,
        turnCount,
        error: (error as Error).message,
        circuitState: this.circuitBreaker.getState(),
        circuitHealth: this.circuitBreaker.getHealth(),
      });

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private sanitizeToolInput(toolName: string, input: any): any {
    // Truncate large inputs for logging
    if (!input) return input;

    const sanitized = { ...input };

    // Truncate file contents
    if (sanitized.content && typeof sanitized.content === 'string' && sanitized.content.length > 500) {
      sanitized.content = sanitized.content.slice(0, 500) + `... (${sanitized.content.length} chars total)`;
    }

    // Truncate new_string/old_string for Edit tools
    if (sanitized.new_string && sanitized.new_string.length > 200) {
      sanitized.new_string = sanitized.new_string.slice(0, 200) + '...';
    }
    if (sanitized.old_string && sanitized.old_string.length > 200) {
      sanitized.old_string = sanitized.old_string.slice(0, 200) + '...';
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

    // Push with retry for transient failures
    await withRetry(
      async () => {
        await git.push(['-u', 'origin', branchName]);
      },
      {
        config: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000, backoffMultiplier: 2 },
        onRetry: (error, attempt, delay) => {
          this.log.warn(`Push retry (attempt ${attempt}): ${error.message}, waiting ${delay}ms`);
        },
        shouldRetry: (error) => {
          const message = error.message.toLowerCase();
          return (
            message.includes('network') ||
            message.includes('timeout') ||
            message.includes('connection') ||
            message.includes('could not read from remote')
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
