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
import { CLAUDE_ENVIRONMENT_ID } from '../../logic/config/env.js';
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

    // Pre-flight validation for Claude Remote Sessions
    if (!CLAUDE_ENVIRONMENT_ID) {
      res.status(503).json({
        success: false,
        error: 'Orchestrator requires Claude Remote Sessions, but CLAUDE_ENVIRONMENT_ID is not configured on this server.',
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

    // Auto-start if requested (claudeAuth already validated above)
    if (autoStart) {
      await startJob(job.id, claudeAuth.accessToken);
    }

    res.status(201).json({ success: true, data: job });
  } catch (error) {
    console.error('[Orchestrator API] Error creating job:', error);
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
    console.error('[Orchestrator API] Error listing jobs:', error);
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
    console.error('[Orchestrator API] Error getting job:', error);
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
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    // Heartbeat
    const heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000);

    // Cleanup on disconnect
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      console.log(`[Orchestrator API] Client disconnected from job ${jobId}`);
    });

    // If job is already completed, send completion event
    if (job.status === 'completed' || job.status === 'cancelled' || job.status === 'error') {
      res.write(
        `event: job_ended\ndata: ${JSON.stringify({
          type: 'job_ended',
          jobId,
          data: { status: job.status },
          timestamp: new Date(),
        })}\n\n`
      );
    }
  } catch (error) {
    console.error('[Orchestrator API] Error streaming job:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
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
    console.error('[Orchestrator API] Error starting job:', error);
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
    console.error('[Orchestrator API] Error pausing job:', error);
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
    console.error('[Orchestrator API] Error resuming job:', error);
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
    console.error('[Orchestrator API] Error cancelling job:', error);
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
    console.error('[Orchestrator API] Error listing cycles:', error);
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
    console.error('[Orchestrator API] Error getting cycle:', error);
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
    console.error('[Orchestrator API] Error updating request document:', error);
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
    console.error('[Orchestrator API] Error updating task list:', error);
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

export default router;
