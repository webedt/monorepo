/**
 * Tests for Domain Error Handler Middleware
 * Covers error handling, status codes, headers, and context sanitization
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import type { Request, Response, NextFunction } from 'express';
import {
  domainErrorHandler,
  asyncHandler,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  RateLimitError,
  ConflictError,
  NotFoundError,
  BadRequestError,
  InternalServerError,
  ServiceUnavailableError,
  PayloadTooLargeError,
  BadGatewayError,
} from '../../src/api/middleware/domainErrorHandler.js';
import {
  createMockRequest,
  createMockResponse,
} from '../helpers/mockExpress.js';

describe('Domain Error Handler Middleware', () => {
  describe('Error Status Codes', () => {
    it('should return 400 for ValidationError', () => {
      const req = createMockRequest({ path: '/test', method: 'POST' });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      const error = new ValidationError('Invalid email format', 'email');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 400);
      assert.strictEqual(nextCalled, false);
      const data = res.data as { success: boolean; error: { code: string } };
      assert.strictEqual(data.success, false);
      assert.strictEqual(data.error.code, 'VALIDATION_ERROR');
    });

    it('should return 400 for BadRequestError', () => {
      const req = createMockRequest({ path: '/test', method: 'POST' });
      const res = createMockResponse();
      const next = () => {};

      const error = new BadRequestError('GitHub not connected');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 400);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'BAD_REQUEST_ERROR');
    });

    it('should return 401 for AuthenticationError', () => {
      const req = createMockRequest({ path: '/test', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = AuthenticationError.notAuthenticated();
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'AUTHENTICATION_ERROR');
    });

    it('should return 403 for AuthorizationError', () => {
      const req = createMockRequest({ path: '/admin', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = AuthorizationError.insufficientRole('admin');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 403);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'AUTHORIZATION_ERROR');
    });

    it('should return 404 for NotFoundError', () => {
      const req = createMockRequest({ path: '/users/123', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = NotFoundError.forResource('User', '123');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 404);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'NOT_FOUND_ERROR');
    });

    it('should return 409 for ConflictError', () => {
      const req = createMockRequest({ path: '/users', method: 'POST' });
      const res = createMockResponse();
      const next = () => {};

      const error = ConflictError.uniqueViolation('email', 'test@example.com');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 409);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'CONFLICT_ERROR');
    });

    it('should return 413 for PayloadTooLargeError', () => {
      const req = createMockRequest({ path: '/upload', method: 'POST' });
      const res = createMockResponse();
      const next = () => {};

      const error = PayloadTooLargeError.quotaExceeded('Storage', 100 * 1024 * 1024);
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 413);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'PAYLOAD_TOO_LARGE_ERROR');
    });

    it('should return 429 for RateLimitError', () => {
      const req = createMockRequest({ path: '/api', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = RateLimitError.limitExceeded(60);
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 429);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'RATE_LIMIT_ERROR');
    });

    it('should return 500 for InternalServerError', () => {
      const req = createMockRequest({ path: '/api', method: 'POST' });
      const res = createMockResponse();
      const next = () => {};

      const error = InternalServerError.operationFailed('save user');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 500);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'INTERNAL_SERVER_ERROR');
    });

    it('should return 502 for BadGatewayError', () => {
      const req = createMockRequest({ path: '/api', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = BadGatewayError.upstreamFailure('GitHub API');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 502);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'BAD_GATEWAY_ERROR');
    });

    it('should return 503 for ServiceUnavailableError', () => {
      const req = createMockRequest({ path: '/api', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = ServiceUnavailableError.serviceDown('AI Service', 60);
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 503);
      const data = res.data as { error: { code: string } };
      assert.strictEqual(data.error.code, 'SERVICE_UNAVAILABLE_ERROR');
    });
  });

  describe('Retry-After Header', () => {
    it('should set Retry-After header for RateLimitError', () => {
      const req = createMockRequest({ path: '/api', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = RateLimitError.limitExceeded(120);
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.headers.get('Retry-After'), '120');
    });

    it('should set Retry-After header for ServiceUnavailableError', () => {
      const req = createMockRequest({ path: '/api', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = ServiceUnavailableError.serviceDown('Database', 30);
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.headers.get('Retry-After'), '30');
    });

    it('should not set Retry-After header when retryAfterSeconds is undefined', () => {
      const req = createMockRequest({ path: '/api', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = ServiceUnavailableError.maintenance();
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.headers.has('Retry-After'), false);
    });
  });

  describe('Non-Domain Errors', () => {
    it('should pass non-domain errors to next()', () => {
      const req = createMockRequest({ path: '/test', method: 'GET' });
      const res = createMockResponse();
      let passedError: Error | null = null;
      const next = (err: Error) => { passedError = err; };

      const genericError = new Error('Generic error');
      domainErrorHandler(genericError, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(passedError, genericError);
      assert.strictEqual(res.statusCode, 200); // Unchanged default
    });

    it('should pass TypeError to next()', () => {
      const req = createMockRequest({ path: '/test', method: 'GET' });
      const res = createMockResponse();
      let passedError: Error | null = null;
      const next = (err: Error) => { passedError = err; };

      const typeError = new TypeError('Cannot read property of undefined');
      domainErrorHandler(typeError, req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(passedError, typeError);
    });
  });

  describe('Response Format', () => {
    it('should return standardized error response format', () => {
      const req = createMockRequest({ path: '/users', method: 'POST' });
      const res = createMockResponse();
      const next = () => {};

      const error = new ValidationError('Email is required', 'email');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      const data = res.data as {
        success: boolean;
        error: { message: string; code: string };
        timestamp: string;
      };

      assert.strictEqual(data.success, false);
      assert.strictEqual(typeof data.error.message, 'string');
      assert.strictEqual(typeof data.error.code, 'string');
      assert.strictEqual(typeof data.timestamp, 'string');
      // Timestamp should be ISO format
      assert.doesNotThrow(() => new Date(data.timestamp));
    });

    it('should include error message in response', () => {
      const req = createMockRequest({ path: '/test', method: 'GET' });
      const res = createMockResponse();
      const next = () => {};

      const error = new NotFoundError('Session not found', 'session');
      domainErrorHandler(error, req as unknown as Request, res as unknown as Response, next as NextFunction);

      const data = res.data as { error: { message: string } };
      assert.strictEqual(data.error.message, 'Session not found');
    });
  });

  describe('asyncHandler', () => {
    it('should pass resolved promise result through', async () => {
      const req = createMockRequest({ path: '/test', method: 'GET' });
      const res = createMockResponse();
      let handlerCompleted = false;

      const handler = asyncHandler(async (_req, _res, _next) => {
        handlerCompleted = true;
      });

      await new Promise<void>((resolve) => {
        handler(req as unknown as Request, res as unknown as Response, () => resolve());
        // Give the async handler time to complete
        setTimeout(resolve, 10);
      });

      assert.strictEqual(handlerCompleted, true);
    });

    it('should catch async errors and pass to next()', async () => {
      const req = createMockRequest({ path: '/test', method: 'GET' });
      const res = createMockResponse();
      let capturedError: Error | null = null;

      const testError = new NotFoundError('Resource not found', 'resource');
      const handler = asyncHandler(async () => {
        throw testError;
      });

      await new Promise<void>((resolve) => {
        handler(req as unknown as Request, res as unknown as Response, (err: unknown) => {
          capturedError = err as Error;
          resolve();
        });
      });

      assert.strictEqual(capturedError, testError);
    });

    it('should catch sync errors thrown in async handler', async () => {
      const req = createMockRequest({ path: '/test', method: 'GET' });
      const res = createMockResponse();
      let capturedError: Error | null = null;

      const handler = asyncHandler(async () => {
        throw new BadRequestError('Invalid input');
      });

      await new Promise<void>((resolve) => {
        handler(req as unknown as Request, res as unknown as Response, (err: unknown) => {
          capturedError = err as Error;
          resolve();
        });
      });

      assert.ok(capturedError instanceof BadRequestError);
    });
  });

  describe('Error Factory Methods', () => {
    it('ValidationError.required should create correct error', () => {
      const error = ValidationError.required('username');
      assert.strictEqual(error.message, 'username is required');
      assert.strictEqual(error.field, 'username');
      assert.strictEqual(error.statusCode, 400);
    });

    it('ValidationError.invalidFormat should create correct error', () => {
      const error = ValidationError.invalidFormat('email', 'user@domain.com');
      assert.ok(error.message.includes('email'));
      assert.ok(error.message.includes('format'));
      assert.strictEqual(error.field, 'email');
    });

    it('NotFoundError.forResource should create correct error', () => {
      const error = NotFoundError.forResource('User', '12345');
      assert.strictEqual(error.message, "User '12345' not found");
      assert.strictEqual(error.resource, 'user');
      assert.strictEqual(error.statusCode, 404);
    });

    it('NotFoundError.forEntity should create correct error', () => {
      const error = NotFoundError.forEntity('Session');
      assert.strictEqual(error.message, 'Session not found');
      assert.strictEqual(error.resource, 'session');
    });

    it('BadRequestError.missingConfiguration should create correct error', () => {
      const error = BadRequestError.missingConfiguration('GitHub');
      assert.strictEqual(error.message, 'GitHub not configured');
      assert.strictEqual(error.statusCode, 400);
    });

    it('InternalServerError.operationFailed should create correct error', () => {
      const error = InternalServerError.operationFailed('save user');
      assert.strictEqual(error.message, 'Failed to save user');
      assert.strictEqual(error.statusCode, 500);
    });

    it('ServiceUnavailableError.serviceDown should include retryAfterSeconds', () => {
      const error = ServiceUnavailableError.serviceDown('AI Service', 45);
      assert.strictEqual(error.retryAfterSeconds, 45);
      assert.strictEqual(error.statusCode, 503);
    });

    it('ConflictError.uniqueViolation should create correct error', () => {
      const error = ConflictError.uniqueViolation('email', 'test@example.com');
      assert.ok(error.message.includes('email'));
      assert.ok(error.message.includes('already taken'));
      assert.strictEqual(error.conflictType, 'UNIQUE_VIOLATION');
    });
  });
});
