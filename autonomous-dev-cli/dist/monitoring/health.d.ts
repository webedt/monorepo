/**
 * Health check and status monitoring module.
 * Provides HTTP endpoints for external monitoring of daemon health.
 */
/**
 * Daemon status information
 */
export interface DaemonStatus {
    status: 'running' | 'stopped' | 'starting' | 'stopping';
    cycleCount: number;
    lastCycleTime: Date | null;
    lastCycleSuccess: boolean | null;
    lastCycleDuration: number | null;
    startTime: Date;
    uptime: number;
    version: string;
}
/**
 * Worker pool status for health reporting
 */
export interface WorkerPoolStatus {
    activeWorkers: number;
    queuedTasks: number;
    completedTasks: number;
    failedTasks: number;
    maxWorkers: number;
    isRunning: boolean;
}
/**
 * System resource metrics
 */
export interface SystemMetrics {
    memoryUsageMB: number;
    memoryTotalMB: number;
    memoryPercent: number;
    cpuCores: number;
    loadAverage: number[];
    heapUsedMB: number;
    heapTotalMB: number;
}
/**
 * Error rate metrics
 */
export interface ErrorMetrics {
    totalErrors: number;
    recentErrorRate: number;
    lastErrorTime: Date | null;
    errorsByType: Record<string, number>;
}
/**
 * Health check response format
 */
export interface HealthCheckResponse {
    status: 'healthy' | 'degraded' | 'unhealthy';
    daemon: DaemonStatus;
    workerPool: WorkerPoolStatus;
    timestamp: string;
    checks: {
        name: string;
        status: 'pass' | 'fail' | 'warn';
        message?: string;
        responseTime?: number;
    }[];
}
/**
 * Detailed status response format
 */
export interface StatusResponse {
    daemon: DaemonStatus;
    workerPool: WorkerPoolStatus;
    system: SystemMetrics;
    errors: ErrorMetrics;
    services: {
        name: string;
        status: 'available' | 'degraded' | 'unavailable';
        latency?: number;
        details?: Record<string, any>;
    }[];
    timestamp: string;
}
/**
 * Health server options
 */
export interface HealthServerOptions {
    port: number;
    host?: string;
}
/**
 * Health check function type
 */
export type HealthCheckFn = () => Promise<{
    name: string;
    status: 'pass' | 'fail' | 'warn';
    message?: string;
}>;
/**
 * Daemon state provider interface
 */
export interface DaemonStateProvider {
    getDaemonStatus(): DaemonStatus;
    getWorkerPoolStatus(): WorkerPoolStatus | null;
    getErrorMetrics(): ErrorMetrics;
    getServiceHealth(): {
        name: string;
        status: 'available' | 'degraded' | 'unavailable';
        latency?: number;
        details?: Record<string, any>;
    }[];
}
/**
 * Health check server for daemon monitoring
 */
export declare class HealthServer {
    private server;
    private options;
    private healthChecks;
    private startTime;
    private version;
    private isShuttingDown;
    private stateProvider;
    constructor(options: HealthServerOptions);
    /**
     * Set the daemon state provider for accessing runtime status
     */
    setStateProvider(provider: DaemonStateProvider): void;
    /**
     * Register a health check function
     */
    registerHealthCheck(check: HealthCheckFn): void;
    /**
     * Start the health server
     */
    start(): Promise<void>;
    /**
     * Stop the health server
     */
    stop(): Promise<void>;
    /**
     * Get the server port
     */
    getPort(): number;
    /**
     * Check if server is running
     */
    isRunning(): boolean;
    /**
     * Handle incoming HTTP requests
     */
    private handleRequest;
    /**
     * Handle /health endpoint - responds within 100ms target
     */
    private handleHealth;
    /**
     * Handle /status endpoint - detailed metrics
     */
    private handleStatus;
    /**
     * Handle /metrics endpoint - Prometheus format
     */
    private handleMetrics;
    /**
     * Handle /ready endpoint (Kubernetes readiness probe)
     */
    private handleReady;
    /**
     * Handle /live endpoint (Kubernetes liveness probe)
     */
    private handleLive;
    /**
     * Handle root endpoint
     */
    private handleRoot;
    /**
     * Run all registered health checks
     */
    private runHealthChecks;
    /**
     * Get detailed status information
     */
    private getDetailedStatus;
    /**
     * Get system metrics
     */
    private getSystemMetrics;
    /**
     * Get default daemon status when no provider is set
     */
    private getDefaultDaemonStatus;
    /**
     * Get default worker pool status
     */
    private getDefaultWorkerPoolStatus;
    /**
     * Get default error metrics
     */
    private getDefaultErrorMetrics;
    /**
     * Send an error response
     */
    private sendError;
    /**
     * Set the application version
     */
    setVersion(version: string): void;
}
/**
 * Create a health server instance
 */
export declare function createHealthServer(options: HealthServerOptions): HealthServer;
//# sourceMappingURL=health.d.ts.map