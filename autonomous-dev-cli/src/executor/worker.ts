import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { simpleGit } from 'simple-git';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../utils/logger.js';
import { type Issue } from '../github/issues.js';

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

    try {
      // Setup workspace
      await this.setupWorkspace(taskDir);

      // Clone repository
      const repoDir = await this.cloneRepo(taskDir);

      // Create and checkout branch
      await this.createBranch(repoDir, branchName);

      // Write Claude credentials
      this.writeClaudeCredentials();

      // Execute task with Claude
      await this.executeWithClaude(repoDir, issue);

      // Check if there are any changes
      const hasChanges = await this.hasChanges(repoDir);
      if (!hasChanges) {
        this.log.warn('No changes made by Claude');
        return {
          success: false,
          issue,
          branchName,
          error: 'No changes were made',
          duration: Date.now() - startTime,
        };
      }

      // Commit and push
      const commitSha = await this.commitAndPush(repoDir, issue, branchName);

      this.log.success(`Task completed: ${issue.title}`);

      return {
        success: true,
        issue,
        branchName,
        commitSha,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      this.log.error(`Task failed: ${error.message}`);

      return {
        success: false,
        issue,
        branchName,
        error: error.message,
        duration: Date.now() - startTime,
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

  private async executeWithClaude(repoDir: string, issue: Issue): Promise<void> {
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

      let lastMessage: SDKMessage | undefined;
      for await (const message of stream) {
        lastMessage = message;
        if (message.type === 'assistant') {
          // Log tool uses
          if (message.message?.content) {
            for (const block of message.message.content) {
              if (block.type === 'tool_use') {
                this.log.debug(`Tool: ${(block as any).name}`);
              }
            }
          }
        } else if (message.type === 'result') {
          this.log.info(`Claude execution completed in ${(message as any).duration_ms}ms`);
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }
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
