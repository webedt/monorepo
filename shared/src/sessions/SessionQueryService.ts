import { eq, and, isNull, isNotNull, inArray, desc, count, or, ilike } from 'drizzle-orm';

import { ASessionQueryService } from './ASessionQueryService.js';
import { db, chatSessions } from '../db/index.js';
import { getPreviewUrl } from '../utils/helpers/previewUrlHelper.js';

import type { ChatSession } from '../db/schema.js';
import type { SessionQueryOptions, PaginatedResult, SessionWithPreview, SessionSearchOptions } from './ASessionQueryService.js';

export class SessionQueryService extends ASessionQueryService {
  async getById(sessionId: string): Promise<ChatSession | null> {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(eq(chatSessions.id, sessionId))
      .limit(1);
    return session || null;
  }

  async getByIdForUser(sessionId: string, userId: string): Promise<ChatSession | null> {
    const [session] = await db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, userId)))
      .limit(1);
    return session || null;
  }

  async getByIdWithPreview(sessionId: string, userId: string): Promise<SessionWithPreview | null> {
    const session = await this.getByIdForUser(sessionId, userId);
    if (!session) return null;

    let previewUrl: string | undefined;
    if (session.repositoryOwner && session.repositoryName && session.branch) {
      previewUrl = await getPreviewUrl(
        undefined,
        session.repositoryOwner,
        session.repositoryName,
        session.branch
      );
    }

    return { ...session, previewUrl };
  }

  async listActive(userId: string, options?: SessionQueryOptions): Promise<ChatSession[]> {
    const { limit = 100, offset = 0 } = options || {};

    return db
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.userId, userId), isNull(chatSessions.deletedAt)))
      .orderBy(desc(chatSessions.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async listDeleted(userId: string, options?: SessionQueryOptions): Promise<PaginatedResult<ChatSession>> {
    const { limit = 50, offset = 0 } = options || {};

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(chatSessions)
        .where(and(eq(chatSessions.userId, userId), isNotNull(chatSessions.deletedAt)))
        .orderBy(desc(chatSessions.deletedAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(chatSessions)
        .where(and(eq(chatSessions.userId, userId), isNotNull(chatSessions.deletedAt))),
    ]);

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  async listByIds(sessionIds: string[], userId: string): Promise<ChatSession[]> {
    if (sessionIds.length === 0) return [];

    return db
      .select()
      .from(chatSessions)
      .where(and(inArray(chatSessions.id, sessionIds), eq(chatSessions.userId, userId)));
  }

  async existsForUser(sessionId: string, userId: string): Promise<boolean> {
    const session = await this.getByIdForUser(sessionId, userId);
    return session !== null;
  }

  async countActive(userId: string): Promise<number> {
    const [{ total }] = await db
      .select({ total: count() })
      .from(chatSessions)
      .where(and(eq(chatSessions.userId, userId), isNull(chatSessions.deletedAt)));
    return total;
  }

  async countDeleted(userId: string): Promise<number> {
    const [{ total }] = await db
      .select({ total: count() })
      .from(chatSessions)
      .where(and(eq(chatSessions.userId, userId), isNotNull(chatSessions.deletedAt)));
    return total;
  }

  async search(userId: string, options: SessionSearchOptions): Promise<PaginatedResult<ChatSession>> {
    const { query, limit = 50, offset = 0, status, favorite } = options;

    // Require minimum query length for meaningful search
    if (query.length < 2) {
      return { items: [], total: 0, hasMore: false };
    }

    // Escape ILIKE special characters (%, _, \) to prevent wildcard injection
    const escapedQuery = query.replace(/[%_\\]/g, '\\$&');
    const searchPattern = `%${escapedQuery}%`;

    // Build condition list
    const conditions = [
      eq(chatSessions.userId, userId),
      isNull(chatSessions.deletedAt),
      or(
        ilike(chatSessions.userRequest, searchPattern),
        ilike(chatSessions.repositoryOwner, searchPattern),
        ilike(chatSessions.repositoryName, searchPattern),
        ilike(chatSessions.branch, searchPattern)
      ),
    ];

    // Add optional filters
    if (status) {
      conditions.push(eq(chatSessions.status, status));
    }

    if (favorite !== undefined) {
      conditions.push(eq(chatSessions.favorite, favorite));
    }

    const whereClause = and(...conditions);

    const [items, [{ total }]] = await Promise.all([
      db
        .select()
        .from(chatSessions)
        .where(whereClause)
        .orderBy(desc(chatSessions.createdAt))
        .limit(limit)
        .offset(offset),
      db
        .select({ total: count() })
        .from(chatSessions)
        .where(whereClause),
    ]);

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }
}

export const sessionQueryService = new SessionQueryService();
