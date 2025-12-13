/**
 * Progress phase for daemon cycle tracking
 */
export type CyclePhase = 'fetch-issues' | 'discover-tasks' | 'execute-tasks' | 'evaluate' | 'create-prs' | 'merge-prs' | 'waiting';
/**
 * Progress bar configuration
 */
export interface ProgressBarConfig {
    total: number;
    width?: number;
    completeChar?: string;
    incompleteChar?: string;
    showPercentage?: boolean;
    showCount?: boolean;
    showETA?: boolean;
}
/**
 * Worker progress state
 */
export interface WorkerProgressState {
    workerId: string;
    taskId: string;
    issueNumber: number;
    status: 'queued' | 'running' | 'completed' | 'failed';
    startTime?: number;
    progress?: number;
    message?: string;
}
/**
 * Cycle progress state
 */
export interface CycleProgressState {
    cycleNumber: number;
    phase: CyclePhase;
    stepNumber: number;
    totalSteps: number;
    startTime: number;
    phaseStartTime?: number;
    tasksDiscovered: number;
    tasksCompleted: number;
    tasksFailed: number;
    prsMerged: number;
    workers: Map<string, WorkerProgressState>;
}
/**
 * Estimated time calculator
 */
export declare class ETACalculator {
    private samples;
    private maxSamples;
    addSample(durationMs: number): void;
    getAverageMs(): number;
    estimateRemaining(completed: number, total: number): number;
    reset(): void;
}
/**
 * Format duration in human-readable format
 */
export declare function formatDuration(ms: number): string;
/**
 * Format ETA in human-readable format
 */
export declare function formatETA(ms: number): string;
/**
 * Create a text-based progress bar
 */
export declare function createProgressBar(current: number, config: ProgressBarConfig): string;
/**
 * Progress indicator manager for daemon operations
 */
export declare class ProgressManager {
    private spinner;
    private state;
    private isJsonMode;
    private updateInterval;
    private phaseETAs;
    private lastOutputLines;
    constructor(jsonMode?: boolean);
    /**
     * Set JSON mode (disables spinners for structured output)
     */
    setJsonMode(enabled: boolean): void;
    /**
     * Start a new cycle
     */
    startCycle(cycleNumber: number, totalSteps?: number): void;
    /**
     * Update the current phase
     */
    setPhase(phase: CyclePhase, stepNumber: number): void;
    /**
     * Update task counts
     */
    updateTaskCounts(discovered: number, completed: number, failed: number, merged: number): void;
    /**
     * Start tracking a worker
     */
    startWorker(workerId: string, taskId: string, issueNumber: number): void;
    /**
     * Update worker progress
     */
    updateWorker(workerId: string, progress: number, message?: string): void;
    /**
     * Mark worker as completed
     */
    completeWorker(workerId: string, success: boolean): void;
    /**
     * Show waiting state between cycles
     */
    showWaiting(nextCycleInMs: number): void;
    /**
     * Start countdown for next cycle
     */
    private startCountdown;
    /**
     * Stop countdown
     */
    private stopCountdown;
    /**
     * End the current cycle
     */
    endCycle(success: boolean): void;
    /**
     * Get estimated time remaining for current cycle
     */
    getEstimatedTimeRemaining(): number;
    /**
     * Get current progress state for external monitoring
     */
    getState(): CycleProgressState | null;
    /**
     * Start or update the spinner
     */
    private startSpinner;
    /**
     * Update spinner text
     */
    private updateSpinner;
    /**
     * Stop spinner with final message
     */
    private stopSpinner;
    /**
     * Update worker display (multi-line progress)
     */
    private updateWorkerDisplay;
    /**
     * Display a progress bar for batch operations
     */
    showBatchProgress(current: number, total: number, label: string, etaMs?: number): void;
    /**
     * Show success message
     */
    succeed(message: string): void;
    /**
     * Show failure message
     */
    fail(message: string): void;
    /**
     * Show info message
     */
    info(message: string): void;
    /**
     * Show warning message
     */
    warn(message: string): void;
    /**
     * Clear all progress state
     */
    clear(): void;
}
/**
 * Get or create the global progress manager
 */
export declare function getProgressManager(jsonMode?: boolean): ProgressManager;
/**
 * Create a scoped progress indicator for a specific operation
 */
export declare function createScopedProgress(label: string, jsonMode?: boolean): {
    start: (message?: string) => void;
    update: (message: string) => void;
    succeed: (message?: string) => void;
    fail: (message?: string) => void;
    stop: () => void;
};
//# sourceMappingURL=progress.d.ts.map