import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
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
  CLAUDE_SYNC_ENABLED,
  CLAUDE_SYNC_INTERVAL_MS,
  SHUTDOWN_TIMEOUT_MS,
  LB_DRAIN_DELAY_MS,
  validateEnv,
  logEnvConfig,
  bootstrapServices,
} from '@webedt/shared';

import { logger, runWithCorrelation } from '@webedt/shared';

// Import database - initializeDatabase runs migrations and schema updates
import { waitForDatabase, initializeDatabase } from '@webedt/shared';

// Import routes
import executeRemoteRoutes from './api/routes/executeRemote.js';
import resumeRoutes from './api/routes/resume.js';
import authRoutes from './api/routes/auth.js';
import userRoutes from './api/routes/user/index.js';
import sessionsRoutes from './api/routes/sessions/index.js';
import githubRoutes from './api/routes/github/index.js';
import adminRoutes from './api/routes/admin.js';
import transcribeRoutes from './api/routes/transcribe.js';
import imageGenRoutes from './api/routes/imageGen.js';
import internalSessionsRoutes from './api/routes/internalSessions.js';
import logsRoutes from './api/routes/logs.js';
import liveChatRoutes from './api/routes/liveChat.js';
import workspaceRoutes from './api/routes/workspace.js';
import organizationsRoutes from './api/routes/organizations.js';
import storeRoutes from './api/routes/store.js';
import libraryRoutes from './api/routes/library.js';
import purchasesRoutes from './api/routes/purchases.js';
import communityRoutes from './api/routes/community.js';
import storageRoutes from './api/routes/storage.js';
import searchRoutes from './api/routes/search.js';
import channelsRoutes from './api/routes/channels.js';
import collectionsRoutes from './api/routes/collections.js';
import billingRoutes from './api/routes/billing.js';
import paymentsRoutes from './api/routes/payments.js';
import taxonomiesRoutes from './api/routes/taxonomies.js';
import announcementsRoutes from './api/routes/announcements.js';
import cloudSavesRoutes from './api/routes/cloudSaves.js';
import importRoutes from './api/routes/import.js';
import autocompleteRoutes from './api/routes/autocomplete.js';
import snippetsRoutes from './api/routes/snippets.js';
import diffsRoutes from './api/routes/diffs.js';

// Import Swagger/OpenAPI
import { swaggerSpec, swaggerUi, swaggerUiOptions } from './api/swagger/index.js';

// Import database for orphan cleanup
import { db, chatSessions, events, checkHealth as checkDbHealth, getConnectionStats, eq, and, lt, sql } from '@webedt/shared';

// Import middleware
import { authMiddleware } from './api/middleware/auth.js';
import { verboseLoggingMiddleware, slowRequestLoggingMiddleware } from './api/middleware/verboseLogging.js';
import { correlationIdMiddleware } from './api/middleware/correlationId.js';
import { standardRateLimiter, logRateLimitConfig } from './api/middleware/rateLimit.js';
import { csrfTokenMiddleware, csrfValidationMiddleware } from './api/middleware/csrf.js';
import { connectionTrackerMiddleware, connectionTracker } from './api/middleware/connectionTracker.js';
import { versionConflictErrorHandler } from './api/middleware/versionConflict.js';

// Import graceful shutdown
import { registerShutdownHandlers, setOrphanCleanupInterval, GracefulShutdownConfig } from './gracefulShutdown.js';

// Import health monitoring and metrics utilities
import {
  healthMonitor,
  createDatabaseHealthCheck,
  metrics,
  initializeExternalApiResilience,
  getExternalApiCircuitBreakerStatus,
  areExternalApisAvailable,
} from '@webedt/shared';

// Import background sync service
import { startBackgroundSync, stopBackgroundSync } from '@webedt/shared';

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
    // Only select the columns we need to avoid failures if DB schema is out of sync
    const stuckSessions = await db
      .select({
        id: chatSessions.id,
        status: chatSessions.status,
      })
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
        // eventData is a JSON column containing the raw event with a 'type' field
        const allEvents = await db
          .select()
          .from(events)
          .where(eq(events.chatSessionId, session.id));

        const completedEvents = allEvents.filter(e => (e.eventData as any)?.type === 'completed');

        // Check if session has any events at all (worker started processing)
        const totalEvents = allEvents.length;

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

// Security headers with helmet
// Configure Content-Security-Policy and other security headers
app.use(
  helmet({
    // Content Security Policy
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          // Allow inline scripts for SPA hydration and dynamic content
          "'unsafe-inline'",
          // Allow eval for development tools (remove in hardened production)
          ...(NODE_ENV === 'development' ? ["'unsafe-eval'"] : []),
        ],
        styleSrc: [
          "'self'",
          // Allow inline styles for dynamic styling and CSS-in-JS
          "'unsafe-inline'",
        ],
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          // Allow external images (avatars, external content)
          'https:',
        ],
        fontSrc: ["'self'", 'data:'],
        connectSrc: [
          "'self'",
          // Allow WebSocket connections for SSE and real-time features
          'wss:',
          'ws:',
        ],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        // Prevent clickjacking by restricting frame embedding
        frameAncestors: ["'none'"],
        frameSrc: ["'self'"],
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
    // X-Frame-Options: DENY - prevent clickjacking
    // Note: frameAncestors in CSP provides the same protection but is more flexible
    frameguard: { action: 'deny' },
    // X-Content-Type-Options: nosniff - prevent MIME type sniffing
    noSniff: true,
    // Strict-Transport-Security (HSTS) - enforce HTTPS
    // max-age: 1 year, includeSubDomains, preload-ready
    strictTransportSecurity: {
      maxAge: 31536000, // 1 year in seconds
      includeSubDomains: true,
      preload: true,
    },
    // X-XSS-Protection - legacy XSS filter (disabled as CSP is preferred)
    xssFilter: true,
    // Referrer-Policy - control referrer information
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    // X-DNS-Prefetch-Control - control DNS prefetching
    dnsPrefetchControl: { allow: false },
    // X-Download-Options - prevent IE from executing downloads
    ieNoOpen: true,
    // X-Permitted-Cross-Domain-Policies - restrict Adobe Flash/Acrobat
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  })
);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Correlation ID middleware - must be applied early for request tracing
// Extracts X-Request-ID header or generates a new UUID
app.use(correlationIdMiddleware);

// Wrap all subsequent middleware in correlation context for async propagation
// This enables automatic correlation ID inclusion in logs and database operations
app.use((req, res, next) => {
  runWithCorrelation(req.correlationId, () => {
    next();
  });
});

// Verbose logging middleware (enabled via VERBOSE_MODE or VERBOSE_HTTP env vars)
app.use(verboseLoggingMiddleware);
app.use(slowRequestLoggingMiddleware(2000)); // Log requests taking more than 2 seconds

// Add auth middleware
app.use(authMiddleware);

// CSRF protection middleware
// Token generation: Ensures a CSRF token cookie exists for all responses
app.use(csrfTokenMiddleware);
// Token validation: Validates CSRF tokens on state-changing requests (POST, PUT, DELETE, PATCH)
// SSE endpoints, webhooks, and health checks are exempt
app.use(csrfValidationMiddleware);

// Connection tracker middleware for graceful shutdown
// Tracks active HTTP connections and rejects new requests during shutdown
app.use(connectionTrackerMiddleware);

// Apply standard rate limiting to all API routes
// This provides defense-in-depth alongside infrastructure-level limits
// Note: Auth and public share endpoints have stricter limits applied at the route level
app.use('/api', standardRateLimiter);

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
// Note: Health endpoints (/health, /ready, /live, /metrics) are infrastructure endpoints
// at the root level, not part of the /api namespace, so they are not included in OpenAPI docs.
app.get('/health', (req, res) => {
  // Check external API availability via circuit breakers
  const externalApis = areExternalApisAvailable();
  const allExternalApisAvailable = externalApis.github && externalApis.claudeRemote;

  res.setHeader('X-Container-ID', CONTAINER_ID);
  res.json({
    success: true,
    data: {
      status: allExternalApisAvailable ? 'ok' : 'degraded',
      service: 'website-backend',
      containerId: CONTAINER_ID,
      build: {
        commitSha: BUILD_COMMIT_SHA,
        timestamp: BUILD_TIMESTAMP,
        imageTag: BUILD_IMAGE_TAG,
      },
      externalApis: {
        github: externalApis.github ? 'available' : 'circuit_open',
        claudeRemote: externalApis.claudeRemote ? 'available' : 'circuit_open',
      },
      timestamp: new Date().toISOString(),
    }
  });
});

// Detailed health status endpoint (comprehensive health information)
// Scale expectations: Current deployment supports up to 10 concurrent users
// Architecture is designed for horizontal scalability when demand increases
app.get('/health/status', async (req, res) => {
  try {
    const status = await healthMonitor.getDetailedHealthStatus({
      version: '1.0.0',
      service: 'website-backend',
      containerId: CONTAINER_ID,
      build: {
        commitSha: BUILD_COMMIT_SHA,
        timestamp: BUILD_TIMESTAMP,
        imageTag: BUILD_IMAGE_TAG,
      },
      scale: {
        currentCapacity: 'up to 10 concurrent users',
        shortTermTarget: '50+ users',
        architecture: 'horizontally scalable',
      },
    });

    // Add external API circuit breaker details
    const externalApiStatus = getExternalApiCircuitBreakerStatus();
    const externalApis = areExternalApisAvailable();

    const statusCode = status.status === 'healthy' ? 200 : status.status === 'degraded' ? 200 : 503;

    res.setHeader('X-Container-ID', CONTAINER_ID);
    res.status(statusCode).json({
      success: status.status !== 'unhealthy',
      data: {
        ...status,
        externalApis: {
          github: {
            available: externalApis.github,
            ...externalApiStatus.github,
          },
          claudeRemote: {
            available: externalApis.claudeRemote,
            ...externalApiStatus.claudeRemote,
          },
        },
      },
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

// Swagger/OpenAPI Documentation
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, swaggerUiOptions));
app.get('/api/openapi.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.send(swaggerSpec);
});

// Add API routes
app.use('/api/execute-remote', executeRemoteRoutes);  // Claude Remote Sessions endpoint
app.use('/api', resumeRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', transcribeRoutes);
app.use('/api/image-gen', imageGenRoutes);
app.use('/api/internal/sessions', internalSessionsRoutes);  // Claude Remote Sessions management
app.use('/api', logsRoutes);  // Debug logs endpoint
app.use('/api/live-chat', liveChatRoutes);  // Live Chat for branch-based workspace
app.use('/api/workspace', workspaceRoutes);  // Workspace presence and events
app.use('/api/organizations', organizationsRoutes);  // Organizations/Studios management
app.use('/api/store', storeRoutes);  // Game store browsing and wishlist
app.use('/api/library', libraryRoutes);  // User's game library management
app.use('/api/purchases', purchasesRoutes);  // Game purchases and refunds
app.use('/api/community', communityRoutes);  // Community posts, reviews, and discussions
app.use('/api/storage', storageRoutes);  // User storage quota management
app.use('/api/search', searchRoutes);  // Universal search across all fields
app.use('/api/channels', channelsRoutes);  // Community channels and real-time messaging
app.use('/api/collections', collectionsRoutes);  // User-created organizational folders for sessions
app.use('/api/billing', billingRoutes);  // Subscription billing and plan management
app.use('/api/payments', paymentsRoutes);  // Stripe and PayPal payment processing
app.use('/api/taxonomies', taxonomiesRoutes);  // Admin-configurable taxonomy system
app.use('/api/announcements', announcementsRoutes);  // Official platform announcements
app.use('/api/cloud-saves', cloudSavesRoutes);  // Cloud save synchronization
app.use('/api/import', importRoutes);  // Import files from external URLs
app.use('/api/autocomplete', autocompleteRoutes);  // AI-powered code completion
app.use('/api/snippets', snippetsRoutes);  // User code snippets and templates
app.use('/api/diffs', diffsRoutes);  // Diff visualization comparing branches

// Serve static files from the frontend build
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

// Version conflict error handler (handles optimistic locking errors)
// Must be registered before the generic error handler
app.use(versionConflictErrorHandler);

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
    const correlationId = req.correlationId;

    logger.error('Unhandled error:', err, {
      component: 'GlobalErrorHandler',
      requestId: correlationId,
    });
    console.error('[GlobalErrorHandler] Error details:', {
      message: errorMessage,
      stack: errorStack,
      path: req.path,
      method: req.method,
      correlationId,
    });

    // Return error response with correlation ID for client-side debugging
    res.status(500).json({
      success: false,
      error: errorMessage || 'Internal server error',
      requestId: correlationId,
      timestamp: new Date().toISOString(),
    });
  }
);

// Graceful shutdown configuration
const shutdownConfig: GracefulShutdownConfig = {
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT_MS,
  loadBalancerDrainDelayMs: LB_DRAIN_DELAY_MS,
  exitProcess: true,
};

// Start server
async function startServer() {
  // Initialize database first - runs migrations and schema updates
  // This adds any missing columns (storage_quota_bytes, spending_limit_enabled, etc.)
  await initializeDatabase();

  // Bootstrap all services (registers singletons with ServiceProvider)
  await bootstrapServices();

  // Initialize external API resilience (circuit breakers for GitHub and Claude Remote)
  initializeExternalApiResilience();

  const server = app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('WebEDT Backend Server');
  console.log('='.repeat(60));
  console.log(`Container ID: ${CONTAINER_ID}`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${NODE_ENV}`);
  console.log(`Frontend dist: ${frontendDistPath}`);
  console.log(`Scale: Up to 10 concurrent users (horizontally scalable)`);
  console.log('');

  // Log environment configuration
  logEnvConfig();

  // Log rate limit configuration
  logRateLimitConfig();

  console.log('');
  console.log('Available endpoints:');
  console.log('  GET  /health                           - Basic health check');
  console.log('  GET  /health/status                    - Detailed health status');
  console.log('  GET  /ready                            - Kubernetes readiness probe');
  console.log('  GET  /live                             - Kubernetes liveness probe');
  console.log('  GET  /metrics                          - Performance metrics (JSON)');
  console.log('');
  console.log('  GET  /api/docs                         - Swagger UI documentation');
  console.log('  GET  /api/openapi.json                 - OpenAPI specification');
  console.log('');
  console.log('  POST /api/execute-remote               - Execute AI request (SSE)');
  console.log('  GET  /api/resume/:sessionId            - Resume session (SSE)');
  console.log('');
  console.log('  POST /api/auth/register                - Register new user');
  console.log('  POST /api/auth/login                   - Login');
  console.log('  POST /api/auth/logout                  - Logout');
  console.log('  GET  /api/auth/session                 - Get current session');
  console.log('');
  console.log('  GET  /api/sessions                     - List sessions');
  console.log('  GET  /api/sessions/:id                 - Get session');
  console.log('  DELETE /api/sessions/:id               - Delete session');
  console.log('');
  console.log('  GET  /api/github/oauth                 - Start GitHub OAuth');
  console.log('  GET  /api/github/repos                 - List repos');
  console.log('='.repeat(60));

  // Schedule periodic orphan cleanup
  logger.info(`Scheduling orphan cleanup: timeout=${ORPHAN_SESSION_TIMEOUT_MINUTES}min, interval=${ORPHAN_CLEANUP_INTERVAL_MINUTES}min`);
  logger.info('Health monitoring enabled with periodic checks every 30 seconds');

  // Run initial cleanup on startup
  cleanupOrphanedSessions();

  // Schedule periodic cleanup and track the interval for graceful shutdown
  const orphanCleanupInterval = setInterval(() => {
    cleanupOrphanedSessions();
  }, ORPHAN_CLEANUP_INTERVAL_MINUTES * 60 * 1000);
  setOrphanCleanupInterval(orphanCleanupInterval);

  // Start Claude session background sync
  if (CLAUDE_SYNC_ENABLED) {
    logger.info(`Starting Claude session sync: interval=${Math.round(CLAUDE_SYNC_INTERVAL_MS / 1000 / 60)}min`);
    startBackgroundSync();
  } else {
    logger.info('Claude session sync is disabled');
  }

  // Register graceful shutdown handlers
  // These handle SIGTERM, SIGINT, uncaughtException, and unhandledRejection
  registerShutdownHandlers(server, shutdownConfig);

  // Log current connection tracking status
  const connStats = connectionTracker.getStats();
  logger.info('Connection tracking initialized', {
    component: 'Startup',
    activeConnections: connStats.activeConnections,
    shutdownTimeoutMs: shutdownConfig.shutdownTimeoutMs,
  });
  });
}

// Start the server
startServer().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
