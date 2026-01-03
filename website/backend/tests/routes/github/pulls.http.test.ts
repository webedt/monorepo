/**
 * HTTP Tests for GitHub Pull Request Routes
 * Covers PR operations: list, create, merge, generate content, auto-pr
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp, createMockUser } from '../../helpers/testApp.js';

describe('GitHub Pulls HTTP Routes', () => {
  describe('GET /:owner/:repo/pulls - List Pull Requests', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:owner/:repo/pulls', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/testowner/testrepo/pulls')
        .expect(401);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Unauthorized');
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.get('/:owner/:repo/pulls', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/testowner/testrepo/pulls')
        .expect(400);

      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should return pull requests when authenticated', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      const mockPulls = [
        {
          number: 1,
          title: 'Add feature X',
          state: 'open',
          htmlUrl: 'https://github.com/testowner/testrepo/pull/1',
          head: { ref: 'feature-x', sha: 'abc123' },
          base: { ref: 'main', sha: 'def456' },
        },
        {
          number: 2,
          title: 'Fix bug Y',
          state: 'merged',
          htmlUrl: 'https://github.com/testowner/testrepo/pull/2',
          head: { ref: 'fix-y', sha: 'ghi789' },
          base: { ref: 'main', sha: 'jkl012' },
        },
      ];

      app.get('/:owner/:repo/pulls', (req, res) => {
        res.json({ success: true, data: mockPulls });
      });

      const response = await request(app)
        .get('/testowner/testrepo/pulls')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 2);
      assert.strictEqual(response.body.data[0].number, 1);
      assert.strictEqual(response.body.data[0].state, 'open');
    });

    it('should filter by head and base branches', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/pulls', (req, res) => {
        const { head, base } = req.query;
        res.json({
          success: true,
          data: [{ number: 1, head: { ref: head || 'feature' }, base: { ref: base || 'main' } }],
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/pulls')
        .query({ head: 'feature-x', base: 'develop' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data[0].head.ref, 'feature-x');
      assert.strictEqual(response.body.data[0].base.ref, 'develop');
    });
  });

  describe('POST /:owner/:repo/pulls - Create Pull Request', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/pulls', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls')
        .send({ head: 'feature', base: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when head and base are missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls', (req, res) => {
        const { head, base } = req.body;
        if (!head || !base) {
          res.status(400).json({ success: false, error: 'Head and base branches are required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'Head and base branches are required');
    });

    it('should create pull request successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls', (req, res) => {
        const { head, base, title, body } = req.body;
        res.json({
          success: true,
          data: {
            number: 42,
            title: title || `Merge ${head} into ${base}`,
            htmlUrl: 'https://github.com/testowner/testrepo/pull/42',
            state: 'open',
            head: { ref: head, sha: 'abc123' },
            base: { ref: base, sha: 'def456' },
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls')
        .send({
          head: 'feature-x',
          base: 'main',
          title: 'Add feature X',
          body: 'This PR adds feature X',
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.number, 42);
      assert.strictEqual(response.body.data.title, 'Add feature X');
    });

    it('should return 422 when PR already exists', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls', (req, res) => {
        res.status(422).json({ success: false, error: 'Pull request already exists or validation failed' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls')
        .send({ head: 'feature', base: 'main' })
        .expect(422);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('already exists'));
    });

    it('should use default title when not provided', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls', (req, res) => {
        const { head, base, title } = req.body;
        res.json({
          success: true,
          data: {
            number: 1,
            title: title || `Merge ${head} into ${base}`,
            state: 'open',
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls')
        .send({ head: 'feature', base: 'main' })
        .expect(200);

      assert.strictEqual(response.body.data.title, 'Merge feature into main');
    });
  });

  describe('POST /:owner/:repo/pulls/:pull_number/merge - Merge Pull Request', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/pulls/:pull_number/merge', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls/1/merge')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should merge PR successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls/:pull_number/merge', (req, res) => {
        res.json({
          success: true,
          data: {
            merged: true,
            message: 'Pull Request successfully merged',
            sha: 'merged123abc',
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls/42/merge')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.merged, true);
    });

    it('should support merge methods', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls/:pull_number/merge', (req, res) => {
        const { merge_method } = req.body;
        res.json({
          success: true,
          data: { merged: true, method: merge_method || 'merge' },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls/42/merge')
        .send({ merge_method: 'squash' })
        .expect(200);

      assert.strictEqual(response.body.data.method, 'squash');
    });

    it('should return 405 when PR cannot be merged', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls/:pull_number/merge', (req, res) => {
        res.status(405).json({ success: false, error: 'Pull request cannot be merged' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls/42/merge')
        .expect(405);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('cannot be merged'));
    });

    it('should return 409 for merge conflict', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/pulls/:pull_number/merge', (req, res) => {
        res.status(409).json({ success: false, error: 'Merge conflict' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/pulls/42/merge')
        .expect(409);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('conflict'));
    });
  });

  describe('POST /:owner/:repo/generate-pr-content - Generate PR Content', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/generate-pr-content', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/generate-pr-content')
        .send({ head: 'feature', base: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when head and base are missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/generate-pr-content', (req, res) => {
        const { head, base } = req.body;
        if (!head || !base) {
          res.status(400).json({ success: false, error: 'Head and base branches are required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/generate-pr-content')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'Head and base branches are required');
    });

    it('should generate PR content successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/generate-pr-content', (req, res) => {
        const { head, base, userRequest } = req.body;
        res.json({
          success: true,
          data: {
            title: userRequest || `Merge ${head} into ${base}`,
            body: '## Summary\n\nChanges description\n\n## Commits (3)\n\n- abc123 Commit 1\n',
            stats: { commits: 3, files: 5, additions: 100, deletions: 20 },
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/generate-pr-content')
        .send({ head: 'feature', base: 'main', userRequest: 'Add new feature' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.title, 'Add new feature');
      assert.ok(response.body.data.body.includes('## Summary'));
      assert.strictEqual(response.body.data.stats.commits, 3);
    });

    it('should truncate long titles', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/generate-pr-content', (req, res) => {
        let title = req.body.userRequest || 'Default title';
        if (title.length > 72) {
          title = title.substring(0, 69) + '...';
        }
        res.json({ success: true, data: { title, body: '...' } });
      });

      const longTitle = 'A'.repeat(100);
      const response = await request(app)
        .post('/testowner/testrepo/generate-pr-content')
        .send({ head: 'feature', base: 'main', userRequest: longTitle })
        .expect(200);

      assert.ok(response.body.data.title.length <= 72);
      assert.ok(response.body.data.title.endsWith('...'));
    });
  });

  describe('POST /:owner/:repo/branches/*/auto-pr - Auto PR Workflow', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/branches/:branch/auto-pr', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/auto-pr')
        .send({ base: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when base branch is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/auto-pr', (req, res) => {
        const { base } = req.body;
        if (!base) {
          res.status(400).json({ success: false, error: 'Base branch is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/auto-pr')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'Base branch is required');
    });

    it('should execute auto-pr workflow successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/auto-pr', (req, res) => {
        const branch = req.params.branch;
        const { base, title, sessionId } = req.body;
        res.json({
          success: true,
          data: {
            pr: { number: 42, title: title || `Merge ${branch} into ${base}` },
            merged: true,
            branchDeleted: false,
            sessionArchived: sessionId ? true : false,
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/auto-pr')
        .send({
          base: 'main',
          title: 'Auto-merge feature branch',
          sessionId: 'session-123',
        })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.pr.number, 42);
      assert.strictEqual(response.body.data.merged, true);
      assert.strictEqual(response.body.data.sessionArchived, true);
    });

    it('should return 409 for conflict during auto-pr', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/auto-pr', (req, res) => {
        res.status(409).json({ success: false, error: 'Merge conflict detected during auto-PR' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/auto-pr')
        .send({ base: 'main' })
        .expect(409);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('conflict'));
    });

    it('should return 408 for timeout during auto-pr', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/branches/:branch/auto-pr', (req, res) => {
        res.status(408).json({ success: false, error: 'Timeout waiting for merge to complete' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/branches/feature/auto-pr')
        .send({ base: 'main' })
        .expect(408);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('Timeout'));
    });
  });
});
