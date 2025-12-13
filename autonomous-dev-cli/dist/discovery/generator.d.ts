import { type AnalyzerConfig } from './analyzer.js';
import { type Issue } from '../github/issues.js';
import { type CircuitBreakerConfig } from '../utils/circuit-breaker.js';
/** Task priority levels aligned with worker pool prioritization */
export type DiscoveredTaskPriority = 'critical' | 'high' | 'medium' | 'low';
/** Task category for classification - aligned with worker pool */
export type DiscoveredTaskCategory = 'security' | 'bugfix' | 'feature' | 'refactor' | 'docs' | 'test' | 'chore';
/** Task complexity - affects timeout and resource allocation */
export type DiscoveredTaskComplexity = 'simple' | 'moderate' | 'complex';
export interface DiscoveredTask {
    title: string;
    description: string;
    priority: DiscoveredTaskPriority;
    category: DiscoveredTaskCategory;
    estimatedComplexity: DiscoveredTaskComplexity;
    affectedPaths: string[];
    /** Optional estimated duration in minutes for better scheduling */
    estimatedDurationMinutes?: number;
    /** Related issue numbers for dependency awareness (populated by deduplicator) */
    relatedIssues?: number[];
}
/**
 * Token refresh callback type for Claude authentication
 */
export type TokenRefreshCallback = (refreshToken: string) => Promise<{
    accessToken: string;
    refreshToken: string;
    expiresAt?: number;
}>;
export interface TaskGeneratorOptions {
    claudeAuth: {
        accessToken: string;
        refreshToken: string;
        expiresAt?: number;
    };
    repoPath: string;
    excludePaths: string[];
    tasksPerCycle: number;
    existingIssues: Issue[];
    repoContext?: string;
    analyzerConfig?: AnalyzerConfig;
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
    /** Enable fallback task generation when Claude fails (default: true) */
    enableFallbackGeneration?: boolean;
    /** Callback to refresh Claude tokens on 401/403 auth failures */
    onTokenRefresh?: TokenRefreshCallback;
}
/**
 * Result of task generation with status information
 */
export interface TaskGenerationResult {
    tasks: DiscoveredTask[];
    success: boolean;
    usedFallback: boolean;
    error?: {
        code: string;
        message: string;
        isRetryable: boolean;
    };
    duration: number;
}
export declare class TaskGenerator {
    private claudeAuth;
    private repoPath;
    private excludePaths;
    private tasksPerCycle;
    private existingIssues;
    private repoContext;
    private analyzerConfig;
    private circuitBreaker;
    private enableFallbackGeneration;
    private onTokenRefresh?;
    private tokenRefreshAttempted;
    constructor(options: TaskGeneratorOptions);
    /**
     * Attempt to refresh Claude tokens when authentication fails.
     * Returns true if refresh was successful, false otherwise.
     */
    private attemptTokenRefresh;
    /**
     * Reset the token refresh attempt flag for a new request cycle.
     */
    resetTokenRefreshState(): void;
    /**
     * Check if tokens are about to expire and proactively refresh.
     * Returns true if tokens are valid or were successfully refreshed.
     */
    validateAndRefreshTokensIfNeeded(): Promise<boolean>;
    /**
     * Get the circuit breaker health status
     */
    getCircuitBreakerHealth(): import("../utils/circuit-breaker.js").CircuitBreakerHealth;
    generateTasks(): Promise<DiscoveredTask[]>;
    /**
     * Generate tasks with detailed result information including fallback status
     */
    generateTasksWithFallback(): Promise<TaskGenerationResult>;
    /**
     * Generate fallback tasks from codebase analysis when Claude is unavailable.
     * Creates basic tasks from TODO comments, FIXME items, and other signals.
     */
    private generateFallbackTasks;
    private buildPrompt;
    private callClaude;
    /**
     * Create a structured error from Claude API response
     */
    private createApiError;
    /**
     * Parse and validate Claude response JSON
     */
    private parseClaudeResponse;
}
export declare function discoverTasks(options: TaskGeneratorOptions): Promise<DiscoveredTask[]>;
/**
 * Discover tasks with detailed result including fallback status
 */
export declare function discoverTasksWithFallback(options: TaskGeneratorOptions): Promise<TaskGenerationResult>;
//# sourceMappingURL=generator.d.ts.map