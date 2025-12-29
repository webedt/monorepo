/**
 * Connection Tracker Middleware
 *
 * Tracks active HTTP connections for graceful shutdown.
 * Maintains a count of in-flight requests and SSE connections.
 */

import type { Request, Response, NextFunction } from 'express';
import { logger } from '@webedt/shared';

interface ConnectionStats {
  activeRequests: number;
  activeSSEConnections: number;
  totalRequestsServed: number;
  totalSSEConnectionsServed: number;
}

class ConnectionTracker {
  private activeRequests = 0;
  private activeSSEConnections = 0;
  private totalRequestsServed = 0;
  private totalSSEConnectionsServed = 0;
  private isShuttingDown = false;

  /**
   * Mark the tracker as shutting down
   * New connections will receive 503 Service Unavailable
   */
  startShutdown(): void {
    this.isShuttingDown = true;
    logger.info('Connection tracker entering shutdown mode', {
      component: 'ConnectionTracker',
      activeRequests: this.activeRequests,
      activeSSEConnections: this.activeSSEConnections,
    });
  }

  /**
   * Check if system is shutting down
   */
  isInShutdown(): boolean {
    return this.isShuttingDown;
  }

  /**
   * Track a new request starting
   */
  requestStarted(): void {
    this.activeRequests++;
  }

  /**
   * Track a request completing
   */
  requestEnded(): void {
    this.activeRequests = Math.max(0, this.activeRequests - 1);
    this.totalRequestsServed++;
  }

  /**
   * Track a new SSE connection
   */
  sseConnectionStarted(): void {
    this.activeSSEConnections++;
  }

  /**
   * Track an SSE connection closing
   */
  sseConnectionEnded(): void {
    this.activeSSEConnections = Math.max(0, this.activeSSEConnections - 1);
    this.totalSSEConnectionsServed++;
  }

  /**
   * Get current connection statistics
   */
  getStats(): ConnectionStats {
    return {
      activeRequests: this.activeRequests,
      activeSSEConnections: this.activeSSEConnections,
      totalRequestsServed: this.totalRequestsServed,
      totalSSEConnectionsServed: this.totalSSEConnectionsServed,
    };
  }

  /**
   * Check if all connections have drained
   */
  isDrained(): boolean {
    return this.activeRequests === 0 && this.activeSSEConnections === 0;
  }

  /**
   * Get total active connections
   */
  getActiveConnectionCount(): number {
    return this.activeRequests + this.activeSSEConnections;
  }

  /**
   * Wait for all connections to drain with a timeout
   * @param timeoutMs Maximum time to wait in milliseconds
   * @param pollIntervalMs How often to check (default 100ms)
   * @returns true if drained, false if timeout reached
   */
  async waitForDrain(timeoutMs: number, pollIntervalMs = 100): Promise<boolean> {
    const startTime = Date.now();

    while (!this.isDrained()) {
      if (Date.now() - startTime >= timeoutMs) {
        logger.warn('Connection drain timeout reached', {
          component: 'ConnectionTracker',
          activeRequests: this.activeRequests,
          activeSSEConnections: this.activeSSEConnections,
          timeoutMs,
        });
        return false;
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

      // Log progress every second
      const elapsed = Date.now() - startTime;
      if (elapsed > 0 && elapsed % 1000 < pollIntervalMs) {
        logger.info('Waiting for connections to drain', {
          component: 'ConnectionTracker',
          activeRequests: this.activeRequests,
          activeSSEConnections: this.activeSSEConnections,
          elapsedMs: elapsed,
        });
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
    res.status(503).json({
      success: false,
      error: 'Service is shutting down',
      retryAfter: 5,
    });
    return;
  }

  // Track the request
  connectionTracker.requestStarted();

  // Clean up when response finishes
  const cleanup = () => {
    connectionTracker.requestEnded();
    res.removeListener('finish', cleanup);
    res.removeListener('close', cleanup);
    res.removeListener('error', cleanup);
  };

  res.on('finish', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);

  next();
}

/**
 * Helper to track SSE connections
 * Call sseStarted when setting up SSE, returns cleanup function
 */
export function trackSSEConnection(): () => void {
  connectionTracker.sseConnectionStarted();
  let cleaned = false;

  return () => {
    if (!cleaned) {
      cleaned = true;
      connectionTracker.sseConnectionEnded();
    }
  };
}
