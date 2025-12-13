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
 * Create a checks manager instance
 */
export declare function createChecksManager(client: GitHubClient): ChecksManager;
//# sourceMappingURL=checks.d.ts.map