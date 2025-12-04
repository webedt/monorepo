import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { ExecuteRequest, APIError } from './types';
import { Orchestrator } from './orchestrator';

const app = express();
const PORT = process.env.PORT || 5000;
const TMP_DIR = process.env.TMP_DIR || '/tmp';
const DB_BASE_URL = process.env.DB_BASE_URL;

// Container identification (Docker sets HOSTNAME to container ID)
const containerId = process.env.HOSTNAME || 'unknown';

// Build information (set at build time via Docker build args)
const BUILD_COMMIT_SHA = process.env.BUILD_COMMIT_SHA || 'unknown';
const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || 'unknown';
const BUILD_IMAGE_TAG = process.env.BUILD_IMAGE_TAG || 'unknown';

// Default coding assistant credentials from environment (optional fallback)
const DEFAULT_CODING_ASSISTANT_PROVIDER = process.env.CODING_ASSISTANT_PROVIDER;
const DEFAULT_CODING_ASSISTANT_AUTHENTICATION = process.env.CODING_ASSISTANT_AUTHENTICATION;

// Default GitHub token from environment (optional fallback)
const DEFAULT_GITHUB_ACCESS_TOKEN = process.env.GITHUB_ACCESS_TOKEN;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Worker state
let workerStatus: 'idle' | 'busy' = 'idle';
let activeExecution: Promise<void> | null = null;
let shutdownRequested = false;
let activeAbortController: AbortController | null = null;
let activeSessionId: string | null = null;

// Create orchestrator instance
const orchestrator = new Orchestrator(TMP_DIR, DB_BASE_URL);

/**
 * Redact sensitive tokens from logs
 * @param value - Value to redact (string or object)
 * @returns Redacted value
 */
function redactSensitiveData(value: any): string {
  if (!value) return 'N/A';

  const str = typeof value === 'string' ? value : JSON.stringify(value);

  // Redact OAuth access tokens (sk-ant-oat01-...)
  const redacted = str
    .replace(/sk-ant-oat01-[A-Za-z0-9_-]+/g, 'sk-ant-oat01-***REDACTED***')
    .replace(/sk-ant-ort01-[A-Za-z0-9_-]+/g, 'sk-ant-ort01-***REDACTED***')
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-***REDACTED***')
    .replace(/gho_[A-Za-z0-9_-]+/g, 'gho_***REDACTED***')
    .replace(/ghp_[A-Za-z0-9_-]+/g, 'ghp_***REDACTED***')
    .replace(/"accessToken":"[^"]+"/g, '"accessToken":"***REDACTED***"')
    .replace(/"refreshToken":"[^"]+"/g, '"refreshToken":"***REDACTED***"');

  return redacted;
}

// Initialize orchestrator (MinIO bucket setup)
orchestrator.initialize().catch(err => {
  console.error('[Server] Failed to initialize orchestrator:', err);
  process.exit(1);
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.setHeader('X-Container-ID', containerId);
  res.json({
    status: 'ok',
    service: 'ai-coding-worker',
    tmpDir: TMP_DIR,
    workerStatus,
    containerId,
    build: {
      commitSha: BUILD_COMMIT_SHA,
      timestamp: BUILD_TIMESTAMP,
      imageTag: BUILD_IMAGE_TAG,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * Status endpoint - returns whether worker is idle or busy
 */
app.get('/status', (req: Request, res: Response) => {
  res.setHeader('X-Container-ID', containerId);
  res.json({
    status: workerStatus,
    containerId,
    timestamp: new Date().toISOString(),
  });
});

/**
 * List all sessions
 * Returns array of session IDs from MinIO
 */
app.get('/sessions', async (req: Request, res: Response) => {
  res.setHeader('X-Container-ID', containerId);
  try {
    const sessionIds = await orchestrator.listSessions();

    res.json({
      count: sessionIds.length,
      sessions: sessionIds.map(id => ({ sessionId: id, storage: 'minio' })),
      containerId
    });
  } catch (error) {
    console.error(`[Container ${containerId}] Error listing sessions:`, error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to list sessions',
      containerId
    });
  }
});

/**
 * Delete a session
 * Removes session from MinIO storage
 */
app.delete('/sessions/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  res.setHeader('X-Container-ID', containerId);

  try {
    await orchestrator.deleteSession(sessionId);

    res.json({
      sessionId,
      deleted: true,
      containerId
    });
  } catch (error) {
    console.error(`[Container ${containerId}] Error deleting session ${sessionId}:`, error);
    res.status(500).json({
      error: 'internal_error',
      message: 'Failed to delete session',
      containerId
    });
  }
});

/**
 * Unified execute endpoint
 * Handles all coding assistant operations via JSON payload
 *
 * Request modes (implicit from payload):
 * 1. Simple: Just userRequest + provider + token
 * 2. GitHub: Include github object to clone/pull repo
 * 3. Resume: Include resumeSessionId to continue session
 * 4. Full: GitHub + database persistence
 */
app.post('/execute', async (req: Request, res: Response) => {
  console.log(`[Container ${containerId}] Received execute request`);
  console.log(`[Container ${containerId}] Current status: ${workerStatus}`);

  // Check if worker is busy
  if (workerStatus === 'busy') {
    console.log(`[Container ${containerId}] Rejecting request - worker busy`);
    res.setHeader('X-Container-ID', containerId);
    const error: APIError = {
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    };
    res.status(429).json(error);
    return;
  }

  // Set worker to busy IMMEDIATELY to prevent race conditions
  workerStatus = 'busy';
  console.log(`[Container ${containerId}] Status changed to: busy`);

  // Parse request
  const request: ExecuteRequest = req.body;

  // Basic validation (reset worker status if validation fails)
  if (!request.userRequest) {
    workerStatus = 'idle';
    const error: APIError = {
      error: 'invalid_request',
      message: 'Missing required field: userRequest',
      field: 'userRequest'
    };
    res.status(400).json(error);
    return;
  }

  // Use environment variables as fallback for provider and authentication
  if (!request.codingAssistantProvider || request.codingAssistantProvider === 'FROM_ENV') {
    if (DEFAULT_CODING_ASSISTANT_PROVIDER) {
      request.codingAssistantProvider = DEFAULT_CODING_ASSISTANT_PROVIDER;
      console.log('[Server] Using CODING_ASSISTANT_PROVIDER from environment');
    } else {
      workerStatus = 'idle';
      const error: APIError = {
        error: 'invalid_request',
        message: 'Missing required field: codingAssistantProvider (not in request or environment)',
        field: 'codingAssistantProvider'
      };
      res.status(400).json(error);
      return;
    }
  }

  if (!request.codingAssistantAuthentication || request.codingAssistantAuthentication === 'FROM_ENV') {
    if (DEFAULT_CODING_ASSISTANT_AUTHENTICATION) {
      request.codingAssistantAuthentication = DEFAULT_CODING_ASSISTANT_AUTHENTICATION;
      console.log('[Server] Using CODING_ASSISTANT_AUTHENTICATION from environment');
    } else {
      workerStatus = 'idle';
      const error: APIError = {
        error: 'invalid_request',
        message: 'Missing required field: codingAssistantAuthentication (not in request or environment)',
        field: 'codingAssistantAuthentication'
      };
      res.status(400).json(error);
      return;
    }
  }

  // Use environment variable as fallback for GitHub access token
  if (request.github && (!request.github.accessToken || request.github.accessToken === 'FROM_ENV')) {
    if (DEFAULT_GITHUB_ACCESS_TOKEN) {
      request.github.accessToken = DEFAULT_GITHUB_ACCESS_TOKEN;
      console.log('[Server] Using GITHUB_ACCESS_TOKEN from environment');
    }
  }

  // Check if shutdown was requested - reject new work
  if (shutdownRequested) {
    workerStatus = 'idle';
    console.log(`[Container ${containerId}] Rejecting request - shutdown in progress`);
    const error: APIError = {
      error: 'shutting_down',
      message: 'Worker is shutting down, please retry with another worker',
      retryAfter: 1,
      containerId
    };
    res.status(503).json(error);
    return;
  }

  // Create abort controller for this execution
  activeAbortController = new AbortController();
  activeSessionId = request.websiteSessionId || null;

  console.log(`[Container ${containerId}] Starting execution`);
  console.log(`[Container ${containerId}] Provider: ${request.codingAssistantProvider}`);

  // Handle logging for both string and structured content
  const requestPreview = typeof request.userRequest === 'string'
    ? request.userRequest.substring(0, 100)
    : `[Structured content with ${request.userRequest.length} blocks]`;
  console.log(`[Container ${containerId}] Request: ${requestPreview}...`);

  // Log full request parameters for debugging (with redaction)
  console.log(`[Container ${containerId}] Full request payload:`);
  console.log('  - userRequest:', typeof request.userRequest === 'string'
    ? request.userRequest
    : `[Structured content with ${request.userRequest.length} blocks - ${request.userRequest.filter(b => b.type === 'image').length} images]`);
  console.log('  - codingAssistantProvider:', request.codingAssistantProvider);
  console.log('  - codingAssistantAuthentication type:', typeof request.codingAssistantAuthentication);
  console.log('  - codingAssistantAuthentication value:', redactSensitiveData(request.codingAssistantAuthentication).substring(0, 200) + '...');
  console.log('  - websiteSessionId:', request.websiteSessionId || 'N/A');
  console.log('  - github:', request.github ? redactSensitiveData(request.github) : 'N/A');
  console.log('  - database:', request.database ? 'Configured' : 'N/A');
  console.log('  - providerOptions:', request.providerOptions ? JSON.stringify(request.providerOptions) : 'N/A');

  // Normalize codingAssistantAuthentication to string (handle both object and string formats)
  if (typeof request.codingAssistantAuthentication === 'object') {
    console.log(`[Container ${containerId}] Converting codingAssistantAuthentication from object to string`);
    request.codingAssistantAuthentication = JSON.stringify(request.codingAssistantAuthentication);
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Container-ID', containerId);

  // Track the execution promise for graceful shutdown
  // Note: Worker will NEVER become idle again after execute starts - it will exit
  const abortSignal = activeAbortController.signal;
  const executionPromise = (async () => {
    let exitCode = 0;
    try {
      // Execute the orchestrated workflow with abort signal
      await orchestrator.execute(request, req, res, abortSignal);
      console.log(`[Container ${containerId}] Execution completed successfully`);
    } catch (error) {
      // Check if this was an abort
      if (abortSignal.aborted) {
        console.log(`[Container ${containerId}] Execution was aborted`);
      } else {
        console.error(`[Container ${containerId}] Execution failed:`, error);
      }
      exitCode = 1;
    } finally {
      // Clean up abort controller
      activeAbortController = null;
      activeSessionId = null;
    }

    // Exit process after completion (ephemeral container model)
    // Worker never becomes idle again - it always exits after execute
    await gracefulExit(exitCode);
  })();

  activeExecution = executionPromise;
});

/**
 * Initialize repository endpoint - clones a repository and uploads to storage
 * This is a lightweight operation that doesn't run AI, just prepares the workspace
 * Used when opening the Code view for a new session
 */
app.post('/init-repository', async (req: Request, res: Response) => {
  console.log(`[Container ${containerId}] Received init-repository request`);
  res.setHeader('X-Container-ID', containerId);

  // Check if worker is busy
  if (workerStatus === 'busy') {
    console.log(`[Container ${containerId}] Rejecting init-repository - worker busy`);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  const { websiteSessionId, github } = req.body;

  // Validate required fields
  if (!websiteSessionId) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: websiteSessionId',
      containerId
    });
    return;
  }

  if (!github?.repoUrl || !github?.branch || !github?.accessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required github fields: repoUrl, branch, accessToken',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  console.log(`[Container ${containerId}] Starting repository initialization for session: ${websiteSessionId}`);

  try {
    // Initialize the repository using the orchestrator's method
    const result = await orchestrator.initializeRepository({
      websiteSessionId,
      github: {
        repoUrl: github.repoUrl,
        branch: github.branch,
        accessToken: github.accessToken,
      }
    });

    console.log(`[Container ${containerId}] Repository initialized successfully:`, result);

    res.json({
      success: true,
      sessionId: websiteSessionId,
      repository: {
        clonedPath: result.clonedPath,
        branch: result.branch,
        wasCloned: result.wasCloned,
      },
      containerId
    });

    // Exit after successful initialization (ephemeral container model)
    await gracefulExit(0);

  } catch (error) {
    console.error(`[Container ${containerId}] Failed to initialize repository:`, error);

    res.status(500).json({
      error: 'init_failed',
      message: error instanceof Error ? error.message : 'Failed to initialize repository',
      containerId
    });

    // Exit with error code
    await gracefulExit(1);
  }
});

/**
 * Abort endpoint - allows client to abort the currently running execution
 * This will signal the Claude Agent SDK to stop processing
 */
app.post('/abort', (req: Request, res: Response) => {
  const { sessionId } = req.body;
  console.log(`[Container ${containerId}] Abort requested for session: ${sessionId || 'any'}`);
  res.setHeader('X-Container-ID', containerId);

  if (workerStatus === 'idle') {
    res.json({ status: 'ok', message: 'Worker was idle, nothing to abort' });
    return;
  }

  // Verify session ID matches if provided
  if (sessionId && activeSessionId && sessionId !== activeSessionId) {
    res.status(400).json({
      status: 'error',
      message: `Session mismatch: worker is processing ${activeSessionId}, not ${sessionId}`,
      containerId
    });
    return;
  }

  // Abort the active execution
  if (activeAbortController) {
    console.log(`[Container ${containerId}] Aborting execution for session: ${activeSessionId}`);
    activeAbortController.abort();
    res.json({
      status: 'ok',
      message: 'Abort signal sent',
      sessionId: activeSessionId,
      containerId
    });
  } else {
    res.json({
      status: 'ok',
      message: 'No active abort controller, but worker is busy',
      containerId
    });
  }
});

/**
 * Shutdown endpoint - allows client to signal worker can exit immediately
 * Client calls this after receiving all SSE events to speed up worker recycling
 */
app.post('/shutdown', (req: Request, res: Response) => {
  console.log(`[Container ${containerId}] Shutdown requested by client`);
  res.setHeader('X-Container-ID', containerId);

  if (workerStatus === 'idle') {
    res.json({ status: 'ok', message: 'Worker was idle, shutting down' });
    process.exit(0);
  } else {
    // Worker is busy - mark for immediate shutdown after current work completes
    shutdownRequested = true;
    res.json({ status: 'ok', message: 'Worker will shutdown after current execution completes' });
  }
});

/**
 * Gracefully exit the process after ensuring all I/O is flushed
 * If shutdownRequested is true (client signaled ready), exit faster
 */
async function gracefulExit(code: number): Promise<void> {
  console.log(`[Container ${containerId}] Preparing graceful exit (code: ${code})...`);

  // Give a moment for any final writes to complete
  await new Promise(resolve => setImmediate(resolve));

  // Flush stdout/stderr
  await new Promise<void>((resolve) => {
    if (process.stdout.write('')) {
      resolve();
    } else {
      process.stdout.once('drain', resolve);
    }
  });

  await new Promise<void>((resolve) => {
    if (process.stderr.write('')) {
      resolve();
    } else {
      process.stderr.once('drain', resolve);
    }
  });

  // If client requested shutdown, they've confirmed receipt - exit quickly
  if (shutdownRequested) {
    console.log(`[Container ${containerId}] Client confirmed receipt, exiting immediately`);
    process.exit(code);
  }

  // Otherwise wait for network buffers to flush (client might still be reading)
  console.log(`[Container ${containerId}] Waiting 10 seconds for client to receive all data...`);
  await new Promise(resolve => setTimeout(resolve, 10000));

  process.exit(code);
}

/**
 * Catch-all for undefined routes
 */
app.use((req: Request, res: Response) => {
  res.setHeader('X-Container-ID', containerId);
  res.status(404).json({
    error: 'not_found',
    message: `Endpoint not found: ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET  /health',
      'GET  /status',
      'GET  /sessions',
      'GET  /sessions/:sessionId',
      'GET  /sessions/:sessionId/stream',
      'POST /execute',
      'POST /init-repository',
      'POST /abort',
      'POST /shutdown'
    ],
    containerId
  });
});

/**
 * Start the server
 */
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 Unified Coding Assistant Worker (MinIO Storage)');
  console.log('='.repeat(60));
  console.log(`🆔 Container ID: ${containerId}`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`📁 Temp directory: ${TMP_DIR}`);
  console.log(`🗄️  Storage: MinIO (${process.env.MINIO_ENDPOINT || 'Not configured'})`);
  console.log(`💾 Database URL: ${DB_BASE_URL || 'Not configured'}`);
  console.log(`📊 Status: ${workerStatus}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  GET    /health                    - Health check');
  console.log('  GET    /status                    - Worker status (idle/busy)');
  console.log('  GET    /sessions                  - List all sessions (from MinIO)');
  console.log('  DELETE /sessions/:id              - Delete a session');
  console.log('  POST   /execute                   - Execute coding assistant request');
  console.log('  POST   /init-repository           - Clone repo and upload to storage (no AI)');
  console.log('  POST   /abort                     - Abort current execution');
  console.log('  POST   /shutdown                  - Signal worker to shutdown (client confirms receipt)');
  console.log('');
  console.log('Supported providers:');
  console.log('  - claude-code');
  console.log('  - codex / cursor');
  console.log('');
  console.log('Worker behavior:');
  console.log('  - Ephemeral: exits after completing each job');
  console.log('  - Returns 429 if busy (load balancer will retry)');
  console.log('  - Sessions stored in MinIO for complete isolation');
  console.log('  - Downloads session at start, uploads at end');
  console.log('  - Container tracking via X-Container-ID header');
  console.log('='.repeat(60));
});

// Graceful shutdown handler
async function handleShutdownSignal(signal: string): Promise<void> {
  console.log(`[Container ${containerId}] ${signal} received, initiating graceful shutdown...`);

  // Mark shutdown as requested to reject new work
  shutdownRequested = true;

  if (activeExecution) {
    console.log(`[Container ${containerId}] Waiting for active execution to complete...`);

    // Give the execution time to complete (max 60 seconds)
    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        console.log(`[Container ${containerId}] Shutdown timeout reached, forcing exit...`);
        resolve();
      }, 60000);
    });

    await Promise.race([activeExecution, timeout]);
    console.log(`[Container ${containerId}] Active execution finished or timed out`);
  } else {
    console.log(`[Container ${containerId}] No active execution, exiting immediately`);
  }

  process.exit(0);
}

process.on('SIGTERM', () => {
  handleShutdownSignal('SIGTERM');
});

process.on('SIGINT', () => {
  handleShutdownSignal('SIGINT');
});
