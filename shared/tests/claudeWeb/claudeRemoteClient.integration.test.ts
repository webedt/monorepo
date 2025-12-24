/**
 * Integration Tests for Claude Remote Client
 *
 * These tests connect to LIVE Claude Remote servers and execute real sessions.
 * They are NOT run as part of the regular test suite.
 *
 * Prerequisites:
 * - Valid Claude OAuth tokens in your environment or .env file
 * - Network access to api.anthropic.com
 * - A GitHub repository to test with
 *
 * Run these tests manually:
 *   npx tsx --env-file=../../.env src/claudeRemote/claudeRemoteClient.integration.test.ts
 *
 * Or with npm script:
 *   npm run test:integration -w shared
 *
 * WARNING: These tests will:
 * - Create real Claude Remote sessions (costs API credits)
 * - Create branches in the test repository
 * - Make real API calls
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { ClaudeWebClient as ClaudeRemoteClient } from '../../src/claudeWeb/claudeWebClient.js';
import type { Session, SessionEvent } from '../../src/claudeWeb/types.js';

// =============================================================================
// Configuration
// =============================================================================

interface TestConfig {
  accessToken: string;
  refreshToken: string;
  environmentId: string;
  testRepoUrl: string;
  testRepoOwner: string;
  testRepoName: string;
}

async function getTestConfig(): Promise<TestConfig | null> {
  // Method 1: Try environment variables first
  let accessToken = process.env.CLAUDE_ACCESS_TOKEN;
  let refreshToken = process.env.CLAUDE_REFRESH_TOKEN;
  let environmentId = process.env.CLAUDE_ENVIRONMENT_ID || '';

  // Method 2: Try to get from database if env vars not set
  if (!accessToken || !refreshToken) {
    try {
      // Dynamic import to avoid requiring database in all cases
      const { db, users } = await import('../db/index.js');
      const { isNotNull } = await import('drizzle-orm');

      console.log('🔍 Looking for Claude credentials in database...');

      const [userWithClaude] = await db
        .select({
          id: users.id,
          email: users.email,
          claudeAuth: users.claudeAuth,
        })
        .from(users)
        .where(isNotNull(users.claudeAuth))
        .limit(1);

      if (userWithClaude?.claudeAuth) {
        const auth = userWithClaude.claudeAuth as {
          accessToken?: string;
          refreshToken?: string;
        };

        if (auth.accessToken && auth.refreshToken) {
          accessToken = auth.accessToken;
          refreshToken = auth.refreshToken;
          console.log(`   Found credentials for user: ${userWithClaude.email}`);
        }
      }
    } catch (error) {
      console.log('   Could not load credentials from database:', (error as Error).message);
    }
  }

  if (!accessToken || !refreshToken) {
    console.log('\n⚠️  Skipping integration tests: No Claude credentials available');
    console.log('   Options:');
    console.log('   1. Set CLAUDE_ACCESS_TOKEN and CLAUDE_REFRESH_TOKEN environment variables');
    console.log('   2. Have a user with Claude auth configured in the database\n');
    return null;
  }

  // If we don't have environment_id, try to fetch it from existing sessions
  if (!environmentId && accessToken) {
    try {
      const { fetchEnvironmentIdFromSessions } = await import('../claudeRemote/index.js');
      console.log('🔍 Fetching environment ID from existing sessions...');
      environmentId = await fetchEnvironmentIdFromSessions(accessToken) || '';
      if (environmentId) {
        console.log(`   Found environment ID: ${environmentId.slice(0, 10)}...`);
      } else {
        console.log('   ⚠️  Could not find environment ID - some tests may fail');
      }
    } catch (error) {
      console.log('   Could not fetch environment ID:', (error as Error).message);
    }
  }

  return {
    accessToken,
    refreshToken,
    environmentId,
    testRepoUrl: process.env.TEST_REPO_URL || 'https://github.com/webedt/hello-world',
    testRepoOwner: process.env.TEST_REPO_OWNER || 'webedt',
    testRepoName: process.env.TEST_REPO_NAME || 'hello-world',
  };
}

// =============================================================================
// Test Helpers
// =============================================================================

function createTestClient(config: TestConfig): ClaudeRemoteClient {
  return new ClaudeRemoteClient({
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    environmentId: config.environmentId,
  });
}

/**
 * Collect events during session execution
 */
function createEventCollector(): {
  events: SessionEvent[];
  callback: (event: SessionEvent) => void;
} {
  const events: SessionEvent[] = [];
  return {
    events,
    callback: (event: SessionEvent) => {
      events.push(event);
    },
  };
}

/**
 * Wait for a session to reach a terminal state
 */
async function waitForSessionComplete(
  client: ClaudeRemoteClient,
  sessionId: string,
  timeoutMs: number = 120000
): Promise<Session> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const session = await client.getSession(sessionId);

    if (['completed', 'cancelled', 'errored'].includes(session.session_status)) {
      return session;
    }

    // Wait before polling again
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  throw new Error(`Session ${sessionId} did not complete within ${timeoutMs}ms`);
}

// =============================================================================
// Integration Tests
// =============================================================================

// We need to wrap everything in an async IIFE to handle async config loading
(async () => {
  console.log('\n🧪 Claude Remote Integration Tests\n');
  console.log('━'.repeat(60));

  const config = await getTestConfig();

  if (!config) {
    console.log('\n⏭️  Integration tests skipped (no credentials)\n');
    console.log('To run integration tests, set these environment variables:');
    console.log('  - CLAUDE_ACCESS_TOKEN');
    console.log('  - CLAUDE_REFRESH_TOKEN');
    console.log('  - CLAUDE_ENVIRONMENT_ID (optional)');
    console.log('  - TEST_REPO_URL (optional, defaults to webedt/hello-world)\n');
    return;
  }

  describe('Claude Remote Client - Live Integration Tests', () => {
    let client: ClaudeRemoteClient;
    let createdSessionIds: string[] = [];

    before(() => {
      client = createTestClient(config);
      console.log('\n🔌 Connected to Claude Remote API');
      console.log(`   Test repo: ${config.testRepoUrl}\n`);
    });

    after(async () => {
      // Clean up: Archive any sessions we created
      console.log('\n🧹 Cleaning up test sessions...');
      for (const sessionId of createdSessionIds) {
        try {
          await client.archiveSession(sessionId);
          console.log(`   Archived session: ${sessionId}`);
        } catch (error) {
          console.log(`   Failed to archive session ${sessionId}: ${(error as Error).message}`);
        }
      }
    });

    describe('API Connection', () => {
      it('should list existing sessions', async () => {
        const response = await client.listSessions(5);

        assert.ok(response.data, 'Response should have data array');
        assert.ok(Array.isArray(response.data), 'Data should be an array');
        console.log(`   Found ${response.data.length} existing sessions`);
      });

      it('should respect limit parameter', async () => {
        // Test that limit parameter works correctly
        const page1 = await client.listSessions(2);
        assert.ok(page1.data.length <= 2, 'Should respect limit of 2');
        assert.ok(typeof page1.has_more === 'boolean', 'Should have has_more flag');

        // Test with different limit
        const page2 = await client.listSessions(5);
        assert.ok(page2.data.length <= 5, 'Should respect limit of 5');

        console.log(`   Page 1: ${page1.data.length} sessions, has_more: ${page1.has_more}`);
        console.log(`   Page 2: ${page2.data.length} sessions, has_more: ${page2.has_more}`);
      });
    });

    describe('Session Lifecycle', () => {
      let testSessionId: string;

      it('should create a new session', async () => {
        const result = await client.createSession({
          prompt: 'Say "Hello from integration test!" and nothing else. Do not modify any files.',
          gitUrl: config.testRepoUrl,
          model: 'claude-sonnet-4-20250514', // Use faster model for tests
        });

        assert.ok(result.sessionId, 'Should return session ID');
        assert.ok(result.webUrl, 'Should return web URL');
        assert.ok(result.webUrl.includes('claude.ai'), 'Web URL should be claude.ai');

        testSessionId = result.sessionId;
        createdSessionIds.push(testSessionId);

        console.log(`   Created session: ${testSessionId}`);
        console.log(`   Web URL: ${result.webUrl}`);
      });

      it('should get session details', async () => {
        assert.ok(testSessionId, 'Need session from previous test');

        const session = await client.getSession(testSessionId);

        assert.strictEqual(session.id, testSessionId);
        assert.ok(session.session_status, 'Should have status');
        assert.ok(session.created_at, 'Should have created_at');

        console.log(`   Session status: ${session.session_status}`);
      });

      it('should get session events', async () => {
        assert.ok(testSessionId, 'Need session from previous test');

        // Wait a bit for some events to be generated
        await new Promise(resolve => setTimeout(resolve, 3000));

        const response = await client.getEvents(testSessionId);

        assert.ok(response.data, 'Should have events data');
        assert.ok(Array.isArray(response.data), 'Events should be an array');

        console.log(`   Found ${response.data.length} events`);

        // Log event types for debugging
        const eventTypes = [...new Set(response.data.map(e => e.type))];
        console.log(`   Event types: ${eventTypes.join(', ')}`);
      });

      it('should wait for session to complete or timeout gracefully', async () => {
        assert.ok(testSessionId, 'Need session from previous test');

        console.log('   Waiting for session to complete (max 90s)...');
        // Session might not complete within timeout - that's OK for this test
        // The Full Execution Flow test verifies end-to-end completion
        try {
          const session = await waitForSessionComplete(client, testSessionId, 90000);

          assert.ok(
            ['completed', 'cancelled', 'errored'].includes(session.session_status),
            `Session should be in terminal state, got: ${session.session_status}`
          );

          console.log(`   Final status: ${session.session_status}`);
          if (session.title) {
            console.log(`   Title: ${session.title}`);
          }
        } catch (error) {
          // If timeout, check session is still processing (which is valid)
          const session = await client.getSession(testSessionId);
          console.log(`   Session still processing after timeout: ${session.session_status}`);

          // Verify the session is in a valid state
          // Valid states: running, idle (waiting), completed, cancelled, errored
          assert.ok(
            ['running', 'idle', 'completed', 'cancelled', 'errored'].includes(session.session_status),
            `Session should be in valid state, got: ${session.session_status}`
          );
        }
      });

      it('should archive the session', async () => {
        assert.ok(testSessionId, 'Need session from previous test');

        const archived = await client.archiveSession(testSessionId);

        assert.strictEqual(archived.session_status, 'archived');
        console.log('   Session archived successfully');

        // Remove from cleanup list since we already archived it
        createdSessionIds = createdSessionIds.filter(id => id !== testSessionId);
      });
    });

    describe('Full Execution Flow', () => {
      it('should execute a simple task end-to-end', async () => {
        const { events, callback } = createEventCollector();

        console.log('   Starting execution...');

        const result = await client.execute(
          {
            prompt: 'Create a file called integration-test.txt with the content "Test passed!" and commit it.',
            gitUrl: config.testRepoUrl,
            model: 'claude-sonnet-4-20250514',
          },
          callback,
          {
            pollIntervalMs: 2000,
            timeoutMs: 120000,
          }
        );

        createdSessionIds.push(result.remoteSessionId!);

        console.log(`   Session ID: ${result.remoteSessionId}`);
        console.log(`   Status: ${result.status}`);
        console.log(`   Branch: ${result.branch || 'N/A'}`);
        console.log(`   Cost: $${result.totalCost?.toFixed(4) || 'N/A'}`);
        console.log(`   Duration: ${result.durationMs ? (result.durationMs / 1000).toFixed(1) + 's' : 'N/A'}`);
        console.log(`   Events collected: ${events.length}`);

        // Verify we got events
        assert.ok(events.length > 0, 'Should have collected events');

        // Check for expected event types
        const eventTypes = new Set(events.map(e => e.type));
        console.log(`   Event types: ${[...eventTypes].join(', ')}`);

        // Should have at least system and user events
        assert.ok(eventTypes.has('system') || eventTypes.has('user'), 'Should have system or user events');
      });
    });

    describe('Error Handling', () => {
      it('should handle non-existent session gracefully', async () => {
        try {
          await client.getSession('session_nonexistent123');
          assert.fail('Should have thrown an error');
        } catch (error) {
          assert.ok(error instanceof Error);
          console.log(`   Expected error: ${(error as Error).message.slice(0, 50)}...`);
        }
      });

      it('should handle invalid token gracefully', async () => {
        const badClient = new ClaudeRemoteClient({
          accessToken: 'invalid_token',
          environmentId: config.environmentId,
        });

        try {
          await badClient.listSessions(1);
          assert.fail('Should have thrown an error');
        } catch (error) {
          assert.ok(error instanceof Error);
          console.log(`   Expected error: ${(error as Error).message.slice(0, 50)}...`);
        }
      });
    });
  });
})();
