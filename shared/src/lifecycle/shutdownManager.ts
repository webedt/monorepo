import { AShutdownManager, ShutdownPriority } from './AShutdownManager.js';
import { logger } from '../utils/logging/logger.js';

import type { IShutdownHandler } from './AShutdownManager.js';
import type { ShutdownResult } from './AShutdownManager.js';
import type { HandlerResult } from './AShutdownManager.js';
import type { ShutdownManagerConfig } from './AShutdownManager.js';
import type { ShutdownManagerStats } from './AShutdownManager.js';

export type {
  IShutdownHandler,
  ShutdownResult,
  HandlerResult,
  ShutdownManagerConfig,
  ShutdownManagerStats,
} from './AShutdownManager.js';

export { ShutdownPriority } from './AShutdownManager.js';

const DEFAULT_CONFIG: Required<ShutdownManagerConfig> = {
  totalTimeoutMs: 30000,
  handlerTimeoutMs: 5000,
  continueOnError: true,
};

class ShutdownManager extends AShutdownManager {
  private handlers: Map<string, IShutdownHandler> = new Map();
  private shuttingDown = false;
  private shutdownStartTime: Date | null = null;

  register(handler: IShutdownHandler): void {
    if (this.shuttingDown) {
      logger.warn('Cannot register handler during shutdown', {
        component: 'ShutdownManager',
        handlerName: handler.name,
      });
      return;
    }

    if (this.handlers.has(handler.name)) {
      logger.warn('Handler already registered, replacing', {
        component: 'ShutdownManager',
        handlerName: handler.name,
      });
    }

    this.handlers.set(handler.name, handler);

    logger.debug('Shutdown handler registered', {
      component: 'ShutdownManager',
      handlerName: handler.name,
      priority: handler.priority ?? ShutdownPriority.CLEANUP,
      totalHandlers: this.handlers.size,
    });
  }

  unregister(name: string): boolean {
    const removed = this.handlers.delete(name);

    if (removed) {
      logger.debug('Shutdown handler unregistered', {
        component: 'ShutdownManager',
        handlerName: name,
        totalHandlers: this.handlers.size,
      });
    }

    return removed;
  }

  async shutdown(reason: string, config?: ShutdownManagerConfig): Promise<ShutdownResult> {
    if (this.shuttingDown) {
      logger.warn('Shutdown already in progress', {
        component: 'ShutdownManager',
        reason,
      });
      return {
        success: false,
        durationMs: 0,
        successCount: 0,
        failureCount: 0,
        timeoutCount: 0,
        handlers: [],
      };
    }

    const settings = { ...DEFAULT_CONFIG, ...config };
    this.shuttingDown = true;
    this.shutdownStartTime = new Date();
    const startTime = Date.now();

    logger.info('Starting graceful shutdown', {
      component: 'ShutdownManager',
      reason,
      handlerCount: this.handlers.size,
      totalTimeoutMs: settings.totalTimeoutMs,
    });

    // Sort handlers by priority (lower first)
    const sortedHandlers = Array.from(this.handlers.values()).sort(
      (a, b) => (a.priority ?? ShutdownPriority.CLEANUP) - (b.priority ?? ShutdownPriority.CLEANUP)
    );

    // Group handlers by priority for logging
    const priorityGroups = new Map<number, string[]>();
    for (const handler of sortedHandlers) {
      const priority = handler.priority ?? ShutdownPriority.CLEANUP;
      const group = priorityGroups.get(priority) || [];
      group.push(handler.name);
      priorityGroups.set(priority, group);
    }

    logger.info('Shutdown sequence planned', {
      component: 'ShutdownManager',
      sequence: Array.from(priorityGroups.entries())
        .sort(([a], [b]) => a - b)
        .map(([priority, names]) => ({ priority, handlers: names })),
    });

    const results: HandlerResult[] = [];
    let successCount = 0;
    let failureCount = 0;
    let timeoutCount = 0;

    // Execute handlers in priority order
    for (const handler of sortedHandlers) {
      const handlerStartTime = Date.now();
      const priority = handler.priority ?? ShutdownPriority.CLEANUP;

      // Check if we've exceeded total timeout
      const elapsed = Date.now() - startTime;
      if (elapsed >= settings.totalTimeoutMs) {
        logger.error('Total shutdown timeout exceeded, aborting remaining handlers', {
          component: 'ShutdownManager',
          elapsedMs: elapsed,
          remainingHandlers: sortedHandlers.length - results.length,
        });
        break;
      }

      logger.debug('Shutting down handler', {
        component: 'ShutdownManager',
        handlerName: handler.name,
        priority,
      });

      try {
        // Race against handler timeout
        const remainingTime = settings.totalTimeoutMs - elapsed;
        const timeout = Math.min(settings.handlerTimeoutMs, remainingTime);

        // Store timeout ID so we can clear it when handler succeeds
        let timeoutId: NodeJS.Timeout | undefined;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Handler timeout')), timeout);
        });

        try {
          await Promise.race([handler.shutdown(), timeoutPromise]);
        } finally {
          // Always clear timeout to prevent memory leak
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }
        }

        const durationMs = Date.now() - handlerStartTime;
        successCount++;
        results.push({
          name: handler.name,
          priority,
          success: true,
          durationMs,
        });

        logger.debug('Handler shutdown complete', {
          component: 'ShutdownManager',
          handlerName: handler.name,
          durationMs,
        });
      } catch (error) {
        const durationMs = Date.now() - handlerStartTime;
        const isTimeout = error instanceof Error && error.message === 'Handler timeout';

        if (isTimeout) {
          timeoutCount++;
        } else {
          failureCount++;
        }

        results.push({
          name: handler.name,
          priority,
          success: false,
          durationMs,
          error: error instanceof Error ? error.message : String(error),
          timedOut: isTimeout,
        });

        logger.error('Handler shutdown failed', error as Error, {
          component: 'ShutdownManager',
          handlerName: handler.name,
          timedOut: isTimeout,
          durationMs,
        });

        if (!settings.continueOnError) {
          logger.error('Aborting shutdown due to handler failure', {
            component: 'ShutdownManager',
            handlerName: handler.name,
          });
          break;
        }
      }
    }

    const totalDuration = Date.now() - startTime;
    const success = failureCount === 0 && timeoutCount === 0;

    logger.info('Graceful shutdown complete', {
      component: 'ShutdownManager',
      reason,
      success,
      durationMs: totalDuration,
      successCount,
      failureCount,
      timeoutCount,
    });

    return {
      success,
      durationMs: totalDuration,
      successCount,
      failureCount,
      timeoutCount,
      handlers: results,
    };
  }

  isShuttingDown(): boolean {
    return this.shuttingDown;
  }

  getStats(): ShutdownManagerStats {
    const handlersByPriority: Record<number, string[]> = {};

    for (const handler of this.handlers.values()) {
      const priority = handler.priority ?? ShutdownPriority.CLEANUP;
      if (!handlersByPriority[priority]) {
        handlersByPriority[priority] = [];
      }
      handlersByPriority[priority].push(handler.name);
    }

    return {
      handlerCount: this.handlers.size,
      handlersByPriority,
      isShuttingDown: this.shuttingDown,
      shutdownStartTime: this.shutdownStartTime,
    };
  }

  reset(): void {
    this.handlers.clear();
    this.shuttingDown = false;
    this.shutdownStartTime = null;

    logger.debug('ShutdownManager reset', {
      component: 'ShutdownManager',
    });
  }
}

export const shutdownManager: AShutdownManager = new ShutdownManager();

/**
 * Create a shutdown handler from a simple function.
 * Useful for wrapping existing cleanup functions.
 */
export function createShutdownHandler(
  name: string,
  shutdownFn: () => void | Promise<void>,
  priority: number = ShutdownPriority.CLEANUP
): IShutdownHandler {
  return {
    name,
    priority,
    async shutdown(): Promise<void> {
      await shutdownFn();
    },
  };
}
