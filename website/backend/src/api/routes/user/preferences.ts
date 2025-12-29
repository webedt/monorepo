/**
 * User Preferences Routes
 * Handles user settings and preferences
 */

import { Router, Request, Response } from 'express';
import { db, users, eq } from '@webedt/shared';
// Note: Encryption/decryption is now automatic via Drizzle custom column types
import type { ImageAiKeysData } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';

const router = Router();

/**
 * @openapi
 * /api/user/preferred-provider:
 *   post:
 *     tags: [User]
 *     summary: Update preferred AI provider
 */
router.post('/preferred-provider', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { provider } = req.body;

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
 */
router.post('/image-resize-setting', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { maxDimension } = req.body;

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
 */
router.post('/display-name', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { displayName } = req.body;

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
router.post('/voice-command-keywords', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { keywords } = req.body;

    if (!Array.isArray(keywords)) {
      res.status(400).json({
        success: false,
        error: 'Keywords must be an array',
      });
      return;
    }

    const normalizedKeywords = keywords
      .filter((k: unknown): k is string => typeof k === 'string' && (k as string).trim().length > 0)
      .map((k: string) => k.trim().toLowerCase());

    const uniqueKeywords = [...new Set(normalizedKeywords)];

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
 */
router.post('/stop-listening-after-submit', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { stopAfterSubmit } = req.body;

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
 */
router.post('/default-landing-page', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { landingPage } = req.body;

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
 */
router.post('/preferred-model', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { preferredModel } = req.body;

    const validModels = ['', 'opus', 'sonnet'];
    if (preferredModel !== null && preferredModel !== undefined && !validModels.includes(preferredModel)) {
      res.status(400).json({
        success: false,
        error: 'Invalid preferred model. Must be one of: (empty), opus, sonnet',
      });
      return;
    }

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
router.post('/chat-verbosity', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { verbosityLevel } = req.body;

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
 */
router.post('/openrouter-api-key', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { apiKey } = req.body;

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
router.post('/autocomplete-settings', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { enabled, model } = req.body;

    const updates: { autocompleteEnabled?: boolean; autocompleteModel?: string } = {};

    if (typeof enabled === 'boolean') {
      updates.autocompleteEnabled = enabled;
    }

    if (model && typeof model === 'string') {
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
 */
router.post('/image-ai-keys', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { imageAiKeys } = req.body;

    if (!imageAiKeys || typeof imageAiKeys !== 'object') {
      res.status(400).json({
        success: false,
        error: 'Invalid imageAiKeys. Must be an object with provider keys.',
      });
      return;
    }

    const allowedProviders = ['openrouter', 'cometapi', 'google'] as const;
    const sanitizedKeys: ImageAiKeysData = {};
    for (const [provider, key] of Object.entries(imageAiKeys)) {
      if (allowedProviders.includes(provider as typeof allowedProviders[number]) && typeof key === 'string') {
        sanitizedKeys[provider as keyof ImageAiKeysData] = key;
      }
    }

    // Store the API keys (encryption is automatic via Drizzle column type)
    await db
      .update(users)
      .set({ imageAiKeys: sanitizedKeys })
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

export default router;
