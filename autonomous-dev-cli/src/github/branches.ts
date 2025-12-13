import { GitHubClient } from './client.js';
import { logger } from '../utils/logger.js';

export interface Branch {
  name: string;
  sha: string;
  protected: boolean;
}

/**
 * Detailed branch protection configuration
 */
export interface BranchProtectionRules {
  /** Whether the branch has protection rules */
  enabled: boolean;
  /** Require pull request reviews before merging */
  requirePullRequestReviews: boolean;
  /** Number of required approving reviews */
  requiredApprovingReviewCount: number;
  /** Dismiss stale pull request approvals on new commits */
  dismissStaleReviews: boolean;
  /** Require review from code owners */
  requireCodeOwnerReviews: boolean;
  /** Require status checks to pass before merging */
  requireStatusChecks: boolean;
  /** Require branches to be up to date before merging */
  requireUpToDateBranch: boolean;
  /** List of required status check contexts */
  requiredStatusCheckContexts: string[];
  /** Require signed commits */
  requireSignedCommits: boolean;
  /** Require linear history (no merge commits) */
  requireLinearHistory: boolean;
  /** Allow force pushes */
  allowForcePushes: boolean;
  /** Allow deletions */
  allowDeletions: boolean;
  /** Block force pushes from everyone */
  blockCreations: boolean;
  /** Enforce all configured restrictions for administrators */
  enforceAdmins: boolean;
  /** Lock the branch (read-only) */
  lockBranch: boolean;
}

/**
 * Result of branch protection compliance check
 */
export interface BranchProtectionCompliance {
  /** Whether all protection requirements are met */
  compliant: boolean;
  /** List of compliance violations */
  violations: string[];
  /** List of warnings (non-blocking issues) */
  warnings: string[];
  /** The branch protection rules that were checked */
  rules: BranchProtectionRules;
}

/**
 * Options for checking merge readiness
 */
export interface MergeReadinessOptions {
  /** PR number to check */
  prNumber?: number;
  /** Head SHA to check status for */
  headSha?: string;
  /** Check if branch is up to date with base */
  checkUpToDate?: boolean;
}

/**
 * Result of merge readiness check
 */
export interface MergeReadiness {
  /** Whether the branch can be merged */
  ready: boolean;
  /** Reasons why the branch cannot be merged */
  blockers: string[];
  /** Warnings that don't block merge */
  warnings: string[];
  /** Current status check results */
  statusChecks: {
    context: string;
    state: 'success' | 'pending' | 'failure' | 'error';
    description?: string;
  }[];
}

export interface BranchManager {
  listBranches(): Promise<Branch[]>;
  getBranch(name: string): Promise<Branch | null>;
  createBranch(name: string, baseBranch: string): Promise<Branch>;
  deleteBranch(name: string): Promise<void>;
  branchExists(name: string): Promise<boolean>;
  /** Get detailed branch protection rules */
  getBranchProtectionRules(branch: string): Promise<BranchProtectionRules>;
  /** Check if a branch is protected */
  isBranchProtected(branch: string): Promise<boolean>;
  /** Check compliance with branch protection rules before attempting merge */
  checkProtectionCompliance(branch: string, options?: MergeReadinessOptions): Promise<BranchProtectionCompliance>;
  /** Check if a branch is ready to be merged (all checks pass, up to date, etc.) */
  checkMergeReadiness(headBranch: string, baseBranch: string, options?: MergeReadinessOptions): Promise<MergeReadiness>;
  /** Get the default branch for the repository */
  getDefaultBranch(): Promise<string>;
  /** Compare two branches and get the diff stats */
  compareBranches(base: string, head: string): Promise<{
    ahead: number;
    behind: number;
    files: string[];
    commits: number;
  }>;
}

export function createBranchManager(client: GitHubClient): BranchManager {
  const octokit = client.client;
  const { owner, repo } = client;

  return {
    async listBranches(): Promise<Branch[]> {
      try {
        const { data } = await octokit.repos.listBranches({
          owner,
          repo,
          per_page: 100,
        });

        return data.map((branch) => ({
          name: branch.name,
          sha: branch.commit.sha,
          protected: branch.protected,
        }));
      } catch (error) {
        logger.error('Failed to list branches', { error });
        throw error;
      }
    },

    async getBranch(name: string): Promise<Branch | null> {
      try {
        const { data } = await octokit.repos.getBranch({
          owner,
          repo,
          branch: name,
        });

        return {
          name: data.name,
          sha: data.commit.sha,
          protected: data.protected,
        };
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        throw error;
      }
    },

    async createBranch(name: string, baseBranch: string): Promise<Branch> {
      try {
        // Get the SHA of the base branch
        const { data: baseBranchData } = await octokit.repos.getBranch({
          owner,
          repo,
          branch: baseBranch,
        });

        // Create the new branch
        await octokit.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${name}`,
          sha: baseBranchData.commit.sha,
        });

        logger.info(`Created branch '${name}' from '${baseBranch}'`);

        return {
          name,
          sha: baseBranchData.commit.sha,
          protected: false,
        };
      } catch (error: any) {
        // Check if branch already exists
        if (error.status === 422 && error.message?.includes('Reference already exists')) {
          logger.warn(`Branch '${name}' already exists`);
          const existing = await this.getBranch(name);
          if (existing) {
            return existing;
          }
        }
        logger.error('Failed to create branch', { error, name, baseBranch });
        throw error;
      }
    },

    async deleteBranch(name: string): Promise<void> {
      try {
        await octokit.git.deleteRef({
          owner,
          repo,
          ref: `heads/${name}`,
        });
        logger.info(`Deleted branch '${name}'`);
      } catch (error: any) {
        if (error.status === 404) {
          logger.warn(`Branch '${name}' not found (may already be deleted)`);
          return;
        }
        logger.error('Failed to delete branch', { error, name });
        throw error;
      }
    },

    async branchExists(name: string): Promise<boolean> {
      const branch = await this.getBranch(name);
      return branch !== null;
    },

    async getBranchProtectionRules(branch: string): Promise<BranchProtectionRules> {
      const defaultRules: BranchProtectionRules = {
        enabled: false,
        requirePullRequestReviews: false,
        requiredApprovingReviewCount: 0,
        dismissStaleReviews: false,
        requireCodeOwnerReviews: false,
        requireStatusChecks: false,
        requireUpToDateBranch: false,
        requiredStatusCheckContexts: [],
        requireSignedCommits: false,
        requireLinearHistory: false,
        allowForcePushes: false,
        allowDeletions: false,
        blockCreations: false,
        enforceAdmins: false,
        lockBranch: false,
      };

      try {
        const { data } = await octokit.repos.getBranchProtection({
          owner,
          repo,
          branch,
        });

        const rules: BranchProtectionRules = {
          enabled: true,
          requirePullRequestReviews: !!data.required_pull_request_reviews,
          requiredApprovingReviewCount: data.required_pull_request_reviews?.required_approving_review_count ?? 0,
          dismissStaleReviews: data.required_pull_request_reviews?.dismiss_stale_reviews ?? false,
          requireCodeOwnerReviews: data.required_pull_request_reviews?.require_code_owner_reviews ?? false,
          requireStatusChecks: !!data.required_status_checks,
          requireUpToDateBranch: data.required_status_checks?.strict ?? false,
          requiredStatusCheckContexts: data.required_status_checks?.contexts ?? [],
          requireSignedCommits: !!data.required_signatures,
          requireLinearHistory: !!data.required_linear_history?.enabled,
          allowForcePushes: data.allow_force_pushes?.enabled ?? false,
          allowDeletions: data.allow_deletions?.enabled ?? false,
          blockCreations: data.block_creations?.enabled ?? false,
          enforceAdmins: data.enforce_admins?.enabled ?? false,
          lockBranch: data.lock_branch?.enabled ?? false,
        };

        logger.debug(`Retrieved protection rules for branch '${branch}'`, { rules });
        return rules;
      } catch (error: any) {
        if (error.status === 404) {
          // No protection rules exist
          logger.debug(`No protection rules found for branch '${branch}'`);
          return defaultRules;
        }
        logger.error('Failed to get branch protection rules', { error, branch });
        throw error;
      }
    },

    async isBranchProtected(branch: string): Promise<boolean> {
      try {
        const branchData = await this.getBranch(branch);
        return branchData?.protected ?? false;
      } catch (error) {
        logger.warn(`Failed to check if branch '${branch}' is protected`, { error });
        return false;
      }
    },

    async checkProtectionCompliance(branch: string, options?: MergeReadinessOptions): Promise<BranchProtectionCompliance> {
      const violations: string[] = [];
      const warnings: string[] = [];

      const rules = await this.getBranchProtectionRules(branch);

      if (!rules.enabled) {
        return {
          compliant: true,
          violations: [],
          warnings: ['Branch has no protection rules configured'],
          rules,
        };
      }

      // Check status checks if head SHA is provided
      if (rules.requireStatusChecks && options?.headSha) {
        try {
          const { data: combinedStatus } = await octokit.repos.getCombinedStatusForRef({
            owner,
            repo,
            ref: options.headSha,
          });

          if (combinedStatus.state !== 'success') {
            violations.push(`Status checks are not passing (current state: ${combinedStatus.state})`);
          }

          // Check specific required contexts
          for (const context of rules.requiredStatusCheckContexts) {
            const status = combinedStatus.statuses.find(s => s.context === context);
            if (!status) {
              violations.push(`Required status check '${context}' is missing`);
            } else if (status.state !== 'success') {
              violations.push(`Required status check '${context}' is not passing (state: ${status.state})`);
            }
          }
        } catch (error) {
          warnings.push('Could not verify status checks');
          logger.warn('Failed to check status checks for compliance', { error });
        }
      } else if (rules.requireStatusChecks && !options?.headSha) {
        warnings.push('Status checks are required but no head SHA provided for verification');
      }

      // Check up-to-date requirement
      if (rules.requireUpToDateBranch && options?.checkUpToDate === false) {
        warnings.push('Branch must be up to date with base before merging');
      }

      // Check review requirements (we can't easily verify these without more API calls)
      if (rules.requirePullRequestReviews) {
        if (rules.requiredApprovingReviewCount > 0) {
          warnings.push(`Requires ${rules.requiredApprovingReviewCount} approving review(s)`);
        }
        if (rules.requireCodeOwnerReviews) {
          warnings.push('Requires review from code owners');
        }
        if (rules.dismissStaleReviews) {
          warnings.push('Stale reviews will be dismissed on new commits');
        }
      }

      // Check signed commits
      if (rules.requireSignedCommits) {
        warnings.push('All commits must be signed');
      }

      // Check linear history
      if (rules.requireLinearHistory) {
        warnings.push('Linear history required (no merge commits)');
      }

      // Check admin enforcement
      if (rules.enforceAdmins) {
        warnings.push('These restrictions also apply to repository administrators');
      }

      return {
        compliant: violations.length === 0,
        violations,
        warnings,
        rules,
      };
    },

    async checkMergeReadiness(headBranch: string, baseBranch: string, options?: MergeReadinessOptions): Promise<MergeReadiness> {
      const blockers: string[] = [];
      const warnings: string[] = [];
      const statusChecks: MergeReadiness['statusChecks'] = [];

      try {
        // Get head branch info
        const headBranchData = await this.getBranch(headBranch);
        if (!headBranchData) {
          return {
            ready: false,
            blockers: [`Head branch '${headBranch}' does not exist`],
            warnings: [],
            statusChecks: [],
          };
        }

        const headSha = options?.headSha ?? headBranchData.sha;

        // Check protection compliance on base branch
        const compliance = await this.checkProtectionCompliance(baseBranch, {
          ...options,
          headSha,
        });

        blockers.push(...compliance.violations);
        warnings.push(...compliance.warnings);

        // Get status checks
        try {
          const { data: combinedStatus } = await octokit.repos.getCombinedStatusForRef({
            owner,
            repo,
            ref: headSha,
          });

          for (const status of combinedStatus.statuses) {
            statusChecks.push({
              context: status.context,
              state: status.state as 'success' | 'pending' | 'failure' | 'error',
              description: status.description || undefined,
            });
          }

          // Also check GitHub Actions check runs
          try {
            const { data: checkRuns } = await octokit.checks.listForRef({
              owner,
              repo,
              ref: headSha,
            });

            for (const check of checkRuns.check_runs) {
              // Map check run conclusion to status state
              let state: 'success' | 'pending' | 'failure' | 'error' = 'pending';
              if (check.conclusion === 'success') {
                state = 'success';
              } else if (check.conclusion === 'failure' || check.conclusion === 'cancelled' || check.conclusion === 'timed_out') {
                state = 'failure';
              } else if (check.conclusion === 'action_required') {
                state = 'error';
              } else if (check.status === 'in_progress' || check.status === 'queued') {
                state = 'pending';
              }

              // Don't add duplicates
              if (!statusChecks.some(s => s.context === check.name)) {
                statusChecks.push({
                  context: check.name,
                  state,
                  description: check.output?.summary || undefined,
                });
              }
            }
          } catch (error) {
            // Check runs API might not be available
            logger.debug('Could not fetch check runs', { error });
          }
        } catch (error) {
          warnings.push('Could not retrieve status checks');
          logger.warn('Failed to get combined status', { error });
        }

        // Check if branch is up to date with base
        if (options?.checkUpToDate !== false) {
          try {
            const comparison = await this.compareBranches(baseBranch, headBranch);
            if (comparison.behind > 0) {
              const rules = await this.getBranchProtectionRules(baseBranch);
              if (rules.requireUpToDateBranch) {
                blockers.push(`Branch is ${comparison.behind} commit(s) behind '${baseBranch}' and must be updated`);
              } else {
                warnings.push(`Branch is ${comparison.behind} commit(s) behind '${baseBranch}'`);
              }
            }
          } catch (error) {
            warnings.push('Could not compare branches');
            logger.debug('Failed to compare branches', { error });
          }
        }

        return {
          ready: blockers.length === 0,
          blockers,
          warnings,
          statusChecks,
        };
      } catch (error: any) {
        logger.error('Failed to check merge readiness', { error, headBranch, baseBranch });
        return {
          ready: false,
          blockers: [`Error checking merge readiness: ${error.message}`],
          warnings: [],
          statusChecks: [],
        };
      }
    },

    async getDefaultBranch(): Promise<string> {
      try {
        const { data } = await octokit.repos.get({
          owner,
          repo,
        });
        return data.default_branch;
      } catch (error) {
        logger.error('Failed to get default branch', { error });
        throw error;
      }
    },

    async compareBranches(base: string, head: string): Promise<{
      ahead: number;
      behind: number;
      files: string[];
      commits: number;
    }> {
      try {
        const { data } = await octokit.repos.compareCommits({
          owner,
          repo,
          base,
          head,
        });

        return {
          ahead: data.ahead_by,
          behind: data.behind_by,
          files: data.files?.map(f => f.filename) ?? [],
          commits: data.total_commits,
        };
      } catch (error: any) {
        if (error.status === 404) {
          // One of the branches doesn't exist
          logger.warn(`Could not compare branches '${base}' and '${head}'`, { error: error.message });
          return {
            ahead: 0,
            behind: 0,
            files: [],
            commits: 0,
          };
        }
        logger.error('Failed to compare branches', { error, base, head });
        throw error;
      }
    },
  };
}
