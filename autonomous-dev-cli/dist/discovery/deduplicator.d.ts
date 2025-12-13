/**
 * Smart task deduplication and conflict detection for worker assignments.
 *
 * Implements:
 * - Semantic similarity matching comparing affected file paths and task titles
 * - Conflict prediction for tasks modifying critical files
 * - Task queuing strategy prioritizing non-overlapping work
 * - Related issues tracking for dependency awareness
 */
import { type Issue } from '../github/issues.js';
import { type DiscoveredTask } from './generator.js';
/**
 * Result of similarity analysis between two tasks
 */
export interface SimilarityResult {
    /** Overall similarity score (0-1) */
    score: number;
    /** Title similarity score (0-1) */
    titleSimilarity: number;
    /** File path overlap score (0-1) */
    pathOverlap: number;
    /** Whether tasks share critical files */
    sharesCriticalFiles: boolean;
    /** List of overlapping paths */
    overlappingPaths: string[];
    /** List of critical files both tasks touch */
    criticalFilesInCommon: string[];
}
/**
 * Result of conflict prediction for a task
 */
export interface ConflictPrediction {
    /** Whether the task is likely to cause conflicts */
    hasHighConflictRisk: boolean;
    /** Conflict risk score (0-1) */
    riskScore: number;
    /** Reason for the conflict risk assessment */
    reasons: string[];
    /** Issues that may conflict with this task */
    conflictingIssues: number[];
    /** Critical files this task modifies */
    criticalFilesModified: string[];
}
/**
 * Extended task with deduplication metadata
 */
export interface DeduplicatedTask extends DiscoveredTask {
    /** Related issue numbers for dependency awareness */
    relatedIssues: number[];
    /** Similarity score to most similar existing issue (0-1) */
    maxSimilarityScore: number;
    /** Whether this task was flagged as a potential duplicate */
    isPotentialDuplicate: boolean;
    /** Conflict prediction result */
    conflictPrediction: ConflictPrediction;
    /** Suggested execution order (lower = higher priority for independent work) */
    executionPriority: number;
}
/**
 * Options for the task deduplicator
 */
export interface DeduplicatorOptions {
    /** Similarity threshold for flagging duplicates (default: 0.7) */
    similarityThreshold?: number;
    /** Additional critical files to consider */
    additionalCriticalFiles?: string[];
    /** Additional critical directories to consider */
    additionalCriticalDirectories?: string[];
    /** Whether to include closed issues in similarity matching */
    includeClosedIssues?: boolean;
}
/**
 * Task deduplicator for intelligent task management
 */
export declare class TaskDeduplicator {
    private similarityThreshold;
    private criticalFiles;
    private criticalDirectories;
    constructor(options?: DeduplicatorOptions);
    /**
     * Process discovered tasks through deduplication and conflict detection
     */
    deduplicateTasks(tasks: DiscoveredTask[], existingIssues: Issue[]): Promise<DeduplicatedTask[]>;
    /**
     * Filter out tasks that are likely duplicates
     */
    filterDuplicates(tasks: DeduplicatedTask[]): DeduplicatedTask[];
    /**
     * Get tasks ordered by conflict safety (non-overlapping work first)
     */
    getConflictSafeOrder(tasks: DeduplicatedTask[]): DeduplicatedTask[];
    /**
     * Calculate similarity between two tasks
     */
    calculateTaskSimilarity(task1: DiscoveredTask, task2: DiscoveredTask): SimilarityResult;
    /**
     * Calculate similarity between a task and an issue
     */
    calculateTaskIssueSimilarity(task: DiscoveredTask, issue: Issue): SimilarityResult;
    /**
     * Predict conflict risk for a task given existing issues
     */
    predictConflict(task: DiscoveredTask, existingIssues: Issue[], issuePathMap: Map<number, string[]>): ConflictPrediction;
    /**
     * Process a single task through deduplication
     */
    private processTask;
    /**
     * Build a map of issue numbers to their affected paths
     */
    private buildIssuePathMap;
    /**
     * Extract file paths from an issue body
     */
    private extractPathsFromIssue;
    /**
     * Check if a string looks like a file path
     */
    private looksLikePath;
    /**
     * Normalize a file path for comparison
     */
    private normalizePath;
    /**
     * Calculate title similarity using Jaccard similarity on words
     */
    private calculateTitleSimilarity;
    /**
     * Tokenize a string into a set of normalized words
     */
    private tokenize;
    /**
     * Calculate path overlap between two sets of paths
     */
    private calculatePathOverlap;
    /**
     * Find critical files that both path sets touch
     */
    private findCriticalFilesInCommon;
    /**
     * Check if a path is a critical file
     */
    private isCriticalFile;
    /**
     * Check if a path is in a critical directory
     */
    private isInCriticalDirectory;
}
/**
 * Create a task deduplicator instance
 */
export declare function createDeduplicator(options?: DeduplicatorOptions): TaskDeduplicator;
/**
 * Quick utility to check if a task list has potential conflicts
 */
export declare function hasConflictingTasks(tasks: DeduplicatedTask[]): boolean;
/**
 * Get tasks that are safe to run in parallel (low conflict risk)
 */
export declare function getParallelSafeTasks(tasks: DeduplicatedTask[]): DeduplicatedTask[];
/**
 * Group tasks by their conflict relationships for sequential execution
 */
export declare function groupTasksByConflict(tasks: DeduplicatedTask[]): DeduplicatedTask[][];
//# sourceMappingURL=deduplicator.d.ts.map