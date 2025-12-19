/**
 * OrchestratorService
 *
 * Main service class for managing long-running multi-cycle orchestration jobs.
 * Uses claude-remote sessions for execution.
 *
 * Flow:
 * 1. SETUP: Create dev branch, store spec, initialize task list
 * 2. DISCOVERY: Analyze codebase, discover 4 parallelizable tasks
 * 3. EXECUTION: Launch 4 parallel task sessions, each merges to dev branch
 * 4. CONVERGENCE: Wait for all tasks, archive sessions
 * 5. UPDATE: Update task list with results
 * 6. REPEAT until done or cancelled
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  orchestratorJobs,
  orchestratorCycles,
  orchestratorTasks,
  OrchestratorJob,
  OrchestratorCycle,
  OrchestratorTask,
  NewOrchestratorJob,
  NewOrchestratorCycle,
  NewOrchestratorTask,
} from '../db/schema.js';
import { orchestratorBroadcaster } from './orchestratorBroadcaster.js';
import {
  generateSessionTitle,
  getSetupPrompt,
  getDiscoveryPrompt,
  getTaskPrompt,
  getUpdatePrompt,
  SessionTemplateParams,
} from './sessionTemplates.js';
import {
  createAndExecuteSession,
  archiveSession,
  waitForAllSessions,
  SessionResult,
} from './sessionExecutor.js';
import { logger } from '@webedt/shared';

export interface StartOrchestratorRequest {
  repositoryOwner: string;
  repositoryName: string;
  baseBranch: string;
  workingBranch?: string;
  requestDocument: string;
  initialTaskList?: string;
  maxCycles?: number;
  timeLimitMinutes?: number;
  maxParallelTasks?: number;
  provider?: 'claude' | 'claude-remote';
}

export interface OrchestratorJobWithCycles extends OrchestratorJob {
  cycles: OrchestratorCycle[];
}

export interface OrchestratorCycleWithTasks extends OrchestratorCycle {
  tasks: OrchestratorTask[];
}

// Active job runners (in-memory state for running jobs)
const activeJobRunners: Map<string, { cancel: () => void; promise: Promise<void> }> = new Map();

/**
 * Create a new orchestrator job
 */
export async function createJob(
  userId: string,
  config: StartOrchestratorRequest
): Promise<OrchestratorJob> {
  const jobId = uuidv4();
  const workingBranch = config.workingBranch || `orchestrator/${jobId.slice(0, 8)}`;
  const sessionPath = `${config.repositoryOwner}__${config.repositoryName}__${workingBranch.replace(/\//g, '-')}`;

  const newJob: NewOrchestratorJob = {
    id: jobId,
    userId,
    repositoryOwner: config.repositoryOwner,
    repositoryName: config.repositoryName,
    baseBranch: config.baseBranch,
    workingBranch,
    sessionPath,
    requestDocument: config.requestDocument,
    taskList: config.initialTaskList || null,
    status: 'pending',
    currentCycle: 0,
    maxCycles: config.maxCycles || null,
    timeLimitMinutes: config.timeLimitMinutes || null,
    maxParallelTasks: config.maxParallelTasks || 4, // Default to 4 for parallel discovery
    provider: config.provider || 'claude-remote',
  };

  const [job] = await db.insert(orchestratorJobs).values(newJob).returning();

  logger.info(`Created job`, { component: 'OrchestratorService', jobId, repo: `${config.repositoryOwner}/${config.repositoryName}` });

  return job;
}

/**
 * Start running an orchestrator job
 */
export async function startJob(jobId: string, _apiKey?: string): Promise<void> {
  // Check if already running
  if (activeJobRunners.has(jobId)) {
    throw new Error('Job is already running');
  }

  // Get the job
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'pending' && job.status !== 'paused') {
    throw new Error(`Cannot start job with status: ${job.status}`);
  }

  // Update status to running
  await db
    .update(orchestratorJobs)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(orchestratorJobs.id, jobId));

  // Create cancellation token
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };

  // Start the main orchestration loop
  const promise = runOrchestrationLoop(job, () => cancelled);

  activeJobRunners.set(jobId, { cancel, promise });

  // Mark as active for broadcasting
  orchestratorBroadcaster.startJob(jobId);
  orchestratorBroadcaster.broadcastJobStarted(jobId);

  logger.info(`Started job`, { component: 'OrchestratorService', jobId });

  // Clean up when done
  promise
    .catch(err => {
      logger.error(`Job error`, err as Error, { component: 'OrchestratorService', jobId });
    })
    .finally(() => {
      activeJobRunners.delete(jobId);
    });
}

/**
 * Pause a running job (will finish current phase first)
 */
export async function pauseJob(jobId: string): Promise<void> {
  const runner = activeJobRunners.get(jobId);
  if (!runner) {
    throw new Error('Job is not running');
  }

  runner.cancel();

  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
  if (job) {
    await db
      .update(orchestratorJobs)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(orchestratorJobs.id, jobId));

    orchestratorBroadcaster.broadcastJobPaused(jobId, job.currentCycle);
  }

  logger.info(`Paused job`, { component: 'OrchestratorService', jobId });
}

/**
 * Resume a paused job
 */
export async function resumeJob(jobId: string, apiKey?: string): Promise<void> {
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'paused') {
    throw new Error(`Cannot resume job with status: ${job.status}`);
  }

  await startJob(jobId, apiKey);
  orchestratorBroadcaster.broadcastJobResumed(jobId, job.currentCycle);

  logger.info(`Resumed job`, { component: 'OrchestratorService', jobId });
}

/**
 * Cancel a job immediately
 */
export async function cancelJob(jobId: string): Promise<void> {
  const runner = activeJobRunners.get(jobId);
  if (runner) {
    runner.cancel();
    await runner.promise.catch(() => {});
    activeJobRunners.delete(jobId);
  }

  await db
    .update(orchestratorJobs)
    .set({ status: 'cancelled', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(orchestratorJobs.id, jobId));

  orchestratorBroadcaster.endJob(jobId, 'cancelled');

  logger.info(`Cancelled job`, { component: 'OrchestratorService', jobId });
}

/**
 * Get a job by ID
 */
export async function getJob(jobId: string): Promise<OrchestratorJob | null> {
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
  return job || null;
}

/**
 * Get a job with all its cycles
 */
export async function getJobWithCycles(jobId: string): Promise<OrchestratorJobWithCycles | null> {
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
  if (!job) return null;

  const cycles = await db
    .select()
    .from(orchestratorCycles)
    .where(eq(orchestratorCycles.jobId, jobId))
    .orderBy(orchestratorCycles.cycleNumber);

  return { ...job, cycles };
}

/**
 * Get a cycle with all its tasks
 */
export async function getCycleWithTasks(
  jobId: string,
  cycleNumber: number
): Promise<OrchestratorCycleWithTasks | null> {
  const [cycle] = await db
    .select()
    .from(orchestratorCycles)
    .where(and(eq(orchestratorCycles.jobId, jobId), eq(orchestratorCycles.cycleNumber, cycleNumber)));

  if (!cycle) return null;

  const tasks = await db
    .select()
    .from(orchestratorTasks)
    .where(eq(orchestratorTasks.cycleId, cycle.id))
    .orderBy(orchestratorTasks.taskNumber);

  return { ...cycle, tasks };
}

/**
 * List jobs for a user
 */
export async function listJobs(userId: string, limit = 20): Promise<OrchestratorJob[]> {
  return db
    .select()
    .from(orchestratorJobs)
    .where(eq(orchestratorJobs.userId, userId))
    .orderBy(desc(orchestratorJobs.createdAt))
    .limit(limit);
}

/**
 * Update the request document for a job
 */
export async function updateRequestDocument(jobId: string, requestDocument: string): Promise<void> {
  await db
    .update(orchestratorJobs)
    .set({ requestDocument, updatedAt: new Date() })
    .where(eq(orchestratorJobs.id, jobId));
}

/**
 * Update the task list for a job
 */
export async function updateJobTaskList(jobId: string, taskList: string): Promise<void> {
  await db
    .update(orchestratorJobs)
    .set({ taskList, updatedAt: new Date() })
    .where(eq(orchestratorJobs.id, jobId));
}

// =============================================================================
// Main Orchestration Loop
// =============================================================================

/**
 * Main orchestration loop - runs setup then cycles until completion
 */
async function runOrchestrationLoop(
  initialJob: OrchestratorJob,
  isCancelled: () => boolean
): Promise<void> {
  const jobId = initialJob.id;

  try {
    // Get fresh job state
    let [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
    if (!job) throw new Error('Job not found');

    // SETUP PHASE (only on first run, cycle 0)
    if (job.currentCycle === 0) {
      logger.info(`Running setup phase`, { component: 'OrchestratorService', jobId });
      await runSetupPhase(job);

      if (isCancelled()) return;

      // Increment to cycle 1
      await db
        .update(orchestratorJobs)
        .set({ currentCycle: 1, updatedAt: new Date() })
        .where(eq(orchestratorJobs.id, jobId));
    }

    // CYCLE LOOP
    while (!isCancelled()) {
      // Refresh job state
      [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
      if (!job) throw new Error('Job not found');

      // Check termination conditions
      const termination = checkTerminationConditions(job);
      if (termination.terminate) {
        await completeJob(jobId, termination.reason || 'completed');
        return;
      }

      const cycleNumber = job.currentCycle;
      logger.info(`Starting cycle`, { component: 'OrchestratorService', jobId, cycleNumber });

      // Run one complete cycle
      const shouldContinue = await runCycle(job, cycleNumber, isCancelled);

      if (!shouldContinue) {
        await completeJob(jobId, 'all_tasks_complete');
        return;
      }

      if (isCancelled()) {
        logger.info(`Job cancelled during cycle`, { component: 'OrchestratorService', jobId, cycleNumber });
        return;
      }

      // Increment cycle counter
      await db
        .update(orchestratorJobs)
        .set({ currentCycle: cycleNumber + 1, updatedAt: new Date() })
        .where(eq(orchestratorJobs.id, jobId));

      // Brief pause between cycles
      await sleep(5000);
    }
  } catch (error) {
    logger.error(`Job failed`, error as Error, { component: 'OrchestratorService', jobId });

    await db
      .update(orchestratorJobs)
      .set({
        status: 'error',
        lastError: (error as Error).message,
        errorCount: initialJob.errorCount + 1,
        updatedAt: new Date(),
      })
      .where(eq(orchestratorJobs.id, jobId));

    orchestratorBroadcaster.broadcastJobError(jobId, (error as Error).message);
    orchestratorBroadcaster.endJob(jobId, 'error');
  }
}

/**
 * SETUP Phase - Create dev branch, store spec, initialize task list
 */
async function runSetupPhase(job: OrchestratorJob): Promise<void> {
  const params: SessionTemplateParams = {
    jobTitle: job.requestDocument.slice(0, 100), // Use first 100 chars as title
    devBranch: job.workingBranch,
    repoOwner: job.repositoryOwner,
    repoName: job.repositoryName,
    specification: job.requestDocument,
  };

  const title = generateSessionTitle('setup', params);
  const prompt = getSetupPrompt(params);

  orchestratorBroadcaster.broadcast({
    type: 'phase_started',
    jobId: job.id,
    data: { phase: 'setup' },
  });

  const result = await createAndExecuteSession({
    userId: job.userId,
    title,
    prompt,
    repoOwner: job.repositoryOwner,
    repoName: job.repositoryName,
    baseBranch: job.baseBranch,
    orchestratorJobId: job.id,
  });

  if (result.status === 'error') {
    throw new Error(`Setup failed: ${result.error}`);
  }

  // Archive the setup session
  await archiveSession(job.userId, result.sessionId);

  logger.info(`Setup complete`, { component: 'OrchestratorService', jobId: job.id });
}

/**
 * Run a single cycle (Discovery → Execution → Convergence → Update)
 */
async function runCycle(
  job: OrchestratorJob,
  cycleNumber: number,
  isCancelled: () => boolean
): Promise<boolean> {
  const cycleId = uuidv4();

  // Create cycle record
  const newCycle: NewOrchestratorCycle = {
    id: cycleId,
    jobId: job.id,
    cycleNumber,
    phase: 'discovery',
    tasksDiscovered: 0,
    tasksLaunched: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
  };

  await db.insert(orchestratorCycles).values(newCycle);
  orchestratorBroadcaster.broadcastCycleStarted(job.id, cycleNumber);

  // DISCOVERY PHASE
  const discoveryResult = await runDiscoveryPhase(job, cycleId, cycleNumber);

  if (!discoveryResult.success) {
    // No more tasks to discover - we're done
    await db
      .update(orchestratorCycles)
      .set({ phase: 'completed', completedAt: new Date() })
      .where(eq(orchestratorCycles.id, cycleId));
    return false;
  }

  if (isCancelled()) return true;

  // EXECUTION PHASE
  await runExecutionPhase(job, cycleId, cycleNumber, discoveryResult.taskDescriptions);

  if (isCancelled()) return true;

  // CONVERGENCE PHASE
  await runConvergencePhase(job, cycleId, cycleNumber);

  if (isCancelled()) return true;

  // UPDATE PHASE
  await runUpdatePhase(job, cycleId, cycleNumber);

  // Mark cycle complete
  await db
    .update(orchestratorCycles)
    .set({ phase: 'completed', completedAt: new Date() })
    .where(eq(orchestratorCycles.id, cycleId));

  return true; // Continue to next cycle
}

/**
 * DISCOVERY Phase - Run discovery session to find tasks
 */
async function runDiscoveryPhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number
): Promise<{ success: boolean; taskDescriptions: string[] }> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'discovery');

  const params: SessionTemplateParams = {
    jobTitle: job.requestDocument.slice(0, 100),
    devBranch: job.workingBranch,
    repoOwner: job.repositoryOwner,
    repoName: job.repositoryName,
    specification: job.requestDocument,
    cycleNumber,
  };

  const title = generateSessionTitle('discovery', params);
  const prompt = getDiscoveryPrompt(params);

  logger.info(`Running discovery`, { component: 'OrchestratorService', cycleNumber });

  const result = await createAndExecuteSession({
    userId: job.userId,
    title,
    prompt,
    repoOwner: job.repositoryOwner,
    repoName: job.repositoryName,
    orchestratorJobId: job.id,
    orchestratorCycleId: cycleId,
  });

  // Archive the discovery session
  await archiveSession(job.userId, result.sessionId);

  if (result.status === 'error') {
    logger.error(`Discovery failed`, new Error(result.error || 'Unknown'), { component: 'OrchestratorService' });
    return { success: false, taskDescriptions: [] };
  }

  // For now, we'll create 4 placeholder tasks
  // In a real implementation, we'd parse the TASKLIST.md from the repo
  // to get the actual discovered tasks
  const taskDescriptions = [
    `Cycle ${cycleNumber} - Task 1: Implementation task`,
    `Cycle ${cycleNumber} - Task 2: Implementation task`,
    `Cycle ${cycleNumber} - Task 3: Implementation task`,
    `Cycle ${cycleNumber} - Task 4: Implementation task`,
  ];

  // Create task records
  for (let i = 0; i < taskDescriptions.length; i++) {
    const task: NewOrchestratorTask = {
      id: uuidv4(),
      cycleId,
      jobId: job.id,
      taskNumber: i + 1,
      description: taskDescriptions[i],
      context: null,
      priority: 'P1',
      canRunParallel: true,
      status: 'pending',
      retryCount: 0,
    };
    await db.insert(orchestratorTasks).values(task);
  }

  // Update cycle
  await db
    .update(orchestratorCycles)
    .set({ tasksDiscovered: taskDescriptions.length })
    .where(eq(orchestratorCycles.id, cycleId));

  orchestratorBroadcaster.broadcastTasksDiscovered(
    job.id,
    cycleNumber,
    taskDescriptions.map((desc, i) => ({ id: `task-${i + 1}`, description: desc }))
  );

  return { success: true, taskDescriptions };
}

/**
 * EXECUTION Phase - Launch parallel task sessions
 */
async function runExecutionPhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number,
  taskDescriptions: string[]
): Promise<void> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'execution');

  logger.info(`Executing tasks in parallel`, { component: 'OrchestratorService', taskCount: taskDescriptions.length });

  // Get task records
  const tasks = await db
    .select()
    .from(orchestratorTasks)
    .where(eq(orchestratorTasks.cycleId, cycleId))
    .orderBy(orchestratorTasks.taskNumber);

  // Launch all task sessions in parallel
  const sessionPromises: Promise<SessionResult>[] = [];

  for (const task of tasks) {
    const params: SessionTemplateParams = {
      jobTitle: job.requestDocument.slice(0, 100),
      devBranch: job.workingBranch,
      repoOwner: job.repositoryOwner,
      repoName: job.repositoryName,
      specification: job.requestDocument,
      cycleNumber,
      taskNumber: task.taskNumber,
      taskDescription: task.description,
      taskContext: task.context || undefined,
    };

    const title = generateSessionTitle('task', params);
    const prompt = getTaskPrompt(params);

    // Update task status
    await db
      .update(orchestratorTasks)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(orchestratorTasks.id, task.id));

    orchestratorBroadcaster.broadcastTaskStarted(job.id, cycleNumber, task.id, task.description);

    // Launch session (don't await yet)
    const sessionPromise = createAndExecuteSession({
      userId: job.userId,
      title,
      prompt,
      repoOwner: job.repositoryOwner,
      repoName: job.repositoryName,
      orchestratorJobId: job.id,
      orchestratorCycleId: cycleId,
      orchestratorTaskId: task.id,
    }).then(async (result) => {
      // Update task with session ID
      await db
        .update(orchestratorTasks)
        .set({ agentSessionId: result.sessionId })
        .where(eq(orchestratorTasks.id, task.id));
      return result;
    });

    sessionPromises.push(sessionPromise);
  }

  // Update launched count
  await db
    .update(orchestratorCycles)
    .set({ tasksLaunched: tasks.length })
    .where(eq(orchestratorCycles.id, cycleId));

  // Wait for all sessions to complete
  const results = await Promise.allSettled(sessionPromises);

  // Update task statuses based on results
  for (let i = 0; i < results.length; i++) {
    const task = tasks[i];
    const result = results[i];

    if (result.status === 'fulfilled') {
      const sessionResult = result.value;

      if (sessionResult.status === 'completed') {
        await db
          .update(orchestratorTasks)
          .set({
            status: 'completed',
            completedAt: new Date(),
            resultSummary: 'Task completed successfully',
          })
          .where(eq(orchestratorTasks.id, task.id));

        orchestratorBroadcaster.broadcastTaskCompleted(job.id, cycleNumber, task.id, {
          resultSummary: 'Task completed successfully',
        });
      } else {
        await db
          .update(orchestratorTasks)
          .set({
            status: 'failed',
            completedAt: new Date(),
            errorMessage: sessionResult.error || 'Unknown error',
          })
          .where(eq(orchestratorTasks.id, task.id));

        orchestratorBroadcaster.broadcastTaskFailed(job.id, cycleNumber, task.id, sessionResult.error || 'Unknown error');
      }

      // Archive the task session
      await archiveSession(job.userId, sessionResult.sessionId);
    } else {
      // Promise rejected
      await db
        .update(orchestratorTasks)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorMessage: result.reason?.message || 'Session failed to start',
        })
        .where(eq(orchestratorTasks.id, task.id));

      orchestratorBroadcaster.broadcastTaskFailed(job.id, cycleNumber, task.id, result.reason?.message || 'Session failed');
    }
  }
}

/**
 * CONVERGENCE Phase - Collect results and update counts
 */
async function runConvergencePhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number
): Promise<void> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'convergence');

  logger.info(`Convergence phase`, { component: 'OrchestratorService', cycleNumber });

  // Get task results
  const tasks = await db.select().from(orchestratorTasks).where(eq(orchestratorTasks.cycleId, cycleId));

  const completed = tasks.filter((t: OrchestratorTask) => t.status === 'completed').length;
  const failed = tasks.filter((t: OrchestratorTask) => t.status === 'failed').length;

  await db
    .update(orchestratorCycles)
    .set({ tasksCompleted: completed, tasksFailed: failed })
    .where(eq(orchestratorCycles.id, cycleId));

  logger.info(`Cycle results`, { component: 'OrchestratorService', cycleNumber, completed, failed });
}

/**
 * UPDATE Phase - Run update session to update task list
 */
async function runUpdatePhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number
): Promise<void> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'update');

  const params: SessionTemplateParams = {
    jobTitle: job.requestDocument.slice(0, 100),
    devBranch: job.workingBranch,
    repoOwner: job.repositoryOwner,
    repoName: job.repositoryName,
    specification: job.requestDocument,
    cycleNumber,
  };

  const title = generateSessionTitle('update', params);
  const prompt = getUpdatePrompt(params);

  logger.info(`Running update phase`, { component: 'OrchestratorService', cycleNumber });

  const result = await createAndExecuteSession({
    userId: job.userId,
    title,
    prompt,
    repoOwner: job.repositoryOwner,
    repoName: job.repositoryName,
    orchestratorJobId: job.id,
    orchestratorCycleId: cycleId,
  });

  // Archive the update session
  await archiveSession(job.userId, result.sessionId);

  // Get summary
  const tasks = await db.select().from(orchestratorTasks).where(eq(orchestratorTasks.cycleId, cycleId));
  const completedCount = tasks.filter((t: OrchestratorTask) => t.status === 'completed').length;
  const failedCount = tasks.filter((t: OrchestratorTask) => t.status === 'failed').length;

  const summary = `Cycle ${cycleNumber}: ${completedCount} tasks completed, ${failedCount} failed`;

  await db
    .update(orchestratorCycles)
    .set({ summary })
    .where(eq(orchestratorCycles.id, cycleId));

  orchestratorBroadcaster.broadcastCycleCompleted(job.id, cycleNumber, {
    tasksCompleted: completedCount,
    tasksFailed: failedCount,
    summary,
  });

  logger.info(`Update phase complete`, { component: 'OrchestratorService', cycleNumber });
}

/**
 * Mark a job as completed
 */
async function completeJob(jobId: string, reason: string): Promise<void> {
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));

  await db
    .update(orchestratorJobs)
    .set({ status: 'completed', completedAt: new Date(), updatedAt: new Date() })
    .where(eq(orchestratorJobs.id, jobId));

  const tasks = await db.select().from(orchestratorTasks).where(eq(orchestratorTasks.jobId, jobId));

  orchestratorBroadcaster.broadcastJobCompleted(jobId, {
    cycles: job?.currentCycle || 0,
    totalTasks: tasks.length,
    summary: `Job completed: ${reason}`,
  });

  orchestratorBroadcaster.endJob(jobId, reason);

  logger.info(`Job completed`, { component: 'OrchestratorService', jobId, reason });
}

/**
 * Check if job should terminate
 */
function checkTerminationConditions(job: OrchestratorJob): { terminate: boolean; reason?: string } {
  // Check max cycles
  if (job.maxCycles && job.currentCycle >= job.maxCycles) {
    return { terminate: true, reason: 'max_cycles_reached' };
  }

  // Check time limit
  if (job.timeLimitMinutes && job.startedAt) {
    const elapsed = (Date.now() - job.startedAt.getTime()) / 1000 / 60;
    if (elapsed >= job.timeLimitMinutes) {
      return { terminate: true, reason: 'time_limit_reached' };
    }
  }

  return { terminate: false };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
