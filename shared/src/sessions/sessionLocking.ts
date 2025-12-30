/**
 * Session Locking Utilities
 *
 * Provides optimistic and pessimistic locking for session status transitions:
 * - Optimistic locking: Uses version column for concurrent update detection
 * - Pessimistic locking: Uses SELECT ... FOR UPDATE within transactions
 *
 * These utilities prevent race conditions when multiple concurrent requests
 * attempt to update the same session (e.g., two resume requests, or a sync
 * job racing with user interaction).
 */

import { eq, and, sql } from 'drizzle-orm';
import { chatSessions, db } from '../db/index.js';
import { logger } from '../utils/logging/logger.js';

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { TransactionContext } from '../db/index.js';
import type { ChatSession } from '../db/index.js';
import type * as schema from '../db/schema.js';

/**
 * Valid session status values
 */
export type SessionStatus = 'pending' | 'running' | 'completed' | 'error';

/**
 * Error thrown when optimistic locking detects a version conflict.
 * This indicates another process has modified the session since it was read.
 */
export class VersionConflictError extends Error {
  readonly sessionId: string;
  readonly expectedVersion: number;
  readonly code = 'VERSION_CONFLICT';

  constructor(sessionId: string, expectedVersion: number) {
    super(`Version conflict for session ${sessionId}: expected version ${expectedVersion} was already updated by another process`);
    this.name = 'VersionConflictError';
    this.sessionId = sessionId;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Error thrown when a session is not found during a locking operation.
 */
export class SessionNotFoundError extends Error {
  readonly sessionId: string;
  readonly code = 'SESSION_NOT_FOUND';

  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = 'SessionNotFoundError';
    this.sessionId = sessionId;
  }
}

/**
 * Error thrown when a status transition is not allowed.
 */
export class InvalidStatusTransitionError extends Error {
  readonly sessionId: string;
  readonly currentStatus: string;
  readonly targetStatus: string;
  readonly code = 'INVALID_STATUS_TRANSITION';

  constructor(sessionId: string, currentStatus: string, targetStatus: string) {
    super(`Invalid status transition for session ${sessionId}: cannot transition from '${currentStatus}' to '${targetStatus}'`);
    this.name = 'InvalidStatusTransitionError';
    this.sessionId = sessionId;
    this.currentStatus = currentStatus;
    this.targetStatus = targetStatus;
  }
}

/**
 * Fields that can be updated in a session status update.
 */
export interface SessionStatusUpdate {
  status: SessionStatus;
  completedAt?: Date | null;
  workerLastActivity?: Date | null;
  totalCost?: string | null;
  branch?: string | null;
  remoteSessionId?: string | null;
  remoteWebUrl?: string | null;
}

/**
 * Result of an optimistic update operation.
 */
export interface OptimisticUpdateResult {
  success: boolean;
  newVersion: number;
  rowsAffected: number;
}

/**
 * Define allowed status transitions.
 * Key is current status, value is array of allowed target statuses.
 */
const ALLOWED_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  pending: ['running', 'error'],
  running: ['completed', 'error'],
  completed: ['running'], // Allow resume
  error: ['running'],     // Allow retry/resume
};

/**
 * Check if a status transition is allowed.
 */
export function isValidStatusTransition(
  currentStatus: SessionStatus,
  targetStatus: SessionStatus
): boolean {
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  return allowed ? allowed.includes(targetStatus) : false;
}

/**
 * Update a session with optimistic locking.
 *
 * Uses the version column to detect concurrent modifications:
 * - Reads current version
 * - Updates only if version matches expected
 * - Increments version on success
 *
 * @throws VersionConflictError if the version doesn't match
 * @throws SessionNotFoundError if the session doesn't exist
 * @throws InvalidStatusTransitionError if the status transition is not allowed
 */
export async function updateSessionWithOptimisticLock(
  sessionId: string,
  expectedVersion: number,
  update: SessionStatusUpdate,
  options: {
    validateTransition?: boolean;
    currentStatus?: SessionStatus;
    dbInstance?: NodePgDatabase<typeof schema>;
  } = {}
): Promise<OptimisticUpdateResult> {
  const { validateTransition = true, currentStatus, dbInstance = db } = options;

  // Validate status transition if requested
  if (validateTransition && currentStatus) {
    if (!isValidStatusTransition(currentStatus, update.status)) {
      throw new InvalidStatusTransitionError(sessionId, currentStatus, update.status);
    }
  }

  const newVersion = expectedVersion + 1;

  // Perform conditional update with version check
  const result = await dbInstance.update(chatSessions)
    .set({
      ...update,
      version: newVersion,
    })
    .where(
      and(
        eq(chatSessions.id, sessionId),
        eq(chatSessions.version, expectedVersion)
      )
    );

  // Check if update was successful (row was modified)
  const rowsAffected = Number(result.rowCount ?? 0);

  if (rowsAffected === 0) {
    // Could be either version conflict or session not found
    // Check which one by querying the session
    const [session] = await dbInstance
      .select({ id: chatSessions.id, version: chatSessions.version })
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);

    if (!session) {
      throw new SessionNotFoundError(sessionId);
    }

    // Session exists but version doesn't match - conflict
    logger.warn('Optimistic lock conflict detected', {
      component: 'SessionLocking',
      sessionId,
      expectedVersion,
      actualVersion: session.version,
    });
    throw new VersionConflictError(sessionId, expectedVersion);
  }

  logger.debug('Session updated with optimistic lock', {
    component: 'SessionLocking',
    sessionId,
    oldVersion: expectedVersion,
    newVersion,
    newStatus: update.status,
  });

  return {
    success: true,
    newVersion,
    rowsAffected,
  };
}

/**
 * Acquire a pessimistic lock on a session within a transaction.
 *
 * Uses SELECT ... FOR UPDATE to lock the row until the transaction completes.
 * This prevents other transactions from reading or updating the row.
 *
 * @param tx Transaction context
 * @param sessionId Session ID to lock
 * @param options Lock options
 * @returns The locked session data
 * @throws SessionNotFoundError if the session doesn't exist
 */
export async function lockSessionForUpdate(
  tx: TransactionContext,
  sessionId: string,
  options: {
    nowait?: boolean;     // Fail immediately if lock cannot be acquired
    skipLocked?: boolean; // Skip row if locked by another transaction
  } = {}
): Promise<ChatSession> {
  const { nowait = false, skipLocked = false } = options;

  // Build the lock clause
  let lockClause = 'FOR UPDATE';
  if (nowait) {
    lockClause += ' NOWAIT';
  } else if (skipLocked) {
    lockClause += ' SKIP LOCKED';
  }

  // Execute raw query with FOR UPDATE lock
  const result = await tx.execute(sql`
    SELECT *
    FROM chat_sessions
    WHERE id = ${sessionId}
    ${sql.raw(lockClause)}
  `) as { rows: unknown[] };

  const rows = result.rows;
  if (!rows || rows.length === 0) {
    throw new SessionNotFoundError(sessionId);
  }

  // Map the raw result to ChatSession type
  const row = rows[0] as Record<string, unknown>;
  return mapRowToChatSession(row);
}

/**
 * Update session status with pessimistic locking.
 *
 * This is the recommended approach for critical status transitions.
 * It acquires a row lock, validates the transition, and updates atomically.
 *
 * @param tx Transaction context
 * @param sessionId Session ID to update
 * @param update Status update to apply
 * @param options Update options
 * @returns The updated session
 */
export async function updateSessionStatusWithLock(
  tx: TransactionContext,
  sessionId: string,
  update: SessionStatusUpdate,
  options: {
    validateTransition?: boolean;
    allowedFromStatuses?: SessionStatus[];
  } = {}
): Promise<ChatSession> {
  const { validateTransition = true, allowedFromStatuses } = options;

  // Acquire pessimistic lock and get current session state
  const session = await lockSessionForUpdate(tx, sessionId);
  const currentStatus = session.status as SessionStatus;

  // Validate transition if requested
  if (validateTransition) {
    // If specific allowed statuses are provided, check against those
    if (allowedFromStatuses) {
      if (!allowedFromStatuses.includes(currentStatus)) {
        throw new InvalidStatusTransitionError(sessionId, currentStatus, update.status);
      }
    } else {
      // Otherwise use the standard transition rules
      if (!isValidStatusTransition(currentStatus, update.status)) {
        throw new InvalidStatusTransitionError(sessionId, currentStatus, update.status);
      }
    }
  }

  // Perform the update with version increment
  const newVersion = session.version + 1;
  await tx.update(chatSessions)
    .set({
      ...update,
      version: newVersion,
    })
    .where(eq(chatSessions.id, sessionId));

  logger.debug('Session status updated with pessimistic lock', {
    component: 'SessionLocking',
    sessionId,
    oldStatus: currentStatus,
    newStatus: update.status,
    oldVersion: session.version,
    newVersion,
  });

  // Return updated session
  return {
    ...session,
    ...update,
    version: newVersion,
  };
}

/**
 * Map a raw database row to ChatSession type.
 * Handles snake_case to camelCase conversion.
 */
function mapRowToChatSession(row: Record<string, unknown>): ChatSession {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    organizationId: row.organization_id as string | null,
    sessionPath: row.session_path as string | null,
    repositoryOwner: row.repository_owner as string | null,
    repositoryName: row.repository_name as string | null,
    userRequest: row.user_request as string,
    status: row.status as string,
    repositoryUrl: row.repository_url as string | null,
    baseBranch: row.base_branch as string | null,
    branch: row.branch as string | null,
    provider: row.provider as string | null,
    providerSessionId: row.provider_session_id as string | null,
    remoteSessionId: row.remote_session_id as string | null,
    remoteWebUrl: row.remote_web_url as string | null,
    totalCost: row.total_cost as string | null,
    issueNumber: row.issue_number as number | null,
    autoCommit: row.auto_commit as boolean,
    locked: row.locked as boolean,
    createdAt: row.created_at as Date,
    completedAt: row.completed_at as Date | null,
    deletedAt: row.deleted_at as Date | null,
    workerLastActivity: row.worker_last_activity as Date | null,
    favorite: row.favorite as boolean,
    shareToken: row.share_token as string | null,
    shareExpiresAt: row.share_expires_at as Date | null,
    version: row.version as number,
  };
}

/**
 * Helper to check if an error is a version conflict.
 */
export function isVersionConflict(error: unknown): error is VersionConflictError {
  return error instanceof VersionConflictError;
}

/**
 * Helper to check if an error is a session not found error.
 */
export function isSessionNotFound(error: unknown): error is SessionNotFoundError {
  return error instanceof SessionNotFoundError;
}

/**
 * Helper to check if an error is an invalid status transition.
 */
export function isInvalidStatusTransition(error: unknown): error is InvalidStatusTransitionError {
  return error instanceof InvalidStatusTransitionError;
}

/**
 * Get a session with its current version for optimistic locking.
 */
export async function getSessionWithVersion(
  sessionId: string,
  dbInstance: NodePgDatabase<typeof schema> = db
): Promise<{ session: ChatSession; version: number } | null> {
  const [session] = await dbInstance
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return null;
  }

  return {
    session,
    version: session.version,
  };
}
