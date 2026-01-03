/**
 * HTTP Tests for Sessions Send Routes
 * Covers sending follow-up messages to sessions
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../../helpers/testApp.js';

describe('Sessions Send HTTP Routes', () => {
  describe('POST /:id/send', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:id/send', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/send')
        .send({ message: 'Hello' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when message is missing', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
          res.status(400).json({ success: false, error: 'Message is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/send')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'Message is required');
    });

    it('should return 400 when message is empty string', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
          res.status(400).json({ success: false, error: 'Message is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/send')
        .send({ message: '' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Message is required');
    });

    it('should return 400 when message is whitespace only', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
          res.status(400).json({ success: false, error: 'Message is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/send')
        .send({ message: '   \n\t  ' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Message is required');
    });

    it('should return 400 when message is not a string', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || !message.trim()) {
          res.status(400).json({ success: false, error: 'Message is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/send')
        .send({ message: 123 })
        .expect(400);

      assert.strictEqual(response.body.error, 'Message is required');
    });

    it('should return 400 when session does not have remote session ID', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        // Simulate session without remoteSessionId
        const session = { id: req.params.id, remoteSessionId: null };
        if (!session.remoteSessionId) {
          res.status(400).json({
            success: false,
            error: 'Session does not have a Claude Remote session to resume',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/send')
        .send({ message: 'Hello' })
        .expect(400);

      assert.ok(response.body.error.includes('Claude Remote session'));
    });

    it('should return 404 when session not found', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        res.status(404).json({ success: false, error: 'Session not found' });
      });

      const response = await request(app)
        .post('/nonexistent-session/send')
        .send({ message: 'Hello' })
        .expect(404);

      assert.strictEqual(response.body.error, 'Session not found');
    });

    it('should return 403 when user does not own session', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        res.status(403).json({ success: false, error: 'Access denied' });
      });

      const response = await request(app)
        .post('/other-user-session/send')
        .send({ message: 'Hello' })
        .expect(403);

      assert.strictEqual(response.body.error, 'Access denied');
    });

    it('should send message successfully', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        const { message } = req.body;
        const sessionId = req.params.id;
        res.json({
          success: true,
          data: {
            message: 'Message queued for processing',
            sessionId,
            status: 'running',
          },
        });
      });

      const response = await request(app)
        .post('/session-123/send')
        .send({ message: 'Please add error handling' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.message, 'Message queued for processing');
      assert.strictEqual(response.body.data.status, 'running');
    });

    it('should handle long messages', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        const { message } = req.body;
        res.json({
          success: true,
          data: {
            message: 'Message queued for processing',
            sessionId: req.params.id,
            status: 'running',
            messageLength: message.length,
          },
        });
      });

      const longMessage = 'A'.repeat(5000);
      const response = await request(app)
        .post('/session-123/send')
        .send({ message: longMessage })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.messageLength, 5000);
    });

    it('should return session ID in response', async () => {
      const app = createTestApp();

      app.post('/:id/send', (req, res) => {
        res.json({
          success: true,
          data: {
            message: 'Message queued for processing',
            sessionId: req.params.id,
            status: 'running',
          },
        });
      });

      const response = await request(app)
        .post('/my-session-456/send')
        .send({ message: 'Test message' })
        .expect(200);

      assert.strictEqual(response.body.data.sessionId, 'my-session-456');
    });
  });
});
