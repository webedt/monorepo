/**
 * Storage Worker Proxy Routes
 * Proxies all storage-worker requests to the storage-worker service
 * This acts as a pass-through to avoid CORS issues and centralize service communication
 */

import { Router, Request, Response } from 'express';
import { logger } from '../utils/logger.js';

const router = Router();

const STORAGE_WORKER_URL = process.env.STORAGE_WORKER_URL || 'http://storage-worker:3000';

logger.info(`Using storage worker URL: ${STORAGE_WORKER_URL}`, { component: 'StorageWorker' });

// ============================================================================
// FILE ROUTES
// ============================================================================

// HEAD request to check if a file exists
router.head('/sessions/:sessionPath/files/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const filePath = req.params[0];

  if (!filePath) {
    res.status(400).end();
    return;
  }

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files/${filePath}`, {
      method: 'HEAD',
    });

    res.status(response.status);
    if (response.headers.get('Content-Type')) {
      res.setHeader('Content-Type', response.headers.get('Content-Type')!);
    }
    if (response.headers.get('Content-Length')) {
      res.setHeader('Content-Length', response.headers.get('Content-Length')!);
    }
    res.end();
  } catch (error) {
    logger.error('Error checking file', error as Error, { component: 'StorageWorker' });
    res.status(500).end();
  }
});

// Get a specific file from a session
router.get('/sessions/:sessionPath/files/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const filePath = req.params[0];
  const targetUrl = `${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files/${filePath}`;

  logger.debug('GET file request', {
    component: 'StorageWorker',
    sessionPath,
    filePath,
    targetUrl,
  });

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const error = await response.text();
      logger.error(`Get file failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to get file' });
      return;
    }

    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    const contentLength = response.headers.get('Content-Length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'public, max-age=300');

    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        await pump();
      };
      await pump();
    } else {
      res.end();
    }
  } catch (error) {
    logger.error('Error getting file', error as Error, { component: 'StorageWorker' });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Write/update a file in a session
router.put('/sessions/:sessionPath/files/*', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const filePath = req.params[0];
  const contentType = req.get('content-type') || 'application/octet-stream';
  const targetUrl = `${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files/${filePath}`;

  logger.debug('PUT file request', {
    component: 'StorageWorker',
    sessionPath,
    filePath,
    contentType,
  });

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    logger.debug(`PUT file - body size: ${body.length} bytes`, { component: 'StorageWorker' });

    const response = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body,
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Write file failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to write file' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error writing file', error as Error, { component: 'StorageWorker' });
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
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files/${filePath}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const error = await response.text();
      logger.error(`Delete file failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to delete file' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error deleting file', error as Error, { component: 'StorageWorker' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List files in a session
router.get('/sessions/:sessionPath/files', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const targetUrl = `${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files`;

  logger.debug('List files request', {
    component: 'StorageWorker',
    sessionPath,
  });

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        // Session doesn't exist yet - return empty files array
        res.json({
          sessionPath,
          count: 0,
          files: [],
          note: 'Session does not exist yet - no files uploaded',
        });
        return;
      }
      const error = await response.text();
      logger.error(`List files failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to list files' });
      return;
    }

    const data = await response.json() as { files?: unknown[] };
    logger.debug(`List files success: ${data.files?.length || 0} files`, { component: 'StorageWorker' });
    res.json(data);
  } catch (error) {
    logger.error('Error listing files', error as Error, { component: 'StorageWorker' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// SESSION ROUTES
// ============================================================================

// List all sessions
router.get('/sessions', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`List sessions failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to list sessions' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error listing sessions', error as Error, { component: 'StorageWorker' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete sessions
router.post('/sessions/bulk-delete', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/bulk-delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Bulk delete sessions failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to bulk delete sessions' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error bulk deleting sessions', error as Error, { component: 'StorageWorker' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get session metadata
router.get('/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  const targetUrl = `${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}`;

  logger.debug('Get session metadata request', {
    component: 'StorageWorker',
    sessionPath,
  });

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const error = await response.text();
      logger.error(`Get session metadata failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to get session metadata' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error getting session metadata', error as Error, { component: 'StorageWorker' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if session exists (HEAD request)
router.head('/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}`, {
      method: 'HEAD',
    });

    res.status(response.status).end();
  } catch (error) {
    logger.error('Error checking session exists', error as Error, { component: 'StorageWorker' });
    res.status(500).end();
  }
});

// Upload session
router.post('/sessions/:sessionPath/upload', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': req.get('content-type') || 'application/gzip',
      },
      body: req.body,
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Upload session failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to upload session' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error uploading session', error as Error, { component: 'StorageWorker' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download session
router.get('/sessions/:sessionPath/download', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/download`, {
      method: 'GET',
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      const error = await response.text();
      logger.error(`Download session failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to download session' });
      return;
    }

    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', response.headers.get('Content-Disposition') || `attachment; filename="${sessionPath}.tar.gz"`);

    if (response.body) {
      const reader = response.body.getReader();
      const pump = async () => {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        res.write(value);
        await pump();
      };
      await pump();
    } else {
      res.end();
    }
  } catch (error) {
    logger.error('Error downloading session', error as Error, { component: 'StorageWorker' });
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete session
router.delete('/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error(`Delete session failed: ${error}`, undefined, { component: 'StorageWorker' });
      res.status(response.status).json({ error: 'Failed to delete session' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    logger.error('Error deleting session', error as Error, { component: 'StorageWorker' });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
