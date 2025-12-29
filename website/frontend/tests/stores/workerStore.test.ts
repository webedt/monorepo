/**
 * Tests for WorkerStore
 * Covers AI worker execution state management including
 * execution lifecycle, heartbeat monitoring, and session storage persistence.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import the actual WorkerStore class
import { WorkerStore } from '../../src/stores/workerStore';

const STORAGE_KEY = 'workerStore';
const STALE_THRESHOLD_MS = 30000; // 30 seconds
const EXECUTION_RESTORE_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

describe('WorkerStore', () => {
  let workerStore: WorkerStore;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
    // Create fresh instance - sessionStorage is empty so initial state is defaults
    workerStore = new WorkerStore();
  });

  afterEach(() => {
    // Stop any running intervals by stopping execution
    workerStore.stopExecution();
    vi.useRealTimers();
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = workerStore.getState();

      expect(state.executingSessionId).toBeNull();
      expect(state.executionStartedAt).toBeNull();
      expect(state.hasActiveStream).toBe(false);
      expect(state.lastHeartbeat).toBeNull();
    });

    it('should not be executing initially', () => {
      expect(workerStore.isExecuting()).toBe(false);
    });
  });

  describe('Start Execution', () => {
    it('should start execution with session ID', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      const state = workerStore.getState();
      expect(state.executingSessionId).toBe('session-123');
      expect(state.executionStartedAt).toBe(now);
      expect(state.hasActiveStream).toBe(true);
      expect(state.lastHeartbeat).toBe(now);
    });

    it('should be executing after start', () => {
      workerStore.startExecution('session-123');

      expect(workerStore.isExecuting()).toBe(true);
      expect(workerStore.isExecuting('session-123')).toBe(true);
      expect(workerStore.isExecuting('other-session')).toBe(false);
    });

    it('should start heartbeat monitor that stops stale execution', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      // Advance time past stale threshold
      vi.setSystemTime(now + STALE_THRESHOLD_MS + 1);

      // Trigger the interval check
      vi.advanceTimersByTime(10000);

      // Monitor should have stopped the stale execution
      expect(workerStore.isExecuting()).toBe(false);
    });

    it('should replace existing execution', () => {
      workerStore.startExecution('session-1');
      workerStore.startExecution('session-2');

      expect(workerStore.getState().executingSessionId).toBe('session-2');
    });
  });

  describe('Stop Execution', () => {
    beforeEach(() => {
      workerStore.startExecution('session-123');
    });

    it('should clear execution state', () => {
      workerStore.stopExecution();

      const state = workerStore.getState();
      expect(state.executingSessionId).toBeNull();
      expect(state.executionStartedAt).toBeNull();
      expect(state.hasActiveStream).toBe(false);
      expect(state.lastHeartbeat).toBeNull();
    });

    it('should stop heartbeat monitor', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.stopExecution();

      // Advance time and trigger interval - no errors should occur
      vi.setSystemTime(now + STALE_THRESHOLD_MS + 1);
      vi.advanceTimersByTime(10000);

      // Should remain stopped (monitor cleared)
      expect(workerStore.isExecuting()).toBe(false);
    });

    it('should report not executing after stop', () => {
      workerStore.stopExecution();

      expect(workerStore.isExecuting()).toBe(false);
    });
  });

  describe('Heartbeat', () => {
    it('should update last heartbeat time', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      vi.setSystemTime(now + 5000);
      workerStore.heartbeat();

      expect(workerStore.getState().lastHeartbeat).toBe(now + 5000);
    });

    it('should allow heartbeat without active execution', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.heartbeat();

      expect(workerStore.getState().lastHeartbeat).toBe(now);
    });
  });

  describe('Stream Active State', () => {
    it('should set stream active state', () => {
      workerStore.setStreamActive(true);

      expect(workerStore.getState().hasActiveStream).toBe(true);
    });

    it('should set stream inactive state', () => {
      workerStore.setStreamActive(true);
      workerStore.setStreamActive(false);

      expect(workerStore.getState().hasActiveStream).toBe(false);
    });

    it('should trigger heartbeat when setting stream active', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.setStreamActive(true);

      expect(workerStore.getState().lastHeartbeat).toBe(now);
    });

    it('should not trigger heartbeat when setting stream inactive', () => {
      workerStore.setState({
        executingSessionId: null,
        executionStartedAt: null,
        hasActiveStream: false,
        lastHeartbeat: 1000,
      });

      workerStore.setStreamActive(false);

      expect(workerStore.getState().lastHeartbeat).toBe(1000);
    });
  });

  describe('Execution Duration', () => {
    it('should return execution duration', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      vi.setSystemTime(now + 5000);

      expect(workerStore.getExecutionDuration()).toBe(5000);
    });

    it('should return null when not executing', () => {
      expect(workerStore.getExecutionDuration()).toBeNull();
    });

    it('should update duration over time', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      vi.setSystemTime(now + 1000);
      expect(workerStore.getExecutionDuration()).toBe(1000);

      vi.setSystemTime(now + 5000);
      expect(workerStore.getExecutionDuration()).toBe(5000);

      vi.setSystemTime(now + 60000);
      expect(workerStore.getExecutionDuration()).toBe(60000);
    });
  });

  describe('Staleness Detection', () => {
    it('should not be stale initially', () => {
      expect(workerStore.isStale()).toBe(false);
    });

    it('should not be stale with recent heartbeat', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      vi.setSystemTime(now + 10000); // 10 seconds later

      expect(workerStore.isStale()).toBe(false);
    });

    it('should be stale after threshold', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      vi.setSystemTime(now + STALE_THRESHOLD_MS + 1); // Just past threshold

      expect(workerStore.isStale()).toBe(true);
    });

    it('should reset staleness with new heartbeat', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      vi.setSystemTime(now + STALE_THRESHOLD_MS + 1);
      expect(workerStore.isStale()).toBe(true);

      workerStore.heartbeat();
      expect(workerStore.isStale()).toBe(false);
    });
  });

  describe('Heartbeat Monitor', () => {
    it('should stop execution when stale', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      // Advance time past stale threshold
      vi.setSystemTime(now + STALE_THRESHOLD_MS + 1);

      // Trigger the interval check
      vi.advanceTimersByTime(10000);

      expect(workerStore.isExecuting()).toBe(false);
    });

    it('should not stop execution when receiving heartbeats', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');

      // Simulate periodic heartbeats
      for (let i = 1; i <= 5; i++) {
        vi.setSystemTime(now + i * 10000);
        workerStore.heartbeat();
        vi.advanceTimersByTime(10000);
      }

      expect(workerStore.isExecuting()).toBe(true);
    });

    it('should clean up monitor on stop', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-123');
      workerStore.stopExecution();

      // Start a new execution and let it go stale
      workerStore.startExecution('session-456');

      // The old monitor should not interfere
      vi.setSystemTime(now + STALE_THRESHOLD_MS + 1);
      vi.advanceTimersByTime(10000);

      // New execution should be stopped by its own monitor
      expect(workerStore.isExecuting()).toBe(false);
    });

    it('should restart monitor on new execution', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.startExecution('session-1');

      // Advance time but not past stale threshold
      vi.setSystemTime(now + 20000);
      workerStore.heartbeat();

      // Start new execution
      workerStore.startExecution('session-2');

      // Advance time past stale threshold from new start
      vi.setSystemTime(now + 20000 + STALE_THRESHOLD_MS + 1);
      vi.advanceTimersByTime(10000);

      // Should have stopped due to staleness
      expect(workerStore.isExecuting()).toBe(false);
    });
  });

  describe('Session Storage Persistence', () => {
    it('should persist state to sessionStorage', () => {
      vi.setSystemTime(1000);
      workerStore.startExecution('session-123');

      const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '{}');
      expect(stored.executingSessionId).toBe('session-123');
      expect(stored.hasActiveStream).toBe(true);
    });

    it('should restore recent execution from sessionStorage', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        executingSessionId: 'saved-session',
        executionStartedAt: now - 60000, // 1 minute ago (within window)
        hasActiveStream: true,
        lastHeartbeat: now - 30000,
      }));

      const store = new WorkerStore();

      expect(store.getState().executingSessionId).toBe('saved-session');
      expect(store.getState().hasActiveStream).toBe(true);

      store.stopExecution();
    });

    it('should not restore old execution from sessionStorage', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
        executingSessionId: 'old-session',
        executionStartedAt: now - (EXECUTION_RESTORE_WINDOW_MS + 1), // Too old
        hasActiveStream: true,
        lastHeartbeat: now - EXECUTION_RESTORE_WINDOW_MS,
      }));

      const store = new WorkerStore();

      expect(store.getState().executingSessionId).toBeNull();

      store.stopExecution();
    });

    it('should handle malformed sessionStorage data', () => {
      sessionStorage.setItem(STORAGE_KEY, 'invalid json{{{');

      const store = new WorkerStore();

      // Should fall back to defaults
      expect(store.getState().executingSessionId).toBeNull();

      store.stopExecution();
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      workerStore.subscribe(subscriber);

      workerStore.startExecution('session-123');

      expect(subscriber).toHaveBeenCalled();
    });

    it('should provide previous state to subscribers', () => {
      workerStore.startExecution('session-1');

      const subscriber = vi.fn();
      workerStore.subscribe(subscriber);

      workerStore.startExecution('session-2');

      expect(subscriber).toHaveBeenCalledWith(
        expect.objectContaining({ executingSessionId: 'session-2' }),
        expect.objectContaining({ executingSessionId: 'session-1' })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple start/stop cycles', () => {
      for (let i = 0; i < 10; i++) {
        workerStore.startExecution(`session-${i}`);
        workerStore.stopExecution();
      }

      expect(workerStore.isExecuting()).toBe(false);
    });

    it('should handle stop without start', () => {
      // Should not throw
      workerStore.stopExecution();

      expect(workerStore.isExecuting()).toBe(false);
    });

    it('should handle heartbeat without execution', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      workerStore.heartbeat();

      expect(workerStore.getState().lastHeartbeat).toBe(now);
    });

    it('should handle rapid state changes', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      for (let i = 0; i < 100; i++) {
        workerStore.startExecution(`session-${i}`);
        workerStore.heartbeat();
      }

      expect(workerStore.getState().executingSessionId).toBe('session-99');
      workerStore.stopExecution();
    });
  });
});
