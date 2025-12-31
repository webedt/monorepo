/**
 * Audit Logging Helper
 *
 * Provides a simple function to log admin operations to the audit trail.
 * Call logAdminAction directly in route handlers after operations succeed.
 */

import {
  createAuditLog,
  getClientIp,
} from '@webedt/shared';

import type { AuditAction, AuditEntityType } from '@webedt/shared';

import type { AuthRequest } from './auth.js';

/**
 * Simple audit logging for admin route handlers.
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
