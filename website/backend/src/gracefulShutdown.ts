/**
 * Graceful Shutdown Manager
 *
 * Coordinates orderly shutdown of the application:
 * 1. Stop accepting new connections (503 during drain)
 * 2. Stop health monitoring and background sync
 * 3. Notify SSE clients of shutdown
 * 4. Wait for in-flight requests to complete (with timeout)
 * 5. Close database connections
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
  trashCleanupService,
  closeDatabase,
} from '@webedt/shared';

import { connectionTracker } from './api/middleware/connectionTracker.js';

export interface GracefulShutdownConfig {
  /**
   * Maximum time to wait for connections to drain (in milliseconds)
   * Default: 30000 (30 seconds)
   */
  shutdownTimeoutMs?: number;

  /**
   * Time to wait after stopping health checks before starting drain
   * Allows load balancer to detect unhealthy status
   * Default: 2000 (2 seconds)
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
  shutdownTimeoutMs: 30000,
  loadBalancerDrainDelayMs: 2000,
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
    // Step 1: Mark as shutting down - reject new requests
    connectionTracker.startShutdown();

    // Step 2: Stop health monitoring (causes /ready to fail, load balancer stops routing)
    logger.info('Stopping health monitoring', { component: 'GracefulShutdown' });
    healthMonitor.stopPeriodicChecks();

    // Step 3: Stop background sync service
    logger.info('Stopping background sync', { component: 'GracefulShutdown' });
    stopBackgroundSync();

    // Step 4: Brief delay to allow load balancer to detect unhealthy status
    if (settings.loadBalancerDrainDelayMs > 0) {
      logger.info('Waiting for load balancer drain detection', {
        component: 'GracefulShutdown',
        delayMs: settings.loadBalancerDrainDelayMs,
      });
      await sleep(settings.loadBalancerDrainDelayMs);
    }

    // Step 5: Notify SSE clients of shutdown and close broadcaster intervals
    logger.info('Shutting down SSE broadcasters', { component: 'GracefulShutdown' });

    // shutdown() is defined in the abstract base classes ASessionEventBroadcaster and ASessionListBroadcaster
    sessionEventBroadcaster.shutdown();
    sessionListBroadcaster.shutdown();

    // Step 5b: Stop trash cleanup service
    logger.info('Stopping trash cleanup service', { component: 'GracefulShutdown' });
    await trashCleanupService.dispose();

    // Step 6: Stop accepting new connections on the server
    logger.info('Closing HTTP server to new connections', { component: 'GracefulShutdown' });
    await closeServer(server);

    // Step 7: Wait for existing connections to drain
    const drainTimeout = Math.max(0, settings.shutdownTimeoutMs - settings.loadBalancerDrainDelayMs);

    // Warn if drain timeout is very short due to configuration
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

    // Step 8: Close database pool
    logger.info('Closing database connections', { component: 'GracefulShutdown' });
    await closeDatabase();

    // Calculate shutdown duration
    const duration = Date.now() - (state.shutdownStartTime || Date.now());

    logger.info('Graceful shutdown complete', {
      component: 'GracefulShutdown',
      reason,
      durationMs: duration,
      drained,
    });

    // Step 9: Exit process if configured
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
