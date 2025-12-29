/**
 * Common Error Type Definitions
 *
 * These interfaces provide type-safe access to common error properties
 * that are typically accessed via `as any` assertions.
 */

/**
 * Extended error interface for Node.js/network errors
 * Includes common properties like `code`, `status`, `statusCode`
 */
export interface NetworkError extends Error {
  /** Node.js error code (e.g., ENOTFOUND, ETIMEDOUT, ECONNRESET) */
  code?: string;
  /** HTTP status code (common on HTTP errors) */
  status?: number;
  /** Alternative HTTP status code property */
  statusCode?: number;
  /** HTTP response object (for axios/fetch errors) */
  response?: {
    status?: number;
    statusCode?: number;
    headers?: Record<string, string>;
  };
  /** Custom flag indicating if the error is retryable */
  isRetryable?: boolean;
  /** Error cause (ES2022 error cause) */
  cause?: unknown;
}

/**
 * Type guard to check if an error has NetworkError properties
 */
export function isNetworkError(error: unknown): error is NetworkError {
  return error instanceof Error;
}

/**
 * Get the error code from an error, if available
 */
export function getErrorCode(error: unknown): string | undefined {
  if (isNetworkError(error)) {
    return error.code;
  }
  return undefined;
}

/**
 * Get the HTTP status code from an error, if available
 */
export function getStatusCode(error: unknown): number | undefined {
  if (isNetworkError(error)) {
    return error.status ?? error.statusCode ?? error.response?.status ?? error.response?.statusCode;
  }
  return undefined;
}

/**
 * Get the retry-after header value from an error response, if available
 */
export function getRetryAfterHeader(error: unknown): string | undefined {
  if (isNetworkError(error)) {
    const headers = error.response?.headers;
    return headers?.['retry-after'] || headers?.['Retry-After'];
  }
  return undefined;
}

/**
 * Check if an error is retryable based on error code or status
 */
export function isRetryableError(error: unknown): boolean {
  if (!isNetworkError(error)) {
    return false;
  }

  // Check explicit retryable flag
  if (typeof error.isRetryable === 'boolean') {
    return error.isRetryable;
  }

  // Check error codes
  const retryableCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH'];
  if (error.code && retryableCodes.includes(error.code)) {
    return true;
  }

  // Check HTTP status codes
  const statusCode = getStatusCode(error);
  const retryableStatuses = [429, 502, 503, 504];
  if (statusCode && retryableStatuses.includes(statusCode)) {
    return true;
  }

  return false;
}

/**
 * Database error interface (PostgreSQL errors)
 */
export interface DatabaseError extends Error {
  /** PostgreSQL error code (e.g., '23505' for unique violation) */
  code?: string;
  /** Database constraint name */
  constraint?: string;
  /** Database table name */
  table?: string;
  /** Database column name */
  column?: string;
  /** Detail message from database */
  detail?: string;
}

/**
 * Type guard for database errors
 */
export function isDatabaseError(error: unknown): error is DatabaseError {
  return error instanceof Error && 'code' in error;
}

/**
 * Check if a database error is a unique constraint violation
 */
export function isUniqueConstraintError(error: unknown): boolean {
  return isDatabaseError(error) && error.code === '23505';
}
