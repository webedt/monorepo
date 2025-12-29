/**
 * User Routes
 * Handles user settings and preferences
 */

/**
 * @openapi
 * tags:
 *   - name: User
 *     description: User profile and settings management
 */

import { Router, Request, Response } from 'express';
import { db, users, eq } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { shouldRefreshClaudeToken, refreshClaudeToken, type ClaudeAuth } from '@webedt/shared';
import { logger } from '@webedt/shared';
import { encryptUserFields, decryptUserFields } from '@webedt/shared';
import type { ImageAiKeysData } from '@webedt/shared';

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

    // Update user with Claude auth (encrypted)
    const encryptedFields = encryptUserFields({ claudeAuth });
    await db
      .update(users)
      // Type assertion needed: encrypted fields may contain encrypted strings
      // where the schema expects JSON objects (when encryption is enabled)
      .set(encryptedFields as typeof users.$inferInsert)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Claude authentication updated successfully' },
    });
  } catch (error) {
    console.error('Update Claude auth error:', error);
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
    console.error('Remove Claude auth error:', error);
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

    // Decrypt the Claude auth data
    const decrypted = decryptUserFields({ claudeAuth: user.claudeAuth });
    const claudeAuth = decrypted.claudeAuth as ClaudeAuth;

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

    // Update in database (encrypted)
    const encryptedNewAuth = encryptUserFields({ claudeAuth: newClaudeAuth });
    await db
      .update(users)
      .set(encryptedNewAuth as typeof users.$inferInsert)
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
  } catch (error: any) {
    logger.error('Failed to refresh Claude token', error, { component: 'UserRoutes' });
    res.status(500).json({
      success: false,
      error: `Failed to refresh Claude token: ${error.message}`,
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

    // Decrypt the Claude auth data
    const decryptedAuth = decryptUserFields({ claudeAuth: user.claudeAuth });
    let claudeAuth = decryptedAuth.claudeAuth as ClaudeAuth;
    let wasRefreshed = false;

    // Auto-refresh if needed
    if (shouldRefreshClaudeToken(claudeAuth)) {
      logger.info('Token expiring soon, auto-refreshing', { component: 'UserRoutes', userId: authReq.user!.id });
      try {
        claudeAuth = await refreshClaudeToken(claudeAuth);
        wasRefreshed = true;

        // Update in database (encrypted)
        const encryptedAuth = encryptUserFields({ claudeAuth });
        await db
          .update(users)
          .set(encryptedAuth as typeof users.$inferInsert)
          .where(eq(users.id, authReq.user!.id));

        logger.info('Token auto-refreshed and saved', { component: 'UserRoutes' });
      } catch (refreshError: any) {
        logger.error('Auto-refresh failed', refreshError, { component: 'UserRoutes' });
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
  } catch (error: any) {
    logger.error('Failed to get Claude credentials', error, { component: 'UserRoutes' });
    res.status(500).json({
      success: false,
      error: `Failed to get Claude credentials: ${error.message}`,
    });
  }
});

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
    let codexAuth = req.body.codexAuth || req.body;

    // Validate Codex auth structure - must have either apiKey or accessToken
    if (!codexAuth || (!codexAuth.apiKey && !codexAuth.accessToken)) {
      res.status(400).json({
        success: false,
        error: 'Invalid Codex auth. Must include either apiKey or accessToken.',
      });
      return;
    }

    // Update user with Codex auth (encrypted)
    const encryptedCodexFields = encryptUserFields({ codexAuth });
    await db
      .update(users)
      .set(encryptedCodexFields as typeof users.$inferInsert)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Codex authentication updated successfully' },
    });
  } catch (error) {
    console.error('Update Codex auth error:', error);
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
    console.error('Remove Codex auth error:', error);
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
    let geminiAuth = req.body.geminiAuth || req.body;

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

    // Update user with Gemini auth (encrypted)
    const encryptedGeminiFields = encryptUserFields({ geminiAuth: normalizedAuth });
    await db
      .update(users)
      .set(encryptedGeminiFields as typeof users.$inferInsert)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Gemini OAuth authentication updated successfully' },
    });
  } catch (error) {
    console.error('Update Gemini auth error:', error);
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
    console.error('Remove Gemini auth error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove Gemini authentication' });
  }
});

/**
 * @openapi
 * /api/user/preferred-provider:
 *   post:
 *     tags: [User]
 *     summary: Update preferred AI provider
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [claude, codex, copilot, gemini]
 *     responses:
 *       200:
 *         description: Preferred provider updated successfully
 *       400:
 *         description: Invalid provider value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/preferred-provider', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { provider } = req.body;

    // Validate provider is one of the valid options
    const validProviders = ['claude', 'codex', 'copilot', 'gemini'];
    if (!validProviders.includes(provider)) {
      res.status(400).json({
        success: false,
        error: 'Invalid provider. Must be one of: claude, codex, copilot, gemini',
      });
      return;
    }

    await db
      .update(users)
      .set({ preferredProvider: provider })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Preferred provider updated successfully' },
    });
  } catch (error) {
    console.error('Update preferred provider error:', error);
    res.status(500).json({ success: false, error: 'Failed to update preferred provider' });
  }
});

/**
 * @openapi
 * /api/user/image-resize-setting:
 *   post:
 *     tags: [User]
 *     summary: Update image resize maximum dimension
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - maxDimension
 *             properties:
 *               maxDimension:
 *                 type: number
 *                 enum: [512, 1024, 2048, 4096, 8000]
 *     responses:
 *       200:
 *         description: Image resize setting updated successfully
 *       400:
 *         description: Invalid max dimension value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/image-resize-setting', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { maxDimension } = req.body;

    // Validate that maxDimension is a valid number
    const validDimensions = [512, 1024, 2048, 4096, 8000];
    if (!validDimensions.includes(maxDimension)) {
      res.status(400).json({
        success: false,
        error: 'Invalid max dimension. Must be one of: 512, 1024, 2048, 4096, 8000',
      });
      return;
    }

    await db
      .update(users)
      .set({ imageResizeMaxDimension: maxDimension })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Image resize setting updated successfully' },
    });
  } catch (error) {
    console.error('Update image resize setting error:', error);
    res.status(500).json({ success: false, error: 'Failed to update image resize setting' });
  }
});

/**
 * @openapi
 * /api/user/display-name:
 *   post:
 *     tags: [User]
 *     summary: Update user display name
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - displayName
 *             properties:
 *               displayName:
 *                 type: string
 *                 maxLength: 100
 *     responses:
 *       200:
 *         description: Display name updated successfully
 *       400:
 *         description: Invalid display name
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/display-name', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { displayName } = req.body;

    // Validate display name (optional field, but if provided should be reasonable)
    if (displayName !== null && displayName !== undefined && displayName !== '') {
      if (typeof displayName !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Display name must be a string',
        });
        return;
      }

      if (displayName.length > 100) {
        res.status(400).json({
          success: false,
          error: 'Display name must be 100 characters or less',
        });
        return;
      }
    }

    // Set to null if empty string
    const finalDisplayName = displayName === '' ? null : displayName;

    await db
      .update(users)
      .set({ displayName: finalDisplayName })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Display name updated successfully' },
    });
  } catch (error) {
    console.error('Update display name error:', error);
    res.status(500).json({ success: false, error: 'Failed to update display name' });
  }
});

/**
 * @openapi
 * /api/user/voice-command-keywords:
 *   post:
 *     tags: [User]
 *     summary: Update voice command keywords
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - keywords
 *             properties:
 *               keywords:
 *                 type: array
 *                 items:
 *                   type: string
 *                 maxItems: 20
 *     responses:
 *       200:
 *         description: Voice command keywords updated successfully
 *       400:
 *         description: Invalid keywords array
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/voice-command-keywords', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { keywords } = req.body;

    // Validate keywords is an array
    if (!Array.isArray(keywords)) {
      res.status(400).json({
        success: false,
        error: 'Keywords must be an array',
      });
      return;
    }

    // Validate all items are non-empty strings and normalize them
    const normalizedKeywords = keywords
      .filter((k: unknown): k is string => typeof k === 'string' && (k as string).trim().length > 0)
      .map((k: string) => k.trim().toLowerCase());

    // Remove duplicates
    const uniqueKeywords = [...new Set(normalizedKeywords)];

    // Limit to 20 keywords max
    if (uniqueKeywords.length > 20) {
      res.status(400).json({
        success: false,
        error: 'Maximum of 20 keywords allowed',
      });
      return;
    }

    await db
      .update(users)
      .set({ voiceCommandKeywords: uniqueKeywords })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Voice command keywords updated successfully', keywords: uniqueKeywords },
    });
  } catch (error) {
    console.error('Update voice command keywords error:', error);
    res.status(500).json({ success: false, error: 'Failed to update voice command keywords' });
  }
});

/**
 * @openapi
 * /api/user/stop-listening-after-submit:
 *   post:
 *     tags: [User]
 *     summary: Update stop listening after submit preference
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - stopAfterSubmit
 *             properties:
 *               stopAfterSubmit:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Preference updated successfully
 *       400:
 *         description: Invalid value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/stop-listening-after-submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { stopAfterSubmit } = req.body;

    // Validate boolean
    if (typeof stopAfterSubmit !== 'boolean') {
      res.status(400).json({
        success: false,
        error: 'stopAfterSubmit must be a boolean',
      });
      return;
    }

    await db
      .update(users)
      .set({ stopListeningAfterSubmit: stopAfterSubmit })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Stop listening after submit preference updated successfully' },
    });
  } catch (error) {
    console.error('Update stop listening after submit error:', error);
    res.status(500).json({ success: false, error: 'Failed to update stop listening after submit preference' });
  }
});

/**
 * @openapi
 * /api/user/default-landing-page:
 *   post:
 *     tags: [User]
 *     summary: Update default landing page
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - landingPage
 *             properties:
 *               landingPage:
 *                 type: string
 *                 enum: [store, library, community, sessions]
 *     responses:
 *       200:
 *         description: Default landing page updated successfully
 *       400:
 *         description: Invalid landing page value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/default-landing-page', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { landingPage } = req.body;

    // Validate landing page is one of the valid options
    const validPages = ['store', 'library', 'community', 'sessions'];
    if (!validPages.includes(landingPage)) {
      res.status(400).json({
        success: false,
        error: 'Invalid landing page. Must be one of: store, library, community, sessions',
      });
      return;
    }

    await db
      .update(users)
      .set({ defaultLandingPage: landingPage })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Default landing page updated successfully' },
    });
  } catch (error) {
    console.error('Update default landing page error:', error);
    res.status(500).json({ success: false, error: 'Failed to update default landing page' });
  }
});

/**
 * @openapi
 * /api/user/preferred-model:
 *   post:
 *     tags: [User]
 *     summary: Update preferred Claude model
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - preferredModel
 *             properties:
 *               preferredModel:
 *                 type: string
 *                 enum: ['', opus, sonnet]
 *     responses:
 *       200:
 *         description: Preferred model updated successfully
 *       400:
 *         description: Invalid model value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/preferred-model', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { preferredModel } = req.body;

    // Validate preferred model is one of the valid options or null/empty
    const validModels = ['', 'opus', 'sonnet'];
    if (preferredModel !== null && preferredModel !== undefined && !validModels.includes(preferredModel)) {
      res.status(400).json({
        success: false,
        error: 'Invalid preferred model. Must be one of: (empty), opus, sonnet',
      });
      return;
    }

    // Set to null if empty string
    const finalPreferredModel = preferredModel === '' ? null : preferredModel;

    await db
      .update(users)
      .set({ preferredModel: finalPreferredModel })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Preferred model updated successfully' },
    });
  } catch (error) {
    console.error('Update preferred model error:', error);
    res.status(500).json({ success: false, error: 'Failed to update preferred model' });
  }
});

/**
 * @openapi
 * /api/user/chat-verbosity:
 *   post:
 *     tags: [User]
 *     summary: Update chat verbosity level
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - verbosityLevel
 *             properties:
 *               verbosityLevel:
 *                 type: string
 *                 enum: [minimal, normal, verbose]
 *     responses:
 *       200:
 *         description: Chat verbosity level updated successfully
 *       400:
 *         description: Invalid verbosity level
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/chat-verbosity', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { verbosityLevel } = req.body;

    // Validate verbosity level is one of the valid options
    const validLevels = ['minimal', 'normal', 'verbose'];
    if (!validLevels.includes(verbosityLevel)) {
      res.status(400).json({
        success: false,
        error: 'Invalid verbosity level. Must be one of: minimal, normal, verbose',
      });
      return;
    }

    await db
      .update(users)
      .set({ chatVerbosityLevel: verbosityLevel })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Chat verbosity level updated successfully' },
    });
  } catch (error) {
    console.error('Update chat verbosity level error:', error);
    res.status(500).json({ success: false, error: 'Failed to update chat verbosity level' });
  }
});

/**
 * @openapi
 * /api/user/openrouter-api-key:
 *   post:
 *     tags: [User]
 *     summary: Update OpenRouter API key
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - apiKey
 *             properties:
 *               apiKey:
 *                 type: string
 *                 pattern: ^sk-or-
 *     responses:
 *       200:
 *         description: OpenRouter API key updated successfully
 *       400:
 *         description: Invalid API key format
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/openrouter-api-key', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { apiKey } = req.body;

    // Validate API key format (OpenRouter keys start with sk-or-)
    if (!apiKey || typeof apiKey !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Invalid API key. Must be a non-empty string.',
      });
      return;
    }

    if (!apiKey.startsWith('sk-or-')) {
      res.status(400).json({
        success: false,
        error: 'Invalid OpenRouter API key format. Keys should start with "sk-or-".',
      });
      return;
    }

    // Encrypt the API key before storing
    const encryptedApiKeyFields = encryptUserFields({ openrouterApiKey: apiKey });
    await db
      .update(users)
      .set(encryptedApiKeyFields as typeof users.$inferInsert)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'OpenRouter API key updated successfully' },
    });
  } catch (error) {
    console.error('Update OpenRouter API key error:', error);
    res.status(500).json({ success: false, error: 'Failed to update OpenRouter API key' });
  }
});

/**
 * @openapi
 * /api/user/openrouter-api-key:
 *   delete:
 *     tags: [User]
 *     summary: Remove OpenRouter API key
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: OpenRouter API key removed successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.delete('/openrouter-api-key', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    await db
      .update(users)
      .set({ openrouterApiKey: null })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'OpenRouter API key removed' },
    });
  } catch (error) {
    console.error('Remove OpenRouter API key error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove OpenRouter API key' });
  }
});

/**
 * @openapi
 * /api/user/autocomplete-settings:
 *   post:
 *     tags: [User]
 *     summary: Update autocomplete settings
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *               model:
 *                 type: string
 *                 enum: [openai/gpt-oss-120b:cerebras, openai/gpt-oss-120b, deepseek/deepseek-coder, anthropic/claude-3-haiku]
 *     responses:
 *       200:
 *         description: Autocomplete settings updated successfully
 *       400:
 *         description: Invalid settings
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/autocomplete-settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { enabled, model } = req.body;

    const updates: { autocompleteEnabled?: boolean; autocompleteModel?: string } = {};

    if (typeof enabled === 'boolean') {
      updates.autocompleteEnabled = enabled;
    }

    if (model && typeof model === 'string') {
      // Validate model is from allowed list
      const validModels = [
        'openai/gpt-oss-120b:cerebras',
        'openai/gpt-oss-120b',
        'deepseek/deepseek-coder',
        'anthropic/claude-3-haiku',
      ];
      if (!validModels.includes(model)) {
        res.status(400).json({
          success: false,
          error: `Invalid model. Must be one of: ${validModels.join(', ')}`,
        });
        return;
      }
      updates.autocompleteModel = model;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid settings to update',
      });
      return;
    }

    await db
      .update(users)
      .set(updates)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Autocomplete settings updated successfully' },
    });
  } catch (error) {
    console.error('Update autocomplete settings error:', error);
    res.status(500).json({ success: false, error: 'Failed to update autocomplete settings' });
  }
});

/**
 * @openapi
 * /api/user/image-ai-keys:
 *   post:
 *     tags: [User]
 *     summary: Update image AI API keys
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - imageAiKeys
 *             properties:
 *               imageAiKeys:
 *                 type: object
 *                 properties:
 *                   openrouter:
 *                     type: string
 *                   cometapi:
 *                     type: string
 *                   google:
 *                     type: string
 *     responses:
 *       200:
 *         description: Image AI keys updated successfully
 *       400:
 *         description: Invalid keys object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/image-ai-keys', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { imageAiKeys } = req.body;

    // Validate structure
    if (!imageAiKeys || typeof imageAiKeys !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid imageAiKeys. Must be an object with provider keys.',
      });
      return;
    }

    // Only allow known providers
    const allowedProviders = ['openrouter', 'cometapi', 'google'] as const;
    const sanitizedKeys: ImageAiKeysData = {};
    for (const [provider, key] of Object.entries(imageAiKeys)) {
      if (allowedProviders.includes(provider as typeof allowedProviders[number]) && typeof key === 'string') {
        sanitizedKeys[provider as keyof ImageAiKeysData] = key;
      }
    }

    // Encrypt the API keys before storing
    const encryptedImageAiFields = encryptUserFields({ imageAiKeys: sanitizedKeys });
    await db
      .update(users)
      .set(encryptedImageAiFields as typeof users.$inferInsert)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Image AI keys updated successfully' },
    });
  } catch (error) {
    console.error('Update image AI keys error:', error);
    res.status(500).json({ success: false, error: 'Failed to update image AI keys' });
  }
});

/**
 * @openapi
 * /api/user/image-ai-provider:
 *   post:
 *     tags: [User]
 *     summary: Update image AI provider preference
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - provider
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [openrouter, cometapi, google]
 *     responses:
 *       200:
 *         description: Image AI provider updated successfully
 *       400:
 *         description: Invalid provider value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/image-ai-provider', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { provider } = req.body;

    const validProviders = ['openrouter', 'cometapi', 'google'];
    if (!validProviders.includes(provider)) {
      res.status(400).json({
        success: false,
        error: 'Invalid provider. Must be one of: openrouter, cometapi, google',
      });
      return;
    }

    await db
      .update(users)
      .set({ imageAiProvider: provider })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Image AI provider updated successfully' },
    });
  } catch (error) {
    console.error('Update image AI provider error:', error);
    res.status(500).json({ success: false, error: 'Failed to update image AI provider' });
  }
});

/**
 * @openapi
 * /api/user/image-ai-model:
 *   post:
 *     tags: [User]
 *     summary: Update image AI model preference
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - model
 *             properties:
 *               model:
 *                 type: string
 *                 enum: [google/gemini-2.5-flash-image, google/gemini-3-pro-image-preview]
 *     responses:
 *       200:
 *         description: Image AI model updated successfully
 *       400:
 *         description: Invalid model value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/image-ai-model', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { model } = req.body;

    const validModels = ['google/gemini-2.5-flash-image', 'google/gemini-3-pro-image-preview'];
    if (!validModels.includes(model)) {
      res.status(400).json({
        success: false,
        error: 'Invalid model. Must be one of: google/gemini-2.5-flash-image, google/gemini-3-pro-image-preview',
      });
      return;
    }

    await db
      .update(users)
      .set({ imageAiModel: model })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Image AI model updated successfully' },
    });
  } catch (error) {
    console.error('Update image AI model error:', error);
    res.status(500).json({ success: false, error: 'Failed to update image AI model' });
  }
});

/**
 * @openapi
 * /api/user/spending-limits:
 *   get:
 *     tags: [User]
 *     summary: Get spending limits configuration
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Spending limits configuration returned
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/spending-limits', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const [user] = await db
      .select({
        spendingLimitEnabled: users.spendingLimitEnabled,
        monthlyBudgetCents: users.monthlyBudgetCents,
        perTransactionLimitCents: users.perTransactionLimitCents,
        spendingResetDay: users.spendingResetDay,
        currentMonthSpentCents: users.currentMonthSpentCents,
        spendingLimitAction: users.spendingLimitAction,
        spendingResetAt: users.spendingResetAt,
      })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Calculate remaining budget
    const monthlyBudget = Number(user.monthlyBudgetCents) || 0;
    const currentSpent = Number(user.currentMonthSpentCents) || 0;
    const remainingBudget = Math.max(0, monthlyBudget - currentSpent);
    const usagePercent = monthlyBudget > 0 ? (currentSpent / monthlyBudget) * 100 : 0;

    res.json({
      success: true,
      data: {
        enabled: user.spendingLimitEnabled,
        monthlyBudgetCents: user.monthlyBudgetCents,
        perTransactionLimitCents: user.perTransactionLimitCents,
        resetDay: user.spendingResetDay,
        currentMonthSpentCents: user.currentMonthSpentCents,
        remainingBudgetCents: String(remainingBudget),
        usagePercent: Math.round(usagePercent * 100) / 100,
        limitAction: user.spendingLimitAction,
        lastResetAt: user.spendingResetAt?.toISOString() || null,
      },
    });
  } catch (error) {
    console.error('Get spending limits error:', error);
    res.status(500).json({ success: false, error: 'Failed to get spending limits' });
  }
});

/**
 * @openapi
 * /api/user/spending-limits:
 *   post:
 *     tags: [User]
 *     summary: Update spending limits configuration
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *               monthlyBudgetCents:
 *                 type: string
 *               perTransactionLimitCents:
 *                 type: string
 *               resetDay:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 31
 *               limitAction:
 *                 type: string
 *                 enum: [warn, block]
 *     responses:
 *       200:
 *         description: Spending limits updated successfully
 *       400:
 *         description: Invalid settings
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/spending-limits', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { enabled, monthlyBudgetCents, perTransactionLimitCents, resetDay, limitAction } = req.body;

    const updates: {
      spendingLimitEnabled?: boolean;
      monthlyBudgetCents?: string;
      perTransactionLimitCents?: string;
      spendingResetDay?: number;
      spendingLimitAction?: string;
    } = {};

    // Validate and set enabled flag
    if (typeof enabled === 'boolean') {
      updates.spendingLimitEnabled = enabled;
    }

    // Validate and set monthly budget (in cents)
    if (monthlyBudgetCents !== undefined) {
      const budget = Number(monthlyBudgetCents);
      if (isNaN(budget) || budget < 0) {
        res.status(400).json({
          success: false,
          error: 'Monthly budget must be a non-negative number',
        });
        return;
      }
      updates.monthlyBudgetCents = String(Math.round(budget));
    }

    // Validate and set per-transaction limit (in cents)
    if (perTransactionLimitCents !== undefined) {
      const limit = Number(perTransactionLimitCents);
      if (isNaN(limit) || limit < 0) {
        res.status(400).json({
          success: false,
          error: 'Per-transaction limit must be a non-negative number',
        });
        return;
      }
      updates.perTransactionLimitCents = String(Math.round(limit));
    }

    // Validate and set reset day (1-31)
    if (resetDay !== undefined) {
      const day = Number(resetDay);
      if (isNaN(day) || day < 1 || day > 31) {
        res.status(400).json({
          success: false,
          error: 'Reset day must be between 1 and 31',
        });
        return;
      }
      updates.spendingResetDay = day;
    }

    // Validate and set limit action
    if (limitAction !== undefined) {
      const validActions = ['warn', 'block'];
      if (!validActions.includes(limitAction)) {
        res.status(400).json({
          success: false,
          error: 'Limit action must be one of: warn, block',
        });
        return;
      }
      updates.spendingLimitAction = limitAction;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid settings to update',
      });
      return;
    }

    await db
      .update(users)
      .set(updates)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Spending limits updated successfully' },
    });
  } catch (error) {
    console.error('Update spending limits error:', error);
    res.status(500).json({ success: false, error: 'Failed to update spending limits' });
  }
});

/**
 * @openapi
 * /api/user/spending-limits/reset:
 *   post:
 *     tags: [User]
 *     summary: Reset current month spending
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Monthly spending reset successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/spending-limits/reset', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    await db
      .update(users)
      .set({
        currentMonthSpentCents: '0',
        spendingResetAt: new Date(),
      })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Monthly spending reset successfully' },
    });
  } catch (error) {
    console.error('Reset spending error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset spending' });
  }
});

export default router;
