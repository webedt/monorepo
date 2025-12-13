/**
 * Task Preview Session Manager
 *
 * Manages preview sessions for task approval workflow.
 * Handles filtering, sorting, and persistence of task approval states.
 */
import { randomUUID } from 'crypto';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { logger } from '../utils/logger.js';
/**
 * Priority order for sorting (higher value = higher priority)
 */
const PRIORITY_ORDER = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
};
/**
 * Complexity order for sorting (higher value = more complex)
 */
const COMPLEXITY_ORDER = {
    complex: 3,
    moderate: 2,
    simple: 1,
};
/**
 * Manages a task preview session
 */
export class PreviewSessionManager {
    session;
    startTime;
    callbacks = [];
    constructor(tasks, repoPath) {
        this.startTime = new Date();
        this.session = {
            sessionId: randomUUID(),
            createdAt: this.startTime,
            tasks: tasks.map((task) => this.createPreviewTask(task)),
            filters: {},
            sort: { field: 'priority', order: 'desc' },
            repoPath,
            isComplete: false,
        };
    }
    /**
     * Create a preview task from a discovered task
     */
    createPreviewTask(task) {
        return {
            ...task,
            previewId: randomUUID(),
            approvalStatus: 'pending',
        };
    }
    /**
     * Get the current session
     */
    getSession() {
        return this.session;
    }
    /**
     * Get all tasks (optionally filtered and sorted)
     */
    getTasks(applyFilters = true) {
        let tasks = [...this.session.tasks];
        if (applyFilters) {
            tasks = this.applyFilters(tasks, this.session.filters);
            tasks = this.applySorting(tasks, this.session.sort);
        }
        return tasks;
    }
    /**
     * Get a task by its preview ID
     */
    getTask(previewId) {
        return this.session.tasks.find((t) => t.previewId === previewId);
    }
    /**
     * Get tasks by approval status
     */
    getTasksByStatus(status) {
        return this.session.tasks.filter((t) => t.approvalStatus === status);
    }
    /**
     * Get count of tasks by status
     */
    getStatusCounts() {
        const counts = {
            pending: 0,
            approved: 0,
            rejected: 0,
            deferred: 0,
        };
        for (const task of this.session.tasks) {
            counts[task.approvalStatus]++;
        }
        return counts;
    }
    /**
     * Update a task's approval status
     */
    updateTaskStatus(previewId, status) {
        const task = this.getTask(previewId);
        if (!task)
            return false;
        const previousStatus = task.approvalStatus;
        task.approvalStatus = status;
        task.statusUpdatedAt = new Date();
        // Notify callbacks
        for (const callback of this.callbacks) {
            callback(task, previousStatus);
        }
        // Check if all tasks are reviewed
        this.session.isComplete = this.session.tasks.every((t) => t.approvalStatus !== 'pending');
        return true;
    }
    /**
     * Update a task's title
     */
    updateTaskTitle(previewId, newTitle) {
        const task = this.getTask(previewId);
        if (!task)
            return false;
        // Save original if not already saved
        if (!task.originalTitle) {
            task.originalTitle = task.title;
        }
        task.title = newTitle;
        return true;
    }
    /**
     * Update a task's description
     */
    updateTaskDescription(previewId, newDescription) {
        const task = this.getTask(previewId);
        if (!task)
            return false;
        // Save original if not already saved
        if (!task.originalDescription) {
            task.originalDescription = task.description;
        }
        task.description = newDescription;
        return true;
    }
    /**
     * Add notes to a task
     */
    addTaskNotes(previewId, notes) {
        const task = this.getTask(previewId);
        if (!task)
            return false;
        task.userNotes = notes;
        return true;
    }
    /**
     * Approve a task
     */
    approveTask(previewId) {
        return this.updateTaskStatus(previewId, 'approved');
    }
    /**
     * Reject a task
     */
    rejectTask(previewId) {
        return this.updateTaskStatus(previewId, 'rejected');
    }
    /**
     * Defer a task
     */
    deferTask(previewId) {
        return this.updateTaskStatus(previewId, 'deferred');
    }
    /**
     * Approve all pending tasks
     */
    approveAllPending() {
        let count = 0;
        for (const task of this.session.tasks) {
            if (task.approvalStatus === 'pending') {
                this.updateTaskStatus(task.previewId, 'approved');
                count++;
            }
        }
        return count;
    }
    /**
     * Reject all pending tasks
     */
    rejectAllPending() {
        let count = 0;
        for (const task of this.session.tasks) {
            if (task.approvalStatus === 'pending') {
                this.updateTaskStatus(task.previewId, 'rejected');
                count++;
            }
        }
        return count;
    }
    /**
     * Set filter options
     */
    setFilters(filters) {
        this.session.filters = filters;
    }
    /**
     * Set sort options
     */
    setSort(sort) {
        this.session.sort = sort;
    }
    /**
     * Register a callback for task approval events
     */
    onTaskApproval(callback) {
        this.callbacks.push(callback);
    }
    /**
     * Apply filters to tasks
     */
    applyFilters(tasks, filters) {
        return tasks.filter((task) => {
            // Filter by priority
            if (filters.priorities && filters.priorities.length > 0) {
                if (!filters.priorities.includes(task.priority)) {
                    return false;
                }
            }
            // Filter by category
            if (filters.categories && filters.categories.length > 0) {
                if (!filters.categories.includes(task.category)) {
                    return false;
                }
            }
            // Filter by complexity
            if (filters.complexities && filters.complexities.length > 0) {
                if (!filters.complexities.includes(task.estimatedComplexity)) {
                    return false;
                }
            }
            // Filter by status
            if (filters.statuses && filters.statuses.length > 0) {
                if (!filters.statuses.includes(task.approvalStatus)) {
                    return false;
                }
            }
            // Filter by search term
            if (filters.searchTerm) {
                const term = filters.searchTerm.toLowerCase();
                const matchesTitle = task.title.toLowerCase().includes(term);
                const matchesDescription = task.description.toLowerCase().includes(term);
                const matchesPaths = task.affectedPaths.some((p) => p.toLowerCase().includes(term));
                if (!matchesTitle && !matchesDescription && !matchesPaths) {
                    return false;
                }
            }
            return true;
        });
    }
    /**
     * Apply sorting to tasks
     */
    applySorting(tasks, sort) {
        const multiplier = sort.order === 'desc' ? -1 : 1;
        return [...tasks].sort((a, b) => {
            switch (sort.field) {
                case 'priority':
                    return ((PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]) * multiplier);
                case 'complexity':
                    return ((COMPLEXITY_ORDER[b.estimatedComplexity] -
                        COMPLEXITY_ORDER[a.estimatedComplexity]) *
                        multiplier);
                case 'category':
                    return a.category.localeCompare(b.category) * multiplier;
                case 'title':
                    return a.title.localeCompare(b.title) * multiplier;
                case 'status':
                    return a.approvalStatus.localeCompare(b.approvalStatus) * multiplier;
                default:
                    return 0;
            }
        });
    }
    /**
     * Get the preview result
     */
    getResult() {
        const duration = Date.now() - this.startTime.getTime();
        return {
            approvedTasks: this.getTasksByStatus('approved'),
            rejectedTasks: this.getTasksByStatus('rejected'),
            deferredTasks: this.getTasksByStatus('deferred'),
            totalReviewed: this.session.tasks.filter((t) => t.approvalStatus !== 'pending').length,
            sessionId: this.session.sessionId,
            duration,
        };
    }
    /**
     * Save approved tasks to a batch file
     */
    saveToBatchFile(filePath, repoInfo) {
        const result = this.getResult();
        const counts = this.getStatusCounts();
        const batch = {
            version: 1,
            createdAt: new Date().toISOString(),
            sessionId: this.session.sessionId,
            repository: {
                path: this.session.repoPath,
                owner: repoInfo?.owner,
                name: repoInfo?.name,
            },
            tasks: result.approvedTasks,
            metadata: {
                totalDiscovered: this.session.tasks.length,
                totalApproved: counts.approved,
                totalRejected: counts.rejected,
                totalDeferred: counts.deferred,
            },
        };
        writeFileSync(filePath, JSON.stringify(batch, null, 2) + '\n');
        logger.info(`Saved ${counts.approved} approved tasks to ${filePath}`);
    }
    /**
     * Load tasks from a batch file
     */
    static loadFromBatchFile(filePath) {
        if (!existsSync(filePath)) {
            logger.error(`Batch file not found: ${filePath}`);
            return null;
        }
        try {
            const content = readFileSync(filePath, 'utf-8');
            const batch = JSON.parse(content);
            // Validate version
            if (batch.version !== 1) {
                logger.warn(`Unknown batch file version: ${batch.version}`);
            }
            return batch;
        }
        catch (error) {
            logger.error(`Failed to load batch file: ${error}`);
            return null;
        }
    }
}
/**
 * Create a new preview session from discovered tasks
 */
export function createPreviewSession(tasks, repoPath) {
    return new PreviewSessionManager(tasks, repoPath);
}
//# sourceMappingURL=session.js.map