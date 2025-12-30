/**
 * Auth Routes
 * Handles user registration, login, logout, and session management
 */

import { Router, Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { generateIdFromEntropySize } from 'lucia';
import { db, users, eq } from '@webedt/shared';
import { lucia } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { ensureValidToken, ClaudeAuth } from '@webedt/shared';
import { ensureValidCodexToken, isValidCodexAuth, CodexAuth } from '@webedt/shared';
import { logger } from '@webedt/shared';
// Note: Encryption/decryption is now automatic via Drizzle custom column types
// No manual encrypt/decrypt calls needed - the schema handles it transparently
import {
  sendSuccess,
  sendError,
  sendValidationError,
  sendUnauthorized,
  sendInternalError,
  validateRequest,
  ApiErrorCode,
} from '@webedt/shared';
import { authRateLimiter } from '../middleware/rateLimit.js';
import { getCsrfToken, CSRF_CONSTANTS } from '../middleware/csrf.js';

// Validation schemas
const registerSchema = {
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
  }),
};

const loginSchema = {
  body: z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
    rememberMe: z.boolean().optional().default(false),
  }),
};

const router = Router();

/**
 * @openapi
 * /auth/register:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Register a new user
 *     description: Creates a new user account with email and password. Automatically logs in the user after successful registration.
 *     security: []
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
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 minLength: 8
 *                 description: Password (minimum 8 characters)
 *                 example: mySecurePassword123
 *     responses:
 *       201:
 *         description: User registered successfully
 *         headers:
 *           Set-Cookie:
 *             description: Session cookie for authentication
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Email already in use
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         description: Too many requests - rate limited
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Register - strict rate limiting to prevent brute-force attacks
router.post('/register', authRateLimiter, validateRequest(registerSchema), async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();

    // Check if user already exists
    const existingUser = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    if (existingUser.length > 0) {
      sendError(res, 'Email already in use', 400, ApiErrorCode.CONFLICT);
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

    res.status(201).appendHeader('Set-Cookie', sessionCookie.serialize());
    sendSuccess(res, {
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
        createdAt: newUser.createdAt,
      },
    }, 201);
  } catch (error) {
    logger.error('Registration error', error, { component: 'auth', operation: 'register' });
    sendInternalError(res);
  }
});

/**
 * @openapi
 * /auth/login:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Login user
 *     description: Authenticates a user with email and password. Returns a session cookie for subsequent authenticated requests.
 *     security: []
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
 *                 example: user@example.com
 *               password:
 *                 type: string
 *                 description: User's password
 *                 example: mySecurePassword123
 *               rememberMe:
 *                 type: boolean
 *                 description: Extend session duration (90 days vs 30 days)
 *                 default: false
 *     responses:
 *       200:
 *         description: Login successful
 *         headers:
 *           Set-Cookie:
 *             description: Session cookie for authentication
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Invalid email or password
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       422:
 *         $ref: '#/components/responses/ValidationError'
 *       429:
 *         description: Too many requests - rate limited
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Login - strict rate limiting to prevent brute-force attacks
router.post('/login', authRateLimiter, validateRequest(loginSchema), async (req: Request, res: Response) => {
  try {
    const { email, password, rememberMe } = req.body;

    // Normalize email to lowercase for case-insensitive comparison
    const normalizedEmail = email.toLowerCase().trim();

    // Find user
    const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

    if (!user) {
      sendError(res, 'Invalid email or password', 401, ApiErrorCode.UNAUTHORIZED);
      return;
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);

    if (!validPassword) {
      sendError(res, 'Invalid email or password', 401, ApiErrorCode.UNAUTHORIZED);
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

    // Sensitive fields are automatically decrypted by Drizzle custom column types
    res.appendHeader('Set-Cookie', sessionCookie.serialize());
    sendSuccess(res, {
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
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    logger.error('Login error', error, { component: 'auth', operation: 'login' });
    sendInternalError(res);
  }
});

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     tags:
 *       - Auth
 *     summary: Logout user
 *     description: Invalidates the current session and clears the session cookie.
 *     responses:
 *       200:
 *         description: Logout successful
 *         headers:
 *           Set-Cookie:
 *             description: Blank session cookie to clear authentication
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
 *                       example: Logged out successfully
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Logout
router.post('/logout', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.authSession) {
      sendUnauthorized(res);
      return;
    }

    await lucia.invalidateSession(authReq.authSession.id);
    const blankCookie = lucia.createBlankSessionCookie();

    res.appendHeader('Set-Cookie', blankCookie.serialize());
    sendSuccess(res, { message: 'Logged out successfully' });
  } catch (error) {
    logger.error('Logout error', error, { component: 'auth', operation: 'logout' });
    sendInternalError(res);
  }
});

/**
 * @openapi
 * /auth/session:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Get current session
 *     description: Returns the current authenticated user's session information. Also refreshes OAuth tokens if needed.
 *     responses:
 *       200:
 *         description: Session information retrieved successfully
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
 *                     user:
 *                       $ref: '#/components/schemas/User'
 *                     session:
 *                       type: object
 *                       properties:
 *                         id:
 *                           type: string
 *                         userId:
 *                           type: string
 *                         expiresAt:
 *                           type: string
 *                           format: date-time
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get current session
router.get('/session', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user || !authReq.authSession) {
      sendUnauthorized(res);
      return;
    }

    // Fetch fresh user data from database to get latest credentials
    const [freshUser] = await db
      .select()
      .from(users)
      .where(eq(users.id, authReq.user.id))
      .limit(1);

    if (!freshUser) {
      sendError(res, 'User not found', 401, ApiErrorCode.NOT_FOUND);
      return;
    }

    // Sensitive fields are automatically decrypted by Drizzle custom column types

    // Check and refresh Claude OAuth token if needed
    let claudeAuth = freshUser.claudeAuth;
    if (claudeAuth && claudeAuth.accessToken && claudeAuth.refreshToken && claudeAuth.expiresAt) {
      try {
        const refreshedClaudeAuth = await ensureValidToken(claudeAuth as ClaudeAuth);
        if (refreshedClaudeAuth !== claudeAuth) {
          // Token was refreshed, update database (encryption is automatic)
          await db
            .update(users)
            .set({ claudeAuth: refreshedClaudeAuth })
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
          // Token was refreshed, update database (encryption is automatic)
          await db
            .update(users)
            .set({ codexAuth: refreshedCodexAuth })
            .where(eq(users.id, freshUser.id));
          codexAuth = refreshedCodexAuth as typeof codexAuth;
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

    sendSuccess(res, {
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
        createdAt: freshUser.createdAt,
      },
      session: authReq.authSession,
    });
  } catch (error) {
    logger.error('Session error', error, { component: 'auth', operation: 'session' });
    sendInternalError(res);
  }
});

/**
 * @openapi
 * /auth/csrf-token:
 *   get:
 *     tags:
 *       - Auth
 *     summary: Get CSRF token
 *     description: Returns the current CSRF token. The token is also set in a cookie. Frontend should include this token in the X-CSRF-Token header for all state-changing requests (POST, PUT, DELETE, PATCH).
 *     security: []
 *     responses:
 *       200:
 *         description: CSRF token retrieved successfully
 *         headers:
 *           Set-Cookie:
 *             description: CSRF token cookie (if not already set)
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
 *                     csrfToken:
 *                       type: string
 *                       description: The CSRF token to include in X-CSRF-Token header
 *                     headerName:
 *                       type: string
 *                       example: x-csrf-token
 *                       description: The header name to use when sending the token
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
// Get CSRF token - allows frontend to fetch token for state-changing requests
router.get('/csrf-token', (req: Request, res: Response) => {
  const token = getCsrfToken(req, res);
  sendSuccess(res, {
    csrfToken: token,
    headerName: CSRF_CONSTANTS.HEADER_NAME,
  });
});

export default router;
