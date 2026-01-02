/**
 * Graceful Shutdown Manager
 *
 * Coordinates orderly shutdown of the application:
 * 1. Stop accepting new connections (503 during drain)
 * 2. Stop health monitoring and background sync
 * 3. Notify SSE clients of shutdown
 * 4. Cleanup caches and resources
 * 5. Wait for load balancer to detect unhealthy status
 * 6. Close HTTP server to new connections
 * 7. Wait for in-flight requests to complete (with timeout)
 * 8. Close database connections (must be last, after requests drain)
 *
 * Uses the centralized ShutdownManager for service coordination.
 * Note: Database is NOT managed by ShutdownManager to ensure it remains
 * available until all in-flight requests complete.
 *
 * Configurable shutdown timeout (default 30s)
 */

import type { Server } from 'http';

import {
  logger,
  healthMonitor,
  stopBackgroundSync,
  sessionEventBroadcaster,
  sessionListBroadcaster,
  closeDatabase,
  shutdownManager,
  ShutdownPriority,
  createShutdownHandler,
  trashCleanupService,
  requestDeduplicatorRegistry,
  SHUTDOWN_TIMEOUT_MS,
  LB_DRAIN_DELAY_MS,
} from '@webedt/shared';

import { connectionTracker } from './api/middleware/connectionTracker.js';
import { cleanupRateLimitStores } from './api/middleware/rateLimit.js';

export interface GracefulShutdownConfig {
  /**
   * Maximum time to wait for connections to drain (in milliseconds)
   * Default: SHUTDOWN_TIMEOUT_MS from config (typically 30 seconds)
   */
  shutdownTimeoutMs?: number;

  /**
   * Time to wait after stopping health checks before starting drain
   * Allows load balancer to detect unhealthy status
   * Default: LB_DRAIN_DELAY_MS from config (typically 2 seconds)
   */
  loadBalancerDrainDelayMs?: number;

  /**
   * Exit process after shutdown completes
   * Default: true
   */
  exitProcess?: boolean;

  /**
   * Exit code on successful shutdown
   * Default: 0
   */
  exitCode?: number;
}

const DEFAULT_CONFIG: Required<GracefulShutdownConfig> = {
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  loadBalancerDrainDelayMs: LB_DRAIN_DELAY_MS,
  exitProcess: true,
  exitCode: 0,
};

interface ShutdownState {
  isShuttingDown: boolean;
  shutdownStartTime: number | null;
  shutdownReason: string | null;
}

const state: ShutdownState = {
  isShuttingDown: false,
  shutdownStartTime: null,
  shutdownReason: null,
};

// Track orphan cleanup interval for shutdown
let orphanCleanupIntervalId: NodeJS.Timeout | null = null;

/**
 * Set the orphan cleanup interval ID for shutdown tracking
 */
export function setOrphanCleanupInterval(intervalId: NodeJS.Timeout): void {
  orphanCleanupIntervalId = intervalId;
}

/**
 * Check if a graceful shutdown is in progress
 */
export function isShuttingDown(): boolean {
  return state.isShuttingDown;
}

/**
 * Get shutdown state information
 */
export function getShutdownState(): Readonly<ShutdownState> {
  return { ...state };
}

/**
 * Register all background services with the ShutdownManager.
 * Services are registered with appropriate priorities to ensure
 * orderly shutdown.
 */
export function registerBackgroundServices(): void {
  // Priority 100: Stop accepting new work
  shutdownManager.register(
    createShutdownHandler(
      'connectionTracker',
      () => connectionTracker.startShutdown(),
      ShutdownPriority.STOP_ACCEPTING
    )
  );

  // Priority 200: Stop background tasks
  shutdownManager.register(
    createShutdownHandler(
      'healthMonitor',
      () => healthMonitor.stopPeriodicChecks(),
      ShutdownPriority.STOP_BACKGROUND
    )
  );

  shutdownManager.register(
    createShutdownHandler(
      'claudeSessionSync',
      () => stopBackgroundSync(),
      ShutdownPriority.STOP_BACKGROUND
    )
  );

  shutdownManager.register(
    createShutdownHandler(
      'trashCleanupService',
      async () => trashCleanupService.dispose(),
      ShutdownPriority.STOP_BACKGROUND
    )
  );

  shutdownManager.register(
    createShutdownHandler(
      'orphanCleanupInterval',
      () => {
        if (orphanCleanupIntervalId) {
          clearInterval(orphanCleanupIntervalId);
          orphanCleanupIntervalId = null;
        }
      },
      ShutdownPriority.STOP_BACKGROUND
    )
  );

  // Priority 300: Notify clients
  shutdownManager.register(
    createShutdownHandler(
      'sessionEventBroadcaster',
      () => sessionEventBroadcaster.shutdown(),
      ShutdownPriority.NOTIFY_CLIENTS
    )
  );

  shutdownManager.register(
    createShutdownHandler(
      'sessionListBroadcaster',
      () => sessionListBroadcaster.shutdown(),
      ShutdownPriority.NOTIFY_CLIENTS
    )
  );

  // Priority 600: Cleanup caches and resources
  shutdownManager.register(
    createShutdownHandler(
      'rateLimitStores',
      () => cleanupRateLimitStores(),
      ShutdownPriority.CLEANUP
    )
  );

  shutdownManager.register(
    createShutdownHandler(
      'requestDeduplicator',
      async () => requestDeduplicatorRegistry.dispose(),
      ShutdownPriority.CLEANUP
    )
  );

  // NOTE: Database is NOT registered here - it must close AFTER HTTP connections drain
  // to allow in-flight requests to complete. Database shutdown is handled explicitly
  // in gracefulShutdown() after waitForDrain().

  logger.info('Background services registered with ShutdownManager', {
    component: 'GracefulShutdown',
    stats: shutdownManager.getStats(),
  });
}

/**
 * Perform graceful shutdown
 *
 * @param server HTTP server to close
 * @param reason Reason for shutdown (for logging)
 * @param config Shutdown configuration
 */
export async function gracefulShutdown(
  server: Server,
  reason: string,
  config: GracefulShutdownConfig = {}
): Promise<void> {
  // Prevent multiple shutdown attempts
  if (state.isShuttingDown) {
    logger.warn('Shutdown already in progress', {
      component: 'GracefulShutdown',
      existingReason: state.shutdownReason,
      newReason: reason,
    });
    return;
  }

  const settings = { ...DEFAULT_CONFIG, ...config };

  state.isShuttingDown = true;
  state.shutdownStartTime = Date.now();
  state.shutdownReason = reason;

  logger.info('Starting graceful shutdown', {
    component: 'GracefulShutdown',
    reason,
    timeoutMs: settings.shutdownTimeoutMs,
  });

  const stats = connectionTracker.getStats();
  logger.info('Current connection state', {
    component: 'GracefulShutdown',
    activeConnections: stats.activeConnections,
  });

  try {
    // Phase 1: Execute all registered shutdown handlers
    const result = await shutdownManager.shutdown(reason, {
      totalTimeoutMs: settings.shutdownTimeoutMs,
      handlerTimeoutMs: 5000,
      continueOnError: true,
    });

    logger.info('ShutdownManager completed', {
      component: 'GracefulShutdown',
      success: result.success,
      successCount: result.successCount,
      failureCount: result.failureCount,
      timeoutCount: result.timeoutCount,
    });

    // Phase 2: Wait for load balancer to detect unhealthy status
    if (settings.loadBalancerDrainDelayMs > 0) {
      logger.info('Waiting for load balancer drain detection', {
        component: 'GracefulShutdown',
        delayMs: settings.loadBalancerDrainDelayMs,
      });
      await sleep(settings.loadBalancerDrainDelayMs);
    }

    // Phase 3: Close HTTP server
    logger.info('Closing HTTP server to new connections', { component: 'GracefulShutdown' });
    await closeServer(server);

    // Phase 4: Wait for existing connections to drain
    const drainTimeout = Math.max(0, settings.shutdownTimeoutMs - settings.loadBalancerDrainDelayMs - result.durationMs);

    if (drainTimeout < 5000) {
      logger.warn('Drain timeout is very short - connections may not have time to complete', {
        component: 'GracefulShutdown',
        drainTimeoutMs: drainTimeout,
        shutdownTimeoutMs: settings.shutdownTimeoutMs,
        loadBalancerDrainDelayMs: settings.loadBalancerDrainDelayMs,
      });
    }

    logger.info('Waiting for connections to drain', {
      component: 'GracefulShutdown',
      timeoutMs: drainTimeout,
    });

    const drained = await connectionTracker.waitForDrain(drainTimeout);

    if (!drained) {
      const finalStats = connectionTracker.getStats();
      logger.warn('Shutdown timeout reached with active connections', {
        component: 'GracefulShutdown',
        activeConnections: finalStats.activeConnections,
      });
    }

    // Phase 5: Close database connections (must be after connection draining)
    logger.info('Closing database connections', { component: 'GracefulShutdown' });
    await closeDatabase();

    // Calculate shutdown duration
    const duration = Date.now() - (state.shutdownStartTime || Date.now());

    logger.info('Graceful shutdown complete', {
      component: 'GracefulShutdown',
      reason,
      durationMs: duration,
      drained,
      handlersSuccess: result.successCount,
      handlersFailure: result.failureCount,
    });

    // Exit process if configured
    if (settings.exitProcess) {
      process.exit(settings.exitCode);
    }
  } catch (error) {
    logger.error('Error during graceful shutdown', error as Error, {
      component: 'GracefulShutdown',
      reason,
    });

    if (settings.exitProcess) {
      process.exit(1);
    }
  }
}

/**
 * Register signal handlers for graceful shutdown
 *
 * @param server HTTP server to close on shutdown
 * @param config Shutdown configuration
 */
export function registerShutdownHandlers(
  server: Server,
  config: GracefulShutdownConfig = {}
): void {
  // Register all background services with the ShutdownManager
  registerBackgroundServices();

  // Handle SIGTERM (Docker, Kubernetes, systemd stop)
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received', { component: 'GracefulShutdown' });
    gracefulShutdown(server, 'SIGTERM', config);
  });

  // Handle SIGINT (Ctrl+C)
  process.on('SIGINT', () => {
    logger.info('SIGINT received', { component: 'GracefulShutdown' });
    gracefulShutdown(server, 'SIGINT', config);
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception, initiating shutdown', error, {
      component: 'GracefulShutdown',
    });
    gracefulShutdown(server, 'uncaughtException', { ...config, exitCode: 1 });
  });

  // Handle unhandled promise rejections
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection, initiating shutdown', reason as Error, {
      component: 'GracefulShutdown',
    });
    gracefulShutdown(server, 'unhandledRejection', { ...config, exitCode: 1 });
  });

  logger.info('Shutdown handlers registered', { component: 'GracefulShutdown' });
}

/**
 * Close HTTP server and stop accepting connections
 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) {
        // ENOTCONN is not an error during shutdown
        if ((err as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') {
          resolve();
          return;
        }
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
