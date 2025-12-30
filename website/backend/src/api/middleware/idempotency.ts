/**
 * Idempotency Middleware
 *
 * Prevents duplicate processing of critical write operations by caching
 * responses keyed by X-Idempotency-Key header. Essential for payment
 * reliability (prevents double-charging) and bulk operations.
 *
 * Features:
 * - Accepts X-Idempotency-Key header
 * - Stores key + response in database with 24h TTL
 * - Returns cached response on duplicate requests
 * - Handles concurrent duplicate requests with locking
 * - Request body hash validation for consistency
 *
 * Usage:
 * - Apply to critical write endpoints: payments, bulk operations, session creation
 * - Clients should generate a UUID for each unique operation
 * - Retrying the same operation with the same key returns cached response
 */

import { Request, Response, NextFunction, RequestHandler } from 'express';
import { randomUUID, createHash } from 'crypto';
import { db, idempotencyKeys, eq, and, lt } from '@webedt/shared';
import { logger } from '@webedt/shared';

import type { AuthRequest } from './auth.js';

// Header name for idempotency key
export const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';

// Default TTL: 24 hours
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Lock timeout: 30 seconds (to handle crashed requests)
const LOCK_TIMEOUT_MS = 30 * 1000;

// Status types for idempotency records
type IdempotencyStatus = 'processing' | 'completed' | 'failed';

/**
 * Options for the idempotency middleware
 */
export interface IdempotencyOptions {
  /** Time-to-live for cached responses in milliseconds (default: 24h) */
  ttlMs?: number;
  /** Whether the idempotency key is required (default: false - recommended for backward compatibility) */
  required?: boolean;
  /** Custom endpoint identifier (default: req.path) */
  endpoint?: string;
}

/**
 * Generate a SHA-256 hash of the request body for consistency validation
 */
function hashRequestBody(body: unknown): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body || {});
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Clean up expired idempotency keys (called periodically)
 */
async function cleanupExpiredKeys(): Promise<number> {
  try {
    const result = await db
      .delete(idempotencyKeys)
      .where(lt(idempotencyKeys.expiresAt, new Date()));
    return result.rowCount || 0;
  } catch (error) {
    logger.warn('Failed to clean up expired idempotency keys', {
      component: 'Idempotency',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return 0;
  }
}

// Run cleanup periodically (every hour)
let cleanupInterval: NodeJS.Timeout | null = null;

/**
 * Start the periodic cleanup of expired keys
 */
export function startIdempotencyCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(async () => {
    const cleaned = await cleanupExpiredKeys();
    if (cleaned > 0) {
      logger.debug(`Cleaned up ${cleaned} expired idempotency keys`, {
        component: 'Idempotency',
      });
    }
  }, 60 * 60 * 1000); // Every hour

  // Run once on startup
  cleanupExpiredKeys();
}

/**
 * Stop the periodic cleanup
 */
export function stopIdempotencyCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Create an idempotency middleware for a specific endpoint
 *
 * @param options - Configuration options
 * @returns Express middleware
 *
 * @example
 * ```typescript
 * // Apply to payment checkout
 * router.post('/checkout', requireAuth, idempotencyMiddleware(), async (req, res) => {
 *   // Process payment...
 * });
 *
 * // With custom options
 * router.post('/bulk-delete', requireAuth, idempotencyMiddleware({
 *   required: true, // Require idempotency key
 *   ttlMs: 48 * 60 * 60 * 1000, // 48 hour TTL
 * }), async (req, res) => {
 *   // Process bulk delete...
 * });
 * ```
 */
export function idempotencyMiddleware(options: IdempotencyOptions = {}): RequestHandler {
  const {
    ttlMs = DEFAULT_TTL_MS,
    required = false,
    endpoint: customEndpoint,
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthRequest;
    const user = authReq.user;

    // User must be authenticated for idempotency to work
    if (!user) {
      logger.warn('Idempotency middleware requires authentication', {
        component: 'Idempotency',
        path: req.path,
      });
      next();
      return;
    }

    // Get idempotency key from header
    const idempotencyKey = req.headers[IDEMPOTENCY_KEY_HEADER] as string | undefined;

    // If no key provided
    if (!idempotencyKey) {
      if (required) {
        res.status(400).json({
          success: false,
          error: `Missing required header: ${IDEMPOTENCY_KEY_HEADER}`,
          hint: 'Generate a unique UUID for each operation to enable automatic retry safety',
        });
        return;
      }
      // Key not required, proceed without idempotency protection
      next();
      return;
    }

    // Validate key format (should be a UUID or similar unique identifier)
    if (idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      res.status(400).json({
        success: false,
        error: 'Invalid idempotency key format',
        hint: 'Use a UUID v4 or similar unique identifier (16-128 characters)',
      });
      return;
    }

    const endpoint = customEndpoint || req.path;
    const method = req.method;
    const requestHash = hashRequestBody(req.body);

    try {
      // Check if this key already exists
      const [existing] = await db
        .select()
        .from(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.key, idempotencyKey),
            eq(idempotencyKeys.userId, user.id),
            eq(idempotencyKeys.endpoint, endpoint)
          )
        )
        .limit(1);

      if (existing) {
        // Key exists - check the status
        if (existing.status === 'completed' && existing.responseBody && existing.statusCode) {
          // Validate request body hash to ensure consistency
          if (existing.requestHash !== requestHash) {
            logger.warn('Idempotency key reused with different request body', {
              component: 'Idempotency',
              userId: user.id,
              endpoint,
              idempotencyKey,
            });
            res.status(409).json({
              success: false,
              error: 'Idempotency key was already used with a different request',
              hint: 'Use a new unique key for different requests',
            });
            return;
          }

          // Return cached response
          logger.info('Returning cached response for idempotent request', {
            component: 'Idempotency',
            userId: user.id,
            endpoint,
            idempotencyKey,
            cachedStatus: existing.statusCode,
          });

          res.status(existing.statusCode).json(existing.responseBody);
          return;
        }

        if (existing.status === 'processing') {
          // Check if the lock has expired (crashed request)
          const lockExpired = existing.lockedAt &&
            new Date(existing.lockedAt).getTime() + LOCK_TIMEOUT_MS < Date.now();

          if (!lockExpired) {
            // Another request is still processing
            logger.info('Concurrent duplicate request detected', {
              component: 'Idempotency',
              userId: user.id,
              endpoint,
              idempotencyKey,
            });
            res.status(409).json({
              success: false,
              error: 'Request is currently being processed',
              hint: 'Please wait for the original request to complete',
            });
            return;
          }

          // Lock expired - take over processing
          logger.warn('Taking over stale idempotency lock', {
            component: 'Idempotency',
            userId: user.id,
            endpoint,
            idempotencyKey,
          });
        }

        // Update lock timestamp
        await db
          .update(idempotencyKeys)
          .set({
            lockedAt: new Date(),
            status: 'processing' as IdempotencyStatus,
          })
          .where(eq(idempotencyKeys.id, existing.id));
      } else {
        // Create new idempotency record
        const expiresAt = new Date(Date.now() + ttlMs);

        await db.insert(idempotencyKeys).values({
          id: randomUUID(),
          key: idempotencyKey,
          userId: user.id,
          endpoint,
          method,
          requestHash,
          status: 'processing' as IdempotencyStatus,
          lockedAt: new Date(),
          expiresAt,
        });
      }

      // Store the original res.json to intercept the response
      const originalJson = res.json.bind(res);

      // Override res.json to capture the response
      res.json = function (body: unknown): Response {
        // Store the response in the idempotency record
        const updateIdempotencyRecord = async () => {
          try {
            await db
              .update(idempotencyKeys)
              .set({
                status: 'completed' as IdempotencyStatus,
                statusCode: res.statusCode,
                responseBody: body as Record<string, unknown>,
                completedAt: new Date(),
                lockedAt: null,
              })
              .where(
                and(
                  eq(idempotencyKeys.key, idempotencyKey),
                  eq(idempotencyKeys.userId, user.id),
                  eq(idempotencyKeys.endpoint, endpoint)
                )
              );
          } catch (error) {
            logger.error('Failed to update idempotency record', error, {
              component: 'Idempotency',
              userId: user.id,
              endpoint,
              idempotencyKey,
            });
          }
        };

        // Don't await - update asynchronously to not delay response
        updateIdempotencyRecord();

        // Call the original json method
        return originalJson(body);
      };

      // If request fails without calling res.json, clean up
      res.on('close', async () => {
        if (!res.writableEnded) {
          // Request was aborted - mark as failed
          try {
            await db
              .update(idempotencyKeys)
              .set({
                status: 'failed' as IdempotencyStatus,
                lockedAt: null,
              })
              .where(
                and(
                  eq(idempotencyKeys.key, idempotencyKey),
                  eq(idempotencyKeys.userId, user.id),
                  eq(idempotencyKeys.endpoint, endpoint)
                )
              );
          } catch {
            // Ignore cleanup errors
          }
        }
      });

      next();
    } catch (error) {
      logger.error('Idempotency middleware error', error, {
        component: 'Idempotency',
        userId: user.id,
        endpoint,
        idempotencyKey,
      });

      // On error, allow the request to proceed without idempotency protection
      // This ensures we don't block critical operations due to middleware issues
      next();
    }
  };
}

/**
 * Generate an idempotency key (utility for clients)
 * Note: This is primarily for server-side use; clients should use their own UUID generation
 */
export function generateIdempotencyKey(): string {
  return randomUUID();
}
