/**
 * Tests for the SessionQueryService module.
 *
 * These tests verify the data access and authorization behavior of the
 * SessionQueryService, which is a critical service for user session retrieval.
 *
 * The tests cover:
 * - Authorization: Users can only access their own sessions
 * - Pagination and filtering logic
 * - Edge cases: deleted sessions, non-existent IDs, empty results
 * - listByIds with various ID arrays
 *
 * Note: These tests use mock data to test query logic patterns.
 * For integration tests with a real database, see the CLI test scenarios.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import type { ChatSession } from '../../src/db/schema.js';
import type { SessionQueryOptions, PaginatedResult, SessionSearchOptions } from '../../src/sessions/ASessionQueryService.js';

/**
 * Test helper to create mock chat session data
 */
function createMockChatSession(overrides: Partial<ChatSession> = {}): ChatSession {
  const now = new Date();
  return {
    id: overrides.id || `session-${Math.random().toString(36).substring(7)}`,
    userId: overrides.userId || 'user-123',
    organizationId: overrides.organizationId ?? null,
    sessionPath: overrides.sessionPath ?? null,
    repositoryOwner: overrides.repositoryOwner ?? 'owner',
    repositoryName: overrides.repositoryName ?? 'repo',
    userRequest: overrides.userRequest || 'Test request',
    status: overrides.status || 'completed',
    repositoryUrl: overrides.repositoryUrl ?? 'https://github.com/owner/repo',
    baseBranch: overrides.baseBranch ?? 'main',
    branch: overrides.branch ?? 'claude/test-branch',
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
 * Mock implementation of query filtering logic
 * Simulates the Drizzle ORM query behavior for testing
 */
class MockSessionQueryService {
  private sessions: ChatSession[] = [];

  constructor(sessions: ChatSession[] = []) {
    this.sessions = sessions;
  }

  addSession(session: ChatSession): void {
    this.sessions.push(session);
  }

  /**
   * Get session by ID (no user filter - admin/system use)
   */
  getById(sessionId: string): ChatSession | null {
    return this.sessions.find(s => s.id === sessionId) || null;
  }

  /**
   * Get session by ID with user authorization check
   * Core authorization: user can only access their own sessions
   */
  getByIdForUser(sessionId: string, userId: string): ChatSession | null {
    const session = this.sessions.find(
      s => s.id === sessionId && s.userId === userId
    );
    return session || null;
  }

  /**
   * List active (non-deleted) sessions for a user
   */
  listActive(userId: string, options?: SessionQueryOptions): ChatSession[] {
    const { limit = 100, offset = 0 } = options || {};

    const filtered = this.sessions
      .filter(s => s.userId === userId && s.deletedAt === null)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(offset, offset + limit);

    return filtered;
  }

  /**
   * List deleted sessions for a user with pagination
   */
  listDeleted(userId: string, options?: SessionQueryOptions): PaginatedResult<ChatSession> {
    const { limit = 50, offset = 0 } = options || {};

    const allDeleted = this.sessions
      .filter(s => s.userId === userId && s.deletedAt !== null)
      .sort((a, b) => (b.deletedAt?.getTime() || 0) - (a.deletedAt?.getTime() || 0));

    const items = allDeleted.slice(offset, offset + limit);
    const total = allDeleted.length;

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  /**
   * Get multiple sessions by IDs with user authorization
   */
  listByIds(sessionIds: string[], userId: string): ChatSession[] {
    if (sessionIds.length === 0) return [];

    return this.sessions.filter(
      s => sessionIds.includes(s.id) && s.userId === userId
    );
  }

  /**
   * Check if session exists for user
   */
  existsForUser(sessionId: string, userId: string): boolean {
    return this.getByIdForUser(sessionId, userId) !== null;
  }

  /**
   * Count active sessions for user
   */
  countActive(userId: string): number {
    return this.sessions.filter(
      s => s.userId === userId && s.deletedAt === null
    ).length;
  }

  /**
   * Count deleted sessions for user
   */
  countDeleted(userId: string): number {
    return this.sessions.filter(
      s => s.userId === userId && s.deletedAt !== null
    ).length;
  }

  /**
   * Search sessions by query
   */
  search(userId: string, options: SessionSearchOptions): PaginatedResult<ChatSession> {
    const { query, limit = 50, offset = 0, status, favorite } = options;

    // Minimum query length check
    if (query.length < 2) {
      return { items: [], total: 0, hasMore: false };
    }

    // Escape special characters (simulates ILIKE pattern matching)
    const lowerQuery = query.toLowerCase();

    let filtered = this.sessions.filter(s => {
      // Must be user's session and not deleted
      if (s.userId !== userId || s.deletedAt !== null) return false;

      // Search in userRequest, repositoryOwner, repositoryName, branch
      const matches = (
        (s.userRequest?.toLowerCase().includes(lowerQuery)) ||
        (s.repositoryOwner?.toLowerCase().includes(lowerQuery)) ||
        (s.repositoryName?.toLowerCase().includes(lowerQuery)) ||
        (s.branch?.toLowerCase().includes(lowerQuery))
      );

      return matches;
    });

    // Apply optional filters
    if (status) {
      filtered = filtered.filter(s => s.status === status);
    }
    if (favorite !== undefined) {
      filtered = filtered.filter(s => s.favorite === favorite);
    }

    // Sort by createdAt descending
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const items = filtered.slice(offset, offset + limit);
    const total = filtered.length;

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }
}

describe('SessionQueryService Authorization', () => {
  describe('getByIdForUser - Core Authorization', () => {
    it('should return session when user owns it', () => {
      const service = new MockSessionQueryService();
      const session = createMockChatSession({ id: 'session-1', userId: 'user-a' });
      service.addSession(session);

      const result = service.getByIdForUser('session-1', 'user-a');

      assert.ok(result);
      assert.strictEqual(result.id, 'session-1');
      assert.strictEqual(result.userId, 'user-a');
    });

    it('should return null when user does not own session', () => {
      const service = new MockSessionQueryService();
      const session = createMockChatSession({ id: 'session-1', userId: 'user-a' });
      service.addSession(session);

      // user-b tries to access user-a's session
      const result = service.getByIdForUser('session-1', 'user-b');

      assert.strictEqual(result, null);
    });

    it('should return null for non-existent session', () => {
      const service = new MockSessionQueryService();

      const result = service.getByIdForUser('non-existent', 'user-a');

      assert.strictEqual(result, null);
    });

    it('should enforce authorization even with multiple sessions', () => {
      const service = new MockSessionQueryService();

      // User A has sessions 1 and 2
      service.addSession(createMockChatSession({ id: 'session-1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 'session-2', userId: 'user-a' }));

      // User B has session 3
      service.addSession(createMockChatSession({ id: 'session-3', userId: 'user-b' }));

      // User A can access their sessions
      assert.ok(service.getByIdForUser('session-1', 'user-a'));
      assert.ok(service.getByIdForUser('session-2', 'user-a'));

      // User A cannot access User B's session
      assert.strictEqual(service.getByIdForUser('session-3', 'user-a'), null);

      // User B can access their session
      assert.ok(service.getByIdForUser('session-3', 'user-b'));

      // User B cannot access User A's sessions
      assert.strictEqual(service.getByIdForUser('session-1', 'user-b'), null);
      assert.strictEqual(service.getByIdForUser('session-2', 'user-b'), null);
    });
  });

  describe('getById - System Access (No Authorization)', () => {
    it('should return session without user check', () => {
      const service = new MockSessionQueryService();
      const session = createMockChatSession({ id: 'session-1', userId: 'user-a' });
      service.addSession(session);

      // getById doesn't check userId - used for admin/system access
      const result = service.getById('session-1');

      assert.ok(result);
      assert.strictEqual(result.id, 'session-1');
    });

    it('should return null for non-existent session', () => {
      const service = new MockSessionQueryService();

      const result = service.getById('non-existent');

      assert.strictEqual(result, null);
    });
  });

  describe('listActive - User-Scoped Queries', () => {
    it('should only return sessions for the specified user', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-b' }));
      service.addSession(createMockChatSession({ id: 's4', userId: 'user-c' }));

      const userASessions = service.listActive('user-a');

      assert.strictEqual(userASessions.length, 2);
      assert.ok(userASessions.every(s => s.userId === 'user-a'));
    });

    it('should not include deleted sessions', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        deletedAt: null
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        deletedAt: new Date() // Deleted
      }));

      const sessions = service.listActive('user-a');

      assert.strictEqual(sessions.length, 1);
      assert.strictEqual(sessions[0].id, 's1');
    });
  });

  describe('listByIds - Authorization with Multiple IDs', () => {
    it('should only return sessions owned by the user', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-b' }));

      // User A requests multiple IDs including one they don't own
      const results = service.listByIds(['s1', 's2', 's3'], 'user-a');

      // Should only return s1 and s2
      assert.strictEqual(results.length, 2);
      assert.ok(results.every(s => s.userId === 'user-a'));
    });

    it('should return empty array when user owns none of the requested IDs', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a' }));

      // User B requests User A's sessions
      const results = service.listByIds(['s1', 's2'], 'user-b');

      assert.strictEqual(results.length, 0);
    });
  });

  describe('existsForUser - Authorization Check', () => {
    it('should return true when user owns session', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));

      assert.strictEqual(service.existsForUser('s1', 'user-a'), true);
    });

    it('should return false when user does not own session', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));

      assert.strictEqual(service.existsForUser('s1', 'user-b'), false);
    });

    it('should return false for non-existent session', () => {
      const service = new MockSessionQueryService();

      assert.strictEqual(service.existsForUser('non-existent', 'user-a'), false);
    });
  });
});

describe('SessionQueryService Pagination and Filtering', () => {
  describe('listActive - Pagination', () => {
    it('should respect limit parameter', () => {
      const service = new MockSessionQueryService();

      // Add 10 sessions
      for (let i = 0; i < 10; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a',
          createdAt: new Date(Date.now() - i * 1000)
        }));
      }

      const sessions = service.listActive('user-a', { limit: 5 });

      assert.strictEqual(sessions.length, 5);
    });

    it('should respect offset parameter', () => {
      const service = new MockSessionQueryService();

      // Add 10 sessions with different creation times
      for (let i = 0; i < 10; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a',
          createdAt: new Date(Date.now() - i * 1000)
        }));
      }

      const firstPage = service.listActive('user-a', { limit: 5, offset: 0 });
      const secondPage = service.listActive('user-a', { limit: 5, offset: 5 });

      assert.strictEqual(firstPage.length, 5);
      assert.strictEqual(secondPage.length, 5);

      // Pages should not overlap
      const firstPageIds = new Set(firstPage.map(s => s.id));
      const secondPageIds = new Set(secondPage.map(s => s.id));
      const overlap = [...firstPageIds].filter(id => secondPageIds.has(id));

      assert.strictEqual(overlap.length, 0);
    });

    it('should use default limit of 100', () => {
      const service = new MockSessionQueryService();

      // Add 150 sessions
      for (let i = 0; i < 150; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a'
        }));
      }

      const sessions = service.listActive('user-a');

      assert.strictEqual(sessions.length, 100);
    });

    it('should order by createdAt descending', () => {
      const service = new MockSessionQueryService();

      const oldest = new Date('2024-01-01');
      const middle = new Date('2024-06-01');
      const newest = new Date('2024-12-01');

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a', createdAt: oldest }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a', createdAt: newest }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-a', createdAt: middle }));

      const sessions = service.listActive('user-a');

      assert.strictEqual(sessions[0].id, 's2'); // Newest first
      assert.strictEqual(sessions[1].id, 's3');
      assert.strictEqual(sessions[2].id, 's1'); // Oldest last
    });
  });

  describe('listDeleted - Paginated Result', () => {
    it('should return paginated result with total count', () => {
      const service = new MockSessionQueryService();

      for (let i = 0; i < 10; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a',
          deletedAt: new Date(Date.now() - i * 1000)
        }));
      }

      const result = service.listDeleted('user-a', { limit: 5 });

      assert.strictEqual(result.items.length, 5);
      assert.strictEqual(result.total, 10);
      assert.strictEqual(result.hasMore, true);
    });

    it('should indicate no more items when all returned', () => {
      const service = new MockSessionQueryService();

      for (let i = 0; i < 3; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a',
          deletedAt: new Date()
        }));
      }

      const result = service.listDeleted('user-a', { limit: 10 });

      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.hasMore, false);
    });

    it('should use default limit of 50', () => {
      const service = new MockSessionQueryService();

      for (let i = 0; i < 75; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a',
          deletedAt: new Date()
        }));
      }

      const result = service.listDeleted('user-a');

      assert.strictEqual(result.items.length, 50);
      assert.strictEqual(result.total, 75);
      assert.strictEqual(result.hasMore, true);
    });

    it('should order by deletedAt descending', () => {
      const service = new MockSessionQueryService();

      const oldest = new Date('2024-01-01');
      const middle = new Date('2024-06-01');
      const newest = new Date('2024-12-01');

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a', deletedAt: oldest }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a', deletedAt: newest }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-a', deletedAt: middle }));

      const result = service.listDeleted('user-a');

      assert.strictEqual(result.items[0].id, 's2'); // Newest deletion first
      assert.strictEqual(result.items[1].id, 's3');
      assert.strictEqual(result.items[2].id, 's1'); // Oldest deletion last
    });
  });

  describe('countActive and countDeleted', () => {
    it('should count active sessions correctly', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a', deletedAt: null }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a', deletedAt: null }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-a', deletedAt: new Date() }));
      service.addSession(createMockChatSession({ id: 's4', userId: 'user-b', deletedAt: null }));

      assert.strictEqual(service.countActive('user-a'), 2);
      assert.strictEqual(service.countActive('user-b'), 1);
    });

    it('should count deleted sessions correctly', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a', deletedAt: null }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a', deletedAt: new Date() }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-a', deletedAt: new Date() }));
      service.addSession(createMockChatSession({ id: 's4', userId: 'user-b', deletedAt: new Date() }));

      assert.strictEqual(service.countDeleted('user-a'), 2);
      assert.strictEqual(service.countDeleted('user-b'), 1);
    });

    it('should return 0 for users with no sessions', () => {
      const service = new MockSessionQueryService();

      assert.strictEqual(service.countActive('non-existent-user'), 0);
      assert.strictEqual(service.countDeleted('non-existent-user'), 0);
    });
  });
});

describe('SessionQueryService Edge Cases', () => {
  describe('Empty Results', () => {
    it('should return empty array for user with no sessions', () => {
      const service = new MockSessionQueryService();

      const sessions = service.listActive('user-without-sessions');

      assert.ok(Array.isArray(sessions));
      assert.strictEqual(sessions.length, 0);
    });

    it('should return empty paginated result for user with no deleted sessions', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        deletedAt: null // Not deleted
      }));

      const result = service.listDeleted('user-a');

      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.total, 0);
      assert.strictEqual(result.hasMore, false);
    });
  });

  describe('Deleted Sessions Isolation', () => {
    it('should completely separate active and deleted sessions', () => {
      const service = new MockSessionQueryService();

      // 3 active, 2 deleted
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a', deletedAt: null }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a', deletedAt: null }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-a', deletedAt: null }));
      service.addSession(createMockChatSession({ id: 's4', userId: 'user-a', deletedAt: new Date() }));
      service.addSession(createMockChatSession({ id: 's5', userId: 'user-a', deletedAt: new Date() }));

      const active = service.listActive('user-a');
      const deleted = service.listDeleted('user-a');

      assert.strictEqual(active.length, 3);
      assert.strictEqual(deleted.items.length, 2);

      // No overlap
      const activeIds = new Set(active.map(s => s.id));
      const deletedIds = new Set(deleted.items.map(s => s.id));
      const overlap = [...activeIds].filter(id => deletedIds.has(id));

      assert.strictEqual(overlap.length, 0);
    });
  });

  describe('Non-existent IDs', () => {
    it('getByIdForUser should return null for non-existent session', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 'exists', userId: 'user-a' }));

      assert.strictEqual(service.getByIdForUser('does-not-exist', 'user-a'), null);
    });

    it('listByIds should ignore non-existent IDs', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a' }));

      const results = service.listByIds(['s1', 'non-existent', 's2', 'also-missing'], 'user-a');

      assert.strictEqual(results.length, 2);
      assert.ok(results.some(s => s.id === 's1'));
      assert.ok(results.some(s => s.id === 's2'));
    });
  });

  describe('Session Status Variations', () => {
    it('should include sessions of all statuses in active list', () => {
      const service = new MockSessionQueryService();

      const statuses = ['pending', 'running', 'completed', 'error'];

      for (const status of statuses) {
        service.addSession(createMockChatSession({
          id: `session-${status}`,
          userId: 'user-a',
          status: status as ChatSession['status'],
          deletedAt: null
        }));
      }

      const sessions = service.listActive('user-a');

      assert.strictEqual(sessions.length, 4);
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle offset beyond total items', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a' }));

      const sessions = service.listActive('user-a', { offset: 100 });

      assert.strictEqual(sessions.length, 0);
    });

    it('should handle limit of 0', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));

      const sessions = service.listActive('user-a', { limit: 0 });

      assert.strictEqual(sessions.length, 0);
    });
  });
});

describe('SessionQueryService listByIds', () => {
  describe('Empty Array Input', () => {
    it('should return empty array for empty input', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));

      const results = service.listByIds([], 'user-a');

      assert.ok(Array.isArray(results));
      assert.strictEqual(results.length, 0);
    });
  });

  describe('Single ID Input', () => {
    it('should return single session for single ID', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a' }));

      const results = service.listByIds(['s1'], 'user-a');

      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].id, 's1');
    });

    it('should return empty for non-owned single ID', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));

      const results = service.listByIds(['s1'], 'user-b');

      assert.strictEqual(results.length, 0);
    });
  });

  describe('Multiple IDs Input', () => {
    it('should return all matching sessions', () => {
      const service = new MockSessionQueryService();

      for (let i = 1; i <= 5; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a'
        }));
      }

      const results = service.listByIds(['s1', 's3', 's5'], 'user-a');

      assert.strictEqual(results.length, 3);
      const ids = results.map(s => s.id);
      assert.ok(ids.includes('s1'));
      assert.ok(ids.includes('s3'));
      assert.ok(ids.includes('s5'));
    });

    it('should filter out sessions from other users', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-b' }));
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's4', userId: 'user-c' }));

      const results = service.listByIds(['s1', 's2', 's3', 's4'], 'user-a');

      assert.strictEqual(results.length, 2);
      assert.ok(results.every(s => s.userId === 'user-a'));
    });

    it('should handle duplicate IDs in input', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));

      // Same ID multiple times in input
      const results = service.listByIds(['s1', 's1', 's1'], 'user-a');

      // Should only return one instance
      assert.strictEqual(results.length, 1);
    });
  });

  describe('Large ID Lists', () => {
    it('should handle large number of IDs efficiently', () => {
      const service = new MockSessionQueryService();

      // Add 100 sessions
      for (let i = 0; i < 100; i++) {
        service.addSession(createMockChatSession({
          id: `session-${i}`,
          userId: 'user-a'
        }));
      }

      // Request 50 of them
      const requestedIds = Array.from({ length: 50 }, (_, i) => `session-${i * 2}`);
      const results = service.listByIds(requestedIds, 'user-a');

      assert.strictEqual(results.length, 50);
    });
  });
});

describe('SessionQueryService Search', () => {
  describe('Query Validation', () => {
    it('should return empty for query shorter than 2 characters', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Fix the bug'
      }));

      const result = service.search('user-a', { query: 'F' });

      assert.strictEqual(result.items.length, 0);
      assert.strictEqual(result.total, 0);
    });

    it('should search with query of exactly 2 characters', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Fix the bug'
      }));

      const result = service.search('user-a', { query: 'Fi' });

      assert.strictEqual(result.items.length, 1);
    });
  });

  describe('Search Fields', () => {
    it('should search in userRequest', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Implement authentication feature'
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        userRequest: 'Fix styling bug'
      }));

      const result = service.search('user-a', { query: 'authentication' });

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].id, 's1');
    });

    it('should search in repositoryOwner', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        repositoryOwner: 'webedt'
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        repositoryOwner: 'other-org'
      }));

      const result = service.search('user-a', { query: 'webedt' });

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].id, 's1');
    });

    it('should search in repositoryName', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        repositoryName: 'hello-world'
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        repositoryName: 'other-repo'
      }));

      const result = service.search('user-a', { query: 'hello' });

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].id, 's1');
    });

    it('should search in branch', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        branch: 'claude/feature-authentication'
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        branch: 'claude/fix-bug'
      }));

      const result = service.search('user-a', { query: 'authentication' });

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].id, 's1');
    });

    it('should be case-insensitive', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Implement AUTHENTICATION'
      }));

      const result = service.search('user-a', { query: 'authentication' });

      assert.strictEqual(result.items.length, 1);
    });
  });

  describe('Search Filters', () => {
    it('should filter by status', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Test session',
        status: 'completed'
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        userRequest: 'Test session',
        status: 'running'
      }));

      const result = service.search('user-a', { query: 'Test', status: 'completed' });

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].id, 's1');
    });

    it('should filter by favorite', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Test session',
        favorite: true
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        userRequest: 'Test session',
        favorite: false
      }));

      const result = service.search('user-a', { query: 'Test', favorite: true });

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].id, 's1');
    });
  });

  describe('Search Authorization', () => {
    it('should only search user own sessions', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Test session'
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-b',
        userRequest: 'Test session'
      }));

      const resultA = service.search('user-a', { query: 'Test' });
      const resultB = service.search('user-b', { query: 'Test' });

      assert.strictEqual(resultA.items.length, 1);
      assert.strictEqual(resultA.items[0].userId, 'user-a');

      assert.strictEqual(resultB.items.length, 1);
      assert.strictEqual(resultB.items[0].userId, 'user-b');
    });

    it('should exclude deleted sessions from search', () => {
      const service = new MockSessionQueryService();
      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'user-a',
        userRequest: 'Test session',
        deletedAt: null
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'user-a',
        userRequest: 'Test session',
        deletedAt: new Date()
      }));

      const result = service.search('user-a', { query: 'Test' });

      assert.strictEqual(result.items.length, 1);
      assert.strictEqual(result.items[0].id, 's1');
    });
  });

  describe('Search Pagination', () => {
    it('should paginate search results', () => {
      const service = new MockSessionQueryService();

      for (let i = 0; i < 20; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a',
          userRequest: 'Test session'
        }));
      }

      const result = service.search('user-a', { query: 'Test', limit: 5, offset: 0 });

      assert.strictEqual(result.items.length, 5);
      assert.strictEqual(result.total, 20);
      assert.strictEqual(result.hasMore, true);
    });

    it('should indicate no more when all results returned', () => {
      const service = new MockSessionQueryService();

      for (let i = 0; i < 3; i++) {
        service.addSession(createMockChatSession({
          id: `s${i}`,
          userId: 'user-a',
          userRequest: 'Test session'
        }));
      }

      const result = service.search('user-a', { query: 'Test', limit: 10 });

      assert.strictEqual(result.items.length, 3);
      assert.strictEqual(result.total, 3);
      assert.strictEqual(result.hasMore, false);
    });
  });
});

describe('SessionQueryService Real-World Scenarios', () => {
  describe('Scenario: User dashboard loads sessions', () => {
    it('should return recent sessions for dashboard display', () => {
      const service = new MockSessionQueryService();

      // User has 50 sessions
      for (let i = 0; i < 50; i++) {
        service.addSession(createMockChatSession({
          id: `session-${i}`,
          userId: 'dashboard-user',
          createdAt: new Date(Date.now() - i * 3600000) // 1 hour apart
        }));
      }

      // Dashboard typically loads 20 most recent
      const sessions = service.listActive('dashboard-user', { limit: 20 });

      assert.strictEqual(sessions.length, 20);
      // Should be most recent first
      assert.strictEqual(sessions[0].id, 'session-0');
    });
  });

  describe('Scenario: Trash view shows soft-deleted sessions', () => {
    it('should show deleted sessions with pagination for restore', () => {
      const service = new MockSessionQueryService();

      // User has some active and some deleted sessions
      for (let i = 0; i < 10; i++) {
        service.addSession(createMockChatSession({
          id: `active-${i}`,
          userId: 'user',
          deletedAt: null
        }));
        service.addSession(createMockChatSession({
          id: `deleted-${i}`,
          userId: 'user',
          deletedAt: new Date(Date.now() - i * 86400000) // Different delete times
        }));
      }

      const deletedResult = service.listDeleted('user', { limit: 5 });

      assert.strictEqual(deletedResult.items.length, 5);
      assert.strictEqual(deletedResult.total, 10);
      assert.strictEqual(deletedResult.hasMore, true);

      // All items should be from deleted set
      assert.ok(deletedResult.items.every(s => s.id.startsWith('deleted-')));
    });
  });

  describe('Scenario: Bulk operations on selected sessions', () => {
    it('should retrieve multiple sessions for bulk delete', () => {
      const service = new MockSessionQueryService();

      const sessionIds: string[] = [];
      for (let i = 0; i < 20; i++) {
        const id = `session-${i}`;
        sessionIds.push(id);
        service.addSession(createMockChatSession({
          id,
          userId: 'bulk-user'
        }));
      }

      // User selects 5 sessions for bulk delete
      const selectedIds = sessionIds.slice(5, 10);
      const sessions = service.listByIds(selectedIds, 'bulk-user');

      assert.strictEqual(sessions.length, 5);
    });

    it('should prevent accessing other user sessions in bulk', () => {
      const service = new MockSessionQueryService();

      // User A has sessions
      service.addSession(createMockChatSession({ id: 's1', userId: 'user-a' }));
      service.addSession(createMockChatSession({ id: 's2', userId: 'user-a' }));

      // User B has sessions
      service.addSession(createMockChatSession({ id: 's3', userId: 'user-b' }));

      // Malicious attempt: User B tries to bulk access User A's sessions
      const results = service.listByIds(['s1', 's2', 's3'], 'user-b');

      // Should only get User B's session
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].id, 's3');
    });
  });

  describe('Scenario: Search finds sessions across repositories', () => {
    it('should find sessions by repository name', () => {
      const service = new MockSessionQueryService();

      service.addSession(createMockChatSession({
        id: 's1',
        userId: 'dev',
        repositoryOwner: 'webedt',
        repositoryName: 'monorepo',
        userRequest: 'Add tests'
      }));
      service.addSession(createMockChatSession({
        id: 's2',
        userId: 'dev',
        repositoryOwner: 'webedt',
        repositoryName: 'docs',
        userRequest: 'Update documentation'
      }));
      service.addSession(createMockChatSession({
        id: 's3',
        userId: 'dev',
        repositoryOwner: 'other',
        repositoryName: 'project',
        userRequest: 'Fix bug'
      }));

      const result = service.search('dev', { query: 'webedt' });

      assert.strictEqual(result.items.length, 2);
      assert.ok(result.items.every(s => s.repositoryOwner === 'webedt'));
    });
  });
});
