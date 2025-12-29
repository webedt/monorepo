/**
 * ShutdownRegistry - Centralized shutdown handler registration
 *
 * This utility provides:
 * - Registration of cleanup handlers for graceful shutdown
 * - Automatic handling of SIGTERM, SIGINT, and uncaught exceptions
 * - Ordered shutdown based on priority
 * - Prevention of duplicate signal handling
 *
 * Note: The backend uses a more specialized gracefulShutdown.ts that handles
 * HTTP server-specific concerns (connection draining, health check coordination).
 * This registry is a general-purpose utility for other services or CLI tools
 * that need simpler shutdown coordination.
 *
 * Usage:
 * ```typescript
 * // Register a shutdown handler
 * shutdownRegistry.register('database', async () => {
 *   await db.close();
 * }, { priority: 10, timeoutMs: 15000 }); // Higher priority runs first
 *
 * // Initialize signal handlers (call once at startup)
 * shutdownRegistry.initialize();
 * ```
 */

import { logger } from '../logging/logger.js';

type ShutdownHandler = () => void | Promise<void>;

/** Default timeout for shutdown handlers in milliseconds */
const DEFAULT_HANDLER_TIMEOUT_MS = 10000;

interface RegisteredHandler {
  name: string;
  handler: ShutdownHandler;
  priority: number;
  timeoutMs: number;
}

interface RegisterOptions {
  /** Higher priority handlers run first (default: 0) */
  priority?: number;
  /** Timeout for this handler in milliseconds (default: 10000) */
  timeoutMs?: number;
}

/**
 * Abstract interface for ShutdownRegistry
 */
export interface IShutdownRegistry {
  /** Register a shutdown handler */
  register(name: string, handler: ShutdownHandler, options?: RegisterOptions): void;

  /** Unregister a shutdown handler */
  unregister(name: string): void;

  /** Initialize signal handlers - call once at application startup */
  initialize(): void;

  /** Manually trigger shutdown (for testing or programmatic shutdown) */
  shutdown(exitCode?: number): Promise<void>;

  /** Get registered handler names */
  getHandlerNames(): string[];

  /** Reset the registry state (for testing) */
  reset(): void;
}

/**
 * Centralized shutdown handler registry
 */
class ShutdownRegistry implements IShutdownRegistry {
  private handlers: RegisteredHandler[] = [];
  private initialized = false;
  private shuttingDown = false;

  /**
   * Register a shutdown handler
   */
  register(name: string, handler: ShutdownHandler, options: RegisterOptions = {}): void {
    const { priority = 0, timeoutMs = DEFAULT_HANDLER_TIMEOUT_MS } = options;

    // Remove existing handler with same name if present
    this.unregister(name);

    this.handlers.push({ name, handler, priority, timeoutMs });

    // Sort by priority (higher first)
    this.handlers.sort((a, b) => b.priority - a.priority);

    logger.debug(`Registered shutdown handler: ${name} (priority: ${priority}, timeout: ${timeoutMs}ms)`, {
      component: 'ShutdownRegistry',
    });
  }

  /**
   * Unregister a shutdown handler
   */
  unregister(name: string): void {
    const index = this.handlers.findIndex((h) => h.name === name);
    if (index !== -1) {
      this.handlers.splice(index, 1);
      logger.debug(`Unregistered shutdown handler: ${name}`, {
        component: 'ShutdownRegistry',
      });
    }
  }

  /**
   * Initialize signal handlers
   * Should be called once at application startup
   */
  initialize(): void {
    if (this.initialized) {
      logger.warn('ShutdownRegistry already initialized', {
        component: 'ShutdownRegistry',
      });
      return;
    }

    // Handle SIGTERM (graceful termination)
    process.on('SIGTERM', () => {
      logger.info('Received SIGTERM signal', { component: 'ShutdownRegistry' });
      this.shutdown(0);
    });

    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      logger.info('Received SIGINT signal', { component: 'ShutdownRegistry' });
      this.shutdown(0);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', error, { component: 'ShutdownRegistry' });
      this.shutdown(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      logger.error('Unhandled promise rejection', error, { component: 'ShutdownRegistry' });
      this.shutdown(1);
    });

    this.initialized = true;
    logger.info('ShutdownRegistry initialized', { component: 'ShutdownRegistry' });
  }

  /**
   * Execute all shutdown handlers and exit
   */
  async shutdown(exitCode = 0): Promise<void> {
    if (this.shuttingDown) {
      logger.warn('Shutdown already in progress', { component: 'ShutdownRegistry' });
      return;
    }

    this.shuttingDown = true;
    logger.info(`Starting graceful shutdown with ${this.handlers.length} handlers`, {
      component: 'ShutdownRegistry',
    });

    const startTime = Date.now();

    for (const { name, handler, timeoutMs } of this.handlers) {
      try {
        logger.debug(`Running shutdown handler: ${name} (timeout: ${timeoutMs}ms)`, { component: 'ShutdownRegistry' });
        const handlerStart = Date.now();

        await Promise.race([
          Promise.resolve(handler()),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error(`Handler timeout after ${timeoutMs}ms`)), timeoutMs)
          ),
        ]);

        logger.debug(`Shutdown handler ${name} completed in ${Date.now() - handlerStart}ms`, {
          component: 'ShutdownRegistry',
        });
      } catch (error) {
        logger.error(
          `Error in shutdown handler ${name}`,
          error instanceof Error ? error : new Error(String(error)),
          { component: 'ShutdownRegistry' }
        );
      }
    }

    const totalTime = Date.now() - startTime;
    logger.info(`Graceful shutdown complete in ${totalTime}ms`, {
      component: 'ShutdownRegistry',
    });

    // Only exit in Node.js environment
    if (typeof process !== 'undefined' && process.exit) {
      process.exit(exitCode);
    }
  }

  /**
   * Get registered handler names
   */
  getHandlerNames(): string[] {
    return this.handlers.map((h) => h.name);
  }

  /**
   * Check if registry has been initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Reset the registry (for testing)
   */
  reset(): void {
    this.handlers = [];
    this.initialized = false;
    this.shuttingDown = false;
  }
}

/**
 * Global shutdown registry instance
 */
export const shutdownRegistry: IShutdownRegistry = new ShutdownRegistry();
