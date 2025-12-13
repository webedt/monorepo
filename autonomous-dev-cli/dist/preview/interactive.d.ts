/**
 * Interactive Task Preview CLI
 *
 * Provides an interactive command-line interface for reviewing,
 * filtering, and approving discovered tasks before execution.
 */
import type { PreviewResult } from './types.js';
import { PreviewSessionManager } from './session.js';
/**
 * Interactive preview session handler
 */
export declare class InteractivePreview {
    private session;
    private rl;
    private currentIndex;
    private running;
    private savePath?;
    constructor(session: PreviewSessionManager, savePath?: string);
    /**
     * Start the interactive preview session
     */
    start(): Promise<PreviewResult>;
    /**
     * Display the preview header
     */
    private displayHeader;
    /**
     * Display current progress
     */
    private displayProgress;
    /**
     * Display a task for review
     */
    private displayTask;
    /**
     * Display full task details
     */
    private displayFullDetails;
    /**
     * Display the action menu
     */
    private displayMenu;
    /**
     * Prompt for user action
     */
    private promptAction;
    /**
     * Prompt for text input
     */
    private promptText;
    /**
     * Prompt for confirmation
     */
    private promptConfirm;
    /**
     * Handle user action
     */
    private handleAction;
    /**
     * Handle task editing
     */
    private handleEdit;
    /**
     * Handle filtering
     */
    private handleFilter;
    /**
     * Handle sorting
     */
    private handleSort;
    /**
     * Handle saving to file
     */
    private handleSave;
    /**
     * Move to next task
     */
    private moveToNext;
    /**
     * Move to previous task
     */
    private moveToPrevious;
    /**
     * Display final summary
     */
    private displaySummary;
}
/**
 * Run an interactive preview session
 */
export declare function runInteractivePreview(session: PreviewSessionManager, savePath?: string): Promise<PreviewResult>;
//# sourceMappingURL=interactive.d.ts.map