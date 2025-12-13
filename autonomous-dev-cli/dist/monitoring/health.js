/**
 * Health check and status monitoring module.
 * Provides HTTP endpoints for external monitoring of daemon health.
 */
import { createServer } from 'http';
import { logger } from '../utils/logger.js';
import { metrics } from '../utils/metrics.js';
import * as os from 'os';
/**
 * Health check server for daemon monitoring
 */
export class HealthServer {
    server = null;
    options;
    healthChecks = [];
    startTime = new Date();
    version = '0.1.0';
    isShuttingDown = false;
    stateProvider = null;
    constructor(options) {
        this.options = {
            host: '0.0.0.0',
            ...options,
        };
    }
    /**
     * Set the daemon state provider for accessing runtime status
     */
    setStateProvider(provider) {
        this.stateProvider = provider;
    }
    /**
     * Register a health check function
     */
    registerHealthCheck(check) {
        this.healthChecks.push(check);
    }
    /**
     * Start the health server
     */
    async start() {
        return new Promise((resolve, reject) => {
            this.server = createServer((req, res) => this.handleRequest(req, res));
            this.server.on('error', (error) => {
                if (error.code === 'EADDRINUSE') {
                    logger.warn(`Health server port ${this.options.port} already in use`);
                    resolve();
                }
                else {
                    reject(error);
                }
            });
            this.server.listen(this.options.port, this.options.host, () => {
                logger.info(`Health server started on ${this.options.host}:${this.options.port}`);
                logger.info(`  Health endpoint: http://${this.options.host}:${this.options.port}/health`);
                logger.info(`  Status endpoint: http://${this.options.host}:${this.options.port}/status`);
                logger.info(`  Metrics endpoint: http://${this.options.host}:${this.options.port}/metrics`);
                resolve();
            });
        });
    }
    /**
     * Stop the health server
     */
    async stop() {
        this.isShuttingDown = true;
        return new Promise((resolve) => {
            if (!this.server) {
                resolve();
                return;
            }
            this.server.close((error) => {
                if (error) {
                    logger.warn(`Error closing health server: ${error.message}`);
                }
                logger.info('Health server stopped');
                resolve();
            });
        });
    }
    /**
     * Get the server port
     */
    getPort() {
        return this.options.port;
    }
    /**
     * Check if server is running
     */
    isRunning() {
        return this.server !== null && !this.isShuttingDown;
    }
    /**
     * Handle incoming HTTP requests
     */
    handleRequest(req, res) {
        const startTime = Date.now();
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        // Set CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method !== 'GET') {
            this.sendError(res, 405, 'Method Not Allowed');
            return;
        }
        // Route requests
        switch (url.pathname) {
            case '/health':
            case '/healthz':
                this.handleHealth(req, res, startTime);
                break;
            case '/status':
                this.handleStatus(req, res);
                break;
            case '/metrics':
                this.handleMetrics(req, res, url.searchParams.get('format'));
                break;
            case '/ready':
            case '/readyz':
                this.handleReady(res);
                break;
            case '/live':
            case '/livez':
                this.handleLive(res);
                break;
            case '/':
                this.handleRoot(res);
                break;
            default:
                this.sendError(res, 404, 'Not Found');
        }
    }
    /**
     * Handle /health endpoint - responds within 100ms target
     */
    async handleHealth(req, res, startTime) {
        try {
            const result = await this.runHealthChecks();
            const responseTime = Date.now() - startTime;
            // Target is 100ms response time
            if (responseTime > 100) {
                logger.warn(`Health check response time exceeded target: ${responseTime}ms`);
            }
            const statusCode = result.status === 'healthy' ? 200 : result.status === 'degraded' ? 200 : 503;
            res.writeHead(statusCode, {
                'Content-Type': 'application/json',
                'X-Response-Time': `${responseTime}ms`,
            });
            res.end(JSON.stringify(result, null, 2));
        }
        catch (error) {
            this.sendError(res, 500, `Health check error: ${error.message}`);
        }
    }
    /**
     * Handle /status endpoint - detailed metrics
     */
    async handleStatus(req, res) {
        try {
            const status = this.getDetailedStatus();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(status, null, 2));
        }
        catch (error) {
            this.sendError(res, 500, `Status check error: ${error.message}`);
        }
    }
    /**
     * Handle /metrics endpoint - Prometheus format
     */
    handleMetrics(req, res, format) {
        if (format === 'json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(metrics.getMetricsJson(), null, 2));
        }
        else {
            // Default: Prometheus format
            res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
            res.end(metrics.getPrometheusMetrics());
        }
    }
    /**
     * Handle /ready endpoint (Kubernetes readiness probe)
     */
    handleReady(res) {
        if (this.isShuttingDown) {
            res.writeHead(503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'shutting_down' }));
        }
        else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ready' }));
        }
    }
    /**
     * Handle /live endpoint (Kubernetes liveness probe)
     */
    handleLive(res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'alive' }));
    }
    /**
     * Handle root endpoint
     */
    handleRoot(res) {
        const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Autonomous Dev CLI - Health Monitoring</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 600px; margin: 2rem auto; padding: 1rem; }
    h1 { color: #333; }
    a { color: #0066cc; }
    ul { list-style: none; padding: 0; }
    li { margin: 0.5rem 0; padding: 0.5rem; background: #f5f5f5; border-radius: 4px; }
    code { background: #e8e8e8; padding: 0.2rem 0.4rem; border-radius: 2px; }
  </style>
</head>
<body>
  <h1>Autonomous Dev CLI - Health Monitoring</h1>
  <ul>
    <li><a href="/health">/health</a> - Health check endpoint (JSON, &lt;100ms)</li>
    <li><a href="/status">/status</a> - Detailed status with metrics (JSON)</li>
    <li><a href="/metrics">/metrics</a> - Prometheus metrics</li>
    <li><a href="/metrics?format=json">/metrics?format=json</a> - Metrics as JSON</li>
    <li><a href="/ready">/ready</a> - Kubernetes readiness probe</li>
    <li><a href="/live">/live</a> - Kubernetes liveness probe</li>
  </ul>
  <p>Version: ${this.version}</p>
  <p>Uptime: ${Math.floor((Date.now() - this.startTime.getTime()) / 1000)} seconds</p>
</body>
</html>
`;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(html);
    }
    /**
     * Run all registered health checks
     */
    async runHealthChecks() {
        const checks = [];
        let hasFailure = false;
        let hasWarn = false;
        // Run all health checks in parallel with timeout
        const checkPromises = this.healthChecks.map(async (check) => {
            const checkStart = Date.now();
            try {
                const result = await Promise.race([
                    check(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Health check timeout')), 5000)),
                ]);
                return {
                    ...result,
                    responseTime: Date.now() - checkStart,
                };
            }
            catch (error) {
                return {
                    name: 'unknown',
                    status: 'fail',
                    message: error.message,
                    responseTime: Date.now() - checkStart,
                };
            }
        });
        const results = await Promise.allSettled(checkPromises);
        for (const result of results) {
            if (result.status === 'fulfilled') {
                checks.push(result.value);
                if (result.value.status === 'fail') {
                    hasFailure = true;
                }
                else if (result.value.status === 'warn') {
                    hasWarn = true;
                }
            }
            else {
                checks.push({
                    name: 'unknown',
                    status: 'fail',
                    message: result.reason?.message || 'Check failed',
                });
                hasFailure = true;
            }
        }
        // Get daemon and worker pool status
        const daemonStatus = this.stateProvider?.getDaemonStatus() ?? this.getDefaultDaemonStatus();
        const workerPoolStatus = this.stateProvider?.getWorkerPoolStatus() ?? this.getDefaultWorkerPoolStatus();
        // Determine overall status
        let status = 'healthy';
        if (hasFailure) {
            const hasPass = checks.some((c) => c.status === 'pass');
            status = hasPass ? 'degraded' : 'unhealthy';
        }
        else if (hasWarn) {
            status = 'degraded';
        }
        // Update metrics
        metrics.updateHealthStatus(status === 'healthy');
        return {
            status,
            daemon: daemonStatus,
            workerPool: workerPoolStatus,
            checks,
            timestamp: new Date().toISOString(),
        };
    }
    /**
     * Get detailed status information
     */
    getDetailedStatus() {
        const daemonStatus = this.stateProvider?.getDaemonStatus() ?? this.getDefaultDaemonStatus();
        const workerPoolStatus = this.stateProvider?.getWorkerPoolStatus() ?? this.getDefaultWorkerPoolStatus();
        const errorMetrics = this.stateProvider?.getErrorMetrics() ?? this.getDefaultErrorMetrics();
        const services = this.stateProvider?.getServiceHealth() ?? [];
        return {
            daemon: daemonStatus,
            workerPool: workerPoolStatus,
            system: this.getSystemMetrics(),
            errors: errorMetrics,
            services,
            timestamp: new Date().toISOString(),
        };
    }
    /**
     * Get system metrics
     */
    getSystemMetrics() {
        const memUsage = process.memoryUsage();
        const totalMemoryMB = Math.round(os.totalmem() / (1024 * 1024));
        const freeMemoryMB = Math.round(os.freemem() / (1024 * 1024));
        const usedMemoryMB = totalMemoryMB - freeMemoryMB;
        return {
            memoryUsageMB: usedMemoryMB,
            memoryTotalMB: totalMemoryMB,
            memoryPercent: Math.round((usedMemoryMB / totalMemoryMB) * 100),
            cpuCores: os.cpus().length,
            loadAverage: os.loadavg(),
            heapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024)),
            heapTotalMB: Math.round(memUsage.heapTotal / (1024 * 1024)),
        };
    }
    /**
     * Get default daemon status when no provider is set
     */
    getDefaultDaemonStatus() {
        return {
            status: 'stopped',
            cycleCount: 0,
            lastCycleTime: null,
            lastCycleSuccess: null,
            lastCycleDuration: null,
            startTime: this.startTime,
            uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
            version: this.version,
        };
    }
    /**
     * Get default worker pool status
     */
    getDefaultWorkerPoolStatus() {
        return {
            activeWorkers: 0,
            queuedTasks: 0,
            completedTasks: 0,
            failedTasks: 0,
            maxWorkers: 0,
            isRunning: false,
        };
    }
    /**
     * Get default error metrics
     */
    getDefaultErrorMetrics() {
        return {
            totalErrors: 0,
            recentErrorRate: 0,
            lastErrorTime: null,
            errorsByType: {},
        };
    }
    /**
     * Send an error response
     */
    sendError(res, statusCode, message) {
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
    }
    /**
     * Set the application version
     */
    setVersion(version) {
        this.version = version;
    }
}
/**
 * Create a health server instance
 */
export function createHealthServer(options) {
    return new HealthServer(options);
}
//# sourceMappingURL=health.js.map