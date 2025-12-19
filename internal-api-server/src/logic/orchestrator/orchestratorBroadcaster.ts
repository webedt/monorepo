/**
 * OrchestratorBroadcaster
 *
 * A pub/sub system for broadcasting SSE events from orchestrator jobs.
 * Similar to SessionEventBroadcaster but tailored for multi-cycle orchestration.
 */

import { EventEmitter } from 'events';

export interface OrchestratorEvent {
  type: string;
  jobId: string;
  cycle?: number;
  taskId?: string;
  data?: unknown;
  timestamp: Date;
}

interface Subscriber {
  id: string;
  callback: (event: OrchestratorEvent) => void;
}

class OrchestratorBroadcaster extends EventEmitter {
  // Map of jobId -> array of subscribers
  private subscribers: Map<string, Subscriber[]> = new Map();

  // Track which jobs are currently active
  private activeJobs: Set<string> = new Set();

  constructor() {
    super();
    this.setMaxListeners(1000);
  }

  /**
   * Mark a job as active (currently running)
   */
  startJob(jobId: string): void {
    this.activeJobs.add(jobId);
    console.log(`[OrchestratorBroadcaster] Job ${jobId} started`);
  }

  /**
   * Mark a job as inactive (completed/cancelled/error)
   */
  endJob(jobId: string, reason?: string): void {
    this.activeJobs.delete(jobId);

    // Notify all subscribers that the job has ended
    const subscribers = this.subscribers.get(jobId);
    if (subscribers) {
      const endEvent: OrchestratorEvent = {
        type: 'job_ended',
        jobId,
        data: { reason },
        timestamp: new Date(),
      };
      subscribers.forEach(sub => {
        try {
          sub.callback(endEvent);
        } catch (err) {
          console.error(`[OrchestratorBroadcaster] Error notifying subscriber ${sub.id} of job end:`, err);
        }
      });
    }

    // Clean up subscribers
    this.subscribers.delete(jobId);
    console.log(`[OrchestratorBroadcaster] Job ${jobId} ended (${reason}), cleaned up subscribers`);
  }

  /**
   * Check if a job is currently active
   */
  isJobActive(jobId: string): boolean {
    return this.activeJobs.has(jobId);
  }

  /**
   * Subscribe to events for a specific job
   * Returns an unsubscribe function
   */
  subscribe(jobId: string, subscriberId: string, callback: (event: OrchestratorEvent) => void): () => void {
    if (!this.subscribers.has(jobId)) {
      this.subscribers.set(jobId, []);
    }

    const subscriber: Subscriber = { id: subscriberId, callback };
    this.subscribers.get(jobId)!.push(subscriber);

    console.log(`[OrchestratorBroadcaster] Subscriber ${subscriberId} subscribed to job ${jobId}`);

    return () => {
      const subs = this.subscribers.get(jobId);
      if (subs) {
        const index = subs.findIndex(s => s.id === subscriberId);
        if (index !== -1) {
          subs.splice(index, 1);
          console.log(`[OrchestratorBroadcaster] Subscriber ${subscriberId} unsubscribed from job ${jobId}`);
        }
        if (subs.length === 0) {
          this.subscribers.delete(jobId);
        }
      }
    };
  }

  /**
   * Broadcast an event to all subscribers of a job
   */
  broadcast(event: Omit<OrchestratorEvent, 'timestamp'>): void {
    const subscribers = this.subscribers.get(event.jobId);
    if (!subscribers || subscribers.length === 0) {
      return;
    }

    const fullEvent: OrchestratorEvent = {
      ...event,
      timestamp: new Date(),
    };

    subscribers.forEach(sub => {
      try {
        sub.callback(fullEvent);
      } catch (err) {
        console.error(`[OrchestratorBroadcaster] Error broadcasting to subscriber ${sub.id}:`, err);
      }
    });
  }

  /**
   * Convenience method for job lifecycle events
   */
  broadcastJobStarted(jobId: string): void {
    this.broadcast({ type: 'job_started', jobId, cycle: 0 });
  }

  broadcastJobPaused(jobId: string, cycle: number): void {
    this.broadcast({ type: 'job_paused', jobId, cycle });
  }

  broadcastJobResumed(jobId: string, cycle: number): void {
    this.broadcast({ type: 'job_resumed', jobId, cycle });
  }

  broadcastJobCompleted(jobId: string, summary: { cycles: number; totalTasks: number; summary?: string }): void {
    this.broadcast({ type: 'job_completed', jobId, data: summary });
  }

  broadcastJobError(jobId: string, error: string): void {
    this.broadcast({ type: 'job_error', jobId, data: { error } });
  }

  /**
   * Convenience method for cycle events
   */
  broadcastCycleStarted(jobId: string, cycle: number): void {
    this.broadcast({ type: 'cycle_started', jobId, cycle, data: { phase: 'discovery' } });
  }

  broadcastCyclePhase(jobId: string, cycle: number, phase: string): void {
    this.broadcast({ type: 'cycle_phase', jobId, cycle, data: { phase } });
  }

  broadcastTasksDiscovered(jobId: string, cycle: number, tasks: Array<{ id: string; description: string }>): void {
    this.broadcast({ type: 'cycle_tasks_discovered', jobId, cycle, data: { tasks } });
  }

  broadcastCycleCompleted(
    jobId: string,
    cycle: number,
    summary: { tasksCompleted: number; tasksFailed: number; summary?: string }
  ): void {
    this.broadcast({ type: 'cycle_completed', jobId, cycle, data: summary });
  }

  /**
   * Convenience method for task events
   */
  broadcastTaskStarted(jobId: string, cycle: number, taskId: string, description: string, agentSessionId?: string): void {
    this.broadcast({
      type: 'task_started',
      jobId,
      cycle,
      taskId,
      data: { description, agentSessionId },
    });
  }

  broadcastTaskProgress(jobId: string, cycle: number, taskId: string, message: string): void {
    this.broadcast({ type: 'task_progress', jobId, cycle, taskId, data: { message } });
  }

  broadcastTaskCompleted(
    jobId: string,
    cycle: number,
    taskId: string,
    summary: { resultSummary?: string; filesModified?: string[] }
  ): void {
    this.broadcast({ type: 'task_completed', jobId, cycle, taskId, data: summary });
  }

  broadcastTaskFailed(jobId: string, cycle: number, taskId: string, error: string): void {
    this.broadcast({ type: 'task_failed', jobId, cycle, taskId, data: { error } });
  }

  /**
   * Forward agent events (passthrough from agent sessions)
   */
  broadcastAgentEvent(jobId: string, cycle: number, taskId: string, agentSessionId: string, agentEvent: unknown): void {
    this.broadcast({
      type: 'agent_message',
      jobId,
      cycle,
      taskId,
      data: { agentSessionId, event: agentEvent },
    });
  }

  /**
   * Get active job count
   */
  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  /**
   * Get subscriber count for a job
   */
  getSubscriberCount(jobId: string): number {
    return this.subscribers.get(jobId)?.length || 0;
  }
}

// Export singleton instance
export const orchestratorBroadcaster = new OrchestratorBroadcaster();
