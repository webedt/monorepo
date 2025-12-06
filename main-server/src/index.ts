import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  PORT,
  NODE_ENV,
  CONTAINER_ID,
  ALLOWED_ORIGINS,
  BUILD_COMMIT_SHA,
  BUILD_TIMESTAMP,
  BUILD_IMAGE_TAG,
  ORPHAN_SESSION_TIMEOUT_MINUTES,
  ORPHAN_CLEANUP_INTERVAL_MINUTES,
  validateEnv,
  logEnvConfig
} from './config/env.js';

import { logger } from './utils/logger.js';

// Import database
import './db/index.js';

// Import routes
import executeRoutes from './routes/execute.js';
import resumeRoutes from './routes/resume.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import sessionsRoutes from './routes/sessions.js';
import githubRoutes from './routes/github.js';
import storageWorkerRoutes from './routes/storage-worker.js';

// Import middleware
import { authMiddleware } from './middleware/auth.js';

// Get __dirname equivalent for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Validate environment
const envValidation = validateEnv();
if (!envValidation.valid) {
  logger.warn('Environment validation warnings:', { errors: envValidation.errors.join(', ') });
}

// Middleware
app.use(
  cors({
    origin: ALLOWED_ORIGINS,
    credentials: true,
  })
);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Add auth middleware
app.use(authMiddleware);

// Health check endpoint
app.get('/health', (req, res) => {
  res.setHeader('X-Container-ID', CONTAINER_ID);
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'main-server',
      containerId: CONTAINER_ID,
      build: {
        commitSha: BUILD_COMMIT_SHA,
        timestamp: BUILD_TIMESTAMP,
        imageTag: BUILD_IMAGE_TAG,
      },
      timestamp: new Date().toISOString(),
    }
  });
});

// Add routes
app.use('/api', executeRoutes);
app.use('/api', resumeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/storage-worker', storageWorkerRoutes);

// Serve static files in production
if (NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../../website/apps/client/dist');
  app.use(express.static(clientDistPath));

  // Handle client-side routing - send index.html for non-API routes
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// Error handler
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
);

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🖥️  Main Server');
  console.log('='.repeat(60));
  console.log(`🆔 Container ID: ${CONTAINER_ID}`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log('');

  // Log environment configuration
  logEnvConfig();

  console.log('');
  console.log('Available endpoints:');
  console.log('  GET  /health                           - Health check');
  console.log('  POST /api/execute                      - Execute AI request (SSE)');
  console.log('  GET  /api/resume/:sessionId            - Resume session (SSE)');
  console.log('');
  console.log('  POST /api/auth/register                - Register new user');
  console.log('  POST /api/auth/login                   - Login');
  console.log('  POST /api/auth/logout                  - Logout');
  console.log('  GET  /api/auth/session                 - Get current session');
  console.log('');
  console.log('  POST /api/user/claude-auth             - Update Claude auth');
  console.log('  POST /api/user/preferred-provider      - Update preferred provider');
  console.log('');
  console.log('  GET  /api/sessions                     - List sessions');
  console.log('  GET  /api/sessions/:id                 - Get session');
  console.log('  DELETE /api/sessions/:id               - Delete session');
  console.log('');
  console.log('  GET  /api/github/oauth                 - Start GitHub OAuth');
  console.log('  GET  /api/github/repos                 - List repos');
  console.log('');
  console.log('  GET  /api/storage-worker/sessions/...  - Storage operations');
  console.log('='.repeat(60));

  // TODO: Add orphan session cleanup
  // Schedule periodic orphan cleanup
  // logger.info(`Scheduling orphan cleanup: timeout=${ORPHAN_SESSION_TIMEOUT_MINUTES}min, interval=${ORPHAN_CLEANUP_INTERVAL_MINUTES}min`);
  // setInterval(() => {
  //   cleanupOrphanedSessions();
  // }, ORPHAN_CLEANUP_INTERVAL_MINUTES * 60 * 1000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
