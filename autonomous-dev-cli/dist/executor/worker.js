import { query } from '@anthropic-ai/claude-agent-sdk';
import { simpleGit } from 'simple-git';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { StructuredError, ExecutionError, ErrorCode, withRetry, } from '../utils/errors.js';
import { createChatSession, updateChatSession, addMessage, addEvent, generateSessionPath, } from '../db/index.js';
export class Worker {
    options;
    workerId;
    log;
    constructor(options, workerId) {
        this.options = options;
        this.workerId = workerId;
        this.log = logger.child(`Worker-${workerId}`);
    }
    /**
     * Get error context for debugging
     */
    getErrorContext(operation, task) {
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
    wrapExecutionError(error, code, message, task) {
        if (error instanceof StructuredError) {
            return error;
        }
        return new ExecutionError(code, message, {
            issueNumber: task?.issue.number,
            branchName: task?.branchName,
            context: this.getErrorContext('execute', task),
            cause: error,
        });
    }
    async execute(task) {
        const startTime = Date.now();
        const { issue, branchName } = task;
        this.log.info(`Starting task: ${issue.title}`);
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
                this.log.debug(`Created chat session: ${chatSessionId}`);
                // Log initial user message
                await addMessage(chatSessionId, 'user', `Implement GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body || 'No description provided.'}`);
                await addEvent(chatSessionId, 'session_start', { type: 'session_start', message: 'Autonomous worker starting task' });
            }
            catch (error) {
                this.log.warn(`Failed to create chat session: ${error.message}`);
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
                await updateChatSession(chatSessionId, { branch: branchName, sessionPath: generateSessionPath(this.options.repoOwner, this.options.repoName, branchName) });
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
                this.log.warn('No changes made by Claude');
                if (chatSessionId) {
                    await addMessage(chatSessionId, 'system', 'No changes were made by Claude');
                    await updateChatSession(chatSessionId, { status: 'completed', completedAt: new Date() });
                }
                return {
                    success: false,
                    issue,
                    branchName,
                    error: 'No changes were made',
                    duration: Date.now() - startTime,
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
            this.log.success(`Task completed: ${issue.title}`);
            return {
                success: true,
                issue,
                branchName,
                commitSha,
                duration: Date.now() - startTime,
                chatSessionId,
            };
        }
        catch (error) {
            // Wrap the error with structured context
            const structuredError = this.wrapExecutionError(error, ErrorCode.INTERNAL_ERROR, `Task execution failed: ${error.message}`, task);
            this.log.structuredError(structuredError, {
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
                });
                await updateChatSession(chatSessionId, { status: 'error', completedAt: new Date() });
            }
            return {
                success: false,
                issue,
                branchName,
                error: `[${structuredError.code}] ${structuredError.message}`,
                duration: Date.now() - startTime,
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
        // Clone with retry for transient network failures
        return withRetry(async () => {
            const git = simpleGit(taskDir);
            await git.clone(urlWithAuth, 'repo', ['--depth', '1', '--branch', this.options.baseBranch]);
            const repoDir = join(taskDir, 'repo');
            // Configure git identity
            const repoGit = simpleGit(repoDir);
            await repoGit.addConfig('user.name', 'Autonomous Dev Bot');
            await repoGit.addConfig('user.email', 'bot@autonomous-dev.local');
            this.log.debug('Repository cloned');
            return repoDir;
        }, {
            config: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000, backoffMultiplier: 2 },
            onRetry: (error, attempt, delay) => {
                this.log.warn(`Clone retry (attempt ${attempt}): ${error.message}, waiting ${delay}ms`);
            },
            shouldRetry: (error) => {
                // Retry network-related errors
                const message = error.message.toLowerCase();
                return (message.includes('network') ||
                    message.includes('timeout') ||
                    message.includes('connection') ||
                    message.includes('enotfound') ||
                    message.includes('etimedout'));
            },
        }).catch((error) => {
            throw new ExecutionError(ErrorCode.EXEC_CLONE_FAILED, `Failed to clone repository: ${error.message}`, {
                context: {
                    repoUrl: this.options.repoUrl,
                    baseBranch: this.options.baseBranch,
                    taskDir,
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
    async executeWithClaude(repoDir, issue, chatSessionId) {
        this.log.info('Executing task with Claude Agent SDK...');
        const prompt = this.buildPrompt(issue);
        const timeoutMs = this.options.timeoutMinutes * 60 * 1000;
        const abortController = new AbortController();
        const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);
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
            let lastMessage;
            let assistantTextBuffer = '';
            for await (const message of stream) {
                lastMessage = message;
                if (message.type === 'assistant') {
                    // Log tool uses and collect assistant text
                    if (message.message?.content) {
                        for (const block of message.message.content) {
                            if (block.type === 'tool_use') {
                                const toolName = block.name;
                                const toolInput = block.input;
                                this.log.debug(`Tool: ${toolName}`);
                                // Log tool use event to database
                                if (chatSessionId) {
                                    await addEvent(chatSessionId, 'tool_use', {
                                        type: 'tool_use',
                                        tool: toolName,
                                        input: this.sanitizeToolInput(toolName, toolInput),
                                    });
                                }
                            }
                            else if (block.type === 'text') {
                                assistantTextBuffer += block.text + '\n';
                            }
                        }
                    }
                    // Periodically flush assistant text to database as messages
                    if (chatSessionId && assistantTextBuffer.length > 500) {
                        await addMessage(chatSessionId, 'assistant', assistantTextBuffer.trim());
                        assistantTextBuffer = '';
                    }
                }
                else if (message.type === 'result') {
                    const duration = message.duration_ms;
                    this.log.info(`Claude execution completed in ${duration}ms`);
                    // Log final assistant message and completion event
                    if (chatSessionId) {
                        if (assistantTextBuffer.trim()) {
                            await addMessage(chatSessionId, 'assistant', assistantTextBuffer.trim());
                        }
                        await addEvent(chatSessionId, 'claude_complete', {
                            type: 'claude_complete',
                            message: `Claude completed in ${Math.round(duration / 1000)}s`,
                            duration_ms: duration,
                        });
                    }
                }
            }
        }
        finally {
            clearTimeout(timeoutId);
        }
    }
    sanitizeToolInput(toolName, input) {
        // Truncate large inputs for logging
        if (!input)
            return input;
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
            throw new ExecutionError(ErrorCode.EXEC_COMMIT_FAILED, `Failed to commit changes: ${error.message}`, {
                issueNumber: issue.number,
                branchName,
                context: { repoDir },
                cause: error,
            });
        }
        // Push with retry for transient failures
        await withRetry(async () => {
            await git.push(['-u', 'origin', branchName]);
        }, {
            config: { maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 30000, backoffMultiplier: 2 },
            onRetry: (error, attempt, delay) => {
                this.log.warn(`Push retry (attempt ${attempt}): ${error.message}, waiting ${delay}ms`);
            },
            shouldRetry: (error) => {
                const message = error.message.toLowerCase();
                return (message.includes('network') ||
                    message.includes('timeout') ||
                    message.includes('connection') ||
                    message.includes('could not read from remote'));
            },
        }).catch((error) => {
            throw new ExecutionError(ErrorCode.EXEC_PUSH_FAILED, `Failed to push changes: ${error.message}`, {
                issueNumber: issue.number,
                branchName,
                context: {
                    repoDir,
                    commitSha,
                },
                cause: error,
            });
        });
        this.log.info(`Pushed commit ${commitSha} to ${branchName}`);
        return commitSha;
    }
}
//# sourceMappingURL=worker.js.map