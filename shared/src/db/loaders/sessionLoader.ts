/**
 * Session Entity Loader
 *
 * Provides batch loading capabilities for chat sessions, preventing N+1 query
 * problems when fetching session information across multiple operations.
 */

import { inArray, and, isNull } from 'drizzle-orm';
import { db, chatSessions } from '../index.js';
import { DataLoader, createResultMap } from '../dataLoader.js';

import type { ChatSession } from '../schema.js';
import type { DataLoaderOptions } from '../dataLoader.js';

/**
 * Session summary info (lightweight version for lists)
 */
export interface SessionSummary {
  id: string;
  userId: string;
  userRequest: string;
  provider: string | null;
  status: string;
  repositoryOwner: string | null;
  repositoryName: string | null;
  branch: string | null;
  favorite: boolean;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}

/**
 * Create a DataLoader for batch loading chat sessions by ID
 *
 * @example
 * const sessionLoader = createSessionLoader();
 * const [session1, session2] = await Promise.all([
 *   sessionLoader.load('session-id-1'),
 *   sessionLoader.load('session-id-2'),
 * ]);
 */
export function createSessionLoader(options?: DataLoaderOptions): DataLoader<string, ChatSession> {
  return new DataLoader<string, ChatSession>(
    async (sessionIds: string[]) => {
      const results = await db
        .select()
        .from(chatSessions)
        .where(inArray(chatSessions.id, sessionIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading active (non-deleted) sessions by ID
 */
export function createActiveSessionLoader(options?: DataLoaderOptions): DataLoader<string, ChatSession> {
  return new DataLoader<string, ChatSession>(
    async (sessionIds: string[]) => {
      const results = await db
        .select()
        .from(chatSessions)
        .where(
          and(
            inArray(chatSessions.id, sessionIds),
            isNull(chatSessions.deletedAt)
          )
        );

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading session summaries
 */
export function createSessionSummaryLoader(options?: DataLoaderOptions): DataLoader<string, SessionSummary> {
  return new DataLoader<string, SessionSummary>(
    async (sessionIds: string[]) => {
      const results = await db
        .select({
          id: chatSessions.id,
          userId: chatSessions.userId,
          userRequest: chatSessions.userRequest,
          provider: chatSessions.provider,
          status: chatSessions.status,
          repositoryOwner: chatSessions.repositoryOwner,
          repositoryName: chatSessions.repositoryName,
          branch: chatSessions.branch,
          favorite: chatSessions.favorite,
          createdAt: chatSessions.createdAt,
          completedAt: chatSessions.completedAt,
          deletedAt: chatSessions.deletedAt,
        })
        .from(chatSessions)
        .where(inArray(chatSessions.id, sessionIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading sessions by user ID
 * Returns all sessions for each user ID
 *
 * @example
 * const userSessionsLoader = createUserSessionsLoader();
 * const [user1Sessions, user2Sessions] = await Promise.all([
 *   userSessionsLoader.load('user-id-1'),
 *   userSessionsLoader.load('user-id-2'),
 * ]);
 */
export function createUserSessionsLoader(
  options?: DataLoaderOptions & { includeDeleted?: boolean }
): DataLoader<string, ChatSession[]> {
  const { includeDeleted = false, ...loaderOptions } = options || {};

  return new DataLoader<string, ChatSession[]>(
    async (userIds: string[]) => {
      const conditions = [inArray(chatSessions.userId, userIds)];
      if (!includeDeleted) {
        conditions.push(isNull(chatSessions.deletedAt));
      }

      const results = await db
        .select()
        .from(chatSessions)
        .where(and(...conditions));

      // Group by userId
      const map = new Map<string, ChatSession[]>();
      for (const userId of userIds) {
        map.set(userId, []);
      }
      for (const session of results) {
        const list = map.get(session.userId);
        if (list) {
          list.push(session);
        }
      }
      return map;
    },
    loaderOptions
  );
}
