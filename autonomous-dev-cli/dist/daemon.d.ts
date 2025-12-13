export interface DaemonOptions {
    configPath?: string;
    dryRun?: boolean;
    verbose?: boolean;
    singleCycle?: boolean;
}
export interface CycleResult {
    success: boolean;
    tasksDiscovered: number;
    tasksCompleted: number;
    tasksFailed: number;
    prsMerged: number;
    duration: number;
    errors: string[];
}
export declare class Daemon {
    private config;
    private github;
    private isRunning;
    private cycleCount;
    private options;
    private userId;
    private enableDatabaseLogging;
    constructor(options?: DaemonOptions);
    start(): Promise<void>;
    /**
     * Wrap any error as a StructuredError with daemon-specific context
     */
    private wrapDaemonError;
    /**
     * Get current error context for debugging
     */
    private getErrorContext;
    stop(): Promise<void>;
    private initialize;
    private shutdown;
    private runCycle;
    private createIssueForTask;
    private generateBranchName;
    private generatePRBody;
    private logCycleResult;
    private sleep;
}
export declare function createDaemon(options?: DaemonOptions): Daemon;
//# sourceMappingURL=daemon.d.ts.map