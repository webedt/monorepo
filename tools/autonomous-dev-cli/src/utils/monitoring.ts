/**
 * Monitoring HTTP server for health checks and metrics endpoints.
 * Provides Prometheus-compatible /metrics endpoint and /health endpoint.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'http';
import { logger } from './logger.js';
import { metrics } from './metrics.js';

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

export type HealthCheckFn = () => Promise<{ name: string; status: 'pass' | 'fail'; message?: string }>;

/**
 * Monitoring server that exposes health and metrics endpoints
 */
export class MonitoringServer {
  private server: Server | null = null;
  private options: MonitoringServerOptions;
  private healthChecks: HealthCheckFn[] = [];
  private startTime: number = Date.now();
  private version: string = '0.1.0';
  private isShuttingDown: boolean = false;

  constructor(options: MonitoringServerOptions) {
    this.options = {
      host: '0.0.0.0',
      ...options,
    };
  }

  /**
   * Register a health check function
   */
  registerHealthCheck(check: HealthCheckFn): void {
    this.healthChecks.push(check);
  }

  /**
   * Start the monitoring server
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.warn(`Monitoring port ${this.options.port} already in use, skipping monitoring server`);
          resolve();
        } else {
          reject(error);
        }
      });

      this.server.listen(this.options.port, this.options.host, () => {
        logger.info(`Monitoring server started on ${this.options.host}:${this.options.port}`);
        logger.info(`  Health endpoint: http://${this.options.host}:${this.options.port}/health`);
        logger.info(`  Metrics endpoint: http://${this.options.host}:${this.options.port}/metrics`);
        resolve();
      });
    });
  }

  /**
   * Stop the monitoring server
   */
  async stop(): Promise<void> {
    this.isShuttingDown = true;

    return new Promise((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          logger.warn(`Error closing monitoring server: ${error.message}`);
        }
        logger.info('Monitoring server stopped');
        resolve();
      });
    });
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
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

    switch (url.pathname) {
      case '/health':
      case '/healthz':
        this.handleHealth(res);
        break;
      case '/ready':
      case '/readyz':
        this.handleReady(res);
        break;
      case '/metrics':
        this.handleMetrics(res, url.searchParams.get('format'));
        break;
      case '/':
        this.handleRoot(res);
        break;
      default:
        this.sendError(res, 404, 'Not Found');
    }
  }

  /**
   * Handle /health endpoint
   */
  private async handleHealth(res: ServerResponse): Promise<void> {
    try {
      const result = await this.runHealthChecks();
      const statusCode = result.status === 'healthy' ? 200 : result.status === 'degraded' ? 200 : 503;

      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result, null, 2));
    } catch (error: any) {
      this.sendError(res, 500, `Health check error: ${error.message}`);
    }
  }

  /**
   * Handle /ready endpoint (for Kubernetes readiness probes)
   */
  private handleReady(res: ServerResponse): void {
    if (this.isShuttingDown) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'shutting_down' }));
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ready' }));
    }
  }

  /**
   * Handle /metrics endpoint
   */
  private handleMetrics(res: ServerResponse, format: string | null): void {
    if (format === 'json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(metrics.getMetricsJson(), null, 2));
    } else {
      // Default: Prometheus format
      res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
      res.end(metrics.getPrometheusMetrics());
    }
  }

  /**
   * Handle root endpoint
   */
  private handleRoot(res: ServerResponse): void {
    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Autonomous Dev CLI - Monitoring</title>
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
  <h1>Autonomous Dev CLI - Monitoring</h1>
  <ul>
    <li><a href="/health">/health</a> - Health check endpoint (JSON)</li>
    <li><a href="/ready">/ready</a> - Readiness probe endpoint</li>
    <li><a href="/metrics">/metrics</a> - Prometheus metrics</li>
    <li><a href="/metrics?format=json">/metrics?format=json</a> - Metrics as JSON</li>
  </ul>
  <p>Version: ${this.version}</p>
  <p>Uptime: ${Math.floor((Date.now() - this.startTime) / 1000)} seconds</p>
</body>
</html>
`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  }

  /**
   * Run all registered health checks
   */
  private async runHealthChecks(): Promise<HealthCheckResult> {
    const startTime = Date.now();
    const checks: HealthCheckResult['checks'] = [];

    // Run all health checks in parallel
    const results = await Promise.allSettled(
      this.healthChecks.map(async (check) => {
        const checkStart = Date.now();
        const result = await check();
        return {
          ...result,
          responseTime: Date.now() - checkStart,
        };
      })
    );

    // Process results
    let hasFailure = false;
    for (const result of results) {
      if (result.status === 'fulfilled') {
        checks.push(result.value);
        if (result.value.status === 'fail') {
          hasFailure = true;
        }
      } else {
        checks.push({
          name: 'unknown',
          status: 'fail',
          message: result.reason?.message || 'Check failed',
        });
        hasFailure = true;
      }
    }

    // Determine overall status
    let status: HealthCheckResult['status'] = 'healthy';
    if (hasFailure) {
      // If some checks fail but others pass, we're degraded
      const hasPass = checks.some((c) => c.status === 'pass');
      status = hasPass ? 'degraded' : 'unhealthy';
    }

    // Update metrics
    metrics.updateHealthStatus(status === 'healthy');

    return {
      status,
      checks,
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      version: this.version,
    };
  }

  /**
   * Send an error response
   */
  private sendError(res: ServerResponse, statusCode: number, message: string): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
  }

  /**
   * Set the application version
   */
  setVersion(version: string): void {
    this.version = version;
  }
}

/**
 * Create a monitoring server instance
 */
export function createMonitoringServer(options: MonitoringServerOptions): MonitoringServer {
  return new MonitoringServer(options);
}
