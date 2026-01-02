/**
 * Collection Entity Loader
 *
 * Provides batch loading capabilities for user collections and session
 * memberships, preventing N+1 query problems when fetching collection data.
 */

import { inArray, eq, and, isNull, sql } from 'drizzle-orm';
import { db, collections, sessionCollections, chatSessions } from '../index.js';
import { DataLoader, createResultMap } from '../dataLoader.js';

import type { Collection, SessionCollection, ChatSession } from '../schema.js';
import type { DataLoaderOptions } from '../dataLoader.js';

/**
 * Collection with session count
 */
export interface CollectionWithCount {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  sessionCount: number;
}

/**
 * Session collection membership info
 */
export interface SessionCollectionInfo {
  collectionId: string;
  collectionName: string;
  collectionColor: string | null;
  collectionIcon: string | null;
  addedAt: Date;
}

/**
 * Create a DataLoader for batch loading collections by ID
 *
 * @example
 * const collectionLoader = createCollectionLoader();
 * const [col1, col2] = await Promise.all([
 *   collectionLoader.load('collection-id-1'),
 *   collectionLoader.load('collection-id-2'),
 * ]);
 */
export function createCollectionLoader(options?: DataLoaderOptions): DataLoader<string, Collection> {
  return new DataLoader<string, Collection>(
    async (collectionIds: string[]) => {
      const results = await db
        .select()
        .from(collections)
        .where(inArray(collections.id, collectionIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading user's collections with session counts
 * Returns all collections for a user with the count of non-deleted sessions
 *
 * @example
 * const userCollectionsLoader = createUserCollectionsLoader();
 * const collections = await userCollectionsLoader.load('user-123');
 */
export function createUserCollectionsLoader(options?: DataLoaderOptions): DataLoader<string, CollectionWithCount[]> {
  return new DataLoader<string, CollectionWithCount[]>(
    async (userIds: string[]) => {
      // Get all collections for these users with session counts in a single query
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
        .where(inArray(collections.userId, userIds));

      // Group by userId
      const map = new Map<string, CollectionWithCount[]>();
      for (const userId of userIds) {
        map.set(userId, []);
      }
      for (const col of userCollections) {
        const list = map.get(col.userId);
        if (list) {
          list.push(col);
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading collection session counts
 */
export function createCollectionSessionCountLoader(options?: DataLoaderOptions): DataLoader<string, number> {
  return new DataLoader<string, number>(
    async (collectionIds: string[]) => {
      const counts = await db
        .select({
          collectionId: sessionCollections.collectionId,
          count: sql<number>`COUNT(*)::int`,
        })
        .from(sessionCollections)
        .innerJoin(chatSessions, eq(sessionCollections.sessionId, chatSessions.id))
        .where(
          and(
            inArray(sessionCollections.collectionId, collectionIds),
            isNull(chatSessions.deletedAt)
          )
        )
        .groupBy(sessionCollections.collectionId);

      const countMap = new Map(counts.map(c => [c.collectionId, c.count]));

      const map = new Map<string, number>();
      for (const colId of collectionIds) {
        map.set(colId, countMap.get(colId) ?? 0);
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading collections that a session belongs to
 *
 * @example
 * const sessionCollectionsLoader = createSessionCollectionsLoader();
 * const collections = await sessionCollectionsLoader.load('session-123');
 */
export function createSessionCollectionsLoader(options?: DataLoaderOptions): DataLoader<string, SessionCollectionInfo[]> {
  return new DataLoader<string, SessionCollectionInfo[]>(
    async (sessionIds: string[]) => {
      const memberships = await db
        .select({
          sessionId: sessionCollections.sessionId,
          collectionId: collections.id,
          collectionName: collections.name,
          collectionColor: collections.color,
          collectionIcon: collections.icon,
          addedAt: sessionCollections.addedAt,
        })
        .from(sessionCollections)
        .innerJoin(collections, eq(sessionCollections.collectionId, collections.id))
        .where(inArray(sessionCollections.sessionId, sessionIds));

      // Group by sessionId
      const map = new Map<string, SessionCollectionInfo[]>();
      for (const sessionId of sessionIds) {
        map.set(sessionId, []);
      }
      for (const membership of memberships) {
        const list = map.get(membership.sessionId);
        if (list) {
          list.push({
            collectionId: membership.collectionId,
            collectionName: membership.collectionName,
            collectionColor: membership.collectionColor,
            collectionIcon: membership.collectionIcon,
            addedAt: membership.addedAt,
          });
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading sessions in a collection
 * Returns session IDs for each collection
 */
export function createCollectionSessionsLoader(options?: DataLoaderOptions): DataLoader<string, string[]> {
  return new DataLoader<string, string[]>(
    async (collectionIds: string[]) => {
      const memberships = await db
        .select({
          collectionId: sessionCollections.collectionId,
          sessionId: sessionCollections.sessionId,
        })
        .from(sessionCollections)
        .innerJoin(chatSessions, eq(sessionCollections.sessionId, chatSessions.id))
        .where(
          and(
            inArray(sessionCollections.collectionId, collectionIds),
            isNull(chatSessions.deletedAt)
          )
        );

      // Group by collectionId
      const map = new Map<string, string[]>();
      for (const colId of collectionIds) {
        map.set(colId, []);
      }
      for (const membership of memberships) {
        const list = map.get(membership.collectionId);
        if (list) {
          list.push(membership.sessionId);
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for checking if a session is in specific collections
 * Used to verify user ownership before adding/removing sessions
 */
export function createSessionInCollectionLoader(
  userId: string,
  options?: DataLoaderOptions
): DataLoader<string, Set<string>> {
  return new DataLoader<string, Set<string>>(
    async (sessionIds: string[]) => {
      // First verify these sessions belong to the user
      const userSessions = await db
        .select({ id: chatSessions.id })
        .from(chatSessions)
        .where(
          and(
            inArray(chatSessions.id, sessionIds),
            eq(chatSessions.userId, userId)
          )
        );

      const userSessionIds = new Set(userSessions.map(s => s.id));

      // Get collection memberships for user's sessions
      const memberships = await db
        .select({
          sessionId: sessionCollections.sessionId,
          collectionId: sessionCollections.collectionId,
        })
        .from(sessionCollections)
        .innerJoin(collections, eq(sessionCollections.collectionId, collections.id))
        .where(
          and(
            inArray(sessionCollections.sessionId, sessionIds),
            eq(collections.userId, userId)
          )
        );

      // Group by sessionId
      const map = new Map<string, Set<string>>();
      for (const sessionId of sessionIds) {
        map.set(sessionId, new Set());
      }
      for (const membership of memberships) {
        if (userSessionIds.has(membership.sessionId)) {
          const set = map.get(membership.sessionId);
          if (set) {
            set.add(membership.collectionId);
          }
        }
      }
      return map;
    },
    options
  );
}
