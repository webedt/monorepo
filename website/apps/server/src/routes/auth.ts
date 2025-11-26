import { Router } from 'express';
import bcrypt from 'bcrypt';
import { generateIdFromEntropySize } from 'lucia';
import { db } from '../db/index';
import { users } from '../db/index';
import { lucia } from '../auth';
import { eq } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth';

const router = Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }

    if (password.length < 8) {
      res.status(400).json({ success: false, error: 'Password must be at least 8 characters' });
      return;
    }

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    if (existingUser.length > 0) {
      res.status(400).json({ success: false, error: 'Email already in use' });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Generate user ID
    const userId = generateIdFromEntropySize(10); // 10 bytes = 120 bits of entropy

    // Create user
    const [newUser] = await db
      .insert(users)
      .values({
        id: userId,
        email: normalizedEmail,
        passwordHash,
      })
      .returning();

    // Create session
    const session = await lucia.createSession(newUser.id, {});
    const sessionCookie = lucia.createSessionCookie(session.id);

    res
      .status(201)
      .appendHeader('Set-Cookie', sessionCookie.serialize())
      .json({
        success: true,
        data: {
          user: {
            id: newUser.id,
            email: newUser.email,
            displayName: newUser.displayName,
            githubId: newUser.githubId,
            githubAccessToken: newUser.githubAccessToken,
            claudeAuth: newUser.claudeAuth,
            imageResizeMaxDimension: newUser.imageResizeMaxDimension,
            voiceCommandKeywords: newUser.voiceCommandKeywords || [],
          },
        },
      });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body;

    if (!email || !password) {
      res.status(400).json({ success: false, error: 'Email and password are required' });
      return;
    }

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    if (!user) {
      res.status(400).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      res.status(400).json({ success: false, error: 'Invalid email or password' });
      return;
    }

    // Create session with extended expiration if remember me is checked
    // Default Lucia session: 30 days, Remember me: 90 days
    const session = await lucia.createSession(user.id, {});

    // Create session cookie with custom maxAge if remember me is checked
    let sessionCookie;
    if (rememberMe) {
      // 90 days in seconds
      const ninetyDaysInSeconds = 90 * 24 * 60 * 60;
      sessionCookie = lucia.createSessionCookie(session.id);
      // Override the maxAge for remember me
      sessionCookie.attributes.maxAge = ninetyDaysInSeconds;
    } else {
      sessionCookie = lucia.createSessionCookie(session.id);
    }

    res
      .appendHeader('Set-Cookie', sessionCookie.serialize())
      .json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            githubId: user.githubId,
            githubAccessToken: user.githubAccessToken,
            claudeAuth: user.claudeAuth,
            imageResizeMaxDimension: user.imageResizeMaxDimension,
            voiceCommandKeywords: user.voiceCommandKeywords || [],
          },
        },
      });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.session) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    await lucia.invalidateSession(authReq.session.id);
    const blankCookie = lucia.createBlankSessionCookie();

    res
      .appendHeader('Set-Cookie', blankCookie.serialize())
      .json({ success: true, data: { message: 'Logged out successfully' } });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Get current session
router.get('/session', async (req, res) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user || !authReq.session) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    // Fetch fresh user data from database to get latest credentials
    const [freshUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, authReq.user.id))
      .limit(1);

    if (!freshUser) {
      res.status(401).json({ success: false, error: 'User not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        user: {
          id: freshUser.id,
          email: freshUser.email,
          displayName: freshUser.displayName,
          githubId: freshUser.githubId,
          githubAccessToken: freshUser.githubAccessToken,
          claudeAuth: freshUser.claudeAuth,
          imageResizeMaxDimension: freshUser.imageResizeMaxDimension,
          voiceCommandKeywords: freshUser.voiceCommandKeywords || [],
        },
        session: authReq.session,
      },
    });
  } catch (error) {
    console.error('Session error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
