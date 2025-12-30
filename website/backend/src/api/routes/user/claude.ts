/**
 * User Claude Auth Routes
 * Handles Claude authentication management
 */

import { Router, Request, Response } from 'express';
import { db, users, eq, logger, shouldRefreshClaudeToken, refreshClaudeToken } from '@webedt/shared';
// Note: Encryption/decryption is now automatic via Drizzle custom column types
import type { ClaudeAuth } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';

const router = Router();

/**
 * @openapi
 * /api/user/claude-auth:
 *   post:
 *     tags: [User]
 *     summary: Update Claude authentication credentials
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - accessToken
 *               - refreshToken
 *             properties:
 *               accessToken:
 *                 type: string
 *               refreshToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Claude authentication updated successfully
 *       400:
 *         description: Invalid Claude auth credentials
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/claude-auth', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    let claudeAuth = req.body.claudeAuth || req.body;

    // Handle wrapped format: extract from claudeAiOauth if present
    if (claudeAuth.claudeAiOauth) {
      claudeAuth = claudeAuth.claudeAiOauth;
    }

    // Validate Claude auth structure
    if (!claudeAuth || !claudeAuth.accessToken || !claudeAuth.refreshToken) {
      res.status(400).json({
        success: false,
        error: 'Invalid Claude auth. Must include accessToken and refreshToken.',
      });
      return;
    }

    // Update user with Claude auth (encryption is automatic via Drizzle column type)
    await db
      .update(users)
      .set({ claudeAuth })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Claude authentication updated successfully' },
    });
  } catch (error) {
    logger.error('Update Claude auth error', error as Error, { component: 'user', operation: 'updateClaudeAuth' });
    res.status(500).json({ success: false, error: 'Failed to update Claude authentication' });
  }
});

/**
 * @openapi
 * /api/user/claude-auth:
 *   delete:
 *     tags: [User]
 *     summary: Remove Claude authentication credentials
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Claude authentication removed successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/claude-auth', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    await db
      .update(users)
      .set({ claudeAuth: null })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Claude authentication removed' },
    });
  } catch (error) {
    logger.error('Remove Claude auth error', error as Error, { component: 'user', operation: 'removeClaudeAuth' });
    res.status(500).json({ success: false, error: 'Failed to remove Claude authentication' });
  }
});

/**
 * @openapi
 * /api/user/claude-auth/refresh:
 *   post:
 *     tags: [User]
 *     summary: Refresh Claude OAuth token
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Token refresh status
 *       400:
 *         description: No Claude authentication found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/claude-auth/refresh', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Get current Claude auth from user
    const [user] = await db
      .select({ claudeAuth: users.claudeAuth })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!user?.claudeAuth) {
      res.status(400).json({
        success: false,
        error: 'No Claude authentication found for user',
      });
      return;
    }

    // Claude auth is automatically decrypted by Drizzle column type
    const claudeAuth = user.claudeAuth as ClaudeAuth;

    // Check if refresh is needed
    if (!shouldRefreshClaudeToken(claudeAuth)) {
      logger.info('Token still valid, no refresh needed', { component: 'UserRoutes' });
      res.json({
        success: true,
        data: {
          message: 'Token still valid',
          claudeAuth,
          refreshed: false,
        },
      });
      return;
    }

    // Refresh the token
    logger.info('Refreshing Claude OAuth token', { component: 'UserRoutes', userId: authReq.user!.id });
    const newClaudeAuth = await refreshClaudeToken(claudeAuth);

    // Update in database (encryption is automatic via Drizzle column type)
    await db
      .update(users)
      .set({ claudeAuth: newClaudeAuth })
      .where(eq(users.id, authReq.user!.id));

    logger.info('Claude OAuth token refreshed and saved', {
      component: 'UserRoutes',
      userId: authReq.user!.id,
      newExpiration: newClaudeAuth.expiresAt ? new Date(newClaudeAuth.expiresAt).toISOString() : 'unknown',
    });

    res.json({
      success: true,
      data: {
        message: 'Token refreshed successfully',
        claudeAuth: newClaudeAuth,
        refreshed: true,
      },
    });
  } catch (error: unknown) {
    logger.error('Failed to refresh Claude token', error as Error, { component: 'UserRoutes' });
    res.status(500).json({
      success: false,
      error: `Failed to refresh Claude token: ${(error as Error).message}`,
    });
  }
});

/**
 * @openapi
 * /api/user/claude-auth/credentials:
 *   get:
 *     tags: [User]
 *     summary: Get Claude credentials with auto-refresh
 *     description: Returns valid Claude credentials, automatically refreshing if needed
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Claude credentials returned
 *       400:
 *         description: No Claude authentication found
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/claude-auth/credentials', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Get current Claude auth from user
    const [user] = await db
      .select({ claudeAuth: users.claudeAuth })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!user?.claudeAuth) {
      res.status(400).json({
        success: false,
        error: 'No Claude authentication found for user',
      });
      return;
    }

    // Claude auth is automatically decrypted by Drizzle column type
    let claudeAuth = user.claudeAuth as ClaudeAuth;
    let wasRefreshed = false;

    // Auto-refresh if needed
    if (shouldRefreshClaudeToken(claudeAuth)) {
      logger.info('Token expiring soon, auto-refreshing', { component: 'UserRoutes', userId: authReq.user!.id });
      try {
        claudeAuth = await refreshClaudeToken(claudeAuth);
        wasRefreshed = true;

        // Update in database (encryption is automatic via Drizzle column type)
        await db
          .update(users)
          .set({ claudeAuth })
          .where(eq(users.id, authReq.user!.id));

        logger.info('Token auto-refreshed and saved', { component: 'UserRoutes' });
      } catch (refreshError: unknown) {
        logger.error('Auto-refresh failed', refreshError as Error, { component: 'UserRoutes' });
        // Return current token anyway, let the caller handle the error
      }
    }

    res.json({
      success: true,
      data: {
        claudeAuth,
        refreshed: wasRefreshed,
        expiresAt: claudeAuth.expiresAt,
        expiresIn: claudeAuth.expiresAt ? Math.max(0, claudeAuth.expiresAt - Date.now()) : 0,
      },
    });
  } catch (error: unknown) {
    logger.error('Failed to get Claude credentials', error as Error, { component: 'UserRoutes' });
    res.status(500).json({
      success: false,
      error: `Failed to get Claude credentials: ${(error as Error).message}`,
    });
  }
});

export default router;
