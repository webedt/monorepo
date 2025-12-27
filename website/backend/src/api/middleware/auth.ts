/**
 * Authentication middleware
 * Consolidated from website/apps/server/src/middleware/auth.ts
 */

import { Request, Response, NextFunction } from 'express';
import { lucia, hasRolePermission } from '@webedt/shared';
import type { User, Session } from 'lucia';
import type { UserRole } from '@webedt/shared';

// Extend Express Request type to include auth properties
// Note: Using 'authSession' to avoid conflict with express-session's 'session'
declare global {
  namespace Express {
    interface Request {
      user?: User | null;
      authSession?: Session | null;
    }
  }
}

// AuthRequest is the same as Request but with user and authSession guaranteed non-null
// Use this type after requireAuth middleware
export interface AuthRequest extends Request {
  user: User;
  authSession: Session;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');

    if (!sessionId) {
      req.user = null;
      req.authSession = null;
      next();
      return;
    }

    const { session, user } = await lucia.validateSession(sessionId);

    if (session && session.fresh) {
      res.appendHeader('Set-Cookie', lucia.createSessionCookie(session.id).serialize());
    }

    if (!session) {
      res.appendHeader('Set-Cookie', lucia.createBlankSessionCookie().serialize());
    }

    req.user = user;
    req.authSession = session;
    next();
  } catch (error) {
    // Pass async errors to Express error handler
    // This is necessary because Express 4 doesn't automatically catch async errors
    console.error('[AuthMiddleware] Error validating session:', error);
    next(error);
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.authSession) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.authSession) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
    return;
  }

  next();
}

/**
 * Middleware factory that requires a minimum role level
 * Uses role hierarchy: user < editor < developer < admin
 *
 * Usage:
 *   router.get('/editor-only', requireRole('editor'), handler);
 *   router.get('/dev-only', requireRole('developer'), handler);
 */
export function requireRole(requiredRole: UserRole) {
  return function (req: Request, res: Response, next: NextFunction): void {
    if (!req.user || !req.authSession) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    const userRole = req.user.role || 'user';
    if (!hasRolePermission(userRole, requiredRole)) {
      res.status(403).json({
        success: false,
        error: `Forbidden: ${requiredRole} access required`,
      });
      return;
    }

    next();
  };
}
