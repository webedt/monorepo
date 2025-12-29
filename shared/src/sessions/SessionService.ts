/**
 * Session Implementation
 *
 * Wraps ClaudeRemoteProvider with database operations:
 * - Creates/updates chatSessions table
 * - Stores events in events table
 * - Stores messages in messages table
 */

import { randomUUID } from 'crypto';
import { ASession } from './ASession.js';
import { db, chatSessions, events, messages, withTransactionOrThrow } from '../db/index.js';
import { ClaudeRemoteProvider } from '../execution/providers/claudeRemoteProvider.js';
import { ClaudeWebClient } from '../claudeWeb/index.js';
import { normalizeRepoUrl, generateSessionPath } from '../utils/helpers/sessionPathHelper.js';
import { logger } from '../utils/logging/logger.js';
import { ensureValidToken } from '../auth/claudeAuth.js';
import { CLAUDE_API_BASE_URL } from '../config/env.js';
import { eq, desc } from 'drizzle-orm';

import type { TransactionContext } from '../db/index.js';
import type {
  SessionExecuteParams,
  SessionResumeParams,
  SessionSyncParams,
  SessionResult,
  SessionInfo,
  SessionEventCallback,
} from './types.js';
import type { ExecutionEvent } from '../execution/providers/types.js';

/**
 * Extract text from prompt (handles both string and content blocks)
 */
function extractTextFromPrompt(prompt: string | { type: string; text?: string }[]): string {
  if (typeof prompt === 'string') {
    return prompt;
  }
  return prompt
    .filter((block): block is { type: 'text'; text: string } => block.type === 'text' && 'text' in block)
    .map(block => block.text)
    .join('\n');
}

/**
 * Map Anthropic session status to our internal status.
 * Exported for use in tests and other modules.
 */
export function mapRemoteStatus(anthropicStatus: string): string {
  const statusMap: Record<string, string> = {
    'idle': 'completed',
    'running': 'running',
    'completed': 'completed',
    'failed': 'error',
    'cancelled': 'error',
    'errored': 'error',
    'archived': 'completed',
  };
  return statusMap[anthropicStatus] || 'pending';
}

/**
 * Type for validated remote session fields.
 * Only includes fields that are actually validated by the type guard.
 */
interface ValidatedRemoteSession {
  session_status: string;
  updated_at: string;
  // session_context is not validated, typed as unknown for safe access
  session_context?: unknown;
}

/**
 * Type guard to validate required remote session fields.
 * Only validates session_status and updated_at - session_context must be
 * safely accessed with optional chaining after validation.
 */
function isValidRemoteSession(obj: unknown): obj is ValidatedRemoteSession {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const session = obj as Record<string, unknown>;
  return (
    typeof session.session_status === 'string' &&
    typeof session.updated_at === 'string'
  );
}

export class SessionService extends ASession {
  private provider: ClaudeRemoteProvider;

  constructor() {
    super();
    this.provider = new ClaudeRemoteProvider();
  }

  async execute(
    params: SessionExecuteParams,
    onEvent?: SessionEventCallback
  ): Promise<SessionResult> {
    const { userId, prompt, gitUrl, claudeAuth, environmentId, model } = params;

    // Normalize repo URL and extract owner/name
    const repoUrl = normalizeRepoUrl(gitUrl);
    const repoMatch = repoUrl.match(/github\.com\/([^\/]+)\/([^\/]+?)(\.git)?$/);
    const repositoryOwner = repoMatch ? repoMatch[1] : null;
    const repositoryName = repoMatch ? repoMatch[2] : null;

    // Create database session
    const chatSessionId = randomUUID();
    const textPrompt = extractTextFromPrompt(prompt);

    logger.info('Creating session', {
      component: 'Session',
      chatSessionId,
      userId,
      gitUrl: repoUrl,
    });

    // Use transaction to ensure session and initial message are created atomically
    // This prevents orphaned sessions if message insertion fails
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      await tx.insert(chatSessions).values({
        id: chatSessionId,
        userId,
        userRequest: textPrompt.slice(0, 200),
        status: 'running',
        provider: 'claude',
        repositoryUrl: repoUrl,
        repositoryOwner,
        repositoryName,
        baseBranch: 'main',
      });

      // Store user message
      await tx.insert(messages).values({
        chatSessionId,
        type: 'user',
        content: textPrompt,
      });
    }, {
      context: { operation: 'createSession', chatSessionId, userId },
    });

    // Track stored event UUIDs to prevent duplicates
    const storedEventUuids = new Set<string>();

    // Event handler that stores to database
    const handleEvent = async (event: ExecutionEvent) => {
      // Call user callback
      if (onEvent) {
        await onEvent(event);
      }

      // Store event in database - deduplicate by UUID
      const eventUuid = (event as { uuid?: string }).uuid;
      if (eventUuid && storedEventUuids.has(eventUuid)) {
        return;
      }

      try {
        await db.insert(events).values({
          chatSessionId,
          eventData: event,
        });
        if (eventUuid) {
          storedEventUuids.add(eventUuid);
        }
      } catch (err) {
        // Ignore storage errors (duplicates, etc.)
      }

      // Update session with title from title_generation event
      if (event.type === 'title_generation' && (event as { status?: string }).status === 'success') {
        const titleEvent = event as { title?: string; branch_name?: string };
        const newTitle = titleEvent.title;
        const newBranch = titleEvent.branch_name;

        let newSessionPath: string | undefined;
        if (newBranch && repositoryOwner && repositoryName) {
          newSessionPath = generateSessionPath(repositoryOwner, repositoryName, newBranch);
        }

        try {
          await db.update(chatSessions)
            .set({
              userRequest: newTitle,
              ...(newBranch ? { branch: newBranch } : {}),
              ...(newSessionPath ? { sessionPath: newSessionPath } : {})
            })
            .where(eq(chatSessions.id, chatSessionId));
        } catch (err) {
          // Ignore update errors
        }
      }

      // Save remoteSessionId immediately when session_created
      if (event.type === 'session_created') {
        const sessionEvent = event as { remoteSessionId?: string; remoteWebUrl?: string };
        try {
          await db.update(chatSessions)
            .set({
              remoteSessionId: sessionEvent.remoteSessionId,
              remoteWebUrl: sessionEvent.remoteWebUrl,
            })
            .where(eq(chatSessions.id, chatSessionId));
        } catch (err) {
          // Ignore update errors
        }
      }
    };

    try {
      // Execute via provider
      const result = await this.provider.execute(
        {
          userId,
          chatSessionId,
          prompt,
          gitUrl: repoUrl,
          claudeAuth,
          environmentId,
          model,
        },
        handleEvent
      );

      // Update session with final result
      const finalStatus = result.status === 'completed' ? 'completed' : 'error';

      let finalSessionPath: string | undefined;
      if (result.branch && repositoryOwner && repositoryName) {
        finalSessionPath = generateSessionPath(repositoryOwner, repositoryName, result.branch);
      }

      await db.update(chatSessions)
        .set({
          status: finalStatus,
          branch: result.branch,
          remoteSessionId: result.remoteSessionId,
          remoteWebUrl: result.remoteWebUrl,
          totalCost: result.totalCost?.toString(),
          completedAt: new Date(),
          ...(finalSessionPath ? { sessionPath: finalSessionPath } : {}),
        })
        .where(eq(chatSessions.id, chatSessionId));

      logger.info('Session completed', {
        component: 'Session',
        chatSessionId,
        status: result.status,
        branch: result.branch,
      });

      return {
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        remoteSessionId: result.remoteSessionId,
        remoteWebUrl: result.remoteWebUrl,
      };
    } catch (error) {
      // Update session to error state
      await db.update(chatSessions)
        .set({
          status: 'error',
          completedAt: new Date(),
        })
        .where(eq(chatSessions.id, chatSessionId));

      throw error;
    }
  }

  async resume(
    sessionId: string,
    params: SessionResumeParams,
    onEvent?: SessionEventCallback
  ): Promise<SessionResult> {
    const { prompt, claudeAuth, environmentId } = params;

    // Get session from database
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (!session.remoteSessionId) {
      throw new Error('Session does not have a remote session ID. Cannot resume.');
    }

    logger.info('Resuming session', {
      component: 'Session',
      chatSessionId: sessionId,
      remoteSessionId: session.remoteSessionId,
    });

    // Use transaction to ensure status update and message insertion are atomic
    // This prevents inconsistent state if message insertion fails
    const textPrompt = extractTextFromPrompt(prompt);
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      // Update session status
      await tx.update(chatSessions)
        .set({ status: 'running' })
        .where(eq(chatSessions.id, sessionId));

      // Store user message
      await tx.insert(messages).values({
        chatSessionId: sessionId,
        type: 'user',
        content: textPrompt,
      });
    }, {
      context: { operation: 'resumeSession', sessionId },
    });

    // Track stored event UUIDs
    const storedEventUuids = new Set<string>();

    // Event handler
    const handleEvent = async (event: ExecutionEvent) => {
      if (onEvent) {
        await onEvent(event);
      }

      const eventUuid = (event as { uuid?: string }).uuid;
      if (eventUuid && storedEventUuids.has(eventUuid)) {
        return;
      }

      try {
        await db.insert(events).values({
          chatSessionId: sessionId,
          eventData: event,
        });
        if (eventUuid) {
          storedEventUuids.add(eventUuid);
        }
      } catch (err) {
        // Ignore storage errors
      }
    };

    try {
      // Resume via provider
      const result = await this.provider.resume(
        {
          userId: session.userId,
          chatSessionId: sessionId,
          remoteSessionId: session.remoteSessionId,
          prompt,
          claudeAuth,
          environmentId,
        },
        handleEvent
      );

      // Update session with final result
      const finalStatus = result.status === 'completed' ? 'completed' : 'error';

      await db.update(chatSessions)
        .set({
          status: finalStatus,
          totalCost: result.totalCost?.toString(),
          completedAt: new Date(),
        })
        .where(eq(chatSessions.id, sessionId));

      logger.info('Session resume completed', {
        component: 'Session',
        chatSessionId: sessionId,
        status: result.status,
      });

      return {
        status: result.status,
        branch: result.branch,
        totalCost: result.totalCost,
        durationMs: result.durationMs,
        remoteSessionId: result.remoteSessionId,
        remoteWebUrl: result.remoteWebUrl,
      };
    } catch (error) {
      await db.update(chatSessions)
        .set({
          status: 'error',
          completedAt: new Date(),
        })
        .where(eq(chatSessions.id, sessionId));

      throw error;
    }
  }

  async sync(
    sessionId: string,
    params: SessionSyncParams
  ): Promise<SessionInfo> {
    const { claudeAuth, environmentId } = params;

    // Get session from database
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // If no remote session ID, nothing to sync from remote
    if (!session.remoteSessionId) {
      logger.debug('Session has no remoteSessionId, returning current state', {
        component: 'Session',
        chatSessionId: sessionId,
      });
      return this.mapSessionToInfo(session);
    }

    try {
      // Refresh token if needed
      const refreshedAuth = await ensureValidToken(claudeAuth);

      // Create Claude client
      const client = new ClaudeWebClient({
        accessToken: refreshedAuth.accessToken,
        environmentId: environmentId || '',
        baseUrl: CLAUDE_API_BASE_URL,
      });

      // Fetch remote session status
      const remoteSessionResponse = await client.getSession(session.remoteSessionId);

      // Validate remote session response structure
      if (!isValidRemoteSession(remoteSessionResponse)) {
        logger.warn('Invalid remote session response structure', {
          component: 'Session',
          chatSessionId: sessionId,
          remoteSessionId: session.remoteSessionId,
        });
        return this.mapSessionToInfo(session);
      }

      const remoteSession = remoteSessionResponse;
      const newStatus = mapRemoteStatus(remoteSession.session_status);

      // Fetch remote events
      const eventsResponse = await client.getEvents(session.remoteSessionId);
      const remoteEvents = eventsResponse.data || [];

      // Get existing event UUIDs for this session
      // TODO(perf): Currently fetches all eventData to extract UUIDs. For sessions with
      // many events, this can be slow. Consider adding a dedicated 'uuid' column to the
      // events table with an index for more efficient deduplication queries.
      const existingEvents = await db
        .select({ eventData: events.eventData })
        .from(events)
        .where(eq(events.chatSessionId, sessionId));

      const existingUuids = new Set(
        existingEvents.map(e => (e.eventData as { uuid?: string })?.uuid).filter(Boolean)
      );

      // Filter to only new events
      const eventsToInsert = remoteEvents.filter(
        event => event.uuid && !existingUuids.has(event.uuid)
      );

      // Extract total cost from result event
      // Use !== undefined to correctly handle zero cost values (0 is a valid cost)
      let totalCost: string | undefined = session.totalCost ?? undefined;
      const resultEvent = remoteEvents.find(e => e.type === 'result' && e.total_cost_usd !== undefined);
      if (resultEvent?.total_cost_usd !== undefined) {
        totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
      }

      // Extract branch from session context (safely access unvalidated structure)
      let branch: string | undefined = session.branch ?? undefined;
      const sessionContext = remoteSession.session_context as {
        outcomes?: Array<{ type: string; git_info?: { branches?: string[] } }>;
      } | undefined;
      const gitOutcome = sessionContext?.outcomes?.find(
        (o) => o.type === 'git_repository'
      );
      if (gitOutcome?.git_info?.branches?.[0]) {
        branch = gitOutcome.git_info.branches[0];
      }

      // Generate sessionPath if we now have branch info and don't already have one.
      // Note: sessionPath is only generated once and is not updated if branch changes later.
      // This is intentional - the sessionPath represents the original working location.
      let sessionPath: string | undefined = session.sessionPath ?? undefined;
      if (branch && session.repositoryOwner && session.repositoryName && !sessionPath) {
        sessionPath = generateSessionPath(session.repositoryOwner, session.repositoryName, branch);
      }

      // Determine if session has completed/errored
      const isTerminal = newStatus === 'completed' || newStatus === 'error';
      const completedAt = isTerminal && !session.completedAt
        ? new Date(remoteSession.updated_at)
        : session.completedAt;

      // Normalize values for comparison to avoid null !== undefined issues
      const normalizedTotalCost = totalCost ?? null;
      const normalizedBranch = branch ?? null;
      const normalizedSessionPath = sessionPath ?? null;

      // Check if anything changed (using normalized values for consistent comparison)
      const hasChanges =
        newStatus !== session.status ||
        normalizedTotalCost !== session.totalCost ||
        normalizedBranch !== session.branch ||
        normalizedSessionPath !== session.sessionPath ||
        eventsToInsert.length > 0;

      // Update session and insert events in a transaction for consistency
      if (hasChanges) {
        await db.transaction(async (tx) => {
          // Batch insert new events for better performance
          if (eventsToInsert.length > 0) {
            await tx.insert(events).values(
              eventsToInsert.map(event => ({
                chatSessionId: sessionId,
                eventData: event,
                timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
              }))
            );
          }

          // Update session with new values
          await tx
            .update(chatSessions)
            .set({
              status: newStatus,
              totalCost: totalCost ?? undefined,
              branch: branch ?? undefined,
              sessionPath: sessionPath ?? undefined,
              completedAt: completedAt ?? undefined,
            })
            .where(eq(chatSessions.id, sessionId));
        });

        logger.info('Session synced with remote', {
          component: 'Session',
          chatSessionId: sessionId,
          remoteSessionId: session.remoteSessionId,
          previousStatus: session.status,
          newStatus,
          newEventsCount: eventsToInsert.length,
          totalCost,
          branch,
        });
      }

      // Return updated session info with sync-derived overrides
      return {
        ...this.mapSessionToInfo(session),
        status: newStatus as 'pending' | 'running' | 'completed' | 'error',
        branch: branch ?? undefined,
        totalCost: totalCost ?? undefined,
        completedAt: completedAt ?? undefined,
      };

    } catch (error) {
      logger.error('Failed to sync session with remote', error as Error, {
        component: 'Session',
        chatSessionId: sessionId,
        remoteSessionId: session.remoteSessionId,
      });
      // Return current state on error
      return this.mapSessionToInfo(session);
    }
  }

  /**
   * Map database session to SessionInfo
   */
  private mapSessionToInfo(session: typeof chatSessions.$inferSelect): SessionInfo {
    return {
      id: session.id,
      userId: session.userId,
      status: session.status as 'pending' | 'running' | 'completed' | 'error',
      userRequest: session.userRequest ?? undefined,
      repositoryOwner: session.repositoryOwner ?? undefined,
      repositoryName: session.repositoryName ?? undefined,
      branch: session.branch ?? undefined,
      remoteSessionId: session.remoteSessionId ?? undefined,
      remoteWebUrl: session.remoteWebUrl ?? undefined,
      totalCost: session.totalCost ?? undefined,
      createdAt: session.createdAt ?? undefined,
      completedAt: session.completedAt ?? undefined,
    };
  }

  async get(sessionId: string): Promise<SessionInfo | null> {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      return null;
    }

    return this.mapSessionToInfo(session);
  }

  async list(userId: string, limit: number = 20): Promise<SessionInfo[]> {
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.createdAt))
      .limit(limit);

    return sessions.map(session => this.mapSessionToInfo(session));
  }

  async delete(sessionId: string): Promise<void> {
    // Use transaction to ensure all related records are deleted atomically
    // This prevents orphaned events/messages if session deletion fails,
    // or orphaned session if events/messages deletion fails
    await withTransactionOrThrow(db, async (tx: TransactionContext) => {
      // Delete events first (foreign key dependency)
      await tx.delete(events).where(eq(events.chatSessionId, sessionId));

      // Delete messages (foreign key dependency)
      await tx.delete(messages).where(eq(messages.chatSessionId, sessionId));

      // Delete session
      await tx.delete(chatSessions).where(eq(chatSessions.id, sessionId));
    }, {
      maxRetries: 1,
      context: { operation: 'deleteSession', sessionId },
    });

    logger.info('Session deleted', {
      component: 'Session',
      chatSessionId: sessionId,
    });
  }
}
