/**
 * Authentication middleware
 * Consolidated from website/apps/server/src/middleware/auth.ts
 */

import { Request, Response, NextFunction } from 'express';
import { lucia } from '../auth.js';
import type { User, Session } from 'lucia';

// Extend Express Request type to include auth properties
declare global {
  namespace Express {
    interface Request {
      user?: User | null;
      session?: Session | null;
    }
  }
}

// AuthRequest is the same as Request but with user and session guaranteed non-null
// Use this type after requireAuth middleware
export interface AuthRequest extends Request {
  user: User;
  session: Session;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');

  if (!sessionId) {
    req.user = null;
    req.session = null;
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
  req.session = session;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.session) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || !req.session) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (!req.user.isAdmin) {
    res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
    return;
  }

  next();
}
