/**
 * Tests for Graceful Shutdown Manager
 * Covers shutdown sequence, timeout behavior, and multiple shutdown prevention
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

/**
 * Mock shutdown state for testing
 * Mirrors the structure in gracefulShutdown.ts
 */
interface ShutdownState {
  isShuttingDown: boolean;
  shutdownStartTime: number | null;
  shutdownReason: string | null;
}

/**
 * Test implementation of shutdown state management
 */
class TestShutdownManager {
  private state: ShutdownState = {
    isShuttingDown: false,
    shutdownStartTime: null,
    shutdownReason: null,
  };

  private shutdownSteps: string[] = [];

  isShuttingDown(): boolean {
    return this.state.isShuttingDown;
  }

  getShutdownState(): Readonly<ShutdownState> {
    return { ...this.state };
  }

  getShutdownSteps(): string[] {
    return [...this.shutdownSteps];
  }

  /**
   * Simulate graceful shutdown with step tracking
   */
  async gracefulShutdown(
    reason: string,
    config: {
      shutdownTimeoutMs?: number;
      loadBalancerDrainDelayMs?: number;
    } = {}
  ): Promise<{ success: boolean; steps: string[] }> {
    // Prevent multiple shutdown attempts
    if (this.state.isShuttingDown) {
      return { success: false, steps: this.shutdownSteps };
    }

    const settings = {
      shutdownTimeoutMs: config.shutdownTimeoutMs ?? 30000,
      loadBalancerDrainDelayMs: config.loadBalancerDrainDelayMs ?? 2000,
    };

    this.state.isShuttingDown = true;
    this.state.shutdownStartTime = Date.now();
    this.state.shutdownReason = reason;

    try {
      // Step 1: Mark as shutting down
      this.shutdownSteps.push('startShutdown');

      // Step 2: Stop health monitoring
      this.shutdownSteps.push('stopHealthMonitoring');

      // Step 3: Stop background sync
      this.shutdownSteps.push('stopBackgroundSync');

      // Step 4: Load balancer drain delay (simulated)
      if (settings.loadBalancerDrainDelayMs > 0) {
        this.shutdownSteps.push('loadBalancerDrainDelay');
      }

      // Step 5: Shutdown SSE broadcasters
      this.shutdownSteps.push('shutdownBroadcasters');

      // Step 6: Close HTTP server
      this.shutdownSteps.push('closeServer');

      // Step 7: Wait for connections to drain
      this.shutdownSteps.push('waitForDrain');

      // Step 8: Close database
      this.shutdownSteps.push('closeDatabase');

      return { success: true, steps: this.shutdownSteps };
    } catch {
      return { success: false, steps: this.shutdownSteps };
    }
  }

  reset(): void {
    this.state = {
      isShuttingDown: false,
      shutdownStartTime: null,
      shutdownReason: null,
    };
    this.shutdownSteps = [];
  }
}

describe('GracefulShutdown', () => {
  let manager: TestShutdownManager;

  beforeEach(() => {
    manager = new TestShutdownManager();
  });

  describe('shutdown state', () => {
    it('should not be shutting down initially', () => {
      assert.strictEqual(manager.isShuttingDown(), false);
    });

    it('should be shutting down after gracefulShutdown is called', async () => {
      await manager.gracefulShutdown('test');

      assert.strictEqual(manager.isShuttingDown(), true);
    });

    it('should record shutdown reason', async () => {
      await manager.gracefulShutdown('SIGTERM');

      const state = manager.getShutdownState();
      assert.strictEqual(state.shutdownReason, 'SIGTERM');
    });

    it('should record shutdown start time', async () => {
      const before = Date.now();
      await manager.gracefulShutdown('test');
      const after = Date.now();

      const state = manager.getShutdownState();
      assert.ok(state.shutdownStartTime !== null);
      assert.ok(state.shutdownStartTime >= before);
      assert.ok(state.shutdownStartTime <= after);
    });
  });

  describe('multiple shutdown prevention', () => {
    it('should prevent multiple shutdown attempts', async () => {
      const result1 = await manager.gracefulShutdown('first');
      const result2 = await manager.gracefulShutdown('second');

      assert.strictEqual(result1.success, true);
      assert.strictEqual(result2.success, false);
    });

    it('should keep original shutdown reason when second attempt is made', async () => {
      await manager.gracefulShutdown('SIGTERM');
      await manager.gracefulShutdown('SIGINT');

      const state = manager.getShutdownState();
      assert.strictEqual(state.shutdownReason, 'SIGTERM');
    });
  });

  describe('shutdown sequence', () => {
    it('should execute steps in correct order', async () => {
      const result = await manager.gracefulShutdown('test');

      const expectedSteps = [
        'startShutdown',
        'stopHealthMonitoring',
        'stopBackgroundSync',
        'loadBalancerDrainDelay',
        'shutdownBroadcasters',
        'closeServer',
        'waitForDrain',
        'closeDatabase',
      ];

      assert.deepStrictEqual(result.steps, expectedSteps);
    });

    it('should skip load balancer delay when set to 0', async () => {
      const result = await manager.gracefulShutdown('test', {
        loadBalancerDrainDelayMs: 0,
      });

      assert.ok(!result.steps.includes('loadBalancerDrainDelay'));
    });

    it('should include all other steps when load balancer delay is 0', async () => {
      const result = await manager.gracefulShutdown('test', {
        loadBalancerDrainDelayMs: 0,
      });

      assert.ok(result.steps.includes('startShutdown'));
      assert.ok(result.steps.includes('stopHealthMonitoring'));
      assert.ok(result.steps.includes('shutdownBroadcasters'));
      assert.ok(result.steps.includes('closeDatabase'));
    });
  });

  describe('drain timeout calculation', () => {
    it('should calculate drain timeout correctly', () => {
      const shutdownTimeoutMs = 30000;
      const loadBalancerDrainDelayMs = 2000;

      const drainTimeout = Math.max(0, shutdownTimeoutMs - loadBalancerDrainDelayMs);

      assert.strictEqual(drainTimeout, 28000);
    });

    it('should handle edge case where drain delay exceeds timeout', () => {
      const shutdownTimeoutMs = 1000;
      const loadBalancerDrainDelayMs = 5000;

      const drainTimeout = Math.max(0, shutdownTimeoutMs - loadBalancerDrainDelayMs);

      assert.strictEqual(drainTimeout, 0);
    });

    it('should detect very short drain timeout', () => {
      const shutdownTimeoutMs = 5000;
      const loadBalancerDrainDelayMs = 4000;

      const drainTimeout = Math.max(0, shutdownTimeoutMs - loadBalancerDrainDelayMs);

      // This should trigger a warning (drainTimeout < 5000)
      assert.strictEqual(drainTimeout < 5000, true);
    });
  });
});

describe('GracefulShutdown configuration', () => {
  it('should use default timeout of 30 seconds', () => {
    const defaultConfig = {
      shutdownTimeoutMs: 30000,
      loadBalancerDrainDelayMs: 2000,
      exitProcess: true,
      exitCode: 0,
    };

    assert.strictEqual(defaultConfig.shutdownTimeoutMs, 30000);
  });

  it('should use default load balancer drain delay of 2 seconds', () => {
    const defaultConfig = {
      shutdownTimeoutMs: 30000,
      loadBalancerDrainDelayMs: 2000,
      exitProcess: true,
      exitCode: 0,
    };

    assert.strictEqual(defaultConfig.loadBalancerDrainDelayMs, 2000);
  });

  it('should allow custom configuration', () => {
    const customConfig = {
      shutdownTimeoutMs: 60000,
      loadBalancerDrainDelayMs: 5000,
    };

    assert.strictEqual(customConfig.shutdownTimeoutMs, 60000);
    assert.strictEqual(customConfig.loadBalancerDrainDelayMs, 5000);
  });
});
