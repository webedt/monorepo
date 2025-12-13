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
import { logger } from '../utils/logger.js';
import { createGitHubErrorFromResponse, } from '../utils/errors.js';
/**
 * Map Octokit status to our StatusCheck interface
 */
function mapStatus(data) {
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
function mapCheckRun(data) {
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
export function createChecksManager(client) {
    const octokit = client.client;
    const { owner, repo } = client;
    const log = logger.child('ChecksManager');
    /**
     * Handle and transform errors
     */
    const handleError = (error, operation, context) => {
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
    const createDefaultCombinedStatus = (ref) => ({
        state: 'pending',
        totalCount: 0,
        statuses: [],
        sha: ref,
        commitUrl: `https://github.com/${owner}/${repo}/commit/${ref}`,
    });
    return {
        getServiceHealth() {
            return client.getServiceHealth();
        },
        isAvailable() {
            return client.isAvailable();
        },
        async getCombinedStatus(ref) {
            try {
                return await client.execute(async () => {
                    const { data } = await octokit.repos.getCombinedStatusForRef({
                        owner,
                        repo,
                        ref,
                    });
                    return {
                        state: data.state,
                        totalCount: data.total_count,
                        statuses: data.statuses.map(mapStatus),
                        sha: data.sha,
                        commitUrl: data.commit_url,
                    };
                }, `GET /repos/${owner}/${repo}/commits/${ref}/status`, { operation: 'getCombinedStatus', ref });
            }
            catch (error) {
                return handleError(error, 'get combined status', { ref });
            }
        },
        async getCombinedStatusWithFallback(ref, fallback) {
            const defaultFallback = fallback ?? createDefaultCombinedStatus(ref);
            const result = await client.executeWithFallback(async () => {
                const { data } = await octokit.repos.getCombinedStatusForRef({
                    owner,
                    repo,
                    ref,
                });
                return {
                    state: data.state,
                    totalCount: data.total_count,
                    statuses: data.statuses.map(mapStatus),
                    sha: data.sha,
                    commitUrl: data.commit_url,
                };
            }, defaultFallback, `GET /repos/${owner}/${repo}/commits/${ref}/status`, { operation: 'getCombinedStatus', ref });
            if (result.degraded) {
                log.warn('Combined status fetch degraded - using fallback', { ref });
            }
            return result;
        },
        async getCheckRuns(ref) {
            try {
                return await client.execute(async () => {
                    const { data } = await octokit.checks.listForRef({
                        owner,
                        repo,
                        ref,
                        per_page: 100,
                    });
                    return data.check_runs.map(mapCheckRun);
                }, `GET /repos/${owner}/${repo}/commits/${ref}/check-runs`, { operation: 'getCheckRuns', ref });
            }
            catch (error) {
                return handleError(error, 'get check runs', { ref });
            }
        },
        async getCheckRunsWithFallback(ref, fallback = []) {
            const result = await client.executeWithFallback(async () => {
                const { data } = await octokit.checks.listForRef({
                    owner,
                    repo,
                    ref,
                    per_page: 100,
                });
                return data.check_runs.map(mapCheckRun);
            }, fallback, `GET /repos/${owner}/${repo}/commits/${ref}/check-runs`, { operation: 'getCheckRuns', ref });
            if (result.degraded) {
                log.warn('Check runs fetch degraded - using fallback', {
                    ref,
                    fallbackCount: fallback.length,
                });
            }
            return result;
        },
        async getCheckRun(checkRunId) {
            try {
                return await client.execute(async () => {
                    const { data } = await octokit.checks.get({
                        owner,
                        repo,
                        check_run_id: checkRunId,
                    });
                    return mapCheckRun(data);
                }, `GET /repos/${owner}/${repo}/check-runs/${checkRunId}`, { operation: 'getCheckRun', checkRunId });
            }
            catch (error) {
                if (error.status === 404) {
                    return null;
                }
                return handleError(error, 'get check run', { checkRunId });
            }
        },
        async getCheckSuites(ref) {
            try {
                return await client.execute(async () => {
                    const { data } = await octokit.checks.listSuitesForRef({
                        owner,
                        repo,
                        ref,
                    });
                    const suites = [];
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
                            status: suite.status,
                            conclusion: suite.conclusion,
                            checkRuns: runsData.check_runs.map(mapCheckRun),
                        });
                    }
                    return suites;
                }, `GET /repos/${owner}/${repo}/commits/${ref}/check-suites`, { operation: 'getCheckSuites', ref });
            }
            catch (error) {
                return handleError(error, 'get check suites', { ref });
            }
        },
        async createStatus(ref, status) {
            try {
                return await client.execute(async () => {
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
                }, `POST /repos/${owner}/${repo}/statuses/${ref}`, { operation: 'createStatus', ref, context: status.context, state: status.state });
            }
            catch (error) {
                return handleError(error, 'create status', { ref, status });
            }
        },
        async waitForChecks(ref, options = {}) {
            const { maxWaitMs = 600000, // 10 minutes default
            pollIntervalMs = 10000, // 10 seconds default
            requiredChecks = [], failFast = false, } = options;
            const startTime = Date.now();
            const result = {
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
                    const statusContexts = new Map();
                    for (const status of combinedStatus.statuses) {
                        statusContexts.set(status.context, status.state);
                    }
                    for (const run of checkRuns) {
                        const state = run.status === 'completed'
                            ? (run.conclusion === 'success' ? 'success' : 'failure')
                            : 'pending';
                        statusContexts.set(run.name, state);
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
                        }
                        else if (state === 'failure' || state === 'error') {
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
                }
                catch (error) {
                    // Log but continue waiting on transient errors
                    log.warn(`Error checking status for ${ref}, will retry`, {
                        error: error.message,
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
        async areRequiredChecksPassing(ref, requiredChecks = []) {
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
                        const allRunsSuccessful = checkRuns.every(run => run.status === 'completed' && run.conclusion === 'success');
                        return allRunsSuccessful || checkRuns.length === 0;
                    }
                    return false;
                }
                // Check specific required checks
                const statusMap = new Map();
                for (const status of combinedStatus.statuses) {
                    statusMap.set(status.context, status.state === 'success');
                }
                for (const run of checkRuns) {
                    statusMap.set(run.name, run.status === 'completed' && run.conclusion === 'success');
                }
                return requiredChecks.every(check => statusMap.get(check) === true);
            }
            catch (error) {
                log.error('Failed to check required checks status', {
                    ref,
                    requiredChecks,
                    error: error.message,
                });
                return false;
            }
        },
        async rerunCheck(checkRunId) {
            try {
                return await client.execute(async () => {
                    await octokit.checks.rerequestRun({
                        owner,
                        repo,
                        check_run_id: checkRunId,
                    });
                    log.info(`Re-requested check run ${checkRunId}`);
                    return true;
                }, `POST /repos/${owner}/${repo}/check-runs/${checkRunId}/rerequest`, { operation: 'rerunCheck', checkRunId });
            }
            catch (error) {
                log.error('Failed to re-run check', {
                    checkRunId,
                    error: error.message,
                });
                return false;
            }
        },
        async rerunFailedChecks(ref) {
            try {
                const checkRuns = await this.getCheckRuns(ref);
                const failedRuns = checkRuns.filter(run => run.status === 'completed' && run.conclusion !== 'success');
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
            }
            catch (error) {
                log.error('Failed to re-run failed checks', {
                    ref,
                    error: error.message,
                });
                return 0;
            }
        },
    };
}
//# sourceMappingURL=checks.js.map