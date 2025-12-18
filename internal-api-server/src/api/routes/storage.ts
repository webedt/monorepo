/**
 * Storage Routes - Direct MinIO storage operations
 * Handles session tarball upload/download and file operations
 */

import { Router, Request, Response } from 'express';
import { Readable } from 'stream';
import { storageService } from '../../logic/storage/storageService.js';
import { logger } from '@webedt/shared';

const router = Router();

// Initialize storage service
storageService.initialize().catch(err => {
  logger.error('Failed to initialize storage service', err, { component: 'StorageRoutes' });
});

// ============================================================================
// SESSION ROUTES
// ============================================================================

// List all sessions
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const sessions = await storageService.listSessions();
    res.json({
      sessions: sessions.map(s => ({
        sessionId: s.sessionPath,
        ...s
      }))
    });
  } catch (error) {
    logger.error('Error listing sessions', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if session exists (HEAD request)
router.head('/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    const exists = await storageService.sessionExists(sessionPath);
    res.status(exists ? 200 : 404).end();
  } catch (error) {
    logger.error('Error checking session exists', error as Error, { component: 'StorageRoutes' });
    res.status(500).end();
  }
});

// Get session metadata
router.get('/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    const metadata = await storageService.getSessionMetadata(sessionPath);
    if (!metadata) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    res.json(metadata);
  } catch (error) {
    logger.error('Error getting session metadata', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download session tarball
router.get('/sessions/:sessionPath/download', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    logger.info(`Download session request: ${sessionPath}`, { component: 'StorageRoutes' });

    const exists = await storageService.sessionExists(sessionPath);
    if (!exists) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const stream = await storageService.getSessionStream(sessionPath);

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${sessionPath}.tar.gz"`);

    stream.pipe(res);

    stream.on('error', (err) => {
      logger.error('Error streaming session', err, { component: 'StorageRoutes' });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to download session' });
      }
    });
  } catch (error) {
    logger.error('Error downloading session', error as Error, { component: 'StorageRoutes' });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Upload session tarball
router.post('/sessions/:sessionPath/upload', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    logger.info(`Upload session request: ${sessionPath}`, { component: 'StorageRoutes' });

    const contentLength = req.headers['content-length'];
    const size = contentLength ? parseInt(contentLength, 10) : undefined;

    // Create a readable stream from the request
    const stream = req as unknown as Readable;

    await storageService.uploadSessionStream(sessionPath, stream, size);

    res.json({ success: true, sessionPath });
  } catch (error) {
    logger.error('Error uploading session', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete session
router.delete('/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    await storageService.deleteSession(sessionPath);
    res.json({ success: true, sessionPath });
  } catch (error) {
    logger.error('Error deleting session', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete sessions
router.post('/sessions/bulk-delete', async (req: Request, res: Response) => {
  try {
    const { sessionPaths } = req.body as { sessionPaths: string[] };

    if (!Array.isArray(sessionPaths)) {
      res.status(400).json({ error: 'sessionPaths must be an array' });
      return;
    }

    await storageService.deleteSessions(sessionPaths);
    res.json({ success: true, deleted: sessionPaths.length });
  } catch (error) {
    logger.error('Error bulk deleting sessions', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// FILE ROUTES
// ============================================================================

// List files in a session
router.get('/sessions/:sessionPath/files', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    const exists = await storageService.sessionExists(sessionPath);
    if (!exists) {
      res.json({
        sessionPath,
        count: 0,
        files: [],
        note: 'Session does not exist yet - no files uploaded',
      });
      return;
    }

    const files = await storageService.listSessionFiles(sessionPath);
    res.json({
      sessionPath,
      count: files.length,
      files,
    });
  } catch (error) {
    logger.error('Error listing files', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// HEAD request to check if a file exists
router.head('/sessions/:sessionPath/files/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const filePath = req.params[0];

  if (!filePath) {
    res.status(400).end();
    return;
  }

  try {
    const file = await storageService.getSessionFile(sessionPath, filePath);
    if (file) {
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Length', file.content.length);
      res.status(200).end();
    } else {
      res.status(404).end();
    }
  } catch (error) {
    logger.error('Error checking file', error as Error, { component: 'StorageRoutes' });
    res.status(500).end();
  }
});

// Get a specific file from a session
router.get('/sessions/:sessionPath/files/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const filePath = req.params[0];

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const file = await storageService.getSessionFile(sessionPath, filePath);
    if (!file) {
      res.status(404).json({ error: 'File not found' });
      return;
    }

    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.content.length);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(file.content);
  } catch (error) {
    logger.error('Error getting file', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Write/update a file in a session
router.put('/sessions/:sessionPath/files/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const filePath = req.params[0];

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const content = Buffer.concat(chunks);

    await storageService.writeSessionFile(sessionPath, filePath, content);
    res.json({ success: true, path: filePath });
  } catch (error) {
    logger.error('Error writing file', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a file from a session
router.delete('/sessions/:sessionPath/files/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const filePath = req.params[0];

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const deleted = await storageService.deleteSessionFile(sessionPath, filePath);
    if (!deleted) {
      res.status(404).json({ error: 'File not found' });
      return;
    }
    res.json({ success: true, path: filePath });
  } catch (error) {
    logger.error('Error deleting file', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a folder (and all its contents) from a session
router.delete('/sessions/:sessionPath/folders/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const folderPath = req.params[0];

  if (!folderPath) {
    res.status(400).json({ error: 'Folder path is required' });
    return;
  }

  try {
    const result = await storageService.deleteSessionFolder(sessionPath, folderPath);
    if (!result.deleted) {
      res.status(404).json({ error: 'Folder not found' });
      return;
    }
    res.json({ success: true, path: folderPath, filesDeleted: result.filesDeleted });
  } catch (error) {
    logger.error('Error deleting folder', error as Error, { component: 'StorageRoutes' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
