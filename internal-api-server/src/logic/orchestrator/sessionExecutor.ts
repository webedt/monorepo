/**
 * Session Executor
 *
 * Handles creating and managing sessions for the orchestrator using local workers.
 * Uses the same worker infrastructure as the agents page.
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import { db } from '../db/index.js';
import { chatSessions, users, ChatSession } from '../db/schema.js';
import { ensureValidToken, ClaudeAuth } from '../auth/claudeAuth.js';
import { workerCoordinator, WorkerAssignment } from '../execution/workerCoordinator.js';
import { GitHubOperations, parseRepoUrl } from '../github/operations.js';
import { WORKSPACE_DIR } from '../config/env.js';
import { generateSessionPath, logger } from '@webedt/shared';

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
  status: 'completed' | 'error';
  branch?: string;
  error?: string;
}

// Initialize services
const githubOperations = new GitHubOperations();

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
 * Get user's GitHub access token
 */
async function getGitHubToken(userId: string): Promise<string | null> {
  const [userData] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return userData?.githubAccessToken || null;
}

/**
 * Create a session and execute it using the local worker (same as agents page)
 */
export async function createAndExecuteSession(params: CreateSessionParams): Promise<SessionResult> {
  const { userId, title, prompt, repoOwner, repoName } = params;

  logger.info(`Creating orchestrator session: ${title}`, { component: 'SessionExecutor', userId, repoOwner, repoName });

  // Get Claude auth
  const claudeAuth = await getClaudeAuth(userId);
  if (!claudeAuth) {
    logger.error('User does not have Claude authentication configured', { component: 'SessionExecutor', userId });
    throw new Error('Claude authentication not configured for this user. Please connect your Claude account in Settings.');
  }

  // Get GitHub token
  const githubToken = await getGitHubToken(userId);
  if (!githubToken) {
    logger.error('User does not have GitHub connected', { component: 'SessionExecutor', userId });
    throw new Error('GitHub not connected for this user. Please connect your GitHub account in Settings.');
  }

  // Create local chat session record
  const sessionId = uuidv4();
  const gitUrl = `https://github.com/${repoOwner}/${repoName}`;
  const baseBranch = params.baseBranch || 'main';

  await db.insert(chatSessions).values({
    id: sessionId,
    userId,
    userRequest: title,
    status: 'running',
    provider: 'claude',
    repositoryUrl: gitUrl,
    repositoryOwner: repoOwner,
    repositoryName: repoName,
    baseBranch,
  });

  logger.info(`Created local session`, { component: 'SessionExecutor', sessionId });

  // Setup workspace
  const sessionRoot = path.join(WORKSPACE_DIR, `session-${sessionId}`);
  let workspacePath: string | undefined;

  try {
    // Initialize GitHub session (clone repo, create branch)
    logger.info(`Initializing GitHub session`, { component: 'SessionExecutor', gitUrl, baseBranch });

    const initResult = await githubOperations.initSession(
      {
        sessionId,
        repoUrl: gitUrl,
        branch: baseBranch,
        userRequest: title,
        githubAccessToken: githubToken,
        workspaceRoot: WORKSPACE_DIR,
        codingAssistantProvider: 'ClaudeAgentSDK',
        codingAssistantAuthentication: claudeAuth,
      },
      async (event) => {
        logger.info(`Init event: ${event.type}`, { component: 'SessionExecutor', message: event.message });
      }
    );

    // Update database with branch info
    const sessionPath = generateSessionPath(repoOwner, repoName, initResult.branchName);

    await db.update(chatSessions)
      .set({
        branch: initResult.branchName,
        sessionPath: sessionPath,
        userRequest: initResult.sessionTitle || title,
      })
      .where(eq(chatSessions.id, sessionId));

    workspacePath = initResult.localPath;
    logger.info(`Workspace initialized`, { component: 'SessionExecutor', workspacePath });

    // Note: Sessions are ephemeral - no storage upload needed
    // The AI worker operates on local workspace and changes are committed directly to GitHub

    // Acquire worker
    logger.info(`Acquiring worker...`, { component: 'SessionExecutor' });
    const workerAssignment = await workerCoordinator.acquireWorker(sessionId);

    if (!workerAssignment) {
      throw new Error('No AI workers available. Please check that the ai-coding-worker service is running.');
    }

    logger.info(`Worker acquired`, { component: 'SessionExecutor', workerId: workerAssignment.worker.id });

    // Prepare payload for AI worker
    const aiWorkerPayload = {
      userRequest: prompt,
      codingAssistantProvider: 'ClaudeAgentSDK',
      codingAssistantAuthentication: claudeAuth,
      workspacePath: workspacePath,
      websiteSessionId: sessionId,
      providerOptions: {},
    };

    // Call AI worker
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 600000); // 10 minutes

    logger.info(`Calling worker`, { component: 'SessionExecutor', workerUrl: `${workerAssignment.url}/execute` });

    const aiResponse = await fetch(`${workerAssignment.url}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
      },
      body: JSON.stringify(aiWorkerPayload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      throw new Error(`AI worker error: ${aiResponse.status} - ${errorText}`);
    }

    if (!aiResponse.body) {
      throw new Error('No response body from AI worker');
    }

    // Stream the response and wait for completion
    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let sessionCompleted = false;
    let sessionError: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim() || !line.startsWith('data:')) continue;

        try {
          const data = line.substring(5).trim();
          const event = JSON.parse(data);

          logger.info(`Worker event: ${event.type}`, { component: 'SessionExecutor' });

          if (event.type === 'completed') {
            sessionCompleted = true;
          } else if (event.type === 'error') {
            sessionError = event.error || event.message || 'Unknown error';
          }
        } catch {
          // Ignore parse errors
        }
      }
    }

    // Release worker
    workerCoordinator.releaseWorker(workerAssignment.worker.id, sessionId);

    // Update session status
    const finalStatus = sessionError ? 'error' : 'completed';
    await db.update(chatSessions)
      .set({
        status: finalStatus,
        completedAt: new Date(),
      })
      .where(eq(chatSessions.id, sessionId));

    // Get final branch name
    const [finalSession] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId));

    logger.info(`Session ${finalStatus}`, { component: 'SessionExecutor', sessionId, status: finalStatus });

    return {
      sessionId,
      status: sessionError ? 'error' : 'completed',
      branch: finalSession?.branch || undefined,
      error: sessionError,
    };
  } catch (error) {
    logger.error(`Session failed`, error as Error, { component: 'SessionExecutor', sessionId });

    // Update session status to error
    await db.update(chatSessions)
      .set({ status: 'error', completedAt: new Date() })
      .where(eq(chatSessions.id, sessionId));

    // Clean up workspace
    if (fs.existsSync(sessionRoot)) {
      try {
        fs.rmSync(sessionRoot, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    return {
      sessionId,
      status: 'error',
      error: (error as Error).message,
    };
  }
}

/**
 * Archive a session (mark as completed)
 */
export async function archiveSession(
  userId: string,
  sessionId: string,
  _deleteBranch: boolean = true
): Promise<void> {
  logger.info(`Archiving session`, { component: 'SessionExecutor', sessionId });

  // Get session
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)));

  if (!session) {
    throw new Error('Session not found');
  }

  // Update local session status
  await db.update(chatSessions)
    .set({ status: 'completed', completedAt: new Date() })
    .where(eq(chatSessions.id, sessionId));

  logger.info(`Session archived`, { component: 'SessionExecutor', sessionId });
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

  logger.info(`Waiting for sessions to complete`, { component: 'SessionExecutor', count: sessionIds.length });

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
          status: 'completed',
          branch: session.branch || undefined,
        });
        logger.info(`Session completed`, { component: 'SessionExecutor', sessionId: id });
      } else if (session.status === 'error') {
        pending.delete(id);
        results.set(id, {
          sessionId: id,
          status: 'error',
          error: 'Session ended with error',
        });
        logger.info(`Session failed`, { component: 'SessionExecutor', sessionId: id });
      }
    }

    if (pending.size > 0) {
      logger.info(`Still waiting for sessions`, { component: 'SessionExecutor', pending: pending.size });
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
