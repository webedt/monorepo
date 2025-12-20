/**
 * GitHub Status Checks Manager
 *
 * Provides comprehensive management of GitHub status checks and check runs with:
 * - Exponential backoff with jitter for all API calls
 * - Rate limit header parsing and adaptive throttling
 * - Request queuing to prevent burst limit violations
 * - Automatic retry logic for transient failures
 * - Graceful degradation during rate limit periods
 */

import { GitHubClient, type ServiceHealth } from './client.js';
import { logger } from '../utils/logger.js';
import {
  GitHubError,
  ErrorCode,
  createGitHubErrorFromResponse,
} from '../utils/errors.js';

/**
 * Individual status check result
 */
export interface StatusCheck {
  context: string;
  state: 'error' | 'failure' | 'pending' | 'success';
  description: string | null;
  targetUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Combined status for a commit reference
 */
export interface CombinedStatus {
  state: 'error' | 'failure' | 'pending' | 'success';
  totalCount: number;
  statuses: StatusCheck[];
  sha: string;
  commitUrl: string;
}

/**
 * GitHub Check Run (from the Checks API)
 */
export interface CheckRun {
  id: number;
  name: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null;
  startedAt: string | null;
  completedAt: string | null;
  htmlUrl: string;
  output: {
    title: string | null;
    summary: string | null;
    text: string | null;
  };
}

/**
 * Check suite containing multiple check runs
 */
export interface CheckSuite {
  id: number;
  headBranch: string;
  headSha: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | 'stale' | null;
  checkRuns: CheckRun[];
}

/**
 * Result of waiting for checks to complete
 */
export interface ChecksWaitResult {
  completed: boolean;
  timedOut: boolean;
  state: 'success' | 'failure' | 'pending' | 'error';
  failedChecks: string[];
  pendingChecks: string[];
  elapsedMs: number;
}

/**
 * Options for waiting on checks
 */
export interface WaitForChecksOptions {
  /** Maximum time to wait in milliseconds (default: 600000 = 10 minutes) */
  maxWaitMs?: number;
  /** Interval between polling checks in milliseconds (default: 10000 = 10 seconds) */
  pollIntervalMs?: number;
  /** Required check contexts that must pass (if empty, all checks must pass) */
  requiredChecks?: string[];
  /** Whether to fail fast on first failing check (default: false) */
  failFast?: boolean;
}

/**
 * Result type for operations that support graceful degradation
 */
export interface DegradedResult<T> {
  value: T;
  degraded: boolean;
}

/**
 * Checks manager interface
 */
export interface ChecksManager {
  /** Get combined commit status for a ref */
  getCombinedStatus(ref: string): Promise<CombinedStatus>;
  /** Get combined status with fallback for graceful degradation */
  getCombinedStatusWithFallback(ref: string, fallback?: CombinedStatus): Promise<DegradedResult<CombinedStatus>>;
  /** Get all check runs for a ref */
  getCheckRuns(ref: string): Promise<CheckRun[]>;
  /** Get check runs with fallback for graceful degradation */
  getCheckRunsWithFallback(ref: string, fallback?: CheckRun[]): Promise<DegradedResult<CheckRun[]>>;
  /** Get a specific check run by ID */
  getCheckRun(checkRunId: number): Promise<CheckRun | null>;
  /** Get check suites for a ref */
  getCheckSuites(ref: string): Promise<CheckSuite[]>;
  /** Create a status check */
  createStatus(ref: string, status: CreateStatusOptions): Promise<StatusCheck>;
  /** Wait for all checks to complete */
  waitForChecks(ref: string, options?: WaitForChecksOptions): Promise<ChecksWaitResult>;
  /** Check if all required checks have passed */
  areRequiredChecksPassing(ref: string, requiredChecks?: string[]): Promise<boolean>;
  /** Get service health status */
  getServiceHealth(): ServiceHealth;
  /** Check if the service is available */
  isAvailable(): boolean;
  /** Re-run a failed check */
  rerunCheck(checkRunId: number): Promise<boolean>;
  /** Re-run all failed checks for a ref */
  rerunFailedChecks(ref: string): Promise<number>;
}

/**
 * Options for creating a status check
 */
export interface CreateStatusOptions {
  state: 'error' | 'failure' | 'pending' | 'success';
  context: string;
  description?: string;
  targetUrl?: string;
}

/**
 * Map Octokit status to our StatusCheck interface
 */
function mapStatus(data: any): StatusCheck {
  return {
    context: data.context,
    state: data.state,
    description: data.description,
    targetUrl: data.target_url,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Map Octokit check run to our CheckRun interface
 */
function mapCheckRun(data: any): CheckRun {
  return {
    id: data.id,
    name: data.name,
    headSha: data.head_sha,
    status: data.status,
    conclusion: data.conclusion,
    startedAt: data.started_at,
    completedAt: data.completed_at,
    htmlUrl: data.html_url,
    output: {
      title: data.output?.title ?? null,
      summary: data.output?.summary ?? null,
      text: data.output?.text ?? null,
    },
  };
}

/**
 * Create a checks manager instance
 */
export function createChecksManager(client: GitHubClient): ChecksManager {
  const octokit = client.client;
  const { owner, repo } = client;
  const log = logger.child('ChecksManager');

  /**
   * Handle and transform errors
   */
  const handleError = (error: any, operation: string, context?: Record<string, unknown>): never => {
    const structuredError = createGitHubErrorFromResponse(error, operation, {
      owner,
      repo,
      ...context,
    });
    log.error(`Failed to ${operation}`, { error: structuredError.message, ...context });
    throw structuredError;
  };

  /**
   * Create default combined status for fallback
   */
  const createDefaultCombinedStatus = (ref: string): CombinedStatus => ({
    state: 'pending',
    totalCount: 0,
    statuses: [],
    sha: ref,
    commitUrl: `https://github.com/${owner}/${repo}/commit/${ref}`,
  });

  return {
    getServiceHealth(): ServiceHealth {
      return client.getServiceHealth();
    },

    isAvailable(): boolean {
      return client.isAvailable();
    },

    async getCombinedStatus(ref: string): Promise<CombinedStatus> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.repos.getCombinedStatusForRef({
              owner,
              repo,
              ref,
            });

            return {
              state: data.state as CombinedStatus['state'],
              totalCount: data.total_count,
              statuses: data.statuses.map(mapStatus),
              sha: data.sha,
              commitUrl: data.commit_url,
            };
          },
          `GET /repos/${owner}/${repo}/commits/${ref}/status`,
          { operation: 'getCombinedStatus', ref }
        );
      } catch (error) {
        return handleError(error, 'get combined status', { ref });
      }
    },

    async getCombinedStatusWithFallback(ref: string, fallback?: CombinedStatus): Promise<DegradedResult<CombinedStatus>> {
      const defaultFallback = fallback ?? createDefaultCombinedStatus(ref);

      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.repos.getCombinedStatusForRef({
            owner,
            repo,
            ref,
          });

          return {
            state: data.state as CombinedStatus['state'],
            totalCount: data.total_count,
            statuses: data.statuses.map(mapStatus),
            sha: data.sha,
            commitUrl: data.commit_url,
          };
        },
        defaultFallback,
        `GET /repos/${owner}/${repo}/commits/${ref}/status`,
        { operation: 'getCombinedStatus', ref }
      );

      if (result.degraded) {
        log.warn('Combined status fetch degraded - using fallback', { ref });
      }

      return result;
    },

    async getCheckRuns(ref: string): Promise<CheckRun[]> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.checks.listForRef({
              owner,
              repo,
              ref,
              per_page: 100,
            });

            return data.check_runs.map(mapCheckRun);
          },
          `GET /repos/${owner}/${repo}/commits/${ref}/check-runs`,
          { operation: 'getCheckRuns', ref }
        );
      } catch (error) {
        return handleError(error, 'get check runs', { ref });
      }
    },

    async getCheckRunsWithFallback(ref: string, fallback: CheckRun[] = []): Promise<DegradedResult<CheckRun[]>> {
      const result = await client.executeWithFallback(
        async () => {
          const { data } = await octokit.checks.listForRef({
            owner,
            repo,
            ref,
            per_page: 100,
          });

          return data.check_runs.map(mapCheckRun);
        },
        fallback,
        `GET /repos/${owner}/${repo}/commits/${ref}/check-runs`,
        { operation: 'getCheckRuns', ref }
      );

      if (result.degraded) {
        log.warn('Check runs fetch degraded - using fallback', {
          ref,
          fallbackCount: fallback.length,
        });
      }

      return result;
    },

    async getCheckRun(checkRunId: number): Promise<CheckRun | null> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.checks.get({
              owner,
              repo,
              check_run_id: checkRunId,
            });

            return mapCheckRun(data);
          },
          `GET /repos/${owner}/${repo}/check-runs/${checkRunId}`,
          { operation: 'getCheckRun', checkRunId }
        );
      } catch (error: any) {
        if (error.status === 404) {
          return null;
        }
        return handleError(error, 'get check run', { checkRunId });
      }
    },

    async getCheckSuites(ref: string): Promise<CheckSuite[]> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.checks.listSuitesForRef({
              owner,
              repo,
              ref,
            });

            const suites: CheckSuite[] = [];

            for (const suite of data.check_suites) {
              // Get check runs for each suite
              const { data: runsData } = await octokit.checks.listForSuite({
                owner,
                repo,
                check_suite_id: suite.id,
              });

              suites.push({
                id: suite.id,
                headBranch: suite.head_branch ?? '',
                headSha: suite.head_sha,
                status: suite.status as CheckSuite['status'],
                conclusion: suite.conclusion as CheckSuite['conclusion'],
                checkRuns: runsData.check_runs.map(mapCheckRun),
              });
            }

            return suites;
          },
          `GET /repos/${owner}/${repo}/commits/${ref}/check-suites`,
          { operation: 'getCheckSuites', ref }
        );
      } catch (error) {
        return handleError(error, 'get check suites', { ref });
      }
    },

    async createStatus(ref: string, status: CreateStatusOptions): Promise<StatusCheck> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.repos.createCommitStatus({
              owner,
              repo,
              sha: ref,
              state: status.state,
              context: status.context,
              description: status.description,
              target_url: status.targetUrl,
            });

            log.info(`Created status check for ${ref}`, {
              context: status.context,
              state: status.state,
            });

            return mapStatus(data);
          },
          `POST /repos/${owner}/${repo}/statuses/${ref}`,
          { operation: 'createStatus', ref, context: status.context, state: status.state }
        );
      } catch (error) {
        return handleError(error, 'create status', { ref, status });
      }
    },

    async waitForChecks(ref: string, options: WaitForChecksOptions = {}): Promise<ChecksWaitResult> {
      const {
        maxWaitMs = 600000, // 10 minutes default
        pollIntervalMs = 10000, // 10 seconds default
        requiredChecks = [],
        failFast = false,
      } = options;

      const startTime = Date.now();
      const result: ChecksWaitResult = {
        completed: false,
        timedOut: false,
        state: 'pending',
        failedChecks: [],
        pendingChecks: [],
        elapsedMs: 0,
      };

      log.info(`Waiting for checks to complete on ${ref}`, {
        maxWaitMs,
        pollIntervalMs,
        requiredChecks: requiredChecks.length > 0 ? requiredChecks : 'all',
      });

      while (Date.now() - startTime < maxWaitMs) {
        try {
          // Get both status checks and check runs
          const [combinedStatus, checkRuns] = await Promise.all([
            this.getCombinedStatus(ref),
            this.getCheckRuns(ref),
          ]);

          // Collect all check contexts/names
          const statusContexts = new Map<string, 'success' | 'failure' | 'pending' | 'error'>();
          for (const status of combinedStatus.statuses) {
            statusContexts.set(status.context, status.state);
          }
          for (const run of checkRuns) {
            const state = run.status === 'completed'
              ? (run.conclusion === 'success' ? 'success' : 'failure')
              : 'pending';
            statusContexts.set(run.name, state as any);
          }

          // Determine which checks to evaluate
          const checksToEvaluate = requiredChecks.length > 0
            ? requiredChecks
            : Array.from(statusContexts.keys());

          // Check the state of each required check
          result.failedChecks = [];
          result.pendingChecks = [];

          for (const check of checksToEvaluate) {
            const state = statusContexts.get(check);
            if (!state || state === 'pending') {
              result.pendingChecks.push(check);
            } else if (state === 'failure' || state === 'error') {
              result.failedChecks.push(check);
            }
          }

          // Determine overall state
          if (result.failedChecks.length > 0) {
            if (failFast) {
              result.state = 'failure';
              result.completed = true;
              result.elapsedMs = Date.now() - startTime;
              log.warn(`Checks failed (fail-fast) for ${ref}`, {
                failedChecks: result.failedChecks,
                elapsedMs: result.elapsedMs,
              });
              return result;
            }
          }

          if (result.pendingChecks.length === 0) {
            // All checks have completed
            result.completed = true;
            result.state = result.failedChecks.length > 0 ? 'failure' : 'success';
            result.elapsedMs = Date.now() - startTime;

            log.info(`Checks completed for ${ref}`, {
              state: result.state,
              failedChecks: result.failedChecks,
              elapsedMs: result.elapsedMs,
            });
            return result;
          }

          log.debug(`Waiting for checks on ${ref}`, {
            pendingChecks: result.pendingChecks,
            failedChecks: result.failedChecks,
            elapsedMs: Date.now() - startTime,
          });

        } catch (error) {
          // Log but continue waiting on transient errors
          log.warn(`Error checking status for ${ref}, will retry`, {
            error: (error as Error).message,
          });
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      }

      // Timed out
      result.timedOut = true;
      result.elapsedMs = Date.now() - startTime;
      result.state = result.failedChecks.length > 0 ? 'failure' : 'pending';

      log.warn(`Timed out waiting for checks on ${ref}`, {
        pendingChecks: result.pendingChecks,
        failedChecks: result.failedChecks,
        elapsedMs: result.elapsedMs,
      });

      return result;
    },

    async areRequiredChecksPassing(ref: string, requiredChecks: string[] = []): Promise<boolean> {
      try {
        const [combinedStatus, checkRuns] = await Promise.all([
          this.getCombinedStatus(ref),
          this.getCheckRuns(ref),
        ]);

        // If no required checks specified, use overall state
        if (requiredChecks.length === 0) {
          // Check combined status
          if (combinedStatus.state === 'success') {
            // Also verify all check runs are successful
            const allRunsSuccessful = checkRuns.every(
              run => run.status === 'completed' && run.conclusion === 'success'
            );
            return allRunsSuccessful || checkRuns.length === 0;
          }
          return false;
        }

        // Check specific required checks
        const statusMap = new Map<string, boolean>();

        for (const status of combinedStatus.statuses) {
          statusMap.set(status.context, status.state === 'success');
        }

        for (const run of checkRuns) {
          statusMap.set(
            run.name,
            run.status === 'completed' && run.conclusion === 'success'
          );
        }

        return requiredChecks.every(check => statusMap.get(check) === true);
      } catch (error) {
        log.error('Failed to check required checks status', {
          ref,
          requiredChecks,
          error: (error as Error).message,
        });
        return false;
      }
    },

    async rerunCheck(checkRunId: number): Promise<boolean> {
      try {
        return await client.execute(
          async () => {
            await octokit.checks.rerequestRun({
              owner,
              repo,
              check_run_id: checkRunId,
            });

            log.info(`Re-requested check run ${checkRunId}`);
            return true;
          },
          `POST /repos/${owner}/${repo}/check-runs/${checkRunId}/rerequest`,
          { operation: 'rerunCheck', checkRunId }
        );
      } catch (error: any) {
        log.error('Failed to re-run check', {
          checkRunId,
          error: error.message,
        });
        return false;
      }
    },

    async rerunFailedChecks(ref: string): Promise<number> {
      try {
        const checkRuns = await this.getCheckRuns(ref);
        const failedRuns = checkRuns.filter(
          run => run.status === 'completed' && run.conclusion !== 'success'
        );

        let rerunCount = 0;
        for (const run of failedRuns) {
          const success = await this.rerunCheck(run.id);
          if (success) {
            rerunCount++;
          }
        }

        log.info(`Re-ran ${rerunCount} failed checks for ${ref}`, {
          totalFailed: failedRuns.length,
          rerunCount,
        });

        return rerunCount;
      } catch (error) {
        log.error('Failed to re-run failed checks', {
          ref,
          error: (error as Error).message,
        });
        return 0;
      }
    },
  };
}
