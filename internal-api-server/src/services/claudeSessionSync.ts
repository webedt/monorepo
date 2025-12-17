/**
 * Claude Remote Session Background Sync Service
 *
 * Automatically syncs sessions from Anthropic's Claude Remote API to the local database.
 * This ensures sessions created on claude.ai appear in the local UI without manual intervention.
 */

import { db, chatSessions, events, users } from '../db/index.js';
import { eq, and, isNotNull, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { ClaudeRemoteClient, generateSessionPath, logger } from '@webedt/shared';
import { ensureValidToken } from '../lib/claudeAuth.js';
import {
  CLAUDE_ENVIRONMENT_ID,
  CLAUDE_API_BASE_URL,
  CLAUDE_SYNC_ENABLED,
  CLAUDE_SYNC_INTERVAL_MS,
  CLAUDE_SYNC_INITIAL_DELAY_MS,
  CLAUDE_SYNC_LIMIT,
} from '../config/env.js';

interface SyncStats {
  lastSyncTime: Date | null;
  totalSyncs: number;
  totalImported: number;
  totalErrors: number;
  isRunning: boolean;
}

const syncStats: SyncStats = {
  lastSyncTime: null,
  totalSyncs: 0,
  totalImported: 0,
  totalErrors: 0,
  isRunning: false,
};

let syncIntervalId: NodeJS.Timeout | null = null;

/**
 * Map Anthropic session status to our internal status
 */
function mapStatus(anthropicStatus: string): string {
  const statusMap: Record<string, string> = {
    'idle': 'completed',
    'running': 'running',
    'completed': 'completed',
    'failed': 'error',
    'archived': 'completed'
  };
  return statusMap[anthropicStatus] || 'pending';
}

/**
 * Sync sessions for a specific user
 */
async function syncUserSessions(userId: string, claudeAuth: NonNullable<typeof users.$inferSelect['claudeAuth']>): Promise<{
  imported: number;
  errors: number;
  skipped: number;
}> {
  const result = { imported: 0, errors: 0, skipped: 0 };

  try {
    // Refresh token if needed
    const refreshedAuth = await ensureValidToken(claudeAuth);

    // Update token in database if it was refreshed
    if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
      await db
        .update(users)
        .set({ claudeAuth: refreshedAuth })
        .where(eq(users.id, userId));
    }

    // Create Claude client
    const client = new ClaudeRemoteClient({
      accessToken: refreshedAuth.accessToken,
      environmentId: CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    // Fetch active sessions from Anthropic (skip archived)
    const remoteSessions = await client.listSessions(CLAUDE_SYNC_LIMIT);

    // Get existing remote session IDs for this user
    const existingSessions = await db
      .select({ remoteSessionId: chatSessions.remoteSessionId })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, userId),
          isNotNull(chatSessions.remoteSessionId)
        )
      );

    const existingRemoteIds = new Set(
      existingSessions.map(s => s.remoteSessionId).filter(Boolean)
    );

    // Filter to sessions that need importing (skip archived and already imported)
    const sessionsToImport = remoteSessions.data.filter(session => {
      if (existingRemoteIds.has(session.id)) {
        result.skipped++;
        return false;
      }
      if (session.session_status === 'archived') {
        result.skipped++;
        return false;
      }
      return true;
    });

    // Import each missing session
    for (const remoteSession of sessionsToImport) {
      try {
        // Fetch events for this session
        const eventsResponse = await client.getEvents(remoteSession.id);
        const sessionEvents = eventsResponse.data || [];

        // Extract repository info from session context
        const gitSource = remoteSession.session_context?.sources?.find(s => s.type === 'git_repository');
        const gitOutcome = remoteSession.session_context?.outcomes?.find(o => o.type === 'git_repository');

        let repositoryUrl: string | undefined;
        let repositoryOwner: string | undefined;
        let repositoryName: string | undefined;
        let branch: string | undefined;

        if (gitSource?.url) {
          repositoryUrl = gitSource.url;
          const match = gitSource.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (match) {
            repositoryOwner = match[1];
            repositoryName = match[2].replace(/\.git$/, '');
          }
        }

        if (gitOutcome?.git_info?.branches?.[0]) {
          branch = gitOutcome.git_info.branches[0];
        }

        const status = mapStatus(remoteSession.session_status);

        // Create chat session in database
        const sessionId = uuidv4();
        const sessionPath = repositoryOwner && repositoryName && branch
          ? generateSessionPath(repositoryOwner, repositoryName, branch)
          : undefined;

        // Extract user request from first user event or title
        let userRequest = remoteSession.title || 'Synced session';
        const firstUserEvent = sessionEvents.find(e => e.type === 'user' && e.message?.content);
        if (firstUserEvent?.message?.content) {
          const content = firstUserEvent.message.content;
          userRequest = typeof content === 'string'
            ? content.slice(0, 500)
            : JSON.stringify(content).slice(0, 500);
        }

        // Extract total cost from result event
        let totalCost: string | undefined;
        const resultEvent = sessionEvents.find(e => e.type === 'result' && e.total_cost_usd);
        if (resultEvent?.total_cost_usd) {
          totalCost = resultEvent.total_cost_usd.toFixed(6);
        }

        await db.insert(chatSessions).values({
          id: sessionId,
          userId,
          userRequest,
          status,
          provider: 'claude-remote',
          remoteSessionId: remoteSession.id,
          remoteWebUrl: `https://claude.ai/code/${remoteSession.id}`,
          totalCost,
          repositoryUrl,
          repositoryOwner,
          repositoryName,
          branch,
          sessionPath,
          createdAt: new Date(remoteSession.created_at),
          completedAt: status === 'completed' || status === 'error'
            ? new Date(remoteSession.updated_at)
            : undefined,
        });

        // Import events
        for (const event of sessionEvents) {
          await db.insert(events).values({
            chatSessionId: sessionId,
            eventType: event.type,
            eventData: event,
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
          });
        }

        result.imported++;
        logger.info(`[SessionSync] Imported session ${remoteSession.id} for user ${userId}`, {
          component: 'SessionSync',
          sessionId,
          eventsCount: sessionEvents.length,
          status
        });

      } catch (error) {
        result.errors++;
        logger.error(`[SessionSync] Failed to import session ${remoteSession.id}`, error as Error, {
          component: 'SessionSync',
          userId
        });
      }
    }

    return result;

  } catch (error) {
    logger.error(`[SessionSync] Failed to sync sessions for user ${userId}`, error as Error, {
      component: 'SessionSync'
    });
    result.errors++;
    return result;
  }
}

/**
 * Run sync for all users with Claude auth configured
 */
async function runSync(): Promise<void> {
  if (syncStats.isRunning) {
    logger.info('[SessionSync] Sync already in progress, skipping', { component: 'SessionSync' });
    return;
  }

  syncStats.isRunning = true;
  const startTime = Date.now();

  try {
    // Find all users with Claude auth configured
    const usersWithClaudeAuth = await db
      .select({
        id: users.id,
        claudeAuth: users.claudeAuth
      })
      .from(users)
      .where(isNotNull(users.claudeAuth));

    if (usersWithClaudeAuth.length === 0) {
      logger.debug('[SessionSync] No users with Claude auth configured', { component: 'SessionSync' });
      return;
    }

    logger.info(`[SessionSync] Starting sync for ${usersWithClaudeAuth.length} user(s)`, {
      component: 'SessionSync'
    });

    let totalImported = 0;
    let totalErrors = 0;
    let totalSkipped = 0;

    for (const user of usersWithClaudeAuth) {
      if (!user.claudeAuth) continue;

      const result = await syncUserSessions(user.id, user.claudeAuth);
      totalImported += result.imported;
      totalErrors += result.errors;
      totalSkipped += result.skipped;
    }

    syncStats.totalSyncs++;
    syncStats.totalImported += totalImported;
    syncStats.totalErrors += totalErrors;
    syncStats.lastSyncTime = new Date();

    const durationMs = Date.now() - startTime;
    logger.info(`[SessionSync] Sync completed in ${durationMs}ms`, {
      component: 'SessionSync',
      imported: totalImported,
      errors: totalErrors,
      skipped: totalSkipped,
      users: usersWithClaudeAuth.length
    });

  } catch (error) {
    syncStats.totalErrors++;
    logger.error('[SessionSync] Sync cycle failed', error as Error, { component: 'SessionSync' });
  } finally {
    syncStats.isRunning = false;
  }
}

/**
 * Start the background sync service
 */
export function startBackgroundSync(): void {
  if (!CLAUDE_SYNC_ENABLED) {
    logger.info('[SessionSync] Background sync is disabled', { component: 'SessionSync' });
    return;
  }

  logger.info(`[SessionSync] Starting background sync service`, {
    component: 'SessionSync',
    initialDelayMs: CLAUDE_SYNC_INITIAL_DELAY_MS,
    intervalMs: CLAUDE_SYNC_INTERVAL_MS,
    limit: CLAUDE_SYNC_LIMIT
  });

  // Run initial sync after a short delay (let server stabilize)
  setTimeout(() => {
    logger.info('[SessionSync] Running initial sync', { component: 'SessionSync' });
    runSync();
  }, CLAUDE_SYNC_INITIAL_DELAY_MS);

  // Schedule periodic sync
  syncIntervalId = setInterval(() => {
    runSync();
  }, CLAUDE_SYNC_INTERVAL_MS);
}

/**
 * Stop the background sync service
 */
export function stopBackgroundSync(): void {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
    logger.info('[SessionSync] Background sync service stopped', { component: 'SessionSync' });
  }
}

/**
 * Get current sync statistics
 */
export function getSyncStats(): SyncStats {
  return { ...syncStats };
}

/**
 * Manually trigger a sync (useful for testing or on-demand refresh)
 */
export async function triggerSync(): Promise<void> {
  await runSync();
}
