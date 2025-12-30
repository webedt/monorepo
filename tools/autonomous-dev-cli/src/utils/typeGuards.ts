/**
 * Type Guard Utilities for autonomous-dev-cli
 *
 * Provides type-safe runtime type checking to replace unsafe `as any` assertions.
 */

/**
 * Check if a value is a non-null object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Check if an object has a property
 */
export function hasProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, unknown> {
  return isObject(obj) && key in obj;
}

/**
 * Check if an object has a string property
 */
export function hasStringProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, string> {
  return hasProperty(obj, key) && typeof obj[key] === 'string';
}

/**
 * Check if an object has a number property
 */
export function hasNumberProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, number> {
  return hasProperty(obj, key) && typeof obj[key] === 'number';
}

/**
 * Check if an object has a boolean property
 */
export function hasBooleanProperty<K extends string>(
  obj: unknown,
  key: K
): obj is Record<K, boolean> {
  return hasProperty(obj, key) && typeof obj[key] === 'boolean';
}

/**
 * Get a number property safely
 */
export function getNumberProperty(obj: unknown, key: string): number | undefined {
  if (hasNumberProperty(obj, key)) {
    return obj[key];
  }
  return undefined;
}

/**
 * Get a boolean property safely
 */
export function getBooleanProperty(obj: unknown, key: string): boolean | undefined {
  if (hasBooleanProperty(obj, key)) {
    return obj[key];
  }
  return undefined;
}

/**
 * Get a string property safely
 */
export function getStringProperty(obj: unknown, key: string): string | undefined {
  if (hasStringProperty(obj, key)) {
    return obj[key];
  }
  return undefined;
}

// ============================================================================
// Zod Issue Type Guards
// ============================================================================

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
  return getBooleanProperty(issue, 'inclusive');
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
  code?: string;
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
export function getIsRetryable(error: unknown): boolean | undefined {
  if (error instanceof Error && hasBooleanProperty(error, 'isRetryable')) {
    return error.isRetryable;
  }
  return undefined;
}

/**
 * Get error code from an error
 */
export function getErrorCode(error: unknown): string | undefined {
  if (error instanceof Error && hasStringProperty(error, 'code')) {
    return error.code;
  }
  return undefined;
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
// SDK Message Type Guards
// ============================================================================

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
// Error Extension Helpers
// ============================================================================

/**
 * Interface for errors with operation timing info
 */
export interface ErrorWithOperationInfo extends Error {
  operationDuration?: number;
  operationName?: string;
}

/**
 * Attach operation info to an error in a type-safe way
 */
export function attachOperationInfo(
  error: Error,
  operationName?: string,
  operationDuration?: number
): ErrorWithOperationInfo {
  const extendedError = error as ErrorWithOperationInfo;
  if (operationDuration !== undefined) {
    extendedError.operationDuration = operationDuration;
  }
  if (operationName !== undefined) {
    extendedError.operationName = operationName;
  }
  return extendedError;
}

// ============================================================================
// Object Initialization Helpers
// ============================================================================

/**
 * Create a type-safe record by iterating over keys
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
