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
    tmpDir: TMP_DIR,
    workerStatus,
    containerId,
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

  try {
    // Execute the orchestrated workflow
    await orchestrator.execute(request, res);

    console.log(`[Container ${containerId}] Execution completed successfully`);

    // Exit process after successful completion (ephemeral container model)
    console.log(`[Container ${containerId}] Exiting process in 1 second...`);
    setTimeout(() => process.exit(0), 1000);
  } catch (error) {
    console.error(`[Container ${containerId}] Execution failed:`, error);

    // Exit process after error (ephemeral container model)
    console.log(`[Container ${containerId}] Exiting process in 1 second...`);
    setTimeout(() => process.exit(1), 1000);
  }
});

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
      'POST /execute'
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

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[Container ${containerId}] SIGTERM received, shutting down gracefully...`);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(`[Container ${containerId}] SIGINT received, shutting down gracefully...`);
  process.exit(0);
});
