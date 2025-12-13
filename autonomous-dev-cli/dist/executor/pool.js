import { Worker } from './worker.js';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import * as os from 'os';
/** Default retry strategy configuration */
export const DEFAULT_RETRY_STRATEGY = {
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 60000,
    backoffMultiplier: 2,
    jitterEnabled: true,
    jitterFactor: 0.25,
    enableWorkerRetry: true,
};
/** Priority weights for sorting tasks */
const PRIORITY_WEIGHTS = {
    critical: 100,
    high: 75,
    medium: 50,
    low: 25,
};
/** Category-based priority adjustments */
const CATEGORY_PRIORITY_BOOST = {
    security: 30,
    bugfix: 20,
    feature: 0,
    refactor: -5,
    docs: -10,
    test: -5,
    chore: -15,
};
/** Timeout multipliers based on complexity */
const COMPLEXITY_TIMEOUT_MULTIPLIER = {
    simple: 0.5,
    moderate: 1.0,
    complex: 2.0,
};
export class WorkerPool {
    options;
    activeWorkers = new Map();
    taskQueue = [];
    retryQueue = []; // Queue for tasks waiting for retry
    results = [];
    isRunning = false;
    workerIdCounter = 0;
    repository;
    scalingConfig;
    retryStrategy;
    currentWorkerLimit;
    scaleCheckInterval = null;
    retryCheckInterval = null;
    workerTaskMap = new Map(); // Maps worker ID to assigned task
    taskGroupWorkers = new Map(); // Maps group ID to preferred worker ID
    /** Default scaling configuration */
    static DEFAULT_SCALING_CONFIG = {
        minWorkers: 1,
        maxWorkers: 10,
        cpuThresholdHigh: 80,
        cpuThresholdLow: 40,
        memoryThresholdHigh: 85,
        memoryThresholdLow: 50,
        scaleCheckIntervalMs: 10000,
    };
    constructor(options) {
        this.options = options;
        this.repository = this.extractRepoName(options.repoUrl);
        // Initialize scaling configuration
        this.scalingConfig = {
            ...WorkerPool.DEFAULT_SCALING_CONFIG,
            maxWorkers: options.maxWorkers,
            ...options.scalingConfig,
        };
        // Initialize retry strategy configuration
        this.retryStrategy = {
            ...DEFAULT_RETRY_STRATEGY,
            ...options.retryStrategy,
        };
        // Compute initial worker limit based on system resources
        this.currentWorkerLimit = this.computeOptimalWorkerCount();
        logger.info(`Worker pool initialized`, {
            maxWorkers: options.maxWorkers,
            initialWorkerLimit: this.currentWorkerLimit,
            enableDynamicScaling: options.enableDynamicScaling ?? false,
            retryStrategy: {
                maxRetries: this.retryStrategy.maxRetries,
                baseDelayMs: this.retryStrategy.baseDelayMs,
                maxDelayMs: this.retryStrategy.maxDelayMs,
                jitterEnabled: this.retryStrategy.jitterEnabled,
            },
            repository: this.repository,
        });
        // Initialize worker pool metrics
        metrics.updateWorkerPoolStatus(0, 0);
    }
    /**
     * Extract repository name from URL for metrics labeling
     */
    extractRepoName(repoUrl) {
        const match = repoUrl.match(/github\.com[\/:]([^\/]+\/[^\/]+?)(?:\.git)?$/);
        return match ? match[1] : repoUrl;
    }
    /**
     * Update worker pool metrics
     */
    updateMetrics() {
        metrics.updateWorkerPoolStatus(this.activeWorkers.size, this.taskQueue.length);
    }
    /**
     * Get current system resource utilization
     */
    getSystemResources() {
        const cpuCores = os.cpus().length;
        const totalMemoryMB = Math.round(os.totalmem() / (1024 * 1024));
        const freeMemoryMB = Math.round(os.freemem() / (1024 * 1024));
        const memoryUsagePercent = Math.round(((totalMemoryMB - freeMemoryMB) / totalMemoryMB) * 100);
        // Calculate CPU usage from load average (1 minute)
        const loadAvg = os.loadavg()[0];
        const cpuUsagePercent = Math.round((loadAvg / cpuCores) * 100);
        return {
            cpuCores,
            cpuUsagePercent,
            freeMemoryMB,
            totalMemoryMB,
            memoryUsagePercent,
        };
    }
    /**
     * Compute optimal worker count based on system resources
     */
    computeOptimalWorkerCount() {
        const resources = this.getSystemResources();
        const { minWorkers, maxWorkers, cpuThresholdHigh, cpuThresholdLow, memoryThresholdHigh, memoryThresholdLow } = this.scalingConfig;
        // Start with CPU-based scaling
        let targetWorkers;
        if (resources.cpuUsagePercent >= cpuThresholdHigh || resources.memoryUsagePercent >= memoryThresholdHigh) {
            // High resource usage - use minimum workers
            targetWorkers = minWorkers;
        }
        else if (resources.cpuUsagePercent <= cpuThresholdLow && resources.memoryUsagePercent <= memoryThresholdLow) {
            // Low resource usage - can use more workers
            // Scale based on available CPU cores, but cap at maxWorkers
            targetWorkers = Math.min(resources.cpuCores, maxWorkers);
        }
        else {
            // Medium resource usage - scale proportionally
            const cpuFactor = 1 - (resources.cpuUsagePercent - cpuThresholdLow) / (cpuThresholdHigh - cpuThresholdLow);
            const memFactor = 1 - (resources.memoryUsagePercent - memoryThresholdLow) / (memoryThresholdHigh - memoryThresholdLow);
            const scaleFactor = Math.min(cpuFactor, memFactor);
            targetWorkers = Math.round(minWorkers + (maxWorkers - minWorkers) * scaleFactor);
        }
        // Clamp to valid range
        return Math.max(minWorkers, Math.min(maxWorkers, targetWorkers));
    }
    /**
     * Start dynamic scaling monitor
     */
    startScalingMonitor() {
        if (!this.options.enableDynamicScaling || this.scaleCheckInterval) {
            return;
        }
        this.scaleCheckInterval = setInterval(() => {
            const newLimit = this.computeOptimalWorkerCount();
            if (newLimit !== this.currentWorkerLimit) {
                const oldLimit = this.currentWorkerLimit;
                this.currentWorkerLimit = newLimit;
                logger.info(`Dynamic scaling: worker limit changed ${oldLimit} -> ${newLimit}`, {
                    resources: this.getSystemResources(),
                    activeWorkers: this.activeWorkers.size,
                    queuedTasks: this.taskQueue.length,
                });
                // If we can add more workers and have tasks, start them
                if (newLimit > oldLimit) {
                    while (this.activeWorkers.size < this.currentWorkerLimit && this.taskQueue.length > 0 && this.isRunning) {
                        this.startNextTask();
                    }
                }
            }
        }, this.scalingConfig.scaleCheckIntervalMs);
    }
    /**
     * Stop dynamic scaling monitor
     */
    stopScalingMonitor() {
        if (this.scaleCheckInterval) {
            clearInterval(this.scaleCheckInterval);
            this.scaleCheckInterval = null;
        }
    }
    /**
     * Calculate exponential backoff delay with optional jitter
     * Formula: delay = baseDelay * (multiplier ^ retryCount) + jitter
     */
    calculateRetryDelay(retryCount) {
        const { baseDelayMs, maxDelayMs, backoffMultiplier, jitterEnabled, jitterFactor } = this.retryStrategy;
        // Calculate base exponential delay
        const exponentialDelay = baseDelayMs * Math.pow(backoffMultiplier, retryCount);
        // Apply jitter if enabled (prevents thundering herd)
        let delay = exponentialDelay;
        if (jitterEnabled) {
            // Jitter adds/subtracts up to jitterFactor of the delay
            const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1);
            delay = exponentialDelay + jitter;
        }
        // Cap at maximum delay
        return Math.min(Math.max(0, Math.round(delay)), maxDelayMs);
    }
    /**
     * Determine if a task failure is retryable based on error type
     */
    isRetryableError(error) {
        const errorLower = error.toLowerCase();
        // Network-related transient errors are retryable
        const retryablePatterns = [
            'network',
            'timeout',
            'connection',
            'etimedout',
            'enotfound',
            'econnreset',
            'econnrefused',
            'rate limit',
            'rate_limit',
            'too many requests',
            '429',
            '500',
            '502',
            '503',
            '504',
            'service unavailable',
            'temporarily unavailable',
            'circuit breaker',
            'circuit_breaker_open',
        ];
        // Non-retryable errors (permanent failures)
        const nonRetryablePatterns = [
            'auth',
            'unauthorized',
            'forbidden',
            '401',
            '403',
            'permission denied',
            'invalid token',
            'not found',
            '404',
            'validation',
            'invalid request',
        ];
        // Check for non-retryable patterns first
        if (nonRetryablePatterns.some(pattern => errorLower.includes(pattern))) {
            return false;
        }
        // Check for retryable patterns
        return retryablePatterns.some(pattern => errorLower.includes(pattern));
    }
    /**
     * Schedule a failed task for retry with exponential backoff
     */
    scheduleRetry(task, error) {
        if (!this.retryStrategy.enableWorkerRetry) {
            logger.debug(`Retry disabled for task ${task.id}`, { error });
            return false;
        }
        const currentRetryCount = task.retryCount ?? 0;
        if (currentRetryCount >= this.retryStrategy.maxRetries) {
            logger.warn(`Task ${task.id} exceeded max retries (${this.retryStrategy.maxRetries})`, {
                taskId: task.id,
                issueNumber: task.issue.number,
                totalRetries: currentRetryCount,
                lastError: error,
            });
            return false;
        }
        if (!this.isRetryableError(error)) {
            logger.info(`Task ${task.id} failed with non-retryable error`, {
                taskId: task.id,
                issueNumber: task.issue.number,
                error,
            });
            return false;
        }
        // Calculate retry delay
        const delay = this.calculateRetryDelay(currentRetryCount);
        const nextRetryTime = Date.now() + delay;
        // Update task retry state
        task.retryCount = currentRetryCount + 1;
        task.lastError = error;
        task.nextRetryTime = nextRetryTime;
        // Add to retry queue
        this.retryQueue.push(task);
        logger.warn(`Scheduling retry for task ${task.id}`, {
            taskId: task.id,
            issueNumber: task.issue.number,
            retryCount: task.retryCount,
            maxRetries: this.retryStrategy.maxRetries,
            delayMs: delay,
            nextRetryTime: new Date(nextRetryTime).toISOString(),
            error,
            backoffFormula: `${this.retryStrategy.baseDelayMs} * ${this.retryStrategy.backoffMultiplier}^${currentRetryCount}`,
        });
        return true;
    }
    /**
     * Check and process tasks ready for retry
     */
    processRetryQueue() {
        const now = Date.now();
        const readyTasks = [];
        const stillWaiting = [];
        for (const task of this.retryQueue) {
            if (task.nextRetryTime && task.nextRetryTime <= now) {
                readyTasks.push(task);
            }
            else {
                stillWaiting.push(task);
            }
        }
        this.retryQueue = stillWaiting;
        // Add ready tasks back to the main queue
        for (const task of readyTasks) {
            logger.info(`Task ${task.id} ready for retry (attempt ${task.retryCount}/${this.retryStrategy.maxRetries})`, {
                taskId: task.id,
                issueNumber: task.issue.number,
                retryCount: task.retryCount,
                lastError: task.lastError,
            });
            // Re-add to task queue (with current retry state)
            this.taskQueue.push(task);
        }
        // Re-sort queue if tasks were added
        if (readyTasks.length > 0) {
            this.sortTaskQueue();
            this.updateMetrics();
        }
    }
    /**
     * Start retry queue monitor
     */
    startRetryMonitor() {
        if (this.retryCheckInterval) {
            return;
        }
        // Check retry queue every second
        this.retryCheckInterval = setInterval(() => {
            if (this.retryQueue.length > 0) {
                this.processRetryQueue();
                // Start workers for newly available tasks
                while (this.activeWorkers.size < this.currentWorkerLimit &&
                    this.taskQueue.length > 0 &&
                    this.isRunning) {
                    this.startNextTask();
                }
            }
        }, 1000);
    }
    /**
     * Stop retry queue monitor
     */
    stopRetryMonitor() {
        if (this.retryCheckInterval) {
            clearInterval(this.retryCheckInterval);
            this.retryCheckInterval = null;
        }
    }
    /**
     * Calculate priority score for a task
     */
    calculatePriorityScore(task) {
        const metadata = task.metadata;
        if (!metadata) {
            return PRIORITY_WEIGHTS.medium; // Default priority
        }
        let score = PRIORITY_WEIGHTS[metadata.priority ?? 'medium'];
        // Apply category boost
        if (metadata.category) {
            score += CATEGORY_PRIORITY_BOOST[metadata.category] ?? 0;
        }
        // Boost complexity-adjusted tasks (simple tasks get slight boost for quick wins)
        if (metadata.complexity === 'simple') {
            score += 5;
        }
        else if (metadata.complexity === 'complex') {
            score -= 5;
        }
        return score;
    }
    /**
     * Generate a group ID for a task based on affected paths
     */
    generateGroupId(task) {
        const paths = task.metadata?.affectedPaths;
        if (!paths || paths.length === 0) {
            return undefined;
        }
        // Find common directory prefix from affected paths
        const directories = paths.map(p => {
            // Extract directory from path (handle both file paths and directory paths)
            const parts = p.split('/');
            // Remove filename if present (has extension or is a known file pattern)
            if (parts.length > 1 && (parts[parts.length - 1].includes('.') || !parts[parts.length - 1])) {
                parts.pop();
            }
            return parts.slice(0, 2).join('/'); // Use first two path components
        });
        // Use the most common directory as group ID
        const dirCounts = new Map();
        for (const dir of directories) {
            dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
        }
        // Return the most common directory, or undefined if no clear winner
        let maxCount = 0;
        let groupDir;
        for (const [dir, count] of dirCounts) {
            if (count > maxCount && dir.length > 0) {
                maxCount = count;
                groupDir = dir;
            }
        }
        return groupDir ? `group:${groupDir}` : undefined;
    }
    /**
     * Sort task queue by priority (highest first)
     */
    sortTaskQueue() {
        this.taskQueue.sort((a, b) => {
            const scoreA = a.priorityScore ?? this.calculatePriorityScore(a);
            const scoreB = b.priorityScore ?? this.calculatePriorityScore(b);
            return scoreB - scoreA; // Higher score = higher priority
        });
    }
    /**
     * Select the next task, preferring tasks from the same group as a worker
     */
    selectNextTask(preferredGroupId) {
        if (this.taskQueue.length === 0) {
            return undefined;
        }
        // If we have a preferred group, try to find a task from that group
        if (preferredGroupId) {
            const groupTaskIndex = this.taskQueue.findIndex(t => t.groupId === preferredGroupId);
            if (groupTaskIndex !== -1) {
                return this.taskQueue.splice(groupTaskIndex, 1)[0];
            }
        }
        // Otherwise, take the highest priority task
        return this.taskQueue.shift();
    }
    /**
     * Get task-specific timeout based on complexity
     */
    getTaskTimeout(task) {
        const baseTimeout = this.options.timeoutMinutes * 60 * 1000;
        const complexity = task.metadata?.complexity ?? 'moderate';
        const multiplier = COMPLEXITY_TIMEOUT_MULTIPLIER[complexity];
        return Math.round(baseTimeout * multiplier);
    }
    async executeTasks(tasks) {
        this.isRunning = true;
        this.results = [];
        this.retryQueue = []; // Reset retry queue
        this.workerTaskMap.clear();
        this.taskGroupWorkers.clear();
        // Convert tasks to PoolTasks with metadata enrichment
        this.taskQueue = tasks.map((task, index) => {
            const poolTask = {
                ...task,
                id: `task-${index + 1}`,
                metadata: this.extractTaskMetadata(task),
                retryCount: 0, // Initialize retry count
            };
            // Calculate priority score and group ID
            poolTask.priorityScore = this.calculatePriorityScore(poolTask);
            poolTask.groupId = this.generateGroupId(poolTask);
            return poolTask;
        });
        // Sort by priority (highest first)
        this.sortTaskQueue();
        // Get effective worker limit based on current resources
        const effectiveWorkerLimit = Math.min(this.currentWorkerLimit, this.options.maxWorkers);
        logger.info(`Executing ${tasks.length} tasks with up to ${effectiveWorkerLimit} workers`, {
            taskCount: tasks.length,
            maxWorkers: this.options.maxWorkers,
            effectiveWorkerLimit,
            enableDynamicScaling: this.options.enableDynamicScaling ?? false,
            retryStrategy: this.retryStrategy.enableWorkerRetry ? {
                maxRetries: this.retryStrategy.maxRetries,
                baseDelayMs: this.retryStrategy.baseDelayMs,
                maxDelayMs: this.retryStrategy.maxDelayMs,
                jitterEnabled: this.retryStrategy.jitterEnabled,
            } : 'disabled',
            systemResources: this.getSystemResources(),
        });
        // Update initial metrics
        this.updateMetrics();
        // Start dynamic scaling monitor if enabled
        this.startScalingMonitor();
        // Start retry queue monitor for progressive retry strategy
        this.startRetryMonitor();
        // Start initial workers
        while (this.activeWorkers.size < effectiveWorkerLimit && this.taskQueue.length > 0) {
            this.startNextTask();
        }
        // Wait for all tasks to complete (including retry queue)
        while (this.activeWorkers.size > 0 || this.taskQueue.length > 0 || this.retryQueue.length > 0) {
            if (this.activeWorkers.size > 0) {
                // Wait for any worker to complete
                const completedPromises = Array.from(this.activeWorkers.entries());
                const [completedId] = await Promise.race(completedPromises.map(async ([id, promise]) => {
                    await promise;
                    return [id];
                }));
                // Get the completed task's group for worker affinity
                const completedTask = this.workerTaskMap.get(completedId);
                const completedGroupId = completedTask?.groupId;
                // Clean up worker tracking
                this.activeWorkers.delete(completedId);
                this.workerTaskMap.delete(completedId);
                // Update metrics after worker completion
                this.updateMetrics();
                // Start next task if available
                if (this.taskQueue.length > 0 && this.isRunning) {
                    // Use worker affinity: try to assign same-group tasks to same worker
                    this.startNextTask(completedGroupId);
                }
            }
            else if (this.retryQueue.length > 0) {
                // No active workers but tasks waiting for retry - wait a bit
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        // Stop monitors
        this.stopScalingMonitor();
        this.stopRetryMonitor();
        const succeeded = this.results.filter(r => r.success).length;
        const failed = this.results.filter(r => !r.success).length;
        const retriedTasks = this.results.filter(r => r.retryCount && r.retryCount > 0);
        logger.info(`All tasks completed: ${succeeded}/${this.results.length} succeeded`, {
            succeeded,
            failed,
            total: this.results.length,
            tasksRetried: retriedTasks.length,
        });
        // Reset pool metrics
        metrics.updateWorkerPoolStatus(0, 0);
        return this.results;
    }
    /**
     * Extract task metadata from issue labels and body
     */
    extractTaskMetadata(task) {
        const metadata = {};
        const issue = task.issue;
        // Extract priority from labels (priority:high, priority:medium, etc.)
        const priorityLabel = issue.labels.find(l => l.startsWith('priority:'));
        if (priorityLabel) {
            const priority = priorityLabel.replace('priority:', '');
            if (['critical', 'high', 'medium', 'low'].includes(priority)) {
                metadata.priority = priority;
            }
        }
        // Extract category from labels (type:bugfix, type:feature, etc.)
        const typeLabel = issue.labels.find(l => l.startsWith('type:'));
        if (typeLabel) {
            const category = typeLabel.replace('type:', '');
            if (['security', 'bugfix', 'feature', 'refactor', 'docs', 'test', 'chore'].includes(category)) {
                metadata.category = category;
            }
        }
        // Extract complexity from labels (complexity:simple, complexity:moderate, etc.)
        const complexityLabel = issue.labels.find(l => l.startsWith('complexity:'));
        if (complexityLabel) {
            const complexity = complexityLabel.replace('complexity:', '');
            if (['simple', 'moderate', 'complex'].includes(complexity)) {
                metadata.complexity = complexity;
            }
        }
        // Extract affected paths from issue body
        if (issue.body) {
            const pathsMatch = issue.body.match(/## Affected Paths\s*([\s\S]*?)(?=\n##|---|\n\n\n|$)/);
            if (pathsMatch) {
                const pathsSection = pathsMatch[1];
                const paths = pathsSection.match(/`([^`]+)`/g);
                if (paths) {
                    metadata.affectedPaths = paths.map(p => p.replace(/`/g, ''));
                }
            }
        }
        return metadata;
    }
    startNextTask(preferredGroupId) {
        // Select task with group affinity preference
        const task = this.selectNextTask(preferredGroupId);
        if (!task)
            return;
        const workerId = `worker-${++this.workerIdCounter}`;
        const isRetry = (task.retryCount ?? 0) > 0;
        // Track worker-task relationship for group affinity
        this.workerTaskMap.set(task.id, task);
        // Track group-worker relationship for future task assignment
        if (task.groupId) {
            this.taskGroupWorkers.set(task.groupId, workerId);
        }
        // Calculate task-specific timeout
        const taskTimeoutMs = this.getTaskTimeout(task);
        const taskTimeoutMinutes = Math.round(taskTimeoutMs / 60000);
        logger.info(`${isRetry ? 'Retrying' : 'Starting'} ${task.id} with ${workerId}: ${task.issue.title}`, {
            taskId: task.id,
            workerId,
            issueNumber: task.issue.number,
            priority: task.metadata?.priority ?? 'medium',
            category: task.metadata?.category ?? 'unknown',
            complexity: task.metadata?.complexity ?? 'moderate',
            priorityScore: task.priorityScore,
            groupId: task.groupId,
            timeoutMinutes: taskTimeoutMinutes,
            retryCount: task.retryCount ?? 0,
            isRetry,
            lastError: isRetry ? task.lastError : undefined,
        });
        // Update metrics after task is dequeued
        this.updateMetrics();
        const worker = new Worker({
            workDir: this.options.workDir,
            repoUrl: this.options.repoUrl,
            baseBranch: this.options.baseBranch,
            githubToken: this.options.githubToken,
            claudeAuth: this.options.claudeAuth,
            timeoutMinutes: taskTimeoutMinutes, // Use task-specific timeout
            // Database logging options
            userId: this.options.userId,
            repoOwner: this.options.repoOwner,
            repoName: this.options.repoName,
            enableDatabaseLogging: this.options.enableDatabaseLogging,
        }, workerId);
        const promise = worker.execute(task).then((result) => {
            if (result.success) {
                // Task succeeded - add to results
                this.results.push({
                    ...result,
                    taskId: task.id,
                });
                logger.success(`${task.id} completed: ${task.issue.title}`, {
                    retryCount: task.retryCount ?? 0,
                });
                logger.debug(`Task completion details`, {
                    taskId: task.id,
                    priority: task.metadata?.priority,
                    groupId: task.groupId,
                    duration: result.duration,
                    retryCount: task.retryCount ?? 0,
                    wasRetried: isRetry,
                });
            }
            else {
                // Task failed - attempt retry if eligible
                const errorMessage = result.error ?? 'Unknown error';
                const scheduled = this.scheduleRetry(task, errorMessage);
                if (!scheduled) {
                    // No retry possible - add failure to results
                    this.results.push({
                        ...result,
                        taskId: task.id,
                    });
                    logger.failure(`${task.id} failed (no retry): ${errorMessage}`, {
                        retryCount: task.retryCount ?? 0,
                        maxRetries: this.retryStrategy.maxRetries,
                    });
                }
                logger.debug(`Task failure details`, {
                    taskId: task.id,
                    priority: task.metadata?.priority,
                    groupId: task.groupId,
                    duration: result.duration,
                    error: errorMessage,
                    retryScheduled: scheduled,
                    retryCount: task.retryCount ?? 0,
                });
            }
            return result;
        });
        this.activeWorkers.set(task.id, promise);
    }
    stop() {
        this.isRunning = false;
        this.stopScalingMonitor();
        this.stopRetryMonitor();
        logger.warn('Worker pool stop requested', {
            activeWorkers: this.activeWorkers.size,
            queuedTasks: this.taskQueue.length,
            pendingRetries: this.retryQueue.length,
        });
    }
    getStatus() {
        const groupIds = new Set(this.taskQueue.map(t => t.groupId).filter(Boolean));
        return {
            active: this.activeWorkers.size,
            queued: this.taskQueue.length,
            pendingRetries: this.retryQueue.length,
            completed: this.results.length,
            succeeded: this.results.filter((r) => r.success).length,
            failed: this.results.filter((r) => !r.success).length,
            currentWorkerLimit: this.currentWorkerLimit,
            systemResources: this.getSystemResources(),
            taskGroups: groupIds.size,
            retryStrategy: this.retryStrategy,
        };
    }
    /**
     * Get the current scaling configuration
     */
    getScalingConfig() {
        return { ...this.scalingConfig };
    }
    /**
     * Get the current retry strategy configuration
     */
    getRetryStrategy() {
        return { ...this.retryStrategy };
    }
    /**
     * Update retry strategy configuration at runtime
     */
    updateRetryStrategy(config) {
        this.retryStrategy = { ...this.retryStrategy, ...config };
        logger.info('Retry strategy configuration updated', {
            config: this.retryStrategy,
        });
    }
    /**
     * Update scaling configuration at runtime
     */
    updateScalingConfig(config) {
        this.scalingConfig = { ...this.scalingConfig, ...config };
        // Recompute worker limit with new config
        this.currentWorkerLimit = this.computeOptimalWorkerCount();
        logger.info('Scaling configuration updated', {
            config: this.scalingConfig,
            newWorkerLimit: this.currentWorkerLimit,
        });
    }
}
export function createWorkerPool(options) {
    return new WorkerPool(options);
}
//# sourceMappingURL=pool.js.map