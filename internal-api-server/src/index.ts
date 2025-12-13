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

import { logger } from '@webedt/shared';

// Import database
import './db/index.js';

// Import routes
import executeRoutes from './routes/execute.js';
import resumeRoutes from './routes/resume.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import sessionsRoutes from './routes/sessions.js';
import githubRoutes from './routes/github.js';
import storageRoutes from './routes/storage.js';
import adminRoutes from './routes/admin.js';
import transcribeRoutes from './routes/transcribe.js';
import completionsRoutes from './routes/completions.js';
import imageGenRoutes from './routes/imageGen.js';

// Import database for orphan cleanup
import { db, chatSessions, events, checkHealth as checkDbHealth, getConnectionStats } from './db/index.js';
import { eq, and, lt, sql, count } from 'drizzle-orm';

// Import middleware
import { authMiddleware } from './middleware/auth.js';

// Import health monitoring and metrics utilities
import {
  healthMonitor,
  createDatabaseHealthCheck,
  metrics,
  circuitBreakerRegistry,
} from './utils/index.js';

/**
 * Clean up orphaned sessions that are stuck in 'running' status
 * This handles cases where:
 * 1. The server restarted while a job was running and the worker callback failed
 * 2. The worker crashed without sending a completion callback
 * 3. Network issues prevented the callback from reaching the server
 */
async function cleanupOrphanedSessions(): Promise<{ success: boolean; cleaned: number }> {
  const startTime = Date.now();
  let cleaned = 0;

  try {
    const timeoutThreshold = new Date(Date.now() - ORPHAN_SESSION_TIMEOUT_MINUTES * 60 * 1000);

    // Find sessions stuck in 'running' or 'pending' for too long
    const stuckSessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          sql`${chatSessions.status} IN ('running', 'pending')`,
          lt(chatSessions.createdAt, timeoutThreshold)
        )
      );

    if (stuckSessions.length === 0) {
      // Record successful cycle even with no sessions cleaned
      const durationMs = Date.now() - startTime;
      metrics.recordCleanupCycle(true, 0, durationMs);
      healthMonitor.updateCleanupStatus(true, 0);
      return { success: true, cleaned: 0 };
    }

    logger.info(`[OrphanCleanup] Found ${stuckSessions.length} potentially orphaned session(s)`);

    for (const session of stuckSessions) {
      try {
        // Check if session has a 'completed' event stored (worker finished but callback failed)
        const completedEvents = await db
          .select()
          .from(events)
          .where(
            and(
              eq(events.chatSessionId, session.id),
              eq(events.eventType, 'completed')
            )
          )
          .limit(1);

        // Check if session has any events at all (worker started processing)
        const eventCountResult = await db
          .select({ count: count() })
          .from(events)
          .where(eq(events.chatSessionId, session.id));

        const totalEvents = eventCountResult[0]?.count || 0;

        // Determine the appropriate status:
        // - If there's a 'completed' event, mark as completed
        // - If there are events but no completion, mark as error (worker likely crashed mid-execution)
        // - If there are no events, mark as error (worker never started or crashed immediately)
        let newStatus: 'completed' | 'error';
        let reason: string;

        if (completedEvents.length > 0) {
          newStatus = 'completed';
          reason = 'Found completed event in database';
        } else if (totalEvents > 0) {
          newStatus = 'error';
          reason = `Worker processed ${totalEvents} events but never sent completion`;
        } else {
          newStatus = 'error';
          reason = 'No events found - worker may have never started';
        }

        await db
          .update(chatSessions)
          .set({
            status: newStatus,
            completedAt: new Date()
          })
          .where(eq(chatSessions.id, session.id));

        cleaned++;
        logger.info(`[OrphanCleanup] Updated session ${session.id} from '${session.status}' to '${newStatus}' (${reason})`);
      } catch (sessionError) {
        logger.error(`[OrphanCleanup] Error processing session ${session.id}:`, sessionError);
        metrics.recordError('cleanup_session_error', 'OrphanCleanup');
      }
    }

    const durationMs = Date.now() - startTime;
    metrics.recordCleanupCycle(true, cleaned, durationMs);
    healthMonitor.updateCleanupStatus(true, cleaned);

    logger.info(`[OrphanCleanup] Cleanup completed for ${stuckSessions.length} session(s), cleaned: ${cleaned}`);
    return { success: true, cleaned };
  } catch (error) {
    const durationMs = Date.now() - startTime;
    metrics.recordCleanupCycle(false, cleaned, durationMs);
    healthMonitor.updateCleanupStatus(false, cleaned);
    metrics.recordError('cleanup_cycle_error', 'OrphanCleanup');

    logger.error('[OrphanCleanup] Error during orphan session cleanup:', error);
    return { success: false, cleaned };
  }
}

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

// Initialize health monitoring with database health check
healthMonitor.registerCheck('database', createDatabaseHealthCheck(async () => {
  const startTime = Date.now();
  try {
    const result = await checkDbHealth();
    return {
      healthy: result.healthy,
      latencyMs: Date.now() - startTime,
      error: result.healthy ? undefined : 'Database health check failed',
    };
  } catch (error) {
    return {
      healthy: false,
      latencyMs: Date.now() - startTime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}));

// Set cleanup interval for status display
healthMonitor.setCleanupInterval(ORPHAN_CLEANUP_INTERVAL_MINUTES);

// Start periodic health checks (every 30 seconds)
healthMonitor.startPeriodicChecks(30000);

// Basic health check endpoint (fast, for load balancers)
app.get('/health', (req, res) => {
  res.setHeader('X-Container-ID', CONTAINER_ID);
  res.json({
    success: true,
    data: {
      status: 'ok',
      service: 'internal-api-server',
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

// Detailed health status endpoint (comprehensive health information)
app.get('/health/status', async (req, res) => {
  try {
    const status = await healthMonitor.getDetailedHealthStatus({
      version: '1.0.0',
      service: 'internal-api-server',
      containerId: CONTAINER_ID,
      build: {
        commitSha: BUILD_COMMIT_SHA,
        timestamp: BUILD_TIMESTAMP,
        imageTag: BUILD_IMAGE_TAG,
      },
    });

    const statusCode = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

    res.setHeader('X-Container-ID', CONTAINER_ID);
    res.status(statusCode).json({
      success: status.status !== 'unhealthy',
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Kubernetes readiness probe
app.get('/ready', async (req, res) => {
  try {
    const ready = await healthMonitor.isReady();
    if (ready) {
      res.status(200).json({ status: 'ready' });
    } else {
      res.status(503).json({ status: 'not_ready' });
    }
  } catch (error) {
    res.status(503).json({ status: 'not_ready', error: error instanceof Error ? error.message : String(error) });
  }
});

// Kubernetes liveness probe
app.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

// Metrics endpoint (JSON format)
app.get('/metrics', (req, res) => {
  // Update database connection stats
  const dbStats = getConnectionStats();
  if (dbStats) {
    metrics.updateDbConnections(dbStats.totalCount, dbStats.idleCount, dbStats.waitingCount);
  }

  res.setHeader('Content-Type', 'application/json');
  res.json({
    success: true,
    data: metrics.getMetricsJson(),
  });
});

// Add routes
app.use('/api', executeRoutes);
app.use('/api', resumeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/storage', storageRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', transcribeRoutes);
app.use('/api/completions', completionsRoutes);
app.use('/api/image-gen', imageGenRoutes);

// Note: Static file serving removed - handled by website-server facade

// Error handler
app.use(
  (
    err: Error,
    req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    const errorMessage = err instanceof Error ? err.message : String(err);
    const errorStack = err instanceof Error ? err.stack : undefined;

    logger.error('Unhandled error:', err);
    console.error('[GlobalErrorHandler] Error details:', {
      message: errorMessage,
      stack: errorStack,
      path: req.path,
      method: req.method
    });

    // Return more descriptive error message for debugging
    res.status(500).json({ success: false, error: errorMessage || 'Internal server error' });
  }
);

// Start server
app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('Internal API Server');
  console.log('='.repeat(60));
  console.log(`🆔 Container ID: ${CONTAINER_ID}`);
  console.log(`📡 Server running on port ${PORT}`);
  console.log(`🌍 Environment: ${NODE_ENV}`);
  console.log('');

  // Log environment configuration
  logEnvConfig();

  console.log('');
  console.log('Available endpoints:');
  console.log('  GET  /health                           - Basic health check');
  console.log('  GET  /health/status                    - Detailed health status');
  console.log('  GET  /ready                            - Kubernetes readiness probe');
  console.log('  GET  /live                             - Kubernetes liveness probe');
  console.log('  GET  /metrics                          - Performance metrics (JSON)');
  console.log('');
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
  console.log('  GET  /api/storage/sessions/...         - Storage operations');
  console.log('');
  console.log('  GET  /api/admin/users                  - List all users (admin)');
  console.log('  GET  /api/admin/users/:id              - Get user by ID (admin)');
  console.log('  POST /api/admin/users                  - Create user (admin)');
  console.log('  PUT  /api/admin/users/:id              - Update user (admin)');
  console.log('  DELETE /api/admin/users/:id            - Delete user (admin)');
  console.log('  POST /api/admin/impersonate/:id        - Impersonate user (admin)');
  console.log('  GET  /api/admin/stats                  - Get system stats (admin)');
  console.log('');
  console.log('  POST /api/transcribe                   - Transcribe audio (Whisper)');
  console.log('');
  console.log('  POST /api/completions                  - Code completions (autocomplete)');
  console.log('  POST /api/user/openrouter-api-key      - Set OpenRouter API key');
  console.log('  POST /api/user/autocomplete-settings   - Update autocomplete settings');
  console.log('='.repeat(60));

  // Schedule periodic orphan cleanup
  logger.info(`Scheduling orphan cleanup: timeout=${ORPHAN_SESSION_TIMEOUT_MINUTES}min, interval=${ORPHAN_CLEANUP_INTERVAL_MINUTES}min`);
  logger.info('Health monitoring enabled with periodic checks every 30 seconds');

  // Run initial cleanup on startup
  cleanupOrphanedSessions();

  // Schedule periodic cleanup
  setInterval(() => {
    cleanupOrphanedSessions();
  }, ORPHAN_CLEANUP_INTERVAL_MINUTES * 60 * 1000);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  healthMonitor.stopPeriodicChecks();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully...');
  healthMonitor.stopPeriodicChecks();
  process.exit(0);
});
