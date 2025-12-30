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
 * Type guard to check if an error has NetworkError properties.
 * Checks for the presence of at least one NetworkError-specific property
 * (code, status, statusCode, response, or isRetryable).
 */
export function isNetworkError(error: unknown): error is NetworkError {
  if (!(error instanceof Error)) {
    return false;
  }
  // Check for at least one NetworkError-specific property
  return (
    'code' in error ||
    'status' in error ||
    'statusCode' in error ||
    'response' in error ||
    'isRetryable' in error
  );
}

/**
 * Cast an Error to NetworkError for property access.
 * Use this when you need to access potential NetworkError properties
 * without asserting that they definitely exist.
 */
export function asNetworkError(error: Error): NetworkError {
  return error as NetworkError;
}

/**
 * Get the error code from an error, if available.
 * Works with any Error that may have a 'code' property.
 */
export function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const networkErr = asNetworkError(error);
  return networkErr.code;
}

/**
 * Get the HTTP status code from an error, if available.
 * Checks multiple common properties where status codes are stored.
 */
export function getStatusCode(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const networkErr = asNetworkError(error);
  return networkErr.status ?? networkErr.statusCode ?? networkErr.response?.status ?? networkErr.response?.statusCode;
}

/**
 * Get the retry-after header value from an error response, if available.
 */
export function getRetryAfterHeader(error: unknown): string | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }
  const networkErr = asNetworkError(error);
  const headers = networkErr.response?.headers;
  return headers?.['retry-after'] || headers?.['Retry-After'];
}

/**
 * Check if an error is retryable based on error code or status
 */
export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const networkErr = asNetworkError(error);

  // Check explicit retryable flag
  if (typeof networkErr.isRetryable === 'boolean') {
    return networkErr.isRetryable;
  }

  // Check error codes
  const retryableCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'EHOSTUNREACH'];
  if (networkErr.code && retryableCodes.includes(networkErr.code)) {
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
