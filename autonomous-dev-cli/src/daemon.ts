import { loadConfig, type Config } from './config/index.js';
import { initDatabase, getUserCredentials, closeDatabase, ensureValidClaudeToken } from './db/index.js';
import { createGitHub, type GitHub, type Issue } from './github/index.js';
import { discoverTasks, type DiscoveredTask } from './discovery/index.js';
import { createWorkerPool, type WorkerTask, type PoolResult } from './executor/index.js';
import { runEvaluation, type EvaluationResult } from './evaluation/index.js';
import { createConflictResolver } from './conflicts/index.js';
import { logger } from './utils/logger.js';
import { mkdirSync, existsSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { simpleGit } from 'simple-git';

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
      logger.error('Daemon error', { error: error.message });
      throw error;
    } finally {
      await this.shutdown();
    }
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
        throw new Error(`User not found: ${this.config.credentials.userEmail}`);
      }
    }

    // Validate required credentials
    if (!this.config.credentials.githubToken) {
      throw new Error('GitHub token not configured');
    }
    if (!this.config.credentials.claudeAuth) {
      throw new Error('Claude auth not configured');
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
    logger.info(`Base branch for PRs: ${this.config.repo.baseBranch}`);

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
        throw new Error('Not initialized');
      }

      // Refresh Claude token if needed before starting cycle
      if (this.userId && this.config.credentials.claudeAuth) {
        try {
          const refreshedAuth = await ensureValidClaudeToken(
            this.userId,
            this.config.credentials.claudeAuth as {
              accessToken: string;
              refreshToken: string;
              expiresAt: number;
            }
          );
          // Update config with refreshed credentials
          this.config.credentials.claudeAuth = {
            accessToken: refreshedAuth.accessToken,
            refreshToken: refreshedAuth.refreshToken,
            expiresAt: refreshedAuth.expiresAt,
          };
        } catch (refreshError: any) {
          errors.push(`Token refresh failed: ${refreshError.message}`);
          logger.error('Failed to refresh Claude token before cycle', { error: refreshError.message });
          // Continue anyway - the token might still work
        }
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

        // Clone repo for analysis (to get the full monorepo, not just /app)
        const analysisDir = join(this.config.execution.workDir, 'analysis');
        let repoPath = process.cwd();

        try {
          repoPath = await this.cloneRepoForAnalysis(analysisDir);
          logger.info(`Analyzing cloned repo at: ${repoPath}`);
        } catch (cloneError: any) {
          logger.warn(`Failed to clone repo for analysis: ${cloneError.message}. Using current directory.`);
        }

        try {
          const tasks = await discoverTasks({
            claudeAuth: this.config.credentials.claudeAuth,
            repoPath,
            excludePaths: this.config.discovery.excludePaths,
            tasksPerCycle: Math.min(this.config.discovery.tasksPerCycle, availableSlots),
            existingIssues,
            repoContext: `WebEDT Monorepo - AI-powered coding assistant platform containing:
- /website: React frontend (Vite) + Express API facade
- /internal-api-server: Backend API, database, storage, GitHub operations
- /ai-coding-worker: Claude Agent SDK worker for LLM execution
- /autonomous-dev-cli: Autonomous development daemon
- /shared: Shared utilities and types

Focus on improvements across the ENTIRE monorepo, not just one package.`,
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
              errors.push(`Failed to create issue for "${task.title}": ${error.message}`);
              logger.error(`Failed to create issue: ${error.message}`);
            }
          }
        } catch (error: any) {
          errors.push(`Task discovery failed: ${error.message}`);
          logger.error('Task discovery failed', { error: error.message });
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
            errors.push(`Failed to create PR for issue #${result.issue.number}: ${error.message}`);
            logger.error('Failed to create PR', { error: error.message });
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
            // For AI conflict resolution
            githubToken: this.config.credentials.githubToken,
            claudeAuth: this.config.credentials.claudeAuth,
            workDir: this.config.execution.workDir,
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

  /**
   * Clone the repository for analysis to get the full monorepo contents.
   * Returns the path to the cloned repo.
   */
  private async cloneRepoForAnalysis(analysisDir: string): Promise<string> {
    const repoDir = join(analysisDir, 'repo');

    // Clean up any existing analysis directory
    if (existsSync(analysisDir)) {
      rmSync(analysisDir, { recursive: true, force: true });
    }
    mkdirSync(analysisDir, { recursive: true });

    logger.info('Cloning repository for analysis...');

    // Clone with auth token
    const repoUrl = `https://github.com/${this.config.repo.owner}/${this.config.repo.name}`;
    const urlWithAuth = repoUrl.replace(
      'https://github.com',
      `https://${this.config.credentials.githubToken}@github.com`
    );

    const git = simpleGit(analysisDir);
    await git.clone(urlWithAuth, 'repo', [
      '--depth', '1',
      '--branch', this.config.repo.baseBranch,
      '--single-branch',
    ]);

    logger.info('Repository cloned for analysis');
    return repoDir;
  }
}

export function createDaemon(options: DaemonOptions = {}): Daemon {
  return new Daemon(options);
}
