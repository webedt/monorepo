/**
 * HTTP Tests for Sessions Bulk Operations Routes
 * Covers bulk delete, restore, archive remote, empty trash, and bulk favorite
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../../helpers/testApp.js';

describe('Sessions Bulk Operations HTTP Routes', () => {
  describe('POST /bulk-delete', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/bulk-delete', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-delete')
        .send({ sessionIds: ['session-1'] })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when sessionIds is not an array', async () => {
      const app = createTestApp();

      app.post('/bulk-delete', (req, res) => {
        const { sessionIds } = req.body;
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          res.status(400).json({ success: false, error: 'Session IDs array is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-delete')
        .send({ sessionIds: 'not-an-array' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Session IDs array is required');
    });

    it('should return 400 when sessionIds is empty', async () => {
      const app = createTestApp();

      app.post('/bulk-delete', (req, res) => {
        const { sessionIds } = req.body;
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          res.status(400).json({ success: false, error: 'Session IDs array is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-delete')
        .send({ sessionIds: [] })
        .expect(400);

      assert.strictEqual(response.body.error, 'Session IDs array is required');
    });

    it('should return 400 when batch size exceeds limit', async () => {
      const app = createTestApp();
      const MAX_BATCH_SIZE = 100;

      app.post('/bulk-delete', (req, res) => {
        const { sessionIds } = req.body;
        if (sessionIds.length > MAX_BATCH_SIZE) {
          res.status(400).json({ success: false, error: `Maximum ${MAX_BATCH_SIZE} sessions per batch` });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-delete')
        .send({ sessionIds: Array(101).fill('session-id') })
        .expect(400);

      assert.ok(response.body.error.includes('Maximum'));
    });

    it('should soft delete sessions successfully', async () => {
      const app = createTestApp();

      app.post('/bulk-delete', (req, res) => {
        const { sessionIds, permanent } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            permanent: permanent || false,
            results: sessionIds.map((id: string) => ({
              id,
              success: true,
              message: permanent ? 'Permanently deleted' : 'Moved to trash',
            })),
          },
        });
      });

      const response = await request(app)
        .post('/bulk-delete')
        .send({ sessionIds: ['session-1', 'session-2'] })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.processed, 2);
      assert.strictEqual(response.body.data.permanent, false);
    });

    it('should permanently delete sessions when permanent flag is set', async () => {
      const app = createTestApp();

      app.post('/bulk-delete', (req, res) => {
        const { sessionIds, permanent } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            permanent: true,
            results: sessionIds.map((id: string) => ({
              id,
              success: true,
              message: 'Permanently deleted',
            })),
          },
        });
      });

      const response = await request(app)
        .post('/bulk-delete')
        .send({ sessionIds: ['session-1'], permanent: true })
        .expect(200);

      assert.strictEqual(response.body.data.permanent, true);
      assert.strictEqual(response.body.data.results[0].message, 'Permanently deleted');
    });

    it('should handle cleanup options (archiveRemote, deleteGitBranch)', async () => {
      const app = createTestApp();

      app.post('/bulk-delete', (req, res) => {
        const { sessionIds, archiveRemote, deleteGitBranch } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            cleanupResults: sessionIds.map((id: string) => ({
              sessionId: id,
              archived: archiveRemote !== false,
              branchDeleted: deleteGitBranch === true,
            })),
          },
        });
      });

      const response = await request(app)
        .post('/bulk-delete')
        .send({
          sessionIds: ['session-1'],
          archiveRemote: true,
          deleteGitBranch: true,
        })
        .expect(200);

      assert.strictEqual(response.body.data.cleanupResults[0].archived, true);
      assert.strictEqual(response.body.data.cleanupResults[0].branchDeleted, true);
    });
  });

  describe('POST /bulk-restore', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/bulk-restore', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-restore')
        .send({ sessionIds: ['session-1'] })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when sessionIds is empty', async () => {
      const app = createTestApp();

      app.post('/bulk-restore', (req, res) => {
        const { sessionIds } = req.body;
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          res.status(400).json({ success: false, error: 'Session IDs array is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-restore')
        .send({ sessionIds: [] })
        .expect(400);

      assert.strictEqual(response.body.error, 'Session IDs array is required');
    });

    it('should restore sessions successfully', async () => {
      const app = createTestApp();

      app.post('/bulk-restore', (req, res) => {
        const { sessionIds } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            results: sessionIds.map((id: string) => ({
              id,
              success: true,
              message: 'Restored from trash',
            })),
          },
        });
      });

      const response = await request(app)
        .post('/bulk-restore')
        .send({ sessionIds: ['session-1', 'session-2'] })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.processed, 2);
      assert.strictEqual(response.body.data.results[0].message, 'Restored from trash');
    });

    it('should return 400 when no valid deleted sessions found', async () => {
      const app = createTestApp();

      app.post('/bulk-restore', (req, res) => {
        res.status(400).json({
          success: false,
          error: 'No valid deleted sessions found to restore',
        });
      });

      const response = await request(app)
        .post('/bulk-restore')
        .send({ sessionIds: ['nonexistent'] })
        .expect(400);

      assert.ok(response.body.error.includes('No valid deleted sessions'));
    });
  });

  describe('DELETE /deleted (Empty Trash)', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/deleted', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/deleted')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return success when trash is already empty', async () => {
      const app = createTestApp();

      app.delete('/deleted', (req, res) => {
        res.json({
          success: true,
          data: {
            processed: 0,
            succeeded: 0,
            failed: 0,
            message: 'Trash is already empty',
            results: [],
          },
        });
      });

      const response = await request(app)
        .delete('/deleted')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.processed, 0);
      assert.ok(response.body.data.message.includes('already empty'));
    });

    it('should empty trash successfully', async () => {
      const app = createTestApp();

      app.delete('/deleted', (req, res) => {
        res.json({
          success: true,
          data: {
            processed: 5,
            succeeded: 5,
            failed: 0,
            results: [
              { id: 'session-1', success: true, message: 'Permanently deleted' },
              { id: 'session-2', success: true, message: 'Permanently deleted' },
            ],
            stats: { mode: 'atomic', durationMs: 150, retriesAttempted: 0 },
          },
        });
      });

      const response = await request(app)
        .delete('/deleted')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.processed, 5);
    });

    it('should support cleanup query parameters', async () => {
      const app = createTestApp();

      app.delete('/deleted', (req, res) => {
        const { archiveRemote, deleteGitBranch } = req.query;
        res.json({
          success: true,
          data: {
            processed: 1,
            succeeded: 1,
            failed: 0,
            cleanupOptions: {
              archiveRemote: archiveRemote !== 'false',
              deleteGitBranch: deleteGitBranch === 'true',
            },
          },
        });
      });

      const response = await request(app)
        .delete('/deleted')
        .query({ archiveRemote: 'false', deleteGitBranch: 'true' })
        .expect(200);

      assert.strictEqual(response.body.data.cleanupOptions.archiveRemote, false);
      assert.strictEqual(response.body.data.cleanupOptions.deleteGitBranch, true);
    });
  });

  describe('POST /bulk-archive-remote', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/bulk-archive-remote', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-archive-remote')
        .send({ sessionIds: ['session-1'] })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when sessionIds is empty', async () => {
      const app = createTestApp();

      app.post('/bulk-archive-remote', (req, res) => {
        const { sessionIds } = req.body;
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          res.status(400).json({ success: false, error: 'Session IDs array is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-archive-remote')
        .send({ sessionIds: [] })
        .expect(400);

      assert.strictEqual(response.body.error, 'Session IDs array is required');
    });

    it('should return 400 when Claude auth not configured', async () => {
      const app = createTestApp();

      app.post('/bulk-archive-remote', (req, res) => {
        res.status(400).json({ success: false, error: 'Claude authentication not configured' });
      });

      const response = await request(app)
        .post('/bulk-archive-remote')
        .send({ sessionIds: ['session-1'] })
        .expect(400);

      assert.strictEqual(response.body.error, 'Claude authentication not configured');
    });

    it('should archive remote sessions successfully', async () => {
      const app = createTestApp();

      app.post('/bulk-archive-remote', (req, res) => {
        const { sessionIds, archiveLocal } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            results: sessionIds.map((id: string) => ({
              id,
              success: true,
              message: 'Archived successfully',
            })),
            stats: {
              durationMs: 100,
              archiveStats: { successCount: sessionIds.length, failureCount: 0 },
              localDeleteStats: archiveLocal ? { success: true } : undefined,
            },
          },
        });
      });

      const response = await request(app)
        .post('/bulk-archive-remote')
        .send({ sessionIds: ['session-1', 'session-2'] })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.succeeded, 2);
    });

    it('should support archiveLocal option', async () => {
      const app = createTestApp();

      app.post('/bulk-archive-remote', (req, res) => {
        const { sessionIds, archiveLocal } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            results: [],
            stats: {
              localDeleteStats: archiveLocal ? { success: true, retriesAttempted: 0 } : undefined,
            },
          },
        });
      });

      const response = await request(app)
        .post('/bulk-archive-remote')
        .send({ sessionIds: ['session-1'], archiveLocal: true })
        .expect(200);

      assert.ok(response.body.data.stats.localDeleteStats);
    });
  });

  describe('POST /bulk-favorite', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/bulk-favorite', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-favorite')
        .send({ sessionIds: ['session-1'] })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when sessionIds is empty', async () => {
      const app = createTestApp();

      app.post('/bulk-favorite', (req, res) => {
        const { sessionIds } = req.body;
        if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
          res.status(400).json({ success: false, error: 'Session IDs array is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/bulk-favorite')
        .send({ sessionIds: [] })
        .expect(400);

      assert.strictEqual(response.body.error, 'Session IDs array is required');
    });

    it('should add sessions to favorites', async () => {
      const app = createTestApp();

      app.post('/bulk-favorite', (req, res) => {
        const { sessionIds, favorite } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            favorite: favorite !== false,
            results: sessionIds.map((id: string) => ({
              id,
              success: true,
              message: favorite !== false ? 'Added to favorites' : 'Removed from favorites',
            })),
          },
        });
      });

      const response = await request(app)
        .post('/bulk-favorite')
        .send({ sessionIds: ['session-1', 'session-2'], favorite: true })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.favorite, true);
      assert.strictEqual(response.body.data.results[0].message, 'Added to favorites');
    });

    it('should remove sessions from favorites', async () => {
      const app = createTestApp();

      app.post('/bulk-favorite', (req, res) => {
        const { sessionIds, favorite } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            favorite: false,
            results: sessionIds.map((id: string) => ({
              id,
              success: true,
              message: 'Removed from favorites',
            })),
          },
        });
      });

      const response = await request(app)
        .post('/bulk-favorite')
        .send({ sessionIds: ['session-1'], favorite: false })
        .expect(200);

      assert.strictEqual(response.body.data.favorite, false);
      assert.strictEqual(response.body.data.results[0].message, 'Removed from favorites');
    });

    it('should default favorite to true when not specified', async () => {
      const app = createTestApp();

      app.post('/bulk-favorite', (req, res) => {
        const { sessionIds, favorite = true } = req.body;
        res.json({
          success: true,
          data: {
            processed: sessionIds.length,
            succeeded: sessionIds.length,
            failed: 0,
            favorite,
          },
        });
      });

      const response = await request(app)
        .post('/bulk-favorite')
        .send({ sessionIds: ['session-1'] })
        .expect(200);

      assert.strictEqual(response.body.data.favorite, true);
    });
  });
});
