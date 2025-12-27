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
import { db, chatSessions, events, messages } from '../db/index.js';
import { ClaudeRemoteProvider } from '../execution/providers/claudeRemoteProvider.js';
import { ClaudeWebClient } from '../claudeWeb/index.js';
import { normalizeRepoUrl, generateSessionPath } from '../utils/helpers/sessionPathHelper.js';
import { logger } from '../utils/logging/logger.js';
import { ensureValidToken } from '../auth/claudeAuth.js';
import { CLAUDE_API_BASE_URL } from '../config/env.js';
import { eq, desc } from 'drizzle-orm';
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

    await db.insert(chatSessions).values({
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
    await db.insert(messages).values({
      chatSessionId,
      type: 'user',
      content: textPrompt,
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

    // Update session status
    await db.update(chatSessions)
      .set({ status: 'running' })
      .where(eq(chatSessions.id, sessionId));

    // Store user message
    const textPrompt = extractTextFromPrompt(prompt);
    await db.insert(messages).values({
      chatSessionId: sessionId,
      type: 'user',
      content: textPrompt,
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
      const remoteSession = await client.getSession(session.remoteSessionId);
      const newStatus = this.mapRemoteStatus(remoteSession.session_status);

      // Fetch remote events
      const eventsResponse = await client.getEvents(session.remoteSessionId);
      const remoteEvents = eventsResponse.data || [];

      // Get existing event UUIDs for this session
      const existingEvents = await db
        .select({ eventData: events.eventData })
        .from(events)
        .where(eq(events.chatSessionId, sessionId));

      const existingUuids = new Set(
        existingEvents.map(e => (e.eventData as { uuid?: string })?.uuid).filter(Boolean)
      );

      // Import any new events
      let newEventsCount = 0;
      for (const event of remoteEvents) {
        if (event.uuid && !existingUuids.has(event.uuid)) {
          await db.insert(events).values({
            chatSessionId: sessionId,
            eventData: event,
            timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
          });
          newEventsCount++;
        }
      }

      // Extract total cost from result event
      let totalCost: string | undefined = session.totalCost || undefined;
      const resultEvent = remoteEvents.find(e => e.type === 'result' && e.total_cost_usd);
      if (resultEvent?.total_cost_usd) {
        totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
      }

      // Extract branch from session context
      let branch: string | undefined = session.branch || undefined;
      const gitOutcome = remoteSession.session_context?.outcomes?.find(
        (o: { type: string }) => o.type === 'git_repository'
      );
      if (gitOutcome?.git_info?.branches?.[0]) {
        branch = gitOutcome.git_info.branches[0];
      }

      // Generate sessionPath if we now have branch info
      let sessionPath: string | undefined = session.sessionPath || undefined;
      if (branch && session.repositoryOwner && session.repositoryName && !sessionPath) {
        sessionPath = generateSessionPath(session.repositoryOwner, session.repositoryName, branch);
      }

      // Determine if session has completed/errored
      const isTerminal = newStatus === 'completed' || newStatus === 'error';
      const completedAt = isTerminal && !session.completedAt
        ? new Date(remoteSession.updated_at)
        : session.completedAt;

      // Check if anything changed
      const hasChanges =
        newStatus !== session.status ||
        totalCost !== session.totalCost ||
        branch !== session.branch ||
        sessionPath !== session.sessionPath ||
        newEventsCount > 0;

      // Update session if there are changes
      if (hasChanges) {
        await db
          .update(chatSessions)
          .set({
            status: newStatus,
            totalCost: totalCost || undefined,
            branch: branch || undefined,
            sessionPath: sessionPath || undefined,
            completedAt: completedAt || undefined,
          })
          .where(eq(chatSessions.id, sessionId));

        logger.info('Session synced with remote', {
          component: 'Session',
          chatSessionId: sessionId,
          remoteSessionId: session.remoteSessionId,
          previousStatus: session.status,
          newStatus,
          newEventsCount,
          totalCost,
          branch,
        });
      }

      // Return updated session info
      return {
        id: session.id,
        userId: session.userId,
        status: newStatus as 'pending' | 'running' | 'completed' | 'error',
        userRequest: session.userRequest || undefined,
        repositoryOwner: session.repositoryOwner || undefined,
        repositoryName: session.repositoryName || undefined,
        branch: branch || undefined,
        remoteSessionId: session.remoteSessionId || undefined,
        remoteWebUrl: session.remoteWebUrl || undefined,
        totalCost: totalCost || undefined,
        createdAt: session.createdAt || undefined,
        completedAt: completedAt || undefined,
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
   * Map Anthropic session status to our internal status
   */
  private mapRemoteStatus(anthropicStatus: string): string {
    const statusMap: Record<string, string> = {
      'idle': 'completed',
      'running': 'running',
      'completed': 'completed',
      'failed': 'error',
      'archived': 'completed',
    };
    return statusMap[anthropicStatus] || 'pending';
  }

  /**
   * Map database session to SessionInfo
   */
  private mapSessionToInfo(session: typeof chatSessions.$inferSelect): SessionInfo {
    return {
      id: session.id,
      userId: session.userId,
      status: session.status as 'pending' | 'running' | 'completed' | 'error',
      userRequest: session.userRequest || undefined,
      repositoryOwner: session.repositoryOwner || undefined,
      repositoryName: session.repositoryName || undefined,
      branch: session.branch || undefined,
      remoteSessionId: session.remoteSessionId || undefined,
      remoteWebUrl: session.remoteWebUrl || undefined,
      totalCost: session.totalCost || undefined,
      createdAt: session.createdAt || undefined,
      completedAt: session.completedAt || undefined,
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

    return {
      id: session.id,
      userId: session.userId,
      status: session.status as 'pending' | 'running' | 'completed' | 'error',
      userRequest: session.userRequest || undefined,
      repositoryOwner: session.repositoryOwner || undefined,
      repositoryName: session.repositoryName || undefined,
      branch: session.branch || undefined,
      remoteSessionId: session.remoteSessionId || undefined,
      remoteWebUrl: session.remoteWebUrl || undefined,
      totalCost: session.totalCost || undefined,
      createdAt: session.createdAt || undefined,
      completedAt: session.completedAt || undefined,
    };
  }

  async list(userId: string, limit: number = 20): Promise<SessionInfo[]> {
    const sessions = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.userId, userId))
      .orderBy(desc(chatSessions.createdAt))
      .limit(limit);

    return sessions.map(session => ({
      id: session.id,
      userId: session.userId,
      status: session.status as 'pending' | 'running' | 'completed' | 'error',
      userRequest: session.userRequest || undefined,
      repositoryOwner: session.repositoryOwner || undefined,
      repositoryName: session.repositoryName || undefined,
      branch: session.branch || undefined,
      remoteSessionId: session.remoteSessionId || undefined,
      remoteWebUrl: session.remoteWebUrl || undefined,
      totalCost: session.totalCost || undefined,
      createdAt: session.createdAt || undefined,
      completedAt: session.completedAt || undefined,
    }));
  }

  async delete(sessionId: string): Promise<void> {
    // Delete events first
    await db.delete(events).where(eq(events.chatSessionId, sessionId));

    // Delete messages
    await db.delete(messages).where(eq(messages.chatSessionId, sessionId));

    // Delete session
    await db.delete(chatSessions).where(eq(chatSessions.id, sessionId));

    logger.info('Session deleted', {
      component: 'Session',
      chatSessionId: sessionId,
    });
  }
}
