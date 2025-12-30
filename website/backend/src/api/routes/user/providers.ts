/**
 * User AI Providers Routes
 * Handles Codex (OpenAI) and Gemini authentication management
 */

import { Router, Request, Response } from 'express';
import { db, users, eq, logger } from '@webedt/shared';
// Note: Encryption/decryption is now automatic via Drizzle custom column types
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';

const router = Router();

/**
 * @openapi
 * /api/user/codex-auth:
 *   post:
 *     tags: [User]
 *     summary: Update Codex (OpenAI) authentication credentials
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               apiKey:
 *                 type: string
 *               accessToken:
 *                 type: string
 *     responses:
 *       200:
 *         description: Codex authentication updated successfully
 *       400:
 *         description: Invalid Codex auth credentials
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/codex-auth', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const codexAuth = req.body.codexAuth || req.body;

    // Validate Codex auth structure - must have either apiKey or accessToken
    if (!codexAuth || (!codexAuth.apiKey && !codexAuth.accessToken)) {
      res.status(400).json({
        success: false,
        error: 'Invalid Codex auth. Must include either apiKey or accessToken.',
      });
      return;
    }

    // Update user with Codex auth (encryption is automatic via Drizzle column type)
    await db
      .update(users)
      .set({ codexAuth })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Codex authentication updated successfully' },
    });
  } catch (error) {
    logger.error('Update Codex auth error', error as Error, {
      component: 'UserProvidersRoutes',
      operation: 'updateCodexAuth',
    });
    res.status(500).json({ success: false, error: 'Failed to update Codex authentication' });
  }
});

/**
 * @openapi
 * /api/user/codex-auth:
 *   delete:
 *     tags: [User]
 *     summary: Remove Codex authentication credentials
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Codex authentication removed successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/codex-auth', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    await db
      .update(users)
      .set({ codexAuth: null })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Codex authentication removed' },
    });
  } catch (error) {
    logger.error('Remove Codex auth error', error as Error, {
      component: 'UserProvidersRoutes',
      operation: 'removeCodexAuth',
    });
    res.status(500).json({ success: false, error: 'Failed to remove Codex authentication' });
  }
});

/**
 * @openapi
 * /api/user/gemini-auth:
 *   post:
 *     tags: [User]
 *     summary: Update Gemini OAuth authentication credentials
 *     description: Accepts OAuth credentials from ~/.gemini/oauth_creds.json
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
 *               expiresAt:
 *                 type: number
 *               tokenType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Gemini authentication updated successfully
 *       400:
 *         description: Invalid Gemini auth credentials
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/gemini-auth', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const geminiAuth = req.body.geminiAuth || req.body;

    // Support both camelCase (our format) and snake_case (Gemini CLI format)
    const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
    const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;
    const expiresAt = geminiAuth.expiresAt || geminiAuth.expiry_date;

    // Validate OAuth credentials are present
    if (!accessToken || !refreshToken) {
      res.status(400).json({
        success: false,
        error: 'Invalid Gemini auth. Must include OAuth tokens (accessToken/access_token and refreshToken/refresh_token). Run `gemini auth login` locally and paste the contents of ~/.gemini/oauth_creds.json',
      });
      return;
    }

    // Normalize the auth object to our format
    const normalizedAuth = {
      accessToken,
      refreshToken,
      expiresAt: expiresAt || Date.now() + 3600000, // Default 1 hour if not provided
      tokenType: geminiAuth.tokenType || geminiAuth.token_type || 'Bearer',
      scope: geminiAuth.scope,
    };

    // Update user with Gemini auth (encryption is automatic via Drizzle column type)
    await db
      .update(users)
      .set({ geminiAuth: normalizedAuth })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Gemini OAuth authentication updated successfully' },
    });
  } catch (error) {
    logger.error('Update Gemini auth error', error as Error, {
      component: 'UserProvidersRoutes',
      operation: 'updateGeminiAuth',
    });
    res.status(500).json({ success: false, error: 'Failed to update Gemini authentication' });
  }
});

/**
 * @openapi
 * /api/user/gemini-auth:
 *   delete:
 *     tags: [User]
 *     summary: Remove Gemini authentication credentials
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Gemini authentication removed successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/gemini-auth', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    await db
      .update(users)
      .set({ geminiAuth: null })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Gemini authentication removed' },
    });
  } catch (error) {
    logger.error('Remove Gemini auth error', error as Error, {
      component: 'UserProvidersRoutes',
      operation: 'removeGeminiAuth',
    });
    res.status(500).json({ success: false, error: 'Failed to remove Gemini authentication' });
  }
});

export default router;
