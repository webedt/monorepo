/**
 * Auth Routes
 * Handles user registration, login, logout, and session management
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { generateIdFromEntropySize } from 'lucia';
import { db, users, eq } from '@webedt/shared';
import { lucia } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { ensureValidToken, ClaudeAuth } from '@webedt/shared';
import { ensureValidCodexToken, isValidCodexAuth, CodexAuth } from '@webedt/shared';
import { logger } from '@webedt/shared';

const router = Router();

// Register
router.post('/register', async (req: Request, res: Response) => {
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

    // Check if this email should be admin
    const isAdmin = normalizedEmail === 'etdofresh@gmail.com';

    // Create user
    const [newUser] = await db
      .insert(users)
      .values({
        id: userId,
        email: normalizedEmail,
        passwordHash,
        isAdmin,
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
            codexAuth: newUser.codexAuth,
            geminiAuth: newUser.geminiAuth,
            preferredProvider: newUser.preferredProvider || 'claude',
            imageResizeMaxDimension: newUser.imageResizeMaxDimension,
            voiceCommandKeywords: newUser.voiceCommandKeywords || [],
            defaultLandingPage: newUser.defaultLandingPage || 'store',
            preferredModel: newUser.preferredModel,
            isAdmin: newUser.isAdmin,
            role: newUser.role,
            createdAt: newUser.createdAt,
          },
        },
      });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response) => {
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
            codexAuth: user.codexAuth,
            geminiAuth: user.geminiAuth,
            preferredProvider: user.preferredProvider || 'claude',
            imageResizeMaxDimension: user.imageResizeMaxDimension,
            voiceCommandKeywords: user.voiceCommandKeywords || [],
            defaultLandingPage: user.defaultLandingPage || 'store',
            preferredModel: user.preferredModel,
            isAdmin: user.isAdmin,
            role: user.role,
            createdAt: user.createdAt,
          },
        },
      });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.authSession) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    await lucia.invalidateSession(authReq.authSession.id);
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
router.get('/session', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user || !authReq.authSession) {
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

    // Check and refresh Claude OAuth token if needed
    let claudeAuth = freshUser.claudeAuth;
    if (claudeAuth && claudeAuth.accessToken && claudeAuth.refreshToken && claudeAuth.expiresAt) {
      try {
        const refreshedClaudeAuth = await ensureValidToken(claudeAuth as ClaudeAuth);
        if (refreshedClaudeAuth !== claudeAuth) {
          // Token was refreshed, update database
          await db
            .update(users)
            .set({ claudeAuth: refreshedClaudeAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
            .where(eq(users.id, freshUser.id));
          claudeAuth = refreshedClaudeAuth as typeof claudeAuth;
          logger.info('Claude OAuth token refreshed during session check', {
            component: 'AuthRoute',
            userId: freshUser.id
          });
        }
      } catch (refreshError) {
        // Log but don't fail the session request - return the existing token
        // The user can still use other features or re-authenticate
        logger.error('Failed to refresh Claude OAuth token during session check', refreshError, {
          component: 'AuthRoute',
          userId: freshUser.id
        });
      }
    }

    // Check and refresh Codex OAuth token if needed
    let codexAuth = freshUser.codexAuth;
    if (codexAuth && isValidCodexAuth(codexAuth) && codexAuth.accessToken && codexAuth.expiresAt) {
      try {
        const refreshedCodexAuth = await ensureValidCodexToken(codexAuth as CodexAuth);
        if (refreshedCodexAuth !== codexAuth) {
          // Token was refreshed, update database
          await db
            .update(users)
            .set({ codexAuth: refreshedCodexAuth })
            .where(eq(users.id, freshUser.id));
          codexAuth = refreshedCodexAuth;
          logger.info('Codex OAuth token refreshed during session check', {
            component: 'AuthRoute',
            userId: freshUser.id
          });
        }
      } catch (refreshError) {
        // Log but don't fail the session request
        logger.error('Failed to refresh Codex OAuth token during session check', refreshError, {
          component: 'AuthRoute',
          userId: freshUser.id
        });
      }
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
          claudeAuth: claudeAuth,
          codexAuth: codexAuth,
          geminiAuth: freshUser.geminiAuth,
          preferredProvider: freshUser.preferredProvider || 'claude',
          imageResizeMaxDimension: freshUser.imageResizeMaxDimension,
          voiceCommandKeywords: freshUser.voiceCommandKeywords || [],
          defaultLandingPage: freshUser.defaultLandingPage || 'store',
          preferredModel: freshUser.preferredModel,
          isAdmin: freshUser.isAdmin,
          role: freshUser.role,
          createdAt: freshUser.createdAt,
        },
        session: authReq.authSession,
      },
    });
  } catch (error) {
    console.error('Session error:', error);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

export default router;
