/**
 * User Preferences Routes
 * Handles user settings and preferences
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db, users, eq, validateRequest } from '@webedt/shared';
// Note: Encryption/decryption is now automatic via Drizzle custom column types
import type { ImageAiKeysData } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';

// =============================================================================
// Validation Schemas
// =============================================================================

const preferredProviderSchema = {
  body: z.object({
    provider: z.enum(['claude', 'codex', 'copilot', 'gemini'], {
      errorMap: () => ({ message: 'Invalid provider. Must be one of: claude, codex, copilot, gemini' }),
    }),
  }),
};

const imageResizeSchema = {
  body: z.object({
    maxDimension: z.coerce.number().refine(
      (val) => [512, 1024, 2048, 4096, 8000].includes(val),
      { message: 'Invalid max dimension. Must be one of: 512, 1024, 2048, 4096, 8000' }
    ),
  }),
};

const displayNameSchema = {
  body: z.object({
    displayName: z.union([
      z.null(),
      z.literal(''),
      z.string().max(100, 'Display name must be 100 characters or less'),
    ]),
  }),
};

const voiceKeywordsSchema = {
  body: z.object({
    keywords: z.array(
      z.string().trim().min(1, 'Keywords cannot be empty')
    ).max(20, 'Maximum of 20 keywords allowed'),
  }),
};

const stopListeningSchema = {
  body: z.object({
    stopAfterSubmit: z.boolean({
      errorMap: () => ({ message: 'stopAfterSubmit must be a boolean' }),
    }),
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
    preferredModel: z.union([
      z.null(),
      z.literal(''),
      z.enum(['opus', 'sonnet']),
    ]).optional(),
  }),
};

const verbositySchema = {
  body: z.object({
    verbosityLevel: z.enum(['minimal', 'normal', 'verbose'], {
      errorMap: () => ({ message: 'Invalid verbosity level. Must be one of: minimal, normal, verbose' }),
    }),
  }),
};

const openrouterKeySchema = {
  body: z.object({
    apiKey: z.string().min(1, 'API key is required').refine(
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
    imageAiKeys: z.record(
      z.enum(['openrouter', 'cometapi', 'google']),
      z.string()
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

const router = Router();

/**
 * @openapi
 * /api/user/preferred-provider:
 *   post:
 *     tags: [User]
 *     summary: Update preferred AI provider
 */
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

/**
 * @openapi
 * /api/user/image-resize-setting:
 *   post:
 *     tags: [User]
 *     summary: Update image resize maximum dimension
 */
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

/**
 * @openapi
 * /api/user/display-name:
 *   post:
 *     tags: [User]
 *     summary: Update user display name
 */
router.post('/display-name', requireAuth, validateRequest(displayNameSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { displayName } = req.body;

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
 */
router.post('/voice-command-keywords', requireAuth, validateRequest(voiceKeywordsSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { keywords } = req.body;

    // Normalize keywords (already trimmed by schema, just lowercase and dedupe)
    const normalizedKeywords = (keywords as string[]).map((k) => k.toLowerCase());
    const uniqueKeywords = [...new Set(normalizedKeywords)] as string[];

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
 */
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

/**
 * @openapi
 * /api/user/default-landing-page:
 *   post:
 *     tags: [User]
 *     summary: Update default landing page
 */
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

/**
 * @openapi
 * /api/user/preferred-model:
 *   post:
 *     tags: [User]
 *     summary: Update preferred Claude model
 */
router.post('/preferred-model', requireAuth, validateRequest(preferredModelSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { preferredModel } = req.body;

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
 */
router.post('/chat-verbosity', requireAuth, validateRequest(verbositySchema), async (req: Request, res: Response) => {
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

/**
 * @openapi
 * /api/user/openrouter-api-key:
 *   post:
 *     tags: [User]
 *     summary: Update OpenRouter API key
 */
router.post('/openrouter-api-key', requireAuth, validateRequest(openrouterKeySchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { apiKey } = req.body;

    // Store the API key (encryption is automatic via Drizzle column type)
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

/**
 * @openapi
 * /api/user/openrouter-api-key:
 *   delete:
 *     tags: [User]
 *     summary: Remove OpenRouter API key
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
 */
router.post('/autocomplete-settings', requireAuth, validateRequest(autocompleteSettingsSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { enabled, model } = req.body;

    const updates: { autocompleteEnabled?: boolean; autocompleteModel?: string } = {};

    if (enabled !== undefined) {
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

/**
 * @openapi
 * /api/user/image-ai-keys:
 *   post:
 *     tags: [User]
 *     summary: Update image AI API keys
 */
router.post('/image-ai-keys', requireAuth, validateRequest(imageAiKeysSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { imageAiKeys } = req.body;

    // Store the API keys (encryption is automatic via Drizzle column type)
    await db
      .update(users)
      .set({ imageAiKeys: imageAiKeys as ImageAiKeysData })
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
 */
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

/**
 * @openapi
 * /api/user/image-ai-model:
 *   post:
 *     tags: [User]
 *     summary: Update image AI model preference
 */
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

export default router;
