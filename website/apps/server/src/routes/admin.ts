import { Router } from 'express';
import { db } from '../db/index';
import { users, sessions } from '../db/schema';
import { AuthRequest, requireAdmin } from '../middleware/auth';
import { eq, sql } from 'drizzle-orm';
import { lucia } from '../auth';
import bcrypt from 'bcrypt';

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
      createdAt: users.createdAt,
    }).from(users).orderBy(users.createdAt);

    res.json({ success: true, data: allUsers });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
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
      createdAt: users.createdAt,
    }).from(users).where(eq(users.id, id)).limit(1);

    if (!user || user.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data: user[0] });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
});

// POST /api/admin/users - Create a new user
router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { email, displayName, password, isAdmin } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser.length > 0) {
      res.status(400).json({ success: false, error: 'User with this email already exists' });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate user ID
    const userId = crypto.randomUUID();

    // Create user
    const newUser = await db.insert(users).values({
      id: userId,
      email,
      displayName: displayName || null,
      passwordHash,
      isAdmin: isAdmin || false,
    }).returning({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      isAdmin: users.isAdmin,
      createdAt: users.createdAt,
    });

    res.json({ success: true, data: newUser[0] });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

// PATCH /api/admin/users/:id - Update user
router.patch('/users/:id', requireAdmin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;
    const { email, displayName, isAdmin, password } = req.body;

    // Prevent user from removing their own admin status
    if (authReq.user?.id === id && isAdmin === false) {
      res.status(400).json({ success: false, error: 'Cannot remove your own admin status' });
      return;
    }

    const updateData: any = {};

    if (email !== undefined) updateData.email = email;
    if (displayName !== undefined) updateData.displayName = displayName;
    if (isAdmin !== undefined) updateData.isAdmin = isAdmin;
    if (password) {
      updateData.passwordHash = await bcrypt.hash(password, 10);
    }

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({ success: false, error: 'No fields to update' });
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
        createdAt: users.createdAt,
      });

    if (!updatedUser || updatedUser.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data: updatedUser[0] });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// DELETE /api/admin/users/:id - Delete user
router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Prevent user from deleting themselves
    if (authReq.user?.id === id) {
      res.status(400).json({ success: false, error: 'Cannot delete your own account' });
      return;
    }

    const deletedUser = await db.delete(users).where(eq(users.id, id)).returning({ id: users.id });

    if (!deletedUser || deletedUser.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({ success: true, data: { id: deletedUser[0].id } });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// POST /api/admin/users/:id/impersonate - Impersonate user
router.post('/users/:id/impersonate', requireAdmin, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { id } = req.params;

    // Cannot impersonate yourself
    if (authReq.user?.id === id) {
      res.status(400).json({ success: false, error: 'Cannot impersonate yourself' });
      return;
    }

    // Check if target user exists
    const targetUser = await db.select().from(users).where(eq(users.id, id)).limit(1);
    if (!targetUser || targetUser.length === 0) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Invalidate current session
    if (authReq.session) {
      await lucia.invalidateSession(authReq.session.id);
    }

    // Create new session for target user
    const session = await lucia.createSession(id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    res.setHeader('Set-Cookie', sessionCookie.serialize());
    res.json({
      success: true,
      data: {
        message: 'Now impersonating user',
        userId: id
      }
    });
  } catch (error) {
    console.error('Error impersonating user:', error);
    res.status(500).json({ success: false, error: 'Failed to impersonate user' });
  }
});

// GET /api/admin/stats - Get admin statistics
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const totalUsers = await db.select({ count: sql<number>`count(*)` }).from(users);
    const totalAdmins = await db.select({ count: sql<number>`count(*)` }).from(users).where(eq(users.isAdmin, true));
    const activeSessions = await db.select({ count: sql<number>`count(*)` }).from(sessions);

    res.json({
      success: true,
      data: {
        totalUsers: Number(totalUsers[0].count),
        totalAdmins: Number(totalAdmins[0].count),
        activeSessions: Number(activeSessions[0].count),
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
});

export default router;
