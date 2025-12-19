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
import { StorageService } from '../storage/storageService.js';
import { GitHubOperations, parseRepoUrl } from '../github/operations.js';
import { WORKSPACE_DIR } from '../config/env.js';
import { generateSessionPath } from '@webedt/shared';

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
const storageService = new StorageService();
const githubOperations = new GitHubOperations(storageService);

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

  console.log(`[SessionExecutor] Creating session: ${title}`);

  // Get Claude auth
  const claudeAuth = await getClaudeAuth(userId);
  if (!claudeAuth) {
    console.error(`[SessionExecutor] User ${userId} does not have Claude authentication configured`);
    throw new Error('Claude authentication not configured for this user. Please connect your Claude account in Settings.');
  }

  // Get GitHub token
  const githubToken = await getGitHubToken(userId);
  if (!githubToken) {
    console.error(`[SessionExecutor] User ${userId} does not have GitHub connected`);
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

  console.log(`[SessionExecutor] Created local session: ${sessionId}`);

  // Setup workspace
  const sessionRoot = path.join(WORKSPACE_DIR, `session-${sessionId}`);
  let workspacePath: string | undefined;

  try {
    // Initialize GitHub session (clone repo, create branch)
    console.log(`[SessionExecutor] Initializing GitHub session for ${gitUrl}`);

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
        console.log(`[SessionExecutor] Init event: ${event.type} - ${event.message}`);
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
    console.log(`[SessionExecutor] Workspace initialized at: ${workspacePath}`);

    // Upload session to storage before calling worker
    if (fs.existsSync(sessionRoot)) {
      await storageService.uploadSessionFromPath(sessionId, sessionRoot);
      console.log(`[SessionExecutor] Session uploaded to storage`);
    }

    // Acquire worker
    console.log(`[SessionExecutor] Acquiring worker...`);
    const workerAssignment = await workerCoordinator.acquireWorker(sessionId);

    if (!workerAssignment) {
      throw new Error('No AI workers available. Please check that the ai-coding-worker service is running.');
    }

    console.log(`[SessionExecutor] Worker acquired: ${workerAssignment.worker.id}`);

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

    console.log(`[SessionExecutor] Calling worker at ${workerAssignment.url}/execute`);

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

          console.log(`[SessionExecutor] Event: ${event.type}`);

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

    console.log(`[SessionExecutor] Session ${sessionId} ${finalStatus}`);

    return {
      sessionId,
      status: sessionError ? 'error' : 'completed',
      branch: finalSession?.branch || undefined,
      error: sessionError,
    };
  } catch (error) {
    console.error(`[SessionExecutor] Session failed:`, error);

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
  console.log(`[SessionExecutor] Archiving session: ${sessionId}`);

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

  console.log(`[SessionExecutor] Archived session: ${sessionId}`);
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
          status: 'completed',
          branch: session.branch || undefined,
        });
        console.log(`[SessionExecutor] Session ${id} completed`);
      } else if (session.status === 'error') {
        pending.delete(id);
        results.set(id, {
          sessionId: id,
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
