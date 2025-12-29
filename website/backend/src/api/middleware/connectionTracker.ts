/**
 * Connection Tracker Middleware
 *
 * Tracks active HTTP connections for graceful shutdown.
 * Maintains a count of in-flight requests including long-lived SSE connections.
 *
 * SSE connections are tracked automatically via the middleware since they are
 * standard HTTP connections that remain open. The 'close' event on the response
 * fires when the SSE connection ends, decrementing the active count.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '@webedt/shared';

interface ConnectionStats {
  activeConnections: number;
  totalConnectionsServed: number;
}

class ConnectionTracker {
  private activeConnections = 0;
  private totalConnectionsServed = 0;
  private isShuttingDown = false;

  /**
   * Mark the tracker as shutting down
   * New connections will receive 503 Service Unavailable
   */
  startShutdown(): void {
    this.isShuttingDown = true;
    logger.info('Connection tracker entering shutdown mode', {
      component: 'ConnectionTracker',
      activeConnections: this.activeConnections,
    });
  }

  /**
   * Check if system is shutting down
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Track a new connection starting
   */
  connectionStarted(): void {
    this.activeConnections++;
  }

  /**
   * Track a connection completing
   */
  connectionEnded(): void {
    if (this.activeConnections <= 0) {
      logger.warn('Connection count underflow detected - connectionEnded called more times than connectionStarted', {
        component: 'ConnectionTracker',
        activeConnections: this.activeConnections,
      });
    }
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    this.totalConnectionsServed++;
  }

  /**
   * Get current connection statistics
   */
  getStats(): ConnectionStats {
    return {
      activeConnections: this.activeConnections,
      totalConnectionsServed: this.totalConnectionsServed,
    };
  }

  /**
   * Check if all connections have drained
   */
  isDrained(): boolean {
    return this.activeConnections === 0;
  }

  /**
   * Get total active connections
   */
  getActiveConnectionCount(): number {
    return this.activeConnections;
  }

  /**
   * Wait for all connections to drain with a timeout
   * @param timeoutMs Maximum time to wait in milliseconds
   * @param pollIntervalMs How often to check (default 100ms)
   * @returns true if drained, false if timeout reached
   */
  async waitForDrain(timeoutMs: number, pollIntervalMs = 100): Promise<boolean> {
    const startTime = Date.now();
    let lastLogTime = startTime;

    while (!this.isDrained()) {
      const now = Date.now();

      if (now - startTime >= timeoutMs) {
        logger.warn('Connection drain timeout reached', {
          component: 'ConnectionTracker',
          activeConnections: this.activeConnections,
          timeoutMs,
        });
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      // Log progress every second (reliably using lastLogTime tracking)
      const currentTime = Date.now();
      if (currentTime - lastLogTime >= 1000) {
        logger.info('Waiting for connections to drain', {
          component: 'ConnectionTracker',
          activeConnections: this.activeConnections,
          elapsedMs: currentTime - startTime,
        });
        lastLogTime = currentTime;
      }
    }

    logger.info('All connections drained', {
      component: 'ConnectionTracker',
    });
    return true;
  }
}

// Singleton instance
export const connectionTracker = new ConnectionTracker();

/**
 * Express middleware that tracks active connections
 * Rejects new requests during shutdown with 503
 */
export function connectionTrackerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // During shutdown, reject new requests with 503
  if (connectionTracker.isInShutdown()) {
    res.setHeader('Retry-After', '5');
    res.status(503).json({
      success: false,
      error: 'Service is shutting down',
      retryAfter: 5,
    });
    return;
  }

  // Track the connection
  connectionTracker.connectionStarted();

  // Clean up when response finishes (works for both regular requests and SSE)
  const cleanup = () => {
    connectionTracker.connectionEnded();
    res.removeListener('finish', cleanup);
    res.removeListener('close', cleanup);
    res.removeListener('error', cleanup);
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  next();
}
