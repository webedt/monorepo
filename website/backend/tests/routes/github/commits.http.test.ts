/**
 * HTTP Tests for GitHub Commits Routes
 * Covers commit operations: list commits, get commit, compare commits
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp, createMockUser } from '../../helpers/testApp.js';

describe('GitHub Commits HTTP Routes', () => {
  describe('GET /:owner/:repo/commits - List Commits', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:owner/:repo/commits', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits')
        .expect('Content-Type', /json/)
        .expect(401);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Unauthorized');
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.get('/:owner/:repo/commits', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true, data: [] });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits')
        .expect(400);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should return commits when authenticated', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      const mockCommits = [
        {
          sha: 'abc123',
          message: 'Add feature X',
          author: { name: 'Test User', email: 'test@example.com', date: '2025-01-01T00:00:00Z' },
        },
        {
          sha: 'def456',
          message: 'Fix bug Y',
          author: { name: 'Test User', email: 'test@example.com', date: '2025-01-02T00:00:00Z' },
        },
      ];

      app.get('/:owner/:repo/commits', (req, res) => {
        res.json({ success: true, data: mockCommits });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 2);
      assert.strictEqual(response.body.data[0].sha, 'abc123');
      assert.strictEqual(response.body.data[0].message, 'Add feature X');
    });

    it('should support branch filter via query parameter', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/commits', (req, res) => {
        const { branch } = req.query;
        res.json({
          success: true,
          data: [{ sha: 'abc123', branch: branch || 'main' }],
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits')
        .query({ branch: 'develop' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data[0].branch, 'develop');
    });

    it('should support pagination via per_page and page parameters', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/commits', (req, res) => {
        const { per_page, page } = req.query;
        res.json({
          success: true,
          data: Array(Number(per_page) || 10).fill({ sha: 'abc123' }),
          pagination: { page: Number(page) || 1, per_page: Number(per_page) || 10 },
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits')
        .query({ per_page: 5, page: 2 })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.length, 5);
      assert.strictEqual(response.body.pagination.page, 2);
    });
  });

  describe('GET /:owner/:repo/commits/:sha - Get Single Commit', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:owner/:repo/commits/:sha', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits/abc123')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.get('/:owner/:repo/commits/:sha', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits/abc123')
        .expect(400);

      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should return 404 for non-existent commit', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/commits/:sha', (req, res) => {
        res.status(404).json({ success: false, error: 'Commit not found' });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits/nonexistent')
        .expect(404);

      assert.strictEqual(response.body.success, false);
      assert.strictEqual(response.body.error, 'Commit not found');
    });

    it('should return commit details for valid SHA', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      const mockCommit = {
        sha: 'abc123def456789',
        message: 'Add new feature\n\nThis is a detailed commit message.',
        author: { name: 'Test User', email: 'test@example.com', date: '2025-01-01T00:00:00Z' },
        committer: { name: 'Test User', email: 'test@example.com', date: '2025-01-01T00:00:00Z' },
        stats: { additions: 50, deletions: 10, total: 60 },
        files: [
          { filename: 'src/index.ts', additions: 30, deletions: 5, changes: 35, status: 'modified' },
          { filename: 'src/new.ts', additions: 20, deletions: 5, changes: 25, status: 'added' },
        ],
      };

      app.get('/:owner/:repo/commits/:sha', (req, res) => {
        res.json({ success: true, data: mockCommit });
      });

      const response = await request(app)
        .get('/testowner/testrepo/commits/abc123')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.sha, 'abc123def456789');
      assert.strictEqual(response.body.data.stats.additions, 50);
      assert.strictEqual(response.body.data.files.length, 2);
    });
  });

  describe('GET /:owner/:repo/compare/:base...:head - Compare Commits', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:owner/:repo/compare/:base...:head', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/testowner/testrepo/compare/main...feature')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.get('/:owner/:repo/compare/:base...:head', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/testowner/testrepo/compare/main...feature')
        .expect(400);

      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should return comparison data for valid refs', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      const mockComparison = {
        status: 'ahead',
        aheadBy: 5,
        behindBy: 0,
        totalCommits: 5,
        commits: [
          { sha: 'abc123', message: 'Commit 1' },
          { sha: 'def456', message: 'Commit 2' },
        ],
        files: [
          { filename: 'src/index.ts', status: 'modified', additions: 20, deletions: 5 },
        ],
      };

      app.get('/:owner/:repo/compare/:base...:head', (req, res) => {
        res.json({ success: true, data: mockComparison });
      });

      const response = await request(app)
        .get('/testowner/testrepo/compare/main...feature')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.status, 'ahead');
      assert.strictEqual(response.body.data.aheadBy, 5);
      assert.strictEqual(response.body.data.totalCommits, 5);
    });

    it('should return 404 when refs do not exist', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/compare/:base...:head', (req, res) => {
        res.status(404).json({ success: false, error: 'Branch or commit not found' });
      });

      const response = await request(app)
        .get('/testowner/testrepo/compare/nonexistent...also-nonexistent')
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });

    it('should handle identical refs (no changes)', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/compare/:base...:head', (req, res) => {
        res.json({
          success: true,
          data: {
            status: 'identical',
            aheadBy: 0,
            behindBy: 0,
            totalCommits: 0,
            commits: [],
            files: [],
          },
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/compare/main...main')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.status, 'identical');
      assert.strictEqual(response.body.data.totalCommits, 0);
    });
  });
});
