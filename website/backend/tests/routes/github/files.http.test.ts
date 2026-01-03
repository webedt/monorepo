/**
 * HTTP Tests for GitHub Files Routes
 * Covers file operations: tree, contents, update, delete, rename, folders
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import { createTestApp, createMockUser } from '../../helpers/testApp.js';

describe('GitHub Files HTTP Routes', () => {
  describe('GET /:owner/:repo/tree/* - Get File Tree', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:owner/:repo/tree/:branch', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/testowner/testrepo/tree/main')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when GitHub is not connected', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: null }) });

      app.get('/:owner/:repo/tree/:branch', (req, res) => {
        if (!req.user?.githubAccessToken) {
          res.status(400).json({ success: false, error: 'GitHub not connected' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/testowner/testrepo/tree/main')
        .expect(400);

      assert.strictEqual(response.body.error, 'GitHub not connected');
    });

    it('should return file tree successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      const mockTree = {
        sha: 'tree123',
        tree: [
          { path: 'src/index.ts', type: 'blob', sha: 'abc123', size: 1024 },
          { path: 'src', type: 'tree', sha: 'def456', size: null },
          { path: 'package.json', type: 'blob', sha: 'ghi789', size: 512 },
        ],
        truncated: false,
      };

      app.get('/:owner/:repo/tree/:branch', (req, res) => {
        res.json({ success: true, data: mockTree });
      });

      const response = await request(app)
        .get('/testowner/testrepo/tree/main')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.sha, 'tree123');
      assert.strictEqual(response.body.data.tree.length, 3);
    });

    it('should support recursive tree fetch', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/tree/:branch', (req, res) => {
        const { recursive } = req.query;
        res.json({
          success: true,
          data: {
            sha: 'tree123',
            tree: recursive === 'true' ? [
              { path: 'src/index.ts' },
              { path: 'src/lib/utils.ts' },
              { path: 'src/lib/helpers.ts' },
            ] : [
              { path: 'src' },
              { path: 'package.json' },
            ],
            truncated: false,
          },
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/tree/main')
        .query({ recursive: 'true' })
        .expect(200);

      assert.strictEqual(response.body.data.tree.length, 3);
    });

    it('should return 404 for non-existent branch', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/tree/:branch', (req, res) => {
        res.status(404).json({ success: false, error: 'Branch or repository not found' });
      });

      const response = await request(app)
        .get('/testowner/testrepo/tree/nonexistent')
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('GET /:owner/:repo/contents/* - Get File Contents', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.get('/:owner/:repo/contents/*', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/testowner/testrepo/contents/src/index.ts')
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return file contents successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/contents/*', (req, res) => {
        res.json({
          success: true,
          data: {
            name: 'index.ts',
            path: 'src/index.ts',
            sha: 'abc123',
            size: 1024,
            type: 'file',
            content: 'export const hello = "world";',
            encoding: 'utf-8',
          },
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/contents/src/index.ts')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.name, 'index.ts');
      assert.strictEqual(response.body.data.type, 'file');
      assert.ok(response.body.data.content);
    });

    it('should return directory contents', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/contents/*', (req, res) => {
        res.json({
          success: true,
          data: {
            type: 'dir',
            items: [
              { name: 'index.ts', path: 'src/index.ts', type: 'file', sha: 'abc123', size: 1024 },
              { name: 'utils', path: 'src/utils', type: 'dir', sha: 'def456', size: null },
            ],
          },
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/contents/src')
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.type, 'dir');
      assert.strictEqual(response.body.data.items.length, 2);
    });

    it('should return base64 for binary files', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/contents/*', (req, res) => {
        res.json({
          success: true,
          data: {
            name: 'image.png',
            path: 'assets/image.png',
            sha: 'abc123',
            size: 5000,
            type: 'file',
            content: 'iVBORw0KGgoAAAANSUhEUgAAAA...',
            encoding: 'base64',
            download_url: 'https://raw.githubusercontent.com/...',
          },
        });
      });

      const response = await request(app)
        .get('/testowner/testrepo/contents/assets/image.png')
        .expect(200);

      assert.strictEqual(response.body.data.encoding, 'base64');
    });

    it('should return 404 for non-existent file', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.get('/:owner/:repo/contents/*', (req, res) => {
        res.status(404).json({ success: false, error: 'File or path not found' });
      });

      const response = await request(app)
        .get('/testowner/testrepo/contents/nonexistent.ts')
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('PUT /:owner/:repo/contents/* - Update/Create File', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.put('/:owner/:repo/contents/*', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .put('/testowner/testrepo/contents/src/index.ts')
        .send({ content: 'new content', branch: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when branch is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.put('/:owner/:repo/contents/*', (req, res) => {
        const { branch } = req.body;
        if (!branch) {
          res.status(400).json({ success: false, error: 'Branch is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .put('/testowner/testrepo/contents/src/index.ts')
        .send({ content: 'new content' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Branch is required');
    });

    it('should return 400 when content is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.put('/:owner/:repo/contents/*', (req, res) => {
        const { content } = req.body;
        if (content === undefined) {
          res.status(400).json({ success: false, error: 'Content is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .put('/testowner/testrepo/contents/src/index.ts')
        .send({ branch: 'main' })
        .expect(400);

      assert.strictEqual(response.body.error, 'Content is required');
    });

    it('should update file successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.put('/:owner/:repo/contents/*', (req, res) => {
        res.json({
          success: true,
          data: {
            message: 'File updated successfully',
            sha: 'newsha123',
            path: 'src/index.ts',
          },
        });
      });

      const response = await request(app)
        .put('/testowner/testrepo/contents/src/index.ts')
        .send({ content: 'updated content', branch: 'main', sha: 'oldsha' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('updated'));
    });

    it('should create file when sha is not provided', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.put('/:owner/:repo/contents/*', (req, res) => {
        const { sha } = req.body;
        res.json({
          success: true,
          data: {
            message: sha ? 'File updated successfully' : 'File created successfully',
            sha: 'newsha123',
            path: 'src/newfile.ts',
          },
        });
      });

      const response = await request(app)
        .put('/testowner/testrepo/contents/src/newfile.ts')
        .send({ content: 'new file content', branch: 'main' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('created'));
    });

    it('should return 409 for conflict', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.put('/:owner/:repo/contents/*', (req, res) => {
        res.status(409).json({ success: false, error: 'Conflict - file may have been modified. Please refresh and try again.' });
      });

      const response = await request(app)
        .put('/testowner/testrepo/contents/src/index.ts')
        .send({ content: 'new content', branch: 'main', sha: 'oldsha' })
        .expect(409);

      assert.strictEqual(response.body.success, false);
      assert.ok(response.body.error.includes('Conflict'));
    });
  });

  describe('DELETE /:owner/:repo/contents/* - Delete File', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/:owner/:repo/contents/*', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/contents/src/index.ts')
        .send({ branch: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when branch is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.delete('/:owner/:repo/contents/*', (req, res) => {
        const { branch } = req.body;
        if (!branch) {
          res.status(400).json({ success: false, error: 'Branch is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/contents/src/index.ts')
        .send({})
        .expect(400);

      assert.strictEqual(response.body.error, 'Branch is required');
    });

    it('should delete file successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.delete('/:owner/:repo/contents/*', (req, res) => {
        res.json({ success: true, data: { message: 'File deleted successfully' } });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/contents/src/index.ts')
        .send({ branch: 'main', sha: 'abc123' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.ok(response.body.data.message.includes('deleted'));
    });

    it('should return 404 when file not found', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.delete('/:owner/:repo/contents/*', (req, res) => {
        res.status(404).json({ success: false, error: 'File not found' });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/contents/nonexistent.ts')
        .send({ branch: 'main' })
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('POST /:owner/:repo/rename/* - Rename File', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/rename/*', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename/src/old.ts')
        .send({ newPath: 'src/new.ts', branch: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when newPath is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/rename/*', (req, res) => {
        const { newPath } = req.body;
        if (!newPath) {
          res.status(400).json({ success: false, error: 'New path is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename/src/old.ts')
        .send({ branch: 'main' })
        .expect(400);

      assert.strictEqual(response.body.error, 'New path is required');
    });

    it('should return 400 when old and new path are the same', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/rename/:oldPath(*)', (req, res) => {
        const oldPath = req.params.oldPath;
        const { newPath } = req.body;
        if (oldPath === newPath) {
          res.status(400).json({ success: false, error: 'New path must be different from old path' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename/src/index.ts')
        .send({ newPath: 'src/index.ts', branch: 'main' })
        .expect(400);

      assert.strictEqual(response.body.error, 'New path must be different from old path');
    });

    it('should rename file successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/rename/:oldPath(*)', (req, res) => {
        const oldPath = req.params.oldPath;
        const { newPath } = req.body;
        res.json({
          success: true,
          data: { message: 'File renamed successfully', oldPath, newPath },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename/src/old.ts')
        .send({ newPath: 'src/new.ts', branch: 'main' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.oldPath, 'src/old.ts');
      assert.strictEqual(response.body.data.newPath, 'src/new.ts');
    });

    it('should return 422 when file already exists at new path', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/rename/*', (req, res) => {
        res.status(422).json({ success: false, error: 'File already exists at new path' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename/src/old.ts')
        .send({ newPath: 'src/existing.ts', branch: 'main' })
        .expect(422);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('DELETE /:owner/:repo/folder/* - Delete Folder', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.delete('/:owner/:repo/folder/*', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/folder/src/utils')
        .send({ branch: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should delete folder successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.delete('/:owner/:repo/folder/:path(*)', (req, res) => {
        res.json({
          success: true,
          data: {
            message: 'Folder deleted successfully',
            path: req.params.path,
            filesDeleted: 5,
          },
        });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/folder/src/utils')
        .send({ branch: 'main' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.filesDeleted, 5);
    });

    it('should return 404 when folder is empty or not found', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.delete('/:owner/:repo/folder/*', (req, res) => {
        res.status(404).json({ success: false, error: 'Folder is empty or not found' });
      });

      const response = await request(app)
        .delete('/testowner/testrepo/folder/nonexistent')
        .send({ branch: 'main' })
        .expect(404);

      assert.strictEqual(response.body.success, false);
    });
  });

  describe('POST /:owner/:repo/rename-folder/* - Rename Folder', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const app = createTestApp({ user: null, authSession: null });

      app.post('/:owner/:repo/rename-folder/*', (req, res) => {
        if (!req.user) {
          res.status(401).json({ success: false, error: 'Unauthorized' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename-folder/src/old')
        .send({ newFolderPath: 'src/new', branch: 'main' })
        .expect(401);

      assert.strictEqual(response.body.success, false);
    });

    it('should return 400 when newFolderPath is missing', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/rename-folder/*', (req, res) => {
        const { newFolderPath } = req.body;
        if (!newFolderPath) {
          res.status(400).json({ success: false, error: 'New folder path is required' });
          return;
        }
        res.json({ success: true });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename-folder/src/old')
        .send({ branch: 'main' })
        .expect(400);

      assert.strictEqual(response.body.error, 'New folder path is required');
    });

    it('should rename folder successfully', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/rename-folder/:oldPath(*)', (req, res) => {
        const oldPath = req.params.oldPath;
        const { newFolderPath } = req.body;
        res.json({
          success: true,
          data: {
            message: 'Folder renamed successfully',
            oldPath,
            newPath: newFolderPath,
            filesMoved: 10,
          },
        });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename-folder/src/old')
        .send({ newFolderPath: 'src/new', branch: 'main' })
        .expect(200);

      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.filesMoved, 10);
    });

    it('should return 422 when files already exist at new path', async () => {
      const app = createTestApp({ user: createMockUser({ githubAccessToken: 'gho_test' }) });

      app.post('/:owner/:repo/rename-folder/*', (req, res) => {
        res.status(422).json({ success: false, error: 'Files already exist at new path' });
      });

      const response = await request(app)
        .post('/testowner/testrepo/rename-folder/src/old')
        .send({ newFolderPath: 'src/existing', branch: 'main' })
        .expect(422);

      assert.strictEqual(response.body.success, false);
    });
  });
});
