import { type CircuitBreakerConfig } from '../utils/circuit-breaker.js';
import { type RetryAttempt } from '../utils/dead-letter-queue.js';
import { type Issue } from '../github/issues.js';
/**
 * Configuration for Claude execution error recovery
 */
export interface ClaudeRetryConfig {
    /** Maximum number of retry attempts (default: 3) */
    maxRetries: number;
    /** Base delay in milliseconds for exponential backoff (default: 2000) */
    baseDelayMs: number;
    /** Maximum delay in milliseconds (default: 8000) */
    maxDelayMs: number;
    /** Backoff multiplier (default: 2) */
    backoffMultiplier: number;
    /** Timeout in milliseconds for each attempt (default: 5 minutes) */
    timeoutMs: number;
}
/**
 * Result of Claude execution with validation details
 */
export interface ClaudeExecutionResult {
    success: boolean;
    toolUseCount: number;
    turnCount: number;
    durationMs: number;
    hasChanges: boolean;
    validationIssues: string[];
    error?: {
        code: string;
        message: string;
        isRetryable: boolean;
    };
}
/**
 * Validation result for Claude response
 */
export interface ResponseValidation {
    isValid: boolean;
    hasChanges: boolean;
    issues: string[];
    severity: 'none' | 'warning' | 'error';
}
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
    claudeRetryConfig?: Partial<ClaudeRetryConfig>;
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
    private claudeRetryConfig;
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
    /**
     * Execute task with Claude Agent SDK with retry mechanism and error recovery.
     * Implements:
     * - Exponential backoff retry (3 attempts with 2s, 4s, 8s delays)
     * - Timeout handling with 5-minute limit
     * - Conversation history logging for debugging
     * - Response validation to detect incomplete implementations
     */
    private executeWithClaude;
    /**
     * Execute a single Claude attempt with timeout handling
     */
    private executeSingleClaudeAttempt;
    /**
     * Validate Claude response to detect incomplete implementations
     */
    private validateClaudeResponse;
    /**
     * Handle retry delay with exponential backoff
     */
    private handleRetryDelay;
    /**
     * Extract error code from an error
     */
    private extractErrorCode;
    /**
     * Determine if a Claude error is retryable
     */
    private isClaudeErrorRetryable;
    private sanitizeToolInput;
    private buildPrompt;
    private hasChanges;
    private commitAndPush;
}
//# sourceMappingURL=worker.d.ts.map