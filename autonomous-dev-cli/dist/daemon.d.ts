import { type LogFormat } from './utils/logger.js';
import { StructuredError } from './utils/errors.js';
export interface DaemonOptions {
    configPath?: string;
    dryRun?: boolean;
    verbose?: boolean;
    singleCycle?: boolean;
    logFormat?: LogFormat;
    monitoringPort?: number;
}
export interface CycleResult {
    success: boolean;
    tasksDiscovered: number;
    tasksCompleted: number;
    tasksFailed: number;
    prsMerged: number;
    duration: number;
    errors: string[];
    criticalError?: StructuredError;
}
export declare class Daemon {
    private config;
    private github;
    private isRunning;
    private cycleCount;
    private options;
    private userId;
    private enableDatabaseLogging;
    private monitoringServer;
    private repository;
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
    /**
     * Run a cycle with error boundary protection
     * This catches errors and determines if they are recoverable or critical
     */
    private runCycleWithErrorBoundary;
    stop(): Promise<void>;
    /**
     * Start the monitoring server for health checks and metrics
     */
    private startMonitoringServer;
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