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
export interface TaskGeneratorOptions {
    claudeAuth: {
        accessToken: string;
        refreshToken: string;
    };
    repoPath: string;
    excludePaths: string[];
    tasksPerCycle: number;
    existingIssues: Issue[];
    repoContext?: string;
    analyzerConfig?: AnalyzerConfig;
    circuitBreakerConfig?: Partial<CircuitBreakerConfig>;
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
    constructor(options: TaskGeneratorOptions);
    /**
     * Get the circuit breaker health status
     */
    getCircuitBreakerHealth(): import("../utils/circuit-breaker.js").CircuitBreakerHealth;
    generateTasks(): Promise<DiscoveredTask[]>;
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
//# sourceMappingURL=generator.d.ts.map