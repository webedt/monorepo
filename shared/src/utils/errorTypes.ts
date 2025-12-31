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

// ============================================================================
// Domain-Specific Error Classes
// ============================================================================

/**
 * Error type discriminator for domain errors.
 * Used in discriminated unions for exhaustive error handling.
 */
export type DomainErrorType =
  | 'VALIDATION_ERROR'
  | 'AUTHENTICATION_ERROR'
  | 'AUTHORIZATION_ERROR'
  | 'RATE_LIMIT_ERROR'
  | 'CONFLICT_ERROR';

/**
 * Base class for domain-specific errors.
 * Provides common structure and serialization for all domain errors.
 */
export abstract class DomainError extends Error {
  abstract readonly type: DomainErrorType;
  abstract readonly statusCode: number;

  constructor(
    message: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Serialize error for API responses
   */
  toJSON(): { type: DomainErrorType; message: string; context?: Record<string, unknown> } {
    return {
      type: this.type,
      message: this.message,
      ...(this.context && { context: this.context }),
    };
  }
}

/**
 * Validation error for schema/input validation failures.
 *
 * Use when:
 * - Request body fails schema validation
 * - Input parameters are malformed
 * - Required fields are missing
 * - Field values are out of range or invalid format
 *
 * @example
 * throw new ValidationError('Invalid email format', 'email', { value: 'not-an-email' });
 * throw new ValidationError('Name is required', 'name');
 * throw new ValidationError('Age must be positive', 'age', { value: -5, min: 0 });
 */
export class ValidationError extends DomainError {
  readonly type = 'VALIDATION_ERROR' as const;
  readonly statusCode = 400;

  constructor(
    message: string,
    public readonly field?: string,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, ...(field && { field }) });
  }

  /**
   * Create a ValidationError for a required field
   */
  static required(field: string): ValidationError {
    return new ValidationError(`${field} is required`, field);
  }

  /**
   * Create a ValidationError for an invalid format
   */
  static invalidFormat(field: string, expectedFormat?: string): ValidationError {
    const message = expectedFormat
      ? `Invalid ${field} format. Expected: ${expectedFormat}`
      : `Invalid ${field} format`;
    return new ValidationError(message, field, { expectedFormat });
  }

  /**
   * Create a ValidationError for a value out of range
   */
  static outOfRange(field: string, options: { min?: number; max?: number; value?: number }): ValidationError {
    const { min, max, value } = options;
    let message = `${field} is out of range`;
    if (min !== undefined && max !== undefined) {
      message = `${field} must be between ${min} and ${max}`;
    } else if (min !== undefined) {
      message = `${field} must be at least ${min}`;
    } else if (max !== undefined) {
      message = `${field} must be at most ${max}`;
    }
    return new ValidationError(message, field, { min, max, value });
  }
}

/**
 * Type guard for ValidationError
 */
export function isValidationError(error: unknown): error is ValidationError {
  return error instanceof ValidationError;
}

/**
 * Authentication error for auth failures.
 *
 * Use when:
 * - Token is expired or invalid
 * - Credentials are incorrect
 * - Session has expired
 * - User is not logged in
 *
 * @example
 * throw new AuthenticationError('Token expired', 'TOKEN_EXPIRED');
 * throw new AuthenticationError('Invalid credentials', 'INVALID_CREDENTIALS');
 * throw new AuthenticationError('Session not found', 'SESSION_EXPIRED');
 */
export class AuthenticationError extends DomainError {
  readonly type = 'AUTHENTICATION_ERROR' as const;
  readonly statusCode = 401;

  constructor(
    message: string,
    public readonly reason?: 'TOKEN_EXPIRED' | 'INVALID_CREDENTIALS' | 'SESSION_EXPIRED' | 'TOKEN_INVALID' | 'NOT_AUTHENTICATED',
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, ...(reason && { reason }) });
  }

  /**
   * Create an AuthenticationError for expired token
   */
  static tokenExpired(): AuthenticationError {
    return new AuthenticationError('Token has expired', 'TOKEN_EXPIRED');
  }

  /**
   * Create an AuthenticationError for invalid credentials
   */
  static invalidCredentials(): AuthenticationError {
    return new AuthenticationError('Invalid credentials', 'INVALID_CREDENTIALS');
  }

  /**
   * Create an AuthenticationError for expired session
   */
  static sessionExpired(): AuthenticationError {
    return new AuthenticationError('Session has expired', 'SESSION_EXPIRED');
  }

  /**
   * Create an AuthenticationError for unauthenticated requests
   */
  static notAuthenticated(): AuthenticationError {
    return new AuthenticationError('Authentication required', 'NOT_AUTHENTICATED');
  }
}

/**
 * Type guard for AuthenticationError
 */
export function isAuthenticationError(error: unknown): error is AuthenticationError {
  return error instanceof AuthenticationError;
}

/**
 * Authorization error for permission denied scenarios.
 *
 * Use when:
 * - User lacks required role (admin, owner, etc.)
 * - User doesn't have access to a resource
 * - Operation is not permitted for the user's access level
 *
 * @example
 * throw new AuthorizationError('Admin access required', 'admin');
 * throw new AuthorizationError('Not a member of this organization');
 * throw new AuthorizationError('Owner access required to delete', 'owner', { resource: 'organization' });
 */
export class AuthorizationError extends DomainError {
  readonly type = 'AUTHORIZATION_ERROR' as const;
  readonly statusCode = 403;

  constructor(
    message: string,
    public readonly requiredRole?: string,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, ...(requiredRole && { requiredRole }) });
  }

  /**
   * Create an AuthorizationError for insufficient role
   */
  static insufficientRole(requiredRole: string, resource?: string): AuthorizationError {
    const message = resource
      ? `${requiredRole} access required for ${resource}`
      : `${requiredRole} access required`;
    return new AuthorizationError(message, requiredRole, { resource });
  }

  /**
   * Create an AuthorizationError for resource access denial
   */
  static resourceAccessDenied(resource: string, resourceId?: string): AuthorizationError {
    return new AuthorizationError(
      `Access denied to ${resource}`,
      undefined,
      { resource, resourceId }
    );
  }

  /**
   * Create an AuthorizationError for non-membership
   */
  static notMember(resource: string): AuthorizationError {
    return new AuthorizationError(`Not a member of this ${resource}`);
  }
}

/**
 * Type guard for AuthorizationError
 */
export function isAuthorizationError(error: unknown): error is AuthorizationError {
  return error instanceof AuthorizationError;
}

/**
 * Rate limit error for rate limiting responses.
 *
 * Use when:
 * - API rate limit exceeded
 * - Too many requests in a time window
 * - Throttling is applied
 *
 * @example
 * throw new RateLimitError('Too many requests', 60);
 * throw new RateLimitError('API rate limit exceeded', 30, { limit: 100, remaining: 0 });
 */
export class RateLimitError extends DomainError {
  readonly type = 'RATE_LIMIT_ERROR' as const;
  readonly statusCode = 429;

  constructor(
    message: string,
    public readonly retryAfterSeconds?: number,
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, ...(retryAfterSeconds && { retryAfterSeconds }) });
  }

  /**
   * Create a RateLimitError with retry information
   */
  static limitExceeded(retryAfterSeconds: number, options?: { limit?: number; remaining?: number; resetAt?: Date }): RateLimitError {
    return new RateLimitError(
      'Rate limit exceeded',
      retryAfterSeconds,
      {
        limit: options?.limit,
        remaining: options?.remaining,
        resetAt: options?.resetAt?.toISOString(),
      }
    );
  }

  /**
   * Create a RateLimitError from a response with Retry-After header
   */
  static fromRetryAfterHeader(retryAfter: string | number): RateLimitError {
    let seconds: number;
    if (typeof retryAfter === 'string') {
      const parsed = parseInt(retryAfter, 10);
      seconds = Number.isNaN(parsed) ? 60 : parsed;
    } else {
      seconds = retryAfter;
    }
    return new RateLimitError('Rate limit exceeded', seconds);
  }
}

/**
 * Type guard for RateLimitError
 */
export function isRateLimitError(error: unknown): error is RateLimitError {
  return error instanceof RateLimitError;
}

/**
 * Conflict error for version/concurrency conflicts.
 *
 * Use when:
 * - Optimistic locking fails (version mismatch)
 * - Unique constraint would be violated
 * - Resource already exists
 * - Concurrent modification detected
 *
 * @example
 * throw new ConflictError('Slug is already taken', 'UNIQUE_VIOLATION', { field: 'slug' });
 * throw new ConflictError('Resource was modified', 'VERSION_MISMATCH', { expectedVersion: 1, actualVersion: 2 });
 * throw new ConflictError('User already a member', 'ALREADY_EXISTS');
 */
export class ConflictError extends DomainError {
  readonly type = 'CONFLICT_ERROR' as const;
  readonly statusCode = 409;

  constructor(
    message: string,
    public readonly conflictType?: 'UNIQUE_VIOLATION' | 'VERSION_MISMATCH' | 'ALREADY_EXISTS' | 'CONCURRENT_MODIFICATION',
    context?: Record<string, unknown>
  ) {
    super(message, { ...context, ...(conflictType && { conflictType }) });
  }

  /**
   * Create a ConflictError for unique constraint violation
   */
  static uniqueViolation(field: string, value?: string): ConflictError {
    const message = value
      ? `${field} '${value}' is already taken`
      : `${field} is already taken`;
    return new ConflictError(message, 'UNIQUE_VIOLATION', { field, value });
  }

  /**
   * Create a ConflictError for version mismatch (optimistic locking)
   */
  static versionMismatch(expectedVersion: number, actualVersion: number): ConflictError {
    return new ConflictError(
      'Resource was modified by another request',
      'VERSION_MISMATCH',
      { expectedVersion, actualVersion }
    );
  }

  /**
   * Create a ConflictError for already existing resource
   */
  static alreadyExists(resource: string): ConflictError {
    return new ConflictError(`${resource} already exists`, 'ALREADY_EXISTS', { resource });
  }

  /**
   * Create a ConflictError from a database unique constraint error
   */
  static fromDatabaseError(error: DatabaseError, friendlyMessage?: string): ConflictError {
    return new ConflictError(
      friendlyMessage || 'Resource already exists',
      'UNIQUE_VIOLATION',
      {
        constraint: error.constraint,
        table: error.table,
        column: error.column,
      }
    );
  }
}

/**
 * Type guard for ConflictError
 */
export function isConflictError(error: unknown): error is ConflictError {
  return error instanceof ConflictError;
}

/**
 * Union type of all domain errors.
 * Use for exhaustive switch statements on error types.
 *
 * @example
 * function handleError(error: AnyDomainError) {
 *   switch (error.type) {
 *     case 'VALIDATION_ERROR':
 *       return res.status(400).json({ error: error.message, field: error.field });
 *     case 'AUTHENTICATION_ERROR':
 *       return res.status(401).json({ error: error.message });
 *     case 'AUTHORIZATION_ERROR':
 *       return res.status(403).json({ error: error.message });
 *     case 'RATE_LIMIT_ERROR':
 *       res.setHeader('Retry-After', error.retryAfterSeconds || 60);
 *       return res.status(429).json({ error: error.message });
 *     case 'CONFLICT_ERROR':
 *       return res.status(409).json({ error: error.message });
 *     default:
 *       const _exhaustive: never = error;
 *       return res.status(500).json({ error: 'Unknown error' });
 *   }
 * }
 */
export type AnyDomainError =
  | ValidationError
  | AuthenticationError
  | AuthorizationError
  | RateLimitError
  | ConflictError;

/**
 * Type guard to check if an error is any domain error
 */
export function isDomainError(error: unknown): error is AnyDomainError {
  return (
    isValidationError(error) ||
    isAuthenticationError(error) ||
    isAuthorizationError(error) ||
    isRateLimitError(error) ||
    isConflictError(error)
  );
}

/**
 * Convert a database unique constraint error to a ConflictError if applicable.
 * Returns the original error if it's not a unique constraint violation.
 *
 * @example
 * try {
 *   await db.insert(users).values({ email });
 * } catch (error) {
 *   throw convertUniqueConstraintToConflict(error, 'Email is already registered');
 * }
 */
export function convertUniqueConstraintToConflict(error: unknown, friendlyMessage?: string): unknown {
  if (isUniqueConstraintError(error)) {
    return ConflictError.fromDatabaseError(error as DatabaseError, friendlyMessage);
  }
  return error;
}
