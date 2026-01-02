/**
 * Tests for CSRF Protection Middleware
 * Verifies CSRF tokens are validated on all state-changing endpoints
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Request, Response, NextFunction } from 'express';
import {
  csrfTokenMiddleware,
  csrfValidationMiddleware,
  csrfProtection,
  getCsrfToken,
  CSRF_CONSTANTS,
  getExemptPatterns,
  isExemptPath,
} from '../../src/api/middleware/csrf.js';
import {
  createMockRequest,
  createMockResponse,
} from '../helpers/mockExpress.js';

describe('CSRF Protection Middleware', () => {
  describe('csrfTokenMiddleware', () => {
    it('should generate a new CSRF token when none exists', () => {
      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfTokenMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true);
      // Check that Set-Cookie header was added
      const setCookie = res.headers.get('Set-Cookie');
      assert.ok(setCookie, 'Set-Cookie header should be set');
      assert.ok(setCookie.includes(CSRF_CONSTANTS.COOKIE_NAME), 'Cookie should contain CSRF token name');
    });

    it('should not generate a new token when one already exists', () => {
      const existingToken = 'existing-csrf-token-12345';
      const req = createMockRequest({
        headers: { cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=${existingToken}` },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfTokenMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true);
      // Should not set a new cookie when one already exists
      const setCookie = res.headers.get('Set-Cookie');
      assert.strictEqual(setCookie, undefined, 'Should not set new cookie when token exists');
    });
  });

  describe('csrfValidationMiddleware', () => {
    it('should skip validation for GET requests', () => {
      const req = createMockRequest({
        method: 'GET',
        path: '/api/sessions',
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, 200);
    });

    it('should skip validation for HEAD requests', () => {
      const req = createMockRequest({
        method: 'HEAD',
        path: '/api/sessions/123',
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true);
    });

    it('should skip validation for OPTIONS requests', () => {
      const req = createMockRequest({
        method: 'OPTIONS',
        path: '/api/sessions',
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true);
    });

    it('should return 403 when CSRF token is missing for POST requests', () => {
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {},
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.data, {
        success: false,
        error: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING',
      });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when CSRF token is missing for PUT requests', () => {
      const req = createMockRequest({
        method: 'PUT',
        path: '/api/user/settings',
        headers: {},
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when CSRF token is missing for DELETE requests', () => {
      const req = createMockRequest({
        method: 'DELETE',
        path: '/api/sessions/123',
        headers: {},
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when CSRF token is missing for PATCH requests', () => {
      const req = createMockRequest({
        method: 'PATCH',
        path: '/api/sessions/123',
        headers: {},
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when cookie token exists but header token is missing', () => {
      const token = 'valid-csrf-token-12345';
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=${token}`,
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.data, {
        success: false,
        error: 'CSRF token missing',
        code: 'CSRF_TOKEN_MISSING',
      });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when header token exists but cookie token is missing', () => {
      const token = 'valid-csrf-token-12345';
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          [CSRF_CONSTANTS.HEADER_NAME]: token,
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when tokens do not match', () => {
      const cookieToken = 'cookie-token-12345';
      const headerToken = 'different-header-token';
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=${cookieToken}`,
          [CSRF_CONSTANTS.HEADER_NAME]: headerToken,
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.data, {
        success: false,
        error: 'CSRF token invalid',
        code: 'CSRF_TOKEN_INVALID',
      });
      assert.strictEqual(nextCalled, false);
    });

    it('should pass validation when tokens match', () => {
      const token = 'valid-matching-token-12345';
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=${token}`,
          [CSRF_CONSTANTS.HEADER_NAME]: token,
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, 200);
    });
  });

  describe('Exempt Path Handling', () => {
    const exemptPaths = [
      // SSE streaming endpoints
      { path: '/api/execute-remote', method: 'POST', reason: 'SSE streaming endpoint' },
      { path: '/api/resume/session-123', method: 'GET', reason: 'SSE streaming endpoint' },
      { path: '/api/sessions/123/events/stream', method: 'GET', reason: 'SSE streaming endpoint' },
      { path: '/api/orchestrator/job-123/stream', method: 'GET', reason: 'SSE streaming endpoint' },
      { path: '/api/live-chat/owner/repo/branch/execute', method: 'POST', reason: 'SSE streaming endpoint' },
      { path: '/api/workspace/events/owner/repo/stream', method: 'GET', reason: 'SSE streaming endpoint' },
      { path: '/api/workspace/presence/owner/repo/stream', method: 'GET', reason: 'SSE streaming endpoint' },
      // Auth endpoints (no session to protect)
      { path: '/api/auth/login', method: 'POST', reason: 'No session exists yet' },
      { path: '/api/auth/register', method: 'POST', reason: 'No session exists yet' },
      // Webhook callbacks (external services)
      { path: '/api/github/callback', method: 'POST', reason: 'OAuth callback from GitHub' },
      { path: '/api/payments/webhooks/stripe', method: 'POST', reason: 'Stripe webhook callback' },
      { path: '/api/payments/webhooks/paypal', method: 'POST', reason: 'PayPal webhook callback' },
      // Health check endpoints
      { path: '/health', method: 'GET', reason: 'Health check endpoint' },
      { path: '/health/status', method: 'GET', reason: 'Health check endpoint' },
      { path: '/ready', method: 'GET', reason: 'Kubernetes readiness probe' },
      { path: '/live', method: 'GET', reason: 'Kubernetes liveness probe' },
      { path: '/metrics', method: 'GET', reason: 'Metrics endpoint' },
      // API documentation
      { path: '/api/docs', method: 'GET', reason: 'API documentation' },
      { path: '/api/openapi.json', method: 'GET', reason: 'OpenAPI specification' },
    ];

    for (const { path, method, reason } of exemptPaths) {
      it(`should exempt ${method} ${path} (${reason})`, () => {
        // For POST exempt paths, we should NOT require CSRF
        const req = createMockRequest({
          method,
          path,
          headers: {},
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        csrfValidationMiddleware(
          req as unknown as Request,
          res as unknown as Response,
          next as NextFunction
        );

        assert.strictEqual(nextCalled, true, `${method} ${path} should be exempt from CSRF`);
        assert.strictEqual(res.statusCode, 200);
      });
    }
  });

  describe('Non-Exempt Paths Require CSRF', () => {
    const protectedPaths = [
      // Session management
      { path: '/api/sessions', method: 'POST' },
      { path: '/api/sessions/123', method: 'DELETE' },
      { path: '/api/sessions/123', method: 'PATCH' },
      { path: '/api/sessions/bulk-delete', method: 'POST' },
      // User settings
      { path: '/api/user/claude-auth', method: 'POST' },
      { path: '/api/user/claude-auth', method: 'DELETE' },
      { path: '/api/user/preferred-provider', method: 'POST' },
      // GitHub operations
      { path: '/api/github/repos/owner/repo/branches', method: 'POST' },
      { path: '/api/github/repos/owner/repo/pulls', method: 'POST' },
      { path: '/api/github/repos/owner/repo/contents/file.js', method: 'PUT' },
      { path: '/api/github/repos/owner/repo/contents/file.js', method: 'DELETE' },
      { path: '/api/github/disconnect', method: 'POST' },
      // Admin operations
      { path: '/api/admin/users', method: 'POST' },
      { path: '/api/admin/users/123', method: 'PATCH' },
      { path: '/api/admin/users/123', method: 'DELETE' },
      // Auth logout (requires existing session)
      { path: '/api/auth/logout', method: 'POST' },
      // Collections
      { path: '/api/collections', method: 'POST' },
      { path: '/api/collections/123', method: 'PATCH' },
      { path: '/api/collections/123', method: 'DELETE' },
      // Community
      { path: '/api/community/posts', method: 'POST' },
      { path: '/api/community/posts/123', method: 'PATCH' },
      { path: '/api/community/posts/123', method: 'DELETE' },
      // Store/Purchases
      { path: '/api/store/wishlist/game-123', method: 'POST' },
      { path: '/api/store/wishlist/game-123', method: 'DELETE' },
      { path: '/api/purchases/buy/game-123', method: 'POST' },
      // Billing
      { path: '/api/billing/change-plan', method: 'POST' },
      // Snippets
      { path: '/api/snippets', method: 'POST' },
      { path: '/api/snippets/123', method: 'PUT' },
      { path: '/api/snippets/123', method: 'DELETE' },
    ];

    for (const { path, method } of protectedPaths) {
      it(`should require CSRF for ${method} ${path}`, () => {
        const req = createMockRequest({
          method,
          path,
          headers: {},
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        csrfValidationMiddleware(
          req as unknown as Request,
          res as unknown as Response,
          next as NextFunction
        );

        assert.strictEqual(res.statusCode, 403, `${method} ${path} should require CSRF token`);
        assert.strictEqual(nextCalled, false);
      });
    }
  });

  describe('isExemptPath', () => {
    it('should return true for exempt SSE endpoints', () => {
      assert.strictEqual(isExemptPath('/api/execute-remote'), true);
      assert.strictEqual(isExemptPath('/api/resume/session-123'), true);
    });

    it('should return true for exempt auth endpoints', () => {
      assert.strictEqual(isExemptPath('/api/auth/login'), true);
      assert.strictEqual(isExemptPath('/api/auth/register'), true);
    });

    it('should return true for webhook callbacks', () => {
      assert.strictEqual(isExemptPath('/api/github/callback'), true);
      assert.strictEqual(isExemptPath('/api/payments/webhooks/stripe'), true);
      assert.strictEqual(isExemptPath('/api/payments/webhooks/paypal'), true);
    });

    it('should return false for protected endpoints', () => {
      assert.strictEqual(isExemptPath('/api/sessions'), false);
      assert.strictEqual(isExemptPath('/api/auth/logout'), false);
      assert.strictEqual(isExemptPath('/api/user/settings'), false);
    });
  });

  describe('getCsrfToken', () => {
    it('should return existing token from cookie', () => {
      const existingToken = 'existing-token-12345';
      const req = createMockRequest({
        headers: { cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=${existingToken}` },
      });
      const res = createMockResponse();

      const token = getCsrfToken(req as unknown as Request, res as unknown as Response);

      assert.strictEqual(token, existingToken);
    });

    it('should generate new token if none exists', () => {
      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();

      const token = getCsrfToken(req as unknown as Request, res as unknown as Response);

      assert.ok(token, 'Token should be generated');
      assert.strictEqual(token.length, 64, 'Token should be 32 bytes hex encoded = 64 chars');
      // Verify Set-Cookie header was added
      const setCookie = res.headers.get('Set-Cookie');
      assert.ok(setCookie, 'Set-Cookie header should be set');
      assert.ok(setCookie.includes(token), 'Cookie should contain the generated token');
    });
  });

  describe('getExemptPatterns', () => {
    it('should return a copy of exempt patterns array', () => {
      const patterns = getExemptPatterns();

      assert.ok(Array.isArray(patterns), 'Should return an array');
      assert.ok(patterns.length > 0, 'Should have at least one pattern');
      assert.ok(patterns.every(p => p instanceof RegExp), 'All patterns should be RegExp');
    });
  });

  describe('csrfProtection (combined middleware)', () => {
    it('should generate token and validate in sequence', () => {
      const token = 'combined-test-token-12345';
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=${token}`,
          [CSRF_CONSTANTS.HEADER_NAME]: token,
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      const middleware = csrfProtection();
      middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
    });

    it('should reject when tokens do not match', () => {
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=cookie-token`,
          [CSRF_CONSTANTS.HEADER_NAME]: 'different-header-token',
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      const middleware = csrfProtection();
      middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 403);
    });
  });

  describe('CSRF Constants', () => {
    it('should export correct cookie name', () => {
      assert.strictEqual(CSRF_CONSTANTS.COOKIE_NAME, 'csrf_token');
    });

    it('should export correct header name', () => {
      assert.strictEqual(CSRF_CONSTANTS.HEADER_NAME, 'x-csrf-token');
    });
  });

  describe('Token Security', () => {
    it('should generate tokens of sufficient length', () => {
      const req = createMockRequest({ headers: {} });
      const res = createMockResponse();

      const token = getCsrfToken(req as unknown as Request, res as unknown as Response);

      // 32 bytes = 256 bits of entropy, hex encoded = 64 characters
      assert.strictEqual(token.length, 64, 'Token should be 64 hex characters (256 bits)');
    });

    it('should generate unique tokens', () => {
      const tokens = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const req = createMockRequest({ headers: {} });
        const res = createMockResponse();
        const token = getCsrfToken(req as unknown as Request, res as unknown as Response);
        tokens.add(token);
      }

      assert.strictEqual(tokens.size, 100, 'All 100 tokens should be unique');
    });
  });

  describe('Cookie Parsing', () => {
    it('should handle URL-encoded cookie values', () => {
      // Token contains special characters that need URL encoding
      const decodedToken = 'token with spaces';
      // Cookie will have URL-encoded value
      const encodedToken = encodeURIComponent(decodedToken);
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          cookie: `${CSRF_CONSTANTS.COOKIE_NAME}=${encodedToken}`,
          // Header should contain the decoded version that matches after cookie is decoded
          [CSRF_CONSTANTS.HEADER_NAME]: decodedToken,
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true, 'Should decode URL-encoded cookie value');
    });

    it('should handle multiple cookies', () => {
      const token = 'valid-token-123';
      const req = createMockRequest({
        method: 'POST',
        path: '/api/sessions',
        headers: {
          cookie: `other_cookie=value; ${CSRF_CONSTANTS.COOKIE_NAME}=${token}; another=cookie`,
          [CSRF_CONSTANTS.HEADER_NAME]: token,
        },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      csrfValidationMiddleware(
        req as unknown as Request,
        res as unknown as Response,
        next as NextFunction
      );

      assert.strictEqual(nextCalled, true, 'Should find CSRF token among multiple cookies');
    });
  });
});
