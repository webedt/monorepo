import { type ServiceHealth } from './github/index.js';
import { type LogFormat } from './utils/logger.js';
import { type DaemonStateProvider, type DaemonStatus, type WorkerPoolStatus, type ErrorMetrics } from './monitoring/index.js';
/**
 * Aggregated service health for all external dependencies
 */
interface DaemonServiceHealth {
    github: ServiceHealth | null;
    overallStatus: 'healthy' | 'degraded' | 'unavailable';
    lastCheck: Date;
}
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
    degraded: boolean;
    serviceHealth: DaemonServiceHealth;
}
export declare class Daemon implements DaemonStateProvider {
    private config;
    private github;
    private isRunning;
    private cycleCount;
    private options;
    private userId;
    private enableDatabaseLogging;
    private monitoringServer;
    private healthServer;
    private repository;
    private lastKnownIssues;
    private serviceHealth;
    private startTime;
    private lastCycleTime;
    private lastCycleSuccess;
    private lastCycleDuration;
    private currentWorkerPool;
    private totalErrors;
    private lastErrorTime;
    private errorsByType;
    private recentErrors;
    private daemonStatus;
    private structuredLogger;
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
    /**
     * Get the current correlation ID from the global context
     */
    private getCurrentCorrelationId;
    /**
     * Update and return the current service health status
     */
    private updateServiceHealth;
    /**
     * Get the current internal service health status
     */
    getInternalServiceHealth(): DaemonServiceHealth;
    /**
     * Log the current service health status
     */
    private logServiceHealthStatus;
    /**
     * Start the monitoring server for health checks and metrics
     */
    private startMonitoringServer;
    /**
     * Start the health server for external monitoring
     */
    private startHealthServer;
    /**
     * DaemonStateProvider implementation: Get current daemon status
     */
    getDaemonStatus(): DaemonStatus;
    /**
     * DaemonStateProvider implementation: Get worker pool status
     */
    getWorkerPoolStatus(): WorkerPoolStatus | null;
    /**
     * DaemonStateProvider implementation: Get error metrics
     */
    getErrorMetrics(): ErrorMetrics;
    /**
     * DaemonStateProvider implementation: Get service health
     */
    getServiceHealth(): {
        name: string;
        status: 'available' | 'degraded' | 'unavailable';
        latency?: number;
        details?: Record<string, any>;
    }[];
    /**
     * Extract error type from error message for categorization
     */
    private extractErrorType;
    /**
     * Get the health server port (for CLI status command)
     */
    getHealthServerPort(): number | null;
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
export {};
//# sourceMappingURL=daemon.d.ts.map