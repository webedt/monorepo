import { simpleGit } from 'simple-git';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { type PRManager, type PullRequest } from '../github/pulls.js';
import { type BranchManager } from '../github/branches.js';
import { logger } from '../utils/logger.js';

export interface ConflictResolverOptions {
  prManager: PRManager;
  branchManager: BranchManager;
  maxRetries: number;
  strategy: 'rebase' | 'merge' | 'manual' | 'ai';
  mergeMethod: 'merge' | 'squash' | 'rebase';
  owner: string;
  repo: string;
  baseBranch: string;
  // For AI conflict resolution
  githubToken?: string;
  claudeAuth?: {
    accessToken: string;
    refreshToken: string;
    expiresAt?: number;
  };
  workDir?: string;
}

export interface MergeAttemptResult {
  success: boolean;
  pr?: PullRequest;
  merged: boolean;
  sha?: string;
  error?: string;
  attempts: number;
}

export class ConflictResolver {
  options: ConflictResolverOptions;
  private logInstance = logger.child('ConflictResolver');

  constructor(options: ConflictResolverOptions) {
    this.options = options;
  }

  // Logging helper methods
  private log = {
    info: (msg: string, meta?: object) => this.logInstance.info(msg, meta),
    warn: (msg: string, meta?: object) => this.logInstance.warn(msg, meta),
    error: (msg: string, meta?: object) => this.logInstance.error(msg, meta),
    success: (msg: string) => this.logInstance.success(msg),
    failure: (msg: string) => this.logInstance.failure(msg),
  };

  async attemptMerge(branchName: string, prNumber?: number): Promise<MergeAttemptResult> {
    const { prManager, maxRetries, strategy, mergeMethod } = this.options;
    let attempts = 0;

    this.log.info(`Attempting to merge branch: ${branchName}`);

    // Get or create PR
    let pr: PullRequest | null = null;

    if (prNumber) {
      pr = await prManager.getPR(prNumber);
    } else {
      pr = await prManager.findPRForBranch(branchName, this.options.baseBranch);
    }

    if (!pr) {
      this.log.error(`No PR found for branch ${branchName}`);
      return {
        success: false,
        merged: false,
        error: 'No PR found',
        attempts: 0,
      };
    }

    while (attempts < maxRetries) {
      attempts++;
      this.log.info(`Merge attempt ${attempts}/${maxRetries}`);

      // Wait for GitHub to calculate mergeability
      const isMergeable = await prManager.waitForMergeable(pr.number, 30);

      if (isMergeable) {
        // Try to merge
        const mergeResult = await prManager.mergePR(pr.number, mergeMethod);

        if (mergeResult.merged) {
          this.log.success(`PR #${pr.number} merged successfully`);

          // Delete the branch
          try {
            await this.options.branchManager.deleteBranch(branchName);
          } catch (e) {
            this.log.warn(`Failed to delete branch ${branchName} (may already be deleted)`);
          }

          return {
            success: true,
            pr,
            merged: true,
            sha: mergeResult.sha || undefined,
            attempts,
          };
        } else {
          this.log.warn(`Merge failed: ${mergeResult.message}`);
        }
      }

      // PR is not mergeable - try to resolve conflicts
      if (strategy === 'manual') {
        this.log.warn('Conflicts detected, manual resolution required');
        return {
          success: false,
          pr,
          merged: false,
          error: 'Conflicts require manual resolution',
          attempts,
        };
      }

      // Try AI-based conflict resolution
      if (strategy === 'ai' && this.options.claudeAuth && this.options.githubToken && this.options.workDir) {
        this.log.info('Attempting AI-based conflict resolution...');
        const resolved = await this.resolveConflictsWithAI(branchName);
        if (resolved) {
          this.log.success('AI successfully resolved conflicts');
          // Continue to next iteration to retry merge
          await sleep(2000);
          pr = await prManager.getPR(pr.number);
          if (!pr) {
            return {
              success: false,
              merged: false,
              error: 'PR was closed or deleted after conflict resolution',
              attempts,
            };
          }
          continue;
        } else {
          this.log.warn('AI failed to resolve conflicts');
        }
      }

      // Try to update the branch from base (GitHub's auto-update)
      this.log.info(`Updating branch from ${this.options.baseBranch}...`);

      const updated = await prManager.updatePRFromBase(pr.number);

      if (!updated) {
        this.log.warn('Failed to update branch - conflicts may exist');

        if (strategy === 'rebase') {
          this.log.warn('Rebase strategy failed, would need local git operations');
        }
      }

      // Wait before next attempt
      await sleep(2000);

      // Refresh PR data
      pr = await prManager.getPR(pr.number);
      if (!pr) {
        return {
          success: false,
          merged: false,
          error: 'PR was closed or deleted',
          attempts,
        };
      }
    }

    this.log.error(`Failed to merge after ${maxRetries} attempts`);

    return {
      success: false,
      pr,
      merged: false,
      error: `Failed to merge after ${maxRetries} attempts`,
      attempts,
    };
  }

  // Merge multiple PRs sequentially, handling conflicts
  async mergeSequentially(
    branches: Array<{ branchName: string; prNumber?: number }>
  ): Promise<Map<string, MergeAttemptResult>> {
    const results = new Map<string, MergeAttemptResult>();

    for (const { branchName, prNumber } of branches) {
      this.log.info(`Processing: ${branchName}`);

      const result = await this.attemptMerge(branchName, prNumber);
      results.set(branchName, result);

      if (result.merged) {
        this.log.success(`✓ ${branchName} merged`);

        // Small delay after successful merge to let GitHub update
        await sleep(3000);
      } else {
        this.log.failure(`✗ ${branchName} failed: ${result.error}`);
      }
    }

    return results;
  }

  /**
   * Use AI (Claude) to resolve merge conflicts
   */
  async resolveConflictsWithAI(branchName: string): Promise<boolean> {
    const { owner, repo, baseBranch, githubToken, claudeAuth, workDir } = this.options;

    if (!githubToken || !claudeAuth || !workDir) {
      this.log.error('Missing required options for AI conflict resolution');
      return false;
    }

    const conflictDir = join(workDir, `conflict-${Date.now()}`);

    try {
      // Clean up and create directory
      if (existsSync(conflictDir)) {
        rmSync(conflictDir, { recursive: true, force: true });
      }
      mkdirSync(conflictDir, { recursive: true });

      this.log.info(`Cloning repo for conflict resolution: ${branchName}`);

      // Clone the repo with the feature branch
      const repoUrl = `https://${githubToken}@github.com/${owner}/${repo}.git`;
      const git = simpleGit(conflictDir);
      await git.clone(repoUrl, 'repo', ['--branch', branchName]);

      const repoDir = join(conflictDir, 'repo');
      const repoGit = simpleGit(repoDir);

      // Configure git identity
      await repoGit.addConfig('user.name', 'Autonomous Dev Bot');
      await repoGit.addConfig('user.email', 'bot@autonomous-dev.local');

      // Fetch the base branch
      await repoGit.fetch('origin', baseBranch);

      // Try to merge base branch into feature branch (this will create conflicts)
      this.log.info(`Merging ${baseBranch} into ${branchName}...`);
      try {
        await repoGit.merge([`origin/${baseBranch}`]);
        // If merge succeeds without conflicts, push and return
        this.log.info('Merge succeeded without conflicts');
        await repoGit.push(['origin', branchName]);
        return true;
      } catch (mergeError: any) {
        // Check if there are conflicts
        const status = await repoGit.status();
        if (status.conflicted.length === 0) {
          this.log.error('Merge failed but no conflicts detected', { error: mergeError.message });
          return false;
        }

        this.log.info(`Found ${status.conflicted.length} conflicted files: ${status.conflicted.join(', ')}`);
      }

      // Write Claude credentials
      const claudeDir = join(homedir(), '.claude');
      const credentialsPath = join(claudeDir, '.credentials.json');
      if (!existsSync(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
      }
      const credentials = {
        claudeAiOauth: {
          accessToken: claudeAuth.accessToken,
          refreshToken: claudeAuth.refreshToken,
          expiresAt: claudeAuth.expiresAt || Date.now() + 3600000,
          scopes: ['user:inference', 'user:profile'],
        },
      };
      writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });

      // Use Claude to resolve conflicts
      this.log.info('Asking Claude to resolve conflicts...');

      const prompt = `You are resolving merge conflicts in a git repository.

The branch "${branchName}" has conflicts when merging from "${baseBranch}".

Your task:
1. Use the Bash tool to run \`git status\` to see conflicted files
2. For each conflicted file, read it to understand the conflicts (look for <<<<<<< HEAD, =======, >>>>>>> markers)
3. Resolve each conflict by editing the file to keep the best of both changes
4. After resolving, run \`git add <file>\` for each resolved file
5. Run \`git status\` to verify all conflicts are resolved
6. Run \`git commit -m "Resolve merge conflicts from ${baseBranch}"\` to complete the merge

Important:
- Preserve functionality from BOTH branches where possible
- If in doubt, prefer the changes from ${baseBranch} as it's the newer code
- Make sure the resulting code compiles/works
- Do NOT push - just commit the resolution

Start by checking the status.`;

      const queryStream = query({
        prompt,
        options: {
          cwd: repoDir,
          allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
          permissionMode: 'bypassPermissions',
          maxTurns: 30,
        },
      });

      let success = false;
      for await (const message of queryStream) {
        if (message.type === 'result' && message.subtype === 'success') {
          success = true;
        }
      }

      if (!success) {
        this.log.error('Claude failed to complete conflict resolution');
        return false;
      }

      // Verify conflicts are resolved
      const finalStatus = await repoGit.status();
      if (finalStatus.conflicted.length > 0) {
        this.log.error(`Conflicts still remain: ${finalStatus.conflicted.join(', ')}`);
        return false;
      }

      // Push the resolved branch
      this.log.info('Pushing conflict resolution...');
      await repoGit.push(['origin', branchName]);

      this.log.success('Conflicts resolved and pushed successfully');
      return true;
    } catch (error: any) {
      this.log.error('AI conflict resolution failed', { error: error.message });
      return false;
    } finally {
      // Cleanup
      try {
        if (existsSync(conflictDir)) {
          rmSync(conflictDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createConflictResolver(options: ConflictResolverOptions): ConflictResolver {
  return new ConflictResolver(options);
}
