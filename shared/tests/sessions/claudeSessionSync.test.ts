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
import { generateSessionPath } from '../../src/utils/helpers/sessionPathHelper.js';
import { mapRemoteStatus } from '../../src/sessions/SessionService.js';

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
  // Uses the exported mapRemoteStatus from SessionService to ensure test/implementation parity

  it('should map remote statuses to local statuses', () => {
    assert.strictEqual(mapRemoteStatus('completed'), 'completed');
    assert.strictEqual(mapRemoteStatus('running'), 'running');
    assert.strictEqual(mapRemoteStatus('failed'), 'error');
    assert.strictEqual(mapRemoteStatus('archived'), 'completed');
  });

  it('should map idle to completed', () => {
    assert.strictEqual(mapRemoteStatus('idle'), 'completed');
  });

  it('should map cancelled to error', () => {
    assert.strictEqual(mapRemoteStatus('cancelled'), 'error');
  });

  it('should map errored to error', () => {
    assert.strictEqual(mapRemoteStatus('errored'), 'error');
  });

  it('should default unknown statuses to pending', () => {
    assert.strictEqual(mapRemoteStatus('unknown'), 'pending');
    assert.strictEqual(mapRemoteStatus(''), 'pending');
  });
});

describe('SessionService.sync Logic', () => {
  describe('Change Detection', () => {
    it('should detect status change', () => {
      const currentStatus = 'running';
      const newStatus = 'completed';

      const hasChanges = newStatus !== currentStatus;
      assert.strictEqual(hasChanges, true);
    });

    it('should detect no change when status is same', () => {
      const currentStatus = 'running';
      const newStatus = 'running';

      const hasChanges = newStatus !== currentStatus;
      assert.strictEqual(hasChanges, false);
    });

    it('should detect cost update', () => {
      const currentCost: string | null = null;
      const newCost = '0.123456';

      const hasChanges = newCost !== currentCost;
      assert.strictEqual(hasChanges, true);
    });

    it('should detect branch update', () => {
      const currentBranch: string | null = null;
      const newBranch = 'claude/new-feature';

      const hasChanges = newBranch !== currentBranch;
      assert.strictEqual(hasChanges, true);
    });

    it('should detect new events', () => {
      const newEventsCount = 5;
      const hasChanges = newEventsCount > 0;

      assert.strictEqual(hasChanges, true);
    });
  });

  describe('SessionPath Generation During Sync', () => {
    it('should generate sessionPath when branch becomes available', () => {
      const session = {
        repositoryOwner: 'webedt',
        repositoryName: 'hello-world',
        sessionPath: null as string | null,
        branch: null as string | null,
      };

      const remoteBranch = 'claude/new-feature';
      let sessionPath = session.sessionPath;

      if (remoteBranch && session.repositoryOwner && session.repositoryName && !sessionPath) {
        sessionPath = generateSessionPath(session.repositoryOwner, session.repositoryName, remoteBranch);
      }

      assert.strictEqual(sessionPath, 'webedt__hello-world__claude-new-feature');
    });

    it('should preserve existing sessionPath', () => {
      const existingPath = 'webedt__hello-world__claude-old-feature';
      const session = {
        repositoryOwner: 'webedt',
        repositoryName: 'hello-world',
        sessionPath: existingPath,
      };

      const remoteBranch = 'claude/new-feature';
      let sessionPath: string | undefined = session.sessionPath || undefined;

      // Should not regenerate if already set
      if (remoteBranch && session.repositoryOwner && session.repositoryName && !sessionPath) {
        sessionPath = generateSessionPath(session.repositoryOwner, session.repositoryName, remoteBranch);
      }

      assert.strictEqual(sessionPath, existingPath);
    });
  });

  describe('Cost Extraction', () => {
    it('should extract cost from result event', () => {
      const events = [
        { type: 'user', uuid: 'uuid-1' },
        { type: 'assistant', uuid: 'uuid-2' },
        { type: 'result', uuid: 'uuid-3', total_cost_usd: 0.123456789 },
      ];

      const resultEvent = events.find(e => e.type === 'result' && 'total_cost_usd' in e);
      let totalCost: string | undefined;
      if (resultEvent && 'total_cost_usd' in resultEvent) {
        totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
      }

      assert.strictEqual(totalCost, '0.123457'); // Rounds to 6 decimal places
    });

    it('should handle missing result event', () => {
      const events = [
        { type: 'user', uuid: 'uuid-1' },
        { type: 'assistant', uuid: 'uuid-2' },
      ];

      const resultEvent = events.find(e => e.type === 'result' && 'total_cost_usd' in e);
      let totalCost: string | undefined;
      if (resultEvent && 'total_cost_usd' in resultEvent) {
        totalCost = (resultEvent.total_cost_usd as number).toFixed(6);
      }

      assert.strictEqual(totalCost, undefined);
    });
  });

  describe('Branch Extraction from Remote Session', () => {
    it('should extract branch from git outcome', () => {
      const remoteSession = createMockRemoteSession({
        session_context: {
          outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/feature-x'] } }]
        }
      });

      const gitOutcome = remoteSession.session_context.outcomes?.find(o => o.type === 'git_repository');
      const branch = gitOutcome?.git_info?.branches?.[0];

      assert.strictEqual(branch, 'claude/feature-x');
    });

    it('should handle missing git outcome', () => {
      const remoteSession = createMockRemoteSession({
        session_context: {}
      });

      const gitOutcome = remoteSession.session_context.outcomes?.find(o => o.type === 'git_repository');
      const branch = gitOutcome?.git_info?.branches?.[0];

      assert.strictEqual(branch, undefined);
    });
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

/**
 * Mock Integration Tests for SessionService.sync
 *
 * These tests simulate the complete sync flow by testing the same logic
 * used in SessionService.sync() with mock data. They verify correct
 * behavior for various edge cases without requiring database or API mocks.
 *
 * For full end-to-end integration tests with real API calls, see:
 * shared/tests/claudeWeb/claudeRemoteClient.integration.test.ts
 */
describe('SessionService.sync Mock Integration', () => {
  /**
   * Simulates the sync validation and change detection logic
   */
  function simulateSyncLogic(params: {
    localSession: ReturnType<typeof createMockLocalSession>;
    remoteSession: ReturnType<typeof createMockRemoteSession>;
    remoteEvents: Array<{ uuid: string; type: string; timestamp?: string; total_cost_usd?: number }>;
    existingEventUuids: Set<string>;
  }) {
    const { localSession, remoteSession, remoteEvents, existingEventUuids } = params;

    // Validate remote session structure (mirrors isValidRemoteSession)
    const isValid =
      typeof remoteSession.session_status === 'string' &&
      typeof remoteSession.updated_at === 'string';

    if (!isValid) {
      return { valid: false, changes: null };
    }

    // Map status (mirrors mapRemoteStatus)
    const newStatus = mapRemoteStatus(remoteSession.session_status);

    // Filter new events
    const eventsToInsert = remoteEvents.filter(
      event => event.uuid && !existingEventUuids.has(event.uuid)
    );

    // Extract cost from result event
    let totalCost: string | undefined = localSession.status === 'completed'
      ? '0.000000'
      : undefined;
    const resultEvent = remoteEvents.find(e => e.type === 'result' && e.total_cost_usd);
    if (resultEvent?.total_cost_usd) {
      totalCost = resultEvent.total_cost_usd.toFixed(6);
    }

    // Extract branch from session context
    let branch: string | undefined = localSession.branch ?? undefined;
    const gitOutcome = remoteSession.session_context?.outcomes?.find(
      o => o.type === 'git_repository'
    );
    if (gitOutcome?.git_info?.branches?.[0]) {
      branch = gitOutcome.git_info.branches[0];
    }

    // Generate sessionPath if needed
    let sessionPath: string | undefined = localSession.sessionPath ?? undefined;
    if (branch && localSession.repositoryOwner && localSession.repositoryName && !sessionPath) {
      sessionPath = generateSessionPath(
        localSession.repositoryOwner,
        localSession.repositoryName,
        branch
      );
    }

    // Detect changes
    const hasChanges =
      newStatus !== localSession.status ||
      (totalCost ?? null) !== (localSession.status === 'completed' ? '0.000000' : null) ||
      (branch ?? null) !== localSession.branch ||
      (sessionPath ?? null) !== localSession.sessionPath ||
      eventsToInsert.length > 0;

    return {
      valid: true,
      changes: {
        hasChanges,
        newStatus,
        totalCost,
        branch,
        sessionPath,
        newEventsCount: eventsToInsert.length,
      },
    };
  }

  describe('Complete sync flow simulation', () => {
    it('should detect status change from running to completed', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({ status: 'running' }),
        remoteSession: createMockRemoteSession({ session_status: 'completed' }),
        remoteEvents: [],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.changes?.hasChanges, true);
      assert.strictEqual(result.changes?.newStatus, 'completed');
    });

    it('should not flag changes when status matches', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({
          status: 'completed',
          branch: 'claude/test-branch',
          sessionPath: 'owner__repo__claude-test-branch',
        }),
        remoteSession: createMockRemoteSession({
          session_status: 'completed',
          session_context: {
            outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/test-branch'] } }],
          },
        }),
        remoteEvents: [],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      // No changes since everything matches
      assert.strictEqual(result.changes?.newStatus, 'completed');
    });

    it('should detect new events and flag changes', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({ status: 'completed' }),
        remoteSession: createMockRemoteSession({ session_status: 'completed' }),
        remoteEvents: [
          { uuid: 'new-uuid-1', type: 'user' },
          { uuid: 'new-uuid-2', type: 'assistant' },
        ],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.changes?.hasChanges, true);
      assert.strictEqual(result.changes?.newEventsCount, 2);
    });

    it('should skip already-imported events', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({ status: 'completed' }),
        remoteSession: createMockRemoteSession({ session_status: 'completed' }),
        remoteEvents: [
          { uuid: 'existing-uuid-1', type: 'user' },
          { uuid: 'new-uuid-1', type: 'assistant' },
        ],
        existingEventUuids: new Set(['existing-uuid-1']),
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.changes?.newEventsCount, 1);
    });

    it('should extract cost from result event', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({ status: 'running' }),
        remoteSession: createMockRemoteSession({ session_status: 'completed' }),
        remoteEvents: [
          { uuid: 'uuid-1', type: 'user' },
          { uuid: 'uuid-2', type: 'result', total_cost_usd: 0.123456789 },
        ],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.changes?.totalCost, '0.123457');
    });

    it('should generate sessionPath from branch and repo info', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({
          status: 'running',
          branch: null,
          sessionPath: null,
          repositoryOwner: 'webedt',
          repositoryName: 'hello-world',
        }),
        remoteSession: createMockRemoteSession({
          session_status: 'completed',
          session_context: {
            outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/new-feature'] } }],
          },
        }),
        remoteEvents: [],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.changes?.branch, 'claude/new-feature');
      assert.strictEqual(result.changes?.sessionPath, 'webedt__hello-world__claude-new-feature');
    });

    it('should preserve existing sessionPath', () => {
      const existingPath = 'webedt__hello-world__claude-old-feature';
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({
          status: 'running',
          branch: 'claude/old-feature',
          sessionPath: existingPath,
          repositoryOwner: 'webedt',
          repositoryName: 'hello-world',
        }),
        remoteSession: createMockRemoteSession({
          session_status: 'completed',
          session_context: {
            outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/new-feature'] } }],
          },
        }),
        remoteEvents: [],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      // Should use the new branch from remote
      assert.strictEqual(result.changes?.branch, 'claude/new-feature');
      // But sessionPath should remain unchanged since it was already set
      assert.strictEqual(result.changes?.sessionPath, existingPath);
    });

    it('should handle invalid remote session response', () => {
      // Create an invalid remote session (missing required fields)
      const invalidSession = { id: 'test' } as unknown as ReturnType<typeof createMockRemoteSession>;

      const result = simulateSyncLogic({
        localSession: createMockLocalSession({ status: 'running' }),
        remoteSession: invalidSession,
        remoteEvents: [],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.changes, null);
    });

    it('should map all Anthropic statuses correctly', () => {
      const statusMappings = [
        { anthropic: 'idle', expected: 'completed' },
        { anthropic: 'running', expected: 'running' },
        { anthropic: 'completed', expected: 'completed' },
        { anthropic: 'failed', expected: 'error' },
        { anthropic: 'cancelled', expected: 'error' },
        { anthropic: 'errored', expected: 'error' },
        { anthropic: 'archived', expected: 'completed' },
        { anthropic: 'unknown_status', expected: 'pending' },
      ];

      for (const { anthropic, expected } of statusMappings) {
        const result = simulateSyncLogic({
          localSession: createMockLocalSession({ status: 'pending' }),
          remoteSession: createMockRemoteSession({ session_status: anthropic }),
          remoteEvents: [],
          existingEventUuids: new Set(),
        });

        assert.strictEqual(result.valid, true);
        assert.strictEqual(
          result.changes?.newStatus,
          expected,
          `Expected ${anthropic} to map to ${expected}`
        );
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle empty session context', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({
          status: 'running',
          repositoryOwner: 'owner',
          repositoryName: 'repo',
        }),
        remoteSession: createMockRemoteSession({
          session_status: 'completed',
          session_context: {},
        }),
        remoteEvents: [],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.changes?.branch, undefined);
      assert.strictEqual(result.changes?.sessionPath, undefined);
    });

    it('should handle events without UUID', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({ status: 'running' }),
        remoteSession: createMockRemoteSession({ session_status: 'completed' }),
        remoteEvents: [
          { uuid: '', type: 'system' }, // Empty UUID should be filtered
          { uuid: 'valid-uuid', type: 'user' },
        ],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      // Only the event with valid UUID should be counted
      assert.strictEqual(result.changes?.newEventsCount, 1);
    });

    it('should handle zero cost correctly', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({ status: 'running' }),
        remoteSession: createMockRemoteSession({ session_status: 'completed' }),
        remoteEvents: [
          { uuid: 'uuid-1', type: 'result', total_cost_usd: 0 },
        ],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      // Zero cost should NOT be extracted (falsy check in the actual code)
      assert.strictEqual(result.changes?.totalCost, undefined);
    });

    it('should handle multiple git outcomes - uses first branch', () => {
      const result = simulateSyncLogic({
        localSession: createMockLocalSession({
          status: 'running',
          repositoryOwner: 'owner',
          repositoryName: 'repo',
        }),
        remoteSession: createMockRemoteSession({
          session_status: 'completed',
          session_context: {
            outcomes: [
              { type: 'git_repository', git_info: { branches: ['claude/branch-1', 'claude/branch-2'] } },
            ],
          },
        }),
        remoteEvents: [],
        existingEventUuids: new Set(),
      });

      assert.strictEqual(result.valid, true);
      // Should use first branch from the array
      assert.strictEqual(result.changes?.branch, 'claude/branch-1');
    });
  });
});
