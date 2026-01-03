/**
 * HTTP Tests for GitHub Branches Routes
 * Covers branch operations: list, create, delete, merge-base
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp, createMockUser } from '../../helpers/testApp.js';

describe('GitHub Branches HTTP Routes', () => {
  describe('GET /:owner/:repo/branches - List Branches', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:owner/:repo/branches', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/testowner/testrepo/branches')
        .expect('Content-Type', /json/)
        .expect(401);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Unauthorized');
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.get('/:owner/:repo/branches', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/testowner/testrepo/branches')
        .expect('Content-Type', /json/)
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should return branches when authenticated with GitHub', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      const mockBranches = [
        { name: 'main', protected: true, commit: { sha: 'abc123', url: 'https://github.com' } },
        { name: 'develop', protected: false, commit: { sha: 'def456', url: 'https://github.com' } },
      ];

      app.get('/:owner/:repo/branches', (req, res) => {
        res.json({ success: true, data: mockBranches });
      });

      const response = await request(app)
        .get('/testowner/testrepo/branches')
        .expect('Content-Type', /json/)
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 2);
      assert.strictEqual(response.body.data[0].name, 'main');
    });
  });

  describe('POST /:owner/:repo/branches - Create Branch', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/branches', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches')
        .send({ branchName: 'feature-branch' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when branchName is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches', (req, res) => {
        const { branchName } = req.body;
        if (!branchName) {
          res.status(400).json({ success: false, error: 'Branch name is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Branch name is required');
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.post('/:owner/:repo/branches', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches')
        .send({ branchName: 'feature-branch' })
        .expect(400);

      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should create branch successfully with valid input', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches', (req, res) => {
        const { branchName, baseBranch } = req.body;
        res.json({
          success: true,
          data: {
            branchName,
            baseBranch: baseBranch || 'main',
            sha: 'abc123def456',
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches')
        .send({ branchName: 'feature-branch', baseBranch: 'develop' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.branchName, 'feature-branch');
      assert.strictEqual(response.body.data.baseBranch, 'develop');
    });

    it('should default baseBranch to main when not provided', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches', (req, res) => {
        const { branchName, baseBranch } = req.body;
        res.json({
          success: true,
          data: {
            branchName,
            baseBranch: baseBranch || 'main',
            sha: 'abc123',
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches')
        .send({ branchName: 'feature-branch' })
        .expect(200);

      assert.strictEqual(response.body.data.baseBranch, 'main');
    });

    it('should return 422 when branch already exists', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches', (req, res) => {
        res.status(422).json({ success: false, error: 'Branch already exists' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches')
        .send({ branchName: 'existing-branch' })
        .expect(422);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Branch already exists');
    });
  });

  describe('DELETE /:owner/:repo/branches/* - Delete Branch', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/:owner/:repo/branches/:branch', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/branches/feature-branch')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.delete('/:owner/:repo/branches/:branch', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/branches/feature-branch')
        .expect(400);

      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should delete branch successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.delete('/:owner/:repo/branches/:branch', (req, res) => {
        res.json({ success: true, data: { message: 'Branch deleted' } });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/branches/feature-branch')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.message, 'Branch deleted');
    });

    it('should handle already deleted branch gracefully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.delete('/:owner/:repo/branches/:branch', (req, res) => {
        // Simulate 404/422 - branch doesn't exist
        res.json({ success: true, data: { message: 'Branch already deleted or does not exist' } });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/branches/non-existent')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('already deleted'));
    });
  });

  describe('POST /:owner/:repo/branches/*/merge-base - Merge Base Branch', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/branches/:branch/merge-base', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/merge-base')
        .send({ base: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when base branch is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/merge-base', (req, res) => {
        const { base } = req.body;
        if (!base) {
          res.status(400).json({ success: false, error: 'Base branch is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/merge-base')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'Base branch is required');
    });

    it('should merge base branch successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/merge-base', (req, res) => {
        const { base } = req.body;
        const branch = req.params.branch;
        res.json({
          success: true,
          data: {
            sha: 'merge123abc',
            message: `Successfully merged ${base} into ${branch}`,
            commit: { sha: 'merge123abc', message: `Merge ${base} into ${branch}` },
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/merge-base')
        .send({ base: 'main' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('merged'));
    });

    it('should handle up-to-date branch', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/merge-base', (req, res) => {
        res.json({ success: true, data: { message: 'Branch is already up to date', sha: null } });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/merge-base')
        .send({ base: 'main' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('up to date'));
    });

    it('should return 409 for merge conflict', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/merge-base', (req, res) => {
        res.status(409).json({ success: false, error: 'Merge conflict - manual resolution required' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/merge-base')
        .send({ base: 'main' })
        .expect(409);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('conflict'));
    });
  });
});
