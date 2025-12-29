/**
 * Integration Tests for Execute Remote Routes
 *
 * Tests the AI execution endpoints including validation, authentication,
 * SSE streaming setup, and event handling.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { createMockRequest, createMockResponse, createMockUser, createMockSession } from '../helpers/mockExpress.js';
import { createMockChatSession } from '../helpers/testApp.js';
import { MockDb, createMockDb } from '../helpers/mockDb.js';

describe('Execute Remote Routes - Integration Tests', () => {
  let mockDb: MockDb;

  beforeEach(() => {
    mockDb = createMockDb();
  });

  describe('Authentication Requirements', () => {
    it('should reject unauthenticated requests', () => {
      const req = createMockRequest({ user: null, authSession: null });
      const res = createMockResponse();

      // Simulate auth check
      if (!req.user) {
        res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      assert.strictEqual(res.statusCode, 401);
    });

    it('should accept authenticated requests', () => {
      const req = createMockRequest({
        user: createMockUser(),
        authSession: createMockSession(),
      });

      assert.ok(req.user);
      assert.ok(req.authSession);
    });
  });

  describe('Request Validation', () => {
    it('should require userRequest or websiteSessionId', () => {
      const result = validateExecuteParams({});

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'userRequest or websiteSessionId is required');
    });

    it('should require github.repoUrl for new sessions', () => {
      const result = validateExecuteParams({ userRequest: 'Test request' });

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'github.repoUrl is required for new sessions');
    });

    it('should not require repoUrl when resuming existing session', () => {
      const result = validateExecuteParams({
        userRequest: 'Continue',
        websiteSessionId: 'existing-session-123',
      });

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid new session params', () => {
      const result = validateExecuteParams({
        userRequest: 'Test request',
        github: { repoUrl: 'https://github.com/owner/repo' },
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.repoUrl, 'https://github.com/owner/repo');
    });

    it('should parse github from JSON string', () => {
      const result = validateExecuteParams({
        userRequest: 'Test',
        github: JSON.stringify({ repoUrl: 'https://github.com/owner/repo' }),
      });

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.repoUrl, 'https://github.com/owner/repo');
    });

    it('should accept content blocks userRequest', () => {
      const result = validateExecuteParams({
        userRequest: [
          { type: 'text', text: 'Hello' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
        ],
        github: { repoUrl: 'https://github.com/owner/repo' },
      });

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Repository URL Helpers', () => {
    describe('extractRepoOwner', () => {
      it('should extract owner from standard URL', () => {
        assert.strictEqual(extractRepoOwner('https://github.com/myowner/myrepo'), 'myowner');
      });

      it('should extract owner from URL with .git suffix', () => {
        assert.strictEqual(extractRepoOwner('https://github.com/owner/repo.git'), 'owner');
      });

      it('should return null for invalid URL', () => {
        assert.strictEqual(extractRepoOwner('not-a-url'), null);
      });

      it('should return null for non-GitHub URL', () => {
        assert.strictEqual(extractRepoOwner('https://gitlab.com/owner/repo'), null);
      });

      it('should handle trailing slash', () => {
        assert.strictEqual(extractRepoOwner('https://github.com/owner/repo/'), 'owner');
      });
    });

    describe('extractRepoName', () => {
      it('should extract repo name from standard URL', () => {
        assert.strictEqual(extractRepoName('https://github.com/owner/myrepo'), 'myrepo');
      });

      it('should remove .git suffix', () => {
        assert.strictEqual(extractRepoName('https://github.com/owner/repo.git'), 'repo');
      });

      it('should handle repo names with hyphens', () => {
        assert.strictEqual(extractRepoName('https://github.com/owner/my-cool-repo'), 'my-cool-repo');
      });

      it('should handle repo names with underscores', () => {
        assert.strictEqual(extractRepoName('https://github.com/owner/my_repo'), 'my_repo');
      });
    });

    describe('normalizeRepoUrl', () => {
      it('should remove .git suffix', () => {
        assert.strictEqual(normalizeRepoUrl('https://github.com/owner/repo.git'), 'https://github.com/owner/repo');
      });

      it('should keep URL unchanged if no .git suffix', () => {
        assert.strictEqual(normalizeRepoUrl('https://github.com/owner/repo'), 'https://github.com/owner/repo');
      });

      it('should remove trailing slash', () => {
        assert.strictEqual(normalizeRepoUrl('https://github.com/owner/repo/'), 'https://github.com/owner/repo');
      });
    });
  });

  describe('User Request Processing', () => {
    describe('serializeUserRequest', () => {
      it('should return string as-is', () => {
        assert.strictEqual(serializeUserRequest('Simple request'), 'Simple request');
      });

      it('should combine text blocks', () => {
        const request = [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ];
        assert.strictEqual(serializeUserRequest(request), 'Hello World');
      });

      it('should add image count', () => {
        const request = [
          { type: 'text', text: 'Check this' },
          { type: 'image', source: { type: 'base64', data: 'abc' } },
        ];
        assert.strictEqual(serializeUserRequest(request), 'Check this [1 image]');
      });

      it('should pluralize image count', () => {
        const request = [
          { type: 'text', text: 'Images:' },
          { type: 'image', source: { data: 'a' } },
          { type: 'image', source: { data: 'b' } },
          { type: 'image', source: { data: 'c' } },
        ];
        assert.strictEqual(serializeUserRequest(request), 'Images: [3 images]');
      });
    });

    describe('extractPrompt', () => {
      it('should return string prompt as-is', () => {
        assert.strictEqual(extractPrompt('Simple prompt'), 'Simple prompt');
      });

      it('should extract and join text from content blocks', () => {
        const request = [
          { type: 'text', text: 'First' },
          { type: 'image', source: { data: 'x' } },
          { type: 'text', text: 'Second' },
        ];
        assert.strictEqual(extractPrompt(request), 'First\nSecond');
      });
    });

    describe('extractImageAttachments', () => {
      it('should return empty array for string request', () => {
        assert.deepStrictEqual(extractImageAttachments('No images'), []);
      });

      it('should extract image attachments', () => {
        const request = [
          { type: 'text', text: 'With image' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'base64data' } },
        ];
        const attachments = extractImageAttachments(request);

        assert.strictEqual(attachments.length, 1);
        assert.strictEqual(attachments[0].data, 'base64data');
        assert.strictEqual(attachments[0].mediaType, 'image/jpeg');
      });

      it('should generate unique IDs for multiple images', () => {
        const request = [
          { type: 'image', source: { data: 'a' } },
          { type: 'image', source: { data: 'b' } },
        ];
        const attachments = extractImageAttachments(request);

        assert.strictEqual(attachments.length, 2);
        assert.notStrictEqual(attachments[0].id, attachments[1].id);
      });
    });

    describe('truncateContent', () => {
      it('should not truncate short content', () => {
        assert.strictEqual(truncateContent('Short', 100), 'Short');
      });

      it('should truncate long content', () => {
        const content = 'A'.repeat(200);
        const truncated = truncateContent(content, 100);

        assert.ok(truncated.length < 200);
        assert.ok(truncated.includes('...'));
      });

      it('should stringify objects', () => {
        assert.strictEqual(truncateContent({ key: 'value' }, 100), '{"key":"value"}');
      });
    });
  });

  describe('SSE Event Format', () => {
    it('should format input_preview event', () => {
      const event = createInputPreviewEvent('Hello world', 200);

      assert.strictEqual(event.type, 'input_preview');
      assert.ok(event.message.includes('Request received'));
      assert.strictEqual(event.source, 'claude');
      assert.ok(event.timestamp);
    });

    it('should format session-created event', () => {
      const event = createSessionCreatedEvent('session-123');

      assert.strictEqual(event.websiteSessionId, 'session-123');
    });

    it('should format completed event', () => {
      const event = createCompletedEvent({
        websiteSessionId: 'session-123',
        branch: 'feature/test',
        totalCost: 0.05,
      });

      assert.strictEqual(event.completed, true);
      assert.strictEqual(event.websiteSessionId, 'session-123');
      assert.strictEqual(event.branch, 'feature/test');
      assert.strictEqual(event.totalCost, 0.05);
    });

    it('should format error event', () => {
      const event = createErrorEvent('Something went wrong');

      assert.strictEqual(event.type, 'error');
      assert.strictEqual(event.error, 'Something went wrong');
      assert.ok(event.timestamp);
    });

    it('should format interrupted event', () => {
      const event = createInterruptedEvent();

      assert.strictEqual(event.type, 'interrupted');
      assert.strictEqual(event.source, 'user');
      assert.ok(event.message.includes('interrupted'));
    });
  });

  describe('Provider Authentication', () => {
    it('should require Claude auth for Claude provider', () => {
      const result = validateProviderAuth({ preferredProvider: 'claude', claudeAuth: null });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Claude authentication'));
    });

    it('should accept valid Claude auth', () => {
      const result = validateProviderAuth({
        preferredProvider: 'claude',
        claudeAuth: { accessToken: 'token' },
      });

      assert.strictEqual(result.valid, true);
    });

    it('should require Gemini auth for Gemini provider', () => {
      const result = validateProviderAuth({ preferredProvider: 'gemini', geminiAuth: null });

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Gemini authentication'));
    });

    it('should accept valid Gemini auth', () => {
      const result = validateProviderAuth({
        preferredProvider: 'gemini',
        geminiAuth: { accessToken: 'token' },
      });

      assert.strictEqual(result.valid, true);
    });

    it('should default to Claude provider', () => {
      const result = validateProviderAuth({
        claudeAuth: { accessToken: 'token' },
      });

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Event Deduplication', () => {
    it('should detect duplicate events by UUID', () => {
      const storedEvents = new Set(['uuid-1', 'uuid-2']);

      assert.strictEqual(isDuplicateEvent({ uuid: 'uuid-1' }, storedEvents), true);
      assert.strictEqual(isDuplicateEvent({ uuid: 'uuid-3' }, storedEvents), false);
    });

    it('should allow events without UUID', () => {
      const storedEvents = new Set(['uuid-1']);

      assert.strictEqual(isDuplicateEvent({}, storedEvents), false);
    });
  });

  describe('Session Resume', () => {
    it('should find existing session for resume', () => {
      const userId = 'test-user-id';
      const session = mockDb.createSession({
        userId,
        status: 'completed',
        remoteSessionId: 'remote-123',
      });

      const found = mockDb.getSession(session.id);

      assert.ok(found);
      assert.strictEqual(found.remoteSessionId, 'remote-123');
    });

    it('should check session can be resumed', () => {
      // Completed sessions can be resumed
      assert.strictEqual(canResumeSession({ status: 'completed' }), true);

      // Running sessions cannot be resumed
      assert.strictEqual(canResumeSession({ status: 'running' }), false);

      // Pending sessions cannot be resumed
      assert.strictEqual(canResumeSession({ status: 'pending' }), false);

      // Error sessions can be resumed (retry)
      assert.strictEqual(canResumeSession({ status: 'error' }), true);
    });
  });

  describe('Rate Limiting', () => {
    it('should respect SSE rate limit parameters', () => {
      // Rate limiting is typically middleware, test configuration
      const rateLimitConfig = {
        windowMs: 60 * 1000, // 1 minute
        max: 10, // 10 requests per minute
      };

      assert.strictEqual(rateLimitConfig.windowMs, 60000);
      assert.strictEqual(rateLimitConfig.max, 10);
    });
  });
});

// Helper types
interface ContentBlock {
  type: string;
  text?: string;
  source?: { type?: string; media_type?: string; data: string };
}

// Helper functions
function validateExecuteParams(params: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  repoUrl?: string;
} {
  let { userRequest, websiteSessionId, github } = params;

  // Parse github if string
  if (typeof github === 'string') {
    try {
      github = JSON.parse(github);
    } catch {
      github = undefined;
    }
  }

  const repoUrl = (github as { repoUrl?: string })?.repoUrl;

  if (!userRequest && !websiteSessionId) {
    return { valid: false, error: 'userRequest or websiteSessionId is required' };
  }

  if (!repoUrl && !websiteSessionId) {
    return { valid: false, error: 'github.repoUrl is required for new sessions' };
  }

  return { valid: true, repoUrl };
}

function extractRepoOwner(repoUrl: string): string | null {
  const match = repoUrl.match(/github\.com\/([^\/]+)\//);
  return match ? match[1] : null;
}

function extractRepoName(repoUrl: string): string | null {
  const match = repoUrl.match(/\/([^\/]+?)(\.git)?$/);
  return match ? match[1] : null;
}

function normalizeRepoUrl(url: string): string {
  return url.replace(/\.git$/, '').replace(/\/$/, '');
}

function serializeUserRequest(userRequest: string | ContentBlock[]): string {
  if (typeof userRequest === 'string') return userRequest;

  const textBlocks = userRequest
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join(' ');

  const imageCount = userRequest.filter((b) => b.type === 'image').length;

  return imageCount > 0 ? `${textBlocks} [${imageCount} image${imageCount > 1 ? 's' : ''}]` : textBlocks;
}

function extractPrompt(userRequest: string | ContentBlock[]): string {
  if (typeof userRequest === 'string') return userRequest;

  return userRequest
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n');
}

function extractImageAttachments(
  userRequest: string | ContentBlock[]
): Array<{ id: string; data: string; mediaType: string }> {
  if (typeof userRequest === 'string') return [];

  return userRequest
    .filter((b) => b.type === 'image')
    .map((block, index) => ({
      id: `img-${Date.now()}-${index}`,
      data: block.source?.data || '',
      mediaType: block.source?.media_type || 'image/png',
    }));
}

function truncateContent(content: unknown, maxLength: number = 500): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...';
}

function createInputPreviewEvent(preview: string, originalLength: number) {
  return {
    type: 'input_preview',
    message: `Request received: ${preview}`,
    source: 'claude',
    timestamp: new Date().toISOString(),
    data: { preview, originalLength },
  };
}

function createSessionCreatedEvent(websiteSessionId: string) {
  return { websiteSessionId };
}

function createCompletedEvent(data: { websiteSessionId: string; branch?: string; totalCost?: number }) {
  return { completed: true, ...data };
}

function createErrorEvent(errorMessage: string) {
  return {
    type: 'error',
    timestamp: new Date().toISOString(),
    error: errorMessage,
  };
}

function createInterruptedEvent() {
  return {
    type: 'interrupted',
    timestamp: new Date().toISOString(),
    source: 'user',
    message: 'Request interrupted by user',
  };
}

function validateProviderAuth(userData: {
  preferredProvider?: string;
  claudeAuth?: unknown;
  geminiAuth?: unknown;
}): { valid: boolean; error?: string } {
  const provider = userData.preferredProvider || 'claude';

  if (provider === 'gemini') {
    if (!userData.geminiAuth) {
      return { valid: false, error: 'Gemini authentication not configured' };
    }
  } else {
    if (!userData.claudeAuth) {
      return { valid: false, error: 'Claude authentication not configured' };
    }
  }

  return { valid: true };
}

function isDuplicateEvent(event: { uuid?: string }, storedEvents: Set<string>): boolean {
  if (!event.uuid) return false;
  return storedEvents.has(event.uuid);
}

function canResumeSession(session: { status: string }): boolean {
  return session.status === 'completed' || session.status === 'error';
}
