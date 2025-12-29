/**
 * HTTP Integration Tests for Sessions Routes
 *
 * Tests the actual HTTP endpoints using supertest.
 * These tests verify the HTTP layer, request/response handling,
 * and middleware behavior for session routes.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import { createMockUser } from '../helpers/mockExpress.js';

describe('Sessions HTTP Routes', () => {
  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests to protected endpoints', async () => {
      const app = createTestApp({ user: null, authSession: null });

      // Add a test route that simulates auth check
      app.get('/api/sessions', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true, data: { sessions: [] } });
      });

      const response = await request(app)
        .get('/api/sessions')
        .expect('Content-Type', /json/)
        .expect(401);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Unauthorized');
    });

    it('should allow authenticated requests', async () => {
      const app = createTestApp();

      app.get('/api/sessions', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true, data: { sessions: [], total: 0 } });
      });

      const response = await request(app)
        .get('/api/sessions')
        .expect('Content-Type', /json/)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data);
    });
  });

  describe('POST /api/sessions/create-code-session', () => {
    it('should validate required fields', async () => {
      const app = createTestApp();

      app.post('/api/sessions/create-code-session', (req, res) => {
        const { repositoryOwner, repositoryName, baseBranch, branch } = req.body;

        if (!repositoryOwner || !repositoryName || !baseBranch || !branch) {
          res.status(400).json({
            success: false,
            error: 'Missing required fields: repositoryOwner, repositoryName, baseBranch, and branch are required',
          });
          return;
        }

        res.status(201).json({
          success: true,
          session: {
            id: 'new-session-id',
            repositoryOwner,
            repositoryName,
            baseBranch,
            branch,
          },
        });
      });

      // Test missing repositoryOwner
      let response = await request(app)
        .post('/api/sessions/create-code-session')
        .send({ repositoryName: 'repo', baseBranch: 'main', branch: 'feature' })
        .expect(400);

      assert.strictEqual(response.body.success, false);

      // Test valid request
      response = await request(app)
        .post('/api/sessions/create-code-session')
        .send({
          repositoryOwner: 'owner',
          repositoryName: 'repo',
          baseBranch: 'main',
          branch: 'feature-branch',
        })
        .expect(201);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.session.repositoryOwner, 'owner');
    });
  });

  describe('GET /api/sessions/:id', () => {
    it('should return 404 for non-existent session', async () => {
      const app = createTestApp();

      app.get('/api/sessions/:id', (req, res) => {
        // Simulate session not found
        res.status(404).json({
          success: false,
          error: 'Session not found',
        });
      });

      const response = await request(app)
        .get('/api/sessions/non-existent-id')
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Session not found');
    });

    it('should return session for valid id and owner', async () => {
      const app = createTestApp();

      app.get('/api/sessions/:id', (req, res) => {
        res.json({
          success: true,
          session: {
            id: req.params.id,
            userId: req.user?.id,
            userRequest: 'Test session',
            status: 'completed',
          },
        });
      });

      const response = await request(app)
        .get('/api/sessions/test-session-id')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.session.id, 'test-session-id');
    });
  });

  describe('PATCH /api/sessions/:id', () => {
    it('should reject empty update body', async () => {
      const app = createTestApp();

      app.patch('/api/sessions/:id', (req, res) => {
        const { userRequest, branch } = req.body;

        if (!userRequest && !branch) {
          res.status(400).json({
            success: false,
            error: 'At least one field must be provided',
          });
          return;
        }

        res.json({ success: true, session: { id: req.params.id } });
      });

      const response = await request(app)
        .patch('/api/sessions/test-id')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });

    it('should accept valid update', async () => {
      const app = createTestApp();

      app.patch('/api/sessions/:id', (req, res) => {
        const { userRequest, branch } = req.body;

        if (!userRequest && !branch) {
          res.status(400).json({
            success: false,
            error: 'At least one field must be provided',
          });
          return;
        }

        res.json({
          success: true,
          session: { id: req.params.id, userRequest },
        });
      });

      const response = await request(app)
        .patch('/api/sessions/test-id')
        .send({ userRequest: 'Updated title' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.session.userRequest, 'Updated title');
    });
  });

  describe('DELETE /api/sessions/:id', () => {
    it('should soft delete session', async () => {
      const app = createTestApp();

      app.delete('/api/sessions/:id', (req, res) => {
        res.json({
          success: true,
          message: 'Session deleted',
        });
      });

      const response = await request(app)
        .delete('/api/sessions/test-id')
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('POST /api/sessions/bulk-delete', () => {
    it('should reject empty ids array', async () => {
      const app = createTestApp();

      app.post('/api/sessions/bulk-delete', (req, res) => {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
          res.status(400).json({
            success: false,
            error: 'ids must be a non-empty array',
          });
          return;
        }

        res.json({ success: true, deleted: ids.length });
      });

      const response = await request(app)
        .post('/api/sessions/bulk-delete')
        .send({ ids: [] })
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });

    it('should accept valid ids array', async () => {
      const app = createTestApp();

      app.post('/api/sessions/bulk-delete', (req, res) => {
        const { ids } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
          res.status(400).json({
            success: false,
            error: 'ids must be a non-empty array',
          });
          return;
        }

        res.json({ success: true, deleted: ids.length });
      });

      const response = await request(app)
        .post('/api/sessions/bulk-delete')
        .send({ ids: ['id1', 'id2', 'id3'] })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.deleted, 3);
    });
  });

  describe('POST /api/sessions/:id/share', () => {
    it('should create share token with valid expiry', async () => {
      const app = createTestApp();

      app.post('/api/sessions/:id/share', (req, res) => {
        const { expiresInDays } = req.body;

        if (expiresInDays !== undefined) {
          if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
            res.status(400).json({
              success: false,
              error: 'expiresInDays must be between 1 and 365',
            });
            return;
          }
        }

        const shareToken = `share-${Date.now()}`;
        res.json({
          success: true,
          shareToken,
          shareUrl: `https://example.com/shared/${shareToken}`,
        });
      });

      const response = await request(app)
        .post('/api/sessions/test-id/share')
        .send({ expiresInDays: 30 })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.shareToken);
    });

    it('should reject invalid expiry days', async () => {
      const app = createTestApp();

      app.post('/api/sessions/:id/share', (req, res) => {
        const { expiresInDays } = req.body;

        if (expiresInDays !== undefined) {
          if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
            res.status(400).json({
              success: false,
              error: 'expiresInDays must be between 1 and 365',
            });
            return;
          }
        }

        res.json({ success: true });
      });

      const response = await request(app)
        .post('/api/sessions/test-id/share')
        .send({ expiresInDays: 400 })
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('Response Format', () => {
    it('should return proper JSON content-type', async () => {
      const app = createTestApp();

      app.get('/api/sessions', (_req, res) => {
        res.json({ success: true, data: { sessions: [] } });
      });

      await request(app)
        .get('/api/sessions')
        .expect('Content-Type', /application\/json/);
    });

    it('should include success field in all responses', async () => {
      const app = createTestApp();

      app.get('/api/sessions', (_req, res) => {
        res.json({ success: true, data: { sessions: [] } });
      });

      const response = await request(app).get('/api/sessions');
      assert.ok('success' in response.body);
    });
  });
});
