/**
 * User Routes
 * Handles user settings and preferences
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, users, eq, validateRequest } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { shouldRefreshClaudeToken, refreshClaudeToken, type ClaudeAuth } from '@webedt/shared';
import { logger } from '@webedt/shared';

// ============================================================================
// Validation Schemas
// ============================================================================

const claudeAuthSchema = {
  body: z.object({
    claudeAuth: z.object({
      accessToken: z.string().min(1, 'accessToken is required'),
      refreshToken: z.string().min(1, 'refreshToken is required'),
      expiresAt: z.number().optional(),
    }).optional(),
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
    claudeAiOauth: z.object({
      accessToken: z.string(),
      refreshToken: z.string(),
    }).optional(),
  }).refine(
    (data) => {
      // At least one valid format must be present
      const hasClaudeAuth = data.claudeAuth?.accessToken && data.claudeAuth?.refreshToken;
      const hasDirectTokens = data.accessToken && data.refreshToken;
      const hasClaudeAiOauth = data.claudeAiOauth?.accessToken && data.claudeAiOauth?.refreshToken;
      return hasClaudeAuth || hasDirectTokens || hasClaudeAiOauth;
    },
    { message: 'Invalid Claude auth. Must include accessToken and refreshToken.' }
  ),
};

const codexAuthSchema = {
  body: z.object({
    codexAuth: z.object({
      apiKey: z.string().optional(),
      accessToken: z.string().optional(),
    }).optional(),
    apiKey: z.string().optional(),
    accessToken: z.string().optional(),
  }).refine(
    (data) => {
      const hasApiKey = data.codexAuth?.apiKey || data.apiKey;
      const hasAccessToken = data.codexAuth?.accessToken || data.accessToken;
      return hasApiKey || hasAccessToken;
    },
    { message: 'Invalid Codex auth. Must include either apiKey or accessToken.' }
  ),
};

const geminiAuthSchema = {
  body: z.object({
    geminiAuth: z.object({
      accessToken: z.string().optional(),
      access_token: z.string().optional(),
      refreshToken: z.string().optional(),
      refresh_token: z.string().optional(),
    }).optional(),
    accessToken: z.string().optional(),
    access_token: z.string().optional(),
    refreshToken: z.string().optional(),
    refresh_token: z.string().optional(),
  }).refine(
    (data) => {
      const accessToken = data.geminiAuth?.accessToken || data.geminiAuth?.access_token || data.accessToken || data.access_token;
      const refreshToken = data.geminiAuth?.refreshToken || data.geminiAuth?.refresh_token || data.refreshToken || data.refresh_token;
      return accessToken && refreshToken;
    },
    { message: 'Invalid Gemini auth. Must include OAuth tokens (accessToken/access_token and refreshToken/refresh_token).' }
  ),
};

const preferredProviderSchema = {
  body: z.object({
    provider: z.enum(['claude', 'codex', 'copilot', 'gemini'], {
      errorMap: () => ({ message: 'Invalid provider. Must be one of: claude, codex, copilot, gemini' }),
    }),
  }),
};

const imageResizeSchema = {
  body: z.object({
    maxDimension: z.enum(['512', '1024', '2048', '4096', '8000'] as const).transform(Number).or(
      z.literal(512).or(z.literal(1024)).or(z.literal(2048)).or(z.literal(4096)).or(z.literal(8000))
    ),
  }),
};

const displayNameSchema = {
  body: z.object({
    displayName: z.string().max(100, 'Display name must be 100 characters or less').nullable().optional(),
  }),
};

const voiceKeywordsSchema = {
  body: z.object({
    keywords: z.array(z.string()).max(20, 'Maximum of 20 keywords allowed'),
  }),
};

const stopListeningSchema = {
  body: z.object({
    stopAfterSubmit: z.boolean({ required_error: 'stopAfterSubmit must be a boolean' }),
  }),
};

const landingPageSchema = {
  body: z.object({
    landingPage: z.enum(['store', 'library', 'community', 'sessions'], {
      errorMap: () => ({ message: 'Invalid landing page. Must be one of: store, library, community, sessions' }),
    }),
  }),
};

const preferredModelSchema = {
  body: z.object({
    preferredModel: z.enum(['', 'opus', 'sonnet']).nullable().optional(),
  }),
};

const chatVerbositySchema = {
  body: z.object({
    verbosityLevel: z.enum(['minimal', 'normal', 'verbose'], {
      errorMap: () => ({ message: 'Invalid verbosity level. Must be one of: minimal, normal, verbose' }),
    }),
  }),
};

const openrouterApiKeySchema = {
  body: z.object({
    apiKey: z.string().min(1, 'Invalid API key. Must be a non-empty string.').refine(
      (val) => val.startsWith('sk-or-'),
      { message: 'Invalid OpenRouter API key format. Keys should start with "sk-or-".' }
    ),
  }),
};

const autocompleteSettingsSchema = {
  body: z.object({
    enabled: z.boolean().optional(),
    model: z.enum([
      'openai/gpt-oss-120b:cerebras',
      'openai/gpt-oss-120b',
      'deepseek/deepseek-coder',
      'anthropic/claude-3-haiku',
    ]).optional(),
  }).refine(
    (data) => data.enabled !== undefined || data.model !== undefined,
    { message: 'No valid settings to update' }
  ),
};

const imageAiKeysSchema = {
  body: z.object({
    imageAiKeys: z.record(z.string()).refine(
      (keys) => {
        const allowedProviders = ['openrouter', 'cometapi', 'google'];
        return Object.keys(keys).every((k) => allowedProviders.includes(k));
      },
      { message: 'Invalid imageAiKeys. Only allowed providers: openrouter, cometapi, google' }
    ),
  }),
};

const imageAiProviderSchema = {
  body: z.object({
    provider: z.enum(['openrouter', 'cometapi', 'google'], {
      errorMap: () => ({ message: 'Invalid provider. Must be one of: openrouter, cometapi, google' }),
    }),
  }),
};

const imageAiModelSchema = {
  body: z.object({
    model: z.enum(['google/gemini-2.5-flash-image', 'google/gemini-3-pro-image-preview'], {
      errorMap: () => ({ message: 'Invalid model. Must be one of: google/gemini-2.5-flash-image, google/gemini-3-pro-image-preview' }),
    }),
  }),
};

const spendingLimitsSchema = {
  body: z.object({
    enabled: z.boolean().optional(),
    monthlyBudgetCents: z.number().nonnegative('Monthly budget must be a non-negative number').optional(),
    perTransactionLimitCents: z.number().nonnegative('Per-transaction limit must be a non-negative number').optional(),
    resetDay: z.number().int().min(1).max(31, 'Reset day must be between 1 and 31').optional(),
    limitAction: z.enum(['warn', 'block']).optional(),
  }).refine(
    (data) => Object.keys(data).length > 0,
    { message: 'No valid settings to update' }
  ),
};

const router = Router();

// Update Claude authentication
router.post('/claude-auth', requireAuth, validateRequest(claudeAuthSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    let claudeAuth = req.body.claudeAuth || req.body;

    // Handle wrapped format: extract from claudeAiOauth if present
    if (claudeAuth.claudeAiOauth) {
      claudeAuth = claudeAuth.claudeAiOauth;
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
    console.error('Update Claude auth error:', error);
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
    console.error('Remove Claude auth error:', error);
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
router.post('/codex-auth', requireAuth, validateRequest(codexAuthSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    let codexAuth = req.body.codexAuth || req.body;

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
    console.error('Update Codex auth error:', error);
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
    console.error('Remove Codex auth error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove Codex authentication' });
  }
});

// Update Gemini authentication (OAuth only - from ~/.gemini/oauth_creds.json)
router.post('/gemini-auth', requireAuth, validateRequest(geminiAuthSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    let geminiAuth = req.body.geminiAuth || req.body;

    // Support both camelCase (our format) and snake_case (Gemini CLI format)
    const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
    const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;
    const expiresAt = geminiAuth.expiresAt || geminiAuth.expiry_date;

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
    console.error('Update Gemini auth error:', error);
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
    console.error('Remove Gemini auth error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove Gemini authentication' });
  }
});

// Update preferred AI provider
router.post('/preferred-provider', requireAuth, validateRequest(preferredProviderSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { provider } = req.body;

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

// Update image resize max dimension
router.post('/image-resize-setting', requireAuth, validateRequest(imageResizeSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { maxDimension } = req.body;

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

// Update display name
router.post('/display-name', requireAuth, validateRequest(displayNameSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { displayName } = req.body;

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

// Update voice command keywords
router.post('/voice-command-keywords', requireAuth, validateRequest(voiceKeywordsSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { keywords } = req.body;

    // Normalize: trim, lowercase, and remove duplicates
    const normalizedKeywords: string[] = keywords
      .filter((k: string): k is string => typeof k === 'string' && k.trim().length > 0)
      .map((k: string) => k.trim().toLowerCase());
    const uniqueKeywords: string[] = [...new Set(normalizedKeywords)];

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

// Update stop listening after submit preference
router.post('/stop-listening-after-submit', requireAuth, validateRequest(stopListeningSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { stopAfterSubmit } = req.body;

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

// Update default landing page
router.post('/default-landing-page', requireAuth, validateRequest(landingPageSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { landingPage } = req.body;

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

// Update preferred model
router.post('/preferred-model', requireAuth, validateRequest(preferredModelSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { preferredModel } = req.body;

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

// Update chat verbosity level
router.post('/chat-verbosity', requireAuth, validateRequest(chatVerbositySchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { verbosityLevel } = req.body;

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

// Update OpenRouter API key (for autocomplete)
router.post('/openrouter-api-key', requireAuth, validateRequest(openrouterApiKeySchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { apiKey } = req.body;

    await db
      .update(users)
      .set({ openrouterApiKey: apiKey })
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
    console.error('Remove OpenRouter API key error:', error);
    res.status(500).json({ success: false, error: 'Failed to remove OpenRouter API key' });
  }
});

// Update autocomplete settings
router.post('/autocomplete-settings', requireAuth, validateRequest(autocompleteSettingsSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { enabled, model } = req.body;

    const updates: { autocompleteEnabled?: boolean; autocompleteModel?: string } = {};

    if (typeof enabled === 'boolean') {
      updates.autocompleteEnabled = enabled;
    }

    if (model) {
      updates.autocompleteModel = model;
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

// Update image AI API keys
router.post('/image-ai-keys', requireAuth, validateRequest(imageAiKeysSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { imageAiKeys } = req.body;

    await db
      .update(users)
      .set({ imageAiKeys })
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

// Update image AI provider preference
router.post('/image-ai-provider', requireAuth, validateRequest(imageAiProviderSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { provider } = req.body;

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

// Update image AI model preference
router.post('/image-ai-model', requireAuth, validateRequest(imageAiModelSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { model } = req.body;

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
    console.error('Get spending limits error:', error);
    res.status(500).json({ success: false, error: 'Failed to get spending limits' });
  }
});

// Update spending limits configuration
router.post('/spending-limits', requireAuth, validateRequest(spendingLimitsSchema), async (req: Request, res: Response) => {
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

    if (typeof enabled === 'boolean') {
      updates.spendingLimitEnabled = enabled;
    }

    if (monthlyBudgetCents !== undefined) {
      updates.monthlyBudgetCents = String(Math.round(monthlyBudgetCents));
    }

    if (perTransactionLimitCents !== undefined) {
      updates.perTransactionLimitCents = String(Math.round(perTransactionLimitCents));
    }

    if (resetDay !== undefined) {
      updates.spendingResetDay = resetDay;
    }

    if (limitAction !== undefined) {
      updates.spendingLimitAction = limitAction;
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
    console.error('Reset spending error:', error);
    res.status(500).json({ success: false, error: 'Failed to reset spending' });
  }
});

export default router;
