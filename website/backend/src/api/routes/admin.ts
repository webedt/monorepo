/**
 * Admin routes for user management
 * Consolidated from website/apps/server/src/routes/admin.ts
 */

import { Router } from 'express';
import { z } from 'zod';
import { db, users, sessions, eq, sql, ROLE_HIERARCHY, isValidRole } from '@webedt/shared';
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
    password: z.string().min(8).optional(),
    role: z.enum(['user', 'editor', 'developer', 'admin']).optional(),
  }),
};

/**
 * Typed update data for user updates.
 * Matches the columns available on the users table.
 */
interface UserUpdateData {
  email?: string;
  displayName?: string;
  isAdmin?: boolean;
  passwordHash?: string;
}

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Admin
 *     description: Administrative operations (admin only)
 */

/**
 * @openapi
 * /admin/users:
 *   get:
 *     tags:
 *       - Admin
 *     summary: List all users
 *     description: Returns a list of all users in the system. Admin access required.
 *     responses:
 *       200:
 *         description: List of users retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       email:
 *                         type: string
 *                         format: email
 *                       displayName:
 *                         type: string
 *                         nullable: true
 *                       githubId:
 *                         type: string
 *                         nullable: true
 *                       isAdmin:
 *                         type: boolean
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /admin/users/{id}:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get user details
 *     description: Returns detailed information about a specific user. Admin access required.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: User ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User details retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/User'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /admin/users:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Create a new user
 *     description: Creates a new user account. Admin access required.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 description: User's email address
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 description: Password (minimum 8 characters)
 *               displayName:
 *                 type: string
 *                 description: User's display name
 *               isAdmin:
 *                 type: boolean
 *                 default: false
 *                 description: Whether the user is an admin
 *     responses:
 *       201:
 *         description: User created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     displayName:
 *                       type: string
 *                       nullable: true
 *                     isAdmin:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: User with this email already exists
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /admin/users/{id}:
 *   patch:
 *     tags:
 *       - Admin
 *     summary: Update user
 *     description: Updates an existing user's information. Admin access required. Admins cannot remove their own admin status.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: User ID
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *               displayName:
 *                 type: string
 *               isAdmin:
 *                 type: boolean
 *               password:
 *                 type: string
 *                 minLength: 8
 *     responses:
 *       200:
 *         description: User updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     displayName:
 *                       type: string
 *                       nullable: true
 *                     isAdmin:
 *                       type: boolean
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Cannot remove own admin status or no fields to update
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// PATCH /api/admin/users/:id - Update user
router.patch('/users/:id', requireAdmin, validateRequest(updateUserSchema), async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { email, displayName, isAdmin, role, password } = req.body;

    // Prevent user from removing their own admin status or demoting themselves
    if (authReq.user?.id === id) {
      if (isAdmin === false) {
        sendError(res, 'Cannot remove your own admin status', 400, ApiErrorCode.FORBIDDEN);
        return;
      }
      if (role !== undefined && role !== 'admin') {
        sendError(res, 'Cannot demote your own role', 400, ApiErrorCode.FORBIDDEN);
        return;
      }
    }

    const updateData: UserUpdateData & { role?: UserRole } = {};

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

/**
 * @openapi
 * /admin/users/{id}:
 *   delete:
 *     tags:
 *       - Admin
 *     summary: Delete user
 *     description: Permanently deletes a user account. Admin access required. Admins cannot delete their own account.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: User ID
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Cannot delete own account
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /admin/users/{id}/impersonate:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Impersonate user
 *     description: Start a session as another user. Admin access required. Cannot impersonate yourself.
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         description: User ID to impersonate
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Impersonation started successfully
 *         headers:
 *           Set-Cookie:
 *             description: New session cookie for impersonated user
 *             schema:
 *               type: string
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Now impersonating user
 *                     userId:
 *                       type: string
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Cannot impersonate yourself
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /admin/stats:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get admin statistics
 *     description: Returns platform-wide statistics including total users, admins, and active sessions. Admin access required.
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     totalUsers:
 *                       type: integer
 *                       description: Total number of registered users
 *                     totalAdmins:
 *                       type: integer
 *                       description: Total number of admin users
 *                     activeSessions:
 *                       type: integer
 *                       description: Number of active login sessions
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
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

/**
 * @openapi
 * /admin/rate-limits:
 *   get:
 *     tags:
 *       - Admin
 *     summary: Get rate limit dashboard
 *     description: Returns comprehensive rate limiting metrics, configuration, and circuit breaker status. Admin access required.
 *     responses:
 *       200:
 *         description: Rate limit dashboard data retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     metrics:
 *                       type: object
 *                       properties:
 *                         totalRequests:
 *                           type: integer
 *                           description: Total requests processed
 *                         totalBlocked:
 *                           type: integer
 *                           description: Total requests blocked by rate limiting
 *                         hitsByTier:
 *                           type: object
 *                           description: Blocked requests by rate limit tier
 *                         hitsByPath:
 *                           type: object
 *                           description: Blocked requests by API path
 *                         hitsByUser:
 *                           type: object
 *                           description: Blocked requests by user ID
 *                         adminBypass:
 *                           type: integer
 *                           description: Requests bypassed due to admin status
 *                         circuitBreakerDegraded:
 *                           type: integer
 *                           description: Requests with degraded limits due to circuit breaker
 *                         lastReset:
 *                           type: string
 *                           format: date-time
 *                     config:
 *                       type: object
 *                       description: Rate limit configuration per tier
 *                     storeStats:
 *                       type: object
 *                       description: Per-tier store statistics (keys, hits, blocked)
 *                     circuitBreakers:
 *                       type: object
 *                       description: Circuit breaker states and failure counts
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// GET /api/admin/rate-limits - Get rate limit dashboard
router.get('/rate-limits', requireAdmin, async (req, res) => {
  try {
    const { getRateLimitDashboard } = await import('../middleware/rateLimit.js');
    const dashboard = getRateLimitDashboard();
    sendSuccess(res, dashboard);
  } catch (error) {
    console.error('Error fetching rate limit dashboard:', error);
    sendInternalError(res, 'Failed to fetch rate limit dashboard');
  }
});

/**
 * @openapi
 * /admin/rate-limits/reset:
 *   post:
 *     tags:
 *       - Admin
 *     summary: Reset rate limit metrics
 *     description: Resets all rate limit metrics counters. Admin access required. This does not reset active rate limit windows.
 *     responses:
 *       200:
 *         description: Rate limit metrics reset successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Rate limit metrics reset successfully
 *                     resetAt:
 *                       type: string
 *                       format: date-time
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// POST /api/admin/rate-limits/reset - Reset rate limit metrics
router.post('/rate-limits/reset', requireAdmin, async (req, res) => {
  try {
    const { resetRateLimitMetrics } = await import('../middleware/rateLimit.js');
    resetRateLimitMetrics();
    sendSuccess(res, {
      message: 'Rate limit metrics reset successfully',
      resetAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error resetting rate limit metrics:', error);
    sendInternalError(res, 'Failed to reset rate limit metrics');
  }
});

export default router;
