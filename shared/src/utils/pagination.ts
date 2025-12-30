/**
 * Pagination Utilities
 *
 * Provides standardized pagination for HTTP APIs with support for:
 * - Offset-based pagination (for browsing lists)
 * - Cursor-based pagination (for real-time feeds like messages/events)
 *
 * Usage in Express routes:
 *
 * ```typescript
 * // Offset-based pagination (for browsing)
 * const pagination = parseOffsetPagination(req.query);
 * const result = await db.select().from(table).limit(pagination.limit).offset(pagination.offset);
 * res.json(buildPaginatedApiResponse(result, total, pagination));
 *
 * // Cursor-based pagination (for real-time feeds)
 * const cursor = parseCursorPagination(req.query);
 * const result = await getMessagesAfterCursor(cursor);
 * res.json(buildCursorResponse(result, cursor.limit));
 * ```
 */

// Re-export core pagination utilities from queryHelpers
export {
  getPaginationParams,
  buildPaginationMeta,
  buildPaginatedResponse,
  buildListResponse,
  type PaginationOptions,
  type PaginationMeta,
  type ListApiResponse,
} from '../db/queryHelpers.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default number of items per page */
export const DEFAULT_PAGE_LIMIT = 20;

/** Maximum allowed items per page */
export const MAX_PAGE_LIMIT = 100;

/** Default limit for cursor-based pagination */
export const DEFAULT_CURSOR_LIMIT = 50;

/** Maximum limit for cursor-based pagination */
export const MAX_CURSOR_LIMIT = 100;

// =============================================================================
// OFFSET-BASED PAGINATION TYPES
// =============================================================================

/**
 * Parsed offset pagination parameters from HTTP request
 */
export interface OffsetPaginationParams {
  limit: number;
  offset: number;
}

/**
 * Standard paginated API response shape
 */
export interface PaginatedApiResponse<T> {
  success: true;
  data: {
    items: T[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

// =============================================================================
// CURSOR-BASED PAGINATION TYPES
// =============================================================================

/**
 * Direction for cursor-based pagination
 * - 'forward': Get items after cursor (newer)
 * - 'backward': Get items before cursor (older)
 */
export type CursorDirection = 'forward' | 'backward';

/**
 * Parsed cursor pagination parameters from HTTP request
 */
export interface CursorPaginationParams {
  /** The cursor value (typically an ID or timestamp) */
  cursor: string | null;
  /** Number of items to fetch */
  limit: number;
  /** Direction to paginate */
  direction: CursorDirection;
}

/**
 * Cursor-based pagination response
 */
export interface CursorPaginatedResponse<T> {
  success: true;
  data: {
    items: T[];
    nextCursor: string | null;
    prevCursor: string | null;
    hasMore: boolean;
    hasPrevious: boolean;
  };
}

/**
 * Item with cursor information for cursor extraction
 */
export interface CursorItem {
  id?: string;
  createdAt?: Date | string;
}

// =============================================================================
// OFFSET-BASED PAGINATION HELPERS
// =============================================================================

/**
 * Parse offset pagination parameters from HTTP query params
 *
 * @param query - Express req.query object
 * @param defaults - Optional override for defaults
 * @returns Sanitized pagination params with limit and offset
 *
 * @example
 * ```typescript
 * // GET /api/items?limit=25&offset=50
 * const pagination = parseOffsetPagination(req.query);
 * // { limit: 25, offset: 50 }
 * ```
 */
export function parseOffsetPagination(
  query: Record<string, unknown>,
  defaults?: { limit?: number; maxLimit?: number }
): OffsetPaginationParams {
  const defaultLimit = defaults?.limit ?? DEFAULT_PAGE_LIMIT;
  const maxLimit = defaults?.maxLimit ?? MAX_PAGE_LIMIT;

  // Parse limit
  const limitParam = query.limit;
  let limit = defaultLimit;
  if (typeof limitParam === 'string') {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, maxLimit);
    }
  } else if (typeof limitParam === 'number' && limitParam > 0) {
    limit = Math.min(limitParam, maxLimit);
  }

  // Parse offset
  const offsetParam = query.offset;
  let offset = 0;
  if (typeof offsetParam === 'string') {
    const parsed = parseInt(offsetParam, 10);
    if (!isNaN(parsed) && parsed >= 0) {
      offset = parsed;
    }
  } else if (typeof offsetParam === 'number' && offsetParam >= 0) {
    offset = offsetParam;
  }

  return { limit, offset };
}

/**
 * Build a standard paginated API response
 *
 * @param items - Array of items for the current page
 * @param total - Total count of all matching items
 * @param pagination - The pagination params used for the query
 * @returns Formatted API response with pagination metadata
 */
export function buildPaginatedApiResponse<T>(
  items: T[],
  total: number,
  pagination: OffsetPaginationParams
): PaginatedApiResponse<T> {
  return {
    success: true,
    data: {
      items,
      total,
      limit: pagination.limit,
      offset: pagination.offset,
      hasMore: pagination.offset + pagination.limit < total,
    },
  };
}

/**
 * Build a legacy-compatible paginated response (for backwards compatibility)
 * Uses a custom key for the items array instead of 'items'
 *
 * @param items - Array of items for the current page
 * @param total - Total count of all matching items
 * @param pagination - The pagination params used for the query
 * @param itemsKey - Key to use for items array (e.g., 'games', 'posts', 'messages')
 */
export function buildLegacyPaginatedResponse<T>(
  items: T[],
  total: number,
  pagination: OffsetPaginationParams,
  itemsKey: string
): {
  success: true;
  data: Record<string, unknown>;
} {
  return {
    success: true,
    data: {
      [itemsKey]: items,
      total,
      limit: pagination.limit,
      offset: pagination.offset,
      hasMore: pagination.offset + pagination.limit < total,
    },
  };
}

// =============================================================================
// CURSOR-BASED PAGINATION HELPERS
// =============================================================================

/**
 * Parse cursor pagination parameters from HTTP query params
 *
 * Cursor-based pagination is ideal for:
 * - Real-time feeds where items may be inserted while paginating
 * - Message history where offset would shift as new messages arrive
 * - Infinite scroll where stable page boundaries are needed
 *
 * @param query - Express req.query object
 * @param defaults - Optional override for defaults
 * @returns Sanitized cursor pagination params
 *
 * @example
 * ```typescript
 * // GET /api/messages?cursor=abc123&limit=25&direction=backward
 * const cursor = parseCursorPagination(req.query);
 * // { cursor: 'abc123', limit: 25, direction: 'backward' }
 * ```
 */
export function parseCursorPagination(
  query: Record<string, unknown>,
  defaults?: { limit?: number; maxLimit?: number }
): CursorPaginationParams {
  const defaultLimit = defaults?.limit ?? DEFAULT_CURSOR_LIMIT;
  const maxLimit = defaults?.maxLimit ?? MAX_CURSOR_LIMIT;

  // Parse cursor
  const cursorParam = query.cursor;
  let cursor: string | null = null;
  if (typeof cursorParam === 'string' && cursorParam.length > 0) {
    cursor = cursorParam;
  }

  // Parse limit
  const limitParam = query.limit;
  let limit = defaultLimit;
  if (typeof limitParam === 'string') {
    const parsed = parseInt(limitParam, 10);
    if (!isNaN(parsed) && parsed > 0) {
      limit = Math.min(parsed, maxLimit);
    }
  } else if (typeof limitParam === 'number' && limitParam > 0) {
    limit = Math.min(limitParam, maxLimit);
  }

  // Parse direction
  const directionParam = query.direction;
  let direction: CursorDirection = 'backward'; // Default: get older items
  if (directionParam === 'forward') {
    direction = 'forward';
  }

  return { cursor, limit, direction };
}

/**
 * Extract cursor value from an item
 * Supports id-based or timestamp-based cursors
 *
 * @param item - Item to extract cursor from
 * @param field - Field to use as cursor ('id' or 'createdAt')
 * @returns Cursor string or null
 */
export function extractCursor<T extends CursorItem>(
  item: T | undefined,
  field: 'id' | 'createdAt' = 'id'
): string | null {
  if (!item) return null;

  if (field === 'id') {
    return item.id ?? null;
  }

  if (field === 'createdAt') {
    const createdAt = item.createdAt;
    if (!createdAt) return null;
    if (typeof createdAt === 'string') return createdAt;
    if (createdAt instanceof Date) return createdAt.toISOString();
  }

  return null;
}

/**
 * Build a cursor-based pagination response
 *
 * @param items - Array of items fetched (should be limit + 1 to check hasMore)
 * @param limit - The limit that was requested
 * @param cursorField - Field to use for cursor extraction
 * @returns Formatted cursor pagination response
 *
 * @example
 * ```typescript
 * // Fetch one extra item to check if there are more
 * const items = await db.select().from(messages).limit(limit + 1);
 * return buildCursorResponse(items, limit);
 * ```
 */
export function buildCursorResponse<T extends CursorItem>(
  items: T[],
  limit: number,
  cursorField: 'id' | 'createdAt' = 'id'
): CursorPaginatedResponse<T> {
  // Check if there are more items by seeing if we got limit + 1
  const hasMore = items.length > limit;

  // Trim to the actual limit
  const trimmedItems = hasMore ? items.slice(0, limit) : items;

  // Extract cursors from first and last items
  const firstItem = trimmedItems[0];
  const lastItem = trimmedItems[trimmedItems.length - 1];

  return {
    success: true,
    data: {
      items: trimmedItems,
      nextCursor: hasMore ? extractCursor(lastItem, cursorField) : null,
      prevCursor: firstItem ? extractCursor(firstItem, cursorField) : null,
      hasMore,
      hasPrevious: firstItem !== undefined,
    },
  };
}

/**
 * Build a cursor-based response with custom item key (for backwards compatibility)
 *
 * @param items - Array of items fetched
 * @param limit - The limit that was requested
 * @param itemsKey - Key to use for items array (e.g., 'messages')
 * @param cursorField - Field to use for cursor extraction
 */
export function buildLegacyCursorResponse<T extends CursorItem>(
  items: T[],
  limit: number,
  itemsKey: string,
  cursorField: 'id' | 'createdAt' = 'id'
): {
  success: true;
  data: Record<string, unknown>;
} {
  const hasMore = items.length > limit;
  const trimmedItems = hasMore ? items.slice(0, limit) : items;
  const firstItem = trimmedItems[0];
  const lastItem = trimmedItems[trimmedItems.length - 1];

  return {
    success: true,
    data: {
      [itemsKey]: trimmedItems,
      nextCursor: hasMore ? extractCursor(lastItem, cursorField) : null,
      prevCursor: firstItem ? extractCursor(firstItem, cursorField) : null,
      hasMore,
      hasPrevious: firstItem !== undefined,
    },
  };
}

// =============================================================================
// UTILITY HELPERS
// =============================================================================

/**
 * Calculate if there are more items after current page
 * Useful when you know the total count
 */
export function calculateHasMore(
  offset: number,
  limit: number,
  total: number
): boolean {
  return offset + limit < total;
}

/**
 * Calculate the total number of pages
 */
export function calculateTotalPages(total: number, limit: number): number {
  return Math.ceil(total / limit);
}

/**
 * Calculate current page number (1-indexed)
 */
export function calculateCurrentPage(offset: number, limit: number): number {
  return Math.floor(offset / limit) + 1;
}

/**
 * Convert page number to offset
 */
export function pageToOffset(page: number, limit: number): number {
  return (Math.max(1, page) - 1) * limit;
}
