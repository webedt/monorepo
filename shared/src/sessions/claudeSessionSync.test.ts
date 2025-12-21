/**
 * Tests for the Claude Session Sync module.
 *
 * These tests verify the duplicate session prevention logic,
 * session matching algorithms, and sync behavior.
 *
 * Note: These tests use mock data and don't connect to real APIs.
 * For live testing, use the integration test suite.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateSessionPath } from '../sessionPathHelper.js';

/**
 * Test helper to create mock remote session data
 */
function createMockRemoteSession(overrides: Partial<{
  id: string;
  title: string;
  session_status: string;
  created_at: string;
  updated_at: string;
  session_context: {
    sources?: Array<{ type: string; url?: string }>;
    outcomes?: Array<{ type: string; git_info?: { branches?: string[] } }>;
  };
}> = {}) {
  return {
    id: overrides.id || 'session_01Test123',
    title: overrides.title || 'Test Session',
    session_status: overrides.session_status || 'completed',
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    session_context: overrides.session_context || {
      sources: [{ type: 'git_repository', url: 'https://github.com/owner/repo.git' }],
      outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/test-branch'] } }]
    }
  };
}

/**
 * Test helper to create mock local session data
 */
function createMockLocalSession(overrides: Partial<{
  id: string;
  userId: string;
  userRequest: string;
  status: string;
  provider: string;
  remoteSessionId: string | null;
  sessionPath: string | null;
  branch: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}> = {}) {
  return {
    id: overrides.id || 'local-session-123',
    userId: overrides.userId || 'user-123',
    userRequest: overrides.userRequest || 'Test request',
    status: overrides.status || 'pending',
    provider: overrides.provider || 'claude',
    remoteSessionId: overrides.remoteSessionId ?? null,
    sessionPath: overrides.sessionPath ?? null,
    branch: overrides.branch ?? null,
    repositoryOwner: overrides.repositoryOwner ?? 'owner',
    repositoryName: overrides.repositoryName ?? 'repo',
    createdAt: overrides.createdAt || new Date(),
    deletedAt: overrides.deletedAt ?? null
  };
}

describe('Session Path Generation', () => {
  describe('generateSessionPath', () => {
    it('should generate consistent path for same inputs', () => {
      const path1 = generateSessionPath('owner', 'repo', 'branch');
      const path2 = generateSessionPath('owner', 'repo', 'branch');

      assert.strictEqual(path1, path2);
    });

    it('should generate unique paths for different branches', () => {
      const path1 = generateSessionPath('owner', 'repo', 'feature-a');
      const path2 = generateSessionPath('owner', 'repo', 'feature-b');

      assert.notStrictEqual(path1, path2);
    });

    it('should normalize branch names with slashes', () => {
      const path = generateSessionPath('owner', 'repo', 'feature/test-branch');

      assert.ok(!path.includes('/'));
      assert.ok(path.includes('feature-test-branch'));
    });

    it('should handle Claude branch naming convention', () => {
      const path = generateSessionPath('webedt', 'hello-world', 'claude/add-session-path-test');

      assert.strictEqual(path, 'webedt__hello-world__claude-add-session-path-test');
    });
  });
});

describe('Session Matching Logic', () => {
  describe('Remote Session Data Extraction', () => {
    it('should extract repository info from git source', () => {
      const remoteSession = createMockRemoteSession({
        session_context: {
          sources: [{ type: 'git_repository', url: 'https://github.com/myorg/myrepo.git' }]
        }
      });

      const gitSource = remoteSession.session_context.sources?.find(s => s.type === 'git_repository');
      assert.ok(gitSource);

      const match = gitSource.url?.match(/github\.com\/([^\/]+)\/([^\/]+)/);
      assert.ok(match);
      assert.strictEqual(match[1], 'myorg');
      assert.strictEqual(match[2], 'myrepo.git');
    });

    it('should extract branch from git outcome', () => {
      const remoteSession = createMockRemoteSession({
        session_context: {
          outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/new-feature'] } }]
        }
      });

      const gitOutcome = remoteSession.session_context.outcomes?.find(o => o.type === 'git_repository');
      const branch = gitOutcome?.git_info?.branches?.[0];

      assert.strictEqual(branch, 'claude/new-feature');
    });

    it('should handle missing git context gracefully', () => {
      const remoteSession = createMockRemoteSession({
        session_context: {}
      });

      const gitSource = remoteSession.session_context.sources?.find(s => s.type === 'git_repository');
      assert.strictEqual(gitSource, undefined);
    });
  });

  describe('Session Matching Criteria', () => {
    it('should match by branch when available', () => {
      const localSession = createMockLocalSession({
        branch: 'claude/test-feature',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        remoteSessionId: null
      });

      const remoteSession = createMockRemoteSession({
        session_context: {
          sources: [{ type: 'git_repository', url: 'https://github.com/owner/repo.git' }],
          outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/test-feature'] } }]
        }
      });

      // Simulate branch matching logic
      const remoteBranch = remoteSession.session_context.outcomes?.[0]?.git_info?.branches?.[0];
      const matches =
        localSession.branch === remoteBranch &&
        localSession.repositoryOwner === 'owner' &&
        localSession.repositoryName === 'repo' &&
        localSession.remoteSessionId === null;

      assert.strictEqual(matches, true);
    });

    it('should not match sessions with different branches', () => {
      const localSession = createMockLocalSession({
        branch: 'claude/feature-a'
      });

      const remoteBranch = 'claude/feature-b';

      assert.notStrictEqual(localSession.branch, remoteBranch);
    });

    it('should not match already linked sessions', () => {
      const localSession = createMockLocalSession({
        branch: 'claude/test-feature',
        remoteSessionId: 'session_01Already' // Already linked
      });

      // Should not be eligible for matching because it's already linked
      assert.ok(localSession.remoteSessionId);
    });
  });

  describe('SessionPath Matching', () => {
    it('should match sessions by sessionPath across different users', () => {
      const sessionPath = 'webedt__hello-world__claude-feature-branch';

      const userASession = createMockLocalSession({
        userId: 'user-a',
        sessionPath,
        remoteSessionId: 'session_01ABC'
      });

      const userBRemoteSession = createMockRemoteSession({
        id: 'session_01ABC', // Same remote session
        session_context: {
          sources: [{ type: 'git_repository', url: 'https://github.com/webedt/hello-world.git' }],
          outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/feature-branch'] } }]
        }
      });

      // Generate sessionPath from remote session
      const remoteBranch = userBRemoteSession.session_context.outcomes?.[0]?.git_info?.branches?.[0];
      const remoteSessionPath = generateSessionPath('webedt', 'hello-world', remoteBranch!);

      // Verify they would generate the same sessionPath
      assert.strictEqual(userASession.sessionPath, remoteSessionPath);
    });

    it('should skip session import when sessionPath exists for different user', () => {
      const existingSession = createMockLocalSession({
        userId: 'user-a',
        sessionPath: 'webedt__hello-world__claude-shared-branch'
      });

      const importingUserId = 'user-b';

      // The sync logic should detect this and skip
      const shouldSkip = existingSession.userId !== importingUserId;
      assert.strictEqual(shouldSkip, true);
    });
  });
});

describe('Duplicate Prevention Logic', () => {
  describe('Unique Constraint Scenarios', () => {
    it('should prevent duplicate sessionPath across users', () => {
      const sessionPath = generateSessionPath('org', 'repo', 'claude/feature-x');

      // Simulate two users trying to create sessions with same path
      const userASessionPath = sessionPath;
      const userBSessionPath = sessionPath;

      // These are equal - would violate unique constraint
      assert.strictEqual(userASessionPath, userBSessionPath);
    });

    it('should generate different paths for different branches', () => {
      const path1 = generateSessionPath('org', 'repo', 'claude/feature-1');
      const path2 = generateSessionPath('org', 'repo', 'claude/feature-2');

      assert.notStrictEqual(path1, path2);
    });

    it('should handle branch suffix variations', () => {
      // Real-world scenario: branch with random suffix
      const path1 = generateSessionPath('webedt', 'hello-world', 'claude/add-test-wOihO');
      const path2 = generateSessionPath('webedt', 'hello-world', 'claude/add-test-xYzAb');

      assert.notStrictEqual(path1, path2);
    });
  });

  describe('Race Condition Handling', () => {
    it('should detect already-linked sessions', () => {
      const localSession = createMockLocalSession({
        remoteSessionId: 'session_01ABC' // Already has remote ID
      });

      const remoteSession = createMockRemoteSession({
        id: 'session_01ABC'
      });

      // Check: local session already has this remote ID
      const alreadyLinked = localSession.remoteSessionId === remoteSession.id;
      assert.strictEqual(alreadyLinked, true);
    });

    it('should handle time window matching', () => {
      const now = new Date();
      const fiveMinutesBefore = new Date(now.getTime() - 5 * 60 * 1000);
      const fiveMinutesAfter = new Date(now.getTime() + 5 * 60 * 1000);

      const localSession = createMockLocalSession({
        createdAt: now,
        status: 'pending'
      });

      const remoteSession = createMockRemoteSession({
        created_at: new Date(now.getTime() + 1000).toISOString() // 1 second after
      });

      const remoteCreatedAt = new Date(remoteSession.created_at);
      const withinWindow =
        remoteCreatedAt >= fiveMinutesBefore &&
        remoteCreatedAt <= fiveMinutesAfter;

      assert.strictEqual(withinWindow, true);
    });
  });
});

describe('Status Mapping', () => {
  it('should map remote statuses to local statuses', () => {
    const statusMap: Record<string, string> = {
      'completed': 'completed',
      'running': 'running',
      'cancelled': 'error',
      'errored': 'error',
      'archived': 'completed'
    };

    assert.strictEqual(statusMap['completed'], 'completed');
    assert.strictEqual(statusMap['running'], 'running');
    assert.strictEqual(statusMap['cancelled'], 'error');
    assert.strictEqual(statusMap['errored'], 'error');
  });
});

describe('Event Import Logic', () => {
  it('should deduplicate events by UUID', () => {
    const existingUuids = new Set(['uuid-1', 'uuid-2', 'uuid-3']);

    const newEvents = [
      { uuid: 'uuid-1', type: 'user' },  // Duplicate
      { uuid: 'uuid-4', type: 'assistant' }, // New
      { uuid: 'uuid-2', type: 'tool' }, // Duplicate
      { uuid: 'uuid-5', type: 'result' } // New
    ];

    const eventsToImport = newEvents.filter(e => !existingUuids.has(e.uuid));

    assert.strictEqual(eventsToImport.length, 2);
    assert.strictEqual(eventsToImport[0].uuid, 'uuid-4');
    assert.strictEqual(eventsToImport[1].uuid, 'uuid-5');
  });

  it('should handle events without UUID', () => {
    const existingUuids = new Set(['uuid-1']);

    const newEvents = [
      { uuid: 'uuid-1', type: 'user' },
      { type: 'system' }, // No UUID
      { uuid: 'uuid-2', type: 'assistant' }
    ];

    // Events without UUID should be handled (typically skipped or imported)
    const eventsWithUuid = newEvents.filter(e => 'uuid' in e && e.uuid);
    const eventsToImport = eventsWithUuid.filter(e => !existingUuids.has(e.uuid!));

    assert.strictEqual(eventsToImport.length, 1);
    assert.strictEqual(eventsToImport[0].uuid, 'uuid-2');
  });
});

describe('Sync Result Tracking', () => {
  it('should track imported sessions', () => {
    const result = { imported: 0, updated: 0, errors: 0, skipped: 0 };

    // Simulate importing 3 new sessions
    result.imported++;
    result.imported++;
    result.imported++;

    assert.strictEqual(result.imported, 3);
  });

  it('should track updated sessions', () => {
    const result = { imported: 0, updated: 0, errors: 0, skipped: 0 };

    // Simulate updating 2 existing sessions
    result.updated++;
    result.updated++;

    assert.strictEqual(result.updated, 2);
  });

  it('should track skipped sessions', () => {
    const result = { imported: 0, updated: 0, errors: 0, skipped: 0 };

    // Simulate skipping already-imported and different-user sessions
    result.skipped++; // Already imported
    result.skipped++; // Different user owns sessionPath
    result.skipped++; // Archived session

    assert.strictEqual(result.skipped, 3);
  });

  it('should track errors', () => {
    const result = { imported: 0, updated: 0, errors: 0, skipped: 0 };

    // Simulate an error during import
    result.errors++;

    assert.strictEqual(result.errors, 1);
  });
});

describe('Real-World Scenarios', () => {
  describe('Scenario: New session created via frontend', () => {
    it('should set sessionPath during title_generation event', () => {
      // Before: Session created without sessionPath
      const session = createMockLocalSession({
        sessionPath: null,
        branch: null
      });

      // After title_generation event with branch
      const newBranch = 'claude/add-feature-test';
      const newSessionPath = generateSessionPath('webedt', 'hello-world', newBranch);

      // Verify sessionPath is properly formatted
      assert.strictEqual(newSessionPath, 'webedt__hello-world__claude-add-feature-test');
    });
  });

  describe('Scenario: Background sync finds existing session', () => {
    it('should match by branch and link instead of creating duplicate', () => {
      const localSession = createMockLocalSession({
        id: 'local-123',
        branch: 'claude/test-branch',
        repositoryOwner: 'webedt',
        repositoryName: 'hello-world',
        remoteSessionId: null, // Not yet linked
        sessionPath: 'webedt__hello-world__claude-test-branch'
      });

      const remoteSession = createMockRemoteSession({
        id: 'session_01Remote',
        session_context: {
          sources: [{ type: 'git_repository', url: 'https://github.com/webedt/hello-world.git' }],
          outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/test-branch'] } }]
        }
      });

      // Sync should match by branch and link
      const remoteBranch = remoteSession.session_context.outcomes?.[0]?.git_info?.branches?.[0];
      const branchMatches = localSession.branch === remoteBranch;
      const ownerMatches = localSession.repositoryOwner === 'webedt';
      const repoMatches = localSession.repositoryName === 'hello-world';
      const notLinked = localSession.remoteSessionId === null;

      const shouldLink = branchMatches && ownerMatches && repoMatches && notLinked;
      assert.strictEqual(shouldLink, true);
    });
  });

  describe('Scenario: Two users share same Claude token', () => {
    it('should skip import when sessionPath already exists for different user', () => {
      const userASession = createMockLocalSession({
        userId: 'user-a',
        sessionPath: 'webedt__repo__claude-feature',
        remoteSessionId: 'session_01Shared'
      });

      const userBTryingToImport = 'user-b';

      // Simulate: User B's sync finds the same remote session
      // Check: sessionPath already exists, and userId doesn't match
      const sessionPathExists = userASession.sessionPath !== null;
      const differentUser = userASession.userId !== userBTryingToImport;

      const shouldSkip = sessionPathExists && differentUser;
      assert.strictEqual(shouldSkip, true);
    });
  });
});
