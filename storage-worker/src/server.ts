import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StorageService } from './storageService';

const app = express();
const PORT = process.env.PORT || 3000;
const CONTAINER_ID = os.hostname();

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Create storage service
const storageService = new StorageService();

// Initialize storage service
storageService.initialize().catch((err) => {
  console.error('Failed to initialize storage service:', err);
  process.exit(1);
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.setHeader('X-Container-ID', CONTAINER_ID);
  res.json({
    status: 'ok',
    service: 'storage-worker',
    containerId: CONTAINER_ID,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Upload a session tarball
 * Expects multipart/form-data with a file field named 'tarball'
 */
app.post('/api/storage-worker/sessions/:sessionId/upload', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    // Check if request has a file (multipart) or raw body
    const contentType = req.get('content-type') || '';

    if (contentType.includes('application/octet-stream') || contentType.includes('application/gzip')) {
      // Handle raw binary upload
      const chunks: Buffer[] = [];

      req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      req.on('end', async () => {
        try {
          const buffer = Buffer.concat(chunks);

          // Save to temp file
          const tmpDir = os.tmpdir();
          const tmpFile = path.join(tmpDir, `${sessionId}-${Date.now()}.tar.gz`);
          fs.writeFileSync(tmpFile, buffer);

          // Upload to MinIO
          await storageService.uploadSession(sessionId, tmpFile);

          // Cleanup temp file
          fs.unlinkSync(tmpFile);

          res.json({
            sessionId,
            uploaded: true,
            size: buffer.length,
            containerId: CONTAINER_ID,
          });
        } catch (error) {
          console.error(`Error uploading session ${sessionId}:`, error);
          res.status(500).json({
            error: 'upload_failed',
            message: error instanceof Error ? error.message : 'Failed to upload session',
            containerId: CONTAINER_ID,
          });
        }
      });

      req.on('error', (error) => {
        console.error(`Error reading upload stream:`, error);
        res.status(500).json({
          error: 'upload_failed',
          message: 'Failed to read upload stream',
          containerId: CONTAINER_ID,
        });
      });
    } else {
      res.status(400).json({
        error: 'invalid_content_type',
        message: 'Expected application/octet-stream or application/gzip content type',
        containerId: CONTAINER_ID,
      });
    }
  } catch (error) {
    console.error(`Error uploading session ${sessionId}:`, error);
    res.status(500).json({
      error: 'upload_failed',
      message: error instanceof Error ? error.message : 'Failed to upload session',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Download a session tarball
 * Returns the tarball file as application/gzip
 */
app.get('/api/storage-worker/sessions/:sessionId/download', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    // Check if session exists
    const exists = await storageService.sessionExists(sessionId);
    if (!exists) {
      res.status(404).json({
        error: 'session_not_found',
        message: `Session ${sessionId} not found`,
        containerId: CONTAINER_ID,
      });
      return;
    }

    // Get session stream
    const stream = await storageService.getSessionStream(sessionId);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${sessionId}.tar.gz"`);

    // Pipe stream to response
    stream.pipe(res);

    stream.on('error', (error) => {
      console.error(`Error streaming session ${sessionId}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'download_failed',
          message: 'Failed to stream session',
          containerId: CONTAINER_ID,
        });
      }
    });
  } catch (error) {
    console.error(`Error downloading session ${sessionId}:`, error);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'download_failed',
        message: error instanceof Error ? error.message : 'Failed to download session',
        containerId: CONTAINER_ID,
      });
    }
  }
});

/**
 * List all sessions
 */
app.get('/api/storage-worker/sessions', async (req: Request, res: Response) => {
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    const sessions = await storageService.listSessions();

    res.json({
      count: sessions.length,
      sessions,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({
      error: 'list_failed',
      message: error instanceof Error ? error.message : 'Failed to list sessions',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Get session metadata
 */
app.get('/api/storage-worker/sessions/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    const metadata = await storageService.getSessionMetadata(sessionId);

    if (!metadata) {
      res.status(404).json({
        error: 'session_not_found',
        message: `Session ${sessionId} not found`,
        containerId: CONTAINER_ID,
      });
      return;
    }

    res.json({
      ...metadata,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error(`Error getting session metadata ${sessionId}:`, error);
    res.status(500).json({
      error: 'metadata_failed',
      message: error instanceof Error ? error.message : 'Failed to get session metadata',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Check if session exists
 */
app.head('/api/storage-worker/sessions/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    const exists = await storageService.sessionExists(sessionId);

    if (exists) {
      res.status(200).end();
    } else {
      res.status(404).end();
    }
  } catch (error) {
    console.error(`Error checking session ${sessionId}:`, error);
    res.status(500).end();
  }
});

/**
 * Delete a session
 */
app.delete('/api/storage-worker/sessions/:sessionId', async (req: Request, res: Response) => {
  const { sessionId } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    await storageService.deleteSession(sessionId);

    res.json({
      sessionId,
      deleted: true,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error(`Error deleting session ${sessionId}:`, error);
    res.status(500).json({
      error: 'delete_failed',
      message: error instanceof Error ? error.message : 'Failed to delete session',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Delete multiple sessions
 */
app.post('/api/storage-worker/sessions/bulk-delete', async (req: Request, res: Response) => {
  const { sessionIds } = req.body;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  if (!Array.isArray(sessionIds)) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'sessionIds must be an array',
      containerId: CONTAINER_ID,
    });
    return;
  }

  try {
    await storageService.deleteSessions(sessionIds);

    res.json({
      deletedCount: sessionIds.length,
      sessionIds,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error('Error bulk deleting sessions:', error);
    res.status(500).json({
      error: 'bulk_delete_failed',
      message: error instanceof Error ? error.message : 'Failed to bulk delete sessions',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Catch-all for undefined routes
 */
app.use((req: Request, res: Response) => {
  res.setHeader('X-Container-ID', CONTAINER_ID);
  res.status(404).json({
    error: 'not_found',
    message: `Endpoint not found: ${req.method} ${req.path}`,
    availableEndpoints: [
      'GET    /health',
      'POST   /api/storage-worker/sessions/:sessionId/upload',
      'GET    /api/storage-worker/sessions/:sessionId/download',
      'GET    /api/storage-worker/sessions',
      'GET    /api/storage-worker/sessions/:sessionId',
      'HEAD   /api/storage-worker/sessions/:sessionId',
      'DELETE /api/storage-worker/sessions/:sessionId',
      'POST   /api/storage-worker/sessions/bulk-delete',
    ],
    containerId: CONTAINER_ID,
  });
});

/**
 * Start the server
 */
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🗄️  Storage Worker (MinIO Service)');
  console.log('='.repeat(60));
  console.log(`🆔 Container ID: ${CONTAINER_ID}`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🗄️  MinIO Endpoint: ${process.env.MINIO_ENDPOINT || 'Not configured'}`);
  console.log(`📦 Bucket: ${process.env.MINIO_BUCKET || 'sessions'}`);
  console.log('');
  console.log('Available endpoints:');
  console.log('  GET    /health                                            - Health check');
  console.log('  POST   /api/storage-worker/sessions/:id/upload            - Upload session');
  console.log('  GET    /api/storage-worker/sessions/:id/download          - Download session');
  console.log('  GET    /api/storage-worker/sessions                       - List sessions');
  console.log('  GET    /api/storage-worker/sessions/:id                   - Get session metadata');
  console.log('  HEAD   /api/storage-worker/sessions/:id                   - Check session exists');
  console.log('  DELETE /api/storage-worker/sessions/:id                   - Delete session');
  console.log('  POST   /api/storage-worker/sessions/bulk-delete           - Bulk delete sessions');
  console.log('='.repeat(60));
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[Container ${CONTAINER_ID}] SIGTERM received, shutting down gracefully...`);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log(`[Container ${CONTAINER_ID}] SIGINT received, shutting down gracefully...`);
  process.exit(0);
});
