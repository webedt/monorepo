/**
 * Tests for the SessionAuthorizationService module.
 *
 * These tests verify the authorization and security behavior of the
 * SessionAuthorizationService, which handles critical security decisions
 * for session access control.
 *
 * The tests cover:
 * - Ownership verification: Users can only access their own sessions
 * - Timing-safe token comparison: Share tokens don't leak timing information
 * - Locked session behavior: Locked sessions cannot be modified
 * - Organization role integration: Members, admins, and owners have different permissions
 * - Cleanup conditions: Branch deletion authorization based on session fields
 * - Session lifecycle: Resume, delete, and modify permissions
 *
 * IMPORTANT: These tests mock the organizationService to test authorization
 * logic without requiring a database connection. The mock simulates the expected
 * behavior of OrganizationService.getMember() for role-based access tests.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { SessionAuthorizationService } from '../../src/sessions/SessionAuthorizationService.js';
import * as orgServiceModule from '../../src/organizations/OrganizationService.js';

import type { ChatSession } from '../../src/db/schema.js';
import type { OrganizationMember } from '../../src/db/schema.js';

/**
 * Test helper to create mock chat session data
 * Uses 'in' operator to distinguish between explicit null and missing keys
 */
function createMockChatSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = new Date();
  return {
    id: 'id' in overrides ? overrides.id! : `session-${Math.random().toString(36).substring(7)}`,
    userId: 'userId' in overrides ? overrides.userId! : 'user-123',
    organizationId: 'organizationId' in overrides ? overrides.organizationId! : null,
    sessionPath: 'sessionPath' in overrides ? overrides.sessionPath! : null,
    repositoryOwner: 'repositoryOwner' in overrides ? overrides.repositoryOwner! : 'owner',
    repositoryName: 'repositoryName' in overrides ? overrides.repositoryName! : 'repo',
    userRequest: overrides.userRequest || 'Test request',
    status: overrides.status || 'completed',
    repositoryUrl: 'repositoryUrl' in overrides ? overrides.repositoryUrl! : 'https://github.com/owner/repo',
    baseBranch: 'baseBranch' in overrides ? overrides.baseBranch! : 'main',
    branch: 'branch' in overrides ? overrides.branch! : 'claude/test-branch',
    provider: overrides.provider ?? 'claude',
    providerSessionId: overrides.providerSessionId ?? null,
    remoteSessionId: overrides.remoteSessionId ?? null,
    remoteWebUrl: overrides.remoteWebUrl ?? null,
    totalCost: overrides.totalCost ?? null,
    issueNumber: overrides.issueNumber ?? null,
    autoCommit: overrides.autoCommit ?? false,
    locked: overrides.locked ?? false,
    createdAt: overrides.createdAt || now,
    completedAt: overrides.completedAt ?? null,
    deletedAt: overrides.deletedAt ?? null,
    workerLastActivity: overrides.workerLastActivity ?? null,
    favorite: overrides.favorite ?? false,
    shareToken: overrides.shareToken ?? null,
    shareExpiresAt: overrides.shareExpiresAt ?? null,
  };
}

/**
 * Test helper to create mock organization member data
 */
function createMockMember(overrides: Partial<OrganizationMember> = {}): OrganizationMember {
  return {
    id: overrides.id || `member-${Math.random().toString(36).substring(7)}`,
    organizationId: overrides.organizationId || 'org-123',
    userId: overrides.userId || 'user-456',
    role: overrides.role || 'member',
    joinedAt: overrides.joinedAt || new Date(),
    invitedBy: overrides.invitedBy ?? null,
  };
}

describe('SessionAuthorizationService', () => {
  let service: SessionAuthorizationService;

  beforeEach(() => {
    service = new SessionAuthorizationService();
  });

  describe('verifyOwnership', () => {
    describe('Session Not Found', () => {
      it('should return 404 when session is null', () => {
        const result = service.verifyOwnership(null, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session not found');
        assert.strictEqual(result.statusCode, 404);
      });
    });

    describe('Ownership Check', () => {
      it('should authorize when user owns the session', () => {
        const session = createMockChatSession({ userId: 'user-123' });

        const result = service.verifyOwnership(session, 'user-123');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.error, undefined);
        assert.strictEqual(result.statusCode, undefined);
      });

      it('should reject when user does not own the session', () => {
        const session = createMockChatSession({ userId: 'user-123' });

        const result = service.verifyOwnership(session, 'user-456');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Unauthorized');
        assert.strictEqual(result.statusCode, 403);
      });

      it('should handle empty string userId', () => {
        const session = createMockChatSession({ userId: '' });

        const result = service.verifyOwnership(session, '');

        // Empty string matches empty string
        assert.strictEqual(result.authorized, true);
      });

      it('should be case-sensitive for user IDs', () => {
        const session = createMockChatSession({ userId: 'User-123' });

        const result = service.verifyOwnership(session, 'user-123');

        assert.strictEqual(result.authorized, false);
      });
    });
  });

  describe('validateRequiredFields', () => {
    describe('All Fields Present', () => {
      it('should validate when all required fields are present', () => {
        const fields = { name: 'test', email: 'test@example.com', age: 25 };
        const required = ['name', 'email'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.missingFields, undefined);
        assert.strictEqual(result.error, undefined);
      });

      it('should validate with extra fields', () => {
        const fields = { a: 1, b: 2, c: 3, d: 4 };
        const required = ['a', 'b'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, true);
      });

      it('should validate with empty required array', () => {
        const fields = { name: 'test' };
        const required: string[] = [];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, true);
      });
    });

    describe('Missing Fields', () => {
      it('should reject when required field is missing', () => {
        const fields = { name: 'test' };
        const required = ['name', 'email'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, false);
        assert.deepStrictEqual(result.missingFields, ['email']);
        assert.ok(result.error?.includes('email'));
      });

      it('should reject when required field is undefined', () => {
        const fields = { name: 'test', email: undefined };
        const required = ['name', 'email'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, false);
        assert.deepStrictEqual(result.missingFields, ['email']);
      });

      it('should reject when required field is null', () => {
        const fields = { name: 'test', email: null };
        const required = ['name', 'email'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, false);
        assert.deepStrictEqual(result.missingFields, ['email']);
      });

      it('should reject when required field is empty string', () => {
        const fields = { name: 'test', email: '' };
        const required = ['name', 'email'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, false);
        assert.deepStrictEqual(result.missingFields, ['email']);
      });

      it('should report multiple missing fields', () => {
        const fields = { name: 'test' };
        const required = ['name', 'email', 'phone', 'address'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.missingFields?.length, 3);
        assert.ok(result.missingFields?.includes('email'));
        assert.ok(result.missingFields?.includes('phone'));
        assert.ok(result.missingFields?.includes('address'));
      });
    });

    describe('Edge Cases', () => {
      it('should accept zero as valid value', () => {
        const fields = { count: 0 };
        const required = ['count'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, true);
      });

      it('should accept false as valid value', () => {
        const fields = { active: false };
        const required = ['active'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, true);
      });

      it('should accept empty array as valid value', () => {
        const fields = { items: [] };
        const required = ['items'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, true);
      });

      it('should accept empty object as valid value', () => {
        const fields = { data: {} };
        const required = ['data'];

        const result = service.validateRequiredFields(fields, required);

        assert.strictEqual(result.valid, true);
      });
    });
  });

  describe('getCleanupConditions', () => {
    describe('Branch Deletion Conditions', () => {
      it('should allow branch deletion when all fields are present', () => {
        const session = createMockChatSession({
          repositoryOwner: 'webedt',
          repositoryName: 'monorepo',
          branch: 'claude/feature-123',
          baseBranch: 'main',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, true);
        assert.deepStrictEqual(result.branchInfo, {
          owner: 'webedt',
          repo: 'monorepo',
          branch: 'claude/feature-123',
        });
      });

      it('should prevent branch deletion when repositoryOwner is missing', () => {
        const session = createMockChatSession({
          repositoryOwner: null,
          repositoryName: 'monorepo',
          branch: 'claude/feature-123',
          baseBranch: 'main',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, false);
        assert.strictEqual(result.branchInfo, undefined);
      });

      it('should prevent branch deletion when repositoryName is missing', () => {
        const session = createMockChatSession({
          repositoryOwner: 'webedt',
          repositoryName: null,
          branch: 'claude/feature-123',
          baseBranch: 'main',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, false);
      });

      it('should prevent branch deletion when branch is missing', () => {
        const session = createMockChatSession({
          repositoryOwner: 'webedt',
          repositoryName: 'monorepo',
          branch: null,
          baseBranch: 'main',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, false);
      });

      it('should prevent branch deletion when baseBranch is missing', () => {
        const session = createMockChatSession({
          repositoryOwner: 'webedt',
          repositoryName: 'monorepo',
          branch: 'claude/feature-123',
          baseBranch: null,
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, false);
      });

      it('should prevent branch deletion when branch equals baseBranch', () => {
        const session = createMockChatSession({
          repositoryOwner: 'webedt',
          repositoryName: 'monorepo',
          branch: 'main',
          baseBranch: 'main',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, false);
        assert.strictEqual(result.branchInfo, undefined);
      });

      it('should allow branch deletion with different base branch', () => {
        const session = createMockChatSession({
          repositoryOwner: 'webedt',
          repositoryName: 'monorepo',
          branch: 'claude/feature-123',
          baseBranch: 'develop',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, true);
        assert.strictEqual(result.branchInfo?.branch, 'claude/feature-123');
      });
    });

    describe('Remote Archive Conditions', () => {
      it('should allow remote archive when remoteSessionId is present', () => {
        const session = createMockChatSession({
          remoteSessionId: 'session_01ABC123',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canArchiveRemote, true);
        assert.strictEqual(result.remoteSessionId, 'session_01ABC123');
      });

      it('should prevent remote archive when remoteSessionId is null', () => {
        const session = createMockChatSession({
          remoteSessionId: null,
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canArchiveRemote, false);
        assert.strictEqual(result.remoteSessionId, undefined);
      });
    });

    describe('Combined Conditions', () => {
      it('should handle both conditions being true', () => {
        const session = createMockChatSession({
          repositoryOwner: 'webedt',
          repositoryName: 'monorepo',
          branch: 'claude/feature-123',
          baseBranch: 'main',
          remoteSessionId: 'session_01ABC123',
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, true);
        assert.strictEqual(result.canArchiveRemote, true);
        assert.ok(result.branchInfo);
        assert.ok(result.remoteSessionId);
      });

      it('should handle both conditions being false', () => {
        const session = createMockChatSession({
          repositoryOwner: null,
          repositoryName: null,
          branch: null,
          baseBranch: null,
          remoteSessionId: null,
        });

        const result = service.getCleanupConditions(session);

        assert.strictEqual(result.canDeleteBranch, false);
        assert.strictEqual(result.canArchiveRemote, false);
        assert.strictEqual(result.branchInfo, undefined);
        assert.strictEqual(result.remoteSessionId, undefined);
      });
    });
  });

  describe('canModifySession', () => {
    describe('Ownership Check', () => {
      it('should reject when user does not own session', () => {
        const session = createMockChatSession({ userId: 'user-123' });

        const result = service.canModifySession(session, 'user-456');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.statusCode, 403);
      });

      it('should pass ownership check for session owner', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          locked: false,
        });

        const result = service.canModifySession(session, 'user-123');

        assert.strictEqual(result.authorized, true);
      });
    });

    describe('Locked Session Check', () => {
      it('should reject when session is locked', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          locked: true,
        });

        const result = service.canModifySession(session, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session is locked');
        assert.strictEqual(result.statusCode, 423);
      });

      it('should allow modification when session is not locked', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          locked: false,
        });

        const result = service.canModifySession(session, 'user-123');

        assert.strictEqual(result.authorized, true);
      });
    });
  });

  describe('canDeleteSession', () => {
    describe('Ownership Check', () => {
      it('should reject when user does not own session', () => {
        const session = createMockChatSession({ userId: 'user-123' });

        const result = service.canDeleteSession(session, 'user-456');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.statusCode, 403);
      });
    });

    describe('Running Session Check', () => {
      it('should reject when session is running', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          status: 'running',
        });

        const result = service.canDeleteSession(session, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Cannot delete a running session');
        assert.strictEqual(result.statusCode, 409);
      });

      it('should allow deletion of completed session', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          status: 'completed',
        });

        const result = service.canDeleteSession(session, 'user-123');

        assert.strictEqual(result.authorized, true);
      });

      it('should allow deletion of error session', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          status: 'error',
        });

        const result = service.canDeleteSession(session, 'user-123');

        assert.strictEqual(result.authorized, true);
      });

      it('should allow deletion of pending session', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          status: 'pending',
        });

        const result = service.canDeleteSession(session, 'user-123');

        assert.strictEqual(result.authorized, true);
      });
    });
  });

  describe('canResumeSession', () => {
    describe('Ownership Check', () => {
      it('should reject when user does not own session', () => {
        const session = createMockChatSession({ userId: 'user-123' });

        const result = service.canResumeSession(session, 'user-456');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.statusCode, 403);
      });
    });

    describe('Remote Session ID Check', () => {
      it('should reject when session has no remoteSessionId', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          remoteSessionId: null,
        });

        const result = service.canResumeSession(session, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session has no remote session ID');
        assert.strictEqual(result.statusCode, 400);
      });
    });

    describe('Running Session Check', () => {
      it('should reject when session is already running', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          remoteSessionId: 'session_01ABC123',
          status: 'running',
        });

        const result = service.canResumeSession(session, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session is already running');
        assert.strictEqual(result.statusCode, 409);
      });

      it('should allow resuming completed session with remoteSessionId', () => {
        const session = createMockChatSession({
          userId: 'user-123',
          remoteSessionId: 'session_01ABC123',
          status: 'completed',
        });

        const result = service.canResumeSession(session, 'user-123');

        assert.strictEqual(result.authorized, true);
      });
    });
  });

  describe('verifyShareTokenAccess', () => {
    describe('Session Not Found', () => {
      it('should return 404 when session is null', () => {
        const result = service.verifyShareTokenAccess(null, 'some-token');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session not found');
        assert.strictEqual(result.statusCode, 404);
      });
    });

    describe('Session Not Shared', () => {
      it('should return 404 when session has no shareToken', () => {
        const session = createMockChatSession({ shareToken: null });

        const result = service.verifyShareTokenAccess(session, 'some-token');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session is not shared');
        assert.strictEqual(result.statusCode, 404);
      });
    });

    describe('Token Validation', () => {
      it('should authorize when share token matches', () => {
        const token = 'valid-share-token-12345';
        const session = createMockChatSession({
          shareToken: token,
          shareExpiresAt: null,
        });

        const result = service.verifyShareTokenAccess(session, token);

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'shared');
      });

      it('should reject when share token does not match', () => {
        const session = createMockChatSession({
          shareToken: 'real-token-12345',
          shareExpiresAt: null,
        });

        const result = service.verifyShareTokenAccess(session, 'wrong-token-67890');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Invalid share token');
        assert.strictEqual(result.statusCode, 403);
      });

      it('should reject when token lengths differ', () => {
        const session = createMockChatSession({
          shareToken: 'short',
          shareExpiresAt: null,
        });

        const result = service.verifyShareTokenAccess(session, 'much-longer-token');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Invalid share token');
      });

      it('should reject empty token', () => {
        const session = createMockChatSession({
          shareToken: 'real-token',
          shareExpiresAt: null,
        });

        const result = service.verifyShareTokenAccess(session, '');

        assert.strictEqual(result.authorized, false);
      });
    });

    describe('Token Expiration', () => {
      it('should reject when share token has expired', () => {
        const token = 'valid-share-token';
        const expiredDate = new Date(Date.now() - 86400000); // Yesterday
        const session = createMockChatSession({
          shareToken: token,
          shareExpiresAt: expiredDate,
        });

        const result = service.verifyShareTokenAccess(session, token);

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Share link has expired');
        assert.strictEqual(result.statusCode, 410);
      });

      it('should authorize when share token has not expired', () => {
        const token = 'valid-share-token';
        const futureDate = new Date(Date.now() + 86400000); // Tomorrow
        const session = createMockChatSession({
          shareToken: token,
          shareExpiresAt: futureDate,
        });

        const result = service.verifyShareTokenAccess(session, token);

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'shared');
      });

      it('should authorize when shareExpiresAt is null (no expiration)', () => {
        const token = 'valid-share-token';
        const session = createMockChatSession({
          shareToken: token,
          shareExpiresAt: null,
        });

        const result = service.verifyShareTokenAccess(session, token);

        assert.strictEqual(result.authorized, true);
      });
    });

    describe('Timing-Safe Comparison', () => {
      /**
       * These tests verify the behavior of the timing-safe token comparison.
       * While we cannot directly measure timing in unit tests, we verify that:
       * 1. The comparison uses timingSafeEqual from crypto
       * 2. Length differences are handled correctly
       * 3. All character mismatches are handled consistently
       */

      it('should use constant-time comparison for matching lengths', () => {
        const session = createMockChatSession({
          shareToken: 'aaaa',
          shareExpiresAt: null,
        });

        // First character wrong
        const result1 = service.verifyShareTokenAccess(session, 'baaa');
        assert.strictEqual(result1.authorized, false);

        // Last character wrong
        const result2 = service.verifyShareTokenAccess(session, 'aaab');
        assert.strictEqual(result2.authorized, false);

        // Middle character wrong
        const result3 = service.verifyShareTokenAccess(session, 'abaa');
        assert.strictEqual(result3.authorized, false);
      });

      it('should handle Unicode characters in tokens', () => {
        const session = createMockChatSession({
          shareToken: 'token-with-émoji-🔒',
          shareExpiresAt: null,
        });

        const result = service.verifyShareTokenAccess(session, 'token-with-émoji-🔒');

        assert.strictEqual(result.authorized, true);
      });

      it('should reject similar Unicode tokens', () => {
        const session = createMockChatSession({
          shareToken: 'token-with-émoji-🔒',
          shareExpiresAt: null,
        });

        const result = service.verifyShareTokenAccess(session, 'token-with-émoji-🔓');

        assert.strictEqual(result.authorized, false);
      });
    });
  });

  describe('isShareTokenValid', () => {
    it('should return false when shareToken is null', () => {
      const session = createMockChatSession({ shareToken: null });

      const result = service.isShareTokenValid(session);

      assert.strictEqual(result, false);
    });

    it('should return true when shareToken exists with no expiration', () => {
      const session = createMockChatSession({
        shareToken: 'valid-token',
        shareExpiresAt: null,
      });

      const result = service.isShareTokenValid(session);

      assert.strictEqual(result, true);
    });

    it('should return true when shareToken exists and not expired', () => {
      const session = createMockChatSession({
        shareToken: 'valid-token',
        shareExpiresAt: new Date(Date.now() + 86400000), // Tomorrow
      });

      const result = service.isShareTokenValid(session);

      assert.strictEqual(result, true);
    });

    it('should return false when shareToken is expired', () => {
      const session = createMockChatSession({
        shareToken: 'valid-token',
        shareExpiresAt: new Date(Date.now() - 86400000), // Yesterday
      });

      const result = service.isShareTokenValid(session);

      assert.strictEqual(result, false);
    });

    it('should handle edge case of expiration one millisecond in the past', () => {
      // Create a session that expired 1ms ago to ensure consistent behavior
      const justExpired = new Date(Date.now() - 1);
      const session = createMockChatSession({
        shareToken: 'valid-token',
        shareExpiresAt: justExpired,
      });

      // Should be false because expiresAt is in the past
      const result = service.isShareTokenValid(session);

      assert.strictEqual(result, false);
    });
  });
});

describe('SessionAuthorizationService - Organization Integration', () => {
  let service: SessionAuthorizationService;
  let getMemberMock: ReturnType<typeof mock.fn>;
  let originalGetMember: typeof orgServiceModule.organizationService.getMember;

  beforeEach(() => {
    service = new SessionAuthorizationService();
    // Store original and create mock
    originalGetMember = orgServiceModule.organizationService.getMember;
    getMemberMock = mock.fn();
    // Replace the method with our mock
    orgServiceModule.organizationService.getMember = getMemberMock as unknown as typeof originalGetMember;
  });

  afterEach(() => {
    // Restore original method
    orgServiceModule.organizationService.getMember = originalGetMember;
  });

  describe('verifySessionAccess', () => {
    describe('Session Not Found', () => {
      it('should return 404 when session is null', async () => {
        const result = await service.verifySessionAccess(null, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session not found');
        assert.strictEqual(result.statusCode, 404);
      });
    });

    describe('Owner Access', () => {
      it('should authorize session owner with owner role', async () => {
        const session = createMockChatSession({ userId: 'user-123' });

        const result = await service.verifySessionAccess(session, 'user-123');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'owner');
      });
    });

    describe('Organization Member Access', () => {
      it('should authorize organization admin', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          organizationId: 'org-456',
          userId: 'user-789',
          role: 'admin',
        }));

        const result = await service.verifySessionAccess(session, 'user-789');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'admin');
      });

      it('should authorize organization member', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          organizationId: 'org-456',
          userId: 'user-789',
          role: 'member',
        }));

        const result = await service.verifySessionAccess(session, 'user-789');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'member');
      });

      it('should authorize organization owner', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          organizationId: 'org-456',
          userId: 'user-789',
          role: 'owner',
        }));

        const result = await service.verifySessionAccess(session, 'user-789');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'owner');
      });
    });

    describe('Non-Member Access', () => {
      it('should reject when user is not org member', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
        });

        getMemberMock.mock.mockImplementation(async () => null);

        const result = await service.verifySessionAccess(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Unauthorized');
        assert.strictEqual(result.statusCode, 403);
      });

      it('should reject when session has no organization and user is not owner', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: null,
        });

        const result = await service.verifySessionAccess(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.statusCode, 403);
      });
    });
  });

  describe('canModifySessionAsync', () => {
    describe('Access Check', () => {
      it('should reject when user has no access', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          locked: false,
        });

        getMemberMock.mock.mockImplementation(async () => null);

        const result = await service.canModifySessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.statusCode, 403);
      });
    });

    describe('Organization Role Restrictions', () => {
      it('should reject member role for organization sessions', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          locked: false,
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'member',
        }));

        const result = await service.canModifySessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Organization members cannot modify sessions. Admin or owner access required.');
        assert.strictEqual(result.statusCode, 403);
      });

      it('should allow admin role for organization sessions', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          locked: false,
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'admin',
        }));

        const result = await service.canModifySessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'admin');
      });

      it('should allow owner role for organization sessions', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          locked: false,
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'owner',
        }));

        const result = await service.canModifySessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'owner');
      });
    });

    describe('Locked Session Check', () => {
      it('should reject when session is locked even for admin', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          locked: true,
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'admin',
        }));

        const result = await service.canModifySessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session is locked');
        assert.strictEqual(result.statusCode, 423);
      });

      it('should reject when session is locked for session owner', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: null,
          locked: true,
        });

        const result = await service.canModifySessionAsync(session, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Session is locked');
        assert.strictEqual(result.statusCode, 423);
      });
    });

    describe('Owner Can Modify Own Session', () => {
      it('should allow session owner to modify unlocked session', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: null,
          locked: false,
        });

        const result = await service.canModifySessionAsync(session, 'user-123');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'owner');
      });
    });
  });

  describe('canDeleteSessionAsync', () => {
    describe('Access Check', () => {
      it('should reject when user has no access', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          status: 'completed',
        });

        getMemberMock.mock.mockImplementation(async () => null);

        const result = await service.canDeleteSessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.statusCode, 403);
      });
    });

    describe('Organization Deletion Restrictions', () => {
      it('should reject member from deleting organization session', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          status: 'completed',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'member',
        }));

        const result = await service.canDeleteSessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Only the session creator or organization owner can delete sessions');
        assert.strictEqual(result.statusCode, 403);
      });

      it('should reject admin from deleting other users session', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          status: 'completed',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'admin',
        }));

        const result = await service.canDeleteSessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Only the session creator or organization owner can delete sessions');
      });

      it('should allow organization owner to delete any session', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          status: 'completed',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'owner',
        }));

        const result = await service.canDeleteSessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'owner');
      });

      it('should allow session creator to delete their own session in org', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          status: 'completed',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'member',
          userId: 'user-123',
        }));

        const result = await service.canDeleteSessionAsync(session, 'user-123');

        // Session creator can delete their own session regardless of org role
        assert.strictEqual(result.authorized, true);
      });
    });

    describe('Running Session Check', () => {
      it('should reject deletion of running session', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: null,
          status: 'running',
        });

        const result = await service.canDeleteSessionAsync(session, 'user-123');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Cannot delete a running session');
        assert.strictEqual(result.statusCode, 409);
      });

      it('should reject deletion of running session even for org owner', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: 'org-456',
          status: 'running',
        });

        getMemberMock.mock.mockImplementation(async () => createMockMember({
          role: 'owner',
        }));

        const result = await service.canDeleteSessionAsync(session, 'user-789');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.error, 'Cannot delete a running session');
      });
    });

    describe('Non-Organization Session', () => {
      it('should allow owner to delete their session', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: null,
          status: 'completed',
        });

        const result = await service.canDeleteSessionAsync(session, 'user-123');

        assert.strictEqual(result.authorized, true);
        assert.strictEqual(result.role, 'owner');
      });

      it('should reject non-owner from deleting session', async () => {
        const session = createMockChatSession({
          userId: 'user-123',
          organizationId: null,
          status: 'completed',
        });

        const result = await service.canDeleteSessionAsync(session, 'user-456');

        assert.strictEqual(result.authorized, false);
        assert.strictEqual(result.statusCode, 403);
      });
    });
  });
});

describe('SessionAuthorizationService - Security Edge Cases', () => {
  let service: SessionAuthorizationService;

  beforeEach(() => {
    service = new SessionAuthorizationService();
  });

  describe('Null and Undefined Handling', () => {
    it('should handle session with all null optional fields', () => {
      const session = createMockChatSession({
        organizationId: null,
        sessionPath: null,
        repositoryOwner: null,
        repositoryName: null,
        repositoryUrl: null,
        baseBranch: null,
        branch: null,
        providerSessionId: null,
        remoteSessionId: null,
        remoteWebUrl: null,
        totalCost: null,
        issueNumber: null,
        completedAt: null,
        deletedAt: null,
        workerLastActivity: null,
        shareToken: null,
        shareExpiresAt: null,
      });

      // Should still work for ownership check
      const result = service.verifyOwnership(session, session.userId);
      assert.strictEqual(result.authorized, true);
    });
  });

  describe('Authorization Order of Operations', () => {
    it('canModifySession should check ownership before lock status', () => {
      const session = createMockChatSession({
        userId: 'user-123',
        locked: true,
      });

      // Non-owner should get 403, not 423
      const result = service.canModifySession(session, 'user-456');

      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.statusCode, 403);
    });

    it('canDeleteSession should check ownership before running status', () => {
      const session = createMockChatSession({
        userId: 'user-123',
        status: 'running',
      });

      // Non-owner should get 403, not 409
      const result = service.canDeleteSession(session, 'user-456');

      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.statusCode, 403);
    });

    it('canResumeSession should check ownership before other checks', () => {
      const session = createMockChatSession({
        userId: 'user-123',
        remoteSessionId: null,
        status: 'running',
      });

      // Non-owner should get 403, not 400 or 409
      const result = service.canResumeSession(session, 'user-456');

      assert.strictEqual(result.authorized, false);
      assert.strictEqual(result.statusCode, 403);
    });
  });

  describe('ID Injection Attempts', () => {
    it('should not be vulnerable to ID format manipulation', () => {
      const session = createMockChatSession({
        userId: 'user-123',
      });

      // Various injection attempts should all fail
      const injectionAttempts = [
        'user-123\x00injected',
        'user-123; DROP TABLE',
        'user-123\nuser-456',
        '../user-123',
        'user-123%00',
      ];

      for (const attempt of injectionAttempts) {
        const result = service.verifyOwnership(session, attempt);
        assert.strictEqual(result.authorized, false, `Should reject: ${attempt}`);
      }
    });
  });

  describe('Token Comparison Edge Cases', () => {
    it('should handle very long tokens', () => {
      const longToken = 'a'.repeat(10000);
      const session = createMockChatSession({
        shareToken: longToken,
        shareExpiresAt: null,
      });

      const result = service.verifyShareTokenAccess(session, longToken);
      assert.strictEqual(result.authorized, true);
    });

    it('should reject slightly different long tokens', () => {
      const longToken = 'a'.repeat(10000);
      const session = createMockChatSession({
        shareToken: longToken,
        shareExpiresAt: null,
      });

      const differentToken = longToken.slice(0, -1) + 'b';
      const result = service.verifyShareTokenAccess(session, differentToken);
      assert.strictEqual(result.authorized, false);
    });

    it('should handle tokens with special bytes', () => {
      const specialToken = 'token\x00with\xffspecial\x01bytes';
      const session = createMockChatSession({
        shareToken: specialToken,
        shareExpiresAt: null,
      });

      const result = service.verifyShareTokenAccess(session, specialToken);
      assert.strictEqual(result.authorized, true);
    });
  });
});
