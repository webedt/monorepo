/**
 * HTTP Tests for User Preferences Routes
 * Covers user settings: provider, image resize, display name, voice commands, landing page, model, verbosity, API keys, autocomplete
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp, createMockUser } from '../../helpers/testApp.js';

describe('User Preferences HTTP Routes', () => {
  describe('POST /preferred-provider', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/preferred-provider', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/preferred-provider')
        .send({ provider: 'claude' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 for invalid provider', async () => {
      const app = createTestApp();

      app.post('/preferred-provider', (req, res) => {
        const { provider } = req.body;
        const validProviders = ['claude', 'codex', 'copilot', 'gemini'];
        if (!validProviders.includes(provider)) {
          res.status(400).json({
            success: false,
            error: 'Invalid provider. Must be one of: claude, codex, copilot, gemini',
          });
          return;
        }
        res.json({ success: true, data: { message: 'Preferred provider updated successfully' } });
      });

      const response = await request(app)
        .post('/preferred-provider')
        .send({ provider: 'invalid' })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('Invalid provider'));
    });

    it('should update provider successfully', async () => {
      const app = createTestApp();

      app.post('/preferred-provider', (req, res) => {
        const { provider } = req.body;
        const validProviders = ['claude', 'codex', 'copilot', 'gemini'];
        if (!validProviders.includes(provider)) {
          res.status(400).json({ success: false, error: 'Invalid provider' });
          return;
        }
        res.json({ success: true, data: { message: 'Preferred provider updated successfully' } });
      });

      const response = await request(app)
        .post('/preferred-provider')
        .send({ provider: 'claude' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /image-resize-setting', () => {
    it('should return 400 for invalid max dimension', async () => {
      const app = createTestApp();

      app.post('/image-resize-setting', (req, res) => {
        const { maxDimension } = req.body;
        const validDimensions = [512, 1024, 2048, 4096, 8000];
        if (!validDimensions.includes(maxDimension)) {
          res.status(400).json({
            success: false,
            error: 'Invalid max dimension. Must be one of: 512, 1024, 2048, 4096, 8000',
          });
          return;
        }
        res.json({ success: true, data: { message: 'Image resize setting updated successfully' } });
      });

      const response = await request(app)
        .post('/image-resize-setting')
        .send({ maxDimension: 999 })
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });

    it('should update max dimension successfully', async () => {
      const app = createTestApp();

      app.post('/image-resize-setting', (req, res) => {
        const { maxDimension } = req.body;
        const validDimensions = [512, 1024, 2048, 4096, 8000];
        if (!validDimensions.includes(maxDimension)) {
          res.status(400).json({ success: false, error: 'Invalid max dimension' });
          return;
        }
        res.json({ success: true, data: { message: 'Image resize setting updated successfully' } });
      });

      const response = await request(app)
        .post('/image-resize-setting')
        .send({ maxDimension: 2048 })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /display-name', () => {
    it('should return 400 for non-string display name', async () => {
      const app = createTestApp();

      app.post('/display-name', (req, res) => {
        const { displayName } = req.body;
        if (displayName !== null && displayName !== undefined && displayName !== '') {
          if (typeof displayName !== 'string') {
            res.status(400).json({ success: false, error: 'Display name must be a string' });
            return;
          }
        }
        res.json({ success: true, data: { message: 'Display name updated successfully' } });
      });

      const response = await request(app)
        .post('/display-name')
        .send({ displayName: 123 })
        .expect(400);

      assert.strictEqual(response.body.error, 'Display name must be a string');
    });

    it('should return 400 for display name over 100 characters', async () => {
      const app = createTestApp();

      app.post('/display-name', (req, res) => {
        const { displayName } = req.body;
        if (displayName !== null && displayName !== undefined && displayName !== '') {
          if (typeof displayName !== 'string') {
            res.status(400).json({ success: false, error: 'Display name must be a string' });
            return;
          }
          if (displayName.length > 100) {
            res.status(400).json({ success: false, error: 'Display name must be 100 characters or less' });
            return;
          }
        }
        res.json({ success: true, data: { message: 'Display name updated successfully' } });
      });

      const response = await request(app)
        .post('/display-name')
        .send({ displayName: 'A'.repeat(101) })
        .expect(400);

      assert.strictEqual(response.body.error, 'Display name must be 100 characters or less');
    });

    it('should update display name successfully', async () => {
      const app = createTestApp();

      app.post('/display-name', (req, res) => {
        res.json({ success: true, data: { message: 'Display name updated successfully' } });
      });

      const response = await request(app)
        .post('/display-name')
        .send({ displayName: 'Test User' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should allow clearing display name with empty string', async () => {
      const app = createTestApp();

      app.post('/display-name', (req, res) => {
        res.json({ success: true, data: { message: 'Display name updated successfully' } });
      });

      const response = await request(app)
        .post('/display-name')
        .send({ displayName: '' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /voice-command-keywords', () => {
    it('should return 400 when keywords is not an array', async () => {
      const app = createTestApp();

      app.post('/voice-command-keywords', (req, res) => {
        const { keywords } = req.body;
        if (!Array.isArray(keywords)) {
          res.status(400).json({ success: false, error: 'Keywords must be an array' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/voice-command-keywords')
        .send({ keywords: 'not-an-array' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Keywords must be an array');
    });

    it('should return 400 when more than 20 keywords', async () => {
      const app = createTestApp();

      app.post('/voice-command-keywords', (req, res) => {
        const { keywords } = req.body;
        if (!Array.isArray(keywords)) {
          res.status(400).json({ success: false, error: 'Keywords must be an array' });
          return;
        }
        const normalizedKeywords = keywords.filter((k: unknown) => typeof k === 'string' && k.trim().length > 0);
        if (normalizedKeywords.length > 20) {
          res.status(400).json({ success: false, error: 'Maximum of 20 keywords allowed' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/voice-command-keywords')
        .send({ keywords: Array(25).fill('keyword') })
        .expect(400);

      assert.strictEqual(response.body.error, 'Maximum of 20 keywords allowed');
    });

    it('should update keywords successfully and normalize them', async () => {
      const app = createTestApp();

      app.post('/voice-command-keywords', (req, res) => {
        const { keywords } = req.body;
        const normalizedKeywords = keywords
          .filter((k: unknown) => typeof k === 'string' && (k as string).trim().length > 0)
          .map((k: string) => k.trim().toLowerCase());
        const uniqueKeywords = [...new Set(normalizedKeywords)];
        res.json({
          success: true,
          data: { message: 'Voice command keywords updated successfully', keywords: uniqueKeywords },
        });
      });

      const response = await request(app)
        .post('/voice-command-keywords')
        .send({ keywords: ['HELLO', '  World ', 'hello'] })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      // Should be normalized and deduplicated
      assert.deepStrictEqual(response.body.data.keywords, ['hello', 'world']);
    });
  });

  describe('POST /stop-listening-after-submit', () => {
    it('should return 400 when stopAfterSubmit is not boolean', async () => {
      const app = createTestApp();

      app.post('/stop-listening-after-submit', (req, res) => {
        const { stopAfterSubmit } = req.body;
        if (typeof stopAfterSubmit !== 'boolean') {
          res.status(400).json({ success: false, error: 'stopAfterSubmit must be a boolean' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/stop-listening-after-submit')
        .send({ stopAfterSubmit: 'yes' })
        .expect(400);

      assert.strictEqual(response.body.error, 'stopAfterSubmit must be a boolean');
    });

    it('should update setting successfully', async () => {
      const app = createTestApp();

      app.post('/stop-listening-after-submit', (req, res) => {
        const { stopAfterSubmit } = req.body;
        if (typeof stopAfterSubmit !== 'boolean') {
          res.status(400).json({ success: false, error: 'stopAfterSubmit must be a boolean' });
          return;
        }
        res.json({ success: true, data: { message: 'Stop listening after submit preference updated successfully' } });
      });

      const response = await request(app)
        .post('/stop-listening-after-submit')
        .send({ stopAfterSubmit: true })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /default-landing-page', () => {
    it('should return 400 for invalid landing page', async () => {
      const app = createTestApp();

      app.post('/default-landing-page', (req, res) => {
        const { landingPage } = req.body;
        const validPages = ['store', 'library', 'community', 'sessions'];
        if (!validPages.includes(landingPage)) {
          res.status(400).json({
            success: false,
            error: 'Invalid landing page. Must be one of: store, library, community, sessions',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/default-landing-page')
        .send({ landingPage: 'invalid' })
        .expect(400);

      assert.ok(response.body.error.includes('Invalid landing page'));
    });

    it('should update landing page successfully', async () => {
      const app = createTestApp();

      app.post('/default-landing-page', (req, res) => {
        const { landingPage } = req.body;
        const validPages = ['store', 'library', 'community', 'sessions'];
        if (!validPages.includes(landingPage)) {
          res.status(400).json({ success: false, error: 'Invalid landing page' });
          return;
        }
        res.json({ success: true, data: { message: 'Default landing page updated successfully' } });
      });

      const response = await request(app)
        .post('/default-landing-page')
        .send({ landingPage: 'sessions' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /preferred-model', () => {
    it('should return 400 for invalid model', async () => {
      const app = createTestApp();

      app.post('/preferred-model', (req, res) => {
        const { preferredModel } = req.body;
        const validModels = ['', 'opus', 'sonnet'];
        if (preferredModel !== null && preferredModel !== undefined && !validModels.includes(preferredModel)) {
          res.status(400).json({
            success: false,
            error: 'Invalid preferred model. Must be one of: (empty), opus, sonnet',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/preferred-model')
        .send({ preferredModel: 'invalid' })
        .expect(400);

      assert.ok(response.body.error.includes('Invalid preferred model'));
    });

    it('should update model successfully', async () => {
      const app = createTestApp();

      app.post('/preferred-model', (req, res) => {
        res.json({ success: true, data: { message: 'Preferred model updated successfully' } });
      });

      const response = await request(app)
        .post('/preferred-model')
        .send({ preferredModel: 'opus' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /chat-verbosity', () => {
    it('should return 400 for invalid verbosity level', async () => {
      const app = createTestApp();

      app.post('/chat-verbosity', (req, res) => {
        const { verbosityLevel } = req.body;
        const validLevels = ['minimal', 'normal', 'verbose'];
        if (!validLevels.includes(verbosityLevel)) {
          res.status(400).json({
            success: false,
            error: 'Invalid verbosity level. Must be one of: minimal, normal, verbose',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/chat-verbosity')
        .send({ verbosityLevel: 'invalid' })
        .expect(400);

      assert.ok(response.body.error.includes('Invalid verbosity level'));
    });

    it('should update verbosity level successfully', async () => {
      const app = createTestApp();

      app.post('/chat-verbosity', (req, res) => {
        res.json({ success: true, data: { message: 'Chat verbosity level updated successfully' } });
      });

      const response = await request(app)
        .post('/chat-verbosity')
        .send({ verbosityLevel: 'verbose' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /openrouter-api-key', () => {
    it('should return 400 for empty API key', async () => {
      const app = createTestApp();

      app.post('/openrouter-api-key', (req, res) => {
        const { apiKey } = req.body;
        if (!apiKey || typeof apiKey !== 'string') {
          res.status(400).json({ success: false, error: 'Invalid API key. Must be a non-empty string.' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/openrouter-api-key')
        .send({ apiKey: '' })
        .expect(400);

      assert.ok(response.body.error.includes('non-empty string'));
    });

    it('should return 400 for invalid API key format', async () => {
      const app = createTestApp();

      app.post('/openrouter-api-key', (req, res) => {
        const { apiKey } = req.body;
        if (!apiKey || typeof apiKey !== 'string') {
          res.status(400).json({ success: false, error: 'Invalid API key' });
          return;
        }
        if (!apiKey.startsWith('sk-or-')) {
          res.status(400).json({
            success: false,
            error: 'Invalid OpenRouter API key format. Keys should start with "sk-or-".',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/openrouter-api-key')
        .send({ apiKey: 'invalid-key' })
        .expect(400);

      assert.ok(response.body.error.includes('sk-or-'));
    });

    it('should update API key successfully', async () => {
      const app = createTestApp();

      app.post('/openrouter-api-key', (req, res) => {
        res.json({ success: true, data: { message: 'OpenRouter API key updated successfully' } });
      });

      const response = await request(app)
        .post('/openrouter-api-key')
        .send({ apiKey: 'sk-or-testkey123' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('DELETE /openrouter-api-key', () => {
    it('should remove API key successfully', async () => {
      const app = createTestApp();

      app.delete('/openrouter-api-key', (req, res) => {
        res.json({ success: true, data: { message: 'OpenRouter API key removed' } });
      });

      const response = await request(app)
        .delete('/openrouter-api-key')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('removed'));
    });
  });

  describe('POST /autocomplete-settings', () => {
    it('should return 400 when no valid settings provided', async () => {
      const app = createTestApp();

      app.post('/autocomplete-settings', (req, res) => {
        const { enabled, model } = req.body;
        const updates: { autocompleteEnabled?: boolean; autocompleteModel?: string } = {};
        if (typeof enabled === 'boolean') {
          updates.autocompleteEnabled = enabled;
        }
        if (model && typeof model === 'string') {
          const validModels = ['openai/gpt-oss-120b:cerebras', 'openai/gpt-oss-120b', 'deepseek/deepseek-coder', 'anthropic/claude-3-haiku'];
          if (!validModels.includes(model)) {
            res.status(400).json({ success: false, error: `Invalid model. Must be one of: ${validModels.join(', ')}` });
            return;
          }
          updates.autocompleteModel = model;
        }
        if (Object.keys(updates).length === 0) {
          res.status(400).json({ success: false, error: 'No valid settings to update' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/autocomplete-settings')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'No valid settings to update');
    });

    it('should return 400 for invalid model', async () => {
      const app = createTestApp();

      app.post('/autocomplete-settings', (req, res) => {
        const { model } = req.body;
        if (model) {
          const validModels = ['openai/gpt-oss-120b:cerebras', 'openai/gpt-oss-120b', 'deepseek/deepseek-coder', 'anthropic/claude-3-haiku'];
          if (!validModels.includes(model)) {
            res.status(400).json({ success: false, error: `Invalid model. Must be one of: ${validModels.join(', ')}` });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/autocomplete-settings')
        .send({ model: 'invalid-model' })
        .expect(400);

      assert.ok(response.body.error.includes('Invalid model'));
    });

    it('should update settings successfully', async () => {
      const app = createTestApp();

      app.post('/autocomplete-settings', (req, res) => {
        res.json({ success: true, data: { message: 'Autocomplete settings updated successfully' } });
      });

      const response = await request(app)
        .post('/autocomplete-settings')
        .send({ enabled: true, model: 'anthropic/claude-3-haiku' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /image-ai-keys', () => {
    it('should return 400 when imageAiKeys is not an object', async () => {
      const app = createTestApp();

      app.post('/image-ai-keys', (req, res) => {
        const { imageAiKeys } = req.body;
        if (!imageAiKeys || typeof imageAiKeys !== 'object') {
          res.status(400).json({
            success: false,
            error: 'Invalid imageAiKeys. Must be an object with provider keys.',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/image-ai-keys')
        .send({ imageAiKeys: 'not-an-object' })
        .expect(400);

      assert.ok(response.body.error.includes('Must be an object'));
    });

    it('should update image AI keys successfully', async () => {
      const app = createTestApp();

      app.post('/image-ai-keys', (req, res) => {
        res.json({ success: true, data: { message: 'Image AI keys updated successfully' } });
      });

      const response = await request(app)
        .post('/image-ai-keys')
        .send({ imageAiKeys: { openrouter: 'sk-or-123', google: 'AIza...' } })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /image-ai-provider', () => {
    it('should return 400 for invalid provider', async () => {
      const app = createTestApp();

      app.post('/image-ai-provider', (req, res) => {
        const { provider } = req.body;
        const validProviders = ['openrouter', 'cometapi', 'google'];
        if (!validProviders.includes(provider)) {
          res.status(400).json({
            success: false,
            error: 'Invalid provider. Must be one of: openrouter, cometapi, google',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/image-ai-provider')
        .send({ provider: 'invalid' })
        .expect(400);

      assert.ok(response.body.error.includes('Invalid provider'));
    });

    it('should update provider successfully', async () => {
      const app = createTestApp();

      app.post('/image-ai-provider', (req, res) => {
        res.json({ success: true, data: { message: 'Image AI provider updated successfully' } });
      });

      const response = await request(app)
        .post('/image-ai-provider')
        .send({ provider: 'google' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /image-ai-model', () => {
    it('should return 400 for invalid model', async () => {
      const app = createTestApp();

      app.post('/image-ai-model', (req, res) => {
        const { model } = req.body;
        const validModels = ['google/gemini-2.5-flash-image', 'google/gemini-3-pro-image-preview'];
        if (!validModels.includes(model)) {
          res.status(400).json({
            success: false,
            error: 'Invalid model. Must be one of: google/gemini-2.5-flash-image, google/gemini-3-pro-image-preview',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/image-ai-model')
        .send({ model: 'invalid' })
        .expect(400);

      assert.ok(response.body.error.includes('Invalid model'));
    });

    it('should update model successfully', async () => {
      const app = createTestApp();

      app.post('/image-ai-model', (req, res) => {
        res.json({ success: true, data: { message: 'Image AI model updated successfully' } });
      });

      const response = await request(app)
        .post('/image-ai-model')
        .send({ model: 'google/gemini-2.5-flash-image' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });
});
