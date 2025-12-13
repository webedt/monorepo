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
 * Progress checkpoint for graceful timeout recovery
 */
export interface ProgressCheckpoint {
    /** Unique checkpoint ID */
    id: string;
    /** Task identifier */
    taskId: string;
    /** Issue number being worked on */
    issueNumber: number;
    /** Branch name */
    branchName: string;
    /** Current execution phase */
    phase: 'setup' | 'clone' | 'branch' | 'claude_execution' | 'validation' | 'commit' | 'push';
    /** Timestamp of checkpoint */
    timestamp: string;
    /** Duration since task start in ms */
    elapsedMs: number;
    /** Number of tools used so far */
    toolsUsed: number;
    /** Number of turns completed */
    turnsCompleted: number;
    /** Whether files have been modified */
    hasChanges: boolean;
    /** List of modified files */
    modifiedFiles: string[];
    /** Any partial output captured */
    partialOutput?: string;
    /** Worker ID */
    workerId: string;
    /** Chat session ID if available */
    chatSessionId?: string;
    /** Memory usage at checkpoint */
    memoryUsageMB: number;
    /** Whether this checkpoint can be resumed */
    canResume: boolean;
    /** Reason if not resumable */
    resumeBlocker?: string;
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
    cycleCorrelationId?: string;
    cycleNumber?: number;
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
    private currentCheckpoint;
    private checkpointDir;
    private taskStartTime;
    private currentPhase;
    private toolsUsedInTask;
    private turnsCompletedInTask;
    private modifiedFilesInTask;
    private partialOutputBuffer;
    constructor(options: WorkerOptions, workerId: string);
    /**
     * Create a progress checkpoint for the current task state.
     * Checkpoints are saved to disk for recovery after timeout termination.
     */
    private createCheckpoint;
    /**
     * Save the current checkpoint to disk
     */
    private saveCheckpoint;
    /**
     * Update the current phase and optionally save checkpoint
     */
    private updatePhase;
    /**
     * Track tool usage for checkpointing
     */
    private recordToolUsage;
    /**
     * Append to partial output buffer
     */
    private appendPartialOutput;
    /**
     * Determine if the current state can be resumed
     */
    private determineCanResume;
    /**
     * Get the reason why task cannot be resumed
     */
    private getResumeBlocker;
    /**
     * Load a checkpoint from disk
     */
    loadCheckpoint(checkpointId: string): ProgressCheckpoint | null;
    /**
     * Get all checkpoints for a specific issue
     */
    getCheckpointsForIssue(issueNumber: number): ProgressCheckpoint[];
    /**
     * Clean up old checkpoints for an issue after successful completion
     */
    private cleanupCheckpoints;
    /**
     * Reset task state for a new task
     */
    private resetTaskState;
    /**
     * Handle graceful timeout - save progress before termination
     */
    private handleGracefulTimeout;
    /**
     * Get the circuit breaker health status
     */
    getCircuitBreakerHealth(): import("../utils/circuit-breaker.js").CircuitBreakerHealth;
    /**
     * Extract repository name from URL for metrics labeling
     */
    private extractRepoName;
    /**
     * Get enhanced error context with execution state for debugging
     */
    private getErrorContext;
    /**
     * Wrap an error with execution context using typed executor errors.
     * Classifies the error based on its characteristics and returns
     * an appropriate typed error with recovery strategy.
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
     * Extract error code from an error using type-based classification.
     * Classifies errors based on their type hierarchy rather than string matching.
     */
    private extractErrorCode;
    /**
     * Determine if a Claude error is retryable using type-based classification.
     * Uses recovery strategy from typed errors when available.
     */
    private isClaudeErrorRetryable;
    private sanitizeToolInput;
    private buildPrompt;
    private hasChanges;
    private commitAndPush;
}
//# sourceMappingURL=worker.d.ts.map