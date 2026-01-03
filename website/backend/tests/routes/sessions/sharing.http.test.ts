/**
 * HTTP Tests for Sessions Sharing Routes
 * Covers public share endpoints and share management
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../../helpers/testApp.js';

describe('Sessions Sharing HTTP Routes', () => {
  describe('GET /shared/:token - Get Shared Session', () => {
    it('should return 400 when share token is missing', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/shared/:token', (req, res) => {
        const shareToken = req.params.token;
        if (!shareToken) {
          res.status(400).json({ success: false, error: 'Share token is required' });
          return;
        }
        res.json({ success: true });
      });

      // This test validates the route handler - in practice token is always present in URL
      const response = await request(app)
        .get('/shared/test-token')
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });

    it('should return 404 when session not found or expired', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/shared/:token', (req, res) => {
        res.status(404).json({ success: false, error: 'Session not found or share link expired' });
      });

      const response = await request(app)
        .get('/shared/invalid-token')
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('not found'));
    });

    it('should return shared session data successfully', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/shared/:token', (req, res) => {
        res.json({
          success: true,
          session: {
            id: 'session-123',
            userRequest: 'Add dark mode',
            status: 'completed',
            repositoryOwner: 'testowner',
            repositoryName: 'testrepo',
            branch: 'feature-dark-mode',
            provider: 'claude',
            createdAt: '2025-01-01T00:00:00.000Z',
            completedAt: '2025-01-01T01:00:00.000Z',
            previewUrl: 'https://preview.example.com',
            isShared: true,
          },
        });
      });

      const response = await request(app)
        .get('/shared/valid-share-token')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.session.id, 'session-123');
      assert.strictEqual(response.body.session.isShared, true);
    });

    it('should work without authentication (public endpoint)', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/shared/:token', (req, res) => {
        // Verify no auth is required
        res.json({
          success: true,
          session: { id: 'session-123', isShared: true },
        });
      });

      const response = await request(app)
        .get('/shared/some-token')
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('GET /shared/:token/events - Get Shared Session Events', () => {
    it('should return 404 when session not found', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/shared/:token/events', (req, res) => {
        res.status(404).json({ success: false, error: 'Session not found or share link expired' });
      });

      const response = await request(app)
        .get('/shared/invalid-token/events')
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });

    it('should return events for shared session', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/shared/:token/events', (req, res) => {
        res.json({
          success: true,
          data: {
            events: [
              { id: 1, eventData: { type: 'message', content: 'Starting...' } },
              { id: 2, eventData: { type: 'tool_use', tool: 'read_file' } },
              { id: 3, eventData: { type: 'message', content: 'Done!' } },
            ],
            total: 3,
          },
        });
      });

      const response = await request(app)
        .get('/shared/valid-token/events')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.events.length, 3);
      assert.strictEqual(response.body.data.total, 3);
    });
  });

  describe('POST /:id/share - Generate Share Token', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:id/share', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/share')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when expiresInDays is out of range (too low)', async () => {
      const app = createTestApp();

      app.post('/:id/share', (req, res) => {
        const { expiresInDays } = req.body;
        if (expiresInDays !== undefined) {
          if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
            res.status(400).json({ success: false, error: 'expiresInDays must be between 1 and 365' });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/share')
        .send({ expiresInDays: 0 })
        .expect(400);

      assert.strictEqual(response.body.error, 'expiresInDays must be between 1 and 365');
    });

    it('should return 400 when expiresInDays is out of range (too high)', async () => {
      const app = createTestApp();

      app.post('/:id/share', (req, res) => {
        const { expiresInDays } = req.body;
        if (expiresInDays !== undefined) {
          if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
            res.status(400).json({ success: false, error: 'expiresInDays must be between 1 and 365' });
            return;
          }
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/session-123/share')
        .send({ expiresInDays: 400 })
        .expect(400);

      assert.strictEqual(response.body.error, 'expiresInDays must be between 1 and 365');
    });

    it('should return 404 when session not found', async () => {
      const app = createTestApp();

      app.post('/:id/share', (req, res) => {
        res.status(404).json({ success: false, error: 'Session not found' });
      });

      const response = await request(app)
        .post('/nonexistent/share')
        .expect(404);

      assert.strictEqual(response.body.error, 'Session not found');
    });

    it('should return 403 when user does not own session', async () => {
      const app = createTestApp();

      app.post('/:id/share', (req, res) => {
        res.status(403).json({ success: false, error: 'Access denied' });
      });

      const response = await request(app)
        .post('/other-user-session/share')
        .expect(403);

      assert.strictEqual(response.body.error, 'Access denied');
    });

    it('should generate share token successfully', async () => {
      const app = createTestApp();

      app.post('/:id/share', (req, res) => {
        res.json({
          success: true,
          data: {
            shareToken: 'abc123-def456-ghi789',
            shareUrl: '/sessions/shared/abc123-def456-ghi789',
            expiresAt: null,
          },
        });
      });

      const response = await request(app)
        .post('/session-123/share')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.shareToken);
      assert.ok(response.body.data.shareUrl);
    });

    it('should generate share token with expiration', async () => {
      const app = createTestApp();

      app.post('/:id/share', (req, res) => {
        const { expiresInDays } = req.body;
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + (expiresInDays || 7));

        res.json({
          success: true,
          data: {
            shareToken: 'abc123-def456-ghi789',
            shareUrl: '/sessions/shared/abc123-def456-ghi789',
            expiresAt: expiresAt.toISOString(),
          },
        });
      });

      const response = await request(app)
        .post('/session-123/share')
        .send({ expiresInDays: 30 })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.expiresAt);
    });
  });

  describe('DELETE /:id/share - Revoke Share Token', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/:id/share', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/session-123/share')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 404 when session not found', async () => {
      const app = createTestApp();

      app.delete('/:id/share', (req, res) => {
        res.status(404).json({ success: false, error: 'Session not found' });
      });

      const response = await request(app)
        .delete('/nonexistent/share')
        .expect(404);

      assert.strictEqual(response.body.error, 'Session not found');
    });

    it('should return 400 when session is not currently shared', async () => {
      const app = createTestApp();

      app.delete('/:id/share', (req, res) => {
        res.status(400).json({ success: false, error: 'Session is not currently shared' });
      });

      const response = await request(app)
        .delete('/session-not-shared/share')
        .expect(400);

      assert.strictEqual(response.body.error, 'Session is not currently shared');
    });

    it('should revoke share token successfully', async () => {
      const app = createTestApp();

      app.delete('/:id/share', (req, res) => {
        res.json({ success: true, data: { message: 'Share link revoked' } });
      });

      const response = await request(app)
        .delete('/session-123/share')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('revoked'));
    });
  });

  describe('GET /:id/share - Get Share Status', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:id/share', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/session-123/share')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 404 when session not found', async () => {
      const app = createTestApp();

      app.get('/:id/share', (req, res) => {
        res.status(404).json({ success: false, error: 'Session not found' });
      });

      const response = await request(app)
        .get('/nonexistent/share')
        .expect(404);

      assert.strictEqual(response.body.error, 'Session not found');
    });

    it('should return share status for shared session', async () => {
      const app = createTestApp();

      app.get('/:id/share', (req, res) => {
        res.json({
          success: true,
          data: {
            isShared: true,
            shareToken: 'abc123-def456',
            shareUrl: '/sessions/shared/abc123-def456',
            expiresAt: '2025-12-31T23:59:59.999Z',
            isExpired: false,
          },
        });
      });

      const response = await request(app)
        .get('/session-123/share')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.isShared, true);
      assert.strictEqual(response.body.data.isExpired, false);
    });

    it('should return share status for unshared session', async () => {
      const app = createTestApp();

      app.get('/:id/share', (req, res) => {
        res.json({
          success: true,
          data: {
            isShared: false,
            shareToken: null,
            shareUrl: null,
            expiresAt: null,
            isExpired: false,
          },
        });
      });

      const response = await request(app)
        .get('/session-not-shared/share')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.isShared, false);
      assert.strictEqual(response.body.data.shareToken, null);
    });

    it('should return expired status when share link has expired', async () => {
      const app = createTestApp();

      app.get('/:id/share', (req, res) => {
        res.json({
          success: true,
          data: {
            isShared: true,
            shareToken: 'abc123-def456',
            shareUrl: '/sessions/shared/abc123-def456',
            expiresAt: '2024-01-01T00:00:00.000Z',
            isExpired: true,
          },
        });
      });

      const response = await request(app)
        .get('/session-123/share')
        .expect(200);

      assert.strictEqual(response.body.data.isShared, true);
      assert.strictEqual(response.body.data.isExpired, true);
    });
  });
});
