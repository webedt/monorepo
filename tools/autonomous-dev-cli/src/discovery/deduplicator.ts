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
import { logger, getCorrelationId } from '../utils/logger.js';

/** Similarity threshold for flagging tasks as duplicates (0-1) */
const DEFAULT_SIMILARITY_THRESHOLD = 0.7;

/** Files that are considered high-risk for conflicts */
const CRITICAL_FILES = [
  'src/index.ts',
  'src/index.js',
  'package.json',
  'tsconfig.json',
  '.eslintrc',
  '.eslintrc.js',
  '.eslintrc.json',
  'jest.config.js',
  'jest.config.ts',
  'vite.config.ts',
  'webpack.config.js',
  'rollup.config.js',
  '.env',
  '.env.example',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
];

/** Directory patterns that are high-risk for conflicts */
const CRITICAL_DIRECTORIES = [
  'src/config',
  'src/types',
  'src/utils',
  'config/',
  'configs/',
];

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
export class TaskDeduplicator {
  private similarityThreshold: number;
  private criticalFiles: Set<string>;
  private criticalDirectories: string[];

  constructor(options: DeduplicatorOptions = {}) {
    this.similarityThreshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;

    this.criticalFiles = new Set([
      ...CRITICAL_FILES,
      ...(options.additionalCriticalFiles ?? []),
    ]);

    this.criticalDirectories = [
      ...CRITICAL_DIRECTORIES,
      ...(options.additionalCriticalDirectories ?? []),
    ];
  }

  /**
   * Process discovered tasks through deduplication and conflict detection
   */
  async deduplicateTasks(
    tasks: DiscoveredTask[],
    existingIssues: Issue[]
  ): Promise<DeduplicatedTask[]> {
    const correlationId = getCorrelationId();

    logger.info('Starting task deduplication', {
      correlationId,
      taskCount: tasks.length,
      existingIssueCount: existingIssues.length,
    });

    const deduplicatedTasks: DeduplicatedTask[] = [];
    const issuePathMap = this.buildIssuePathMap(existingIssues);

    for (const task of tasks) {
      const deduplicatedTask = this.processTask(task, existingIssues, issuePathMap, deduplicatedTasks);
      deduplicatedTasks.push(deduplicatedTask);
    }

    // Sort by execution priority (lower = process first)
    deduplicatedTasks.sort((a, b) => a.executionPriority - b.executionPriority);

    // Log deduplication summary
    const duplicates = deduplicatedTasks.filter(t => t.isPotentialDuplicate);
    const highRisk = deduplicatedTasks.filter(t => t.conflictPrediction.hasHighConflictRisk);

    logger.info('Task deduplication complete', {
      correlationId,
      totalTasks: tasks.length,
      potentialDuplicates: duplicates.length,
      highConflictRiskTasks: highRisk.length,
    });

    return deduplicatedTasks;
  }

  /**
   * Filter out tasks that are likely duplicates
   */
  filterDuplicates(tasks: DeduplicatedTask[]): DeduplicatedTask[] {
    return tasks.filter(t => !t.isPotentialDuplicate);
  }

  /**
   * Get tasks ordered by conflict safety (non-overlapping work first)
   */
  getConflictSafeOrder(tasks: DeduplicatedTask[]): DeduplicatedTask[] {
    return [...tasks].sort((a, b) => {
      // First, prioritize tasks without high conflict risk
      if (a.conflictPrediction.hasHighConflictRisk !== b.conflictPrediction.hasHighConflictRisk) {
        return a.conflictPrediction.hasHighConflictRisk ? 1 : -1;
      }
      // Then by risk score
      if (a.conflictPrediction.riskScore !== b.conflictPrediction.riskScore) {
        return a.conflictPrediction.riskScore - b.conflictPrediction.riskScore;
      }
      // Finally by execution priority
      return a.executionPriority - b.executionPriority;
    });
  }

  /**
   * Calculate similarity between two tasks
   */
  calculateTaskSimilarity(task1: DiscoveredTask, task2: DiscoveredTask): SimilarityResult {
    const titleSimilarity = this.calculateTitleSimilarity(task1.title, task2.title);
    const { overlap: pathOverlap, overlappingPaths } = this.calculatePathOverlap(
      task1.affectedPaths,
      task2.affectedPaths
    );

    const criticalFilesInCommon = this.findCriticalFilesInCommon(
      task1.affectedPaths,
      task2.affectedPaths
    );
    const sharesCriticalFiles = criticalFilesInCommon.length > 0;

    // Calculate overall score with weights
    // Path overlap is weighted higher as it's a stronger indicator of conflict
    const score = (
      titleSimilarity * 0.3 +
      pathOverlap * 0.5 +
      (sharesCriticalFiles ? 0.2 : 0)
    );

    return {
      score,
      titleSimilarity,
      pathOverlap,
      sharesCriticalFiles,
      overlappingPaths,
      criticalFilesInCommon,
    };
  }

  /**
   * Calculate similarity between a task and an issue
   */
  calculateTaskIssueSimilarity(task: DiscoveredTask, issue: Issue): SimilarityResult {
    const issuePaths = this.extractPathsFromIssue(issue);

    const titleSimilarity = this.calculateTitleSimilarity(task.title, issue.title);
    const { overlap: pathOverlap, overlappingPaths } = this.calculatePathOverlap(
      task.affectedPaths,
      issuePaths
    );

    const criticalFilesInCommon = this.findCriticalFilesInCommon(
      task.affectedPaths,
      issuePaths
    );
    const sharesCriticalFiles = criticalFilesInCommon.length > 0;

    const score = (
      titleSimilarity * 0.3 +
      pathOverlap * 0.5 +
      (sharesCriticalFiles ? 0.2 : 0)
    );

    return {
      score,
      titleSimilarity,
      pathOverlap,
      sharesCriticalFiles,
      overlappingPaths,
      criticalFilesInCommon,
    };
  }

  /**
   * Predict conflict risk for a task given existing issues
   */
  predictConflict(
    task: DiscoveredTask,
    existingIssues: Issue[],
    issuePathMap: Map<number, string[]>
  ): ConflictPrediction {
    const reasons: string[] = [];
    const conflictingIssues: number[] = [];
    const criticalFilesModified: string[] = [];
    let riskScore = 0;

    // Check for critical files
    for (const path of task.affectedPaths) {
      const normalizedPath = this.normalizePath(path);

      // Check if path is a critical file
      if (this.isCriticalFile(normalizedPath)) {
        criticalFilesModified.push(normalizedPath);
        riskScore += 0.3;
        reasons.push(`Modifies critical file: ${normalizedPath}`);
      }

      // Check if path is in a critical directory
      if (this.isInCriticalDirectory(normalizedPath)) {
        riskScore += 0.15;
        if (!reasons.some(r => r.includes('critical directory'))) {
          reasons.push(`Modifies files in critical directory`);
        }
      }
    }

    // Check for overlapping work with existing issues
    for (const issue of existingIssues) {
      const issuePaths = issuePathMap.get(issue.number) ?? [];
      const similarity = this.calculateTaskIssueSimilarity(task, issue);

      if (similarity.score >= this.similarityThreshold * 0.8) {
        conflictingIssues.push(issue.number);
        riskScore += 0.2;

        if (similarity.sharesCriticalFiles) {
          reasons.push(`Overlaps with issue #${issue.number} on critical files`);
        } else if (similarity.overlappingPaths.length > 0) {
          reasons.push(`Shares ${similarity.overlappingPaths.length} paths with issue #${issue.number}`);
        }
      }
    }

    // Cap risk score at 1.0
    riskScore = Math.min(riskScore, 1.0);
    const hasHighConflictRisk = riskScore >= 0.5 || criticalFilesModified.length >= 2;

    return {
      hasHighConflictRisk,
      riskScore,
      reasons,
      conflictingIssues,
      criticalFilesModified,
    };
  }

  /**
   * Process a single task through deduplication
   */
  private processTask(
    task: DiscoveredTask,
    existingIssues: Issue[],
    issuePathMap: Map<number, string[]>,
    processedTasks: DeduplicatedTask[]
  ): DeduplicatedTask {
    const relatedIssues: number[] = [];
    let maxSimilarityScore = 0;
    let isPotentialDuplicate = false;

    // Compare with existing issues
    for (const issue of existingIssues) {
      const similarity = this.calculateTaskIssueSimilarity(task, issue);

      if (similarity.score > maxSimilarityScore) {
        maxSimilarityScore = similarity.score;
      }

      // Track related issues (similarity > 40%)
      if (similarity.score >= 0.4) {
        relatedIssues.push(issue.number);
      }

      // Flag as duplicate if above threshold
      if (similarity.score >= this.similarityThreshold) {
        isPotentialDuplicate = true;
        logger.debug('Task flagged as potential duplicate', {
          taskTitle: task.title,
          similarIssue: issue.number,
          similarityScore: similarity.score,
        });
      }
    }

    // Compare with other tasks being processed
    for (const processedTask of processedTasks) {
      const similarity = this.calculateTaskSimilarity(task, processedTask);

      if (similarity.score > maxSimilarityScore) {
        maxSimilarityScore = similarity.score;
      }

      if (similarity.score >= this.similarityThreshold) {
        isPotentialDuplicate = true;
        logger.debug('Task flagged as duplicate of another new task', {
          taskTitle: task.title,
          duplicateOf: processedTask.title,
          similarityScore: similarity.score,
        });
      }
    }

    // Predict conflicts
    const conflictPrediction = this.predictConflict(task, existingIssues, issuePathMap);

    // Calculate execution priority
    // Lower is better - prioritize independent, non-conflicting work
    let executionPriority = 50; // Base priority

    // Penalize high conflict risk
    if (conflictPrediction.hasHighConflictRisk) {
      executionPriority += 30;
    }
    executionPriority += conflictPrediction.riskScore * 20;

    // Penalize potential duplicates heavily
    if (isPotentialDuplicate) {
      executionPriority += 50;
    }

    // Bonus for simple, independent tasks
    if (task.estimatedComplexity === 'simple' && relatedIssues.length === 0) {
      executionPriority -= 20;
    }

    // Priority boost based on task priority
    const priorityBoost: Record<string, number> = {
      critical: -30,
      high: -15,
      medium: 0,
      low: 10,
    };
    executionPriority += priorityBoost[task.priority] ?? 0;

    return {
      ...task,
      relatedIssues,
      maxSimilarityScore,
      isPotentialDuplicate,
      conflictPrediction,
      executionPriority,
    };
  }

  /**
   * Build a map of issue numbers to their affected paths
   */
  private buildIssuePathMap(issues: Issue[]): Map<number, string[]> {
    const map = new Map<number, string[]>();

    for (const issue of issues) {
      const paths = this.extractPathsFromIssue(issue);
      map.set(issue.number, paths);
    }

    return map;
  }

  /**
   * Extract file paths from an issue body
   */
  private extractPathsFromIssue(issue: Issue): string[] {
    if (!issue.body) return [];

    const paths: string[] = [];
    const body = issue.body;

    // Match paths in code blocks (backticks)
    const codeBlockMatches = body.match(/`([^`]+)`/g);
    if (codeBlockMatches) {
      for (const match of codeBlockMatches) {
        const path = match.slice(1, -1); // Remove backticks
        if (this.looksLikePath(path)) {
          paths.push(this.normalizePath(path));
        }
      }
    }

    // Match paths in affected paths section
    const affectedPathsSection = body.match(/## Affected Paths\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (affectedPathsSection) {
      const lines = affectedPathsSection[1].split('\n');
      for (const line of lines) {
        const pathMatch = line.match(/[-*]\s*`?([^`\n]+)`?/);
        if (pathMatch && this.looksLikePath(pathMatch[1])) {
          paths.push(this.normalizePath(pathMatch[1].trim()));
        }
      }
    }

    // Deduplicate
    return Array.from(new Set(paths));
  }

  /**
   * Check if a string looks like a file path
   */
  private looksLikePath(str: string): boolean {
    // Must contain at least one slash or dot
    if (!str.includes('/') && !str.includes('.')) return false;

    // Should not be a URL
    if (str.startsWith('http://') || str.startsWith('https://')) return false;

    // Should not be too long (likely not a path)
    if (str.length > 200) return false;

    // Should match common path patterns
    const pathPattern = /^[a-zA-Z0-9_./-]+$/;
    return pathPattern.test(str);
  }

  /**
   * Normalize a file path for comparison
   */
  private normalizePath(path: string): string {
    return path
      .replace(/^\.\//, '')      // Remove leading ./
      .replace(/\/+/g, '/')      // Normalize multiple slashes
      .replace(/\/$/, '')        // Remove trailing slash
      .toLowerCase();
  }

  /**
   * Calculate title similarity using Jaccard similarity on words
   */
  private calculateTitleSimilarity(title1: string, title2: string): number {
    const words1 = this.tokenize(title1);
    const words2 = this.tokenize(title2);

    if (words1.size === 0 && words2.size === 0) return 1;
    if (words1.size === 0 || words2.size === 0) return 0;

    const words1Array = Array.from(words1);
    const words2Array = Array.from(words2);
    const intersection = new Set(words1Array.filter(w => words2.has(w)));
    const union = new Set([...words1Array, ...words2Array]);

    return intersection.size / union.size;
  }

  /**
   * Tokenize a string into a set of normalized words
   */
  private tokenize(text: string): Set<string> {
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
      'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought',
      'used', 'add', 'update', 'fix', 'implement', 'create', 'remove', 'delete',
    ]);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    return new Set(words);
  }

  /**
   * Calculate path overlap between two sets of paths
   */
  private calculatePathOverlap(
    paths1: string[],
    paths2: string[]
  ): { overlap: number; overlappingPaths: string[] } {
    const normalized1 = paths1.map(p => this.normalizePath(p));
    const normalized2 = paths2.map(p => this.normalizePath(p));

    if (normalized1.length === 0 && normalized2.length === 0) {
      return { overlap: 0, overlappingPaths: [] };
    }

    const overlappingPaths: string[] = [];

    for (const path1 of normalized1) {
      for (const path2 of normalized2) {
        // Exact match
        if (path1 === path2) {
          overlappingPaths.push(path1);
          continue;
        }

        // Directory containment (one contains the other)
        if (path1.startsWith(path2 + '/') || path2.startsWith(path1 + '/')) {
          overlappingPaths.push(path1.length < path2.length ? path1 : path2);
        }
      }
    }

    // Calculate Jaccard-like overlap
    const uniqueOverlapping = Array.from(new Set(overlappingPaths));
    const allPaths = new Set(normalized1.concat(normalized2));

    const overlap = allPaths.size > 0
      ? uniqueOverlapping.length / allPaths.size
      : 0;

    return { overlap, overlappingPaths: uniqueOverlapping };
  }

  /**
   * Find critical files that both path sets touch
   */
  private findCriticalFilesInCommon(paths1: string[], paths2: string[]): string[] {
    const critical1 = paths1
      .map(p => this.normalizePath(p))
      .filter(p => this.isCriticalFile(p) || this.isInCriticalDirectory(p));

    const critical2 = paths2
      .map(p => this.normalizePath(p))
      .filter(p => this.isCriticalFile(p) || this.isInCriticalDirectory(p));

    const common: string[] = [];

    for (const path1 of critical1) {
      for (const path2 of critical2) {
        if (path1 === path2) {
          common.push(path1);
        } else if (path1.startsWith(path2 + '/') || path2.startsWith(path1 + '/')) {
          common.push(path1.length < path2.length ? path1 : path2);
        }
      }
    }

    return Array.from(new Set(common));
  }

  /**
   * Check if a path is a critical file
   */
  private isCriticalFile(path: string): boolean {
    const normalized = this.normalizePath(path);

    // Check exact matches
    if (this.criticalFiles.has(normalized)) {
      return true;
    }

    // Check if file name matches any critical file
    const fileName = normalized.split('/').pop() ?? '';
    return this.criticalFiles.has(fileName);
  }

  /**
   * Check if a path is in a critical directory
   */
  private isInCriticalDirectory(path: string): boolean {
    const normalized = this.normalizePath(path);

    for (const dir of this.criticalDirectories) {
      const normalizedDir = this.normalizePath(dir);
      if (normalized.startsWith(normalizedDir) || normalized.includes('/' + normalizedDir)) {
        return true;
      }
    }

    return false;
  }
}

/**
 * Create a task deduplicator instance
 */
export function createDeduplicator(options?: DeduplicatorOptions): TaskDeduplicator {
  return new TaskDeduplicator(options);
}

/**
 * Quick utility to check if a task list has potential conflicts
 */
export function hasConflictingTasks(tasks: DeduplicatedTask[]): boolean {
  return tasks.some(t => t.conflictPrediction.hasHighConflictRisk);
}

/**
 * Get tasks that are safe to run in parallel (low conflict risk)
 */
export function getParallelSafeTasks(tasks: DeduplicatedTask[]): DeduplicatedTask[] {
  return tasks.filter(t => !t.conflictPrediction.hasHighConflictRisk && !t.isPotentialDuplicate);
}

/**
 * Group tasks by their conflict relationships for sequential execution
 */
export function groupTasksByConflict(tasks: DeduplicatedTask[]): DeduplicatedTask[][] {
  const groups: DeduplicatedTask[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < tasks.length; i++) {
    if (assigned.has(i)) continue;

    const group: DeduplicatedTask[] = [tasks[i]];
    assigned.add(i);

    // Find all tasks that conflict with this one
    for (let j = i + 1; j < tasks.length; j++) {
      if (assigned.has(j)) continue;

      const task1 = tasks[i];
      const task2 = tasks[j];

      // Check if tasks conflict
      const conflicting1 = task1.conflictPrediction.conflictingIssues;
      const related1 = task1.relatedIssues;
      const related2 = task2.relatedIssues;

      // Tasks are in same group if they share related issues or paths
      const sharesRelated = related1.some(r => related2.includes(r));
      const sharesConflicts = conflicting1.some(c =>
        task2.conflictPrediction.conflictingIssues.includes(c)
      );

      if (sharesRelated || sharesConflicts) {
        group.push(tasks[j]);
        assigned.add(j);
      }
    }

    groups.push(group);
  }

  return groups;
}
