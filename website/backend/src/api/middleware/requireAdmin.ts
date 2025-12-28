/**
 * Admin Middleware
 * Enforces admin access for protected routes
 */

import { Request, Response, NextFunction } from 'express';
import { db, users, eq } from '@webedt/shared';
import type { AuthRequest } from './auth.js';

/**
 * Middleware to require admin access
 * Must be used after requireAuth middleware
 */
export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authReq = req as AuthRequest;

  // Ensure user is authenticated
  if (!authReq.user) {
    res.status(401).json({ success: false, error: 'Authentication required' });
    return;
  }

  try {
    // Check if user is admin in database
    const [currentUser] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, authReq.user.id))
      .limit(1);

    if (!currentUser?.isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    next();
  } catch (error) {
    console.error('Admin check error:', error);
    res.status(500).json({ success: false, error: 'Failed to verify admin status' });
  }
}

export default requireAdmin;
