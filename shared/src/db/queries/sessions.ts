/**
 * Session Query Helpers
 *
 * Composable query utilities for chatSessions table operations.
 * Reduces duplication in session-related routes and services.
 */

import { eq, and, isNull, desc, asc, sql, inArray, or, isNotNull, gte, lte, ne } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, chatSessions, users, events } from '../index.js';
import type { ChatSession, User } from '../schema.js';
import {
  getPaginationParams,
  buildPaginationMeta,
  type PaginationOptions,
  type PaginatedResult,
} from '../queryHelpers.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Session with user info for list displays
 */
export interface SessionWithUser extends ChatSession {
  user?: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

/**
 * Session list filter options
 */
export interface SessionListOptions {
  /** Filter by user ID */
  userId?: string;
  /** Filter by status */
  status?: string | string[];
  /** Filter by provider */
  provider?: string;
  /** Include soft-deleted sessions */
  includeDeleted?: boolean;
  /** Filter by repository */
  repository?: {
    owner: string;
    name: string;
  };
  /** Filter by branch */
  branch?: string;
  /** Filter by favorite status */
  favorite?: boolean;
  /** Filter by time range */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  /** Only sessions with remoteSessionId */
  hasRemoteSession?: boolean;
}

/**
 * Session list sort options
 */
export type SessionSortField = 'createdAt' | 'updatedAt' | 'completedAt' | 'status';

// =============================================================================
// CONDITION BUILDERS
// =============================================================================

/**
 * Build WHERE conditions for session queries
 */
export function buildSessionConditions(options: SessionListOptions): SQL | undefined {
  const conditions: SQL[] = [];

  if (options.userId) {
    conditions.push(eq(chatSessions.userId, options.userId));
  }

  if (!options.includeDeleted) {
    conditions.push(isNull(chatSessions.deletedAt));
  }

  if (options.status) {
    if (Array.isArray(options.status)) {
      conditions.push(inArray(chatSessions.status, options.status));
    } else {
      conditions.push(eq(chatSessions.status, options.status));
    }
  }

  if (options.provider) {
    conditions.push(eq(chatSessions.provider, options.provider));
  }

  if (options.repository) {
    conditions.push(eq(chatSessions.repositoryOwner, options.repository.owner));
    conditions.push(eq(chatSessions.repositoryName, options.repository.name));
  }

  if (options.branch) {
    conditions.push(eq(chatSessions.branch, options.branch));
  }

  if (options.favorite !== undefined) {
    conditions.push(eq(chatSessions.favorite, options.favorite));
  }

  if (options.timeRange?.start) {
    conditions.push(gte(chatSessions.createdAt, options.timeRange.start));
  }

  if (options.timeRange?.end) {
    conditions.push(lte(chatSessions.createdAt, options.timeRange.end));
  }

  if (options.hasRemoteSession !== undefined) {
    if (options.hasRemoteSession) {
      conditions.push(isNotNull(chatSessions.remoteSessionId));
    } else {
      conditions.push(isNull(chatSessions.remoteSessionId));
    }
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

// =============================================================================
// SINGLE RECORD QUERIES
// =============================================================================

/**
 * Find a session by ID
 */
export async function findSessionById(
  id: string,
  options?: { includeDeleted?: boolean }
): Promise<ChatSession | null> {
  const conditions: SQL[] = [eq(chatSessions.id, id)];

  if (!options?.includeDeleted) {
    conditions.push(isNull(chatSessions.deletedAt));
  }

  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(...conditions))
    .limit(1);

  return session ?? null;
}

/**
 * Find a session by ID with ownership check
 */
export async function findUserSession(
  id: string,
  userId: string,
  options?: { includeDeleted?: boolean }
): Promise<ChatSession | null> {
  const conditions: SQL[] = [
    eq(chatSessions.id, id),
    eq(chatSessions.userId, userId),
  ];

  if (!options?.includeDeleted) {
    conditions.push(isNull(chatSessions.deletedAt));
  }

  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(...conditions))
    .limit(1);

  return session ?? null;
}

/**
 * Find a session by remoteSessionId
 */
export async function findSessionByRemoteId(
  remoteSessionId: string
): Promise<ChatSession | null> {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(eq(chatSessions.remoteSessionId, remoteSessionId))
    .limit(1);

  return session ?? null;
}

/**
 * Find a session by sessionPath
 */
export async function findSessionByPath(
  sessionPath: string,
  options?: { includeDeleted?: boolean }
): Promise<ChatSession | null> {
  const conditions: SQL[] = [eq(chatSessions.sessionPath, sessionPath)];

  if (!options?.includeDeleted) {
    conditions.push(isNull(chatSessions.deletedAt));
  }

  const [session] = await db
    .select()
    .from(chatSessions)
    .where(and(...conditions))
    .limit(1);

  return session ?? null;
}

// =============================================================================
// LIST QUERIES
// =============================================================================

/**
 * List sessions with filtering and pagination
 */
export async function listSessions(
  options: SessionListOptions & { pagination?: PaginationOptions }
): Promise<PaginatedResult<ChatSession>> {
  const { pagination, ...filterOptions } = options;
  const { limit, offset } = getPaginationParams(pagination);

  const conditions = buildSessionConditions(filterOptions);

  // Get data
  const data = await db
    .select()
    .from(chatSessions)
    .where(conditions)
    .orderBy(desc(chatSessions.createdAt))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatSessions)
    .where(conditions);

  const total = countResult?.count ?? 0;

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * List user's sessions (most common use case)
 */
export async function listUserSessions(
  userId: string,
  options?: Omit<SessionListOptions, 'userId'> & { pagination?: PaginationOptions }
): Promise<PaginatedResult<ChatSession>> {
  return listSessions({ ...options, userId });
}

/**
 * Get running sessions for a user (for status checks)
 */
export async function getRunningSessions(userId: string): Promise<ChatSession[]> {
  return db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.status, 'running'),
        isNull(chatSessions.deletedAt)
      )
    );
}

/**
 * Get sessions with remoteSessionId for sync operations
 */
export async function getRemoteLinkedSessions(
  userId: string,
  options?: { status?: string }
): Promise<Array<{ id: string; remoteSessionId: string | null }>> {
  const conditions: SQL[] = [
    eq(chatSessions.userId, userId),
    isNotNull(chatSessions.remoteSessionId),
  ];

  if (options?.status) {
    conditions.push(eq(chatSessions.status, options.status));
  }

  return db
    .select({
      id: chatSessions.id,
      remoteSessionId: chatSessions.remoteSessionId,
    })
    .from(chatSessions)
    .where(and(...conditions));
}

// =============================================================================
// COUNT QUERIES
// =============================================================================

/**
 * Count user's sessions
 */
export async function countUserSessions(
  userId: string,
  options?: Omit<SessionListOptions, 'userId'>
): Promise<number> {
  const conditions = buildSessionConditions({ ...options, userId });

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chatSessions)
    .where(conditions);

  return result?.count ?? 0;
}

/**
 * Count sessions by status for a user
 */
export async function countSessionsByStatus(
  userId: string
): Promise<Record<string, number>> {
  const results = await db
    .select({
      status: chatSessions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        isNull(chatSessions.deletedAt)
      )
    )
    .groupBy(chatSessions.status);

  return Object.fromEntries(results.map(r => [r.status, r.count]));
}

// =============================================================================
// EXISTENCE CHECKS
// =============================================================================

/**
 * Check if a session exists and belongs to a user
 */
export async function verifySessionOwnership(
  sessionId: string,
  userId: string
): Promise<{ exists: boolean; owned: boolean }> {
  const [session] = await db
    .select({ userId: chatSessions.userId })
    .from(chatSessions)
    .where(eq(chatSessions.id, sessionId))
    .limit(1);

  if (!session) {
    return { exists: false, owned: false };
  }

  return { exists: true, owned: session.userId === userId };
}

/**
 * Check if a sessionPath already exists
 */
export async function sessionPathExists(
  sessionPath: string,
  excludeId?: string
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(chatSessions.sessionPath, sessionPath),
    isNull(chatSessions.deletedAt),
  ];

  if (excludeId) {
    conditions.push(ne(chatSessions.id, excludeId));
  }

  const [existing] = await db
    .select({ id: chatSessions.id })
    .from(chatSessions)
    .where(and(...conditions))
    .limit(1);

  return !!existing;
}

// =============================================================================
// SYNC HELPERS (for claudeSessionSync.ts)
// =============================================================================

/**
 * Find potential matching session for sync (by branch + repo)
 */
export async function findMatchingSessionByBranch(
  userId: string,
  repositoryOwner: string,
  repositoryName: string,
  branch: string
): Promise<ChatSession | null> {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.repositoryOwner, repositoryOwner),
        eq(chatSessions.repositoryName, repositoryName),
        eq(chatSessions.branch, branch),
        isNull(chatSessions.remoteSessionId),
        isNull(chatSessions.deletedAt)
      )
    )
    .limit(1);

  return session ?? null;
}

/**
 * Find potential matching session for sync (by repo + time window)
 */
export async function findMatchingSessionByRepoAndTime(
  userId: string,
  repositoryOwner: string,
  repositoryName: string,
  timeStart: Date,
  statuses: string[] = ['pending', 'running']
): Promise<ChatSession | null> {
  const [session] = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.repositoryOwner, repositoryOwner),
        eq(chatSessions.repositoryName, repositoryName),
        isNull(chatSessions.remoteSessionId),
        isNull(chatSessions.deletedAt),
        inArray(chatSessions.status, statuses),
        gte(chatSessions.createdAt, timeStart)
      )
    )
    .orderBy(asc(chatSessions.createdAt))
    .limit(1);

  return session ?? null;
}

/**
 * Find redundant sessions (for cleanup after sync)
 */
export async function findRedundantSessions(
  userId: string,
  linkedSessionId: string,
  timeStart: Date,
  timeEnd: Date,
  repositoryOwner?: string | null,
  repositoryName?: string | null
): Promise<ChatSession[]> {
  const sessions = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        ne(chatSessions.id, linkedSessionId),
        isNull(chatSessions.remoteSessionId),
        isNull(chatSessions.deletedAt),
        or(
          eq(chatSessions.status, 'pending'),
          eq(chatSessions.status, 'running')
        ),
        gte(chatSessions.createdAt, timeStart),
        lte(chatSessions.createdAt, timeEnd)
      )
    );

  // Filter to truly redundant sessions
  return sessions.filter(session => {
    // No repository info = orphaned
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
}

// =============================================================================
// EVENT HELPERS
// =============================================================================

/**
 * Get existing event UUIDs for a session (for deduplication during sync)
 */
export async function getSessionEventUuids(chatSessionId: string): Promise<Set<string>> {
  const results = await db
    .select({ uuid: events.uuid })
    .from(events)
    .where(
      and(
        eq(events.chatSessionId, chatSessionId),
        isNotNull(events.uuid)
      )
    );

  return new Set(results.map(r => r.uuid).filter((u): u is string => u !== null));
}
