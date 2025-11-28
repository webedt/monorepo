import { Request, Response, NextFunction } from 'express';
import { lucia } from '../auth';
import type { User, Session } from 'lucia';

export interface AuthRequest extends Request {
  user: User | null;
  session: Session | null;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authReq = req as AuthRequest;

  const sessionId = lucia.readSessionCookie(req.headers.cookie ?? '');

  if (!sessionId) {
    authReq.user = null;
    authReq.session = null;
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

  authReq.user = user;
  authReq.session = session;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;

  if (!authReq.user || !authReq.session) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;

  if (!authReq.user || !authReq.session) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }

  if (!authReq.user.isAdmin) {
    res.status(403).json({ success: false, error: 'Forbidden: Admin access required' });
    return;
  }

  next();
}
