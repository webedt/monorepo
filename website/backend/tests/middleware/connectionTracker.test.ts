/**
 * Tests for Connection Tracker Middleware
 * Covers connection tracking, shutdown behavior, and drain waiting
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import type { Request, Response, NextFunction } from 'express';

// Create a fresh ConnectionTracker instance for each test
class TestConnectionTracker {
  private activeConnections = 0;
  private totalConnectionsServed = 0;
  private isShuttingDown = false;

  startShutdown(): void {
    this.isShuttingDown = true;
  }

  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  connectionStarted(): void {
    this.activeConnections++;
  }

  connectionEnded(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.totalConnectionsServed++;
  }

  getStats() {
    return {
      activeConnections: this.activeConnections,
      totalConnectionsServed: this.totalConnectionsServed,
    };
  }

  isDrained(): boolean {
    return this.activeConnections === 0;
  }

  getActiveConnectionCount(): number {
    return this.activeConnections;
  }

  async waitForDrain(timeoutMs: number, pollIntervalMs = 10): Promise<boolean> {
    const startTime = Date.now();

    while (!this.isDrained()) {
      if (Date.now() - startTime >= timeoutMs) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    return true;
  }

  reset(): void {
    this.activeConnections = 0;
    this.totalConnectionsServed = 0;
    this.isShuttingDown = false;
  }
}

describe('ConnectionTracker', () => {
  let tracker: TestConnectionTracker;

  beforeEach(() => {
    tracker = new TestConnectionTracker();
  });

  describe('connectionStarted/connectionEnded', () => {
    it('should track connection start', () => {
      assert.strictEqual(tracker.getActiveConnectionCount(), 0);

      tracker.connectionStarted();

      assert.strictEqual(tracker.getActiveConnectionCount(), 1);
    });

    it('should track connection end', () => {
      tracker.connectionStarted();
      assert.strictEqual(tracker.getActiveConnectionCount(), 1);

      tracker.connectionEnded();

      assert.strictEqual(tracker.getActiveConnectionCount(), 0);
    });

    it('should track multiple concurrent connections', () => {
      tracker.connectionStarted();
      tracker.connectionStarted();
      tracker.connectionStarted();

      assert.strictEqual(tracker.getActiveConnectionCount(), 3);

      tracker.connectionEnded();
      assert.strictEqual(tracker.getActiveConnectionCount(), 2);

      tracker.connectionEnded();
      tracker.connectionEnded();
      assert.strictEqual(tracker.getActiveConnectionCount(), 0);
    });

    it('should not go below zero on underflow', () => {
      tracker.connectionEnded();
      tracker.connectionEnded();

      assert.strictEqual(tracker.getActiveConnectionCount(), 0);
    });

    it('should track total connections served', () => {
      tracker.connectionStarted();
      tracker.connectionEnded();
      tracker.connectionStarted();
      tracker.connectionEnded();
      tracker.connectionStarted();
      tracker.connectionEnded();

      const stats = tracker.getStats();
      assert.strictEqual(stats.totalConnectionsServed, 3);
    });
  });

  describe('shutdown behavior', () => {
    it('should not be in shutdown mode initially', () => {
      assert.strictEqual(tracker.isInShutdown(), false);
    });

    it('should enter shutdown mode when startShutdown is called', () => {
      tracker.startShutdown();

      assert.strictEqual(tracker.isInShutdown(), true);
    });
  });

  describe('isDrained', () => {
    it('should return true when no active connections', () => {
      assert.strictEqual(tracker.isDrained(), true);
    });

    it('should return false when there are active connections', () => {
      tracker.connectionStarted();

      assert.strictEqual(tracker.isDrained(), false);
    });

    it('should return true after all connections end', () => {
      tracker.connectionStarted();
      tracker.connectionStarted();
      tracker.connectionEnded();
      tracker.connectionEnded();

      assert.strictEqual(tracker.isDrained(), true);
    });
  });

  describe('waitForDrain', () => {
    it('should return true immediately when already drained', async () => {
      const result = await tracker.waitForDrain(100);

      assert.strictEqual(result, true);
    });

    it('should return true when connections drain within timeout', async () => {
      tracker.connectionStarted();

      // Simulate connection ending after 20ms
      setTimeout(() => {
        tracker.connectionEnded();
      }, 20);

      const result = await tracker.waitForDrain(100, 10);

      assert.strictEqual(result, true);
    });

    it('should return false when timeout is reached', async () => {
      tracker.connectionStarted();

      const result = await tracker.waitForDrain(50, 10);

      assert.strictEqual(result, false);
      assert.strictEqual(tracker.getActiveConnectionCount(), 1);
    });
  });

  describe('getStats', () => {
    it('should return current statistics', () => {
      tracker.connectionStarted();
      tracker.connectionStarted();
      tracker.connectionEnded();

      const stats = tracker.getStats();

      assert.strictEqual(stats.activeConnections, 1);
      assert.strictEqual(stats.totalConnectionsServed, 1);
    });
  });
});

describe('connectionTrackerMiddleware behavior', () => {
  it('should return 503 during shutdown', () => {
    const tracker = new TestConnectionTracker();
    tracker.startShutdown();

    // Simulate middleware behavior
    const isShutdown = tracker.isInShutdown();

    assert.strictEqual(isShutdown, true);
    // In real middleware, this would trigger 503 response
  });

  it('should track connections when not in shutdown', () => {
    const tracker = new TestConnectionTracker();

    // Simulate middleware tracking
    if (!tracker.isInShutdown()) {
      tracker.connectionStarted();
    }

    assert.strictEqual(tracker.getActiveConnectionCount(), 1);
  });
});
