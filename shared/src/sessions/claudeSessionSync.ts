/**
 * Claude Remote Session Background Sync Service
 *
 * Automatically syncs sessions from Anthropic's Claude Remote API to the local database.
 * This ensures sessions created on claude.ai appear in the local UI without manual intervention.
 */

import { db, chatSessions, events, users } from '../db/index.js';
import { eq, and, or, isNotNull, isNull, gte, ne, lte } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { ClaudeWebClient } from '../claudeWeb/index.js';
import { generateSessionPath, normalizeRepoUrl } from '../utils/helpers/sessionPathHelper.js';
import { logger } from '../utils/logging/logger.js';
import { runWithCorrelation } from '../utils/logging/correlationContext.js';
import { ensureValidToken, isClaudeAuthDb } from '../auth/claudeAuth.js';
import { sessionListBroadcaster } from './sessionListBroadcaster.js';
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
  totalUpdated: number;
  totalErrors: number;
  isRunning: boolean;
}

const syncStats: SyncStats = {
  lastSyncTime: null,
  totalSyncs: 0,
  totalImported: 0,
  totalUpdated: 0,
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
 * Clean up redundant pending sessions
 *
 * When a session gets linked to a remoteSessionId, check if there are other
 * sessions from the same user created around the same time that:
 * - Have status 'pending' or 'running'
 * - Have no remoteSessionId (not yet linked)
 * - Were created within 10 minutes of the linked session
 * - Either have no repository info OR same repository
 *
 * These are likely orphaned/duplicate sessions that should be cleaned up.
 */
async function cleanupRedundantSessions(
  userId: string,
  linkedSessionId: string,
  linkedCreatedAt: Date,
  repositoryOwner?: string | null,
  repositoryName?: string | null
): Promise<number> {
  const tenMinutesBefore = new Date(linkedCreatedAt.getTime() - 10 * 60 * 1000);
  const tenMinutesAfter = new Date(linkedCreatedAt.getTime() + 10 * 60 * 1000);

  try {
    // Find potential redundant sessions
    const redundantSessions = await db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, userId),
          ne(chatSessions.id, linkedSessionId), // Exclude the session we just linked
          isNull(chatSessions.remoteSessionId), // Only sessions without remoteSessionId
          isNull(chatSessions.deletedAt), // Not already deleted
          or(
            eq(chatSessions.status, 'pending'),
            eq(chatSessions.status, 'running')
          ),
          gte(chatSessions.createdAt, tenMinutesBefore),
          lte(chatSessions.createdAt, tenMinutesAfter)
        )
      );

    // Filter to sessions that are truly redundant:
    // - Sessions with no repository info (orphaned sessions)
    // - Sessions with the same repository (potential duplicates)
    const sessionsToCleanup = redundantSessions.filter(session => {
      // No repository info = likely orphaned
      if (!session.repositoryOwner || !session.repositoryName) {
        return true;
      }
      // Same repository = potential duplicate
      if (repositoryOwner && repositoryName &&
          session.repositoryOwner === repositoryOwner &&
          session.repositoryName === repositoryName) {
        return true;
      }
      return false;
    });

    if (sessionsToCleanup.length === 0) {
      return 0;
    }

    // Soft-delete redundant sessions
    const sessionIds = sessionsToCleanup.map(s => s.id);
    const now = new Date();

    for (const session of sessionsToCleanup) {
      await db
        .update(chatSessions)
        .set({
          deletedAt: now,
          status: 'error' // Mark as error to indicate it was cleaned up
        })
        .where(eq(chatSessions.id, session.id));

      // Notify subscribers about deletion
      sessionListBroadcaster.notifySessionDeleted(userId, session.id);

      logger.info(`[SessionSync] Cleaned up redundant session`, {
        component: 'SessionSync',
        redundantSessionId: session.id,
        linkedSessionId,
        hadRepository: !!(session.repositoryOwner && session.repositoryName),
        status: session.status
      });
    }

    return sessionsToCleanup.length;
  } catch (error) {
    logger.error(`[SessionSync] Failed to cleanup redundant sessions`, error as Error, {
      component: 'SessionSync',
      linkedSessionId,
      userId
    });
    return 0;
  }
}

/**
 * Sync sessions for a specific user
 */
async function syncUserSessions(userId: string, claudeAuth: NonNullable<typeof users.$inferSelect['claudeAuth']>): Promise<{
  imported: number;
  updated: number;
  errors: number;
  skipped: number;
}> {
  const result = { imported: 0, updated: 0, errors: 0, skipped: 0 };

  try {
    // Refresh token if needed
    const refreshedAuth = await ensureValidToken(claudeAuth);

    // Update token in database if it was refreshed
    if (refreshedAuth.accessToken !== claudeAuth.accessToken && isClaudeAuthDb(refreshedAuth)) {
      await db
        .update(users)
        .set({ claudeAuth: refreshedAuth })
        .where(eq(users.id, userId));
    }

    // Create Claude client
    const client = new ClaudeWebClient({
      accessToken: refreshedAuth.accessToken,
      environmentId: CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    // First, check and update any "running" sessions that may have completed
    const runningSessions = await db
      .select({
        id: chatSessions.id,
        remoteSessionId: chatSessions.remoteSessionId,
      })
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.userId, userId),
          eq(chatSessions.status, 'running'),
          isNotNull(chatSessions.remoteSessionId)
        )
      );

    for (const runningSession of runningSessions) {
      if (!runningSession.remoteSessionId) continue;

      try {
        // Check status with Anthropic API
        const remoteSession = await client.getSession(runningSession.remoteSessionId);
        const newStatus = mapStatus(remoteSession.session_status);

        // If status changed from running to something else, update it
        if (newStatus !== 'running') {
          // Fetch any new events
          const eventsResponse = await client.getEvents(runningSession.remoteSessionId);
          const remoteEvents = eventsResponse.data || [];

          // Get existing event UUIDs for this session
          const existingEvents = await db
            .select({ eventData: events.eventData })
            .from(events)
            .where(eq(events.chatSessionId, runningSession.id));

          const existingUuids = new Set(
            existingEvents.map(e => (e.eventData as any)?.uuid).filter(Boolean)
          );

          // Insert any new events
          let newEventsCount = 0;
          for (const event of remoteEvents) {
            if (event.uuid && !existingUuids.has(event.uuid)) {
              await db.insert(events).values({
                chatSessionId: runningSession.id,
                eventData: event,
                timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
              });
              newEventsCount++;
            }
          }

          // Extract total cost from result event
          let totalCost: string | undefined;
          const resultEvent = remoteEvents.find(e => e.type === 'result' && e.total_cost_usd);
          if (resultEvent?.total_cost_usd) {
            totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
          }

          // Extract branch from session context
          const gitOutcome = remoteSession.session_context?.outcomes?.find(o => o.type === 'git_repository');
          const branch = gitOutcome?.git_info?.branches?.[0];

          // Update session status
          await db
            .update(chatSessions)
            .set({
              status: newStatus,
              completedAt: new Date(remoteSession.updated_at),
              totalCost: totalCost || undefined,
              branch: branch || undefined,
            })
            .where(eq(chatSessions.id, runningSession.id));

          // Notify subscribers about status change
          sessionListBroadcaster.notifyStatusChanged(userId, {
            id: runningSession.id,
            status: newStatus,
            totalCost: totalCost || undefined,
            branch: branch || undefined,
          });

          result.updated++;
          logger.info(`[SessionSync] Updated session ${runningSession.id} from running to ${newStatus}`, {
            component: 'SessionSync',
            remoteSessionId: runningSession.remoteSessionId,
            newEventsCount,
            totalCost
          });
        }
      } catch (error) {
        result.errors++;
        logger.error(`[SessionSync] Failed to check/update running session ${runningSession.id}`, error as Error, {
          component: 'SessionSync',
          remoteSessionId: runningSession.remoteSessionId
        });
      }
    }

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
        let baseBranch: string | undefined;
        let branch: string | undefined;

        if (gitSource?.url) {
          // Normalize URL to prevent duplicates (remove .git suffix)
          repositoryUrl = normalizeRepoUrl(gitSource.url);
          const match = gitSource.url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (match) {
            repositoryOwner = match[1];
            repositoryName = match[2].replace(/\.git$/, '');
            // Default baseBranch to 'main' for GitHub repos (enables PR buttons)
            baseBranch = 'main';
          }
        }

        if (gitOutcome?.git_info?.branches?.[0]) {
          branch = gitOutcome.git_info.branches[0];
        }

        const status = mapStatus(remoteSession.session_status);

        // Check for existing session that might match this remote session
        // This prevents duplicates when a session was created via the website
        // and is now being synced from Claude's API
        const remoteCreatedAt = new Date(remoteSession.created_at);
        const fiveMinutesBefore = new Date(remoteCreatedAt.getTime() - 5 * 60 * 1000);
        const fiveMinutesAfter = new Date(remoteCreatedAt.getTime() + 5 * 60 * 1000);

        let matchingExistingSession = null;

        logger.debug(`[SessionSync] Checking for matching local session`, {
          component: 'SessionSync',
          remoteSessionId: remoteSession.id,
          remoteCreatedAt: remoteSession.created_at,
          branch,
          repositoryOwner,
          repositoryName,
          title: remoteSession.title
        });

        // First, try to match by branch (most specific)
        if (branch && repositoryOwner && repositoryName) {
          const branchMatches = await db
            .select()
            .from(chatSessions)
            .where(
              and(
                eq(chatSessions.userId, userId),
                eq(chatSessions.repositoryOwner, repositoryOwner),
                eq(chatSessions.repositoryName, repositoryName),
                eq(chatSessions.branch, branch),
                isNull(chatSessions.remoteSessionId), // Only match sessions without remoteSessionId
                isNull(chatSessions.deletedAt)
              )
            )
            .limit(1);

          if (branchMatches.length > 0) {
            matchingExistingSession = branchMatches[0];
            logger.info(`[SessionSync] Found matching session by branch`, {
              component: 'SessionSync',
              existingSessionId: matchingExistingSession.id,
              remoteSessionId: remoteSession.id,
              branch,
              repositoryOwner,
              repositoryName
            });
          }
        }

        // If no branch match, try matching by repo + time window + status
        // Order by createdAt DESC to get the most recent session (most likely to be the one being created)
        if (!matchingExistingSession && repositoryOwner && repositoryName) {
          const repoTimeMatches = await db
            .select()
            .from(chatSessions)
            .where(
              and(
                eq(chatSessions.userId, userId),
                eq(chatSessions.repositoryOwner, repositoryOwner),
                eq(chatSessions.repositoryName, repositoryName),
                isNull(chatSessions.remoteSessionId), // Only match sessions without remoteSessionId
                isNull(chatSessions.deletedAt),
                or(
                  eq(chatSessions.status, 'pending'),
                  eq(chatSessions.status, 'running')
                ),
                gte(chatSessions.createdAt, fiveMinutesBefore)
              )
            )
            .orderBy(chatSessions.createdAt)
            .limit(1);

          if (repoTimeMatches.length > 0) {
            matchingExistingSession = repoTimeMatches[0];
            logger.info(`[SessionSync] Found matching session by repo and time window`, {
              component: 'SessionSync',
              existingSessionId: matchingExistingSession.id,
              existingCreatedAt: matchingExistingSession.createdAt,
              remoteSessionId: remoteSession.id,
              remoteCreatedAt: remoteSession.created_at,
              repositoryOwner,
              repositoryName
            });
          } else {
            logger.debug(`[SessionSync] No matching session found by repo+time`, {
              component: 'SessionSync',
              remoteSessionId: remoteSession.id,
              repositoryOwner,
              repositoryName,
              timeWindowStart: fiveMinutesBefore.toISOString()
            });
          }
        }

        // Third fallback: Match by time window alone for running sessions
        // This catches cases where remote session doesn't have repo info yet
        if (!matchingExistingSession) {
          const timeOnlyMatches = await db
            .select()
            .from(chatSessions)
            .where(
              and(
                eq(chatSessions.userId, userId),
                isNull(chatSessions.remoteSessionId), // Only match sessions without remoteSessionId
                isNull(chatSessions.deletedAt),
                eq(chatSessions.status, 'running'), // Must be running (actively being created)
                gte(chatSessions.createdAt, fiveMinutesBefore),
                lte(chatSessions.createdAt, fiveMinutesAfter)
              )
            )
            .orderBy(chatSessions.createdAt)
            .limit(1);

          if (timeOnlyMatches.length > 0) {
            matchingExistingSession = timeOnlyMatches[0];
            logger.info(`[SessionSync] Found matching session by time window only (running session)`, {
              component: 'SessionSync',
              existingSessionId: matchingExistingSession.id,
              existingCreatedAt: matchingExistingSession.createdAt,
              remoteSessionId: remoteSession.id,
              remoteCreatedAt: remoteSession.created_at
            });
          }
        }

        // If we found a matching session, link it to the remote session instead of creating duplicate
        if (matchingExistingSession) {
          // Extract total cost from result event
          let totalCost: string | undefined;
          const resultEvent = sessionEvents.find(e => e.type === 'result' && e.total_cost_usd);
          if (resultEvent?.total_cost_usd) {
            totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
          }

          // Update existing session with remote session info
          await db
            .update(chatSessions)
            .set({
              remoteSessionId: remoteSession.id,
              remoteWebUrl: `https://claude.ai/code/${remoteSession.id}`,
              status: status,
              branch: branch || matchingExistingSession.branch,
              totalCost: totalCost || matchingExistingSession.totalCost,
              completedAt: status === 'completed' || status === 'error'
                ? new Date(remoteSession.updated_at)
                : matchingExistingSession.completedAt,
            })
            .where(eq(chatSessions.id, matchingExistingSession.id));

          // Import any missing events
          const existingEventUuids = new Set(
            (await db
              .select({ eventData: events.eventData })
              .from(events)
              .where(eq(events.chatSessionId, matchingExistingSession.id)))
              .map(e => (e.eventData as any)?.uuid)
              .filter(Boolean)
          );

          let newEventsCount = 0;
          for (const event of sessionEvents) {
            if (event.uuid && !existingEventUuids.has(event.uuid)) {
              await db.insert(events).values({
                chatSessionId: matchingExistingSession.id,
                eventData: event,
                timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
              });
              newEventsCount++;
            }
          }

          // Notify subscribers about the update
          sessionListBroadcaster.notifyStatusChanged(userId, {
            id: matchingExistingSession.id,
            status,
            totalCost,
            branch,
          });

          result.updated++;
          logger.info(`[SessionSync] Linked existing session to remote session (prevented duplicate)`, {
            component: 'SessionSync',
            existingSessionId: matchingExistingSession.id,
            remoteSessionId: remoteSession.id,
            newEventsCount,
            status
          });

          // Clean up any redundant pending sessions created around the same time
          const cleanedUp = await cleanupRedundantSessions(
            userId,
            matchingExistingSession.id,
            matchingExistingSession.createdAt,
            repositoryOwner,
            repositoryName
          );
          if (cleanedUp > 0) {
            logger.info(`[SessionSync] Cleaned up ${cleanedUp} redundant session(s) after linking`, {
              component: 'SessionSync',
              linkedSessionId: matchingExistingSession.id
            });
          }

          continue; // Skip creating a new session
        }

        // Double-check that no session with this remoteSessionId was created during our processing
        // This handles race conditions where executeRemote sets remoteSessionId after our initial check
        const [existingWithRemoteId] = await db
          .select({ id: chatSessions.id })
          .from(chatSessions)
          .where(
            and(
              eq(chatSessions.userId, userId),
              eq(chatSessions.remoteSessionId, remoteSession.id)
            )
          )
          .limit(1);

        if (existingWithRemoteId) {
          result.skipped++;
          logger.info(`[SessionSync] Session with remoteSessionId already exists (race condition avoided)`, {
            component: 'SessionSync',
            existingSessionId: existingWithRemoteId.id,
            remoteSessionId: remoteSession.id
          });
          continue;
        }

        // No matching session found by above criteria
        // Generate sessionPath to check for existing session with same path
        const sessionPath = repositoryOwner && repositoryName && branch
          ? generateSessionPath(repositoryOwner, repositoryName, branch)
          : undefined;

        // Fourth fallback: Check for existing session with same sessionPath (GLOBALLY)
        // The sessionPath constraint is unique across ALL users (not per-user)
        // This handles cases where:
        // 1. executeRemote set the sessionPath but we didn't match earlier
        // 2. Another user already has a session with this sessionPath (same remote session)
        if (sessionPath) {
          const [sessionPathMatch] = await db
            .select()
            .from(chatSessions)
            .where(
              and(
                eq(chatSessions.sessionPath, sessionPath),
                isNull(chatSessions.deletedAt)
              )
            )
            .limit(1);

          if (sessionPathMatch) {
            // Found a session with the same sessionPath
            // Check if it belongs to a different user
            if (sessionPathMatch.userId !== userId) {
              // Session belongs to another user - just skip (don't modify their data)
              result.skipped++;
              logger.info(`[SessionSync] Session with same sessionPath exists for different user (skipping)`, {
                component: 'SessionSync',
                existingSessionId: sessionPathMatch.id,
                existingUserId: sessionPathMatch.userId,
                currentUserId: userId,
                remoteSessionId: remoteSession.id,
                sessionPath
              });
              continue; // Skip creating a new session
            }

            // Session belongs to current user - link it instead of creating duplicate
            logger.info(`[SessionSync] Found matching session by sessionPath`, {
              component: 'SessionSync',
              existingSessionId: sessionPathMatch.id,
              remoteSessionId: remoteSession.id,
              sessionPath
            });

            // Update existing session with remote session info (if not already linked)
            if (!sessionPathMatch.remoteSessionId) {
              let totalCost: string | undefined;
              const resultEvent = sessionEvents.find(e => e.type === 'result' && e.total_cost_usd);
              if (resultEvent?.total_cost_usd) {
                totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
              }

              await db
                .update(chatSessions)
                .set({
                  remoteSessionId: remoteSession.id,
                  remoteWebUrl: `https://claude.ai/code/${remoteSession.id}`,
                  status: status,
                  branch: branch || sessionPathMatch.branch,
                  totalCost: totalCost || sessionPathMatch.totalCost,
                  completedAt: status === 'completed' || status === 'error'
                    ? new Date(remoteSession.updated_at)
                    : sessionPathMatch.completedAt,
                })
                .where(eq(chatSessions.id, sessionPathMatch.id));

              // Import any missing events
              const existingEventUuids = new Set(
                (await db
                  .select({ eventData: events.eventData })
                  .from(events)
                  .where(eq(events.chatSessionId, sessionPathMatch.id)))
                  .map(e => (e.eventData as any)?.uuid)
                  .filter(Boolean)
              );

              let newEventsCount = 0;
              for (const event of sessionEvents) {
                if (event.uuid && !existingEventUuids.has(event.uuid)) {
                  await db.insert(events).values({
                    chatSessionId: sessionPathMatch.id,
                    eventData: event,
                    timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
                  });
                  newEventsCount++;
                }
              }

              sessionListBroadcaster.notifyStatusChanged(userId, {
                id: sessionPathMatch.id,
                status,
                totalCost,
                branch,
              });

              result.updated++;
              logger.info(`[SessionSync] Linked existing session by sessionPath (prevented duplicate)`, {
                component: 'SessionSync',
                existingSessionId: sessionPathMatch.id,
                remoteSessionId: remoteSession.id,
                newEventsCount,
                status
              });
            } else {
              result.skipped++;
              logger.info(`[SessionSync] Session with same sessionPath already has remoteSessionId`, {
                component: 'SessionSync',
                existingSessionId: sessionPathMatch.id,
                existingRemoteSessionId: sessionPathMatch.remoteSessionId,
                newRemoteSessionId: remoteSession.id,
              });
            }

            continue; // Skip creating a new session
          }
        }

        // Create a new session
        const sessionId = uuidv4();

        // Extract user request from first user event or title
        let userRequest = remoteSession.title || 'Synced session';
        const firstUserEvent = sessionEvents.find(e => e.type === 'user' && (e.message as any)?.content);
        const firstUserMessage = firstUserEvent?.message as { content?: unknown } | undefined;
        if (firstUserMessage?.content) {
          const content = firstUserMessage.content;
          userRequest = typeof content === 'string'
            ? content.slice(0, 500)
            : JSON.stringify(content).slice(0, 500);
        }

        // Extract total cost from result event
        let totalCost: string | undefined;
        const resultEvent = sessionEvents.find(e => e.type === 'result' && e.total_cost_usd);
        if (resultEvent?.total_cost_usd) {
          totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
        }

        const [importedSession] = await db.insert(chatSessions).values({
          id: sessionId,
          userId,
          userRequest,
          status,
          provider: 'claude',
          remoteSessionId: remoteSession.id,
          remoteWebUrl: `https://claude.ai/code/${remoteSession.id}`,
          totalCost,
          repositoryUrl,
          repositoryOwner,
          repositoryName,
          baseBranch,
          branch,
          sessionPath,
          createdAt: new Date(remoteSession.created_at),
          completedAt: status === 'completed' || status === 'error'
            ? new Date(remoteSession.updated_at)
            : undefined,
        }).returning();

        // Notify subscribers about imported session
        sessionListBroadcaster.notifySessionCreated(userId, importedSession);

        // Import events
        for (const event of sessionEvents) {
          await db.insert(events).values({
            chatSessionId: sessionId,
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

        // Clean up any redundant pending sessions created around the same time
        const cleanedUp = await cleanupRedundantSessions(
          userId,
          sessionId,
          new Date(remoteSession.created_at),
          repositoryOwner,
          repositoryName
        );
        if (cleanedUp > 0) {
          logger.info(`[SessionSync] Cleaned up ${cleanedUp} redundant session(s) after import`, {
            component: 'SessionSync',
            importedSessionId: sessionId
          });
        }

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
 * Wraps the sync operation in a correlation context for tracing
 */
async function runSync(): Promise<void> {
  if (syncStats.isRunning) {
    logger.info('[SessionSync] Sync already in progress, skipping', { component: 'SessionSync' });
    return;
  }

  // Generate a correlation ID for this sync cycle
  const syncCorrelationId = `sync-${uuidv4()}`;

  // Run the sync with its own correlation context
  await runWithCorrelation(syncCorrelationId, async () => {
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
      let totalUpdated = 0;
      let totalErrors = 0;
      let totalSkipped = 0;

      for (const user of usersWithClaudeAuth) {
        if (!user.claudeAuth) continue;

        const result = await syncUserSessions(user.id, user.claudeAuth);
        totalImported += result.imported;
        totalUpdated += result.updated;
        totalErrors += result.errors;
        totalSkipped += result.skipped;
      }

      syncStats.totalSyncs++;
      syncStats.totalImported += totalImported;
      syncStats.totalUpdated += totalUpdated;
      syncStats.totalErrors += totalErrors;
      syncStats.lastSyncTime = new Date();

      const durationMs = Date.now() - startTime;
      logger.info(`[SessionSync] Sync completed in ${durationMs}ms`, {
        component: 'SessionSync',
        imported: totalImported,
        updated: totalUpdated,
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
  });
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

// Export cleanup function for use in execute routes
export { cleanupRedundantSessions };

// Export sync function for use in backend routes
export { syncUserSessions };
