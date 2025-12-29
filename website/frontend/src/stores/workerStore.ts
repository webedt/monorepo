/**
 * Worker Store
 * Tracks AI worker execution state
 */

import { z } from 'zod';

import { Store } from '../lib/store';
import { SESSION_KEYS } from '../lib/storageKeys';
import { TypedStorage } from '../lib/typedStorage';

interface WorkerState {
  executingSessionId: string | null;
  executionStartedAt: number | null;
  hasActiveStream: boolean;
  lastHeartbeat: number | null;
}

const WorkerStateSchema = z.object({
  executingSessionId: z.string().nullable(),
  executionStartedAt: z.number().nullable(),
  hasActiveStream: z.boolean(),
  lastHeartbeat: z.number().nullable(),
});

const DEFAULT_STATE: WorkerState = {
  executingSessionId: null,
  executionStartedAt: null,
  hasActiveStream: false,
  lastHeartbeat: null,
};

// Use sessionStorage for tab-specific persistence
const workerStorage = new TypedStorage({
  key: SESSION_KEYS.WORKER,
  schema: WorkerStateSchema,
  defaultValue: DEFAULT_STATE,
  version: 1,
  storageType: 'session',
});

export class WorkerStore extends Store<WorkerState> {
  private heartbeatTimeout: number | null = null;

  constructor() {
    super(DEFAULT_STATE);

    // Persist to sessionStorage for tab survival
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    const stored = workerStorage.get();

    // Only restore if execution was recent (within 5 minutes)
    if (stored.executionStartedAt && Date.now() - stored.executionStartedAt < 5 * 60 * 1000) {
      this.setState(stored);
    }

    // Save on changes
    this.subscribe((state) => {
      workerStorage.set(state);
    });
  }

  /**
   * Check if a session is currently executing
   */
  isExecuting(sessionId?: string): boolean {
    const state = this.getState();
    if (sessionId) {
      return state.executingSessionId === sessionId;
    }
    return state.executingSessionId !== null;
  }

  /**
   * Start execution for a session
   */
  startExecution(sessionId: string): void {
    this.setState({
      executingSessionId: sessionId,
      executionStartedAt: Date.now(),
      hasActiveStream: true,
      lastHeartbeat: Date.now(),
    });
    this.startHeartbeatMonitor();
  }

  /**
   * Stop execution
   */
  stopExecution(): void {
    this.setState({
      executingSessionId: null,
      executionStartedAt: null,
      hasActiveStream: false,
      lastHeartbeat: null,
    });
    this.stopHeartbeatMonitor();
  }

  /**
   * Update heartbeat (call this when receiving SSE events)
   */
  heartbeat(): void {
    this.setState({ lastHeartbeat: Date.now() });
  }

  /**
   * Set stream active state
   */
  setStreamActive(active: boolean): void {
    this.setState({ hasActiveStream: active });
    if (active) {
      this.heartbeat();
    }
  }

  /**
   * Get execution duration in milliseconds
   */
  getExecutionDuration(): number | null {
    const state = this.getState();
    if (state.executionStartedAt) {
      return Date.now() - state.executionStartedAt;
    }
    return null;
  }

  /**
   * Check if execution might be stale (no heartbeat for a while)
   */
  isStale(): boolean {
    const state = this.getState();
    if (!state.lastHeartbeat) return false;
    // Consider stale if no heartbeat for 30 seconds
    return Date.now() - state.lastHeartbeat > 30000;
  }

  private startHeartbeatMonitor(): void {
    this.stopHeartbeatMonitor();
    this.heartbeatTimeout = window.setInterval(() => {
      if (this.isStale()) {
        console.warn('[WorkerStore] Execution appears stale, stopping');
        this.stopExecution();
      }
    }, 10000);
  }

  private stopHeartbeatMonitor(): void {
    if (this.heartbeatTimeout) {
      clearInterval(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }
}

// Singleton instance with HMR support
export const workerStore = new WorkerStore().enableHmr('worker');

// HMR setup
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => {
    workerStore.saveForHmr();
  });
}

/**
 * Clear the storage cache. Used by tests to ensure fresh reads from sessionStorage.
 * @internal
 */
export function __clearStorageCache(): void {
  workerStorage.clearCache();
}
