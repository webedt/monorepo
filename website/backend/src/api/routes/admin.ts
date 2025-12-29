/**
 * Admin routes for user management
 * Consolidated from website/apps/server/src/routes/admin.ts
 */

import { Router } from 'express';
import { z } from 'zod';
import { db, users, sessions, eq, sql, ROLE_HIERARCHY } from '@webedt/shared';
import type { UserRole } from '@webedt/shared';
import { AuthRequest, requireAdmin } from '../middleware/auth.js';
import { lucia } from '@webedt/shared';
import bcrypt from 'bcrypt';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendInternalError,
  validateRequest,
  ApiErrorCode,
} from '@webedt/shared';

// Validation schemas
const createUserSchema = {
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    displayName: z.string().optional(),
    isAdmin: z.boolean().optional().default(false),
    role: z.enum(['user', 'editor', 'developer', 'admin']).optional(),
  }),
};

const updateUserSchema = {
  body: z.object({
    email: z.string().email().optional(),
    displayName: z.string().optional(),
    isAdmin: z.boolean().optional(),
    role: z.enum(['user', 'editor', 'developer', 'admin']).optional(),
    password: z.string().min(8).optional(),
  }),
};

const router = Router();

// GET /api/admin/users - List all users
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const allUsers = await db.select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      githubId: users.githubId,
      isAdmin: users.isAdmin,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users).orderBy(users.createdAt);

    sendSuccess(res, allUsers);
  } catch (error) {
    console.error('Error fetching users:', error);
    sendInternalError(res, 'Failed to fetch users');
  }
});

// GET /api/admin/users/:id - Get user details
router.get('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const user = await db.select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      githubId: users.githubId,
      githubAccessToken: users.githubAccessToken,
      claudeAuth: users.claudeAuth,
      imageResizeMaxDimension: users.imageResizeMaxDimension,
      voiceCommandKeywords: users.voiceCommandKeywords,
      isAdmin: users.isAdmin,
      role: users.role,
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, id)).limit(1);

    if (!user || user.length === 0) {
      sendNotFound(res, 'User not found');
      return;
    }

    sendSuccess(res, user[0]);
  } catch (error) {
    console.error('Error fetching user:', error);
    sendInternalError(res, 'Failed to fetch user');
  }
});

// POST /api/admin/users - Create a new user
router.post('/users', requireAdmin, validateRequest(createUserSchema), async (req, res) => {
  try {
    const { email, displayName, password, isAdmin, role } = req.body;

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      sendError(res, 'User with this email already exists', 400, ApiErrorCode.CONFLICT);
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate user ID
    const userId = crypto.randomUUID();

    // Determine role - if explicitly provided, use it; otherwise derive from isAdmin flag
    const userRole = role || (isAdmin ? 'admin' : 'user');
    // Sync isAdmin flag with role
    const userIsAdmin = isAdmin || role === 'admin';

    // Create user
    const newUser = await db.insert(users).values({
      id: userId,
      email,
      displayName: displayName || null,
      passwordHash,
      isAdmin: userIsAdmin,
      role: userRole,
    }).returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      role: users.role,
      createdAt: users.createdAt,
    });

    sendSuccess(res, newUser[0], 201);
  } catch (error) {
    console.error('Error creating user:', error);
    sendInternalError(res, 'Failed to create user');
  }
});

// PATCH /api/admin/users/:id - Update user
router.patch('/users/:id', requireAdmin, validateRequest(updateUserSchema), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { email, displayName, isAdmin, role, password } = req.body;

    // Prevent user from removing their own admin status
    if (authReq.user?.id === id && isAdmin === false) {
      sendError(res, 'Cannot remove your own admin status', 400, ApiErrorCode.FORBIDDEN);
      return;
    }

    // Prevent user from demoting their own role
    if (authReq.user?.id === id && role && ROLE_HIERARCHY.indexOf(role) < ROLE_HIERARCHY.indexOf(authReq.user.role || 'user')) {
      sendError(res, 'Cannot demote your own role', 400, ApiErrorCode.FORBIDDEN);
      return;
    }

    const updateData: Record<string, unknown> = {};

    if (email !== undefined) updateData.email = email;
    if (displayName !== undefined) updateData.displayName = displayName;

    // Handle role and isAdmin synchronization
    if (role !== undefined) {
      updateData.role = role;
      // Sync isAdmin with role
      updateData.isAdmin = role === 'admin';
    } else if (isAdmin !== undefined) {
      updateData.isAdmin = isAdmin;
      // Sync role with isAdmin - only change role if going to/from admin
      if (isAdmin) {
        updateData.role = 'admin';
      }
    }

    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      sendError(res, 'No fields to update', 400, ApiErrorCode.VALIDATION_ERROR);
      return;
    }

    const updatedUser = await db.update(users)
      .set(updateData)
      .where(eq(users.id, id))
      .returning({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        isAdmin: users.isAdmin,
        role: users.role,
        createdAt: users.createdAt,
      });

    if (!updatedUser || updatedUser.length === 0) {
      sendNotFound(res, 'User not found');
      return;
    }

    sendSuccess(res, updatedUser[0]);
  } catch (error) {
    console.error('Error updating user:', error);
    sendInternalError(res, 'Failed to update user');
  }
});

// DELETE /api/admin/users/:id - Delete user
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Prevent user from deleting themselves
    if (authReq.user?.id === id) {
      sendError(res, 'Cannot delete your own account', 400, ApiErrorCode.FORBIDDEN);
      return;
    }

    const deletedUser = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });

    if (!deletedUser || deletedUser.length === 0) {
      sendNotFound(res, 'User not found');
      return;
    }

    sendSuccess(res, { id: deletedUser[0].id });
  } catch (error) {
    console.error('Error deleting user:', error);
    sendInternalError(res, 'Failed to delete user');
  }
});

// POST /api/admin/users/:id/impersonate - Impersonate user
router.post('/users/:id/impersonate', requireAdmin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Cannot impersonate yourself
    if (authReq.user?.id === id) {
      sendError(res, 'Cannot impersonate yourself', 400, ApiErrorCode.FORBIDDEN);
      return;
    }

    // Check if target user exists
    const targetUser = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!targetUser || targetUser.length === 0) {
      sendNotFound(res, 'User not found');
      return;
    }

    // Invalidate current session
    if (authReq.authSession) {
      await lucia.invalidateSession(authReq.authSession.id);
    }

    // Create new session for target user
    const session = await lucia.createSession(id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    res.setHeader('Set-Cookie', sessionCookie.serialize());
    sendSuccess(res, {
      message: 'Now impersonating user',
      userId: id
    });
  } catch (error) {
    console.error('Error impersonating user:', error);
    sendInternalError(res, 'Failed to impersonate user');
  }
});

// GET /api/admin/stats - Get admin statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = await db.select({ count: sql<number>`count(*)` }).from(users);
    const totalAdmins = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isAdmin, true));
    const activeSessions = await db.select({ count: sql<number>`count(*)` }).from(sessions);

    // Get role breakdown
    const roleStats = await db.select({
      role: users.role,
      count: sql<number>`count(*)`,
    }).from(users).groupBy(users.role);

    const roleCounts: Record<string, number> = {
      user: 0,
      editor: 0,
      developer: 0,
      admin: 0,
    };
    for (const stat of roleStats) {
      roleCounts[stat.role || 'user'] = Number(stat.count);
    }

    sendSuccess(res, {
      totalUsers: Number(totalUsers[0].count),
      totalAdmins: Number(totalAdmins[0].count),
      activeSessions: Number(activeSessions[0].count),
      roleCounts,
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    sendInternalError(res, 'Failed to fetch statistics');
  }
});

export default router;
