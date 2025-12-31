/**
 * Audit Middleware
 *
 * Automatically logs admin operations to the audit trail.
 * Use after requireAdmin middleware to ensure user is authenticated.
 */

import { Request, Response, NextFunction } from 'express';

import {
  createAuditLog,
  getClientIp,
} from '@webedt/shared';

import type { AuditAction, AuditEntityType } from '@webedt/shared';

import type { AuthRequest } from './auth.js';

/**
 * Configuration for audit middleware
 */
export interface AuditMiddlewareConfig {
  action: AuditAction;
  entityType: AuditEntityType;
  getEntityId?: (req: Request) => string | undefined;
  getPreviousState?: (req: Request) => Promise<Record<string, unknown> | undefined>;
  getNewState?: (req: Request, res: Response) => Record<string, unknown> | undefined;
  getMetadata?: (req: Request) => Record<string, unknown> | undefined;
}

/**
 * Store for tracking request state during audit logging
 */
interface AuditContext {
  startTime: number;
  previousState?: Record<string, unknown>;
}

// WeakMap to store audit context per request
const auditContextMap = new WeakMap<Request, AuditContext>();

/**
 * Creates an audit logging middleware.
 *
 * @param config - Configuration for what to log
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * router.post('/users',
 *   requireAdmin,
 *   auditMiddleware({
 *     action: 'USER_CREATE',
 *     entityType: 'user',
 *     getEntityId: (req) => req.body.email, // or could be from response
 *   }),
 *   async (req, res) => {
 *     // Create user logic
 *   }
 * );
 * ```
 */
export function auditMiddleware(config: AuditMiddlewareConfig) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;

    // Initialize audit context
    const context: AuditContext = {
      startTime: Date.now(),
    };

    // Capture previous state if needed
    if (config.getPreviousState) {
      try {
        context.previousState = await config.getPreviousState(req);
      } catch (error) {
        console.error('[AuditMiddleware] Error getting previous state:', error);
      }
    }

    auditContextMap.set(req, context);

    // Store original res.json to intercept response
    const originalJson = res.json.bind(res);
    let responseBody: Record<string, unknown> | undefined;

    res.json = function (body: Record<string, unknown>) {
      responseBody = body;
      return originalJson(body);
    };

    // Hook into response finish to log the audit entry
    res.on('finish', async () => {
      // Only log successful mutations (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const entityId = config.getEntityId?.(req) ?? req.params?.id;
          const newState = config.getNewState?.(req, res) ?? responseBody?.data as Record<string, unknown> | undefined;
          const metadata = config.getMetadata?.(req);

          await createAuditLog({
            adminId: authReq.user.id,
            action: config.action,
            entityType: config.entityType,
            entityId,
            previousState: context.previousState,
            newState,
            metadata: {
              ...metadata,
              requestId: (req as unknown as { id?: string }).id,
              userAgent: req.get('user-agent'),
              method: req.method,
              path: req.path,
              statusCode: res.statusCode,
              durationMs: Date.now() - context.startTime,
            },
            ipAddress: getClientIp(req),
          });
        } catch (error) {
          // Log but don't fail the request if audit logging fails
          console.error('[AuditMiddleware] Error creating audit log:', error);
        }
      }

      // Clean up context
      auditContextMap.delete(req);
    });

    next();
  };
}

/**
 * Simple audit logging for routes that don't need previous state tracking.
 * Call this directly in your route handler after the operation succeeds.
 *
 * @example
 * ```typescript
 * router.delete('/users/:id', requireAdmin, async (req, res) => {
 *   const authReq = req as AuthRequest;
 *   const { id } = req.params;
 *
 *   // Get user before delete
 *   const user = await getUserById(id);
 *
 *   // Delete user
 *   await deleteUser(id);
 *
 *   // Log the audit entry
 *   await logAdminAction(authReq, {
 *     action: 'USER_DELETE',
 *     entityType: 'user',
 *     entityId: id,
 *     previousState: user,
 *   });
 *
 *   res.json({ success: true });
 * });
 * ```
 */
export async function logAdminAction(
  req: AuthRequest,
  params: {
    action: AuditAction;
    entityType: AuditEntityType;
    entityId?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await createAuditLog({
      adminId: req.user.id,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      previousState: params.previousState,
      newState: params.newState,
      metadata: {
        ...params.metadata,
        requestId: (req as unknown as { id?: string }).id,
        userAgent: req.get('user-agent'),
      },
      ipAddress: getClientIp(req),
    });
  } catch (error) {
    // Log but don't throw - audit logging should not break the request
    console.error('[AuditMiddleware] Error logging admin action:', error);
  }
}
