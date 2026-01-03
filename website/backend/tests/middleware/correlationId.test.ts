/**
 * Tests for Correlation ID Middleware
 * Covers correlationIdMiddleware, getCorrelationId, and createLogContext
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { Request, Response, NextFunction } from 'express';

import {
  correlationIdMiddleware,
  getCorrelationId,
  createLogContext,
  CORRELATION_ID_HEADER,
} from '../../src/api/middleware/correlationId.js';

/**
 * Create a mock request for correlation ID testing
 */
function createCorrelationRequest(overrides: Partial<Request> = {}): Request {
  const baseReq: Partial<Request> = {
    headers: {},
    ...overrides,
  };
  return baseReq as Request;
}

/**
 * Create a mock response for correlation ID testing
 */
function createCorrelationResponse(): Response & { getSetHeader: (name: string) => string | undefined } {
  const responseHeaders = new Map<string, string>();

  const mockRes = {
    setHeader(name: string, value: string) {
      responseHeaders.set(name, value);
      return mockRes;
    },
    getSetHeader(name: string) {
      return responseHeaders.get(name);
    },
  };

  return mockRes as unknown as Response & { getSetHeader: (name: string) => string | undefined };
}

describe('Correlation ID Middleware', () => {
  describe('CORRELATION_ID_HEADER constant', () => {
    it('should export the correct header name', () => {
      assert.strictEqual(CORRELATION_ID_HEADER, 'X-Request-ID');
    });
  });

  describe('correlationIdMiddleware', () => {
    it('should generate a UUID when no header is provided', () => {
      const req = createCorrelationRequest();
      const res = createCorrelationResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      correlationIdMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      assert.ok(req.correlationId, 'Should have a correlationId');
      // Verify it's a valid UUID format
      assert.match(
        req.correlationId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        'Should be a valid UUID'
      );
    });

    it('should use the X-Request-ID header when provided', () => {
      const customId = 'custom-correlation-id-12345';
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': customId,
        } as Record<string, string>,
      });
      const res = createCorrelationResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      correlationIdMiddleware(req, res, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(req.correlationId, customId);
    });

    it('should set the correlation ID as a response header', () => {
      const req = createCorrelationRequest();
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      const responseHeader = res.getSetHeader(CORRELATION_ID_HEADER);
      assert.strictEqual(responseHeader, req.correlationId);
    });

    it('should sanitize headers with whitespace', () => {
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': '  valid-id-with-spaces  ',
        } as Record<string, string>,
      });
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      assert.strictEqual(req.correlationId, 'valid-id-with-spaces');
    });

    it('should generate new ID for empty header after trim', () => {
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': '   ',
        } as Record<string, string>,
      });
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      // Should generate a new UUID since trimmed header is empty
      assert.match(
        req.correlationId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should remove control characters from header value', () => {
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': 'valid\x00-id\x1f-with\x7f-control-chars',
        } as Record<string, string>,
      });
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      assert.strictEqual(req.correlationId, 'valid-id-with-control-chars');
    });

    it('should truncate very long header values', () => {
      const longId = 'x'.repeat(200);
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': longId,
        } as Record<string, string>,
      });
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      assert.strictEqual(req.correlationId.length, 128);
    });

    it('should generate new ID when control chars removal results in empty string', () => {
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': '\x00\x1f\x7f',
        } as Record<string, string>,
      });
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      // Should generate a new UUID
      assert.match(
        req.correlationId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should handle array header values by generating new ID', () => {
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': ['id1', 'id2'],
        } as unknown as Record<string, string>,
      });
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      // Array values should result in new UUID generation
      assert.match(
        req.correlationId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it('should handle undefined header value', () => {
      const req = createCorrelationRequest({
        headers: {
          'x-request-id': undefined,
        } as unknown as Record<string, string>,
      });
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      assert.match(
        req.correlationId,
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });
  });

  describe('getCorrelationId', () => {
    it('should return the correlation ID from request', () => {
      const req = createCorrelationRequest();
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      const correlationId = getCorrelationId(req);
      assert.strictEqual(correlationId, req.correlationId);
    });

    it('should return undefined if middleware not applied', () => {
      const req = createCorrelationRequest();

      const correlationId = getCorrelationId(req);
      assert.strictEqual(correlationId, undefined);
    });
  });

  describe('createLogContext', () => {
    it('should create log context with correlation ID and component', () => {
      const req = createCorrelationRequest();
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      const context = createLogContext(req, 'TestComponent');

      assert.strictEqual(context.component, 'TestComponent');
      assert.strictEqual(context.requestId, req.correlationId);
    });

    it('should merge additional context', () => {
      const req = createCorrelationRequest();
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      const context = createLogContext(req, 'TestComponent', {
        userId: 'user-123',
        action: 'create',
      });

      assert.strictEqual(context.component, 'TestComponent');
      assert.strictEqual(context.requestId, req.correlationId);
      assert.strictEqual(context.userId, 'user-123');
      assert.strictEqual(context.action, 'create');
    });

    it('should allow additional context to override defaults', () => {
      const req = createCorrelationRequest();
      const res = createCorrelationResponse();
      const next = () => {};

      correlationIdMiddleware(req, res, next as NextFunction);

      const context = createLogContext(req, 'TestComponent', {
        requestId: 'custom-override',
      });

      // Additional context comes after defaults, so it should override
      assert.strictEqual(context.requestId, 'custom-override');
    });
  });

  describe('Edge Cases', () => {
    it('should handle requests from various load balancers', () => {
      // AWS ALB format
      const req1 = createCorrelationRequest({
        headers: { 'x-request-id': 'Root=1-67891234-abcdef123456789012345678' } as Record<string, string>,
      });
      const res1 = createCorrelationResponse();
      correlationIdMiddleware(req1, res1, () => {});
      assert.ok(req1.correlationId.includes('Root='));

      // UUID format from nginx
      const req2 = createCorrelationRequest({
        headers: { 'x-request-id': '550e8400-e29b-41d4-a716-446655440000' } as Record<string, string>,
      });
      const res2 = createCorrelationResponse();
      correlationIdMiddleware(req2, res2, () => {});
      assert.strictEqual(req2.correlationId, '550e8400-e29b-41d4-a716-446655440000');
    });

    it('should handle requests without headers object', () => {
      const req = { headers: {} } as Request;
      const res = createCorrelationResponse();
      const next = () => {};

      // Should not throw
      correlationIdMiddleware(req, res, next as NextFunction);

      assert.ok(req.correlationId);
    });

    it('should generate unique IDs for concurrent requests', () => {
      const ids = new Set<string>();
      const count = 100;

      for (let i = 0; i < count; i++) {
        const req = createCorrelationRequest();
        const res = createCorrelationResponse();
        correlationIdMiddleware(req, res, () => {});
        ids.add(req.correlationId);
      }

      assert.strictEqual(ids.size, count, 'All generated IDs should be unique');
    });
  });
});
