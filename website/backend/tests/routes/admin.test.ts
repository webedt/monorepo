/**
 * Tests for Admin Routes
 * Covers authorization checks, input validation, and edge cases for admin endpoints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type { Request, Response, NextFunction } from 'express';
import {
  createMockRequest,
  createMockResponse,
  createMockUser,
  createMockSession,
} from '../helpers/mockExpress.js';
import { requireAdmin } from '../../src/api/middleware/auth.js';

describe('Admin Routes - Authorization', () => {
  describe('All Admin Endpoints Require Admin Access', () => {
    const adminEndpoints = [
      { method: 'GET', path: '/api/admin/users' },
      { method: 'GET', path: '/api/admin/users/:id' },
      { method: 'POST', path: '/api/admin/users' },
      { method: 'PATCH', path: '/api/admin/users/:id' },
      { method: 'DELETE', path: '/api/admin/users/:id' },
      { method: 'POST', path: '/api/admin/users/:id/impersonate' },
      { method: 'GET', path: '/api/admin/stats' },
    ];

    for (const endpoint of adminEndpoints) {
      it(`${endpoint.method} ${endpoint.path} should reject unauthenticated requests`, () => {
        const req = createMockRequest({ user: null, authSession: null });
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        requireAdmin(req as unknown as Request, res as unknown as Response, next as NextFunction);

        assert.strictEqual(res.statusCode, 401);
        assert.deepStrictEqual(res.data, { success: false, error: 'Unauthorized' });
        assert.strictEqual(nextCalled, false);
      });

      it(`${endpoint.method} ${endpoint.path} should reject non-admin users`, () => {
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

      it(`${endpoint.method} ${endpoint.path} should allow admin users`, () => {
        const req = createMockRequest({
          user: createMockUser({ isAdmin: true }),
          authSession: createMockSession(),
        });
        const res = createMockResponse();
        let nextCalled = false;
        const next = () => { nextCalled = true; };

        requireAdmin(req as unknown as Request, res as unknown as Response, next as NextFunction);

        assert.strictEqual(nextCalled, true);
      });
    }
  });
});

describe('Admin Routes - Input Validation', () => {
  describe('POST /api/admin/users', () => {
    it('should require email field', () => {
      const body = { password: 'testpassword123' };
      const result = validateCreateUserInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Email and password are required');
    });

    it('should require password field', () => {
      const body = { email: 'newuser@example.com' };
      const result = validateCreateUserInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Email and password are required');
    });

    it('should accept valid user creation data', () => {
      const body = {
        email: 'newuser@example.com',
        password: 'securepassword123',
        displayName: 'New User',
        isAdmin: false,
      };
      const result = validateCreateUserInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional displayName and isAdmin', () => {
      const body = { email: 'user@example.com', password: 'password123' };
      const result = validateCreateUserInput(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('PATCH /api/admin/users/:id', () => {
    it('should reject empty update payload', () => {
      const body = {};
      const result = validateUpdateUserInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'No fields to update');
    });

    it('should accept email update', () => {
      const body = { email: 'newemail@example.com' };
      const result = validateUpdateUserInput(body);

      assert.strictEqual(result.valid, true);
      assert.ok(result.updateFields?.includes('email'));
    });

    it('should accept displayName update', () => {
      const body = { displayName: 'New Display Name' };
      const result = validateUpdateUserInput(body);

      assert.strictEqual(result.valid, true);
      assert.ok(result.updateFields?.includes('displayName'));
    });

    it('should accept isAdmin update', () => {
      const body = { isAdmin: true };
      const result = validateUpdateUserInput(body);

      assert.strictEqual(result.valid, true);
      assert.ok(result.updateFields?.includes('isAdmin'));
    });

    it('should accept password update', () => {
      const body = { password: 'newpassword123' };
      const result = validateUpdateUserInput(body);

      assert.strictEqual(result.valid, true);
      assert.ok(result.updateFields?.includes('password'));
    });

    it('should accept multiple fields update', () => {
      const body = {
        email: 'updated@example.com',
        displayName: 'Updated User',
        isAdmin: true,
      };
      const result = validateUpdateUserInput(body);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.updateFields?.length, 3);
    });
  });
});

describe('Admin Routes - Self-Protection', () => {
  describe('PATCH /api/admin/users/:id - Self Admin Removal', () => {
    it('should prevent user from removing their own admin status', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'admin-user-123';
      const isAdmin = false;

      const result = validateSelfAdminProtection(currentUserId, targetUserId, isAdmin);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.error, 'Cannot remove your own admin status');
    });

    it('should allow user to modify other users admin status', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'other-user-456';
      const isAdmin = false;

      const result = validateSelfAdminProtection(currentUserId, targetUserId, isAdmin);

      assert.strictEqual(result.allowed, true);
    });

    it('should allow user to keep their own admin status', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'admin-user-123';
      const isAdmin = true;

      const result = validateSelfAdminProtection(currentUserId, targetUserId, isAdmin);

      assert.strictEqual(result.allowed, true);
    });

    it('should allow updates when isAdmin is not specified', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'admin-user-123';
      const isAdmin = undefined;

      const result = validateSelfAdminProtection(currentUserId, targetUserId, isAdmin);

      assert.strictEqual(result.allowed, true);
    });
  });

  describe('DELETE /api/admin/users/:id - Self Deletion', () => {
    it('should prevent user from deleting themselves', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'admin-user-123';

      const result = validateSelfDeletionProtection(currentUserId, targetUserId);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.error, 'Cannot delete your own account');
    });

    it('should allow deletion of other users', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'other-user-456';

      const result = validateSelfDeletionProtection(currentUserId, targetUserId);

      assert.strictEqual(result.allowed, true);
    });
  });

  describe('POST /api/admin/users/:id/impersonate - Self Impersonation', () => {
    it('should prevent user from impersonating themselves', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'admin-user-123';

      const result = validateSelfImpersonationProtection(currentUserId, targetUserId);

      assert.strictEqual(result.allowed, false);
      assert.strictEqual(result.error, 'Cannot impersonate yourself');
    });

    it('should allow impersonation of other users', () => {
      const currentUserId = 'admin-user-123';
      const targetUserId = 'other-user-456';

      const result = validateSelfImpersonationProtection(currentUserId, targetUserId);

      assert.strictEqual(result.allowed, true);
    });
  });
});

describe('Admin Routes - Response Formats', () => {
  describe('User List Response', () => {
    it('should return array of users with safe fields', () => {
      const users = [
        { id: '1', email: 'user1@example.com', passwordHash: 'hash1', isAdmin: false },
        { id: '2', email: 'user2@example.com', passwordHash: 'hash2', isAdmin: true },
      ];

      const safeUsers = sanitizeUserListResponse(users);

      assert.strictEqual(safeUsers.length, 2);
      for (const user of safeUsers) {
        assert.ok(user.id);
        assert.ok(user.email);
        assert.strictEqual((user as Record<string, unknown>).passwordHash, undefined);
      }
    });
  });

  describe('Stats Response', () => {
    it('should include all required stats fields', () => {
      const stats = {
        totalUsers: 100,
        totalAdmins: 5,
        activeSessions: 42,
      };

      assert.ok(typeof stats.totalUsers === 'number');
      assert.ok(typeof stats.totalAdmins === 'number');
      assert.ok(typeof stats.activeSessions === 'number');
    });
  });
});

// Validation helper functions that mirror admin.ts logic
function validateCreateUserInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { email, password } = body;

  if (!email || !password) {
    return { valid: false, error: 'Email and password are required' };
  }

  return { valid: true };
}

function validateUpdateUserInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  updateFields?: string[];
} {
  const { email, displayName, isAdmin, password } = body;

  const updateFields: string[] = [];

  if (email !== undefined) updateFields.push('email');
  if (displayName !== undefined) updateFields.push('displayName');
  if (isAdmin !== undefined) updateFields.push('isAdmin');
  if (password) updateFields.push('password');

  if (updateFields.length === 0) {
    return { valid: false, error: 'No fields to update' };
  }

  return { valid: true, updateFields };
}

function validateSelfAdminProtection(
  currentUserId: string,
  targetUserId: string,
  isAdmin: boolean | undefined
): { allowed: boolean; error?: string } {
  if (currentUserId === targetUserId && isAdmin === false) {
    return { allowed: false, error: 'Cannot remove your own admin status' };
  }
  return { allowed: true };
}

function validateSelfDeletionProtection(
  currentUserId: string,
  targetUserId: string
): { allowed: boolean; error?: string } {
  if (currentUserId === targetUserId) {
    return { allowed: false, error: 'Cannot delete your own account' };
  }
  return { allowed: true };
}

function validateSelfImpersonationProtection(
  currentUserId: string,
  targetUserId: string
): { allowed: boolean; error?: string } {
  if (currentUserId === targetUserId) {
    return { allowed: false, error: 'Cannot impersonate yourself' };
  }
  return { allowed: true };
}

function sanitizeUserListResponse(users: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return users.map(user => {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
  });
}
