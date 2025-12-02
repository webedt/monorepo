import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables first
dotenv.config();

// Initialize database (PostgreSQL if DATABASE_URL is set, otherwise SQLite)
import './db/index';
import { db, chatSessions, events } from './db/index';
import { eq, and, lt, sql, count } from 'drizzle-orm';

import { authMiddleware } from './middleware/auth';
import authRoutes from './routes/auth';
import githubRoutes from './routes/github';
import executeRoutes from './routes/execute';
import sessionsRoutes from './routes/sessions';
import userRoutes from './routes/user';
import transcribeRoutes from './routes/transcribe';
import storageWorkerRoutes from './routes/storage-worker';
import adminRoutes from './routes/admin';

// Orphan session cleanup configuration
const ORPHAN_SESSION_TIMEOUT_MINUTES = parseInt(process.env.ORPHAN_SESSION_TIMEOUT_MINUTES || '30', 10);
const ORPHAN_CLEANUP_INTERVAL_MINUTES = parseInt(process.env.ORPHAN_CLEANUP_INTERVAL_MINUTES || '5', 10);

/**
 * Clean up orphaned sessions that are stuck in 'running' status
 * This handles cases where:
 * 1. The server restarted while a job was running and the worker callback failed
 * 2. The worker crashed without sending a completion callback
 * 3. Network issues prevented the callback from reaching the server
 */
async function cleanupOrphanedSessions(): Promise<void> {
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
      return; // No orphaned sessions
    }

    console.log(`[OrphanCleanup] Found ${stuckSessions.length} potentially orphaned session(s)`);

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

        console.log(`[OrphanCleanup] Updated session ${session.id} from '${session.status}' to '${newStatus}' (${reason})`);
      } catch (sessionError) {
        console.error(`[OrphanCleanup] Error processing session ${session.id}:`, sessionError);
      }
    }

    console.log(`[OrphanCleanup] Cleanup completed for ${stuckSessions.length} session(s)`);
  } catch (error) {
    console.error('[OrphanCleanup] Error during orphan session cleanup:', error);
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Configure CORS - include github.etdofresh.com for preview site access
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'];
// Always allow the preview site to make API calls
if (!allowedOrigins.includes('https://github.etdofresh.com')) {
  allowedOrigins.push('https://github.etdofresh.com');
}
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);
// Increase limit to 10MB to support base64-encoded images (1000x1000 resized)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Auth middleware (adds user to request if authenticated)
app.use(authMiddleware);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/github', githubRoutes);
app.use('/api/user', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', executeRoutes);
app.use('/api/sessions', sessionsRoutes);
app.use('/api', transcribeRoutes);
app.use('/api', storageWorkerRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ success: true, data: { status: 'ok' } });
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../../client/dist');
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
    next: express.NextFunction
  ) => {
    console.error('Error:', err);
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV}`);
  console.log(`AI Worker URL: ${process.env.AI_WORKER_URL}`);
  console.log(`Storage Worker URL: ${process.env.STORAGE_WORKER_URL}`);

  // Log environment variables (redacting sensitive values)
  const redactKeys = ['GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'WORKER_CALLBACK_SECRET'];
  const envVars = Object.keys(process.env)
    .filter(key => key.startsWith('PORT') || key.startsWith('NODE_ENV') ||
                   key.startsWith('AI_') || key.startsWith('ALLOWED_') ||
                   key.startsWith('GITHUB_') || key.startsWith('SESSION_') ||
                   key.startsWith('STORAGE_') || key.startsWith('WORKER_') ||
                   key.startsWith('ORPHAN_'))
    .sort()
    .map(key => {
      const value = process.env[key];
      const redactedValue = redactKeys.includes(key) && value
        ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}`
        : value;
      return `  ${key}=${redactedValue}`;
    })
    .join('\n');

  console.log('Environment Variables:');
  console.log(envVars);

  // Run orphan session cleanup on startup (after a short delay to let DB initialize)
  console.log(`[OrphanCleanup] Scheduling startup cleanup in 5 seconds...`);
  console.log(`[OrphanCleanup] Timeout: ${ORPHAN_SESSION_TIMEOUT_MINUTES} minutes, Interval: ${ORPHAN_CLEANUP_INTERVAL_MINUTES} minutes`);

  setTimeout(() => {
    console.log('[OrphanCleanup] Running startup cleanup...');
    cleanupOrphanedSessions();
  }, 5000);

  // Schedule periodic orphan cleanup
  setInterval(() => {
    cleanupOrphanedSessions();
  }, ORPHAN_CLEANUP_INTERVAL_MINUTES * 60 * 1000);
});
