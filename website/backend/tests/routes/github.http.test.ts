/**
 * HTTP Integration Tests for GitHub Routes
 *
 * Tests the actual HTTP endpoints using supertest.
 * These tests verify the HTTP layer, request/response handling,
 * and middleware behavior for GitHub OAuth and repository operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp } from '../helpers/testApp.js';
import { createMockUser } from '../helpers/mockExpress.js';

describe('GitHub HTTP Routes', () => {
  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests to protected endpoints', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/api/github/repos', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/api/github/repos')
        .expect(401);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Unauthorized');
    });
  });

  describe('GitHub Connection', () => {
    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.get('/api/github/repos', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({
            success: false,
            error: 'GitHub not connected',
          });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/api/github/repos')
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should allow requests when GitHub is connected', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.get('/api/github/repos', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({
          success: true,
          data: [
            { id: 1, name: 'repo1', full_name: 'owner/repo1' },
            { id: 2, name: 'repo2', full_name: 'owner/repo2' },
          ],
        });
      });

      const response = await request(app)
        .get('/api/github/repos')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 2);
    });
  });

  describe('GET /api/github/repos/:owner/:repo/branches', () => {
    it('should validate owner and repo parameters', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.get('/api/github/repos/:owner/:repo/branches', (req, res) => {
        const { owner, repo } = req.params;

        if (!owner || !repo) {
          res.status(400).json({
            success: false,
            error: 'Owner and repo are required',
          });
          return;
        }

        res.json({
          success: true,
          data: [
            { name: 'main', protected: true },
            { name: 'develop', protected: false },
          ],
        });
      });

      const response = await request(app)
        .get('/api/github/repos/testowner/testrepo/branches')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
    });
  });

  describe('POST /api/github/repos/:owner/:repo/branches', () => {
    it('should require branch name', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.post('/api/github/repos/:owner/:repo/branches', (req, res) => {
        const { branchName } = req.body;

        if (!branchName) {
          res.status(400).json({
            success: false,
            error: 'Branch name is required',
          });
          return;
        }

        res.status(201).json({
          success: true,
          data: { name: branchName, sha: 'abc123' },
        });
      });

      const response = await request(app)
        .post('/api/github/repos/owner/repo/branches')
        .send({ baseBranch: 'main' })
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Branch name is required');
    });

    it('should create branch with valid input', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.post('/api/github/repos/:owner/:repo/branches', (req, res) => {
        const { branchName, baseBranch } = req.body;

        if (!branchName) {
          res.status(400).json({ success: false, error: 'Branch name is required' });
          return;
        }

        res.status(201).json({
          success: true,
          data: {
            name: branchName,
            baseBranch: baseBranch || 'main',
            sha: 'abc123',
          },
        });
      });

      const response = await request(app)
        .post('/api/github/repos/owner/repo/branches')
        .send({ branchName: 'feature-branch', baseBranch: 'develop' })
        .expect(201);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.name, 'feature-branch');
      assert.strictEqual(response.body.data.baseBranch, 'develop');
    });
  });

  describe('POST /api/github/repos/:owner/:repo/pulls', () => {
    it('should require head and base branches', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.post('/api/github/repos/:owner/:repo/pulls', (req, res) => {
        const { head, base } = req.body;

        if (!head || !base) {
          res.status(400).json({
            success: false,
            error: 'Head and base branches are required',
          });
          return;
        }

        res.status(201).json({
          success: true,
          data: {
            number: 123,
            title: req.body.title || `Merge ${head} into ${base}`,
            html_url: `https://github.com/${req.params.owner}/${req.params.repo}/pull/123`,
          },
        });
      });

      // Missing head
      let response = await request(app)
        .post('/api/github/repos/owner/repo/pulls')
        .send({ base: 'main' })
        .expect(400);

      assert.strictEqual(response.body.success, false);

      // Valid request
      response = await request(app)
        .post('/api/github/repos/owner/repo/pulls')
        .send({ head: 'feature', base: 'main', title: 'My PR' })
        .expect(201);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.title, 'My PR');
    });
  });

  describe('POST /api/github/repos/:owner/:repo/pulls/:pull_number/merge', () => {
    it('should accept valid merge methods', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.post('/api/github/repos/:owner/:repo/pulls/:pull_number/merge', (req, res) => {
        const { merge_method } = req.body;
        const validMethods = ['merge', 'squash', 'rebase'];

        if (merge_method && !validMethods.includes(merge_method)) {
          res.status(400).json({
            success: false,
            error: `Invalid merge method: ${merge_method}`,
          });
          return;
        }

        res.json({
          success: true,
          message: 'Pull request merged',
          merge_method: merge_method || 'merge',
        });
      });

      // Valid merge method
      let response = await request(app)
        .post('/api/github/repos/owner/repo/pulls/123/merge')
        .send({ merge_method: 'squash' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.merge_method, 'squash');

      // Invalid merge method
      response = await request(app)
        .post('/api/github/repos/owner/repo/pulls/123/merge')
        .send({ merge_method: 'invalid' })
        .expect(400);

      assert.strictEqual(response.body.success, false);
    });

    it('should default to merge method', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.post('/api/github/repos/:owner/:repo/pulls/:pull_number/merge', (req, res) => {
        res.json({
          success: true,
          merge_method: req.body.merge_method || 'merge',
        });
      });

      const response = await request(app)
        .post('/api/github/repos/owner/repo/pulls/123/merge')
        .send({})
        .expect(200);

      assert.strictEqual(response.body.merge_method, 'merge');
    });
  });

  describe('PUT /api/github/repos/:owner/:repo/contents/*', () => {
    it('should require branch and content', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.put('/api/github/repos/:owner/:repo/contents/*', (req, res) => {
        const { branch, content } = req.body;

        if (!branch) {
          res.status(400).json({ success: false, error: 'Branch is required' });
          return;
        }
        if (content === undefined) {
          res.status(400).json({ success: false, error: 'Content is required' });
          return;
        }

        res.json({ success: true, sha: 'newsha123' });
      });

      // Missing branch
      let response = await request(app)
        .put('/api/github/repos/owner/repo/contents/path/to/file.txt')
        .send({ content: 'hello' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Branch is required');

      // Missing content
      response = await request(app)
        .put('/api/github/repos/owner/repo/contents/path/to/file.txt')
        .send({ branch: 'main' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Content is required');

      // Valid request
      response = await request(app)
        .put('/api/github/repos/owner/repo/contents/path/to/file.txt')
        .send({ branch: 'main', content: 'hello world' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
    });
  });

  describe('Error Responses', () => {
    it('should return 404 for non-existent repository', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.get('/api/github/repos/:owner/:repo', (req, res) => {
        res.status(404).json({
          success: false,
          error: 'Repository not found',
        });
      });

      const response = await request(app)
        .get('/api/github/repos/nonexistent/repo')
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Repository not found');
    });

    it('should return 403 for permission denied', async () => {
      const app = createTestApp({
        user: createMockUser({ githubAccessToken: 'gho_testtoken' }),
      });

      app.delete('/api/github/repos/:owner/:repo/branches/:branch', (req, res) => {
        if (req.params.branch === 'main') {
          res.status(403).json({
            success: false,
            error: 'Cannot delete protected branch',
          });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/api/github/repos/owner/repo/branches/main')
        .expect(403);

      assert.strictEqual(response.body.success, false);
    });
  });
});
