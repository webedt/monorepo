/**
 * HTTP Tests for User AI Providers Routes
 * Covers Codex and Gemini authentication management
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../../helpers/testApp.js';

describe('User AI Providers HTTP Routes', () => {
  describe('POST /codex-auth', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/codex-auth', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/codex-auth')
        .send({ apiKey: 'sk-test' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when neither apiKey nor accessToken is provided', async () => {
      const app = createTestApp();

      app.post('/codex-auth', (req, res) => {
        const codexAuth = req.body.codexAuth || req.body;
        if (!codexAuth || (!codexAuth.apiKey && !codexAuth.accessToken)) {
          res.status(400).json({
            success: false,
            error: 'Invalid Codex auth. Must include either apiKey or accessToken.',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/codex-auth')
        .send({})
        .expect(400);

      assert.ok(response.body.error.includes('apiKey or accessToken'));
    });

    it('should accept apiKey authentication', async () => {
      const app = createTestApp();

      app.post('/codex-auth', (req, res) => {
        const codexAuth = req.body.codexAuth || req.body;
        if (!codexAuth || (!codexAuth.apiKey && !codexAuth.accessToken)) {
          res.status(400).json({ success: false, error: 'Invalid Codex auth' });
          return;
        }
        res.json({ success: true, data: { message: 'Codex authentication updated successfully' } });
      });

      const response = await request(app)
        .post('/codex-auth')
        .send({ apiKey: 'sk-test123' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should accept accessToken authentication', async () => {
      const app = createTestApp();

      app.post('/codex-auth', (req, res) => {
        const codexAuth = req.body.codexAuth || req.body;
        if (!codexAuth || (!codexAuth.apiKey && !codexAuth.accessToken)) {
          res.status(400).json({ success: false, error: 'Invalid Codex auth' });
          return;
        }
        res.json({ success: true, data: { message: 'Codex authentication updated successfully' } });
      });

      const response = await request(app)
        .post('/codex-auth')
        .send({ accessToken: 'token123' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should accept nested codexAuth object', async () => {
      const app = createTestApp();

      app.post('/codex-auth', (req, res) => {
        const codexAuth = req.body.codexAuth || req.body;
        if (!codexAuth || (!codexAuth.apiKey && !codexAuth.accessToken)) {
          res.status(400).json({ success: false, error: 'Invalid Codex auth' });
          return;
        }
        res.json({ success: true, data: { message: 'Codex authentication updated successfully' } });
      });

      const response = await request(app)
        .post('/codex-auth')
        .send({ codexAuth: { apiKey: 'sk-test123', accessToken: 'token456' } })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('DELETE /codex-auth', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/codex-auth', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/codex-auth')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should remove Codex authentication successfully', async () => {
      const app = createTestApp();

      app.delete('/codex-auth', (req, res) => {
        res.json({ success: true, data: { message: 'Codex authentication removed' } });
      });

      const response = await request(app)
        .delete('/codex-auth')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('removed'));
    });
  });

  describe('POST /gemini-auth', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/gemini-auth', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/gemini-auth')
        .send({ accessToken: 'token', refreshToken: 'refresh' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when accessToken is missing', async () => {
      const app = createTestApp();

      app.post('/gemini-auth', (req, res) => {
        const geminiAuth = req.body.geminiAuth || req.body;
        const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
        const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;
        if (!accessToken || !refreshToken) {
          res.status(400).json({
            success: false,
            error: 'Invalid Gemini auth. Must include OAuth tokens (accessToken/access_token and refreshToken/refresh_token). Run `gemini auth login` locally and paste the contents of ~/.gemini/oauth_creds.json',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/gemini-auth')
        .send({ refreshToken: 'refresh' })
        .expect(400);

      assert.ok(response.body.error.includes('accessToken'));
    });

    it('should return 400 when refreshToken is missing', async () => {
      const app = createTestApp();

      app.post('/gemini-auth', (req, res) => {
        const geminiAuth = req.body.geminiAuth || req.body;
        const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
        const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;
        if (!accessToken || !refreshToken) {
          res.status(400).json({
            success: false,
            error: 'Invalid Gemini auth. Must include OAuth tokens',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/gemini-auth')
        .send({ accessToken: 'token' })
        .expect(400);

      assert.ok(response.body.error.includes('OAuth tokens'));
    });

    it('should accept camelCase token format', async () => {
      const app = createTestApp();

      app.post('/gemini-auth', (req, res) => {
        const geminiAuth = req.body.geminiAuth || req.body;
        const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
        const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;
        if (!accessToken || !refreshToken) {
          res.status(400).json({ success: false, error: 'Invalid Gemini auth' });
          return;
        }
        res.json({ success: true, data: { message: 'Gemini OAuth authentication updated successfully' } });
      });

      const response = await request(app)
        .post('/gemini-auth')
        .send({
          accessToken: 'ya29.test',
          refreshToken: '1//test-refresh',
          expiresAt: Date.now() + 3600000,
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should accept snake_case token format (Gemini CLI format)', async () => {
      const app = createTestApp();

      app.post('/gemini-auth', (req, res) => {
        const geminiAuth = req.body.geminiAuth || req.body;
        const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
        const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;
        if (!accessToken || !refreshToken) {
          res.status(400).json({ success: false, error: 'Invalid Gemini auth' });
          return;
        }
        res.json({ success: true, data: { message: 'Gemini OAuth authentication updated successfully' } });
      });

      const response = await request(app)
        .post('/gemini-auth')
        .send({
          access_token: 'ya29.test',
          refresh_token: '1//test-refresh',
          expiry_date: Date.now() + 3600000,
          token_type: 'Bearer',
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should accept nested geminiAuth object', async () => {
      const app = createTestApp();

      app.post('/gemini-auth', (req, res) => {
        const geminiAuth = req.body.geminiAuth || req.body;
        const accessToken = geminiAuth.accessToken || geminiAuth.access_token;
        const refreshToken = geminiAuth.refreshToken || geminiAuth.refresh_token;
        if (!accessToken || !refreshToken) {
          res.status(400).json({ success: false, error: 'Invalid Gemini auth' });
          return;
        }
        res.json({ success: true, data: { message: 'Gemini OAuth authentication updated successfully' } });
      });

      const response = await request(app)
        .post('/gemini-auth')
        .send({
          geminiAuth: {
            accessToken: 'ya29.test',
            refreshToken: '1//test-refresh',
          },
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('DELETE /gemini-auth', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/gemini-auth', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/gemini-auth')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should remove Gemini authentication successfully', async () => {
      const app = createTestApp();

      app.delete('/gemini-auth', (req, res) => {
        res.json({ success: true, data: { message: 'Gemini authentication removed' } });
      });

      const response = await request(app)
        .delete('/gemini-auth')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('removed'));
    });
  });
});
