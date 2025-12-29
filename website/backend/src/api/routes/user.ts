/**
 * User Routes
 * Handles user settings and preferences
 */

import { Router, Request, Response } from 'express';
import { db, users, eq } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { shouldRefreshClaudeToken, refreshClaudeToken, type ClaudeAuth } from '@webedt/shared';
import { logger } from '@webedt/shared';

const router = Router();

// Update Claude authentication
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

    // Update user with Claude auth
    await db
      .update(users)
      .set({ claudeAuth })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Claude authentication updated successfully' },
    });
  } catch (error) {
    logger.error('Update Claude auth error', error, { component: 'user', operation: 'updateClaudeAuth' });
    res.status(500).json({ success: false, error: 'Failed to update Claude authentication' });
  }
});

// Remove Claude authentication
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
    logger.error('Remove Claude auth error', error, { component: 'user', operation: 'removeClaudeAuth' });
    res.status(500).json({ success: false, error: 'Failed to remove Claude authentication' });
  }
});

// Refresh Claude OAuth token and update in database
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

    // Update in database
    await db
      .update(users)
      .set({ claudeAuth: newClaudeAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
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

// Get Claude credentials with auto-refresh (for autonomous workers)
// This endpoint refreshes the token if needed and returns valid credentials
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

    let claudeAuth = user.claudeAuth as ClaudeAuth;
    let wasRefreshed = false;

    // Auto-refresh if needed
    if (shouldRefreshClaudeToken(claudeAuth)) {
      logger.info('Token expiring soon, auto-refreshing', { component: 'UserRoutes', userId: authReq.user!.id });
      try {
        claudeAuth = await refreshClaudeToken(claudeAuth);
        wasRefreshed = true;

        // Update in database
        await db
          .update(users)
          .set({ claudeAuth: claudeAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
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

// Update Codex authentication (OpenAI)
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

    // Update user with Codex auth
    await db
      .update(users)
      .set({ codexAuth })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Codex authentication updated successfully' },
    });
  } catch (error) {
    logger.error('Update Codex auth error', error, { component: 'user', operation: 'updateCodexAuth' });
    res.status(500).json({ success: false, error: 'Failed to update Codex authentication' });
  }
});

// Remove Codex authentication
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
    logger.error('Remove Codex auth error', error, { component: 'user', operation: 'removeCodexAuth' });
    res.status(500).json({ success: false, error: 'Failed to remove Codex authentication' });
  }
});

// Update Gemini authentication (OAuth only - from ~/.gemini/oauth_creds.json)
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

    // Update user with Gemini auth
    await db
      .update(users)
      .set({ geminiAuth: normalizedAuth })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Gemini OAuth authentication updated successfully' },
    });
  } catch (error) {
    logger.error('Update Gemini auth error', error, { component: 'user', operation: 'updateGeminiAuth' });
    res.status(500).json({ success: false, error: 'Failed to update Gemini authentication' });
  }
});

// Remove Gemini authentication
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
    logger.error('Remove Gemini auth error', error, { component: 'user', operation: 'removeGeminiAuth' });
    res.status(500).json({ success: false, error: 'Failed to remove Gemini authentication' });
  }
});

// Update preferred AI provider
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
    logger.error('Update preferred provider error', error, { component: 'user', operation: 'updatePreferredProvider' });
    res.status(500).json({ success: false, error: 'Failed to update preferred provider' });
  }
});

// Update image resize max dimension
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
    logger.error('Update image resize setting error', error, { component: 'user', operation: 'updateImageResizeSetting' });
    res.status(500).json({ success: false, error: 'Failed to update image resize setting' });
  }
});

// Update display name
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
    logger.error('Update display name error', error, { component: 'user', operation: 'updateDisplayName' });
    res.status(500).json({ success: false, error: 'Failed to update display name' });
  }
});

// Update voice command keywords
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
    logger.error('Update voice command keywords error', error, { component: 'user', operation: 'updateVoiceCommandKeywords' });
    res.status(500).json({ success: false, error: 'Failed to update voice command keywords' });
  }
});

// Update stop listening after submit preference
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
    logger.error('Update stop listening after submit error', error, { component: 'user', operation: 'updateStopListeningAfterSubmit' });
    res.status(500).json({ success: false, error: 'Failed to update stop listening after submit preference' });
  }
});

// Update default landing page
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
    logger.error('Update default landing page error', error, { component: 'user', operation: 'updateDefaultLandingPage' });
    res.status(500).json({ success: false, error: 'Failed to update default landing page' });
  }
});

// Update preferred model
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
    logger.error('Update preferred model error', error, { component: 'user', operation: 'updatePreferredModel' });
    res.status(500).json({ success: false, error: 'Failed to update preferred model' });
  }
});

// Update chat verbosity level
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
    logger.error('Update chat verbosity level error', error, { component: 'user', operation: 'updateChatVerbosity' });
    res.status(500).json({ success: false, error: 'Failed to update chat verbosity level' });
  }
});

// Update OpenRouter API key (for autocomplete)
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

    await db
      .update(users)
      .set({ openrouterApiKey: apiKey })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'OpenRouter API key updated successfully' },
    });
  } catch (error) {
    logger.error('Update OpenRouter API key error', error, { component: 'user', operation: 'updateOpenRouterApiKey' });
    res.status(500).json({ success: false, error: 'Failed to update OpenRouter API key' });
  }
});

// Remove OpenRouter API key
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
    logger.error('Remove OpenRouter API key error', error, { component: 'user', operation: 'removeOpenRouterApiKey' });
    res.status(500).json({ success: false, error: 'Failed to remove OpenRouter API key' });
  }
});

// Update autocomplete settings
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
    logger.error('Update autocomplete settings error', error, { component: 'user', operation: 'updateAutocompleteSettings' });
    res.status(500).json({ success: false, error: 'Failed to update autocomplete settings' });
  }
});

// Update image AI API keys
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
    const allowedProviders = ['openrouter', 'cometapi', 'google'];
    const sanitizedKeys: Record<string, string> = {};
    for (const [provider, key] of Object.entries(imageAiKeys)) {
      if (allowedProviders.includes(provider) && typeof key === 'string') {
        sanitizedKeys[provider] = key;
      }
    }

    await db
      .update(users)
      .set({ imageAiKeys: sanitizedKeys })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Image AI keys updated successfully' },
    });
  } catch (error) {
    logger.error('Update image AI keys error', error, { component: 'user', operation: 'updateImageAiKeys' });
    res.status(500).json({ success: false, error: 'Failed to update image AI keys' });
  }
});

// Update image AI provider preference
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
    logger.error('Update image AI provider error', error, { component: 'user', operation: 'updateImageAiProvider' });
    res.status(500).json({ success: false, error: 'Failed to update image AI provider' });
  }
});

// Update image AI model preference
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
    logger.error('Update image AI model error', error, { component: 'user', operation: 'updateImageAiModel' });
    res.status(500).json({ success: false, error: 'Failed to update image AI model' });
  }
});

// Get spending limits configuration
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
    logger.error('Get spending limits error', error, { component: 'user', operation: 'getSpendingLimits' });
    res.status(500).json({ success: false, error: 'Failed to get spending limits' });
  }
});

// Update spending limits configuration
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
    logger.error('Update spending limits error', error, { component: 'user', operation: 'updateSpendingLimits' });
    res.status(500).json({ success: false, error: 'Failed to update spending limits' });
  }
});

// Reset current month spending (admin or scheduled job)
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
    logger.error('Reset spending error', error, { component: 'user', operation: 'resetSpending' });
    res.status(500).json({ success: false, error: 'Failed to reset spending' });
  }
});

export default router;
