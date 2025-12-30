/**
 * Collection Query Helpers
 *
 * Composable query utilities for collections and session-collection operations.
 * Reduces duplication in collections routes.
 */

import { eq, and, isNull, desc, asc, sql, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, collections, sessionCollections, chatSessions } from '../index.js';
import type { Collection, SessionCollection, ChatSession } from '../schema.js';
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
 * Collection with session count
 */
export interface CollectionWithCount extends Collection {
  sessionCount: number;
}

/**
 * Session with collection membership info
 */
export interface SessionInCollection extends ChatSession {
  addedAt: Date;
}

// =============================================================================
// SINGLE RECORD QUERIES
// =============================================================================

/**
 * Find a collection by ID
 */
export async function findCollectionById(id: string): Promise<Collection | null> {
  const [collection] = await db
    .select()
    .from(collections)
    .where(eq(collections.id, id))
    .limit(1);

  return collection ?? null;
}

/**
 * Find a collection by ID with ownership check
 */
export async function findUserCollection(
  id: string,
  userId: string
): Promise<Collection | null> {
  const [collection] = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.id, id),
        eq(collections.userId, userId)
      )
    )
    .limit(1);

  return collection ?? null;
}

/**
 * Find a collection by name for a user (for duplicate checking)
 */
export async function findCollectionByName(
  userId: string,
  name: string
): Promise<Collection | null> {
  const [collection] = await db
    .select()
    .from(collections)
    .where(
      and(
        eq(collections.userId, userId),
        eq(collections.name, name)
      )
    )
    .limit(1);

  return collection ?? null;
}

// =============================================================================
// LIST QUERIES
// =============================================================================

/**
 * List all collections for a user with session counts
 */
export async function listUserCollections(
  userId: string
): Promise<CollectionWithCount[]> {
  const userCollections = await db
    .select({
      id: collections.id,
      userId: collections.userId,
      name: collections.name,
      description: collections.description,
      color: collections.color,
      icon: collections.icon,
      sortOrder: collections.sortOrder,
      isDefault: collections.isDefault,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
      sessionCount: sql<number>`(
        SELECT COUNT(*)::int
        FROM ${sessionCollections}
        INNER JOIN ${chatSessions} ON ${sessionCollections.sessionId} = ${chatSessions.id}
        WHERE ${sessionCollections.collectionId} = ${collections.id}
          AND ${chatSessions.deletedAt} IS NULL
      )`,
    })
    .from(collections)
    .where(eq(collections.userId, userId))
    .orderBy(asc(collections.sortOrder), asc(collections.name));

  return userCollections;
}

/**
 * Get collections for a specific session
 */
export async function getSessionCollections(
  sessionId: string
): Promise<Collection[]> {
  const sessionCols = await db
    .select({
      id: collections.id,
      userId: collections.userId,
      name: collections.name,
      description: collections.description,
      color: collections.color,
      icon: collections.icon,
      sortOrder: collections.sortOrder,
      isDefault: collections.isDefault,
      createdAt: collections.createdAt,
      updatedAt: collections.updatedAt,
    })
    .from(sessionCollections)
    .innerJoin(collections, eq(sessionCollections.collectionId, collections.id))
    .where(eq(sessionCollections.sessionId, sessionId))
    .orderBy(asc(collections.sortOrder), asc(collections.name));

  return sessionCols;
}

/**
 * Get sessions in a collection (with soft-delete filtering)
 */
export async function getCollectionSessions(
  collectionId: string
): Promise<SessionInCollection[]> {
  const sessions = await db
    .select({
      id: chatSessions.id,
      userId: chatSessions.userId,
      sessionPath: chatSessions.sessionPath,
      repositoryOwner: chatSessions.repositoryOwner,
      repositoryName: chatSessions.repositoryName,
      repositoryUrl: chatSessions.repositoryUrl,
      userRequest: chatSessions.userRequest,
      status: chatSessions.status,
      baseBranch: chatSessions.baseBranch,
      branch: chatSessions.branch,
      provider: chatSessions.provider,
      providerSessionId: chatSessions.providerSessionId,
      remoteSessionId: chatSessions.remoteSessionId,
      remoteWebUrl: chatSessions.remoteWebUrl,
      totalCost: chatSessions.totalCost,
      issueNumber: chatSessions.issueNumber,
      autoCommit: chatSessions.autoCommit,
      locked: chatSessions.locked,
      createdAt: chatSessions.createdAt,
      completedAt: chatSessions.completedAt,
      deletedAt: chatSessions.deletedAt,
      workerLastActivity: chatSessions.workerLastActivity,
      favorite: chatSessions.favorite,
      shareToken: chatSessions.shareToken,
      shareExpiresAt: chatSessions.shareExpiresAt,
      version: chatSessions.version,
      organizationId: chatSessions.organizationId,
      addedAt: sessionCollections.addedAt,
    })
    .from(sessionCollections)
    .innerJoin(chatSessions, eq(sessionCollections.sessionId, chatSessions.id))
    .where(
      and(
        eq(sessionCollections.collectionId, collectionId),
        isNull(chatSessions.deletedAt)
      )
    )
    .orderBy(desc(sessionCollections.addedAt));

  return sessions;
}

// =============================================================================
// MEMBERSHIP OPERATIONS
// =============================================================================

/**
 * Check if a session is in a collection
 */
export async function isSessionInCollection(
  sessionId: string,
  collectionId: string
): Promise<boolean> {
  const [existing] = await db
    .select({ id: sessionCollections.id })
    .from(sessionCollections)
    .where(
      and(
        eq(sessionCollections.sessionId, sessionId),
        eq(sessionCollections.collectionId, collectionId)
      )
    )
    .limit(1);

  return !!existing;
}

/**
 * Get collection IDs that a session belongs to
 */
export async function getSessionCollectionIds(sessionId: string): Promise<string[]> {
  const memberships = await db
    .select({ collectionId: sessionCollections.collectionId })
    .from(sessionCollections)
    .where(eq(sessionCollections.sessionId, sessionId));

  return memberships.map(m => m.collectionId);
}

/**
 * Get existing collection memberships for a session (for bulk operations)
 */
export async function getExistingMemberships(
  sessionId: string
): Promise<Set<string>> {
  const memberships = await db
    .select({ collectionId: sessionCollections.collectionId })
    .from(sessionCollections)
    .where(eq(sessionCollections.sessionId, sessionId));

  return new Set(memberships.map(m => m.collectionId));
}

// =============================================================================
// OWNERSHIP VERIFICATION
// =============================================================================

/**
 * Verify collection ownership
 */
export async function verifyCollectionOwnership(
  collectionId: string,
  userId: string
): Promise<{ exists: boolean; owned: boolean }> {
  const [collection] = await db
    .select({ userId: collections.userId })
    .from(collections)
    .where(eq(collections.id, collectionId))
    .limit(1);

  if (!collection) {
    return { exists: false, owned: false };
  }

  return { exists: true, owned: collection.userId === userId };
}

/**
 * Get user's collection IDs (for bulk validation)
 */
export async function getUserCollectionIds(userId: string): Promise<Set<string>> {
  const userCollections = await db
    .select({ id: collections.id })
    .from(collections)
    .where(eq(collections.userId, userId));

  return new Set(userCollections.map(c => c.id));
}

/**
 * Validate that collection IDs belong to a user
 */
export async function validateCollectionOwnership(
  collectionIds: string[],
  userId: string
): Promise<{ valid: string[]; invalid: string[] }> {
  if (collectionIds.length === 0) {
    return { valid: [], invalid: [] };
  }

  const userIds = await getUserCollectionIds(userId);

  const valid: string[] = [];
  const invalid: string[] = [];

  for (const id of collectionIds) {
    if (userIds.has(id)) {
      valid.push(id);
    } else {
      invalid.push(id);
    }
  }

  return { valid, invalid };
}

// =============================================================================
// COUNT & MAX QUERIES
// =============================================================================

/**
 * Get the maximum sort order for a user's collections
 */
export async function getMaxSortOrder(userId: string): Promise<number> {
  const [result] = await db
    .select({ maxSort: collections.sortOrder })
    .from(collections)
    .where(eq(collections.userId, userId))
    .orderBy(desc(collections.sortOrder))
    .limit(1);

  return result?.maxSort ?? -1;
}

/**
 * Count sessions in a collection
 */
export async function countCollectionSessions(collectionId: string): Promise<number> {
  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(sessionCollections)
    .innerJoin(chatSessions, eq(sessionCollections.sessionId, chatSessions.id))
    .where(
      and(
        eq(sessionCollections.collectionId, collectionId),
        isNull(chatSessions.deletedAt)
      )
    );

  return result?.count ?? 0;
}

// =============================================================================
// DUPLICATE CHECKING
// =============================================================================

/**
 * Check if a collection name already exists for a user
 */
export async function collectionNameExists(
  userId: string,
  name: string,
  excludeId?: string
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(collections.userId, userId),
    eq(collections.name, name.trim()),
  ];

  if (excludeId) {
    conditions.push(sql`${collections.id} != ${excludeId}`);
  }

  const [existing] = await db
    .select({ id: collections.id })
    .from(collections)
    .where(and(...conditions))
    .limit(1);

  return !!existing;
}
