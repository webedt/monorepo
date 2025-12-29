/**
 * API Response Utilities
 * Standardized response format helpers for consistent API responses
 * @module utils/api/apiResponse
 */

import type { Response } from 'express';
import { getCorrelationId } from '../logging/correlationContext.js';

/**
 * Standard success response format
 */
export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp: string;
  /** Request correlation ID for tracing */
  requestId?: string;
}

/**
 * Standard error response format
 */
export interface ApiErrorResponse {
  success: false;
  error: {
    message: string;
    code?: string;
    fields?: Record<string, string[]>;
    /** Request correlation ID for tracing */
    requestId?: string;
  };
  timestamp: string;
  /** Request correlation ID for tracing (also in error object for convenience) */
  requestId?: string;
}

/**
 * Combined response type
 */
export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;

/**
 * Common error codes
 */
export const ApiErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ApiErrorCodeType = typeof ApiErrorCode[keyof typeof ApiErrorCode];

/**
 * Create a standardized success response object
 * Automatically includes correlation ID from async context if available
 * @param data - The response data
 * @param requestId - Optional explicit request ID (auto-detected from context if not provided)
 * @returns Formatted success response
 */
export function successResponse<T>(data: T, requestId?: string): ApiSuccessResponse<T> {
  const correlationId = requestId || getCorrelationId();
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
    ...(correlationId && { requestId: correlationId }),
  };
}

/**
 * Create a standardized error response object
 * Automatically includes correlation ID from async context if available
 * @param message - Error message
 * @param code - Optional error code
 * @param requestId - Optional explicit request ID (auto-detected from context if not provided)
 * @returns Formatted error response
 */
export function errorResponse(message: string, code?: string, requestId?: string): ApiErrorResponse {
  const correlationId = requestId || getCorrelationId();
  return {
    success: false,
    error: {
      message,
      ...(code && { code }),
      ...(correlationId && { requestId: correlationId }),
    },
    timestamp: new Date().toISOString(),
    ...(correlationId && { requestId: correlationId }),
  };
}

/**
 * Create a validation error response object
 * Automatically includes correlation ID from async context if available
 * @param message - Error message
 * @param fields - Field-level error details
 * @param requestId - Optional explicit request ID (auto-detected from context if not provided)
 * @returns Formatted validation error response
 */
export function validationErrorResponse(
  message: string,
  fields?: Record<string, string[]>,
  requestId?: string
): ApiErrorResponse {
  const correlationId = requestId || getCorrelationId();
  return {
    success: false,
    error: {
      message,
      code: ApiErrorCode.VALIDATION_ERROR,
      ...(fields && { fields }),
      ...(correlationId && { requestId: correlationId }),
    },
    timestamp: new Date().toISOString(),
    ...(correlationId && { requestId: correlationId }),
  };
}

/**
 * Send a standardized success response
 * @param res - Express response object
 * @param data - The response data
 * @param statusCode - HTTP status code (default: 200)
 */
export function sendSuccess<T>(res: Response, data: T, statusCode = 200): void {
  res.status(statusCode).json(successResponse(data));
}

/**
 * Send a standardized error response
 * @param res - Express response object
 * @param message - Error message
 * @param statusCode - HTTP status code (default: 400)
 * @param code - Optional error code
 */
export function sendError(
  res: Response,
  message: string,
  statusCode = 400,
  code?: string
): void {
  res.status(statusCode).json(errorResponse(message, code));
}

/**
 * Send a validation error response
 * @param res - Express response object
 * @param message - Error message
 * @param fields - Field-level error details
 */
export function sendValidationError(
  res: Response,
  message: string,
  fields?: Record<string, string[]>
): void {
  res.status(422).json(validationErrorResponse(message, fields));
}

/**
 * Send a 401 Unauthorized response
 * @param res - Express response object
 * @param message - Error message (default: 'Unauthorized')
 */
export function sendUnauthorized(res: Response, message = 'Unauthorized'): void {
  sendError(res, message, 401, ApiErrorCode.UNAUTHORIZED);
}

/**
 * Send a 403 Forbidden response
 * @param res - Express response object
 * @param message - Error message (default: 'Forbidden')
 */
export function sendForbidden(res: Response, message = 'Forbidden'): void {
  sendError(res, message, 403, ApiErrorCode.FORBIDDEN);
}

/**
 * Send a 404 Not Found response
 * @param res - Express response object
 * @param message - Error message (default: 'Not found')
 */
export function sendNotFound(res: Response, message = 'Not found'): void {
  sendError(res, message, 404, ApiErrorCode.NOT_FOUND);
}

/**
 * Send a 409 Conflict response
 * @param res - Express response object
 * @param message - Error message
 */
export function sendConflict(res: Response, message: string): void {
  sendError(res, message, 409, ApiErrorCode.CONFLICT);
}

/**
 * Send a 500 Internal Server Error response
 * @param res - Express response object
 * @param message - Error message (default: 'Internal server error')
 */
export function sendInternalError(res: Response, message = 'Internal server error'): void {
  sendError(res, message, 500, ApiErrorCode.INTERNAL_ERROR);
}
