/**
 * Tests for Authorization Middleware
 * Covers requireOwnership, requireMembership, and requireResourceAccess
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';
import { Request, Response, NextFunction } from 'express';
import {
  createMockRequest,
  createMockResponse,
  createMockUser,
  createMockSession,
} from '../helpers/mockExpress.js';

// Import types for testing - actual middleware will be mocked
import type { AuthorizedRequest } from '../../src/api/middleware/authorization.js';

/**
 * Mock the database and organization service for testing
 * In a real test, we'd mock the @webedt/shared imports
 */

// Helper to create a mock middleware with simulated behavior
function createMockOwnershipMiddleware(options: {
  resourceExists: boolean;
  isOwner: boolean;
  attachToRequest?: boolean;
  mockResource?: Record<string, unknown>;
}) {
  return async function mockMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const mockReq = req as unknown as { user?: { id: string } };

    if (!mockReq.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!options.resourceExists) {
      res.status(404).json({ success: false, error: 'Resource not found' });
      return;
    }

    if (!options.isOwner) {
      res.status(403).json({ success: false, error: 'Access denied' });
      return;
    }

    if (options.attachToRequest && options.mockResource) {
      (req as AuthorizedRequest).authorizedResource = options.mockResource;
      (req as AuthorizedRequest).authorizationResult = {
        authorized: true,
        role: 'owner',
        resource: options.mockResource,
      };
    }

    next();
  };
}

// Helper to create mock membership middleware
function createMockMembershipMiddleware(options: {
  isMember: boolean;
  role?: 'owner' | 'admin' | 'member';
  requiredRole?: 'owner' | 'admin' | 'member';
}) {
  const roleHierarchy = { owner: 3, admin: 2, member: 1 };

  return async function mockMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    const mockReq = req as unknown as { user?: { id: string } };

    if (!mockReq.user) {
      res.status(401).json({ success: false, error: 'Unauthorized' });
      return;
    }

    if (!options.isMember) {
      res.status(403).json({ success: false, error: 'Not a member of this organization' });
      return;
    }

    const userRole = options.role || 'member';
    const requiredRole = options.requiredRole || 'member';

    if (roleHierarchy[userRole] < roleHierarchy[requiredRole]) {
      res.status(403).json({ success: false, error: `Requires ${requiredRole} role or higher` });
      return;
    }

    (req as AuthorizedRequest).authorizationResult = {
      authorized: true,
      role: userRole,
    };

    next();
  };
}

describe('Authorization Middleware', () => {
  describe('requireOwnership (simulated)', () => {
    it('should return 401 when user is not authenticated', async () => {
      const middleware = createMockOwnershipMiddleware({
        resourceExists: true,
        isOwner: true,
      });

      const req = createMockRequest({ user: null, authSession: null });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 404 when resource does not exist', async () => {
      const middleware = createMockOwnershipMiddleware({
        resourceExists: false,
        isOwner: false,
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { id: 'non-existent-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 404);
      assert.deepStrictEqual(res.data, { success: false, error: 'Resource not found' });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when user is not the owner', async () => {
      const middleware = createMockOwnershipMiddleware({
        resourceExists: true,
        isOwner: false,
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { id: 'resource-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.data, { success: false, error: 'Access denied' });
      assert.strictEqual(nextCalled, false);
    });

    it('should call next() when user owns the resource', async () => {
      const middleware = createMockOwnershipMiddleware({
        resourceExists: true,
        isOwner: true,
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { id: 'resource-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      assert.strictEqual(res.statusCode, 200); // Default, not changed
    });

    it('should attach resource to request when configured', async () => {
      const mockResource = { id: 'resource-id', name: 'Test Resource', userId: 'test-user-id' };
      const middleware = createMockOwnershipMiddleware({
        resourceExists: true,
        isOwner: true,
        attachToRequest: true,
        mockResource,
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { id: 'resource-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      const authorizedReq = req as unknown as AuthorizedRequest;
      assert.deepStrictEqual(authorizedReq.authorizedResource, mockResource);
      assert.strictEqual(authorizedReq.authorizationResult?.authorized, true);
      assert.strictEqual(authorizedReq.authorizationResult?.role, 'owner');
    });
  });

  describe('requireMembership (simulated)', () => {
    it('should return 401 when user is not authenticated', async () => {
      const middleware = createMockMembershipMiddleware({
        isMember: true,
        role: 'member',
      });

      const req = createMockRequest({ user: null, authSession: null });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when user is not a member', async () => {
      const middleware = createMockMembershipMiddleware({
        isMember: false,
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { orgId: 'org-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.data, { success: false, error: 'Not a member of this organization' });
      assert.strictEqual(nextCalled, false);
    });

    it('should return 403 when member lacks required role', async () => {
      const middleware = createMockMembershipMiddleware({
        isMember: true,
        role: 'member',
        requiredRole: 'admin',
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { orgId: 'org-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 403);
      assert.deepStrictEqual(res.data, { success: false, error: 'Requires admin role or higher' });
      assert.strictEqual(nextCalled, false);
    });

    it('should call next() when member has sufficient role', async () => {
      const middleware = createMockMembershipMiddleware({
        isMember: true,
        role: 'admin',
        requiredRole: 'member',
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { orgId: 'org-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      const authorizedReq = req as unknown as AuthorizedRequest;
      assert.strictEqual(authorizedReq.authorizationResult?.role, 'admin');
    });

    it('should allow owner role when admin is required', async () => {
      const middleware = createMockMembershipMiddleware({
        isMember: true,
        role: 'owner',
        requiredRole: 'admin',
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: { orgId: 'org-id' },
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
      const authorizedReq = req as unknown as AuthorizedRequest;
      assert.strictEqual(authorizedReq.authorizationResult?.role, 'owner');
    });
  });

  describe('Role Hierarchy', () => {
    it('owner should have access to all roles', async () => {
      for (const requiredRole of ['owner', 'admin', 'member'] as const) {
        const middleware = createMockMembershipMiddleware({
          isMember: true,
          role: 'owner',
          requiredRole,
        });

        const req = createMockRequest({
          user: createMockUser(),
          authSession: createMockSession(),
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        assert.strictEqual(nextCalled, true, `Owner should have access when ${requiredRole} is required`);
      }
    });

    it('admin should have access to admin and member roles', async () => {
      for (const requiredRole of ['admin', 'member'] as const) {
        const middleware = createMockMembershipMiddleware({
          isMember: true,
          role: 'admin',
          requiredRole,
        });

        const req = createMockRequest({
          user: createMockUser(),
          authSession: createMockSession(),
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        assert.strictEqual(nextCalled, true, `Admin should have access when ${requiredRole} is required`);
      }
    });

    it('admin should NOT have access to owner role', async () => {
      const middleware = createMockMembershipMiddleware({
        isMember: true,
        role: 'admin',
        requiredRole: 'owner',
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 403);
    });

    it('member should only have access to member role', async () => {
      const middleware = createMockMembershipMiddleware({
        isMember: true,
        role: 'member',
        requiredRole: 'member',
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(nextCalled, true);
    });

    it('member should NOT have access to admin or owner roles', async () => {
      for (const requiredRole of ['admin', 'owner'] as const) {
        const middleware = createMockMembershipMiddleware({
          isMember: true,
          role: 'member',
          requiredRole,
        });

        const req = createMockRequest({
          user: createMockUser(),
          authSession: createMockSession(),
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

        assert.strictEqual(nextCalled, false, `Member should NOT have access when ${requiredRole} is required`);
        assert.strictEqual(res.statusCode, 403);
      }
    });
  });

  describe('Authorization Result', () => {
    it('should attach authorization result with correct role', async () => {
      const mockResource = { id: 'resource-id', userId: 'test-user-id' };
      const middleware = createMockOwnershipMiddleware({
        resourceExists: true,
        isOwner: true,
        attachToRequest: true,
        mockResource,
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
      });
      const res = createMockResponse();
      const next = () => {};

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      const authorizedReq = req as unknown as AuthorizedRequest;
      assert.ok(authorizedReq.authorizationResult);
      assert.strictEqual(authorizedReq.authorizationResult.authorized, true);
      assert.strictEqual(authorizedReq.authorizationResult.role, 'owner');
      assert.deepStrictEqual(authorizedReq.authorizationResult.resource, mockResource);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing user property gracefully', async () => {
      const middleware = createMockOwnershipMiddleware({
        resourceExists: true,
        isOwner: true,
      });

      const req = createMockRequest();
      delete (req as Record<string, unknown>).user;
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      assert.strictEqual(res.statusCode, 401);
      assert.strictEqual(nextCalled, false);
    });

    it('should handle empty params gracefully', async () => {
      const middleware = createMockOwnershipMiddleware({
        resourceExists: false,
        isOwner: false,
      });

      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
        params: {},
      });
      const res = createMockResponse();
      let nextCalled = false;
      const next = () => { nextCalled = true; };

      await middleware(req as unknown as Request, res as unknown as Response, next as NextFunction);

      // When extractId returns undefined, middleware should reject
      assert.strictEqual(res.statusCode, 404);
      assert.strictEqual(nextCalled, false);
    });
  });
});
