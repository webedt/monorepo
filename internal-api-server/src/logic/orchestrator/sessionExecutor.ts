/**
 * Session Executor
 *
 * Handles creating and managing claude-remote sessions for the orchestrator.
 * Provides methods to create sessions, wait for completion, and clean up.
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { chatSessions, users, ChatSession } from '../db/schema.js';
import { ensureValidToken, ClaudeAuth } from '../auth/claudeAuth.js';
import { ClaudeRemoteClient } from '@webedt/shared';
import {
  CLAUDE_ENVIRONMENT_ID,
  CLAUDE_API_BASE_URL,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_ORG_UUID,
} from '../config/env.js';

export interface CreateSessionParams {
  userId: string;
  title: string;
  prompt: string;
  repoOwner: string;
  repoName: string;
  baseBranch?: string;
  orchestratorJobId?: string;
  orchestratorCycleId?: string;
  orchestratorTaskId?: string;
}

export interface SessionResult {
  sessionId: string;
  remoteSessionId?: string;
  status: 'completed' | 'error';
  branch?: string;
  error?: string;
}

/**
 * Get ClaudeAuth for a user and refresh if needed
 */
async function getClaudeAuth(userId: string): Promise<ClaudeAuth | null> {
  const [userData] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userData?.claudeAuth) {
    return null;
  }

  let claudeAuth = userData.claudeAuth as ClaudeAuth;

  try {
    const refreshedAuth = await ensureValidToken(claudeAuth);
    if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
      await db.update(users)
        .set({ claudeAuth: refreshedAuth })
        .where(eq(users.id, userId));
      claudeAuth = refreshedAuth;
    }
  } catch (error) {
    console.error('[SessionExecutor] Failed to refresh Claude token:', error);
    return null;
  }

  return claudeAuth;
}

/**
 * Create a ClaudeRemoteClient
 */
function createClient(claudeAuth: ClaudeAuth, environmentId?: string): ClaudeRemoteClient {
  return new ClaudeRemoteClient({
    accessToken: claudeAuth.accessToken,
    environmentId: environmentId || CLAUDE_ENVIRONMENT_ID || '',
    baseUrl: CLAUDE_API_BASE_URL,
    model: CLAUDE_DEFAULT_MODEL,
    orgUuid: CLAUDE_ORG_UUID,
  });
}

/**
 * Create a claude-remote session and wait for it to complete
 */
export async function createAndExecuteSession(params: CreateSessionParams): Promise<SessionResult> {
  const { userId, title, prompt, repoOwner, repoName } = params;

  console.log(`[SessionExecutor] Creating session: ${title}`);

  // Validate environment configuration
  if (!CLAUDE_ENVIRONMENT_ID) {
    console.error('[SessionExecutor] CLAUDE_ENVIRONMENT_ID is not configured');
    throw new Error('Claude Remote Sessions not configured: CLAUDE_ENVIRONMENT_ID is missing. Set this in the server environment.');
  }

  // Get Claude auth
  const claudeAuth = await getClaudeAuth(userId);
  if (!claudeAuth) {
    console.error(`[SessionExecutor] User ${userId} does not have Claude authentication configured`);
    throw new Error('Claude authentication not configured for this user. Please connect your Claude account in Settings.');
  }

  console.log(`[SessionExecutor] Using environment: ${CLAUDE_ENVIRONMENT_ID.substring(0, 20)}... for user ${userId.substring(0, 8)}...`);

  // Create local chat session record
  const sessionId = uuidv4();
  const gitUrl = `https://github.com/${repoOwner}/${repoName}`;

  const [newSession] = await db.insert(chatSessions).values({
    id: sessionId,
    userId,
    userRequest: title,
    status: 'running',
    provider: 'claude-remote',
    repositoryUrl: gitUrl,
    repositoryOwner: repoOwner,
    repositoryName: repoName,
    baseBranch: params.baseBranch || 'main',
  }).returning();

  console.log(`[SessionExecutor] Created local session: ${sessionId}`);

  try {
    // Create Claude remote session
    const client = createClient(claudeAuth);

    const { sessionId: remoteSessionId, webUrl } = await client.createSession({
      prompt,
      gitUrl,
      model: CLAUDE_DEFAULT_MODEL,
      title,
    });

    console.log(`[SessionExecutor] Created remote session: ${remoteSessionId}`);

    // Update local session with remote ID
    await db.update(chatSessions)
      .set({
        remoteSessionId,
        remoteWebUrl: webUrl,
      })
      .where(eq(chatSessions.id, sessionId));

    // Wait for session to complete
    const result = await waitForSessionCompletion(client, remoteSessionId, sessionId);

    return result;
  } catch (error) {
    console.error(`[SessionExecutor] Session failed:`, error);

    // Update session status to error
    await db.update(chatSessions)
      .set({ status: 'error', completedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    return {
      sessionId,
      status: 'error',
      error: (error as Error).message,
    };
  }
}

/**
 * Wait for a remote session to complete by polling
 */
async function waitForSessionCompletion(
  client: ClaudeRemoteClient,
  remoteSessionId: string,
  localSessionId: string,
  maxWaitMs: number = 30 * 60 * 1000, // 30 minutes default
  pollIntervalMs: number = 10000 // 10 seconds
): Promise<SessionResult> {
  const startTime = Date.now();

  console.log(`[SessionExecutor] Waiting for session ${remoteSessionId} to complete...`);

  while (Date.now() - startTime < maxWaitMs) {
    try {
      // Get session from Anthropic
      const session = await client.getSession(remoteSessionId);

      console.log(`[SessionExecutor] Session ${remoteSessionId} status: ${session.session_status}`);

      // Extract branch from session context if available
      const workingBranch = session.session_context?.outcomes?.[0]?.git_info?.branches?.[0];

      if (session.session_status === 'completed' || session.session_status === 'idle') {
        // Session is done
        await db.update(chatSessions)
          .set({
            status: 'completed',
            branch: workingBranch,
            completedAt: new Date(),
          })
          .where(eq(chatSessions.id, localSessionId));

        return {
          sessionId: localSessionId,
          remoteSessionId,
          status: 'completed',
          branch: workingBranch,
        };
      }

      if (session.session_status === 'failed') {
        await db.update(chatSessions)
          .set({ status: 'error', completedAt: new Date() })
          .where(eq(chatSessions.id, localSessionId));

        return {
          sessionId: localSessionId,
          remoteSessionId,
          status: 'error',
          error: 'Session ended with error',
        };
      }

      // Still running, wait and poll again
      await sleep(pollIntervalMs);
    } catch (error) {
      console.error(`[SessionExecutor] Error polling session status:`, error);
      // Continue polling on transient errors
      await sleep(pollIntervalMs);
    }
  }

  // Timeout
  console.error(`[SessionExecutor] Session ${remoteSessionId} timed out after ${maxWaitMs}ms`);

  await db.update(chatSessions)
    .set({ status: 'error', completedAt: new Date() })
    .where(eq(chatSessions.id, localSessionId));

  return {
    sessionId: localSessionId,
    remoteSessionId,
    status: 'error',
    error: 'Session timed out',
  };
}

/**
 * Archive a session and delete its branch
 */
export async function archiveSession(
  userId: string,
  sessionId: string,
  deleteBranch: boolean = true
): Promise<void> {
  console.log(`[SessionExecutor] Archiving session: ${sessionId}`);

  // Get session
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));

  if (!session) {
    throw new Error('Session not found');
  }

  // Archive on Anthropic if we have a remote session
  if (session.remoteSessionId) {
    const claudeAuth = await getClaudeAuth(userId);
    if (claudeAuth) {
      const client = createClient(claudeAuth);
      try {
        await client.archiveSession(session.remoteSessionId);
        console.log(`[SessionExecutor] Archived remote session: ${session.remoteSessionId}`);
      } catch (error) {
        console.error(`[SessionExecutor] Failed to archive remote session:`, error);
      }
    }
  }

  // Update local session status
  await db.update(chatSessions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  // Delete branch if requested
  // Note: This would require git operations - for now we rely on task sessions to clean up their own branches
  if (deleteBranch && session.branch) {
    console.log(`[SessionExecutor] Branch ${session.branch} should be deleted by task session`);
  }
}

/**
 * Get session status from local database
 */
export async function getSessionStatus(sessionId: string): Promise<ChatSession | null> {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId));

  return session || null;
}

/**
 * Check if all sessions in a list are complete
 */
export async function areAllSessionsComplete(sessionIds: string[]): Promise<boolean> {
  if (sessionIds.length === 0) return true;

  const sessions = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionIds[0]));

  // This is a simplified check - in production you'd want to check all at once
  for (const id of sessionIds) {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, id));

    if (!session) continue;

    if (session.status !== 'completed' && session.status !== 'error') {
      return false;
    }
  }

  return true;
}

/**
 * Wait for multiple sessions to complete
 */
export async function waitForAllSessions(
  sessionIds: string[],
  maxWaitMs: number = 60 * 60 * 1000, // 1 hour default
  pollIntervalMs: number = 15000 // 15 seconds
): Promise<Map<string, SessionResult>> {
  const results = new Map<string, SessionResult>();
  const startTime = Date.now();
  const pending = new Set(sessionIds);

  console.log(`[SessionExecutor] Waiting for ${sessionIds.length} sessions to complete...`);

  while (pending.size > 0 && Date.now() - startTime < maxWaitMs) {
    for (const id of [...pending]) {
      const [session] = await db
        .select()
        .from(chatSessions)
        .where(eq(chatSessions.id, id));

      if (!session) {
        pending.delete(id);
        results.set(id, {
          sessionId: id,
          status: 'error',
          error: 'Session not found',
        });
        continue;
      }

      if (session.status === 'completed') {
        pending.delete(id);
        results.set(id, {
          sessionId: id,
          remoteSessionId: session.remoteSessionId || undefined,
          status: 'completed',
          branch: session.branch || undefined,
        });
        console.log(`[SessionExecutor] Session ${id} completed`);
      } else if (session.status === 'error') {
        pending.delete(id);
        results.set(id, {
          sessionId: id,
          remoteSessionId: session.remoteSessionId || undefined,
          status: 'error',
          error: 'Session ended with error',
        });
        console.log(`[SessionExecutor] Session ${id} failed`);
      }
    }

    if (pending.size > 0) {
      console.log(`[SessionExecutor] Still waiting for ${pending.size} sessions...`);
      await sleep(pollIntervalMs);
    }
  }

  // Mark remaining as timed out
  for (const id of pending) {
    results.set(id, {
      sessionId: id,
      status: 'error',
      error: 'Timed out waiting for session',
    });
  }

  return results;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
