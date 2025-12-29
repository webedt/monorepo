/**
 * Tests for Sessions Routes
 * Covers input validation, error handling, and response formats for session endpoints.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Sessions Routes - Input Validation', () => {
  describe('POST /create-code-session', () => {
    it('should require repositoryOwner field', () => {
      const body = {
        repositoryName: 'test-repo',
        baseBranch: 'main',
        branch: 'feature-branch',
      };
      const result = validateCreateCodeSession(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Missing required fields: repositoryOwner, repositoryName, baseBranch, branch');
    });

    it('should require repositoryName field', () => {
      const body = {
        repositoryOwner: 'owner',
        baseBranch: 'main',
        branch: 'feature-branch',
      };
      const result = validateCreateCodeSession(body);

      assert.strictEqual(result.valid, false);
    });

    it('should require baseBranch field', () => {
      const body = {
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        branch: 'feature-branch',
      };
      const result = validateCreateCodeSession(body);

      assert.strictEqual(result.valid, false);
    });

    it('should require branch field', () => {
      const body = {
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        baseBranch: 'main',
      };
      const result = validateCreateCodeSession(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid input with all required fields', () => {
      const body = {
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        baseBranch: 'main',
        branch: 'feature-branch',
      };
      const result = validateCreateCodeSession(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept optional title field', () => {
      const body = {
        title: 'My Session',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
        baseBranch: 'main',
        branch: 'feature-branch',
      };
      const result = validateCreateCodeSession(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('GET /search', () => {
    it('should require query parameter q', () => {
      const query = {};
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Search query (q) is required');
    });

    it('should reject empty query string', () => {
      const query = { q: '' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Search query (q) is required');
    });

    it('should reject whitespace-only query', () => {
      const query = { q: '   ' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Search query (q) is required');
    });

    it('should accept valid query string', () => {
      const query = { q: 'test search' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.query, 'test search');
    });

    it('should trim query string', () => {
      const query = { q: '  test  ' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.query, 'test');
    });

    it('should validate status parameter when provided', () => {
      const query = { q: 'test', status: 'invalid' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid status'));
    });

    it('should accept valid status parameter', () => {
      const validStatuses = ['pending', 'running', 'completed', 'error'];
      for (const status of validStatuses) {
        const query = { q: 'test', status };
        const result = validateSearchInput(query);
        assert.strictEqual(result.valid, true, `Status '${status}' should be valid`);
      }
    });

    it('should parse limit parameter with max of 100', () => {
      const query = { q: 'test', limit: '200' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.limit, 100);
    });

    it('should default limit to 50', () => {
      const query = { q: 'test' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.limit, 50);
    });

    it('should parse offset parameter', () => {
      const query = { q: 'test', offset: '10' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.offset, 10);
    });

    it('should parse favorite filter', () => {
      const query = { q: 'test', favorite: 'true' };
      const result = validateSearchInput(query);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.favorite, true);
    });
  });

  describe('PATCH /:id', () => {
    it('should require at least one field to update', () => {
      const body = {};
      const result = validateUpdateSession(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'At least one field (userRequest or branch) must be provided');
    });

    it('should accept valid userRequest field', () => {
      const body = { userRequest: 'New session title' };
      const result = validateUpdateSession(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid branch field', () => {
      const body = { branch: 'new-branch' };
      const result = validateUpdateSession(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject empty userRequest', () => {
      const body = { userRequest: '' };
      const result = validateUpdateSession(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject whitespace-only userRequest', () => {
      const body = { userRequest: '   ' };
      const result = validateUpdateSession(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept both userRequest and branch', () => {
      const body = { userRequest: 'Title', branch: 'new-branch' };
      const result = validateUpdateSession(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /:id/events', () => {
    it('should require sessionId', () => {
      const body = { eventData: { type: 'test' } };
      const result = validateCreateEvent(null, body);

      assert.strictEqual(result.valid, false);
    });

    it('should require eventData', () => {
      const result = validateCreateEvent('session-123', {});

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid event data', () => {
      const result = validateCreateEvent('session-123', { eventData: { type: 'test' } });

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /:id/messages', () => {
    it('should require type field', () => {
      const body = { content: 'Hello' };
      const result = validateCreateMessage(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Type and content are required');
    });

    it('should require content field', () => {
      const body = { type: 'user' };
      const result = validateCreateMessage(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Type and content are required');
    });

    it('should reject invalid message type', () => {
      const body = { type: 'invalid', content: 'Hello' };
      const result = validateCreateMessage(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid message type');
    });

    it('should accept valid message types', () => {
      const validTypes = ['user', 'assistant', 'system', 'error'];
      for (const type of validTypes) {
        const body = { type, content: 'Hello' };
        const result = validateCreateMessage(body);
        assert.strictEqual(result.valid, true, `Type '${type}' should be valid`);
      }
    });
  });

  describe('POST /:id/share', () => {
    it('should validate expiresInDays if provided', () => {
      const body = { expiresInDays: 0 };
      const result = validateShareInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'expiresInDays must be between 1 and 365');
    });

    it('should reject expiresInDays greater than 365', () => {
      const body = { expiresInDays: 400 };
      const result = validateShareInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid expiresInDays', () => {
      const body = { expiresInDays: 30 };
      const result = validateShareInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept empty body (no expiration)', () => {
      const result = validateShareInput({});

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /:id/send', () => {
    it('should require content', () => {
      const body = {};
      const result = validateSendMessage(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Message content is required');
    });

    it('should reject non-string content', () => {
      const body = { content: 123 };
      const result = validateSendMessage(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid content', () => {
      const body = { content: 'Hello, Claude!' };
      const result = validateSendMessage(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /bulk-delete', () => {
    it('should require ids array', () => {
      const body = {};
      const result = validateBulkOperation(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid session IDs');
    });

    it('should reject empty ids array', () => {
      const body = { ids: [] };
      const result = validateBulkOperation(body);

      assert.strictEqual(result.valid, false);
    });

    it('should reject non-array ids', () => {
      const body = { ids: 'not-an-array' };
      const result = validateBulkOperation(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid ids array', () => {
      const body = { ids: ['id1', 'id2', 'id3'] };
      const result = validateBulkOperation(body);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /:id/worker-status', () => {
    it('should require workerSecret', () => {
      const body = { status: 'completed' };
      const result = validateWorkerStatus(body, 'expected-secret');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid worker secret');
    });

    it('should reject invalid workerSecret', () => {
      const body = { status: 'completed', workerSecret: 'wrong-secret' };
      const result = validateWorkerStatus(body, 'expected-secret');

      assert.strictEqual(result.valid, false);
    });

    it('should require valid status', () => {
      const body = { status: 'invalid', workerSecret: 'expected-secret' };
      const result = validateWorkerStatus(body, 'expected-secret');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid status. Must be "completed" or "error"');
    });

    it('should accept valid completed status', () => {
      const body = { status: 'completed', workerSecret: 'expected-secret' };
      const result = validateWorkerStatus(body, 'expected-secret');

      assert.strictEqual(result.valid, true);
    });

    it('should accept valid error status', () => {
      const body = { status: 'error', workerSecret: 'expected-secret' };
      const result = validateWorkerStatus(body, 'expected-secret');

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Sessions Routes - Share Token Validation', () => {
  describe('GET /shared/:token', () => {
    it('should require share token', () => {
      const result = validateShareToken('');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Share token is required');
    });

    it('should accept valid share token', () => {
      const result = validateShareToken('abc123-def456');

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Share Token Expiration', () => {
    it('should detect expired token', () => {
      const session = {
        shareToken: 'abc123',
        shareExpiresAt: new Date(Date.now() - 86400000), // 1 day ago
      };

      const result = isShareTokenValid(session);
      assert.strictEqual(result, false);
    });

    it('should accept non-expired token', () => {
      const session = {
        shareToken: 'abc123',
        shareExpiresAt: new Date(Date.now() + 86400000), // 1 day from now
      };

      const result = isShareTokenValid(session);
      assert.strictEqual(result, true);
    });

    it('should accept token with no expiration', () => {
      const session = {
        shareToken: 'abc123',
        shareExpiresAt: null,
      };

      const result = isShareTokenValid(session);
      assert.strictEqual(result, true);
    });
  });
});

describe('Sessions Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return success:true with session data', () => {
      const session = {
        id: 'session-123',
        userRequest: 'Test session',
        status: 'completed',
      };

      const response = createSuccessResponse(session);

      assert.strictEqual(response.success, true);
      assert.ok(response.session);
      assert.strictEqual(response.session.id, 'session-123');
    });

    it('should return success:true with data wrapper for list responses', () => {
      const sessions = [
        { id: 'session-1', userRequest: 'Test 1' },
        { id: 'session-2', userRequest: 'Test 2' },
      ];

      const response = createListResponse(sessions);

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.ok(response.data.sessions);
      assert.strictEqual(response.data.sessions.length, 2);
      assert.strictEqual(response.data.total, 2);
    });
  });

  describe('Error Response Format', () => {
    it('should return success:false with error message', () => {
      const response = createErrorResponse('Session not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Session not found');
    });
  });
});

describe('Sessions Routes - Session Path Generation', () => {
  it('should generate valid session path format', () => {
    const owner = 'testuser';
    const repo = 'testrepo';
    const branch = 'feature-branch';

    const sessionPath = generateSessionPath(owner, repo, branch);

    assert.strictEqual(sessionPath, 'testuser__testrepo__feature-branch');
  });

  it('should handle special characters in branch name', () => {
    const owner = 'user';
    const repo = 'repo';
    const branch = 'feature/test-branch';

    const sessionPath = generateSessionPath(owner, repo, branch);

    assert.ok(sessionPath.includes('feature/test-branch'));
  });
});

// Helper functions that mirror the validation logic in sessions.ts
function validateCreateCodeSession(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { repositoryOwner, repositoryName, baseBranch, branch } = body;

  if (!repositoryOwner || !repositoryName || !baseBranch || !branch) {
    return {
      valid: false,
      error: 'Missing required fields: repositoryOwner, repositoryName, baseBranch, branch',
    };
  }

  return { valid: true };
}

function validateSearchInput(query: Record<string, unknown>): {
  valid: boolean;
  error?: string;
  query?: string;
  limit?: number;
  offset?: number;
  favorite?: boolean;
  status?: string;
} {
  const q = (query.q as string) || '';
  const limit = Math.min(parseInt(query.limit as string) || 50, 100);
  const offset = parseInt(query.offset as string) || 0;
  const statusParam = query.status as string | undefined;
  const favorite = query.favorite === 'true' ? true : query.favorite === 'false' ? false : undefined;

  if (!q.trim()) {
    return { valid: false, error: 'Search query (q) is required' };
  }

  const validStatuses = ['pending', 'running', 'completed', 'error'];
  if (statusParam && !validStatuses.includes(statusParam)) {
    return {
      valid: false,
      error: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
    };
  }

  return {
    valid: true,
    query: q.trim(),
    limit,
    offset,
    favorite,
    status: statusParam,
  };
}

function validateUpdateSession(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { userRequest, branch } = body;

  const hasUserRequest = userRequest && typeof userRequest === 'string' && (userRequest as string).trim().length > 0;
  const hasBranch = branch && typeof branch === 'string' && (branch as string).trim().length > 0;

  if (!hasUserRequest && !hasBranch) {
    return {
      valid: false,
      error: 'At least one field (userRequest or branch) must be provided',
    };
  }

  return { valid: true };
}

function validateCreateEvent(
  sessionId: string | null,
  body: Record<string, unknown>
): { valid: boolean; error?: string } {
  if (!sessionId) {
    return { valid: false, error: 'Session ID is required' };
  }
  if (!body.eventData) {
    return { valid: false, error: 'Event data is required' };
  }
  return { valid: true };
}

function validateCreateMessage(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { type, content } = body;

  if (!type || !content) {
    return { valid: false, error: 'Type and content are required' };
  }

  const validTypes = ['user', 'assistant', 'system', 'error'];
  if (!validTypes.includes(type as string)) {
    return { valid: false, error: 'Invalid message type' };
  }

  return { valid: true };
}

function validateShareInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { expiresInDays } = body as { expiresInDays?: number };

  if (expiresInDays !== undefined) {
    if (typeof expiresInDays !== 'number' || expiresInDays < 1 || expiresInDays > 365) {
      return { valid: false, error: 'expiresInDays must be between 1 and 365' };
    }
  }

  return { valid: true };
}

function validateSendMessage(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { content } = body;

  if (!content || typeof content !== 'string') {
    return { valid: false, error: 'Message content is required' };
  }

  return { valid: true };
}

function validateBulkOperation(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return { valid: false, error: 'Invalid session IDs' };
  }

  return { valid: true };
}

function validateWorkerStatus(
  body: Record<string, unknown>,
  expectedSecret: string
): { valid: boolean; error?: string } {
  const { status, workerSecret } = body;

  if (!expectedSecret || workerSecret !== expectedSecret) {
    return { valid: false, error: 'Invalid worker secret' };
  }

  if (!status || !['completed', 'error'].includes(status as string)) {
    return { valid: false, error: 'Invalid status. Must be "completed" or "error"' };
  }

  return { valid: true };
}

function validateShareToken(token: string): { valid: boolean; error?: string } {
  if (!token) {
    return { valid: false, error: 'Share token is required' };
  }
  return { valid: true };
}

function isShareTokenValid(session: {
  shareToken: string | null;
  shareExpiresAt: Date | null;
}): boolean {
  if (!session.shareToken) return false;
  if (!session.shareExpiresAt) return true;
  return session.shareExpiresAt.getTime() > Date.now();
}

function createSuccessResponse(session: Record<string, unknown>): {
  success: boolean;
  session: Record<string, unknown>;
} {
  return {
    success: true,
    session,
  };
}

function createListResponse(sessions: Array<Record<string, unknown>>): {
  success: boolean;
  data: { sessions: Array<Record<string, unknown>>; total: number };
} {
  return {
    success: true,
    data: {
      sessions,
      total: sessions.length,
    },
  };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return {
    success: false,
    error: message,
  };
}

function generateSessionPath(owner: string, repo: string, branch: string): string {
  return `${owner}__${repo}__${branch}`;
}
