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

// Build information (set at build time via Docker build args)
const BUILD_COMMIT_SHA = process.env.BUILD_COMMIT_SHA || 'unknown';
const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || 'unknown';
const BUILD_IMAGE_TAG = process.env.BUILD_IMAGE_TAG || 'unknown';

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Path prefix normalization middleware
// This handles cases where the /api/storage-worker prefix is stripped by a reverse proxy
// or when clients connect directly without the prefix
app.use((req, res, next) => {
  // If the request path starts with /sessions and not /api/storage-worker/sessions,
  // add the expected prefix for consistent routing
  if (req.path.startsWith('/sessions') && !req.path.startsWith('/api/storage-worker/sessions')) {
    req.url = '/api/storage-worker' + req.url;
    console.log(`[PathNormalization] Normalized path to: ${req.url}`);
  }
  next();
});

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
    build: {
      commitSha: BUILD_COMMIT_SHA,
      timestamp: BUILD_TIMESTAMP,
      imageTag: BUILD_IMAGE_TAG,
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * Upload a session tarball
 * Expects multipart/form-data with a file field named 'tarball'
 */
app.post('/api/storage-worker/sessions/:sessionPath/upload', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
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
          const tmpFile = path.join(tmpDir, `${sessionPath}-${Date.now()}.tar.gz`);
          fs.writeFileSync(tmpFile, buffer);

          // Upload to MinIO
          await storageService.uploadSession(sessionPath, tmpFile);

          // Cleanup temp file
          fs.unlinkSync(tmpFile);

          res.json({
            sessionPath,
            uploaded: true,
            size: buffer.length,
            containerId: CONTAINER_ID,
          });
        } catch (error) {
          console.error(`Error uploading session ${sessionPath}:`, error);
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
    console.error(`Error uploading session ${sessionPath}:`, error);
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
app.get('/api/storage-worker/sessions/:sessionPath/download', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    // Check if session exists
    const exists = await storageService.sessionExists(sessionPath);
    if (!exists) {
      res.status(404).json({
        error: 'session_not_found',
        message: `Session ${sessionPath} not found`,
        containerId: CONTAINER_ID,
      });
      return;
    }

    // Get session stream
    const stream = await storageService.getSessionStream(sessionPath);

    // Set headers for file download
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${sessionPath}.tar.gz"`);

    // Pipe stream to response
    stream.pipe(res);

    stream.on('error', (error) => {
      console.error(`Error streaming session ${sessionPath}:`, error);
      if (!res.headersSent) {
        res.status(500).json({
          error: 'download_failed',
          message: 'Failed to stream session',
          containerId: CONTAINER_ID,
        });
      }
    });
  } catch (error) {
    console.error(`Error downloading session ${sessionPath}:`, error);
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
app.get('/api/storage-worker/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    const metadata = await storageService.getSessionMetadata(sessionPath);

    if (!metadata) {
      res.status(404).json({
        error: 'session_not_found',
        message: `Session ${sessionPath} not found`,
        containerId: CONTAINER_ID,
      });
      return;
    }

    res.json({
      ...metadata,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error(`Error getting session metadata ${sessionPath}:`, error);
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
app.head('/api/storage-worker/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    const exists = await storageService.sessionExists(sessionPath);

    if (exists) {
      res.status(200).end();
    } else {
      res.status(404).end();
    }
  } catch (error) {
    console.error(`Error checking session ${sessionPath}:`, error);
    res.status(500).end();
  }
});

/**
 * Delete a session
 */
app.delete('/api/storage-worker/sessions/:sessionPath', async (req: Request, res: Response) => {
  const { sessionPath } = req.params;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    await storageService.deleteSession(sessionPath);

    res.json({
      sessionPath,
      deleted: true,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error(`Error deleting session ${sessionPath}:`, error);
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
  const { sessionPaths } = req.body;
  res.setHeader('X-Container-ID', CONTAINER_ID);

  if (!Array.isArray(sessionPaths)) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'sessionPaths must be an array',
      containerId: CONTAINER_ID,
    });
    return;
  }

  try {
    await storageService.deleteSessions(sessionPaths);

    res.json({
      deletedCount: sessionPaths.length,
      sessionPaths,
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
 * List files in a session
 * GET /api/storage-worker/sessions/.../files
 * Note: Using regex to capture multi-segment session paths (e.g., owner/repo/branch)
 */
app.get(/^\/api\/storage-worker\/sessions\/(.+)\/files$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  res.setHeader('X-Container-ID', CONTAINER_ID);

  try {
    // Check if session exists
    const exists = await storageService.sessionExists(sessionPath);
    if (!exists) {
      res.status(404).json({
        error: 'session_not_found',
        message: `Session ${sessionPath} not found`,
        containerId: CONTAINER_ID,
      });
      return;
    }

    const files = await storageService.listSessionFiles(sessionPath);

    res.json({
      sessionPath,
      count: files.length,
      files,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error(`Error listing files in session ${sessionPath}:`, error);
    res.status(500).json({
      error: 'list_files_failed',
      message: error instanceof Error ? error.message : 'Failed to list session files',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Check if a specific file exists in a session
 * HEAD /api/storage-worker/sessions/.../files/...
 * Returns 200 if file exists, 404 if not
 */
app.head(/^\/api\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  const filePath = req.params[1];
  res.setHeader('X-Container-ID', CONTAINER_ID);

  if (!filePath) {
    res.status(400).end();
    return;
  }

  try {
    // First check if session exists
    const sessionExists = await storageService.sessionExists(sessionPath);
    if (!sessionExists) {
      res.status(404).end();
      return;
    }

    // Try to get the file (we need to actually check if it exists in the tarball)
    const result = await storageService.getSessionFile(sessionPath, filePath);

    if (!result) {
      res.status(404).end();
      return;
    }

    // File exists, return headers
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.content.length);
    res.status(200).end();
  } catch (error) {
    console.error(`Error checking file ${filePath} in session ${sessionPath}:`, error);
    res.status(500).end();
  }
});

/**
 * Get a specific file from a session
 * GET /api/storage-worker/sessions/.../files/...
 * Note: Using regex to capture multi-segment session paths and file paths
 * Returns raw file content with appropriate Content-Type
 */
app.get(/^\/api\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0]; // e.g., owner/repo/branch
  const filePath = req.params[1]; // The file path after /files/
  res.setHeader('X-Container-ID', CONTAINER_ID);

  console.log(`[READ] Request details:`, {
    originalUrl: req.originalUrl,
    sessionPath,
    filePath,
    expectedMinioPath: `${sessionPath}/session.tar.gz`,
    containerId: CONTAINER_ID,
  });

  if (!filePath) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'File path is required',
      containerId: CONTAINER_ID,
    });
    return;
  }

  try {
    // First check if session exists
    const sessionExists = await storageService.sessionExists(sessionPath);
    console.log(`[READ] Session exists check: ${sessionPath} -> ${sessionExists}`);

    if (!sessionExists) {
      // List all sessions to help debug
      const allSessions = await storageService.listSessions();
      console.log(`[READ] Session not found. Available sessions:`, allSessions.map(s => s.sessionPath));
      res.status(404).json({
        error: 'session_not_found',
        message: `Session ${sessionPath} not found`,
        requestedSessionPath: sessionPath,
        availableSessions: allSessions.map(s => s.sessionPath).slice(0, 10), // Show first 10
        containerId: CONTAINER_ID,
      });
      return;
    }

    const result = await storageService.getSessionFile(sessionPath, filePath);

    if (!result) {
      // List files in the session to help debug
      const files = await storageService.listSessionFiles(sessionPath);
      console.log(`[READ] File not found in session. Available files:`, files.map(f => f.path).slice(0, 20));
      res.status(404).json({
        error: 'file_not_found',
        message: `File ${filePath} not found in session ${sessionPath}`,
        requestedFilePath: filePath,
        availableFiles: files.map(f => f.path).slice(0, 20), // Show first 20 files
        containerId: CONTAINER_ID,
      });
      return;
    }

    // Set appropriate headers
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Content-Length', result.content.length);
    res.setHeader('Cache-Control', 'public, max-age=300'); // Cache for 5 minutes

    // Send raw content
    res.send(result.content);
  } catch (error) {
    console.error(`Error getting file ${filePath} from session ${sessionPath}:`, error);
    res.status(500).json({
      error: 'get_file_failed',
      message: error instanceof Error ? error.message : 'Failed to get file',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Write/update a file in a session
 * PUT /api/storage-worker/sessions/.../files/...
 * Expects raw file content in the request body
 */
app.put(/^\/api\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, express.raw({ type: '*/*', limit: '50mb' }), async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  const filePath = req.params[1];
  res.setHeader('X-Container-ID', CONTAINER_ID);

  console.log(`[WRITE] session-id: ${sessionPath}, file: ${filePath}, container: ${CONTAINER_ID}`);

  if (!filePath) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'File path is required',
      containerId: CONTAINER_ID,
    });
    return;
  }

  try {
    const content = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body);
    await storageService.writeSessionFile(sessionPath, filePath, content);

    res.json({
      success: true,
      sessionPath,
      filePath,
      size: content.length,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error(`Error writing file ${filePath} to session ${sessionPath}:`, error);
    res.status(500).json({
      error: 'write_file_failed',
      message: error instanceof Error ? error.message : 'Failed to write file',
      containerId: CONTAINER_ID,
    });
  }
});

/**
 * Delete a file from a session
 * DELETE /api/storage-worker/sessions/.../files/...
 */
app.delete(/^\/api\/storage-worker\/sessions\/(.+)\/files\/(.+)$/, async (req: Request, res: Response) => {
  const sessionPath = req.params[0];
  const filePath = req.params[1];
  res.setHeader('X-Container-ID', CONTAINER_ID);

  if (!filePath) {
    res.status(400).json({
      error: 'invalid_request',
      message: 'File path is required',
      containerId: CONTAINER_ID,
    });
    return;
  }

  try {
    const deleted = await storageService.deleteSessionFile(sessionPath, filePath);

    if (!deleted) {
      res.status(404).json({
        error: 'file_not_found',
        message: `File ${filePath} not found in session ${sessionPath}`,
        containerId: CONTAINER_ID,
      });
      return;
    }

    res.json({
      success: true,
      sessionPath,
      filePath,
      containerId: CONTAINER_ID,
    });
  } catch (error) {
    console.error(`Error deleting file ${filePath} from session ${sessionPath}:`, error);
    res.status(500).json({
      error: 'delete_file_failed',
      message: error instanceof Error ? error.message : 'Failed to delete file',
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
      'POST   /api/storage-worker/sessions/:sessionPath/upload',
      'GET    /api/storage-worker/sessions/:sessionPath/download',
      'GET    /api/storage-worker/sessions',
      'GET    /api/storage-worker/sessions/:sessionPath',
      'HEAD   /api/storage-worker/sessions/:sessionPath',
      'DELETE /api/storage-worker/sessions/:sessionPath',
      'POST   /api/storage-worker/sessions/bulk-delete',
      'GET    /api/storage-worker/sessions/:sessionPath/files',
      'GET    /api/storage-worker/sessions/:sessionPath/files/*',
      'PUT    /api/storage-worker/sessions/:sessionPath/files/*',
      'DELETE /api/storage-worker/sessions/:sessionPath/files/*',
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
  console.log('  GET    /api/storage-worker/sessions/:id/files             - List files in session');
  console.log('  GET    /api/storage-worker/sessions/:id/files/*           - Get file from session');
  console.log('  PUT    /api/storage-worker/sessions/:id/files/*           - Write file to session');
  console.log('  DELETE /api/storage-worker/sessions/:id/files/*           - Delete file from session');
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
