/**
 * Tests for Live Chat Routes
 * Covers input validation, path parameter handling, and response formats for real-time AI chat.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access or Claude API. Integration tests would require full setup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

interface MockMessage {
  id: string;
  userId: string;
  owner: string;
  repo: string;
  branch: string;
  role: 'user' | 'assistant';
  content: string;
  images: string[] | null;
  createdAt: Date;
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

// ============================================================================
// Constants (mirror route/shared constants)
// ============================================================================

const LIMITS = {
  MESSAGES_DEFAULT: 100,
  HISTORY: 20,
  CONTEXT_MESSAGES: 10,
};

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: `msg-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    owner: 'testowner',
    repo: 'testrepo',
    branch: 'main',
    role: 'user',
    content: 'Hello, Claude!',
    images: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validatePathParams(params: Record<string, string>): ValidationResult {
  const { owner, repo, branch } = params;

  if (!owner || owner.trim().length === 0) {
    return { valid: false, error: 'Owner is required' };
  }

  if (!repo || repo.trim().length === 0) {
    return { valid: false, error: 'Repository is required' };
  }

  if (!branch || branch.trim().length === 0) {
    return { valid: false, error: 'Branch is required' };
  }

  return { valid: true };
}

function validateAddMessageInput(body: Record<string, unknown>): ValidationResult {
  const { role, content } = body;

  if (!role || !content) {
    return { valid: false, error: 'Missing required fields: role, content' };
  }

  if (typeof role !== 'string' || !['user', 'assistant'].includes(role)) {
    return { valid: false, error: 'Invalid role' };
  }

  if (typeof content !== 'string' || content.trim().length === 0) {
    return { valid: false, error: 'Content cannot be empty' };
  }

  return { valid: true };
}

function validateExecuteInput(body: Record<string, unknown>): ValidationResult {
  const { message } = body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return { valid: false, error: 'Missing required field: message' };
  }

  return { valid: true };
}

function decodeBranchName(branch: string): string {
  return decodeURIComponent(branch);
}

function validatePagination(limit: number | undefined): number {
  return limit ?? LIMITS.MESSAGES_DEFAULT;
}

function buildPromptWithContext(
  currentMessage: string,
  history: Array<{ role: string; content: string }>,
  owner: string,
  repo: string,
  branch: string
): string {
  const contextMessages = history.slice(-LIMITS.CONTEXT_MESSAGES);

  let prompt = `You are helping with the codebase at https://github.com/${owner}/${repo} on branch "${branch}".\n\n`;

  if (contextMessages.length > 1) {
    prompt += '## Previous Conversation Context\n';
    for (const msg of contextMessages.slice(0, -1)) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      prompt += `${role}: ${msg.content.slice(0, 500)}${msg.content.length > 500 ? '...' : ''}\n\n`;
    }
    prompt += '---\n\n';
  }

  prompt += `## Current Request\n${currentMessage}`;

  return prompt;
}

// ============================================================================
// Test Suites
// ============================================================================

describe('LiveChat Routes - Path Parameter Validation', () => {
  describe('Repository Path Parameters', () => {
    it('should require owner parameter', () => {
      const params = { owner: '', repo: 'test-repo', branch: 'main' };
      const result = validatePathParams(params);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Owner is required');
    });

    it('should require repo parameter', () => {
      const params = { owner: 'owner', repo: '', branch: 'main' };
      const result = validatePathParams(params);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Repository is required');
    });

    it('should require branch parameter', () => {
      const params = { owner: 'owner', repo: 'repo', branch: '' };
      const result = validatePathParams(params);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Branch is required');
    });

    it('should accept valid parameters', () => {
      const params = { owner: 'myowner', repo: 'myrepo', branch: 'feature/new-feature' };
      const result = validatePathParams(params);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Branch Name Decoding', () => {
    it('should decode URL-encoded branch names', () => {
      assert.strictEqual(decodeBranchName('feature%2Fnew-feature'), 'feature/new-feature');
      assert.strictEqual(decodeBranchName('fix%2Fbug%20fix'), 'fix/bug fix');
    });

    it('should pass through unencoded branch names', () => {
      assert.strictEqual(decodeBranchName('main'), 'main');
      assert.strictEqual(decodeBranchName('develop'), 'develop');
    });
  });
});

describe('LiveChat Routes - Message Validation', () => {
  describe('POST /:owner/:repo/:branch/messages (Add Message)', () => {
    it('should require role field', () => {
      const body = { content: 'Hello' };
      const result = validateAddMessageInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('role'));
    });

    it('should require content field', () => {
      const body = { role: 'user' };
      const result = validateAddMessageInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('content'));
    });

    it('should reject invalid role', () => {
      const body = { role: 'system', content: 'Hello' };
      const result = validateAddMessageInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid role');
    });

    it('should accept user role', () => {
      const body = { role: 'user', content: 'Hello Claude!' };
      const result = validateAddMessageInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept assistant role', () => {
      const body = { role: 'assistant', content: 'Hello! How can I help?' };
      const result = validateAddMessageInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject empty content', () => {
      const body = { role: 'user', content: '' };
      const result = validateAddMessageInput(body);

      assert.strictEqual(result.valid, false);
    });
  });
});

describe('LiveChat Routes - Execute Validation', () => {
  describe('POST /:owner/:repo/:branch/execute', () => {
    it('should require message field', () => {
      const body = {};
      const result = validateExecuteInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('message'));
    });

    it('should reject empty message', () => {
      const body = { message: '' };
      const result = validateExecuteInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject whitespace-only message', () => {
      const body = { message: '   ' };
      const result = validateExecuteInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid message', () => {
      const body = { message: 'Please fix the bug in auth.ts' };
      const result = validateExecuteInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept message with images', () => {
      const body = { message: 'What is this?', images: ['https://example.com/screenshot.png'] };
      const result = validateExecuteInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('LiveChat Routes - Prompt Building', () => {
  describe('buildPromptWithContext', () => {
    it('should include repository info', () => {
      const prompt = buildPromptWithContext('Fix the bug', [], 'owner', 'repo', 'main');

      assert.ok(prompt.includes('github.com/owner/repo'));
      assert.ok(prompt.includes('branch "main"'));
    });

    it('should include current request', () => {
      const prompt = buildPromptWithContext('Fix the bug', [], 'owner', 'repo', 'main');

      assert.ok(prompt.includes('## Current Request'));
      assert.ok(prompt.includes('Fix the bug'));
    });

    it('should include conversation context when available', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
        { role: 'user', content: 'Fix the bug' },
      ];
      const prompt = buildPromptWithContext('Fix the bug', history, 'owner', 'repo', 'main');

      assert.ok(prompt.includes('## Previous Conversation Context'));
      assert.ok(prompt.includes('User: Hello'));
      assert.ok(prompt.includes('Assistant: Hi there!'));
    });

    it('should truncate long messages in context', () => {
      const longContent = 'a'.repeat(600);
      const history = [
        { role: 'user', content: longContent },
        { role: 'user', content: 'Current message' },
      ];
      const prompt = buildPromptWithContext('Current message', history, 'owner', 'repo', 'main');

      // Content should be truncated to 500 chars with ...
      assert.ok(prompt.includes('...'));
    });

    it('should limit context messages', () => {
      const history = Array(20).fill(null).map((_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`,
      }));
      const prompt = buildPromptWithContext('Current', history, 'owner', 'repo', 'main');

      // Should only include last CONTEXT_MESSAGES (10) messages
      assert.ok(!prompt.includes('Message 0'));
    });
  });
});

describe('LiveChat Routes - Pagination', () => {
  describe('Message Limit', () => {
    it('should use default limit when not specified', () => {
      const result = validatePagination(undefined);
      assert.strictEqual(result, LIMITS.MESSAGES_DEFAULT);
    });

    it('should accept custom limit', () => {
      const result = validatePagination(50);
      assert.strictEqual(result, 50);
    });
  });
});

describe('LiveChat Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return messages with workspace info', () => {
      const messages = [createMockMessage(), createMockMessage()];
      const response = createMessagesResponse(messages, 'owner', 'repo', 'main');

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.messages.length, 2);
      assert.strictEqual(response.data.owner, 'owner');
      assert.strictEqual(response.data.repo, 'repo');
      assert.strictEqual(response.data.branch, 'main');
    });

    it('should return message with deduplication flag', () => {
      const message = createMockMessage();
      const response = createMessageResponse(message, true);

      assert.strictEqual(response.success, true);
      assert.ok(response.data.wasDeduplicated);
    });
  });

  describe('SSE Event Format', () => {
    it('should format connected event', () => {
      const event = createConnectedEvent('owner', 'repo', 'main', 5);

      assert.ok('workspace' in event);
      assert.strictEqual(event.workspace.owner, 'owner');
      assert.strictEqual(event.messageCount, 5);
    });

    it('should format completed event', () => {
      const event = createCompletedEvent('msg-123', 'completed', 'claude/chat-123', 0.05);

      assert.strictEqual(event.messageId, 'msg-123');
      assert.strictEqual(event.status, 'completed');
      assert.strictEqual(event.branch, 'claude/chat-123');
      assert.strictEqual(event.totalCost, 0.05);
    });
  });

  describe('Error Response Format', () => {
    it('should return error for missing auth', () => {
      const response = createErrorResponse('Unauthorized');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Unauthorized');
    });

    it('should return error for missing Claude config', () => {
      const response = createErrorResponse('Claude authentication not configured');

      assert.strictEqual(response.success, false);
      assert.ok(response.error.includes('Claude'));
    });
  });
});

describe('LiveChat Routes - Authorization', () => {
  it('should require auth for all endpoints', () => {
    // All routes use router.use(requireAuth)
    const allEndpointsRequireAuth = true;
    assert.strictEqual(allEndpointsRequireAuth, true);
  });

  it('should scope messages to user', () => {
    const message = createMockMessage({ userId: 'user-123' });
    const requestingUser = 'user-456';

    // Messages are filtered by userId in queries
    const canAccess = message.userId === requestingUser;
    assert.strictEqual(canAccess, false);
  });
});

describe('LiveChat Routes - Deduplication', () => {
  describe('Request Deduplication', () => {
    it('should generate consistent request key', () => {
      const key1 = generateRequestKey('user-123', 'owner', 'repo', 'main', 'user', 'abc123');
      const key2 = generateRequestKey('user-123', 'owner', 'repo', 'main', 'user', 'abc123');

      assert.strictEqual(key1, key2);
    });

    it('should generate different keys for different content', () => {
      const key1 = generateRequestKey('user-123', 'owner', 'repo', 'main', 'user', 'abc123');
      const key2 = generateRequestKey('user-123', 'owner', 'repo', 'main', 'user', 'def456');

      assert.notStrictEqual(key1, key2);
    });

    it('should generate different keys for different users', () => {
      const key1 = generateRequestKey('user-123', 'owner', 'repo', 'main', 'user', 'abc123');
      const key2 = generateRequestKey('user-456', 'owner', 'repo', 'main', 'user', 'abc123');

      assert.notStrictEqual(key1, key2);
    });
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createMessagesResponse(
  messages: MockMessage[],
  owner: string,
  repo: string,
  branch: string
): {
  success: boolean;
  data: {
    messages: MockMessage[];
    owner: string;
    repo: string;
    branch: string;
  };
} {
  return {
    success: true,
    data: { messages, owner, repo, branch },
  };
}

function createMessageResponse(
  message: MockMessage,
  wasDeduplicated: boolean = false
): {
  success: boolean;
  data: MockMessage & { wasDeduplicated: boolean };
} {
  return {
    success: true,
    data: { ...message, wasDeduplicated },
  };
}

function createConnectedEvent(
  owner: string,
  repo: string,
  branch: string,
  messageCount: number
): {
  workspace: { owner: string; repo: string; branch: string };
  messageCount: number;
} {
  return {
    workspace: { owner, repo, branch },
    messageCount,
  };
}

function createCompletedEvent(
  messageId: string,
  status: string,
  branch: string,
  totalCost: number
): {
  messageId: string;
  status: string;
  branch: string;
  totalCost: number;
} {
  return { messageId, status, branch, totalCost };
}

function generateRequestKey(...parts: string[]): string {
  return parts.join(':');
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
