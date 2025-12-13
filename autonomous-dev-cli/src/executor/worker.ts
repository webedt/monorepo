import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { simpleGit } from 'simple-git';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
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

  constructor(options: WorkerOptions, workerId: string) {
    this.options = options;
    this.workerId = workerId;
    this.log = logger.child(`Worker-${workerId}`);
  }

  async execute(task: WorkerTask): Promise<WorkerResult> {
    const startTime = Date.now();
    const { issue, branchName } = task;

    this.log.info(`Starting task: ${issue.title}`);

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
        this.log.debug(`Created chat session: ${chatSessionId}`);

        // Log initial user message
        await addMessage(chatSessionId, 'user', `Implement GitHub Issue #${issue.number}: ${issue.title}\n\n${issue.body || 'No description provided.'}`);
        await addEvent(chatSessionId, 'session_start', { type: 'session_start', message: 'Autonomous worker starting task' });
      } catch (error: any) {
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
        try {
          await updateChatSession(chatSessionId, { branch: branchName, sessionPath: generateSessionPath(this.options.repoOwner!, this.options.repoName!, branchName) });
          await addEvent(chatSessionId, 'setup_progress', { type: 'setup_progress', stage: 'branch', message: `Created branch: ${branchName}` });
        } catch (dbError: any) {
          this.log.warn(`Failed to update session in DB: ${dbError.message}`);
        }
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
    } catch (error: any) {
      this.log.error(`Task failed: ${error.message}`);

      if (chatSessionId) {
        await addMessage(chatSessionId, 'error', `Task failed: ${error.message}`);
        await addEvent(chatSessionId, 'error', { type: 'error', message: error.message, stack: error.stack });
        await updateChatSession(chatSessionId, { status: 'error', completedAt: new Date() });
      }

      return {
        success: false,
        issue,
        branchName,
        error: error.message,
        duration: Date.now() - startTime,
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

    const git = simpleGit(taskDir);
    await git.clone(urlWithAuth, 'repo', ['--depth', '1', '--branch', this.options.baseBranch]);

    const repoDir = join(taskDir, 'repo');

    // Configure git identity
    const repoGit = simpleGit(repoDir);
    await repoGit.addConfig('user.name', 'Autonomous Dev Bot');
    await repoGit.addConfig('user.email', 'bot@autonomous-dev.local');

    this.log.debug('Repository cloned');
    return repoDir;
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
    // Log memory usage before starting Claude
    const memUsage = process.memoryUsage();
    this.log.info(`Memory before Claude: RSS=${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap=${Math.round(memUsage.heapUsed / 1024 / 1024)}/${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`);
    this.log.info('Executing task with Claude Agent SDK...');

    const prompt = this.buildPrompt(issue);

    const timeoutMs = this.options.timeoutMinutes * 60 * 1000;
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => {
      this.log.warn(`Task timeout after ${this.options.timeoutMinutes} minutes`);
      abortController.abort();
    }, timeoutMs);

    const startTime = Date.now();
    let messageCount = 0;

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

      let assistantTextBuffer = '';

      for await (const message of stream) {
        messageCount++;
        const elapsed = Math.round((Date.now() - startTime) / 1000);

        if (message.type === 'assistant') {
          // Log tool uses and collect assistant text
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                const toolName = (block as any).name;
                const toolInput = (block as any).input;
                // Show tool usage with details
                const toolDetail = this.getToolDetail(toolName, toolInput);
                this.log.info(`[${elapsed}s] 🔧 ${toolName}: ${toolDetail}`);

                // Log tool use event to database
                if (chatSessionId) {
                  await addEvent(chatSessionId, 'tool_use', {
                    type: 'tool_use',
                    tool: toolName,
                    input: this.sanitizeToolInput(toolName, toolInput),
                  });
                }
              } else if (block.type === 'text') {
                const text = (block as any).text;
                assistantTextBuffer += text + '\n';
                // Show preview of Claude's thinking
                const preview = text.slice(0, 100).replace(/\n/g, ' ');
                this.log.info(`[${elapsed}s] 🤖 ${preview}${text.length > 100 ? '...' : ''}`);
              }
            }
          }

          // Periodically flush assistant text to database as messages
          if (chatSessionId && assistantTextBuffer.length > 500) {
            await addMessage(chatSessionId, 'assistant', assistantTextBuffer.trim());
            assistantTextBuffer = '';
          }
        } else if (message.type === 'result') {
          const duration = (message as any).duration_ms;
          this.log.info(`[${elapsed}s] ✅ Claude completed in ${Math.round(duration / 1000)}s (${messageCount} messages)`);

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
    } catch (error: any) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      this.log.error(`[${elapsed}s] ❌ Claude SDK error: ${error.message}`);
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private getToolDetail(toolName: string, input: any): string {
    if (!input) return '';

    switch (toolName) {
      case 'Read':
        return input.file_path || input.path || '';
      case 'Write':
        return input.file_path || input.path || '';
      case 'Edit':
      case 'MultiEdit':
        return input.file_path || input.path || '';
      case 'Bash':
        const cmd = input.command || '';
        return cmd.length > 80 ? cmd.slice(0, 80) + '...' : cmd;
      case 'Glob':
        return input.pattern || '';
      case 'Grep':
        return `"${input.pattern || ''}" in ${input.path || '.'}`;
      case 'Task':
        return input.description || input.prompt?.slice(0, 50) || '';
      case 'LS':
        return input.path || '.';
      case 'WebFetch':
        return input.url || '';
      default:
        return JSON.stringify(input).slice(0, 60);
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
    const commitResult = await git.commit(commitMessage);
    const commitSha = commitResult.commit;

    // Push (with auth token in remote URL)
    await git.push(['-u', 'origin', branchName]);

    this.log.info(`Pushed commit ${commitSha} to ${branchName}`);
    return commitSha;
  }
}
