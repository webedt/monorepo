import { Router, Request, Response } from 'express';

const router = Router();

const STORAGE_WORKER_URL = process.env.STORAGE_WORKER_URL || 'http://storage-worker:3000';

console.log(`[StorageWorker] Using storage worker URL: ${STORAGE_WORKER_URL}`);

/**
 * Proxy all storage-worker requests to the storage-worker service
 * This acts as a pass-through to avoid CORS issues and centralize service communication
 *
 * IMPORTANT: Route order matters! More specific routes (regex patterns for multi-segment paths)
 * must be registered BEFORE simpler parameterized routes to ensure proper matching.
 * Session paths are multi-segment (owner/repo/branch where branch can contain /).
 */

// ============================================================================
// FILE ROUTES (must come first - more specific patterns)
// These use regex to capture multi-segment session paths
// ============================================================================

// HEAD request to check if a file exists
router.head(/^\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  const filePath = req.params[1];

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
    console.error('[StorageWorker] Error checking file:', error);
    res.status(500).end();
  }
});

// Get a specific file from a session
router.get(/^\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  const filePath = req.params[1];

  if (!filePath) {
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files/${filePath}`, {
      method: 'GET',
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'File not found' });
        return;
      }
      const error = await response.text();
      console.error('[StorageWorker] Get file failed:', error);
      res.status(response.status).json({ error: 'Failed to get file' });
      return;
    }

    // Forward the response with appropriate headers
    const contentType = response.headers.get('Content-Type') || 'application/octet-stream';
    const contentLength = response.headers.get('Content-Length');

    res.setHeader('Content-Type', contentType);
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes

    // Stream the response body
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
    console.error('[StorageWorker] Error getting file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Write/update a file in a session
router.put(/^\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  const filePath = req.params[1];
  const contentType = req.get('content-type') || 'application/octet-stream';
  const targetUrl = `${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files/${filePath}`;

  console.log('[StorageWorker] PUT file request:', {
    sessionPath,
    filePath,
    contentType,
    targetUrl,
  });

  if (!filePath) {
    console.log('[StorageWorker] PUT file failed: File path is required');
    res.status(400).json({ error: 'File path is required' });
    return;
  }

  try {
    // Get raw body - could be text or binary
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);

    console.log('[StorageWorker] PUT file - body size:', body.length, 'bytes');

    const response = await fetch(targetUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': contentType,
      },
      body,
    });

    console.log('[StorageWorker] PUT file - storage-worker response:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[StorageWorker] Write file failed:', {
        status: response.status,
        statusText: response.statusText,
        error,
        targetUrl,
      });
      res.status(response.status).json({ error: 'Failed to write file' });
      return;
    }

    const data = await response.json();
    console.log('[StorageWorker] PUT file success:', data);
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error writing file:', {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      targetUrl,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a file from a session
router.delete(/^\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  const filePath = req.params[1];

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
      console.error('[StorageWorker] Delete file failed:', error);
      res.status(response.status).json({ error: 'Failed to delete file' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error deleting file:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List files in a session
router.get(/^\/storage-worker\/sessions\/(.+)\/files$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}/files`, {
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
      console.error('[StorageWorker] List files failed:', error);
      res.status(response.status).json({ error: 'Failed to list files' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error listing files:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// SESSION ROUTES (simpler patterns - come after file routes)
// ============================================================================

// List all sessions
router.get('/storage-worker/sessions', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[StorageWorker] List sessions failed:', error);
      res.status(response.status).json({ error: 'Failed to list sessions' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error listing sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Bulk delete sessions (specific path, must come before :sessionId)
router.post('/storage-worker/sessions/bulk-delete', async (req: Request, res: Response) => {
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
      console.error('[StorageWorker] Bulk delete sessions failed:', error);
      res.status(response.status).json({ error: 'Failed to bulk delete sessions' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error bulk deleting sessions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get session metadata (uses regex to capture multi-segment session path)
router.get(/^\/storage-worker\/sessions\/([^/]+\/[^/]+\/.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}`, {
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
      console.error('[StorageWorker] Get session metadata failed:', error);
      res.status(response.status).json({ error: 'Failed to get session metadata' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error getting session metadata:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Check if session exists (HEAD request)
router.head(/^\/storage-worker\/sessions\/([^/]+\/[^/]+\/.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}`, {
      method: 'HEAD',
    });

    res.status(response.status).end();
  } catch (error) {
    console.error('[StorageWorker] Error checking session exists:', error);
    res.status(500).end();
  }
});

// Upload session
router.post(/^\/storage-worker\/sessions\/([^/]+\/[^/]+\/.+)\/upload$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];

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
      console.error('[StorageWorker] Upload session failed:', error);
      res.status(response.status).json({ error: 'Failed to upload session' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error uploading session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Download session
router.get(/^\/storage-worker\/sessions\/([^/]+\/[^/]+\/.+)\/download$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];

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
      console.error('[StorageWorker] Download session failed:', error);
      res.status(response.status).json({ error: 'Failed to download session' });
      return;
    }

    // Forward the stream
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
    console.error('[StorageWorker] Error downloading session:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// Delete session
router.delete(/^\/storage-worker\/sessions\/([^/]+\/[^/]+\/.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionPath}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[StorageWorker] Delete session failed:', error);
      res.status(response.status).json({ error: 'Failed to delete session' });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('[StorageWorker] Error deleting session:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
