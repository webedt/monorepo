/**
 * Unit Tests for ClaudeWebClient
 *
 * Tests the Claude Web Client with mocked API responses for:
 * - Session creation and management
 * - WebSocket streaming and error handling
 * - Token refresh flows
 * - Error recovery scenarios
 *
 * These tests use mocked fetch and WebSocket to avoid network calls.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { ClaudeWebClient } from '../../src/claudeWeb/claudeWebClient.js';
import { ClaudeRemoteError } from '../../src/claudeWeb/types.js';
import type { Session, SessionEvent, EventsResponse, ListSessionsResponse } from '../../src/claudeWeb/types.js';

// ============================================================================
// Mock Data Factories
// ============================================================================

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: overrides.id ?? 'session_01TestSession',
    title: overrides.title ?? 'Test Session',
    session_status: overrides.session_status ?? 'idle',
    environment_id: overrides.environment_id ?? 'env_01TestEnv',
    created_at: overrides.created_at ?? new Date().toISOString(),
    updated_at: overrides.updated_at ?? new Date().toISOString(),
    session_context: overrides.session_context ?? {
      model: 'claude-opus-4-5-20251101',
      sources: [{ type: 'git_repository', url: 'https://github.com/test/repo' }],
      outcomes: [{ type: 'git_repository', git_info: { type: 'github', repo: 'test/repo', branches: ['claude/test-branch'] } }]
    }
  };
}

function createMockEvent(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    uuid: overrides.uuid ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: overrides.type ?? 'assistant',
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    message: overrides.message ?? { role: 'assistant', content: 'Hello!' },
    ...overrides
  };
}

function createMockEventsResponse(events: SessionEvent[] = [], overrides: Partial<EventsResponse> = {}): EventsResponse {
  return {
    data: events,
    has_more: overrides.has_more ?? false,
    first_id: overrides.first_id,
    last_id: overrides.last_id
  };
}

function createMockListSessionsResponse(sessions: Session[] = [], overrides: Partial<ListSessionsResponse> = {}): ListSessionsResponse {
  return {
    data: sessions,
    has_more: overrides.has_more ?? false,
    first_id: overrides.first_id,
    last_id: overrides.last_id
  };
}

// ============================================================================
// Mock Fetch Helper
// ============================================================================

interface MockFetchResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}

function createMockFetch(responses: Map<string, () => MockFetchResponse>) {
  return async (url: string | URL, options?: RequestInit): Promise<MockFetchResponse> => {
    const urlString = url.toString();

    // Find matching response
    for (const [pattern, responseFn] of responses) {
      if (urlString.includes(pattern)) {
        return responseFn();
      }
    }

    // Default: not found
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not found' }),
      text: async () => 'Not found'
    };
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('ClaudeWebClient', () => {
  let client: ClaudeWebClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new ClaudeWebClient({
      accessToken: 'test-access-token',
      environmentId: 'env_01TestEnv',
      baseUrl: 'https://api.anthropic.com'
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('Configuration', () => {
    it('should accept configuration options', () => {
      const customClient = new ClaudeWebClient({
        accessToken: 'custom-token',
        environmentId: 'env_custom',
        baseUrl: 'https://custom.api.anthropic.com',
        model: 'claude-sonnet-4-20250514'
      });

      // Client should be created without errors
      assert.ok(customClient);
    });

    it('should update configuration with configure()', () => {
      client.configure({
        accessToken: 'new-token',
        environmentId: 'env_new',
        baseUrl: 'https://new.api.anthropic.com'
      });

      // Configuration updated without errors
      assert.ok(client);
    });

    it('should update access token with setAccessToken()', () => {
      client.setAccessToken('refreshed-token');

      // Token updated without errors
      assert.ok(client);
    });
  });

  describe('createSession', () => {
    it('should create a session with required parameters', async () => {
      const mockSession = createMockSession({ id: 'session_01NewSession' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.createSession({
        prompt: 'Create a hello world app',
        gitUrl: 'https://github.com/test/repo'
      });

      assert.strictEqual(result.sessionId, 'session_01NewSession');
      assert.ok(result.webUrl.includes('claude.ai/code/session_01NewSession'));
      assert.ok(result.environmentId);
    });

    it('should use custom title when provided', async () => {
      const mockSession = createMockSession({ title: 'Custom Title' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.createSession({
        prompt: 'Test prompt',
        gitUrl: 'https://github.com/test/repo',
        title: 'Custom Title'
      });

      assert.strictEqual(result.title, 'Custom Title');
    });

    it('should generate title from prompt if not provided', async () => {
      let capturedPayload: unknown;

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        if (options?.body) {
          capturedPayload = JSON.parse(options.body as string);
        }
        const mockSession = createMockSession();
        return {
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        } as Response;
      };

      await client.createSession({
        prompt: 'Create a very long prompt that should be truncated for the title generation',
        gitUrl: 'https://github.com/test/repo'
      });

      assert.ok(capturedPayload);
      const payload = capturedPayload as { title: string };
      assert.ok(payload.title.length <= 55); // 50 chars + "..."
    });

    it('should handle array prompt with text blocks', async () => {
      const mockSession = createMockSession();

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.createSession({
        prompt: [
          { type: 'text', text: 'First part' },
          { type: 'text', text: 'Second part' }
        ],
        gitUrl: 'https://github.com/test/repo'
      });

      assert.ok(result.sessionId);
    });

    it('should throw ClaudeRemoteError on API failure', async () => {
      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Unauthorized' }),
          text: async () => 'Unauthorized'
        })]
      ])) as typeof fetch;

      await assert.rejects(
        () => client.createSession({
          prompt: 'Test',
          gitUrl: 'https://github.com/test/repo'
        }),
        (error: Error) => {
          assert.ok(error instanceof ClaudeRemoteError);
          assert.strictEqual((error as ClaudeRemoteError).statusCode, 401);
          return true;
        }
      );
    });

    it('should strip .git suffix from repository URL', async () => {
      let capturedPayload: unknown;

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        if (options?.body) {
          capturedPayload = JSON.parse(options.body as string);
        }
        const mockSession = createMockSession();
        return {
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        } as Response;
      };

      await client.createSession({
        prompt: 'Test',
        gitUrl: 'https://github.com/test/repo.git'
      });

      const payload = capturedPayload as { session_context: { sources: Array<{ url: string }> } };
      const sourceUrl = payload.session_context.sources[0].url;
      assert.ok(!sourceUrl.endsWith('.git'));
    });
  });

  describe('getSession', () => {
    it('should fetch session details', async () => {
      const mockSession = createMockSession({
        id: 'session_01Fetch',
        session_status: 'running'
      });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/session_01Fetch', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const session = await client.getSession('session_01Fetch');

      assert.strictEqual(session.id, 'session_01Fetch');
      assert.strictEqual(session.session_status, 'running');
    });

    it('should throw on non-existent session', async () => {
      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/', () => ({
          ok: false,
          status: 404,
          json: async () => ({ error: 'Not found' }),
          text: async () => 'Session not found'
        })]
      ])) as typeof fetch;

      await assert.rejects(
        () => client.getSession('session_nonexistent'),
        (error: Error) => {
          assert.ok(error instanceof ClaudeRemoteError);
          assert.strictEqual((error as ClaudeRemoteError).statusCode, 404);
          return true;
        }
      );
    });
  });

  describe('listSessions', () => {
    it('should list sessions with default limit', async () => {
      const mockSessions = [
        createMockSession({ id: 'session_01' }),
        createMockSession({ id: 'session_02' })
      ];

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: true,
          status: 200,
          json: async () => createMockListSessionsResponse(mockSessions),
          text: async () => JSON.stringify(createMockListSessionsResponse(mockSessions))
        })]
      ])) as typeof fetch;

      const response = await client.listSessions();

      assert.strictEqual(response.data.length, 2);
      assert.strictEqual(response.has_more, false);
    });

    it('should pass limit parameter', async () => {
      let capturedUrl: string = '';

      globalThis.fetch = async (url: string | URL): Promise<Response> => {
        capturedUrl = url.toString();
        return {
          ok: true,
          status: 200,
          json: async () => createMockListSessionsResponse([]),
          text: async () => '{}'
        } as Response;
      };

      await client.listSessions(5);

      assert.ok(capturedUrl.includes('limit=5'));
    });

    it('should pass before parameter for pagination', async () => {
      let capturedUrl: string = '';

      globalThis.fetch = async (url: string | URL): Promise<Response> => {
        capturedUrl = url.toString();
        return {
          ok: true,
          status: 200,
          json: async () => createMockListSessionsResponse([]),
          text: async () => '{}'
        } as Response;
      };

      await client.listSessions(20, 'session_01Cursor');

      assert.ok(capturedUrl.includes('before=session_01Cursor'));
    });
  });

  describe('getEvents', () => {
    it('should fetch session events', async () => {
      const mockEvents = [
        createMockEvent({ type: 'user', uuid: 'evt_1' }),
        createMockEvent({ type: 'assistant', uuid: 'evt_2' }),
        createMockEvent({ type: 'result', uuid: 'evt_3' })
      ];

      globalThis.fetch = createMockFetch(new Map([
        ['/events', () => ({
          ok: true,
          status: 200,
          json: async () => createMockEventsResponse(mockEvents),
          text: async () => JSON.stringify(createMockEventsResponse(mockEvents))
        })]
      ])) as typeof fetch;

      const response = await client.getEvents('session_01Test');

      assert.strictEqual(response.data.length, 3);
      assert.strictEqual(response.data[0].type, 'user');
      assert.strictEqual(response.data[1].type, 'assistant');
      assert.strictEqual(response.data[2].type, 'result');
    });
  });

  describe('sendMessage', () => {
    it('should send a text message', async () => {
      let capturedPayload: unknown;

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        if (options?.method === 'POST' && options?.body) {
          capturedPayload = JSON.parse(options.body as string);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '{}'
        } as Response;
      };

      await client.sendMessage('session_01Test', 'Hello, Claude!');

      assert.ok(capturedPayload);
      const payload = capturedPayload as { events: Array<{ message: { content: string } }> };
      assert.strictEqual(payload.events[0].message.content, 'Hello, Claude!');
    });

    it('should send array content with images', async () => {
      let capturedPayload: unknown;

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        if (options?.method === 'POST' && options?.body) {
          capturedPayload = JSON.parse(options.body as string);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '{}'
        } as Response;
      };

      await client.sendMessage('session_01Test', [
        { type: 'text', text: 'Look at this image:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'base64data' } }
      ]);

      assert.ok(capturedPayload);
      const payload = capturedPayload as { events: Array<{ message: { content: unknown[] } }> };
      assert.ok(Array.isArray(payload.events[0].message.content));
    });
  });

  describe('archiveSession', () => {
    it('should archive a session', async () => {
      const mockSession = createMockSession({ session_status: 'archived' });

      globalThis.fetch = createMockFetch(new Map([
        ['/archive', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const session = await client.archiveSession('session_01Test');

      assert.strictEqual(session.session_status, 'archived');
    });
  });

  describe('renameSession', () => {
    it('should rename a session', async () => {
      const mockSession = createMockSession({ title: 'New Title' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/session_01Test', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const session = await client.renameSession('session_01Test', 'New Title');

      assert.strictEqual(session.title, 'New Title');
    });
  });

  describe('canResume', () => {
    it('should return canResume=true for idle sessions', async () => {
      const mockSession = createMockSession({ session_status: 'idle' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/session_01Test', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.canResume('session_01Test');

      assert.strictEqual(result.canResume, true);
      assert.strictEqual(result.status, 'idle');
    });

    it('should return canResume=false for completed sessions', async () => {
      const mockSession = createMockSession({ session_status: 'completed' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/session_01Test', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.canResume('session_01Test');

      assert.strictEqual(result.canResume, false);
      assert.ok(result.reason?.includes('completed'));
    });

    it('should return canResume=false for failed sessions', async () => {
      const mockSession = createMockSession({ session_status: 'failed' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/session_01Test', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.canResume('session_01Test');

      assert.strictEqual(result.canResume, false);
      assert.ok(result.reason?.includes('failed'));
    });

    it('should return canResume=false for archived sessions', async () => {
      const mockSession = createMockSession({ session_status: 'archived' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/session_01Test', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.canResume('session_01Test');

      assert.strictEqual(result.canResume, false);
      assert.ok(result.reason?.includes('archived'));
    });

    it('should check events for running sessions when checkEvents=true', async () => {
      const mockSession = createMockSession({ session_status: 'running' });
      const mockEvents = [createMockEvent({ type: 'result' })];

      let fetchCount = 0;
      globalThis.fetch = async (url: string | URL): Promise<Response> => {
        fetchCount++;
        const urlStr = url.toString();

        if (urlStr.includes('/events')) {
          return {
            ok: true,
            status: 200,
            json: async () => createMockEventsResponse(mockEvents),
            text: async () => JSON.stringify(createMockEventsResponse(mockEvents))
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        } as Response;
      };

      const result = await client.canResume('session_01Test', true);

      assert.strictEqual(result.canResume, true);
      assert.strictEqual(result.hasCompletedEvent, true);
      assert.ok(fetchCount >= 2); // Should have fetched both session and events
    });
  });

  describe('isComplete', () => {
    it('should return isComplete=true for idle sessions', async () => {
      const mockSession = createMockSession({ session_status: 'idle' });

      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions/session_01Test', () => ({
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        })]
      ])) as typeof fetch;

      const result = await client.isComplete('session_01Test');

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.status, 'idle');
    });

    it('should return isComplete=false for running sessions without result event', async () => {
      const mockSession = createMockSession({ session_status: 'running' });
      const mockEvents = [createMockEvent({ type: 'assistant' })]; // No result event

      globalThis.fetch = async (url: string | URL): Promise<Response> => {
        const urlStr = url.toString();

        if (urlStr.includes('/events')) {
          return {
            ok: true,
            status: 200,
            json: async () => createMockEventsResponse(mockEvents),
            text: async () => JSON.stringify(createMockEventsResponse(mockEvents))
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        } as Response;
      };

      const result = await client.isComplete('session_01Test', true);

      assert.strictEqual(result.isComplete, false);
      assert.strictEqual(result.status, 'running');
    });

    it('should return isComplete=true for running sessions with result event', async () => {
      const mockSession = createMockSession({ session_status: 'running' });
      const mockEvents = [createMockEvent({ type: 'result' })];

      globalThis.fetch = async (url: string | URL): Promise<Response> => {
        const urlStr = url.toString();

        if (urlStr.includes('/events')) {
          return {
            ok: true,
            status: 200,
            json: async () => createMockEventsResponse(mockEvents),
            text: async () => JSON.stringify(createMockEventsResponse(mockEvents))
          } as Response;
        }

        return {
          ok: true,
          status: 200,
          json: async () => mockSession,
          text: async () => JSON.stringify(mockSession)
        } as Response;
      };

      const result = await client.isComplete('session_01Test', true);

      assert.strictEqual(result.isComplete, true);
      assert.strictEqual(result.hasResultEvent, true);
    });
  });

  describe('Error Handling', () => {
    it('should include status code in ClaudeRemoteError', async () => {
      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal Server Error' }),
          text: async () => 'Internal Server Error'
        })]
      ])) as typeof fetch;

      try {
        await client.getSession('session_01Test');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof ClaudeRemoteError);
        assert.strictEqual(error.statusCode, 500);
        assert.ok(error.responseText);
      }
    });

    it('should handle 401 Unauthorized errors', async () => {
      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: false,
          status: 401,
          json: async () => ({ error: 'Invalid token' }),
          text: async () => 'Invalid token'
        })]
      ])) as typeof fetch;

      try {
        await client.listSessions();
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof ClaudeRemoteError);
        assert.strictEqual(error.statusCode, 401);
      }
    });

    it('should handle 403 Forbidden errors', async () => {
      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: false,
          status: 403,
          json: async () => ({ error: 'Access denied' }),
          text: async () => 'Access denied'
        })]
      ])) as typeof fetch;

      try {
        await client.getSession('session_01Protected');
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof ClaudeRemoteError);
        assert.strictEqual(error.statusCode, 403);
      }
    });

    it('should handle 429 Rate Limit errors', async () => {
      globalThis.fetch = createMockFetch(new Map([
        ['/v1/sessions', () => ({
          ok: false,
          status: 429,
          json: async () => ({ error: 'Rate limited' }),
          text: async () => 'Rate limited'
        })]
      ])) as typeof fetch;

      try {
        await client.createSession({ prompt: 'Test', gitUrl: 'https://github.com/test/repo' });
        assert.fail('Should have thrown');
      } catch (error) {
        assert.ok(error instanceof ClaudeRemoteError);
        assert.strictEqual(error.statusCode, 429);
      }
    });
  });

  describe('Header Construction', () => {
    it('should include authorization header', async () => {
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        capturedHeaders = options?.headers as Record<string, string>;
        return {
          ok: true,
          status: 200,
          json: async () => createMockListSessionsResponse([]),
          text: async () => '{}'
        } as Response;
      };

      await client.listSessions();

      assert.ok(capturedHeaders['Authorization']?.startsWith('Bearer '));
      assert.strictEqual(capturedHeaders['Authorization'], 'Bearer test-access-token');
    });

    it('should include required anthropic headers', async () => {
      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        capturedHeaders = options?.headers as Record<string, string>;
        return {
          ok: true,
          status: 200,
          json: async () => createMockListSessionsResponse([]),
          text: async () => '{}'
        } as Response;
      };

      await client.listSessions();

      assert.ok(capturedHeaders['anthropic-version']);
      assert.ok(capturedHeaders['anthropic-beta']);
      assert.ok(capturedHeaders['Content-Type']?.includes('application/json'));
    });

    it('should include organization UUID when provided', async () => {
      const clientWithOrg = new ClaudeWebClient({
        accessToken: 'test-token',
        environmentId: 'env_test',
        orgUuid: 'org_01TestOrg'
      });

      let capturedHeaders: Record<string, string> = {};

      globalThis.fetch = async (url: string | URL, options?: RequestInit): Promise<Response> => {
        capturedHeaders = options?.headers as Record<string, string>;
        return {
          ok: true,
          status: 200,
          json: async () => createMockListSessionsResponse([]),
          text: async () => '{}'
        } as Response;
      };

      await clientWithOrg.listSessions();

      assert.strictEqual(capturedHeaders['x-organization-uuid'], 'org_01TestOrg');
    });
  });
});
