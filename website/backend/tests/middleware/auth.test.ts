/**
 * Tests for Authentication Middleware
 * Covers requireAuth and requireAdmin middleware functions
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { Request, Response, NextFunction } from 'express';
import { requireAuth, requireAdmin } from '../../src/api/middleware/auth.js';
import {
  createMockRequest,
  createMockResponse,
  createMockUser,
  createMockSession,
} from '../helpers/mockExpress.js';

describe('Authentication Middleware', () => {
  describe('requireAuth', () => {
    it('should return 401 when no user is present', () => {
      const req = createMockRequest({ user: null, authSession: null });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAuth(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 401 when user exists but session is null', () => {
      const req = createMockRequest({
        user: createMockUser(),
        authSession: null,
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAuth(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 401 when session exists but user is null', () => {
      const req = createMockRequest({
        user: null,
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAuth(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
      assert.strictEqual(nextCalled, false);
    });

    it('should call next() when user and session are present', () => {
      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAuth(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, 200); // Default, not changed
    });
  });

  describe('requireAdmin', () => {
    it('should return 401 when no user is present', () => {
      const req = createMockRequest({ user: null, authSession: null });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAdmin(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 401 when no session is present', () => {
      const req = createMockRequest({
        user: createMockUser({ isAdmin: true }),
        authSession: null,
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAdmin(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when user is not admin', () => {
      const req = createMockRequest({
        user: createMockUser({ isAdmin: false }),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAdmin(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.data, { success: false, error: 'Forbidden: Admin access required' });
      assert.strictEqual(nextCalled, false);
    });

    it('should call next() when user is admin with valid session', () => {
      const req = createMockRequest({
        user: createMockUser({ isAdmin: true }),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAdmin(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, 200); // Default, not changed
    });
  });

  describe('Authorization Edge Cases', () => {
    it('should handle undefined user property', () => {
      const req = createMockRequest();
      delete (req as Record<string, unknown>).user;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAuth(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should handle undefined authSession property', () => {
      const req = createMockRequest({ user: createMockUser() });
      delete (req as Record<string, unknown>).authSession;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAuth(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should check admin status correctly when isAdmin is explicitly false', () => {
      const req = createMockRequest({
        user: createMockUser({ isAdmin: false }),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      requireAdmin(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 403);
      assert.strictEqual(nextCalled, false);
    });
  });
});
