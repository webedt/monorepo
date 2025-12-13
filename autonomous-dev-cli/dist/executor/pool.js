import { Worker } from './worker.js';
import { logger, getMemoryUsageMB } from '../utils/logger.js';
import { getProgressManager, formatDuration, ETACalculator, } from '../utils/progress.js';
import { metrics } from '../utils/metrics.js';
import { getDeadLetterQueue, } from '../utils/dead-letter-queue.js';
import { getAllCircuitBreakerHealth, } from '../utils/circuit-breaker.js';
import { ExecutorError, getErrorAggregator, } from '../errors/executor-errors.js';
import * as os from 'os';
import { EventEmitter } from 'events';
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
export class WorkerPool extends EventEmitter {
    options;
    activeWorkers = new Map();
    taskQueue = [];
    results = [];
    isRunning = false;
    isShuttingDown = false;
    workerIdCounter = 0;
    repository;
    scalingConfig;
    queueConfig;
    currentWorkerLimit;
    scaleCheckInterval = null;
    workerTaskMap = new Map(); // Maps worker ID to assigned task
    taskGroupWorkers = new Map(); // Maps group ID to preferred worker ID
    // Execution history for audit trail
    executionHistory = [];
    maxHistoryEntries = 1000;
    // Queue overflow tracking
    overflowEvents = [];
    // Progress tracking
    progressManager;
    taskETACalculator = new ETACalculator();
    executionStartTime = 0;
    // Graceful degradation state
    degradationStatus = {
        isDegraded: false,
        affectedServices: [],
        circuitBreakers: {},
        recoveryActions: [],
    };
    degradationCheckInterval = null;
    consecutiveFailures = 0;
    failureThreshold = 5; // Number of consecutive failures before degradation
    // Event-based worker completion tracking (replaces Promise.race pattern)
    completionQueue = [];
    completionResolver = null;
    // Enhanced metrics tracking
    poolStartTime = 0;
    peakConcurrency = 0;
    peakMemoryUsageMB = 0;
    totalTaskDurationMs = 0;
    completedTaskCount = 0;
    failedTaskCount = 0;
    // Memory monitoring
    memoryConfig;
    memoryCheckInterval = null;
    lastMemoryCleanup = 0;
    // Concurrency control
    concurrencyConfig;
    lastScaleUpTime = 0;
    lastScaleDownTime = 0;
    recentSuccessRate = 1.0;
    adaptiveConcurrencyLimit = 0;
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
    /** Default queue configuration */
    static DEFAULT_QUEUE_CONFIG = {
        maxQueueSize: 100,
        overflowStrategy: 'drop-lowest',
        queueWarningThreshold: 80,
        enablePersistence: true,
    };
    /** Default memory configuration */
    static DEFAULT_MEMORY_CONFIG = {
        cleanupThresholdMB: Math.round(os.totalmem() / (1024 * 1024) * 0.8),
        checkIntervalMs: 30000,
        enableAutoCleanup: true,
        forceGC: false,
    };
    /** Default concurrency configuration */
    static DEFAULT_CONCURRENCY_CONFIG = {
        minConcurrency: 1,
        maxConcurrency: os.cpus().length,
        targetConcurrency: Math.max(1, Math.floor(os.cpus().length / 2)),
        scaleUpDelayMs: 5000,
        scaleDownDelayMs: 10000,
        enableAdaptiveConcurrency: true,
        successRateThreshold: 0.7,
    };
    constructor(options) {
        super(); // Initialize EventEmitter
        this.options = options;
        this.repository = this.extractRepoName(options.repoUrl);
        // Initialize progress manager
        this.progressManager = getProgressManager();
        // Initialize scaling configuration
        this.scalingConfig = {
            ...WorkerPool.DEFAULT_SCALING_CONFIG,
            maxWorkers: options.maxWorkers,
            ...options.scalingConfig,
        };
        // Initialize queue configuration
        this.queueConfig = {
            ...WorkerPool.DEFAULT_QUEUE_CONFIG,
            ...options.queueConfig,
        };
        // Initialize memory configuration
        this.memoryConfig = {
            ...WorkerPool.DEFAULT_MEMORY_CONFIG,
        };
        // Compute initial worker limit based on system resources
        this.currentWorkerLimit = this.computeOptimalWorkerCount();
        // Initialize pool start time for metrics
        this.poolStartTime = Date.now();
        logger.info(`Worker pool initialized`, {
            maxWorkers: options.maxWorkers,
            initialWorkerLimit: this.currentWorkerLimit,
            maxQueueSize: this.queueConfig.maxQueueSize,
            overflowStrategy: this.queueConfig.overflowStrategy,
            enableDynamicScaling: options.enableDynamicScaling ?? false,
            enableExecutionHistory: options.enableExecutionHistory ?? false,
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
     * Start memory monitoring for automatic cleanup
     */
    startMemoryMonitor() {
        if (!this.memoryConfig.enableAutoCleanup || this.memoryCheckInterval) {
            return;
        }
        this.memoryCheckInterval = setInterval(() => {
            this.checkMemoryUsage();
        }, this.memoryConfig.checkIntervalMs);
        logger.debug('Memory monitor started', {
            cleanupThresholdMB: this.memoryConfig.cleanupThresholdMB,
            checkIntervalMs: this.memoryConfig.checkIntervalMs,
        });
    }
    /**
     * Stop memory monitoring
     */
    stopMemoryMonitor() {
        if (this.memoryCheckInterval) {
            clearInterval(this.memoryCheckInterval);
            this.memoryCheckInterval = null;
        }
    }
    /**
     * Check memory usage and trigger cleanup if needed
     */
    checkMemoryUsage() {
        const currentMemoryMB = getMemoryUsageMB();
        // Track peak memory usage
        if (currentMemoryMB > this.peakMemoryUsageMB) {
            this.peakMemoryUsageMB = currentMemoryMB;
        }
        // Update metrics
        metrics.updateMemoryUsage(currentMemoryMB);
        if (currentMemoryMB > this.memoryConfig.cleanupThresholdMB) {
            this.performMemoryCleanup(currentMemoryMB);
        }
    }
    /**
     * Perform memory cleanup operations
     */
    performMemoryCleanup(currentMemoryMB) {
        const timeSinceLastCleanup = Date.now() - this.lastMemoryCleanup;
        // Avoid cleanup too frequently (min 10 seconds between cleanups)
        if (timeSinceLastCleanup < 10000) {
            return;
        }
        logger.info('Performing memory cleanup', {
            currentMemoryMB,
            thresholdMB: this.memoryConfig.cleanupThresholdMB,
            activeWorkers: this.activeWorkers.size,
        });
        // Clear old overflow events (keep last 100)
        if (this.overflowEvents.length > 100) {
            this.overflowEvents = this.overflowEvents.slice(-100);
        }
        // Trim execution history if it exceeds limit
        if (this.executionHistory.length > this.maxHistoryEntries) {
            this.executionHistory = this.executionHistory.slice(-this.maxHistoryEntries);
        }
        // Clear completed results if we have too many
        if (this.results.length > 1000) {
            this.results = this.results.slice(-1000);
        }
        // Force garbage collection if enabled and available
        if (this.memoryConfig.forceGC && global.gc) {
            try {
                global.gc();
                logger.debug('Forced garbage collection completed');
            }
            catch (error) {
                logger.warn('Failed to force garbage collection', { error });
            }
        }
        this.lastMemoryCleanup = Date.now();
        const afterCleanupMB = getMemoryUsageMB();
        logger.info('Memory cleanup completed', {
            beforeMB: currentMemoryMB,
            afterMB: afterCleanupMB,
            freedMB: Math.round((currentMemoryMB - afterCleanupMB) * 100) / 100,
        });
    }
    /**
     * Signal that a worker has completed (event-based tracking)
     * This replaces the O(n) Promise.race() pattern with O(1) event-based completion
     */
    signalWorkerCompletion(event) {
        // Emit event for external listeners
        this.emit('workerComplete', event);
        // If there's a pending resolver, resolve immediately (O(1) completion detection)
        if (this.completionResolver) {
            const resolver = this.completionResolver;
            this.completionResolver = null;
            resolver(event);
        }
        else {
            // Queue for later consumption
            this.completionQueue.push(event);
        }
    }
    /**
     * Wait for the next worker completion using event-based tracking
     * This is O(1) complexity compared to O(n) Promise.race()
     */
    waitForWorkerCompletion() {
        // Check if we already have a completed event queued
        if (this.completionQueue.length > 0) {
            return Promise.resolve(this.completionQueue.shift());
        }
        // Wait for the next completion event
        return new Promise((resolve) => {
            this.completionResolver = resolve;
        });
    }
    /**
     * Get comprehensive worker pool metrics
     */
    getPoolMetrics() {
        const currentMemoryMB = getMemoryUsageMB();
        const uptimeMs = Date.now() - this.poolStartTime;
        const totalProcessed = this.completedTaskCount + this.failedTaskCount;
        const avgDuration = totalProcessed > 0 ? this.totalTaskDurationMs / totalProcessed : 0;
        const successRate = totalProcessed > 0 ? (this.completedTaskCount / totalProcessed) * 100 : 0;
        // Calculate tasks per minute
        const uptimeMinutes = uptimeMs / 60000;
        const tasksPerMinute = uptimeMinutes > 0 ? totalProcessed / uptimeMinutes : 0;
        // Calculate utilization
        const utilizationPercent = this.options.maxWorkers > 0
            ? (this.activeWorkers.size / this.options.maxWorkers) * 100
            : 0;
        return {
            activeWorkers: this.activeWorkers.size,
            queuedTasks: this.taskQueue.length,
            completedTasks: this.completedTaskCount,
            failedTasks: this.failedTaskCount,
            totalProcessed,
            successRate: Math.round(successRate * 100) / 100,
            avgTaskDurationMs: Math.round(avgDuration),
            peakConcurrency: this.peakConcurrency,
            memoryUsageMB: Math.round(currentMemoryMB * 100) / 100,
            peakMemoryUsageMB: Math.round(this.peakMemoryUsageMB * 100) / 100,
            currentWorkerLimit: this.currentWorkerLimit,
            maxWorkers: this.options.maxWorkers,
            utilizationPercent: Math.round(utilizationPercent * 100) / 100,
            uptimeMs,
            tasksPerMinute: Math.round(tasksPerMinute * 100) / 100,
        };
    }
    /**
     * Update peak concurrency tracking
     */
    updatePeakConcurrency() {
        if (this.activeWorkers.size > this.peakConcurrency) {
            this.peakConcurrency = this.activeWorkers.size;
            // Also track memory at peak
            const currentMemory = getMemoryUsageMB();
            if (currentMemory > this.peakMemoryUsageMB) {
                this.peakMemoryUsageMB = currentMemory;
            }
        }
    }
    /**
     * Start degradation monitoring
     */
    startDegradationMonitor() {
        if (!this.options.enableGracefulDegradation || this.degradationCheckInterval) {
            return;
        }
        this.degradationCheckInterval = setInterval(() => {
            this.checkDegradationStatus();
        }, 5000); // Check every 5 seconds
    }
    /**
     * Stop degradation monitoring
     */
    stopDegradationMonitor() {
        if (this.degradationCheckInterval) {
            clearInterval(this.degradationCheckInterval);
            this.degradationCheckInterval = null;
        }
    }
    /**
     * Check and update degradation status with error aggregation statistics
     */
    checkDegradationStatus() {
        const circuitBreakers = getAllCircuitBreakerHealth();
        const affectedServices = [];
        const recoveryActions = [];
        // Check circuit breaker states
        for (const [name, health] of Object.entries(circuitBreakers)) {
            this.degradationStatus.circuitBreakers[name] = health;
            if (health.state === 'open') {
                affectedServices.push(name);
                recoveryActions.push(`Wait for ${name} circuit breaker timeout to reset`);
            }
            else if (health.state === 'half_open') {
                affectedServices.push(`${name} (recovering)`);
            }
        }
        // Check consecutive failures
        if (this.consecutiveFailures >= this.failureThreshold) {
            affectedServices.push('worker-execution');
            recoveryActions.push('Check system resources and external service availability');
            recoveryActions.push('Review recent error logs for patterns');
        }
        // Get error aggregation statistics for pattern analysis
        const errorAggregator = getErrorAggregator();
        const recentErrors = errorAggregator.getErrorsInWindow(60000); // Last minute
        const retryStats = errorAggregator.getRetryStats();
        const mostCommon = errorAggregator.getMostCommonErrors(1);
        // Add error-based recovery actions
        if (retryStats.totalNonRetryable > 5) {
            affectedServices.push('error-threshold-exceeded');
            recoveryActions.push('Multiple non-retryable errors detected - review configuration');
        }
        if (mostCommon.length > 0 && mostCommon[0].count > 10) {
            recoveryActions.push(`Most common error: ${mostCommon[0].code} (${mostCommon[0].count} occurrences)`);
        }
        // Update error statistics
        this.degradationStatus.errorStats = {
            totalErrors: recentErrors.length,
            byRecoveryStrategy: retryStats.byStrategy,
            mostCommonErrorCode: mostCommon.length > 0 ? mostCommon[0].code : undefined,
            retriesExhausted: retryStats.totalNonRetryable,
        };
        // Update degradation status
        const wasDegraded = this.degradationStatus.isDegraded;
        this.degradationStatus.isDegraded = affectedServices.length > 0;
        this.degradationStatus.affectedServices = affectedServices;
        this.degradationStatus.recoveryActions = recoveryActions;
        if (this.degradationStatus.isDegraded) {
            this.degradationStatus.reason = `Services affected: ${affectedServices.join(', ')}`;
            if (!wasDegraded) {
                this.degradationStatus.startedAt = new Date();
                logger.warn('Worker pool entering degraded mode', {
                    affectedServices,
                    circuitBreakers,
                    consecutiveFailures: this.consecutiveFailures,
                    errorStats: this.degradationStatus.errorStats,
                });
            }
        }
        else if (wasDegraded) {
            logger.info('Worker pool recovered from degraded mode', {
                recoveryDuration: this.degradationStatus.startedAt
                    ? Date.now() - this.degradationStatus.startedAt.getTime()
                    : 0,
                errorStats: this.degradationStatus.errorStats,
            });
            this.degradationStatus.startedAt = undefined;
            this.degradationStatus.reason = undefined;
        }
    }
    /**
     * Record a task result and update failure tracking
     */
    recordTaskResult(success) {
        if (success) {
            this.consecutiveFailures = 0;
        }
        else {
            this.consecutiveFailures++;
            // Check if we should enter degraded mode
            if (this.consecutiveFailures >= this.failureThreshold) {
                this.checkDegradationStatus();
            }
        }
    }
    /**
     * Get current degradation status
     */
    getDegradationStatus() {
        return { ...this.degradationStatus };
    }
    /**
     * Check if the pool can accept new tasks
     */
    canAcceptTasks() {
        // Don't accept new tasks during shutdown
        if (this.isShuttingDown) {
            return false;
        }
        // Check queue size limit
        if (this.taskQueue.length >= this.queueConfig.maxQueueSize) {
            // In 'pause' strategy, reject new tasks when full
            if (this.queueConfig.overflowStrategy === 'pause') {
                return false;
            }
        }
        // In degraded mode, we can still accept tasks but with reduced capacity
        if (this.degradationStatus.isDegraded) {
            // Only accept if we have workers available and queue isn't critically full
            return this.taskQueue.length < this.queueConfig.maxQueueSize * 0.9;
        }
        return true;
    }
    /**
     * Get current queue utilization percentage
     */
    getQueueUtilization() {
        return (this.taskQueue.length / this.queueConfig.maxQueueSize) * 100;
    }
    /**
     * Check if queue is approaching capacity and emit warning
     */
    checkQueueCapacity() {
        const utilization = this.getQueueUtilization();
        if (utilization >= this.queueConfig.queueWarningThreshold) {
            logger.warn(`Queue approaching capacity: ${utilization.toFixed(1)}%`, {
                currentSize: this.taskQueue.length,
                maxSize: this.queueConfig.maxQueueSize,
                warningThreshold: this.queueConfig.queueWarningThreshold,
            });
        }
    }
    /**
     * Handle queue overflow based on configured strategy
     * @returns true if task was added, false if rejected
     */
    handleQueueOverflow(newTask) {
        if (this.taskQueue.length < this.queueConfig.maxQueueSize) {
            return true; // No overflow, task can be added
        }
        const overflowEvent = {
            timestamp: new Date(),
            queueSize: this.taskQueue.length,
            maxQueueSize: this.queueConfig.maxQueueSize,
            strategy: this.queueConfig.overflowStrategy,
        };
        switch (this.queueConfig.overflowStrategy) {
            case 'reject':
                // Reject the new task
                logger.warn(`Queue full, rejecting task: ${newTask.id}`, {
                    taskId: newTask.id,
                    issueNumber: newTask.issue.number,
                    priority: newTask.metadata?.priority ?? 'medium',
                    queueSize: this.taskQueue.length,
                });
                // Record in execution history as dropped
                this.recordExecutionHistory(newTask, 'dropped');
                this.overflowEvents.push(overflowEvent);
                return false;
            case 'drop-lowest':
                // Find and remove the lowest priority task
                const lowestPriorityIndex = this.findLowestPriorityTaskIndex();
                if (lowestPriorityIndex !== -1) {
                    const droppedTask = this.taskQueue[lowestPriorityIndex];
                    // Only drop if new task has higher priority
                    if ((newTask.priorityScore ?? 0) > (droppedTask.priorityScore ?? 0)) {
                        this.taskQueue.splice(lowestPriorityIndex, 1);
                        logger.warn(`Queue full, dropped lowest priority task: ${droppedTask.id}`, {
                            droppedTaskId: droppedTask.id,
                            droppedPriority: droppedTask.metadata?.priority ?? 'medium',
                            droppedScore: droppedTask.priorityScore,
                            newTaskId: newTask.id,
                            newPriority: newTask.metadata?.priority ?? 'medium',
                            newScore: newTask.priorityScore,
                        });
                        // Record dropped task in history
                        this.recordExecutionHistory(droppedTask, 'dropped');
                        overflowEvent.droppedTaskId = droppedTask.id;
                        overflowEvent.droppedTaskPriority = droppedTask.metadata?.priority;
                        this.overflowEvents.push(overflowEvent);
                        return true;
                    }
                }
                // New task has lower or equal priority, reject it
                logger.warn(`Queue full, new task has lower priority, rejecting: ${newTask.id}`, {
                    taskId: newTask.id,
                    priority: newTask.metadata?.priority ?? 'medium',
                });
                this.recordExecutionHistory(newTask, 'dropped');
                this.overflowEvents.push(overflowEvent);
                return false;
            case 'pause':
                // Should not reach here as canAcceptTasks returns false
                logger.warn(`Queue full in pause mode, rejecting task: ${newTask.id}`);
                this.overflowEvents.push(overflowEvent);
                return false;
            default:
                return false;
        }
    }
    /**
     * Find the index of the lowest priority task in the queue
     */
    findLowestPriorityTaskIndex() {
        if (this.taskQueue.length === 0)
            return -1;
        let lowestIndex = 0;
        let lowestScore = this.taskQueue[0].priorityScore ?? 0;
        for (let i = 1; i < this.taskQueue.length; i++) {
            const score = this.taskQueue[i].priorityScore ?? 0;
            if (score < lowestScore) {
                lowestScore = score;
                lowestIndex = i;
            }
        }
        return lowestIndex;
    }
    /**
     * Record task execution in history for audit trail
     */
    recordExecutionHistory(task, status, workerId, error) {
        if (!this.options.enableExecutionHistory)
            return;
        const existingEntry = this.executionHistory.find(e => e.taskId === task.id);
        if (existingEntry) {
            // Update existing entry
            existingEntry.status = status;
            if (status === 'started') {
                existingEntry.startedAt = new Date();
                existingEntry.workerId = workerId;
            }
            else if (status === 'completed' || status === 'failed') {
                existingEntry.completedAt = new Date();
                if (existingEntry.startedAt) {
                    existingEntry.duration = existingEntry.completedAt.getTime() - existingEntry.startedAt.getTime();
                }
                if (error) {
                    existingEntry.error = error;
                }
            }
            existingEntry.retryCount = task.retryCount ?? 0;
        }
        else {
            // Create new entry
            const entry = {
                taskId: task.id,
                issueNumber: task.issue.number,
                branchName: task.branchName,
                priority: task.metadata?.priority ?? 'medium',
                category: task.metadata?.category,
                status,
                queuedAt: task.queuedAt ?? new Date(),
                retryCount: task.retryCount ?? 0,
                workerId,
                error,
                metadata: {
                    priorityScore: task.priorityScore,
                    groupId: task.groupId,
                    complexity: task.metadata?.complexity,
                },
            };
            if (status === 'started') {
                entry.startedAt = new Date();
            }
            else if (status === 'completed' || status === 'failed') {
                entry.startedAt = new Date();
                entry.completedAt = new Date();
            }
            this.executionHistory.push(entry);
            // Trim history if exceeds max
            if (this.executionHistory.length > this.maxHistoryEntries) {
                this.executionHistory.shift();
            }
        }
    }
    /**
     * Get execution history with optional filtering
     */
    getExecutionHistory(options) {
        let filtered = [...this.executionHistory];
        if (options?.status) {
            filtered = filtered.filter(e => e.status === options.status);
        }
        if (options?.priority) {
            filtered = filtered.filter(e => e.priority === options.priority);
        }
        if (options?.since) {
            filtered = filtered.filter(e => e.queuedAt >= options.since);
        }
        if (options?.limit) {
            filtered = filtered.slice(-options.limit);
        }
        return filtered;
    }
    /**
     * Get execution statistics from history
     */
    getExecutionStats() {
        const stats = {
            total: this.executionHistory.length,
            byStatus: {},
            byPriority: {},
            avgDuration: 0,
            successRate: 0,
            retriesTotal: 0,
        };
        let totalDuration = 0;
        let completedCount = 0;
        let successCount = 0;
        for (const entry of this.executionHistory) {
            // Count by status
            stats.byStatus[entry.status] = (stats.byStatus[entry.status] || 0) + 1;
            // Count by priority
            stats.byPriority[entry.priority] = (stats.byPriority[entry.priority] || 0) + 1;
            // Sum durations
            if (entry.duration) {
                totalDuration += entry.duration;
                completedCount++;
            }
            // Count successes
            if (entry.status === 'completed') {
                successCount++;
            }
            // Sum retries
            stats.retriesTotal += entry.retryCount;
        }
        stats.avgDuration = completedCount > 0 ? totalDuration / completedCount : 0;
        stats.successRate = stats.total > 0 ? (successCount / stats.total) * 100 : 0;
        return stats;
    }
    /**
     * Get queue overflow events
     */
    getOverflowEvents(limit) {
        const events = [...this.overflowEvents];
        return limit ? events.slice(-limit) : events;
    }
    /**
     * Gracefully shutdown the worker pool, preserving queued tasks
     * @param timeoutMs Maximum time to wait for active workers to complete
     * @returns Remaining queued tasks that were not processed
     */
    async gracefulShutdown(timeoutMs = 60000) {
        if (this.isShuttingDown) {
            logger.warn('Graceful shutdown already in progress');
            return [...this.taskQueue];
        }
        this.isShuttingDown = true;
        logger.info('Initiating graceful shutdown of worker pool', {
            activeWorkers: this.activeWorkers.size,
            queuedTasks: this.taskQueue.length,
            timeoutMs,
        });
        // Stop accepting new tasks and all monitors
        this.isRunning = false;
        this.stopScalingMonitor();
        this.stopDegradationMonitor();
        this.stopMemoryMonitor();
        // Wait for active workers to complete (with timeout)
        if (this.activeWorkers.size > 0) {
            const startTime = Date.now();
            const activePromises = Array.from(this.activeWorkers.values());
            try {
                await Promise.race([
                    Promise.all(activePromises),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs)),
                ]);
                logger.info('All active workers completed during graceful shutdown');
            }
            catch (error) {
                const elapsed = Date.now() - startTime;
                logger.warn(`Shutdown timeout reached after ${elapsed}ms, ${this.activeWorkers.size} workers still active`);
            }
        }
        // Persist remaining queue if enabled
        const remainingTasks = [...this.taskQueue];
        if (this.queueConfig.enablePersistence && remainingTasks.length > 0) {
            await this.persistQueuedTasks(remainingTasks);
        }
        // Update history for remaining queued tasks
        for (const task of remainingTasks) {
            this.recordExecutionHistory(task, 'dropped', undefined, {
                code: 'SHUTDOWN',
                message: 'Task dropped due to graceful shutdown',
                isRetryable: true,
            });
        }
        logger.info('Graceful shutdown completed', {
            preservedTasks: remainingTasks.length,
            completedResults: this.results.length,
        });
        this.isShuttingDown = false;
        return remainingTasks;
    }
    /**
     * Persist queued tasks to disk for recovery
     */
    async persistQueuedTasks(tasks) {
        try {
            const { writeFileSync, existsSync, mkdirSync } = await import('fs');
            const { join } = await import('path');
            const persistDir = join(this.options.workDir, 'queue-persist');
            if (!existsSync(persistDir)) {
                mkdirSync(persistDir, { recursive: true });
            }
            const persistPath = join(persistDir, `queue-${Date.now()}.json`);
            const persistData = tasks.map(task => ({
                id: task.id,
                issue: task.issue,
                branchName: task.branchName,
                metadata: task.metadata,
                priorityScore: task.priorityScore,
                groupId: task.groupId,
                queuedAt: task.queuedAt?.toISOString(),
                retryCount: task.retryCount,
            }));
            writeFileSync(persistPath, JSON.stringify(persistData, null, 2));
            logger.info(`Persisted ${tasks.length} queued tasks to ${persistPath}`);
        }
        catch (error) {
            logger.error('Failed to persist queued tasks', { error: error.message });
        }
    }
    /**
     * Load previously persisted queued tasks
     */
    async loadPersistedTasks() {
        try {
            const { readdirSync, readFileSync, existsSync, unlinkSync } = await import('fs');
            const { join } = await import('path');
            const persistDir = join(this.options.workDir, 'queue-persist');
            if (!existsSync(persistDir)) {
                return [];
            }
            const files = readdirSync(persistDir)
                .filter(f => f.startsWith('queue-') && f.endsWith('.json'))
                .sort()
                .reverse();
            if (files.length === 0) {
                return [];
            }
            // Load the most recent persisted queue
            const latestFile = join(persistDir, files[0]);
            const data = JSON.parse(readFileSync(latestFile, 'utf-8'));
            const tasks = data.map((item) => ({
                id: item.id,
                issue: item.issue,
                branchName: item.branchName,
                metadata: item.metadata,
                priorityScore: item.priorityScore,
                groupId: item.groupId,
                queuedAt: item.queuedAt ? new Date(item.queuedAt) : new Date(),
                retryCount: item.retryCount ?? 0,
            }));
            // Clean up the persisted file after loading
            unlinkSync(latestFile);
            logger.info(`Loaded ${tasks.length} persisted tasks from ${latestFile}`);
            return tasks;
        }
        catch (error) {
            logger.warn('Failed to load persisted tasks', { error: error.message });
            return [];
        }
    }
    /**
     * Get dead letter queue stats
     */
    getDeadLetterQueueStats() {
        const dlq = getDeadLetterQueue({}, this.options.workDir);
        return dlq.getStats();
    }
    /**
     * Get reprocessable tasks from dead letter queue
     */
    getReprocessableTasks() {
        const dlq = getDeadLetterQueue({}, this.options.workDir);
        return dlq.getReprocessableEntries();
    }
    /**
     * Get error aggregation summary for pattern analysis.
     * Provides insight into error patterns across the pool.
     */
    getErrorAggregationSummary() {
        const aggregator = getErrorAggregator();
        return aggregator.getSummary();
    }
    /**
     * Get recent errors within a time window for debugging.
     * @param windowMs Time window in milliseconds (default: 5 minutes)
     */
    getRecentErrors(windowMs = 5 * 60 * 1000) {
        const aggregator = getErrorAggregator();
        return aggregator.getErrorsInWindow(windowMs).map(error => ({
            code: error.code,
            message: error.message,
            severity: error.severity,
            isRetryable: error.isRetryable,
            recoveryStrategy: error instanceof ExecutorError
                ? error.recoveryStrategy.strategy
                : (error.isRetryable ? 'retry' : 'escalate'),
            timestamp: error.timestamp,
        }));
    }
    /**
     * Clear error aggregation data (useful after recovery or for testing)
     */
    clearErrorAggregation() {
        const aggregator = getErrorAggregator();
        aggregator.clear();
        logger.info('Error aggregation data cleared');
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
        this.isShuttingDown = false;
        this.results = [];
        this.workerTaskMap.clear();
        this.taskGroupWorkers.clear();
        // Reset progress tracking
        this.executionStartTime = Date.now();
        this.taskETACalculator.reset();
        // Load any persisted tasks from previous shutdown
        const persistedTasks = await this.loadPersistedTasks();
        // Convert tasks to PoolTasks with metadata enrichment
        const newTasks = tasks.map((task, index) => {
            const poolTask = {
                ...task,
                id: `task-${index + 1}`,
                metadata: this.extractTaskMetadata(task),
                queuedAt: new Date(),
                retryCount: 0,
                maxRetries: this.options.retryConfig?.maxRetries ?? 3,
            };
            // Calculate priority score and group ID
            poolTask.priorityScore = this.calculatePriorityScore(poolTask);
            poolTask.groupId = this.generateGroupId(poolTask);
            return poolTask;
        });
        // Combine persisted tasks (higher priority) with new tasks
        const allTasks = [...persistedTasks, ...newTasks];
        // Add tasks to queue with overflow handling
        this.taskQueue = [];
        const rejectedTasks = [];
        for (const task of allTasks) {
            if (this.handleQueueOverflow(task)) {
                this.taskQueue.push(task);
                this.recordExecutionHistory(task, 'queued');
            }
            else {
                rejectedTasks.push(task);
            }
        }
        if (rejectedTasks.length > 0) {
            logger.warn(`${rejectedTasks.length} tasks rejected due to queue overflow`, {
                rejectedCount: rejectedTasks.length,
                queueSize: this.taskQueue.length,
                maxQueueSize: this.queueConfig.maxQueueSize,
            });
        }
        // Sort by priority (highest first)
        this.sortTaskQueue();
        // Check queue capacity and emit warnings
        this.checkQueueCapacity();
        // Get effective worker limit based on current resources
        const effectiveWorkerLimit = Math.min(this.currentWorkerLimit, this.options.maxWorkers);
        logger.info(`Executing ${this.taskQueue.length} tasks with up to ${effectiveWorkerLimit} workers`, {
            taskCount: this.taskQueue.length,
            originalTaskCount: tasks.length,
            persistedTaskCount: persistedTasks.length,
            rejectedTaskCount: rejectedTasks.length,
            maxWorkers: this.options.maxWorkers,
            effectiveWorkerLimit,
            queueUtilization: `${this.getQueueUtilization().toFixed(1)}%`,
            maxQueueSize: this.queueConfig.maxQueueSize,
            enableDynamicScaling: this.options.enableDynamicScaling ?? false,
            enableExecutionHistory: this.options.enableExecutionHistory ?? false,
            systemResources: this.getSystemResources(),
        });
        // Update initial metrics
        this.updateMetrics();
        // Reset metrics tracking for this execution batch
        this.completedTaskCount = 0;
        this.failedTaskCount = 0;
        this.totalTaskDurationMs = 0;
        this.peakConcurrency = 0;
        this.peakMemoryUsageMB = getMemoryUsageMB();
        this.completionQueue = [];
        this.completionResolver = null;
        // Start dynamic scaling monitor if enabled
        this.startScalingMonitor();
        // Start graceful degradation monitor if enabled
        this.startDegradationMonitor();
        // Start memory monitor for automatic cleanup
        this.startMemoryMonitor();
        // Start initial workers
        while (this.activeWorkers.size < effectiveWorkerLimit && this.taskQueue.length > 0) {
            this.startNextTask();
            this.updatePeakConcurrency();
        }
        // Wait for all tasks to complete using event-based tracking (O(1) complexity)
        // This replaces the inefficient Promise.race() pattern which was O(n)
        while ((this.activeWorkers.size > 0 || this.taskQueue.length > 0) && !this.isShuttingDown) {
            if (this.activeWorkers.size > 0) {
                // Wait for next worker completion using event-based tracking (O(1))
                const completionEvent = await this.waitForWorkerCompletion();
                // Get the completed task's group for worker affinity
                const completedGroupId = completionEvent.groupId;
                // Clean up worker tracking
                this.activeWorkers.delete(completionEvent.taskId);
                this.workerTaskMap.delete(completionEvent.taskId);
                // Update metrics after worker completion
                this.updateMetrics();
                // Start next task if available and not shutting down
                if (this.taskQueue.length > 0 && this.isRunning && !this.isShuttingDown) {
                    // Use worker affinity: try to assign same-group tasks to same worker
                    this.startNextTask(completedGroupId);
                    this.updatePeakConcurrency();
                }
            }
        }
        // Stop all monitors
        this.stopScalingMonitor();
        this.stopDegradationMonitor();
        this.stopMemoryMonitor();
        const succeeded = this.results.filter(r => r.success).length;
        const failed = this.results.filter(r => !r.success).length;
        // Get final pool metrics
        const finalMetrics = this.getPoolMetrics();
        logger.info(`All tasks completed: ${succeeded}/${this.results.length} succeeded`, {
            succeeded,
            failed,
            total: this.results.length,
            successRate: `${finalMetrics.successRate}%`,
            avgDurationMs: finalMetrics.avgTaskDurationMs,
            peakConcurrency: finalMetrics.peakConcurrency,
            peakMemoryMB: finalMetrics.peakMemoryUsageMB,
            tasksPerMinute: finalMetrics.tasksPerMinute,
            degradationOccurred: this.degradationStatus.isDegraded || this.consecutiveFailures > 0,
            dlqStats: this.getDeadLetterQueueStats(),
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
        // Track worker-task relationship for group affinity
        this.workerTaskMap.set(task.id, task);
        // Track group-worker relationship for future task assignment
        if (task.groupId) {
            this.taskGroupWorkers.set(task.groupId, workerId);
        }
        // Record task started in execution history
        this.recordExecutionHistory(task, 'started', workerId);
        // Calculate task-specific timeout
        const taskTimeoutMs = this.getTaskTimeout(task);
        const taskTimeoutMinutes = Math.round(taskTimeoutMs / 60000);
        logger.info(`Starting ${task.id} with ${workerId}: ${task.issue.title}`, {
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
            queuedAt: task.queuedAt?.toISOString(),
        });
        // Log worker progress start
        logger.workerProgress(workerId, task.issue.number, 'starting');
        // Track with progress manager
        this.progressManager.startWorker(workerId, task.id, task.issue.number);
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
            // Retry configuration
            retryConfig: this.options.retryConfig,
        }, workerId);
        const promise = worker.execute(task).then((result) => {
            this.results.push({
                ...result,
                taskId: task.id,
            });
            // Track result for graceful degradation
            this.recordTaskResult(result.success);
            // Update metrics tracking
            if (result.success) {
                this.completedTaskCount++;
            }
            else {
                this.failedTaskCount++;
            }
            if (result.duration) {
                this.totalTaskDurationMs += result.duration;
            }
            // Record in execution history
            if (result.success) {
                this.recordExecutionHistory(task, 'completed', workerId);
                // Track completion for ETA calculation
                if (result.duration) {
                    this.taskETACalculator.addSample(result.duration);
                }
                // Log worker progress completion
                logger.workerProgress(workerId, task.issue.number, 'completed', 100, `${formatDuration(result.duration || 0)}`);
                this.progressManager.completeWorker(workerId, true);
                logger.success(`${task.id} completed: ${task.issue.title}`);
                logger.debug(`Task completion details`, {
                    taskId: task.id,
                    priority: task.metadata?.priority,
                    groupId: task.groupId,
                    duration: result.duration,
                    retryCount: task.retryCount ?? 0,
                });
            }
            else {
                // Extract error info for history
                const errorInfo = result.error ? {
                    code: result.error.match(/\[([^\]]+)\]/)?.[1] ?? 'UNKNOWN',
                    message: result.error,
                    isRetryable: !result.error.includes('AUTH') && !result.error.includes('PERMISSION'),
                } : undefined;
                this.recordExecutionHistory(task, 'failed', workerId, errorInfo);
                this.progressManager.completeWorker(workerId, false);
                logger.failure(`${task.id} failed: ${result.error}`);
                logger.debug(`Task failure details`, {
                    taskId: task.id,
                    priority: task.metadata?.priority,
                    groupId: task.groupId,
                    duration: result.duration,
                    retryCount: task.retryCount ?? 0,
                    consecutiveFailures: this.consecutiveFailures,
                    isDegraded: this.degradationStatus.isDegraded,
                });
            }
            // Signal completion using event-based tracking (O(1) complexity)
            // This replaces the old Promise.race() pattern
            this.signalWorkerCompletion({
                taskId: task.id,
                workerId,
                success: result.success,
                duration: result.duration,
                groupId: task.groupId,
                result,
            });
            return result;
        });
        this.activeWorkers.set(task.id, promise);
    }
    stop() {
        this.isRunning = false;
        this.stopScalingMonitor();
        this.stopDegradationMonitor();
        this.stopMemoryMonitor();
        logger.warn('Worker pool stop requested', {
            activeWorkers: this.activeWorkers.size,
            queuedTasks: this.taskQueue.length,
            poolMetrics: this.getPoolMetrics(),
        });
    }
    /**
     * Check if the pool is currently shutting down
     */
    isInShutdown() {
        return this.isShuttingDown;
    }
    /**
     * Get the current queue configuration
     */
    getQueueConfig() {
        return { ...this.queueConfig };
    }
    /**
     * Update queue configuration at runtime
     */
    updateQueueConfig(config) {
        this.queueConfig = { ...this.queueConfig, ...config };
        logger.info('Queue configuration updated', {
            config: this.queueConfig,
        });
    }
    getStatus() {
        const groupIds = new Set(this.taskQueue.map(t => t.groupId).filter(Boolean));
        const utilization = this.getQueueUtilization();
        return {
            active: this.activeWorkers.size,
            queued: this.taskQueue.length,
            completed: this.results.length,
            succeeded: this.results.filter((r) => r.success).length,
            failed: this.results.filter((r) => !r.success).length,
            currentWorkerLimit: this.currentWorkerLimit,
            systemResources: this.getSystemResources(),
            taskGroups: groupIds.size,
            degradationStatus: this.getDegradationStatus(),
            dlqStats: this.getDeadLetterQueueStats(),
            errorAggregation: this.getErrorAggregationSummary(),
            queueStatus: {
                utilization,
                maxSize: this.queueConfig.maxQueueSize,
                isAtCapacity: utilization >= 100,
                overflowStrategy: this.queueConfig.overflowStrategy,
                recentOverflowCount: this.overflowEvents.filter(e => e.timestamp.getTime() > Date.now() - 60000 // Last minute
                ).length,
            },
            executionStats: this.getExecutionStats(),
            isShuttingDown: this.isShuttingDown,
        };
    }
    /**
     * Get the current scaling configuration
     */
    getScalingConfig() {
        return { ...this.scalingConfig };
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