/**
 * Monitoring HTTP server for health checks and metrics endpoints.
 * Provides Prometheus-compatible /metrics endpoint and /health endpoint.
 */
export interface MonitoringServerOptions {
    port: number;
    host?: string;
}
export interface HealthCheckResult {
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
        name: string;
        status: 'pass' | 'fail';
        message?: string;
        responseTime?: number;
    }[];
    uptime: number;
    timestamp: string;
    version?: string;
}
export type HealthCheckFn = () => Promise<{
    name: string;
    status: 'pass' | 'fail';
    message?: string;
}>;
/**
 * Monitoring server that exposes health and metrics endpoints
 */
export declare class MonitoringServer {
    private server;
    private options;
    private healthChecks;
    private startTime;
    private version;
    private isShuttingDown;
    constructor(options: MonitoringServerOptions);
    /**
     * Register a health check function
     */
    registerHealthCheck(check: HealthCheckFn): void;
    /**
     * Start the monitoring server
     */
    start(): Promise<void>;
    /**
     * Stop the monitoring server
     */
    stop(): Promise<void>;
    /**
     * Handle incoming HTTP requests
     */
    private handleRequest;
    /**
     * Handle /health endpoint
     */
    private handleHealth;
    /**
     * Handle /ready endpoint (for Kubernetes readiness probes)
     */
    private handleReady;
    /**
     * Handle /metrics endpoint
     */
    private handleMetrics;
    /**
     * Handle root endpoint
     */
    private handleRoot;
    /**
     * Run all registered health checks
     */
    private runHealthChecks;
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
 * Create a monitoring server instance
 */
export declare function createMonitoringServer(options: MonitoringServerOptions): MonitoringServer;
//# sourceMappingURL=monitoring.d.ts.map