import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import { ExecuteRequest, APIError } from './types';
import { Orchestrator } from './orchestrator';
import {
  OpenRouterCompletionProvider,
  getCompletionWithCache,
  CompletionRequest,
  CompletionResponse,
} from './providers/OpenRouterCompletionProvider';

const app = express();
const PORT = process.env.PORT || 5000;

// Container identification (Docker sets HOSTNAME to container ID)
const containerId = process.env.HOSTNAME || 'unknown';

// Build information (set at build time via Docker build args)
const BUILD_COMMIT_SHA = process.env.BUILD_COMMIT_SHA || 'unknown';
const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || 'unknown';
const BUILD_IMAGE_TAG = process.env.BUILD_IMAGE_TAG || 'unknown';

// Default coding assistant credentials from environment (optional fallback)
const DEFAULT_CODING_ASSISTANT_PROVIDER = process.env.CODING_ASSISTANT_PROVIDER;
const DEFAULT_CODING_ASSISTANT_AUTHENTICATION = process.env.CODING_ASSISTANT_AUTHENTICATION;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Worker state
let workerStatus: 'idle' | 'busy' = 'idle';
let activeExecution: Promise<void> | null = null;
let shutdownRequested = false;
let activeAbortController: AbortController | null = null;
let activeSessionId: string | null = null;

// Create orchestrator instance (simplified - no longer needs TMP_DIR or DB_BASE_URL)
const orchestrator = new Orchestrator();

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
 * Execute endpoint - runs LLM against a workspace
 *
 * This is now a simplified LLM execution engine. All session management
 * (storage, GitHub operations) is handled by internal-api-server.
 *
 * Required fields:
 * - userRequest: The prompt/request for the LLM
 * - codingAssistantProvider: The LLM provider to use
 * - codingAssistantAuthentication: Auth credentials for the provider
 * - workspacePath: Path to the workspace directory (provided by internal-api-server)
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
  console.log('  - workspacePath:', request.workspacePath || 'N/A');
  console.log('  - websiteSessionId:', request.websiteSessionId || 'N/A');
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
 * One-off LLM query endpoint
 * Creates a temporary session, runs a quick LLM query, and returns the result
 * Used for generating session titles, branch names, commit messages, etc.
 * This does NOT exit the worker after completion (lightweight operation)
 */
app.post('/query', async (req: Request, res: Response) => {
  console.log(`[Container ${containerId}] Received query request`);
  res.setHeader('X-Container-ID', containerId);

  // Check if worker is busy with a full execution
  if (workerStatus === 'busy') {
    console.log(`[Container ${containerId}] Rejecting query - worker busy`);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  const {
    prompt,
    codingAssistantProvider,
    codingAssistantAuthentication,
    queryType // 'session_title_branch' | 'commit_message'
  } = req.body;

  // Validate required fields
  if (!prompt) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: prompt',
      containerId
    });
    return;
  }

  // Use environment variables as fallback
  const provider = codingAssistantProvider || DEFAULT_CODING_ASSISTANT_PROVIDER;
  const authentication = codingAssistantAuthentication || DEFAULT_CODING_ASSISTANT_AUTHENTICATION;

  if (!provider) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: codingAssistantProvider (not in request or environment)',
      containerId
    });
    return;
  }

  if (!authentication) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: codingAssistantAuthentication (not in request or environment)',
      containerId
    });
    return;
  }

  // Set worker to busy temporarily
  workerStatus = 'busy';
  console.log(`[Container ${containerId}] Processing query (type: ${queryType || 'generic'})`);

  try {
    // Run the query through the orchestrator
    const result = await orchestrator.runQuery({
      prompt,
      provider,
      authentication: typeof authentication === 'object' ? JSON.stringify(authentication) : authentication,
    });

    console.log(`[Container ${containerId}] Query completed successfully`);

    // Return to idle (this is a lightweight operation, worker doesn't exit)
    workerStatus = 'idle';

    res.json({
      success: true,
      result,
      queryType,
      containerId
    });

  } catch (error) {
    console.error(`[Container ${containerId}] Query failed:`, error);

    // Return to idle
    workerStatus = 'idle';

    res.status(500).json({
      error: 'query_failed',
      message: error instanceof Error ? error.message : 'Failed to run query',
      containerId
    });
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
 * Code Completion endpoint - fast autocomplete using OpenRouter
 *
 * This is a lightweight, non-session endpoint for real-time code completions.
 * Uses OpenRouter with Cerebras-hosted GPT-OSS-120B for ultra-fast inference.
 *
 * Unlike /execute, this does NOT:
 * - Exit the worker after completion
 * - Create/manage sessions
 * - Access the filesystem
 *
 * Required fields:
 * - prefix: Code before the cursor
 * - language: Programming language
 * - authentication: OpenRouter API key
 *
 * Optional fields:
 * - suffix: Code after the cursor (for fill-in-the-middle)
 * - filename: Current file name (for context)
 * - maxTokens: Max tokens to generate (default: 150)
 * - temperature: Sampling temperature (default: 0.2)
 * - model: OpenRouter model (default: openai/gpt-oss-120b:cerebras)
 */
app.post('/completions', async (req: Request, res: Response) => {
  console.log(`[Container ${containerId}] Received completion request`);
  res.setHeader('X-Container-ID', containerId);

  // Note: We allow completions even when worker is "busy" with /execute
  // because completions are lightweight and stateless

  const {
    prefix,
    suffix,
    language,
    filename,
    cursorLine,
    cursorColumn,
    maxTokens = 150,
    temperature = 0.2,
    model,
    authentication,
  } = req.body;

  // Validate required fields
  if (!prefix || typeof prefix !== 'string') {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: prefix',
      containerId,
    });
    return;
  }

  if (!language || typeof language !== 'string') {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: language',
      containerId,
    });
    return;
  }

  if (!authentication || typeof authentication !== 'string') {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required field: authentication (OpenRouter API key)',
      containerId,
    });
    return;
  }

  try {
    // Create the completion provider
    const provider = new OpenRouterCompletionProvider(
      authentication,
      model || OpenRouterCompletionProvider.DEFAULT_MODEL
    );

    // Build the completion request
    const completionRequest: CompletionRequest = {
      prefix,
      suffix: suffix || '',
      language,
      filename,
      cursorLine,
      cursorColumn,
      maxTokens,
      temperature,
    };

    // Get completion with caching
    const result = await getCompletionWithCache(provider, completionRequest);

    console.log(`[Container ${containerId}] Completion generated in ${result.latencyMs}ms (cached: ${result.cached})`);

    res.json(result);
  } catch (error) {
    console.error(`[Container ${containerId}] Completion error:`, error);

    res.status(500).json({
      error: 'completion_failed',
      message: error instanceof Error ? error.message : 'Failed to generate completion',
      containerId,
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
      'POST /execute',
      'POST /query',
      'POST /completions',
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
  console.log('🚀 AI Coding Worker (LLM Execution Engine)');
  console.log('='.repeat(60));
  console.log(`🆔 Container ID: ${containerId}`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`📊 Status: ${workerStatus}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  GET    /health                    - Health check');
  console.log('  GET    /status                    - Worker status (idle/busy)');
  console.log('  POST   /execute                   - Execute LLM against workspace');
  console.log('  POST   /query                     - One-off LLM query (titles, commits, etc)');
  console.log('  POST   /completions               - Fast code completions (autocomplete)');
  console.log('  POST   /abort                     - Abort current execution');
  console.log('  POST   /shutdown                  - Signal worker to shutdown');
  console.log('');
  console.log('Supported providers:');
  console.log('  - ClaudeAgentSDK (claude-code)');
  console.log('  - Codex');
  console.log('');
  console.log('Worker behavior:');
  console.log('  - Ephemeral: exits after completing each job');
  console.log('  - Returns 429 if busy (load balancer will retry)');
  console.log('  - Receives workspacePath from internal-api-server');
  console.log('  - All session management handled by internal-api-server');
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
