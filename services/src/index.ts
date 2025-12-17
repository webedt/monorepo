/**
 * WebEDT Consolidated Services
 *
 * Main entry point for the single-image deployment.
 * Runs website server, internal-api-server, and worker pool in one container.
 *
 * Architecture:
 * - Port 3000: Website (static files + API proxy)
 * - Port 3001: Internal API Server (all API routes)
 * - Ports 5001+: Worker processes (AI coding workers)
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { fork, ChildProcess } from 'child_process';
import { logger } from '@webedt/shared';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================================
// Configuration
// ============================================================================

const WEBSITE_PORT = parseInt(process.env.WEBSITE_PORT || '3000', 10);
const API_PORT = parseInt(process.env.API_PORT || '3001', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const WORKER_POOL_SIZE = parseInt(process.env.WORKER_POOL_SIZE || '2', 10);
const WORKER_BASE_PORT = parseInt(process.env.WORKER_BASE_PORT || '5001', 10);

// Build info
const BUILD_COMMIT_SHA = process.env.BUILD_COMMIT_SHA || 'unknown';
const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || 'unknown';
const BUILD_IMAGE_TAG = process.env.BUILD_IMAGE_TAG || 'unknown';

// CORS configuration
const ALLOWED_ORIGINS = NODE_ENV === 'production'
  ? (process.env.ALLOWED_ORIGINS?.split(',') || ['https://webedt.etdofresh.com'])
  : ['http://localhost:5173', 'http://localhost:3000', 'http://localhost:3001'];

// ============================================================================
// Process Management
// ============================================================================

let internalApiProcess: ChildProcess | null = null;
const workerProcesses: Map<number, ChildProcess> = new Map();
let isShuttingDown = false;

/**
 * Start the Internal API Server as a child process
 */
async function startInternalApiServer(): Promise<void> {
  logger.info('Starting Internal API Server...', { component: 'Main', port: API_PORT });

  // Path to the compiled internal-api-server
  const serverPath = path.join(__dirname, '..', '..', 'internal-api-server', 'dist', 'index.js');

  return new Promise((resolve, reject) => {
    internalApiProcess = fork(serverPath, [], {
      env: {
        ...process.env,
        PORT: String(API_PORT),
        // Disable worker coordinator - we'll use our own worker pool
        USE_WORKER_COORDINATOR: 'false',
        // Tell internal-api-server to use our worker pool
        WORKER_POOL_MODE: 'local',
        WORKER_BASE_PORT: String(WORKER_BASE_PORT),
        WORKER_POOL_SIZE: String(WORKER_POOL_SIZE)
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    // Forward stdout
    internalApiProcess.stdout?.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line: string) => {
        if (line) console.log(`[API] ${line}`);
      });
    });

    // Forward stderr
    internalApiProcess.stderr?.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line: string) => {
        if (line) console.error(`[API] ${line}`);
      });
    });

    // Handle process messages
    internalApiProcess.on('message', (message: any) => {
      if (message.type === 'ready') {
        logger.info('Internal API Server ready', { component: 'Main', port: API_PORT });
        resolve();
      }
    });

    // Handle exit
    internalApiProcess.on('exit', (code, signal) => {
      logger.warn('Internal API Server exited', { component: 'Main', code, signal });
      if (!isShuttingDown) {
        logger.info('Restarting Internal API Server...', { component: 'Main' });
        setTimeout(() => startInternalApiServer(), 1000);
      }
    });

    // Handle errors
    internalApiProcess.on('error', (error) => {
      logger.error('Internal API Server error', error, { component: 'Main' });
      reject(error);
    });

    // Resolve after timeout if no IPC message (server may not send 'ready')
    setTimeout(() => {
      resolve();
    }, 5000);
  });
}

/**
 * Start a worker process
 */
async function startWorker(id: number): Promise<void> {
  const port = WORKER_BASE_PORT + id;
  logger.info('Starting worker...', { component: 'Main', workerId: id, port });

  // Path to the compiled ai-coding-worker
  const workerPath = path.join(__dirname, '..', '..', 'ai-coding-worker', 'dist', 'server.js');

  return new Promise((resolve, reject) => {
    const workerProcess = fork(workerPath, [], {
      env: {
        ...process.env,
        PORT: String(port),
        WORKER_ID: String(id),
        // Point to local internal-api-server
        INTERNAL_API_URL: `http://localhost:${API_PORT}`,
        WORKSPACE_DIR: process.env.WORKSPACE_DIR || '/workspace',
        NODE_ENV
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    workerProcesses.set(id, workerProcess);

    // Forward stdout
    workerProcess.stdout?.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line: string) => {
        if (line) console.log(`[Worker-${id}] ${line}`);
      });
    });

    // Forward stderr
    workerProcess.stderr?.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      lines.forEach((line: string) => {
        if (line) console.error(`[Worker-${id}] ${line}`);
      });
    });

    // Handle exit (workers are ephemeral - restart them)
    workerProcess.on('exit', (code, signal) => {
      logger.info('Worker exited', { component: 'Main', workerId: id, code, signal });
      workerProcesses.delete(id);

      if (!isShuttingDown) {
        // Restart worker after delay
        setTimeout(() => {
          startWorker(id).catch(err => {
            logger.error('Failed to restart worker', err, { component: 'Main', workerId: id });
          });
        }, 1000);
      }
    });

    // Handle errors
    workerProcess.on('error', (error) => {
      logger.error('Worker error', error, { component: 'Main', workerId: id });
    });

    // Resolve after timeout (worker may not send 'ready')
    setTimeout(() => resolve(), 3000);
  });
}

/**
 * Start all worker processes
 */
async function startWorkerPool(): Promise<void> {
  logger.info('Starting worker pool...', {
    component: 'Main',
    poolSize: WORKER_POOL_SIZE,
    basePort: WORKER_BASE_PORT
  });

  const startPromises = [];
  for (let i = 0; i < WORKER_POOL_SIZE; i++) {
    startPromises.push(startWorker(i));
  }

  await Promise.all(startPromises);

  logger.info('Worker pool started', {
    component: 'Main',
    activeWorkers: workerProcesses.size
  });
}

// ============================================================================
// Website Server (Static Files + API Proxy)
// ============================================================================

const app = express();

// CORS
app.use(cors({
  origin: ALLOWED_ORIGINS,
  credentials: true
}));

// Health check (overall service health)
app.get('/health', async (req, res) => {
  const apiHealthy = internalApiProcess !== null && !internalApiProcess.killed;
  const workersHealthy = workerProcesses.size > 0;

  res.json({
    status: apiHealthy && workersHealthy ? 'healthy' : 'degraded',
    service: 'webedt-services',
    components: {
      website: 'healthy',
      internalApi: apiHealthy ? 'healthy' : 'unhealthy',
      workerPool: {
        status: workersHealthy ? 'healthy' : 'unhealthy',
        activeWorkers: workerProcesses.size,
        targetWorkers: WORKER_POOL_SIZE
      }
    },
    build: {
      commitSha: BUILD_COMMIT_SHA,
      timestamp: BUILD_TIMESTAMP,
      imageTag: BUILD_IMAGE_TAG
    },
    timestamp: new Date().toISOString()
  });
});

// Detailed status for debugging
app.get('/health/status', async (req, res) => {
  const workers = Array.from(workerProcesses.entries()).map(([id, proc]) => ({
    id,
    port: WORKER_BASE_PORT + id,
    alive: !proc.killed,
    pid: proc.pid
  }));

  res.json({
    service: 'webedt-services',
    ports: {
      website: WEBSITE_PORT,
      api: API_PORT,
      workers: workers.map(w => w.port)
    },
    processes: {
      internalApi: {
        alive: internalApiProcess !== null && !internalApiProcess.killed,
        pid: internalApiProcess?.pid
      },
      workers
    },
    environment: NODE_ENV,
    build: {
      commitSha: BUILD_COMMIT_SHA,
      timestamp: BUILD_TIMESTAMP,
      imageTag: BUILD_IMAGE_TAG
    }
  });
});

// Worker pool status endpoint
app.get('/workers/status', (req, res) => {
  const workers = Array.from(workerProcesses.entries()).map(([id, proc]) => ({
    id,
    port: WORKER_BASE_PORT + id,
    alive: !proc.killed,
    url: `http://localhost:${WORKER_BASE_PORT + id}`
  }));

  res.json({
    poolSize: WORKER_POOL_SIZE,
    activeWorkers: workerProcesses.size,
    workers
  });
});

// API Proxy - forward /api/* to internal-api-server
app.use('/api', async (req, res) => {
  const targetUrl = `http://localhost:${API_PORT}${req.originalUrl}`;

  try {
    // Forward the request
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') {
        headers[key] = value;
      } else if (Array.isArray(value)) {
        headers[key] = value.join(', ');
      }
    }

    // For SSE endpoints, we need to pipe the response
    const isSSE = req.path.includes('/execute') || req.path.includes('/resume');

    if (isSSE && req.method === 'POST') {
      // Handle SSE streaming
      const fetchResponse = await fetch(targetUrl, {
        method: req.method,
        headers: {
          ...headers,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(req.body)
      });

      // Forward status and headers
      res.status(fetchResponse.status);
      fetchResponse.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      // Pipe the body
      if (fetchResponse.body) {
        const reader = fetchResponse.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        };
        pump().catch(err => {
          console.error('[Proxy] SSE streaming error:', err);
          res.end();
        });
      } else {
        res.end();
      }
    } else {
      // Regular request proxy
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method)
        ? JSON.stringify(req.body)
        : undefined;

      const fetchResponse = await fetch(targetUrl, {
        method: req.method,
        headers: {
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body
      });

      // Forward response
      res.status(fetchResponse.status);
      fetchResponse.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(key, value);
        }
      });

      const responseBody = await fetchResponse.text();
      res.send(responseBody);
    }
  } catch (error) {
    console.error('[Proxy] Error forwarding request:', error);
    res.status(502).json({
      error: 'Proxy Error',
      message: error instanceof Error ? error.message : 'Failed to connect to API server'
    });
  }
});

// Parse JSON for non-API routes (needed for proxy)
app.use(express.json({ limit: '10mb' }));

// Static files - serve React client
const clientDistPath = path.join(__dirname, '..', '..', 'website', 'client', 'dist');
app.use(express.static(clientDistPath));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// ============================================================================
// Startup
// ============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('WebEDT Consolidated Services');
  console.log('='.repeat(70));
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Website Port: ${WEBSITE_PORT}`);
  console.log(`API Port: ${API_PORT}`);
  console.log(`Worker Pool Size: ${WORKER_POOL_SIZE}`);
  console.log(`Worker Base Port: ${WORKER_BASE_PORT}`);
  console.log('');
  console.log('Build Info:');
  console.log(`  Commit: ${BUILD_COMMIT_SHA}`);
  console.log(`  Timestamp: ${BUILD_TIMESTAMP}`);
  console.log(`  Image Tag: ${BUILD_IMAGE_TAG}`);
  console.log('');

  try {
    // Start internal API server
    await startInternalApiServer();
    console.log(`[Main] Internal API Server started on port ${API_PORT}`);

    // Start worker pool
    await startWorkerPool();
    console.log(`[Main] Worker pool started with ${workerProcesses.size} workers`);

    // Start website server
    app.listen(WEBSITE_PORT, () => {
      console.log('');
      console.log('='.repeat(70));
      console.log('All services started successfully!');
      console.log('='.repeat(70));
      console.log('');
      console.log('Endpoints:');
      console.log(`  Website:      http://localhost:${WEBSITE_PORT}`);
      console.log(`  API:          http://localhost:${WEBSITE_PORT}/api/*`);
      console.log(`  Health:       http://localhost:${WEBSITE_PORT}/health`);
      console.log(`  Status:       http://localhost:${WEBSITE_PORT}/health/status`);
      console.log(`  Workers:      http://localhost:${WEBSITE_PORT}/workers/status`);
      console.log('');
      console.log('Worker Pool:');
      for (let i = 0; i < WORKER_POOL_SIZE; i++) {
        console.log(`  Worker ${i}:    http://localhost:${WORKER_BASE_PORT + i}`);
      }
      console.log('='.repeat(70));
    });

  } catch (error) {
    console.error('[Main] Failed to start services:', error);
    process.exit(1);
  }
}

// ============================================================================
// Graceful Shutdown
// ============================================================================

async function shutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Main] ${signal} received, shutting down gracefully...`);

  // Stop workers
  for (const [id, proc] of workerProcesses) {
    console.log(`[Main] Stopping worker ${id}...`);
    proc.kill('SIGTERM');
  }

  // Stop internal API server
  if (internalApiProcess) {
    console.log('[Main] Stopping Internal API Server...');
    internalApiProcess.kill('SIGTERM');
  }

  // Wait for processes to exit
  await new Promise(resolve => setTimeout(resolve, 3000));

  console.log('[Main] Shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the application
main();
