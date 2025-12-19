/**
 * Orchestrator API Routes
 *
 * Endpoints for managing long-running multi-cycle orchestration jobs.
 */

import { Router, Request, Response } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import {
  createJob,
  startJob,
  pauseJob,
  resumeJob,
  cancelJob,
  getJob,
  getJobWithCycles,
  getCycleWithTasks,
  listJobs,
  updateRequestDocument,
  updateJobTaskList,
  StartOrchestratorRequest,
} from '../../logic/orchestrator/index.js';
import { orchestratorBroadcaster, OrchestratorEvent } from '../../logic/orchestrator/orchestratorBroadcaster.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * POST /api/orchestrator
 * Create and optionally start a new orchestrator job
 */
router.post('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const {
      repositoryOwner,
      repositoryName,
      baseBranch,
      workingBranch,
      requestDocument,
      initialTaskList,
      maxCycles,
      timeLimitMinutes,
      maxParallelTasks,
      provider,
      autoStart = false,
    } = req.body as StartOrchestratorRequest & { autoStart?: boolean };

    // Validate required fields
    if (!repositoryOwner || !repositoryName || !baseBranch || !requestDocument) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: repositoryOwner, repositoryName, baseBranch, requestDocument',
      });
      return;
    }

    // Check if user has Claude auth configured
    const claudeAuth = authReq.user?.claudeAuth as { accessToken?: string } | null;
    if (!claudeAuth?.accessToken) {
      res.status(400).json({
        success: false,
        error: 'Claude authentication not configured. Please connect your Claude account in Settings before using the orchestrator.',
      });
      return;
    }

    // Check if user has GitHub connected
    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({
        success: false,
        error: 'GitHub not connected. Please connect your GitHub account in Settings before using the orchestrator.',
      });
      return;
    }

    logger.info('Creating orchestrator job', { component: 'OrchestratorAPI', userId, repo: `${repositoryOwner}/${repositoryName}` });

    // Create the job
    const job = await createJob(userId, {
      repositoryOwner,
      repositoryName,
      baseBranch,
      workingBranch,
      requestDocument,
      initialTaskList,
      maxCycles,
      timeLimitMinutes,
      maxParallelTasks,
      provider,
    });

    logger.info('Job created', { component: 'OrchestratorAPI', jobId: job.id, autoStart });

    // Auto-start if requested (claudeAuth already validated above)
    if (autoStart) {
      logger.info('Auto-starting job', { component: 'OrchestratorAPI', jobId: job.id });
      await startJob(job.id, claudeAuth.accessToken);
      logger.info('Job started', { component: 'OrchestratorAPI', jobId: job.id });
    }

    res.status(201).json({ success: true, data: job });
  } catch (error) {
    logger.error('Error creating job', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/orchestrator
 * List all orchestrator jobs for the current user
 */
router.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const limit = parseInt(req.query.limit as string) || 20;
    const jobs = await listJobs(userId, limit);

    res.json({ success: true, data: jobs });
  } catch (error) {
    logger.error('Error listing jobs', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/orchestrator/:id
 * Get details of a specific orchestrator job
 */
router.get('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJobWithCycles(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    // Check ownership
    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    res.json({ success: true, data: job });
  } catch (error) {
    logger.error('Error getting job', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/orchestrator/:id/stream
 * SSE stream of job events
 */
router.get('/:id/stream', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    // Set up SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // Send initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ jobId, status: job.status })}\n\n`);

    const subscriberId = uuidv4();

    // Subscribe to job events
    const unsubscribe = orchestratorBroadcaster.subscribe(jobId, subscriberId, (event: OrchestratorEvent) => {
      try {
        // Check if response is still writable
        if (res.writableEnded) {
          unsubscribe();
          return;
        }
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      } catch (err) {
        logger.error(`Error writing to orchestrator stream for job ${jobId}`, err as Error, {
          component: 'OrchestratorAPI',
          jobId,
          subscriberId,
        });
        unsubscribe();
      }
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(heartbeat);
        return;
      }
      res.write(': heartbeat\n\n');
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      logger.info(`Client disconnected from orchestrator job stream`, {
        component: 'OrchestratorAPI',
        jobId,
        subscriberId,
      });
    });

    // Handle request errors
    req.on('error', (err) => {
      logger.error(`Orchestrator stream error for job ${jobId}`, err, {
        component: 'OrchestratorAPI',
        jobId,
        subscriberId,
      });
      clearInterval(heartbeat);
      unsubscribe();
    });

    // If job is already completed, send completion event
    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'error') {
      if (!res.writableEnded) {
        res.write(
          `event: job_ended\ndata: ${JSON.stringify({
            type: 'job_ended',
            jobId,
            data: { status: job.status },
            timestamp: new Date(),
          })}\n\n`
        );
      }
    }
  } catch (error) {
    logger.error('Error setting up orchestrator stream', error as Error, {
      component: 'OrchestratorAPI',
    });
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  }
});

/**
 * POST /api/orchestrator/:id/start
 * Start a pending or paused job
 */
router.post('/:id/start', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    // Get API key
    const claudeAuth = authReq.user?.claudeAuth as { accessToken?: string } | null;
    const apiKey = claudeAuth?.accessToken || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: 'No API key available. Please configure Claude auth or set ANTHROPIC_API_KEY.',
      });
      return;
    }

    await startJob(jobId, apiKey);

    res.json({ success: true, message: 'Job started' });
  } catch (error) {
    logger.error('Error starting job', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/orchestrator/:id/pause
 * Pause a running job
 */
router.post('/:id/pause', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    await pauseJob(jobId);

    res.json({ success: true, message: 'Job paused' });
  } catch (error) {
    logger.error('Error pausing job', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/orchestrator/:id/resume
 * Resume a paused job
 */
router.post('/:id/resume', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    // Get API key
    const claudeAuth = authReq.user?.claudeAuth as { accessToken?: string } | null;
    const apiKey = claudeAuth?.accessToken || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      res.status(400).json({
        success: false,
        error: 'No API key available. Please configure Claude auth or set ANTHROPIC_API_KEY.',
      });
      return;
    }

    await resumeJob(jobId, apiKey);

    res.json({ success: true, message: 'Job resumed' });
  } catch (error) {
    logger.error('Error resuming job', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * POST /api/orchestrator/:id/cancel
 * Cancel a job
 */
router.post('/:id/cancel', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    await cancelJob(jobId);

    res.json({ success: true, message: 'Job cancelled' });
  } catch (error) {
    logger.error('Error cancelling job', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/orchestrator/:id/cycles
 * List all cycles for a job
 */
router.get('/:id/cycles', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJobWithCycles(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    res.json({ success: true, data: job.cycles });
  } catch (error) {
    logger.error('Error listing cycles', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * GET /api/orchestrator/:id/cycles/:num
 * Get a specific cycle with its tasks
 */
router.get('/:id/cycles/:num', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;
    const cycleNumber = parseInt(req.params.num);

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    const cycle = await getCycleWithTasks(jobId, cycleNumber);

    if (!cycle) {
      res.status(404).json({ success: false, error: 'Cycle not found' });
      return;
    }

    res.json({ success: true, data: cycle });
  } catch (error) {
    logger.error('Error getting cycle', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * PUT /api/orchestrator/:id/request
 * Update the request document
 */
router.put('/:id/request', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;
    const { requestDocument } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!requestDocument) {
      res.status(400).json({ success: false, error: 'Missing requestDocument' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    await updateRequestDocument(jobId, requestDocument);

    res.json({ success: true, message: 'Request document updated' });
  } catch (error) {
    logger.error('Error updating request document', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

/**
 * PUT /api/orchestrator/:id/tasklist
 * Update the task list
 */
router.put('/:id/tasklist', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;
    const jobId = req.params.id;
    const { taskList } = req.body;

    if (!userId) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!taskList) {
      res.status(400).json({ success: false, error: 'Missing taskList' });
      return;
    }

    const job = await getJob(jobId);

    if (!job) {
      res.status(404).json({ success: false, error: 'Job not found' });
      return;
    }

    if (job.userId !== userId) {
      res.status(403).json({ success: false, error: 'Forbidden' });
      return;
    }

    await updateJobTaskList(jobId, taskList);

    res.json({ success: true, message: 'Task list updated' });
  } catch (error) {
    logger.error('Error updating task list', error as Error, { component: 'OrchestratorAPI' });
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
