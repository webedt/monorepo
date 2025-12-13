import { query } from '@anthropic-ai/claude-agent-sdk';
import { isTextBlock, isToolUseBlock, isResultMessage, validateSDKMessage, extractToolUseInfo, extractTextContent, extractResultDuration, } from '../types/claude-sdk.js';
import { simpleGit } from 'simple-git';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { logger, generateCorrelationId, getMemoryUsageMB, createOperationContext, finalizeOperationContext, ClaudeExecutionLogger, getStructuredFileLogger, isClaudeLoggingEnabled, } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import { StructuredError, ClaudeError, ErrorCode, getErrorMessage, } from '../utils/errors.js';
import { ExecutorError, NetworkExecutorError, TimeoutExecutorError, GitExecutorError, ClaudeExecutorError, createExecutorError, getErrorAggregator, } from '../errors/executor-errors.js';
import { getClaudeSDKCircuitBreaker, } from '../utils/circuit-breaker.js';
import { retryWithBackoff, NETWORK_RETRY_CONFIG, } from '../utils/retry.js';
import { withTimeout, createTimedAbortController, DEFAULT_TIMEOUTS, getTimeoutFromEnv, TimeoutError, } from '../utils/timeout.js';
import { getDeadLetterQueue, } from '../utils/dead-letter-queue.js';
import { createChatSession, updateChatSession, addMessage, addEvent, generateSessionPath, } from '../db/index.js';
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
 * Default Claude retry configuration aligned with issue requirements
 */
const DEFAULT_CLAUDE_RETRY_CONFIG = {
    maxRetries: DEFAULT_MAX_CLAUDE_RETRIES,
    baseDelayMs: 2000,
    maxDelayMs: 8000,
    backoffMultiplier: 2,
    timeoutMs: DEFAULT_CLAUDE_TIMEOUT_MS,
};
export class Worker {
    options;
    workerId;
    log;
    repository;
    circuitBreaker;
    claudeRetryConfig;
    // Progress checkpointing state
    currentCheckpoint = null;
    checkpointDir;
    taskStartTime = 0;
    currentPhase = 'setup';
    toolsUsedInTask = 0;
    turnsCompletedInTask = 0;
    modifiedFilesInTask = [];
    partialOutputBuffer = '';
    constructor(options, workerId) {
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
        // Initialize checkpoint directory
        this.checkpointDir = join(options.workDir, 'checkpoints');
        if (!existsSync(this.checkpointDir)) {
            mkdirSync(this.checkpointDir, { recursive: true });
        }
    }
    /**
     * Create a progress checkpoint for the current task state.
     * Checkpoints are saved to disk for recovery after timeout termination.
     */
    createCheckpoint(issue, branchName, chatSessionId) {
        const checkpoint = {
            id: randomUUID(),
            taskId: `task-${issue.number}`,
            issueNumber: issue.number,
            branchName,
            phase: this.currentPhase,
            timestamp: new Date().toISOString(),
            elapsedMs: Date.now() - this.taskStartTime,
            toolsUsed: this.toolsUsedInTask,
            turnsCompleted: this.turnsCompletedInTask,
            hasChanges: this.modifiedFilesInTask.length > 0,
            modifiedFiles: [...this.modifiedFilesInTask],
            partialOutput: this.partialOutputBuffer.slice(-5000), // Keep last 5KB
            workerId: this.workerId,
            chatSessionId,
            memoryUsageMB: getMemoryUsageMB(),
            canResume: this.determineCanResume(),
            resumeBlocker: this.getResumeBlocker(),
        };
        this.currentCheckpoint = checkpoint;
        return checkpoint;
    }
    /**
     * Save the current checkpoint to disk
     */
    async saveCheckpoint(issue, branchName, chatSessionId) {
        const checkpoint = this.createCheckpoint(issue, branchName, chatSessionId);
        const checkpointPath = join(this.checkpointDir, `${checkpoint.id}.json`);
        try {
            writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));
            this.log.debug('Checkpoint saved', {
                checkpointId: checkpoint.id,
                phase: checkpoint.phase,
                elapsedMs: checkpoint.elapsedMs,
            });
        }
        catch (error) {
            this.log.warn('Failed to save checkpoint', {
                error: error.message,
            });
        }
        return checkpoint;
    }
    /**
     * Update the current phase and optionally save checkpoint
     */
    async updatePhase(phase, issue, branchName, chatSessionId, saveCheckpoint = false) {
        this.currentPhase = phase;
        this.log.debug(`Task phase: ${phase}`, { issueNumber: issue.number });
        if (saveCheckpoint) {
            await this.saveCheckpoint(issue, branchName, chatSessionId);
        }
    }
    /**
     * Track tool usage for checkpointing
     */
    recordToolUsage(toolName, input) {
        this.toolsUsedInTask++;
        // Track file modifications
        if (['Write', 'Edit', 'MultiEdit'].includes(toolName) && input) {
            const filePath = input.file_path || input.path;
            if (filePath && !this.modifiedFilesInTask.includes(filePath)) {
                this.modifiedFilesInTask.push(filePath);
            }
        }
    }
    /**
     * Append to partial output buffer
     */
    appendPartialOutput(text) {
        this.partialOutputBuffer += text;
        // Keep buffer from growing too large (max 10KB)
        if (this.partialOutputBuffer.length > 10000) {
            this.partialOutputBuffer = this.partialOutputBuffer.slice(-10000);
        }
    }
    /**
     * Determine if the current state can be resumed
     */
    determineCanResume() {
        // Can resume if we have changes and haven't pushed yet
        if (this.currentPhase === 'push') {
            return false; // Push in progress, can't safely resume
        }
        if (this.currentPhase === 'commit') {
            return false; // Commit in progress, could be corrupted
        }
        // Can resume from most phases
        return true;
    }
    /**
     * Get the reason why task cannot be resumed
     */
    getResumeBlocker() {
        if (this.currentPhase === 'push') {
            return 'Push operation in progress - cannot determine if push completed';
        }
        if (this.currentPhase === 'commit') {
            return 'Commit operation in progress - repository state may be inconsistent';
        }
        return undefined;
    }
    /**
     * Load a checkpoint from disk
     */
    loadCheckpoint(checkpointId) {
        const checkpointPath = join(this.checkpointDir, `${checkpointId}.json`);
        if (!existsSync(checkpointPath)) {
            return null;
        }
        try {
            const data = readFileSync(checkpointPath, 'utf-8');
            return JSON.parse(data);
        }
        catch (error) {
            this.log.warn('Failed to load checkpoint', {
                checkpointId,
                error: error.message,
            });
            return null;
        }
    }
    /**
     * Get all checkpoints for a specific issue
     */
    getCheckpointsForIssue(issueNumber) {
        const checkpoints = [];
        if (!existsSync(this.checkpointDir)) {
            return checkpoints;
        }
        try {
            const files = require('fs').readdirSync(this.checkpointDir);
            for (const file of files) {
                if (file.endsWith('.json')) {
                    const checkpointPath = join(this.checkpointDir, file);
                    try {
                        const data = readFileSync(checkpointPath, 'utf-8');
                        const checkpoint = JSON.parse(data);
                        if (checkpoint.issueNumber === issueNumber) {
                            checkpoints.push(checkpoint);
                        }
                    }
                    catch {
                        // Skip invalid checkpoint files
                    }
                }
            }
        }
        catch (error) {
            this.log.warn('Failed to list checkpoints', {
                error: error.message,
            });
        }
        // Sort by timestamp, newest first
        return checkpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    }
    /**
     * Clean up old checkpoints for an issue after successful completion
     */
    cleanupCheckpoints(issueNumber) {
        const checkpoints = this.getCheckpointsForIssue(issueNumber);
        for (const checkpoint of checkpoints) {
            const checkpointPath = join(this.checkpointDir, `${checkpoint.id}.json`);
            try {
                rmSync(checkpointPath, { force: true });
            }
            catch {
                // Ignore cleanup errors
            }
        }
        this.log.debug('Cleaned up checkpoints', {
            issueNumber,
            count: checkpoints.length,
        });
    }
    /**
     * Reset task state for a new task
     */
    resetTaskState() {
        this.currentCheckpoint = null;
        this.taskStartTime = Date.now();
        this.currentPhase = 'setup';
        this.toolsUsedInTask = 0;
        this.turnsCompletedInTask = 0;
        this.modifiedFilesInTask = [];
        this.partialOutputBuffer = '';
    }
    /**
     * Handle graceful timeout - save progress before termination
     */
    async handleGracefulTimeout(issue, branchName, chatSessionId, repoDir) {
        this.log.warn('Timeout approaching - saving partial progress', {
            issueNumber: issue.number,
            phase: this.currentPhase,
            toolsUsed: this.toolsUsedInTask,
        });
        // If we have a repo directory, try to get list of modified files
        if (repoDir && existsSync(repoDir)) {
            try {
                const git = simpleGit(repoDir);
                const status = await git.status();
                this.modifiedFilesInTask = [
                    ...status.modified,
                    ...status.created,
                    ...status.renamed.map(r => r.to),
                ];
            }
            catch {
                // Continue with existing file list
            }
        }
        // Save the checkpoint
        const checkpoint = await this.saveCheckpoint(issue, branchName, chatSessionId);
        // Log to database if session exists
        if (chatSessionId) {
            try {
                await addEvent(chatSessionId, 'timeout_checkpoint', {
                    type: 'timeout_checkpoint',
                    checkpointId: checkpoint.id,
                    phase: checkpoint.phase,
                    toolsUsed: checkpoint.toolsUsed,
                    hasChanges: checkpoint.hasChanges,
                    modifiedFiles: checkpoint.modifiedFiles,
                    canResume: checkpoint.canResume,
                    message: 'Task timed out - progress checkpoint saved',
                });
            }
            catch {
                // Continue even if event logging fails
            }
        }
        return checkpoint;
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
    extractRepoName(repoUrl) {
        const match = repoUrl.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
        return match ? match[1] : repoUrl;
    }
    /**
     * Get enhanced error context with execution state for debugging
     */
    getErrorContext(operation, task, executionState) {
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
    wrapExecutionError(error, code, message, task, executionState) {
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
            return error;
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
    async execute(task) {
        // Reset task state for new task
        this.resetTaskState();
        const startTime = Date.now();
        this.taskStartTime = startTime;
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
        let chatSessionId;
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
            }
            catch (error) {
                taskLog.warn(`Failed to create chat session: ${getErrorMessage(error)}`);
            }
        }
        let repoDir;
        try {
            // Setup workspace
            await this.updatePhase('setup', issue, branchName, chatSessionId);
            await this.setupWorkspace(taskDir);
            if (chatSessionId) {
                await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'workspace', message: 'Created workspace directory' });
            }
            // Clone repository
            await this.updatePhase('clone', issue, branchName, chatSessionId, true);
            if (chatSessionId) {
                await updateChatSession(chatSessionId, { status: 'running' });
                await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'clone', message: 'Cloning repository...' });
            }
            repoDir = await this.cloneRepo(taskDir);
            if (chatSessionId) {
                await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'clone', message: 'Repository cloned successfully' });
            }
            // Create and checkout branch
            await this.updatePhase('branch', issue, branchName, chatSessionId);
            await this.createBranch(repoDir, branchName);
            if (chatSessionId) {
                await updateChatSession(chatSessionId, { branch: branchName, sessionPath: generateSessionPath(this.options.repoOwner, this.options.repoName, branchName) });
                await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'branch', message: `Created branch: ${branchName}` });
            }
            // Write Claude credentials
            this.writeClaudeCredentials();
            // Execute task with Claude
            await this.updatePhase('claude_execution', issue, branchName, chatSessionId, true);
            if (chatSessionId) {
                await addEvent(chatSessionId, 'claude_start', { type: 'claude_start', message: 'Starting Claude Agent SDK...' });
            }
            await this.executeWithClaude(repoDir, issue, chatSessionId);
            // Check if there are any changes
            await this.updatePhase('validation', issue, branchName, chatSessionId);
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
                // Clean up checkpoints on completion (even without changes)
                this.cleanupCheckpoints(issue.number);
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
            await this.updatePhase('commit', issue, branchName, chatSessionId, true);
            if (chatSessionId) {
                await addEvent(chatSessionId, 'commit_progress', { type: 'commit_progress', stage: 'committing', message: 'Committing changes...' });
            }
            const commitSha = await this.commitAndPush(repoDir, issue, branchName);
            await this.updatePhase('push', issue, branchName, chatSessionId);
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
            // Clean up checkpoints on successful completion
            this.cleanupCheckpoints(issue.number);
            // Write to structured file log if enabled
            const structuredLogger = getStructuredFileLogger();
            if (structuredLogger.isEnabled()) {
                structuredLogger.writeTaskLog(issue.number, correlationId, this.workerId, true, duration, branchName, commitSha);
            }
            return {
                success: true,
                issue,
                branchName,
                commitSha,
                duration,
                chatSessionId,
            };
        }
        catch (error) {
            // Track execution state at time of failure
            const executionState = {
                taskId: `task-${issue.number}`,
                issueNumber: issue.number,
                branchName,
                workerId: this.workerId,
                durationMs: Date.now() - startTime,
                memoryUsageMB: getMemoryUsageMB(),
                requiresCleanup: true,
                phase: this.currentPhase,
                toolsUsed: this.toolsUsedInTask,
            };
            // Save checkpoint for timeout errors to enable recovery
            const isTimeoutError = error instanceof TimeoutError ||
                error.message?.toLowerCase().includes('timeout') ||
                error.code === ErrorCode.CLAUDE_TIMEOUT;
            if (isTimeoutError) {
                try {
                    await this.handleGracefulTimeout(issue, branchName, chatSessionId, repoDir);
                }
                catch (checkpointError) {
                    this.log.warn('Failed to save timeout checkpoint', {
                        error: checkpointError.message,
                    });
                }
            }
            // Wrap the error with structured context using typed executor errors
            const structuredError = this.wrapExecutionError(error, ErrorCode.INTERNAL_ERROR, `Task execution failed: ${getErrorMessage(error)}`, task, executionState);
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
                const dlqId = dlq.createEntryFromRetryContext(`task-${issue.number}`, 'issue', this.repository, [{
                        attemptNumber: 1,
                        timestamp: new Date().toISOString(),
                        errorCode: structuredError.code,
                        errorMessage: structuredError.message,
                        delayMs: 0,
                        duration,
                    }], {
                    code: structuredError.code,
                    message: structuredError.message,
                    severity: structuredError.severity,
                    isRetryable: structuredError.isRetryable,
                    stack: structuredError.stack,
                }, {
                    workerId: this.workerId,
                    correlationId,
                    originalTimeout: this.options.timeoutMinutes * 60 * 1000,
                    chatSessionId,
                    memoryDeltaMB: memoryDelta,
                }, {
                    issueNumber: issue.number,
                    branchName,
                    maxRetries: this.options.retryConfig?.maxRetries ?? 3,
                });
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
                structuredLogger.writeTaskLog(issue.number, correlationId, this.workerId, false, duration, branchName, undefined, `[${structuredError.code}] ${structuredError.message}`);
            }
            return {
                success: false,
                issue,
                branchName,
                error: `[${structuredError.code}] ${structuredError.message}`,
                duration,
                chatSessionId,
            };
        }
        finally {
            // Cleanup workspace
            this.cleanupWorkspace(taskDir);
        }
    }
    async setupWorkspace(taskDir) {
        if (existsSync(taskDir)) {
            rmSync(taskDir, { recursive: true, force: true });
        }
        mkdirSync(taskDir, { recursive: true });
        this.log.debug(`Created workspace: ${taskDir}`);
    }
    cleanupWorkspace(taskDir) {
        try {
            if (existsSync(taskDir)) {
                rmSync(taskDir, { recursive: true, force: true });
                this.log.debug(`Cleaned up workspace: ${taskDir}`);
            }
        }
        catch (error) {
            this.log.warn(`Failed to cleanup workspace: ${taskDir}`);
        }
    }
    async cloneRepo(taskDir) {
        this.log.info('Cloning repository...');
        // Add token to URL for authentication
        const urlWithAuth = this.options.repoUrl.replace('https://github.com', `https://${this.options.githubToken}@github.com`);
        const useShallow = this.options.useShallowClone !== false; // Default true
        const sparseConfig = this.options.sparseCheckout;
        const maxRetries = this.options.retryConfig?.maxRetries ?? 3;
        // Get git operation timeout from environment or use default (30 seconds)
        const gitTimeoutMs = getTimeoutFromEnv('GIT_OPERATION', DEFAULT_TIMEOUTS.GIT_OPERATION);
        // Clone with retry for transient network failures using enhanced retry
        // Each individual clone attempt is wrapped with timeout protection
        return retryWithBackoff(async (retryContext) => {
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
            return withTimeout(async () => {
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
                }
                else {
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
            }, {
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
            });
        }, {
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
                return (message.includes('network') ||
                    message.includes('timeout') ||
                    message.includes('connection') ||
                    message.includes('enotfound') ||
                    message.includes('etimedout') ||
                    message.includes('econnreset') ||
                    message.includes('econnrefused'));
            },
        }).catch((error) => {
            // Use typed GitExecutorError for clone failures
            throw new GitExecutorError(`Failed to clone repository: ${error.message}`, {
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
            });
        });
    }
    async createBranch(repoDir, branchName) {
        const git = simpleGit(repoDir);
        await git.checkoutLocalBranch(branchName);
        this.log.debug(`Created branch: ${branchName}`);
    }
    writeClaudeCredentials() {
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
    async executeWithClaude(repoDir, issue, chatSessionId) {
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
        let lastError;
        let attemptResult;
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
                attemptResult = await this.executeSingleClaudeAttempt(repoDir, issue, timeoutMs, chatSessionId, executionLogger);
                // Validate the response
                const validation = this.validateClaudeResponse(attemptResult, repoDir);
                if (validation.severity === 'error' && !isLastAttempt) {
                    // Response validation failed - retry if possible
                    const validationError = new ClaudeError(ErrorCode.CLAUDE_INVALID_RESPONSE, `Claude response validation failed: ${validation.issues.join(', ')}`, {
                        context: {
                            issueNumber: issue.number,
                            toolUseCount: attemptResult.toolUseCount,
                            turnCount: attemptResult.turnCount,
                            validationIssues: validation.issues,
                        },
                    });
                    executionLogger.recordError(ErrorCode.CLAUDE_INVALID_RESPONSE, validationError.message, true);
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
            }
            catch (error) {
                lastError = error;
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
        // Use typed ClaudeExecutorError for final failure after retries exhausted
        const finalError = new ClaudeExecutorError(`Claude execution failed after ${summary.totalAttempts} attempts: ${lastError?.message || 'Unknown error'}`, {
            claudeErrorType: 'api',
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
            },
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
        });
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
    async executeSingleClaudeAttempt(repoDir, issue, timeoutMs, chatSessionId, executionLogger) {
        const attemptStartTime = Date.now();
        const startMemory = getMemoryUsageMB();
        const correlationId = generateCorrelationId();
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
        const prompt = this.buildPrompt(issue);
        // Use createTimedAbortController for proper cleanup management
        // This ensures the timeout is always cleared even if an error occurs
        const { controller: abortController, cleanup: cleanupAbort, isTimedOut } = createTimedAbortController(timeoutMs, `Claude execution for issue #${issue.number}`);
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
                const typedMessage = message;
                if (!validateSDKMessage(typedMessage)) {
                    this.log.warn('Received invalid SDK message structure', {
                        messageType: typeof message === 'object' && message !== null
                            ? message.type
                            : 'unknown',
                    });
                    continue;
                }
                if (typedMessage.type === 'assistant') {
                    turnCount++;
                    if (typedMessage.message?.content) {
                        for (const block of typedMessage.message.content) {
                            const typedBlock = block;
                            if (isToolUseBlock(typedBlock)) {
                                toolUseCount++;
                                const { name: toolName, input: toolInput } = extractToolUseInfo(typedBlock);
                                // Track write operations for validation
                                if (['Write', 'Edit', 'MultiEdit'].includes(toolName)) {
                                    hasWriteOperations = true;
                                }
                                // Enhanced debug logging for Claude tool use
                                this.log.claudeToolUse(toolName, toolInput, {
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
                                executionLogger.recordToolUse(toolName, toolInput);
                                if (chatSessionId) {
                                    await addEvent(chatSessionId, 'tool_use', {
                                        type: 'tool_use',
                                        tool: toolName,
                                        input: this.sanitizeToolInput(toolName, toolInput),
                                        toolCount: toolUseCount,
                                        turnCount,
                                    });
                                }
                            }
                            else if (isTextBlock(typedBlock)) {
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
                }
                else if (isResultMessage(typedMessage)) {
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
        }
        catch (error) {
            const duration = Date.now() - attemptStartTime;
            // Check if this was a timeout (using both tracking methods for reliability)
            if (timeoutTriggered || isTimedOut()) {
                // Use typed ClaudeExecutorError for timeout failures
                const timeoutError = new ClaudeExecutorError(`Claude execution timed out after ${Math.round(timeoutMs / 1000)} seconds (5-minute limit). The task may be too complex or Claude may be experiencing delays.`, {
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
                    },
                });
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
        }
        finally {
            // Always clean up both timeouts to prevent leaks
            // This ensures cleanup happens even when errors occur
            clearTimeout(timeoutId);
            cleanupAbort();
        }
    }
    /**
     * Validate Claude response to detect incomplete implementations
     */
    validateClaudeResponse(result, repoDir) {
        const issues = [];
        let severity = 'none';
        // Check if Claude made any changes
        if (!result.hasChanges && result.toolUseCount === 0) {
            issues.push('Claude made no file changes and used no tools');
            severity = 'error';
        }
        else if (!result.hasChanges) {
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
    async handleRetryDelay(attempt, chatSessionId) {
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
    extractErrorCode(error) {
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
    isClaudeErrorRetryable(error) {
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
        if (message.includes('timeout') ||
            message.includes('rate limit') ||
            message.includes('429') ||
            message.includes('503') ||
            message.includes('502') ||
            message.includes('504') ||
            message.includes('network') ||
            message.includes('connection') ||
            message.includes('temporarily unavailable') ||
            message.includes('overloaded')) {
            return true;
        }
        // Non-retryable error patterns
        if (message.includes('auth') ||
            message.includes('unauthorized') ||
            message.includes('forbidden') ||
            message.includes('invalid token') ||
            message.includes('quota exceeded')) {
            return false;
        }
        // Default to retryable for unknown errors
        return true;
    }
    sanitizeToolInput(toolName, input) {
        // Truncate large inputs for logging
        if (!input)
            return input;
        const sanitized = { ...input };
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
    buildPrompt(issue) {
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
    async hasChanges(repoDir) {
        const git = simpleGit(repoDir);
        const status = await git.status();
        return !status.isClean();
    }
    async commitAndPush(repoDir, issue, branchName) {
        this.log.info('Committing and pushing changes...');
        const git = simpleGit(repoDir);
        // Stage all changes
        await git.add('.');
        // Create commit message
        const commitMessage = `${issue.title}

Implements #${issue.number}

🤖 Generated by Autonomous Dev CLI`;
        // Commit
        let commitSha;
        try {
            const commitResult = await git.commit(commitMessage);
            commitSha = commitResult.commit;
        }
        catch (error) {
            // Use typed GitExecutorError for commit failures
            throw new GitExecutorError(`Failed to commit changes: ${error.message}`, {
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
            });
        }
        // Push with retry for transient failures using enhanced retry
        const maxRetries = this.options.retryConfig?.maxRetries ?? 3;
        await retryWithBackoff(async (retryContext) => {
            // Log retry context for debugging
            if (retryContext.attempt > 0) {
                this.log.info(`Push attempt ${retryContext.attempt + 1}/${maxRetries + 1}`, {
                    elapsedMs: retryContext.elapsedMs,
                    currentTimeoutMs: retryContext.currentTimeoutMs,
                });
            }
            await git.push(['-u', 'origin', branchName]);
        }, {
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
                return (message.includes('network') ||
                    message.includes('timeout') ||
                    message.includes('connection') ||
                    message.includes('could not read from remote') ||
                    message.includes('econnreset') ||
                    message.includes('econnrefused'));
            },
        }).catch((error) => {
            // Use typed GitExecutorError for push failures
            throw new GitExecutorError(`Failed to push changes: ${error.message}`, {
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
            });
        });
        this.log.info(`Pushed commit ${commitSha} to ${branchName}`);
        return commitSha;
    }
}
//# sourceMappingURL=worker.js.map