import { Router, Request, Response } from 'express';

const router = Router();

const STORAGE_WORKER_URL = process.env.STORAGE_WORKER_URL || 'http://storage-worker:3000';

console.log(`[StorageWorker] Using storage worker URL: ${STORAGE_WORKER_URL}`);

/**
 * Proxy all storage-worker requests to the storage-worker service
 * This acts as a pass-through to avoid CORS issues and centralize service communication
 */

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

// Get session metadata
router.get('/storage-worker/sessions/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionId}`, {
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
router.head('/storage-worker/sessions/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionId}`, {
      method: 'HEAD',
    });

    res.status(response.status).end();
  } catch (error) {
    console.error('[StorageWorker] Error checking session exists:', error);
    res.status(500).end();
  }
});

// Upload session
router.post('/storage-worker/sessions/:sessionId/upload', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionId}/upload`, {
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
router.get('/storage-worker/sessions/:sessionId/download', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionId}/download`, {
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
    res.setHeader('Content-Disposition', response.headers.get('Content-Disposition') || `attachment; filename="${sessionId}.tar.gz"`);

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
router.delete('/storage-worker/sessions/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;

  try {
    const response = await fetch(`${STORAGE_WORKER_URL}/api/storage-worker/sessions/${sessionId}`, {
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

// Bulk delete sessions
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

export default router;
