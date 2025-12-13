/**
 * Task Preview and Approval Workflow Types
 *
 * This module defines types for the interactive task preview system
 * that allows users to review, filter, and approve discovered tasks
 * before execution.
 */
import type { DiscoveredTask, DiscoveredTaskPriority, DiscoveredTaskCategory, DiscoveredTaskComplexity } from '../discovery/index.js';
/**
 * Approval status for a discovered task
 */
export type TaskApprovalStatus = 'pending' | 'approved' | 'rejected' | 'deferred';
/**
 * A task with approval metadata
 */
export interface PreviewTask extends DiscoveredTask {
    /** Unique identifier for the preview session */
    previewId: string;
    /** Current approval status */
    approvalStatus: TaskApprovalStatus;
    /** User notes/comments on the task */
    userNotes?: string;
    /** Original task description (if user edited) */
    originalDescription?: string;
    /** Original title (if user edited) */
    originalTitle?: string;
    /** Timestamp when status was last updated */
    statusUpdatedAt?: Date;
}
/**
 * Filter options for task preview
 */
export interface TaskFilterOptions {
    /** Filter by priority levels */
    priorities?: DiscoveredTaskPriority[];
    /** Filter by categories */
    categories?: DiscoveredTaskCategory[];
    /** Filter by complexity */
    complexities?: DiscoveredTaskComplexity[];
    /** Filter by approval status */
    statuses?: TaskApprovalStatus[];
    /** Search term to filter by title/description */
    searchTerm?: string;
}
/**
 * Sort options for task preview
 */
export type TaskSortField = 'priority' | 'category' | 'complexity' | 'title' | 'status';
export type TaskSortOrder = 'asc' | 'desc';
export interface TaskSortOptions {
    field: TaskSortField;
    order: TaskSortOrder;
}
/**
 * Preview session representing a batch of tasks for review
 */
export interface PreviewSession {
    /** Unique session ID */
    sessionId: string;
    /** When the session was created */
    createdAt: Date;
    /** All tasks in this preview session */
    tasks: PreviewTask[];
    /** Current filter options */
    filters: TaskFilterOptions;
    /** Current sort options */
    sort: TaskSortOptions;
    /** Path to the repository being analyzed */
    repoPath: string;
    /** Whether the session is complete (all tasks reviewed) */
    isComplete: boolean;
}
/**
 * Result of a preview session
 */
export interface PreviewResult {
    /** All approved tasks ready for execution */
    approvedTasks: PreviewTask[];
    /** Tasks that were rejected */
    rejectedTasks: PreviewTask[];
    /** Tasks that were deferred for later review */
    deferredTasks: PreviewTask[];
    /** Total number of tasks reviewed */
    totalReviewed: number;
    /** Session ID for reference */
    sessionId: string;
    /** Duration of the preview session in ms */
    duration: number;
}
/**
 * Configuration for preview mode
 */
export interface PreviewConfig {
    /** Enable interactive preview mode (default: true for CLI, false for CI) */
    enabled: boolean;
    /** Auto-approve all tasks without prompting */
    autoApprove: boolean;
    /** Path to save approved tasks for batch execution */
    batchFilePath?: string;
    /** Default filters to apply */
    defaultFilters?: TaskFilterOptions;
    /** Default sort options */
    defaultSort?: TaskSortOptions;
    /** Maximum tasks to show per page in interactive mode */
    pageSize?: number;
    /** Timeout for interactive prompts (ms) */
    promptTimeout?: number;
}
/**
 * Options for the preview command
 */
export interface PreviewCommandOptions {
    /** Path to configuration file */
    configPath?: string;
    /** Enable verbose output */
    verbose?: boolean;
    /** Number of tasks to discover */
    count?: number;
    /** Auto-approve all tasks */
    autoApprove?: boolean;
    /** Filter by priority */
    priority?: DiscoveredTaskPriority[];
    /** Filter by category */
    category?: DiscoveredTaskCategory[];
    /** Filter by complexity */
    complexity?: DiscoveredTaskComplexity[];
    /** Save approved tasks to file */
    saveTo?: string;
    /** Execute approved tasks immediately */
    execute?: boolean;
    /** Interactive mode (default: true) */
    interactive?: boolean;
}
/**
 * Batch file format for saving approved tasks
 */
export interface ApprovedTaskBatch {
    /** Version of the batch file format */
    version: number;
    /** When the batch was created */
    createdAt: string;
    /** Session ID from the preview */
    sessionId: string;
    /** Repository information */
    repository: {
        path: string;
        owner?: string;
        name?: string;
    };
    /** Approved tasks */
    tasks: PreviewTask[];
    /** Metadata about the approval process */
    metadata: {
        totalDiscovered: number;
        totalApproved: number;
        totalRejected: number;
        totalDeferred: number;
    };
}
/**
 * Callback for task approval events
 */
export type TaskApprovalCallback = (task: PreviewTask, previousStatus: TaskApprovalStatus) => void;
/**
 * Interactive prompt action for task review
 */
export type TaskAction = 'approve' | 'reject' | 'defer' | 'edit' | 'notes' | 'details' | 'skip' | 'back' | 'filter' | 'sort' | 'approveAll' | 'rejectAll' | 'save' | 'done';
/**
 * Menu option for interactive preview
 */
export interface MenuOption {
    key: string;
    label: string;
    action: TaskAction;
    description?: string;
}
//# sourceMappingURL=types.d.ts.map