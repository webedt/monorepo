/**
 * Query Helpers - Composable utilities for common database query patterns
 *
 * Provides reusable building blocks for:
 * - User-scoped queries (filtering by userId)
 * - Pagination (limit/offset with consistent ordering)
 * - Soft-delete filtering (excluding deleted records)
 * - Response formatting
 */

import { eq, and, isNull, desc, asc, sql, inArray, ne } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import type { PgColumn, PgTable, TableConfig } from 'drizzle-orm/pg-core';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Pagination options for list queries
 */
export interface PaginationOptions {
  /** Page number (1-indexed). Ignored if offset is provided. */
  page?: number;
  /** Number of items per page */
  limit?: number;
  /** Direct offset to use (overrides page) */
  offset?: number;
}

/**
 * Pagination result metadata
 */
export interface PaginationMeta {
  limit: number;
  offset: number;
  total: number;
  page: number;
  totalPages: number;
  hasMore: boolean;
}

/**
 * Sorting options
 */
export interface SortOptions<T = string> {
  field: T;
  order: 'asc' | 'desc';
}

/**
 * Standard list query options combining pagination and sorting
 */
export interface ListOptions<TSort = string> {
  pagination?: PaginationOptions;
  sort?: SortOptions<TSort>;
}

/**
 * Result of a paginated query
 */
export interface PaginatedResult<T> {
  data: T[];
  meta: PaginationMeta;
}

/**
 * Options for findByUser queries
 */
export interface FindByUserOptions<TSort = string> extends ListOptions<TSort> {
  /** Include soft-deleted records */
  includeDeleted?: boolean;
  /** Additional status filter */
  status?: string;
}

/**
 * Standard API response shape for list endpoints
 */
export interface ListApiResponse<T> {
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
// PAGINATION HELPERS
// =============================================================================

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Calculate pagination offset and limit from options
 */
export function getPaginationParams(options?: PaginationOptions): { limit: number; offset: number } {
  const limit = Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const offset = options?.offset ?? ((options?.page ?? 1) - 1) * limit;
  return { limit, offset };
}

/**
 * Build pagination metadata from query results
 */
export function buildPaginationMeta(
  total: number,
  options?: PaginationOptions
): PaginationMeta {
  const { limit, offset } = getPaginationParams(options);
  const page = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  return {
    limit,
    offset,
    total,
    page,
    totalPages,
    hasMore: offset + limit < total,
  };
}

// =============================================================================
// CONDITION BUILDERS
// =============================================================================

/**
 * Combine multiple conditions with AND
 */
export function combineConditions(...conditions: (SQL | undefined)[]): SQL | undefined {
  const validConditions = conditions.filter((c): c is SQL => c !== undefined);
  if (validConditions.length === 0) return undefined;
  if (validConditions.length === 1) return validConditions[0];
  return and(...validConditions);
}

// =============================================================================
// RESPONSE BUILDERS
// =============================================================================

/**
 * Build a paginated response object
 */
export function buildPaginatedResponse<T>(
  data: T[],
  total: number,
  options?: PaginationOptions
): PaginatedResult<T> {
  return {
    data,
    meta: buildPaginationMeta(total, options),
  };
}

/**
 * Build a standard list API response
 */
export function buildListResponse<T>(
  items: T[],
  total: number,
  options?: PaginationOptions
): ListApiResponse<T> {
  const { limit, offset } = getPaginationParams(options);

  return {
    success: true,
    data: {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

// =============================================================================
// SORTING HELPERS
// =============================================================================

/**
 * Get default ORDER BY for descending createdAt
 */
export function orderByCreatedAtDesc(createdAtColumn: SQLWrapper): SQLWrapper {
  return desc(createdAtColumn);
}

/**
 * Get ORDER BY for ascending order
 */
export function orderByAsc(column: SQLWrapper): SQLWrapper {
  return asc(column);
}

/**
 * Get ORDER BY for descending order
 */
export function orderByDesc(column: SQLWrapper): SQLWrapper {
  return desc(column);
}

// =============================================================================
// COUNT HELPERS
// =============================================================================

/**
 * Build a count query expression
 */
export function countExpression(): SQL<number> {
  return sql<number>`count(*)::int`;
}
