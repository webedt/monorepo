/**
 * OrchestratorService
 *
 * Main service class for managing long-running multi-cycle orchestration jobs.
 * Handles the complete lifecycle: creation, cycle execution, pause/resume, and completion.
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
  discoverTasks,
  generateCycleSummary,
  updateTaskList,
  DiscoveredTask,
} from './taskDiscovery.js';

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
    maxParallelTasks: config.maxParallelTasks || 3,
    provider: config.provider || 'claude',
  };

  const [job] = await db.insert(orchestratorJobs).values(newJob).returning();

  console.log(`[OrchestratorService] Created job ${jobId} for ${config.repositoryOwner}/${config.repositoryName}`);

  return job;
}

/**
 * Start running an orchestrator job
 */
export async function startJob(jobId: string, apiKey: string): Promise<void> {
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

  // Start the cycle loop
  const promise = runCycleLoop(jobId, apiKey, () => cancelled);

  activeJobRunners.set(jobId, { cancel, promise });

  // Mark as active for broadcasting
  orchestratorBroadcaster.startJob(jobId);
  orchestratorBroadcaster.broadcastJobStarted(jobId);

  console.log(`[OrchestratorService] Started job ${jobId}`);

  // Clean up when done
  promise
    .catch(err => {
      console.error(`[OrchestratorService] Job ${jobId} error:`, err);
    })
    .finally(() => {
      activeJobRunners.delete(jobId);
    });
}

/**
 * Pause a running job (will finish current cycle first)
 */
export async function pauseJob(jobId: string): Promise<void> {
  const runner = activeJobRunners.get(jobId);
  if (!runner) {
    throw new Error('Job is not running');
  }

  // Signal cancellation
  runner.cancel();

  // Update status
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
  if (job) {
    await db
      .update(orchestratorJobs)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(orchestratorJobs.id, jobId));

    orchestratorBroadcaster.broadcastJobPaused(jobId, job.currentCycle);
  }

  console.log(`[OrchestratorService] Paused job ${jobId}`);
}

/**
 * Resume a paused job
 */
export async function resumeJob(jobId: string, apiKey: string): Promise<void> {
  const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
  if (!job) {
    throw new Error('Job not found');
  }

  if (job.status !== 'paused') {
    throw new Error(`Cannot resume job with status: ${job.status}`);
  }

  await startJob(jobId, apiKey);
  orchestratorBroadcaster.broadcastJobResumed(jobId, job.currentCycle);

  console.log(`[OrchestratorService] Resumed job ${jobId}`);
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

  console.log(`[OrchestratorService] Cancelled job ${jobId}`);
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

/**
 * Main cycle loop - runs until completion, pause, or cancellation
 */
async function runCycleLoop(jobId: string, apiKey: string, isCancelled: () => boolean): Promise<void> {
  try {
    while (!isCancelled()) {
      // Get current job state
      const [job] = await db.select().from(orchestratorJobs).where(eq(orchestratorJobs.id, jobId));
      if (!job) {
        throw new Error('Job not found');
      }

      // Check termination conditions
      const termination = checkTerminationConditions(job);
      if (termination.terminate) {
        await completeJob(jobId, termination.reason || 'completed');
        return;
      }

      // Run one cycle
      const cycleNumber = job.currentCycle + 1;
      const shouldContinue = await runCycle(job, cycleNumber, apiKey, isCancelled);

      // Update current cycle counter
      await db
        .update(orchestratorJobs)
        .set({ currentCycle: cycleNumber, updatedAt: new Date() })
        .where(eq(orchestratorJobs.id, jobId));

      if (!shouldContinue) {
        await completeJob(jobId, 'all_tasks_complete');
        return;
      }

      // Check if cancelled during cycle
      if (isCancelled()) {
        console.log(`[OrchestratorService] Job ${jobId} cancelled during cycle ${cycleNumber}`);
        return;
      }

      // Brief pause between cycles
      await sleep(2000);
    }
  } catch (error) {
    console.error(`[OrchestratorService] Job ${jobId} failed:`, error);

    await db
      .update(orchestratorJobs)
      .set({
        status: 'error',
        lastError: (error as Error).message,
        errorCount: (await getJob(jobId))?.errorCount ?? 0 + 1,
        updatedAt: new Date(),
      })
      .where(eq(orchestratorJobs.id, jobId));

    orchestratorBroadcaster.broadcastJobError(jobId, (error as Error).message);
    orchestratorBroadcaster.endJob(jobId, 'error');
  }
}

/**
 * Run a single cycle
 */
async function runCycle(
  job: OrchestratorJob,
  cycleNumber: number,
  apiKey: string,
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

  console.log(`[OrchestratorService] Starting cycle ${cycleNumber} for job ${job.id}`);

  // Phase 1: Discovery
  const discoveredTasks = await discoveryPhase(job, cycleId, cycleNumber, apiKey);

  if (discoveredTasks.length === 0) {
    // No more tasks to do
    await db
      .update(orchestratorCycles)
      .set({ phase: 'completed', completedAt: new Date() })
      .where(eq(orchestratorCycles.id, cycleId));

    return false; // Signal completion
  }

  if (isCancelled()) return true;

  // Phase 2: Execution
  await executionPhase(job, cycleId, cycleNumber, discoveredTasks, apiKey, isCancelled);

  if (isCancelled()) return true;

  // Phase 3: Convergence
  await convergencePhase(job, cycleId, cycleNumber);

  if (isCancelled()) return true;

  // Phase 4: Update
  await updatePhase(job, cycleId, cycleNumber, apiKey);

  // Mark cycle complete
  await db
    .update(orchestratorCycles)
    .set({ phase: 'completed', completedAt: new Date() })
    .where(eq(orchestratorCycles.id, cycleId));

  return true; // Continue to next cycle
}

/**
 * Phase 1: Discovery - Use LLM to find tasks
 */
async function discoveryPhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number,
  apiKey: string
): Promise<DiscoveredTask[]> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'discovery');

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: Discovery phase`);

  // Get previous cycle summary if exists
  let previousCycleSummary: string | undefined;
  if (cycleNumber > 1) {
    const [prevCycle] = await db
      .select()
      .from(orchestratorCycles)
      .where(and(eq(orchestratorCycles.jobId, job.id), eq(orchestratorCycles.cycleNumber, cycleNumber - 1)));

    previousCycleSummary = prevCycle?.summary || undefined;
  }

  // TODO: Get actual file tree and git status from the repository
  // For now, use placeholders
  const context = {
    requestDocument: job.requestDocument,
    taskList: job.taskList,
    repoOwner: job.repositoryOwner,
    repoName: job.repositoryName,
    branch: job.workingBranch,
    recentCommits: [], // TODO: Get from git
    fileTree: 'File tree not yet implemented', // TODO: Get from storage
    gitStatus: 'Git status not yet implemented', // TODO: Get from git
    previousCycleSummary,
  };

  const result = await discoverTasks(context, apiKey);

  // Create task records
  const taskRecords: NewOrchestratorTask[] = result.tasks.map((task: DiscoveredTask, index: number) => ({
    id: uuidv4(),
    cycleId,
    jobId: job.id,
    taskNumber: index + 1,
    description: task.description,
    context: task.context,
    priority: task.priority,
    canRunParallel: task.parallel,
    status: 'pending' as const,
    retryCount: 0,
  }));

  if (taskRecords.length > 0) {
    await db.insert(orchestratorTasks).values(taskRecords);
  }

  // Update cycle with task count
  await db
    .update(orchestratorCycles)
    .set({ tasksDiscovered: result.tasks.length })
    .where(eq(orchestratorCycles.id, cycleId));

  // Broadcast discovered tasks
  orchestratorBroadcaster.broadcastTasksDiscovered(
    job.id,
    cycleNumber,
    taskRecords.map(t => ({ id: t.id, description: t.description }))
  );

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: Discovered ${result.tasks.length} tasks`);

  return result.tasks;
}

/**
 * Phase 2: Execution - Run tasks in parallel
 */
async function executionPhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number,
  discoveredTasks: DiscoveredTask[],
  apiKey: string,
  isCancelled: () => boolean
): Promise<void> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'execution');

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: Execution phase`);

  // Get task records
  const tasks = await db
    .select()
    .from(orchestratorTasks)
    .where(eq(orchestratorTasks.cycleId, cycleId))
    .orderBy(orchestratorTasks.taskNumber);

  // Determine which tasks can run in parallel
  const parallelTasks = tasks.filter((t: OrchestratorTask) => t.canRunParallel);
  const sequentialTasks = tasks.filter((t: OrchestratorTask) => !t.canRunParallel);

  // Run parallel tasks first (up to maxParallelTasks)
  const maxParallel = job.maxParallelTasks;
  const taskBatches: OrchestratorTask[][] = [];

  for (let i = 0; i < parallelTasks.length; i += maxParallel) {
    taskBatches.push(parallelTasks.slice(i, i + maxParallel));
  }

  // Add sequential tasks as individual batches
  sequentialTasks.forEach((t: OrchestratorTask) => taskBatches.push([t]));

  let launched = 0;

  for (const batch of taskBatches) {
    if (isCancelled()) break;

    // Launch all tasks in the batch
    const taskPromises = batch.map(task => executeTask(job, task, cycleNumber, apiKey));

    launched += batch.length;
    await db
      .update(orchestratorCycles)
      .set({ tasksLaunched: launched })
      .where(eq(orchestratorCycles.id, cycleId));

    // Wait for batch to complete
    await Promise.allSettled(taskPromises);
  }

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: Executed ${launched} tasks`);
}

/**
 * Execute a single task
 */
async function executeTask(
  job: OrchestratorJob,
  task: OrchestratorTask,
  cycleNumber: number,
  _apiKey: string
): Promise<void> {
  console.log(`[OrchestratorService] Starting task ${task.taskNumber}: ${task.description}`);

  // Mark task as running
  await db
    .update(orchestratorTasks)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(orchestratorTasks.id, task.id));

  orchestratorBroadcaster.broadcastTaskStarted(job.id, cycleNumber, task.id, task.description);

  try {
    // TODO: Actually spawn an agent session here
    // For now, simulate task execution
    await simulateTaskExecution(job, task, cycleNumber);

    // Mark task as completed
    await db
      .update(orchestratorTasks)
      .set({
        status: 'completed',
        completedAt: new Date(),
        resultSummary: `Completed: ${task.description}`,
      })
      .where(eq(orchestratorTasks.id, task.id));

    orchestratorBroadcaster.broadcastTaskCompleted(job.id, cycleNumber, task.id, {
      resultSummary: `Completed: ${task.description}`,
    });

    console.log(`[OrchestratorService] Task ${task.taskNumber} completed`);
  } catch (error) {
    // Mark task as failed
    await db
      .update(orchestratorTasks)
      .set({
        status: 'failed',
        completedAt: new Date(),
        errorMessage: (error as Error).message,
      })
      .where(eq(orchestratorTasks.id, task.id));

    orchestratorBroadcaster.broadcastTaskFailed(job.id, cycleNumber, task.id, (error as Error).message);

    console.error(`[OrchestratorService] Task ${task.taskNumber} failed:`, error);
  }
}

/**
 * Simulate task execution (placeholder for actual agent spawning)
 */
async function simulateTaskExecution(
  _job: OrchestratorJob,
  task: OrchestratorTask,
  cycleNumber: number
): Promise<void> {
  // Simulate work with progress updates
  for (let i = 1; i <= 3; i++) {
    await sleep(1000);
    orchestratorBroadcaster.broadcastTaskProgress(
      _job.id,
      cycleNumber,
      task.id,
      `Step ${i}/3: Processing...`
    );
  }
}

/**
 * Phase 3: Convergence - Wait for all tasks and collect results
 */
async function convergencePhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number
): Promise<void> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'convergence');

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: Convergence phase`);

  // Get task results
  const tasks = await db.select().from(orchestratorTasks).where(eq(orchestratorTasks.cycleId, cycleId));

  const completed = tasks.filter((t: OrchestratorTask) => t.status === 'completed').length;
  const failed = tasks.filter((t: OrchestratorTask) => t.status === 'failed').length;

  await db
    .update(orchestratorCycles)
    .set({ tasksCompleted: completed, tasksFailed: failed })
    .where(eq(orchestratorCycles.id, cycleId));

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: ${completed} completed, ${failed} failed`);
}

/**
 * Phase 4: Update - Update task list and generate summary
 */
async function updatePhase(
  job: OrchestratorJob,
  cycleId: string,
  cycleNumber: number,
  apiKey: string
): Promise<void> {
  orchestratorBroadcaster.broadcastCyclePhase(job.id, cycleNumber, 'update');

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: Update phase`);

  // Get tasks
  const tasks = await db.select().from(orchestratorTasks).where(eq(orchestratorTasks.cycleId, cycleId));

  const completedTasks = tasks
    .filter((t: OrchestratorTask) => t.status === 'completed')
    .map((t: OrchestratorTask) => ({
      description: t.description,
      resultSummary: t.resultSummary || undefined,
      filesModified: t.filesModified || undefined,
    }));

  const failedTasks = tasks
    .filter((t: OrchestratorTask) => t.status === 'failed')
    .map((t: OrchestratorTask) => ({
      description: t.description,
      errorMessage: t.errorMessage || undefined,
    }));

  // Generate cycle summary
  const summary = await generateCycleSummary(completedTasks, failedTasks, apiKey);

  // Update task list
  const updatedTaskList = await updateTaskList(job.taskList, completedTasks, failedTasks, [], apiKey);

  // Update cycle and job
  await db
    .update(orchestratorCycles)
    .set({ summary })
    .where(eq(orchestratorCycles.id, cycleId));

  await db
    .update(orchestratorJobs)
    .set({ taskList: updatedTaskList, updatedAt: new Date() })
    .where(eq(orchestratorJobs.id, job.id));

  orchestratorBroadcaster.broadcastCycleCompleted(job.id, cycleNumber, {
    tasksCompleted: completedTasks.length,
    tasksFailed: failedTasks.length,
    summary,
  });

  console.log(`[OrchestratorService] Cycle ${cycleNumber}: Updated task list and summary`);
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

  // Get total task count
  const tasks = await db.select().from(orchestratorTasks).where(eq(orchestratorTasks.jobId, jobId));

  orchestratorBroadcaster.broadcastJobCompleted(jobId, {
    cycles: job?.currentCycle || 0,
    totalTasks: tasks.length,
    summary: `Job completed: ${reason}`,
  });

  orchestratorBroadcaster.endJob(jobId, reason);

  console.log(`[OrchestratorService] Job ${jobId} completed: ${reason}`);
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

/**
 * Sleep helper
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
