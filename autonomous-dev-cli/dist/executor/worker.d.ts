import { type CircuitBreakerConfig } from '../utils/circuit-breaker.js';
import { type Issue } from '../github/issues.js';
/** Retry strategy configuration for worker operations */
export interface WorkerRetryConfig {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterEnabled: boolean;
    jitterFactor: number;
}
/** Default retry configuration for worker operations */
export declare const DEFAULT_WORKER_RETRY_CONFIG: WorkerRetryConfig;
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
    retryConfig?: Partial<WorkerRetryConfig>;
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
    private retryConfig;
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
     * Convert worker retry config to extended retry config format
     */
    private getExtendedRetryConfig;
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