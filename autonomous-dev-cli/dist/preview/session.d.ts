/**
 * Task Preview Session Manager
 *
 * Manages preview sessions for task approval workflow.
 * Handles filtering, sorting, and persistence of task approval states.
 */
import type { DiscoveredTask } from '../discovery/index.js';
import type { PreviewTask, PreviewSession, PreviewResult, TaskFilterOptions, TaskSortOptions, TaskApprovalStatus, ApprovedTaskBatch, TaskApprovalCallback } from './types.js';
/**
 * Manages a task preview session
 */
export declare class PreviewSessionManager {
    private session;
    private startTime;
    private callbacks;
    constructor(tasks: DiscoveredTask[], repoPath: string);
    /**
     * Create a preview task from a discovered task
     */
    private createPreviewTask;
    /**
     * Get the current session
     */
    getSession(): PreviewSession;
    /**
     * Get all tasks (optionally filtered and sorted)
     */
    getTasks(applyFilters?: boolean): PreviewTask[];
    /**
     * Get a task by its preview ID
     */
    getTask(previewId: string): PreviewTask | undefined;
    /**
     * Get tasks by approval status
     */
    getTasksByStatus(status: TaskApprovalStatus): PreviewTask[];
    /**
     * Get count of tasks by status
     */
    getStatusCounts(): Record<TaskApprovalStatus, number>;
    /**
     * Update a task's approval status
     */
    updateTaskStatus(previewId: string, status: TaskApprovalStatus): boolean;
    /**
     * Update a task's title
     */
    updateTaskTitle(previewId: string, newTitle: string): boolean;
    /**
     * Update a task's description
     */
    updateTaskDescription(previewId: string, newDescription: string): boolean;
    /**
     * Add notes to a task
     */
    addTaskNotes(previewId: string, notes: string): boolean;
    /**
     * Approve a task
     */
    approveTask(previewId: string): boolean;
    /**
     * Reject a task
     */
    rejectTask(previewId: string): boolean;
    /**
     * Defer a task
     */
    deferTask(previewId: string): boolean;
    /**
     * Approve all pending tasks
     */
    approveAllPending(): number;
    /**
     * Reject all pending tasks
     */
    rejectAllPending(): number;
    /**
     * Set filter options
     */
    setFilters(filters: TaskFilterOptions): void;
    /**
     * Set sort options
     */
    setSort(sort: TaskSortOptions): void;
    /**
     * Register a callback for task approval events
     */
    onTaskApproval(callback: TaskApprovalCallback): void;
    /**
     * Apply filters to tasks
     */
    private applyFilters;
    /**
     * Apply sorting to tasks
     */
    private applySorting;
    /**
     * Get the preview result
     */
    getResult(): PreviewResult;
    /**
     * Save approved tasks to a batch file
     */
    saveToBatchFile(filePath: string, repoInfo?: {
        owner?: string;
        name?: string;
    }): void;
    /**
     * Load tasks from a batch file
     */
    static loadFromBatchFile(filePath: string): ApprovedTaskBatch | null;
}
/**
 * Create a new preview session from discovered tasks
 */
export declare function createPreviewSession(tasks: DiscoveredTask[], repoPath: string): PreviewSessionManager;
//# sourceMappingURL=session.d.ts.map