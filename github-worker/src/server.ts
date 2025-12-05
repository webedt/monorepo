import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import * as os from 'os';
import {
  CloneRepositoryRequest,
  InitSessionRequest,
  CreateBranchRequest,
  CommitAndPushRequest,
  CreatePullRequestRequest,
  MergePullRequestRequest,
  AutoPullRequestRequest,
} from './types';
import { cloneRepository } from './operations/cloneRepository';
import { initSession } from './operations/initSession';
import { createBranch } from './operations/createBranch';
import { commitAndPush } from './operations/commitAndPush';
import { createPullRequest, mergePullRequest, autoPullRequest } from './operations/pullRequest';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 5002;
const TMP_DIR = process.env.TMP_DIR || '/tmp';

// Container identification
const containerId = process.env.HOSTNAME || os.hostname();

// Build information
const BUILD_COMMIT_SHA = process.env.BUILD_COMMIT_SHA || 'unknown';
const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || 'unknown';
const BUILD_IMAGE_TAG = process.env.BUILD_IMAGE_TAG || 'unknown';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Worker state
let workerStatus: 'idle' | 'busy' = 'idle';
let shutdownRequested = false;
let activeOperation: string | null = null;

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.setHeader('X-Container-ID', containerId);
  res.json({
    status: 'ok',
    service: 'github-worker',
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
 * Status endpoint
 */
app.get('/status', (req: Request, res: Response) => {
  res.setHeader('X-Container-ID', containerId);
  res.json({
    status: workerStatus,
    activeOperation,
    containerId,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Setup SSE response headers
 */
function setupSSE(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.setHeader('X-Container-ID', containerId);
}

/**
 * Clone repository endpoint
 * Clones a GitHub repository into a session
 */
app.post('/clone-repository', async (req: Request, res: Response) => {
  logger.info('Received clone-repository request', {
    component: 'Server',
    operation: 'clone-repository'
  });

  // Check if worker is busy
  if (workerStatus === 'busy') {
    res.setHeader('X-Container-ID', containerId);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  // Validate request
  const request: CloneRepositoryRequest = req.body;
  if (!request.sessionId || !request.repoUrl || !request.accessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: sessionId, repoUrl, accessToken',
      containerId
    });
    return;
  }

  // Check for shutdown
  if (shutdownRequested) {
    res.status(503).json({
      error: 'shutting_down',
      message: 'Worker is shutting down',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  activeOperation = 'clone-repository';

  setupSSE(res);

  try {
    await cloneRepository(request, res, TMP_DIR);
    logger.info('Clone repository operation completed', {
      component: 'Server',
      sessionId: request.sessionId
    });
  } catch (error) {
    logger.error('Clone repository operation failed', error, {
      component: 'Server',
      sessionId: request.sessionId
    });
  }

  // Exit after completion (ephemeral model)
  await gracefulExit(0);
});

/**
 * Init session endpoint
 * Clones repository AND creates branch in a single operation
 */
app.post('/init-session', async (req: Request, res: Response) => {
  logger.info('Received init-session request', {
    component: 'Server',
    operation: 'init-session'
  });

  // Check if worker is busy
  if (workerStatus === 'busy') {
    res.setHeader('X-Container-ID', containerId);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  // Validate request
  const request: InitSessionRequest = req.body;
  if (!request.sessionId || !request.repoUrl || !request.userRequest ||
      !request.claudeCredentials || !request.githubAccessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: sessionId, repoUrl, userRequest, claudeCredentials, githubAccessToken',
      containerId
    });
    return;
  }

  // Check for shutdown
  if (shutdownRequested) {
    res.status(503).json({
      error: 'shutting_down',
      message: 'Worker is shutting down',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  activeOperation = 'init-session';

  setupSSE(res);

  try {
    await initSession(request, res, TMP_DIR);
    logger.info('Init session operation completed', {
      component: 'Server',
      sessionId: request.sessionId
    });
  } catch (error) {
    logger.error('Init session operation failed', error, {
      component: 'Server',
      sessionId: request.sessionId
    });
  }

  // Exit after completion (ephemeral model)
  await gracefulExit(0);
});

/**
 * Create branch endpoint
 * Creates a new branch with LLM-generated name
 */
app.post('/create-branch', async (req: Request, res: Response) => {
  logger.info('Received create-branch request', {
    component: 'Server',
    operation: 'create-branch'
  });

  // Check if worker is busy
  if (workerStatus === 'busy') {
    res.setHeader('X-Container-ID', containerId);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  // Validate request
  const request: CreateBranchRequest = req.body;
  if (!request.sessionId || !request.userRequest || !request.baseBranch ||
      !request.repoUrl || !request.claudeCredentials || !request.githubAccessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: sessionId, userRequest, baseBranch, repoUrl, claudeCredentials, githubAccessToken',
      containerId
    });
    return;
  }

  // Check for shutdown
  if (shutdownRequested) {
    res.status(503).json({
      error: 'shutting_down',
      message: 'Worker is shutting down',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  activeOperation = 'create-branch';

  setupSSE(res);

  try {
    await createBranch(request, res, TMP_DIR);
    logger.info('Create branch operation completed', {
      component: 'Server',
      sessionId: request.sessionId
    });
  } catch (error) {
    logger.error('Create branch operation failed', error, {
      component: 'Server',
      sessionId: request.sessionId
    });
  }

  // Exit after completion (ephemeral model)
  await gracefulExit(0);
});

/**
 * Commit and push endpoint
 * Commits changes with LLM-generated message and pushes to remote
 */
app.post('/commit-and-push', async (req: Request, res: Response) => {
  logger.info('Received commit-and-push request', {
    component: 'Server',
    operation: 'commit-and-push'
  });

  // Check if worker is busy
  if (workerStatus === 'busy') {
    res.setHeader('X-Container-ID', containerId);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  // Validate request
  const request: CommitAndPushRequest = req.body;
  if (!request.sessionId || !request.claudeCredentials || !request.githubAccessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: sessionId, claudeCredentials, githubAccessToken',
      containerId
    });
    return;
  }

  // Check for shutdown
  if (shutdownRequested) {
    res.status(503).json({
      error: 'shutting_down',
      message: 'Worker is shutting down',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  activeOperation = 'commit-and-push';

  setupSSE(res);

  try {
    await commitAndPush(request, res, TMP_DIR);
    logger.info('Commit and push operation completed', {
      component: 'Server',
      sessionId: request.sessionId
    });
  } catch (error) {
    logger.error('Commit and push operation failed', error, {
      component: 'Server',
      sessionId: request.sessionId
    });
  }

  // Exit after completion (ephemeral model)
  await gracefulExit(0);
});

/**
 * Create pull request endpoint
 * Creates a new pull request
 */
app.post('/create-pull-request', async (req: Request, res: Response) => {
  logger.info('Received create-pull-request request', {
    component: 'Server',
    operation: 'create-pull-request'
  });

  // Check if worker is busy
  if (workerStatus === 'busy') {
    res.setHeader('X-Container-ID', containerId);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  // Validate request
  const request: CreatePullRequestRequest = req.body;
  if (!request.owner || !request.repo || !request.head || !request.base || !request.githubAccessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: owner, repo, head, base, githubAccessToken',
      containerId
    });
    return;
  }

  // Check for shutdown
  if (shutdownRequested) {
    res.status(503).json({
      error: 'shutting_down',
      message: 'Worker is shutting down',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  activeOperation = 'create-pull-request';

  setupSSE(res);

  try {
    await createPullRequest(request, res);
    logger.info('Create pull request operation completed', {
      component: 'Server',
      owner: request.owner,
      repo: request.repo
    });
  } catch (error) {
    logger.error('Create pull request operation failed', error, {
      component: 'Server',
      owner: request.owner,
      repo: request.repo
    });
  }

  // Exit after completion (ephemeral model)
  await gracefulExit(0);
});

/**
 * Merge pull request endpoint
 * Merges an existing pull request
 */
app.post('/merge-pull-request', async (req: Request, res: Response) => {
  logger.info('Received merge-pull-request request', {
    component: 'Server',
    operation: 'merge-pull-request'
  });

  // Check if worker is busy
  if (workerStatus === 'busy') {
    res.setHeader('X-Container-ID', containerId);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  // Validate request
  const request: MergePullRequestRequest = req.body;
  if (!request.owner || !request.repo || !request.pullNumber || !request.githubAccessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: owner, repo, pullNumber, githubAccessToken',
      containerId
    });
    return;
  }

  // Check for shutdown
  if (shutdownRequested) {
    res.status(503).json({
      error: 'shutting_down',
      message: 'Worker is shutting down',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  activeOperation = 'merge-pull-request';

  setupSSE(res);

  try {
    await mergePullRequest(request, res);
    logger.info('Merge pull request operation completed', {
      component: 'Server',
      owner: request.owner,
      repo: request.repo,
      pullNumber: request.pullNumber
    });
  } catch (error) {
    logger.error('Merge pull request operation failed', error, {
      component: 'Server',
      owner: request.owner,
      repo: request.repo,
      pullNumber: request.pullNumber
    });
  }

  // Exit after completion (ephemeral model)
  await gracefulExit(0);
});

/**
 * Auto pull request endpoint
 * Creates PR, merges base into feature, waits for mergeable, merges PR, deletes branch
 */
app.post('/auto-pull-request', async (req: Request, res: Response) => {
  logger.info('Received auto-pull-request request', {
    component: 'Server',
    operation: 'auto-pull-request'
  });

  // Check if worker is busy
  if (workerStatus === 'busy') {
    res.setHeader('X-Container-ID', containerId);
    res.status(429).json({
      error: 'busy',
      message: 'Worker is currently processing another request',
      retryAfter: 5,
      containerId
    });
    return;
  }

  // Validate request
  const request: AutoPullRequestRequest = req.body;
  if (!request.owner || !request.repo || !request.branch || !request.base || !request.githubAccessToken) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'Missing required fields: owner, repo, branch, base, githubAccessToken',
      containerId
    });
    return;
  }

  // Check for shutdown
  if (shutdownRequested) {
    res.status(503).json({
      error: 'shutting_down',
      message: 'Worker is shutting down',
      containerId
    });
    return;
  }

  // Set worker to busy
  workerStatus = 'busy';
  activeOperation = 'auto-pull-request';

  setupSSE(res);

  try {
    await autoPullRequest(request, res);
    logger.info('Auto pull request operation completed', {
      component: 'Server',
      owner: request.owner,
      repo: request.repo,
      branch: request.branch
    });
  } catch (error) {
    logger.error('Auto pull request operation failed', error, {
      component: 'Server',
      owner: request.owner,
      repo: request.repo,
      branch: request.branch
    });
  }

  // Exit after completion (ephemeral model)
  await gracefulExit(0);
});

/**
 * Shutdown endpoint
 */
app.post('/shutdown', (req: Request, res: Response) => {
  logger.info('Shutdown requested by client', { component: 'Server' });
  res.setHeader('X-Container-ID', containerId);

  if (workerStatus === 'idle') {
    res.json({ status: 'ok', message: 'Worker was idle, shutting down' });
    process.exit(0);
  } else {
    shutdownRequested = true;
    res.json({ status: 'ok', message: 'Worker will shutdown after current operation completes' });
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
      'POST /clone-repository',
      'POST /init-session',
      'POST /create-branch',
      'POST /commit-and-push',
      'POST /create-pull-request',
      'POST /merge-pull-request',
      'POST /auto-pull-request',
      'POST /shutdown'
    ],
    containerId
  });
});

/**
 * Gracefully exit the process
 */
async function gracefulExit(code: number): Promise<void> {
  logger.info(`Preparing graceful exit (code: ${code})...`, { component: 'Server' });

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

  // If client requested shutdown, exit quickly
  if (shutdownRequested) {
    logger.info('Client confirmed receipt, exiting immediately', { component: 'Server' });
    process.exit(code);
  }

  // Wait for network buffers to flush
  logger.info('Waiting for client to receive all data...', { component: 'Server' });
  await new Promise(resolve => setTimeout(resolve, 5000));

  process.exit(code);
}

/**
 * Start the server
 */
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🐙 GitHub Worker (Ephemeral Git Operations)');
  console.log('='.repeat(60));
  console.log(`🆔 Container ID: ${containerId}`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`📁 Temp directory: ${TMP_DIR}`);
  console.log(`🗄️  Storage Worker: ${process.env.STORAGE_WORKER_URL || 'Default'}`);
  console.log(`📊 Status: ${workerStatus}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  GET  /health              - Health check');
  console.log('  GET  /status              - Worker status (idle/busy)');
  console.log('  POST /clone-repository    - Clone GitHub repo into session');
  console.log('  POST /init-session        - Clone + create branch (combined)');
  console.log('  POST /create-branch       - Create branch with LLM naming');
  console.log('  POST /commit-and-push     - Commit changes with LLM message');
  console.log('  POST /create-pull-request - Create a new pull request');
  console.log('  POST /merge-pull-request  - Merge an existing pull request');
  console.log('  POST /auto-pull-request   - Auto PR: create, merge base, merge PR, delete branch');
  console.log('  POST /shutdown            - Signal worker to shutdown');
  console.log('');
  console.log('Worker behavior:');
  console.log('  - Ephemeral: exits after completing each job');
  console.log('  - Returns 429 if busy (load balancer will retry)');
  console.log('  - SSE streaming for real-time progress updates');
  console.log('  - Security: no cross-session data exposure');
  console.log('='.repeat(60));
});

// Graceful shutdown handler
async function handleShutdownSignal(signal: string): Promise<void> {
  logger.info(`${signal} received, initiating graceful shutdown...`, { component: 'Server' });

  shutdownRequested = true;

  if (workerStatus === 'busy') {
    logger.info('Waiting for active operation to complete...', { component: 'Server' });
    // Give 60 seconds max
    await new Promise(resolve => setTimeout(resolve, 60000));
  }

  process.exit(0);
}

process.on('SIGTERM', () => handleShutdownSignal('SIGTERM'));
process.on('SIGINT', () => handleShutdownSignal('SIGINT'));
