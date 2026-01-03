/**
 * Session Query Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Session Query Service.
 * The service provides optimized queries for session retrieval, listing, and search.
 *
 * @see ASessionQueryService for the abstract base class
 * @see SessionQueryService for the implementation
 */

import type { ChatSession } from '../db/schema.js';

/**
 * Options for session listing queries
 */
export interface SessionQueryOptions {
  /** Include soft-deleted sessions */
  includeDeleted?: boolean;
  /** Maximum number of sessions to return */
  limit?: number;
  /** Number of sessions to skip (for pagination) */
  offset?: number;
}

/**
 * Options for session search
 */
export interface SessionSearchOptions {
  /** Search query string */
  query: string;
  /** Maximum number of results */
  limit?: number;
  /** Number of results to skip */
  offset?: number;
  /** Filter by session status */
  status?: string;
  /** Filter by favorite flag */
  favorite?: boolean;
}

/**
 * Paginated result container
 */
export interface PaginatedResult<T> {
  /** Result items for this page */
  items: T[];
  /** Total count of matching items */
  total: number;
  /** Whether more items exist after this page */
  hasMore: boolean;
}

/**
 * Session with computed preview URL
 */
export interface SessionWithPreview extends ChatSession {
  /** Generated preview URL if available */
  previewUrl?: string;
}

/**
 * Interface for Session Query Service with full documentation.
 *
 * The Session Query Service provides optimized database queries for session
 * retrieval. It supports filtering, pagination, search, and includes computed
 * fields like preview URLs.
 *
 * ## Features
 *
 * - **Optimized Queries**: Efficient database access patterns
 * - **Pagination**: Built-in offset/limit support
 * - **Search**: Full-text search across session titles and content
 * - **Filtering**: Filter by status, deleted flag, favorite
 * - **Preview URLs**: Compute preview URLs for session thumbnails
 *
 * ## Query Patterns
 *
 * | Method | Use Case |
 * |--------|----------|
 * | getById | Direct session lookup |
 * | getByIdForUser | Secure lookup with user filter |
 * | listActive | Dashboard session list |
 * | listDeleted | Trash view |
 * | search | Search functionality |
 *
 * ## Usage
 *
 * ```typescript
 * const queryService = getSessionQueryService();
 *
 * // Get user's active sessions
 * const sessions = await queryService.listActive(userId, { limit: 20 });
 *
 * // Search sessions
 * const results = await queryService.search(userId, {
 *   query: 'authentication',
 *   limit: 10,
 * });
 *
 * console.log(`Found ${results.total} matching sessions`);
 * ```
 */
export interface ISessionQueryServiceDocumentation {
  /**
   * Get a session by ID.
   *
   * Direct lookup without user filtering. Use for internal operations
   * where authorization is already verified.
   *
   * @param sessionId - The session ID
   * @returns Session if found, null otherwise
   *
   * @example
   * ```typescript
   * const session = await queryService.getById('session-123');
   * if (!session) {
   *   throw new NotFoundError('Session not found');
   * }
   * ```
   */
  getById(sessionId: string): Promise<ChatSession | null>;

  /**
   * Get a session by ID with user filtering.
   *
   * Secure lookup that ensures the session belongs to the user.
   * Preferred for API endpoints.
   *
   * @param sessionId - The session ID
   * @param userId - The user ID to filter by
   * @returns Session if found and belongs to user, null otherwise
   *
   * @example
   * ```typescript
   * const session = await queryService.getByIdForUser(sessionId, req.userId);
   *
   * if (!session) {
   *   return res.status(404).json({ error: 'Session not found' });
   * }
   *
   * res.json(session);
   * ```
   */
  getByIdForUser(
    sessionId: string,
    userId: string
  ): Promise<ChatSession | null>;

  /**
   * Get a session with computed preview URL.
   *
   * Includes the preview URL for session thumbnail if available.
   *
   * @param sessionId - The session ID
   * @param userId - The user ID to filter by
   * @returns Session with preview URL, null if not found
   *
   * @example
   * ```typescript
   * const session = await queryService.getByIdWithPreview(sessionId, userId);
   *
   * if (session?.previewUrl) {
   *   displayThumbnail(session.previewUrl);
   * }
   * ```
   */
  getByIdWithPreview(
    sessionId: string,
    userId: string
  ): Promise<SessionWithPreview | null>;

  /**
   * List active (non-deleted) sessions for a user.
   *
   * Returns sessions ordered by last activity (most recent first).
   *
   * @param userId - The user ID
   * @param options - Query options
   * @returns Array of active sessions
   *
   * @example
   * ```typescript
   * // Get first page of sessions
   * const sessions = await queryService.listActive(userId, {
   *   limit: 20,
   *   offset: 0,
   * });
   *
   * // Render session list
   * renderSessionList(sessions);
   * ```
   *
   * @example
   * ```typescript
   * // Get all sessions (no limit)
   * const allSessions = await queryService.listActive(userId);
   * ```
   */
  listActive(
    userId: string,
    options?: SessionQueryOptions
  ): Promise<ChatSession[]>;

  /**
   * List soft-deleted sessions (trash).
   *
   * Returns paginated results with total count for trash view.
   *
   * @param userId - The user ID
   * @param options - Query options
   * @returns Paginated deleted sessions
   *
   * @example
   * ```typescript
   * const trash = await queryService.listDeleted(userId, {
   *   limit: 20,
   *   offset: 0,
   * });
   *
   * console.log(`${trash.total} sessions in trash`);
   * if (trash.hasMore) {
   *   showLoadMoreButton();
   * }
   * ```
   */
  listDeleted(
    userId: string,
    options?: SessionQueryOptions
  ): Promise<PaginatedResult<ChatSession>>;

  /**
   * Get multiple sessions by ID.
   *
   * Batch lookup for efficiency when loading multiple sessions.
   * Only returns sessions belonging to the user.
   *
   * @param sessionIds - Array of session IDs
   * @param userId - The user ID to filter by
   * @returns Sessions that exist and belong to user
   *
   * @example
   * ```typescript
   * const ids = ['session-1', 'session-2', 'session-3'];
   * const sessions = await queryService.listByIds(ids, userId);
   *
   * // Note: May return fewer sessions if some don't exist
   * console.log(`Found ${sessions.length} of ${ids.length} sessions`);
   * ```
   */
  listByIds(
    sessionIds: string[],
    userId: string
  ): Promise<ChatSession[]>;

  /**
   * Check if a session exists for a user.
   *
   * Efficient existence check without loading full session.
   *
   * @param sessionId - The session ID
   * @param userId - The user ID to filter by
   * @returns True if session exists and belongs to user
   *
   * @example
   * ```typescript
   * if (await queryService.existsForUser(sessionId, userId)) {
   *   // Session exists
   * } else {
   *   return res.status(404).json({ error: 'Session not found' });
   * }
   * ```
   */
  existsForUser(
    sessionId: string,
    userId: string
  ): Promise<boolean>;

  /**
   * Count active sessions for a user.
   *
   * Efficient count query for dashboard statistics.
   *
   * @param userId - The user ID
   * @returns Count of active sessions
   *
   * @example
   * ```typescript
   * const activeCount = await queryService.countActive(userId);
   * displaySessionCount(activeCount);
   * ```
   */
  countActive(userId: string): Promise<number>;

  /**
   * Count deleted sessions for a user.
   *
   * Efficient count query for trash badge.
   *
   * @param userId - The user ID
   * @returns Count of deleted sessions
   *
   * @example
   * ```typescript
   * const trashCount = await queryService.countDeleted(userId);
   * if (trashCount > 0) {
   *   showTrashBadge(trashCount);
   * }
   * ```
   */
  countDeleted(userId: string): Promise<number>;

  /**
   * Search sessions by title and content.
   *
   * Full-text search with optional filters and pagination.
   *
   * @param userId - The user ID
   * @param options - Search options
   * @returns Paginated search results
   *
   * @example
   * ```typescript
   * // Basic search
   * const results = await queryService.search(userId, {
   *   query: 'authentication fix',
   *   limit: 10,
   * });
   *
   * console.log(`Found ${results.total} sessions`);
   * ```
   *
   * @example
   * ```typescript
   * // Filtered search
   * const results = await queryService.search(userId, {
   *   query: 'bug',
   *   status: 'completed',
   *   favorite: true,
   *   limit: 20,
   *   offset: 0,
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Paginated search
   * async function loadMoreResults(page: number) {
   *   const results = await queryService.search(userId, {
   *     query: currentQuery,
   *     limit: 20,
   *     offset: page * 20,
   *   });
   *
   *   appendResults(results.items);
   *   if (!results.hasMore) {
   *     hideLoadMoreButton();
   *   }
   * }
   * ```
   */
  search(
    userId: string,
    options: SessionSearchOptions
  ): Promise<PaginatedResult<ChatSession>>;
}
