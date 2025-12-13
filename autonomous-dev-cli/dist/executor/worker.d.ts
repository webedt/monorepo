import { type CircuitBreakerConfig } from '../utils/circuit-breaker.js';
import { type RetryAttempt } from '../utils/dead-letter-queue.js';
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
    userId?: string;
    repoOwner?: string;
    repoName?: string;
    enableDatabaseLogging?: boolean;
    sparseCheckout?: {
        enabled: boolean;
        paths?: string[];
    };
    useShallowClone?: boolean;
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
    retryConfig?: {
        /** Max retries for transient failures (default: 3) */
        maxRetries?: number;
        /** Enable dead letter queue for failed tasks (default: true) */
        enableDeadLetterQueue?: boolean;
        /** Enable progressive timeout increases (default: true) */
        progressiveTimeout?: boolean;
    };
}
/**
 * Retry state preserved across retry attempts
 */
export interface WorkerRetryState {
    taskId: string;
    issueNumber: number;
    branchName: string;
    retryCount: number;
    maxRetries: number;
    firstAttemptAt: Date;
    lastAttemptAt: Date;
    attemptHistory: RetryAttempt[];
    totalElapsedMs: number;
    currentTimeoutMs: number;
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
export declare class Worker {
    private options;
    private workerId;
    private log;
    private repository;
    private circuitBreaker;
    constructor(options: WorkerOptions, workerId: string);
    /**
     * Get the circuit breaker health status
     */
    getCircuitBreakerHealth(): import("../utils/circuit-breaker.js").CircuitBreakerHealth;
    /**
     * Extract repository name from URL for metrics labeling
     */
    private extractRepoName;
    /**
     * Get error context for debugging
     */
    private getErrorContext;
    /**
     * Wrap an error with execution context
     */
    private wrapExecutionError;
    execute(task: WorkerTask): Promise<WorkerResult>;
    private setupWorkspace;
    private cleanupWorkspace;
    private cloneRepo;
    private createBranch;
    private writeClaudeCredentials;
    private executeWithClaude;
    private sanitizeToolInput;
    private buildPrompt;
    private hasChanges;
    private commitAndPush;
}
//# sourceMappingURL=worker.d.ts.map