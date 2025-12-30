/**
 * Type Guard Utilities
 *
 * This module provides type-safe runtime type checking to replace unsafe `as any` assertions.
 * Use these guards to safely access properties that may or may not exist on objects.
 */

/**
 * Check if a value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Check if an object has a specific property
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

/**
 * Check if an object has a property of a specific type
 */
export function hasStringProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, string> {
  return hasProperty(obj, key) && typeof obj[key] === 'string';
}

export function hasNumberProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, number> {
  return hasProperty(obj, key) && typeof obj[key] === 'number';
}

export function hasBooleanProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, boolean> {
  return hasProperty(obj, key) && typeof obj[key] === 'boolean';
}

/**
 * Get a string property from an object safely
 */
export function getStringProperty(obj: unknown, key: string): string | undefined {
  if (hasStringProperty(obj, key)) {
    return obj[key];
  }
  return undefined;
}

/**
 * Get a number property from an object safely
 */
export function getNumberProperty(obj: unknown, key: string): number | undefined {
  if (hasNumberProperty(obj, key)) {
    return obj[key];
  }
  return undefined;
}

// ============================================================================
// Event Data Type Guards
// ============================================================================

/**
 * Interface for event data with a type field
 */
export interface TypedEventData {
  type: string;
  [key: string]: unknown;
}

/**
 * Check if event data has a type property
 */
export function isTypedEventData(data: unknown): data is TypedEventData {
  return hasStringProperty(data, 'type');
}

/**
 * Get the event type from event data safely
 */
export function getEventType(data: unknown): string | undefined {
  if (isTypedEventData(data)) {
    return data.type;
  }
  return undefined;
}

// ============================================================================
// HTTP Error Type Guards
// ============================================================================

/**
 * Interface for errors with HTTP status properties
 */
export interface HttpStatusError extends Error {
  status?: number;
  statusCode?: number;
  response?: {
    status?: number;
    statusCode?: number;
    headers?: Record<string, string>;
  };
}

/**
 * Interface for errors with retryable flag
 */
export interface RetryableError extends Error {
  isRetryable?: boolean;
}

/**
 * Interface for errors with error code
 */
export interface CodedError extends Error {
  code?: string;
}

/**
 * Check if an error has HTTP status properties
 */
export function isHttpStatusError(error: unknown): error is HttpStatusError {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    hasProperty(error, 'status') ||
    hasProperty(error, 'statusCode') ||
    hasProperty(error, 'response')
  );
}

/**
 * Get HTTP status code from an error
 */
export function getHttpStatusCode(error: unknown): number | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  // Check direct status properties
  if (hasNumberProperty(error, 'status')) {
    return error.status;
  }
  if (hasNumberProperty(error, 'statusCode')) {
    return error.statusCode;
  }

  // Check response object
  if (hasProperty(error, 'response') && isObject(error.response)) {
    if (hasNumberProperty(error.response, 'status')) {
      return error.response.status;
    }
    if (hasNumberProperty(error.response, 'statusCode')) {
      return error.response.statusCode;
    }
  }

  return undefined;
}

/**
 * Check if an error has a retryable flag
 */
export function hasRetryableFlag(error: unknown): error is RetryableError {
  return error instanceof Error && hasBooleanProperty(error, 'isRetryable');
}

/**
 * Get the isRetryable flag from an error
 */
export function getIsRetryable(error: unknown): boolean | undefined {
  if (hasRetryableFlag(error)) {
    return error.isRetryable;
  }
  return undefined;
}

/**
 * Check if an error has a code property
 */
export function isCodedError(error: unknown): error is CodedError {
  return error instanceof Error && hasStringProperty(error, 'code');
}

/**
 * Get response headers from an error
 */
export function getErrorResponseHeaders(
  error: unknown
): Record<string, string> | undefined {
  if (!(error instanceof Error)) {
    return undefined;
  }

  if (
    hasProperty(error, 'response') &&
    isObject(error.response) &&
    hasProperty(error.response, 'headers') &&
    isObject(error.response.headers)
  ) {
    return error.response.headers as Record<string, string>;
  }

  return undefined;
}

// ============================================================================
// Dimension Type Guards
// ============================================================================

/**
 * Interface for objects with width and height
 */
export interface HasDimensions {
  width: number;
  height: number;
}

/**
 * Check if an object has width and height properties
 */
export function hasDimensions(obj: unknown): obj is HasDimensions {
  return (
    hasNumberProperty(obj, 'width') &&
    hasNumberProperty(obj, 'height')
  );
}

/**
 * Get dimensions from an object with defaults
 */
export function getDimensions(
  obj: unknown,
  defaultWidth = 100,
  defaultHeight = 100
): { width: number; height: number } {
  if (hasDimensions(obj)) {
    return { width: obj.width, height: obj.height };
  }
  return { width: defaultWidth, height: defaultHeight };
}

// ============================================================================
// Request Type Guards
// ============================================================================

/**
 * Interface for Express request with raw body
 */
export interface RequestWithRawBody {
  rawBody?: string | Buffer;
}

/**
 * Check if a request has a rawBody property
 */
export function hasRawBody(req: unknown): req is RequestWithRawBody {
  return hasProperty(req, 'rawBody');
}

/**
 * Get raw body from a request
 */
export function getRawBody(req: unknown): string | Buffer | undefined {
  if (hasRawBody(req)) {
    return req.rawBody;
  }
  return undefined;
}

// ============================================================================
// Zod Issue Type Guards (for validation error handling)
// ============================================================================

/**
 * Extended Zod issue types that include optional properties
 * not in the base ZodIssue type
 */
export interface ZodIssueWithBounds {
  minimum?: number;
  maximum?: number;
  inclusive?: boolean;
}

export interface ZodIssueWithOptions {
  options?: string[];
}

export interface ZodIssueWithValidation {
  validation?: string;
}

/**
 * Get minimum from a Zod issue (for too_small errors)
 */
export function getZodIssueMinimum(issue: unknown): number | undefined {
  return getNumberProperty(issue, 'minimum');
}

/**
 * Get maximum from a Zod issue (for too_big errors)
 */
export function getZodIssueMaximum(issue: unknown): number | undefined {
  return getNumberProperty(issue, 'maximum');
}

/**
 * Get inclusive flag from a Zod issue
 */
export function getZodIssueInclusive(issue: unknown): boolean | undefined {
  if (hasBooleanProperty(issue, 'inclusive')) {
    return issue.inclusive;
  }
  return undefined;
}

/**
 * Get options from a Zod issue (for invalid_enum_value errors)
 */
export function getZodIssueOptions(issue: unknown): string[] | undefined {
  if (hasProperty(issue, 'options') && Array.isArray(issue.options)) {
    return issue.options as string[];
  }
  return undefined;
}

/**
 * Get validation type from a Zod issue (for invalid_string errors)
 */
export function getZodIssueValidation(issue: unknown): string | undefined {
  return getStringProperty(issue, 'validation');
}

// ============================================================================
// SDK Message Type Guards
// ============================================================================

/**
 * Interface for SDK error messages
 */
export interface SdkErrorMessage {
  error_message?: string;
  result?: string;
}

/**
 * Check if a message is an SDK error message
 */
export function isSdkErrorMessage(msg: unknown): msg is SdkErrorMessage {
  return (
    hasProperty(msg, 'error_message') ||
    hasProperty(msg, 'result')
  );
}

/**
 * Get error message from an SDK message
 */
export function getSdkErrorMessage(msg: unknown): string {
  if (hasStringProperty(msg, 'error_message')) {
    return msg.error_message;
  }
  if (hasStringProperty(msg, 'result')) {
    return msg.result;
  }
  return 'Unknown SDK error';
}

// ============================================================================
// Generic Safe Property Access
// ============================================================================

/**
 * Safely get a nested property from an object
 * Returns undefined if the path doesn't exist or any part is not an object
 */
export function getNestedProperty<T>(
  obj: unknown,
  path: string[]
): T | undefined {
  let current: unknown = obj;

  for (const key of path) {
    if (!isObject(current) || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }

  return current as T;
}

/**
 * Create a type-safe record initializer
 * Use this instead of `{} as any` for initializing typed records
 */
export function createTypedRecord<K extends string, V>(
  keys: readonly K[],
  initializer: (key: K) => V
): Record<K, V> {
  const record = {} as Record<K, V>;
  for (const key of keys) {
    record[key] = initializer(key);
  }
  return record;
}
