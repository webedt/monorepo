import { loadConfig, type Config } from './config/index.js';
import { initDatabase, getUserCredentials, closeDatabase } from './db/index.js';
import { createGitHub, type GitHub, type Issue } from './github/index.js';
import { discoverTasks, type DiscoveredTask } from './discovery/index.js';
import { createWorkerPool, type WorkerTask, type PoolResult } from './executor/index.js';
import { runEvaluation, type EvaluationResult } from './evaluation/index.js';
import { createConflictResolver } from './conflicts/index.js';
import { logger } from './utils/logger.js';
import {
  StructuredError,
  ErrorCode,
  GitHubError,
  ClaudeError,
  ConfigError,
  wrapError,
  type ErrorContext,
} from './utils/errors.js';
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

export interface DaemonOptions {
  configPath?: string;
  dryRun?: boolean;
  verbose?: boolean;
  singleCycle?: boolean;
}

export interface CycleResult {
  success: boolean;
  tasksDiscovered: number;
  tasksCompleted: number;
  tasksFailed: number;
  prsMerged: number;
  duration: number;
  errors: string[];
}

export class Daemon {
  private config: Config;
  private github: GitHub | null = null;
  private isRunning: boolean = false;
  private cycleCount: number = 0;
  private options: DaemonOptions;
  private userId: string | null = null;
  private enableDatabaseLogging: boolean = false;

  constructor(options: DaemonOptions = {}) {
    this.options = options;
    this.config = loadConfig(options.configPath);

    if (options.verbose) {
      logger.setLevel('debug');
    }
  }

  async start(): Promise<void> {
    logger.header('Autonomous Dev CLI');
    logger.info('Starting daemon...');

    try {
      // Initialize
      await this.initialize();

      this.isRunning = true;

      // Main loop
      while (this.isRunning) {
        this.cycleCount++;
        logger.header(`Cycle #${this.cycleCount}`);

        const result = await this.runCycle();

        this.logCycleResult(result);

        if (this.options.singleCycle) {
          logger.info('Single cycle mode - exiting');
          break;
        }

        if (!this.isRunning) {
          break;
        }

        // Wait before next cycle
        if (this.config.daemon.pauseBetweenCycles) {
          logger.info(`Waiting ${this.config.daemon.loopIntervalMs / 1000}s before next cycle...`);
          await this.sleep(this.config.daemon.loopIntervalMs);
        }
      }
    } catch (error: any) {
      const structuredError = this.wrapDaemonError(error);
      logger.structuredError(structuredError, {
        context: this.getErrorContext('start'),
        includeStack: true,
        includeRecovery: true,
      });
      throw structuredError;
    } finally {
      await this.shutdown();
    }
  }

  /**
   * Wrap any error as a StructuredError with daemon-specific context
   */
  private wrapDaemonError(error: any, operation?: string): StructuredError {
    if (error instanceof StructuredError) {
      return error;
    }
    return wrapError(error, ErrorCode.INTERNAL_ERROR, {
      operation: operation ?? 'daemon',
      component: 'Daemon',
    });
  }

  /**
   * Get current error context for debugging
   */
  private getErrorContext(operation: string): ErrorContext {
    return {
      operation,
      component: 'Daemon',
      cycleCount: this.cycleCount,
      isRunning: this.isRunning,
      config: {
        repo: `${this.config.repo.owner}/${this.config.repo.name}`,
        baseBranch: this.config.repo.baseBranch,
        parallelWorkers: this.config.execution.parallelWorkers,
        timeoutMinutes: this.config.execution.timeoutMinutes,
      },
      systemState: {
        userId: this.userId ?? 'not-set',
        databaseLogging: this.enableDatabaseLogging,
        dryRun: this.options.dryRun ?? false,
      },
    };
  }

  async stop(): Promise<void> {
    logger.info('Stop requested...');
    this.isRunning = false;
  }

  private async initialize(): Promise<void> {
    logger.info('Initializing...');

    // Load credentials from database if configured
    if (this.config.credentials.databaseUrl && this.config.credentials.userEmail) {
      logger.info('Loading credentials from database...');

      await initDatabase(this.config.credentials.databaseUrl);
      const creds = await getUserCredentials(this.config.credentials.userEmail);

      if (creds) {
        // Store userId for database logging
        this.userId = creds.userId;
        this.enableDatabaseLogging = true;
        logger.info(`Database logging enabled for user: ${this.userId}`);

        if (creds.githubAccessToken) {
          this.config.credentials.githubToken = creds.githubAccessToken;
        }
        if (creds.claudeAuth) {
          this.config.credentials.claudeAuth = {
            accessToken: creds.claudeAuth.accessToken,
            refreshToken: creds.claudeAuth.refreshToken,
            expiresAt: creds.claudeAuth.expiresAt,
          };
        }
      } else {
        throw new ConfigError(
          ErrorCode.DB_USER_NOT_FOUND,
          `User not found in database: ${this.config.credentials.userEmail}`,
          {
            field: 'credentials.userEmail',
            value: this.config.credentials.userEmail,
            context: this.getErrorContext('initialize'),
          }
        );
      }
    }

    // Validate required credentials
    if (!this.config.credentials.githubToken) {
      throw new ConfigError(
        ErrorCode.CONFIG_MISSING_REQUIRED,
        'GitHub token not configured',
        {
          field: 'credentials.githubToken',
          recoveryActions: [
            {
              description: 'Set the GITHUB_TOKEN environment variable',
              automatic: false,
            },
            {
              description: 'Add githubToken to your config file under credentials',
              automatic: false,
            },
            {
              description: 'Generate a new token at https://github.com/settings/tokens with repo scope',
              automatic: false,
            },
          ],
          context: this.getErrorContext('initialize'),
        }
      );
    }
    if (!this.config.credentials.claudeAuth) {
      throw new ConfigError(
        ErrorCode.CONFIG_MISSING_REQUIRED,
        'Claude authentication not configured',
        {
          field: 'credentials.claudeAuth',
          recoveryActions: [
            {
              description: 'Set the CLAUDE_ACCESS_TOKEN environment variable',
              automatic: false,
            },
            {
              description: 'Configure Claude credentials in the database if using database authentication',
              automatic: false,
            },
          ],
          context: this.getErrorContext('initialize'),
        }
      );
    }

    // Initialize GitHub client
    this.github = createGitHub({
      token: this.config.credentials.githubToken,
      owner: this.config.repo.owner,
      repo: this.config.repo.name,
    });

    // Verify GitHub connection
    const user = await this.github.client.verifyAuth();
    logger.success(`Authenticated as: ${user.login}`);

    // Verify repository access
    const repo = await this.github.client.getRepo();
    logger.success(`Repository: ${repo.fullName} (default branch: ${repo.defaultBranch})`);

    // Create work directory
    if (!existsSync(this.config.execution.workDir)) {
      mkdirSync(this.config.execution.workDir, { recursive: true });
    }

    logger.success('Initialization complete');
  }

  private async shutdown(): Promise<void> {
    logger.info('Shutting down...');
    await closeDatabase();
    logger.info('Shutdown complete');
  }

  private async runCycle(): Promise<CycleResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    let tasksDiscovered = 0;
    let tasksCompleted = 0;
    let tasksFailed = 0;
    let prsMerged = 0;

    try {
      if (!this.github || !this.config.credentials.claudeAuth) {
        throw new StructuredError(
          ErrorCode.NOT_INITIALIZED,
          'Daemon not properly initialized: GitHub client or Claude auth is missing',
          {
            severity: 'critical',
            context: this.getErrorContext('runCycle'),
            recoveryActions: [
              {
                description: 'Call initialize() before running cycles',
                automatic: false,
              },
              {
                description: 'Check that credentials are properly configured',
                automatic: false,
              },
            ],
          }
        );
      }

      // STEP 1: Get existing issues
      logger.step(1, 5, 'Fetching existing issues');
      const existingIssues = await this.github.issues.listOpenIssues(
        this.config.discovery.issueLabel
      );
      logger.info(`Found ${existingIssues.length} existing issues with label '${this.config.discovery.issueLabel}'`);

      // Check if we have capacity for more issues
      const availableSlots = this.config.discovery.maxOpenIssues - existingIssues.length;

      // STEP 2: Discover new tasks (if we have capacity)
      let newIssues: Issue[] = [];

      if (availableSlots > 0 && !this.options.dryRun) {
        logger.step(2, 5, 'Discovering new tasks');

        // Clone repo for analysis
        const analysisDir = join(this.config.execution.workDir, 'analysis');
        // For now, we'll analyze the current directory if it's the target repo
        // In production, this would clone the repo first

        try {
          const tasks = await discoverTasks({
            claudeAuth: this.config.credentials.claudeAuth,
            repoPath: process.cwd(), // Analyze current directory
            excludePaths: this.config.discovery.excludePaths,
            tasksPerCycle: Math.min(this.config.discovery.tasksPerCycle, availableSlots),
            existingIssues,
            repoContext: `WebEDT - AI-powered coding assistant platform with React frontend, Express backend, and Claude Agent SDK integration.`,
          });

          tasksDiscovered = tasks.length;
          logger.info(`Discovered ${tasks.length} new tasks`);

          // Create GitHub issues for new tasks
          for (const task of tasks) {
            try {
              const issue = await this.createIssueForTask(task);
              newIssues.push(issue);
              logger.success(`Created issue #${issue.number}: ${issue.title}`);
            } catch (error: any) {
              const structuredError = error instanceof StructuredError
                ? error
                : new GitHubError(
                    ErrorCode.GITHUB_API_ERROR,
                    `Failed to create issue for "${task.title}": ${error.message}`,
                    { context: { taskTitle: task.title }, cause: error }
                  );
              errors.push(`[${structuredError.code}] ${structuredError.message}`);
              logger.structuredError(structuredError, { context: { taskTitle: task.title } });
            }
          }
        } catch (error: any) {
          const structuredError = error instanceof StructuredError
            ? error
            : new ClaudeError(
                ErrorCode.CLAUDE_API_ERROR,
                `Task discovery failed: ${error.message}`,
                { context: this.getErrorContext('discoverTasks'), cause: error }
              );
          errors.push(`[${structuredError.code}] ${structuredError.message}`);
          logger.structuredError(structuredError, {
            context: this.getErrorContext('discoverTasks'),
            includeRecovery: true,
          });
        }
      } else if (availableSlots <= 0) {
        logger.info('Max open issues reached, skipping discovery');
      } else {
        logger.info('Dry run - skipping issue creation');
      }

      // STEP 3: Execute tasks
      logger.step(3, 5, 'Executing tasks');

      // Get all issues to work on (prioritize user-created, then auto-created)
      const allIssues = [...existingIssues, ...newIssues];
      const issuesToWork = allIssues
        .filter((i) => !i.labels.includes('in-progress'))
        .slice(0, this.config.execution.parallelWorkers);

      if (issuesToWork.length === 0) {
        logger.info('No issues to work on');
      } else if (this.options.dryRun) {
        logger.info(`Dry run - would execute ${issuesToWork.length} tasks`);
      } else {
        // Mark issues as in-progress
        for (const issue of issuesToWork) {
          await this.github.issues.addLabels(issue.number, ['in-progress']);
        }

        // Create worker pool and execute
        const workerPool = createWorkerPool({
          maxWorkers: this.config.execution.parallelWorkers,
          workDir: this.config.execution.workDir,
          repoUrl: `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`,
          baseBranch: this.config.repo.baseBranch,
          githubToken: this.config.credentials.githubToken!,
          claudeAuth: this.config.credentials.claudeAuth,
          timeoutMinutes: this.config.execution.timeoutMinutes,
          // Database logging options
          userId: this.userId || undefined,
          repoOwner: this.config.repo.owner,
          repoName: this.config.repo.name,
          enableDatabaseLogging: this.enableDatabaseLogging,
        });

        const workerTasks: WorkerTask[] = issuesToWork.map((issue) => ({
          issue,
          branchName: this.generateBranchName(issue),
        }));

        const results = await workerPool.executeTasks(workerTasks);

        tasksCompleted = results.filter((r) => r.success).length;
        tasksFailed = results.filter((r) => !r.success).length;

        // STEP 4: Create PRs and evaluate
        logger.step(4, 5, 'Creating PRs and evaluating');

        for (const result of results) {
          if (!result.success) {
            // Remove in-progress label, add failed label
            await this.github.issues.removeLabel(result.issue.number, 'in-progress');
            await this.github.issues.addLabels(result.issue.number, ['needs-review']);
            await this.github.issues.addComment(
              result.issue.number,
              `⚠️ Autonomous implementation failed:\n\n\`\`\`\n${result.error}\n\`\`\``
            );
            continue;
          }

          // Create PR
          try {
            const pr = await this.github.pulls.createPR({
              title: result.issue.title,
              body: this.generatePRBody(result.issue),
              head: result.branchName,
              base: this.config.repo.baseBranch,
            });

            logger.success(`Created PR #${pr.number} for issue #${result.issue.number}`);

            // Link PR to issue
            await this.github.issues.addComment(
              result.issue.number,
              `🔗 PR created: #${pr.number}`
            );
          } catch (error: any) {
            const structuredError = error instanceof StructuredError
              ? error
              : new GitHubError(
                  ErrorCode.GITHUB_API_ERROR,
                  `Failed to create PR for issue #${result.issue.number}: ${error.message}`,
                  {
                    context: {
                      issueNumber: result.issue.number,
                      branchName: result.branchName,
                    },
                    cause: error,
                  }
                );
            errors.push(`[${structuredError.code}] ${structuredError.message}`);
            logger.structuredError(structuredError, {
              context: {
                issueNumber: result.issue.number,
                branchName: result.branchName,
              },
            });
          }
        }

        // STEP 5: Merge successful PRs
        if (this.config.merge.autoMerge) {
          logger.step(5, 5, 'Merging PRs');

          const resolver = createConflictResolver({
            prManager: this.github.pulls,
            branchManager: this.github.branches,
            maxRetries: this.config.merge.maxRetries,
            strategy: this.config.merge.conflictStrategy,
            mergeMethod: this.config.merge.mergeMethod,
            owner: this.config.repo.owner,
            repo: this.config.repo.name,
            baseBranch: this.config.repo.baseBranch,
          });

          // Get branches to merge
          const branchesToMerge = results
            .filter((r) => r.success)
            .map((r) => ({ branchName: r.branchName }));

          const mergeResults = await resolver.mergeSequentially(branchesToMerge);

          for (const [branch, mergeResult] of mergeResults) {
            if (mergeResult.merged) {
              prsMerged++;

              // Find and close the corresponding issue
              const result = results.find((r) => r.branchName === branch);
              if (result) {
                await this.github.issues.closeIssue(
                  result.issue.number,
                  `✅ Automatically implemented and merged via PR #${mergeResult.pr?.number}`
                );
              }
            } else {
              errors.push(`Failed to merge ${branch}: ${mergeResult.error}`);
            }
          }
        }
      }

      return {
        success: errors.length === 0,
        tasksDiscovered,
        tasksCompleted,
        tasksFailed,
        prsMerged,
        duration: Date.now() - startTime,
        errors,
      };
    } catch (error: any) {
      errors.push(error.message);
      return {
        success: false,
        tasksDiscovered,
        tasksCompleted,
        tasksFailed,
        prsMerged,
        duration: Date.now() - startTime,
        errors,
      };
    }
  }

  private async createIssueForTask(task: DiscoveredTask): Promise<Issue> {
    if (!this.github) {
      throw new Error('GitHub client not initialized');
    }

    const labels = [
      this.config.discovery.issueLabel,
      `priority:${task.priority}`,
      `type:${task.category}`,
      `complexity:${task.estimatedComplexity}`,
    ];

    const body = `## Description

${task.description}

## Affected Paths

${task.affectedPaths.map((p) => `- \`${p}\``).join('\n')}

---

*🤖 This issue was automatically created by Autonomous Dev CLI*
`;

    return this.github.issues.createIssue({
      title: task.title,
      body,
      labels,
    });
  }

  private generateBranchName(issue: Issue): string {
    // Convert title to slug
    const slug = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40);

    return `auto/${issue.number}-${slug}`;
  }

  private generatePRBody(issue: Issue): string {
    return `## Summary

Implements #${issue.number}

${issue.body || ''}

## Changes

*Changes were implemented autonomously by Claude.*

---

🤖 Generated by [Autonomous Dev CLI](https://github.com/webedt/monorepo/tree/main/autonomous-dev-cli)
`;
  }

  private logCycleResult(result: CycleResult): void {
    logger.divider();
    logger.header('Cycle Summary');

    console.log(`  Tasks discovered: ${result.tasksDiscovered}`);
    console.log(`  Tasks completed:  ${result.tasksCompleted}`);
    console.log(`  Tasks failed:     ${result.tasksFailed}`);
    console.log(`  PRs merged:       ${result.prsMerged}`);
    console.log(`  Duration:         ${(result.duration / 1000).toFixed(1)}s`);

    if (result.errors.length > 0) {
      console.log(`\n  Errors:`);
      for (const error of result.errors) {
        console.log(`    - ${error}`);
      }
    }

    logger.divider();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(resolve, ms);

      // Allow interruption
      const checkInterval = setInterval(() => {
        if (!this.isRunning) {
          clearTimeout(timeout);
          clearInterval(checkInterval);
          resolve();
        }
      }, 1000);
    });
  }
}

export function createDaemon(options: DaemonOptions = {}): Daemon {
  return new Daemon(options);
}
