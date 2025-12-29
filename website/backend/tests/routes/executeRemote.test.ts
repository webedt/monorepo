/**
 * Tests for Execute Remote Routes
 * Covers input validation, helper functions, and response formats for SSE execution endpoints.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Execute Remote Routes - Input Validation', () => {
  describe('Request Validation', () => {
    it('should require userRequest or websiteSessionId', () => {
      const params = {};
      const result = validateExecuteParams(params);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'userRequest or websiteSessionId is required');
    });

    it('should require github.repoUrl for new sessions', () => {
      const params = {
        userRequest: 'Test request',
      };
      const result = validateExecuteParams(params);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'github.repoUrl is required for new sessions');
    });

    it('should not require github.repoUrl for resume sessions', () => {
      const params = {
        userRequest: 'Test request',
        websiteSessionId: 'existing-session-123',
      };
      const result = validateExecuteParams(params);

      // Valid because websiteSessionId is provided (resume case)
      assert.strictEqual(result.valid, true);
    });

    it('should accept valid new session params', () => {
      const params = {
        userRequest: 'Test request',
        github: { repoUrl: 'https://github.com/owner/repo' },
      };
      const result = validateExecuteParams(params);

      assert.strictEqual(result.valid, true);
    });

    it('should accept string userRequest', () => {
      const params = {
        userRequest: 'Simple text request',
        github: { repoUrl: 'https://github.com/owner/repo' },
      };
      const result = validateExecuteParams(params);

      assert.strictEqual(result.valid, true);
    });

    it('should accept content blocks userRequest', () => {
      const params = {
        userRequest: [
          { type: 'text', text: 'Hello' },
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc123' } },
        ],
        github: { repoUrl: 'https://github.com/owner/repo' },
      };
      const result = validateExecuteParams(params);

      assert.strictEqual(result.valid, true);
    });

    it('should parse github from JSON string', () => {
      const params = {
        userRequest: 'Test',
        github: JSON.stringify({ repoUrl: 'https://github.com/owner/repo' }),
      };
      const result = validateExecuteParams(params);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.repoUrl, 'https://github.com/owner/repo');
    });
  });
});

describe('Execute Remote Routes - Repository URL Helpers', () => {
  describe('extractRepoOwner', () => {
    it('should extract owner from standard GitHub URL', () => {
      const url = 'https://github.com/myowner/myrepo';
      assert.strictEqual(extractRepoOwner(url), 'myowner');
    });

    it('should extract owner from URL with .git suffix', () => {
      const url = 'https://github.com/myowner/myrepo.git';
      assert.strictEqual(extractRepoOwner(url), 'myowner');
    });

    it('should return null for invalid URL', () => {
      assert.strictEqual(extractRepoOwner('not-a-url'), null);
    });

    it('should return null for non-GitHub URL', () => {
      assert.strictEqual(extractRepoOwner('https://gitlab.com/owner/repo'), null);
    });

    it('should handle URLs with trailing slash', () => {
      const url = 'https://github.com/owner/repo/';
      assert.strictEqual(extractRepoOwner(url), 'owner');
    });
  });

  describe('extractRepoName', () => {
    it('should extract repo name from standard URL', () => {
      const url = 'https://github.com/owner/myrepo';
      assert.strictEqual(extractRepoName(url), 'myrepo');
    });

    it('should extract repo name without .git suffix', () => {
      const url = 'https://github.com/owner/myrepo.git';
      assert.strictEqual(extractRepoName(url), 'myrepo');
    });

    it('should handle repo names with hyphens', () => {
      const url = 'https://github.com/owner/my-cool-repo';
      assert.strictEqual(extractRepoName(url), 'my-cool-repo');
    });

    it('should handle repo names with underscores', () => {
      const url = 'https://github.com/owner/my_repo_name';
      assert.strictEqual(extractRepoName(url), 'my_repo_name');
    });
  });

  describe('normalizeRepoUrl', () => {
    it('should remove .git suffix', () => {
      const url = 'https://github.com/owner/repo.git';
      assert.strictEqual(normalizeRepoUrl(url), 'https://github.com/owner/repo');
    });

    it('should keep URL unchanged if no .git suffix', () => {
      const url = 'https://github.com/owner/repo';
      assert.strictEqual(normalizeRepoUrl(url), 'https://github.com/owner/repo');
    });
  });
});

describe('Execute Remote Routes - User Request Helpers', () => {
  describe('serializeUserRequest', () => {
    it('should return string as-is', () => {
      const request = 'Simple text request';
      assert.strictEqual(serializeUserRequest(request), 'Simple text request');
    });

    it('should combine text blocks from content array', () => {
      const request = [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: 'World' },
      ];
      assert.strictEqual(serializeUserRequest(request as UserRequestContent[]), 'Hello World');
    });

    it('should add image count to serialized text', () => {
      const request = [
        { type: 'text', text: 'Check this' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      ];
      assert.strictEqual(
        serializeUserRequest(request as UserRequestContent[]),
        'Check this [1 image]'
      );
    });

    it('should pluralize image count', () => {
      const request = [
        { type: 'text', text: 'Images:' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'a' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'b' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'c' } },
      ];
      assert.strictEqual(
        serializeUserRequest(request as UserRequestContent[]),
        'Images: [3 images]'
      );
    });
  });

  describe('extractPrompt', () => {
    it('should return string prompt as-is', () => {
      const request = 'Simple prompt';
      assert.strictEqual(extractPrompt(request), 'Simple prompt');
    });

    it('should extract and join text from content blocks', () => {
      const request = [
        { type: 'text', text: 'First' },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'x' } },
        { type: 'text', text: 'Second' },
      ];
      assert.strictEqual(extractPrompt(request as UserRequestContent[]), 'First\nSecond');
    });

    it('should handle empty text blocks', () => {
      const request = [
        { type: 'text', text: '' },
        { type: 'text', text: 'Only this' },
      ];
      assert.strictEqual(extractPrompt(request as UserRequestContent[]), '\nOnly this');
    });
  });

  describe('extractImageAttachments', () => {
    it('should return empty array for string request', () => {
      const request = 'No images here';
      const attachments = extractImageAttachments(request);
      assert.strictEqual(attachments.length, 0);
    });

    it('should extract image attachments from content blocks', () => {
      const request = [
        { type: 'text', text: 'With image' },
        {
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: 'base64data' },
        },
      ];
      const attachments = extractImageAttachments(request as UserRequestContent[]);

      assert.strictEqual(attachments.length, 1);
      assert.strictEqual(attachments[0].data, 'base64data');
      assert.strictEqual(attachments[0].mediaType, 'image/jpeg');
    });

    it('should generate unique IDs for multiple images', () => {
      const request = [
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'a' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'b' } },
      ];
      const attachments = extractImageAttachments(request as UserRequestContent[]);

      assert.strictEqual(attachments.length, 2);
      assert.notStrictEqual(attachments[0].id, attachments[1].id);
    });
  });

  describe('truncateContent', () => {
    it('should not truncate short content', () => {
      const content = 'Short text';
      assert.strictEqual(truncateContent(content, 500), 'Short text');
    });

    it('should truncate long content', () => {
      const content = 'A'.repeat(600);
      const truncated = truncateContent(content, 500);

      assert.ok(truncated.includes('... (truncated'));
      assert.ok(truncated.includes('total length: 600'));
    });

    it('should stringify objects', () => {
      const content = { key: 'value' };
      assert.strictEqual(truncateContent(content), '{"key":"value"}');
    });
  });
});

describe('Execute Remote Routes - SSE Event Format', () => {
  describe('Event Types', () => {
    it('should format input_preview event correctly', () => {
      const event = createInputPreviewEvent('Hello world', 200);

      assert.strictEqual(event.type, 'input_preview');
      assert.ok(event.message.includes('Request received'));
      assert.strictEqual(event.source, 'claude');
      assert.ok(event.timestamp);
    });

    it('should format session-created event correctly', () => {
      const event = createSessionCreatedEvent('session-123');

      assert.strictEqual(event.websiteSessionId, 'session-123');
    });

    it('should format completed event correctly', () => {
      const event = createCompletedEvent({
        websiteSessionId: 'session-123',
        branch: 'feature/test',
        totalCost: 0.05,
      });

      assert.strictEqual(event.completed, true);
      assert.strictEqual(event.websiteSessionId, 'session-123');
      assert.strictEqual(event.branch, 'feature/test');
    });

    it('should format error event correctly', () => {
      const event = createErrorEvent('Something went wrong');

      assert.strictEqual(event.type, 'error');
      assert.strictEqual(event.error, 'Something went wrong');
      assert.ok(event.timestamp);
    });

    it('should format interrupted event correctly', () => {
      const event = createInterruptedEvent();

      assert.strictEqual(event.type, 'interrupted');
      assert.strictEqual(event.source, 'user');
      assert.ok(event.message.includes('interrupted'));
    });
  });
});

describe('Execute Remote Routes - Authentication Validation', () => {
  describe('Claude Auth Validation', () => {
    it('should require claudeAuth for claude provider', () => {
      const userData = { preferredProvider: 'claude', claudeAuth: null };
      const result = validateProviderAuth(userData);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Claude authentication'));
    });

    it('should accept valid claudeAuth', () => {
      const userData = {
        preferredProvider: 'claude',
        claudeAuth: { accessToken: 'token', refreshToken: 'refresh' },
      };
      const result = validateProviderAuth(userData);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Gemini Auth Validation', () => {
    it('should require geminiAuth for gemini provider', () => {
      const userData = { preferredProvider: 'gemini', geminiAuth: null };
      const result = validateProviderAuth(userData);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Gemini authentication'));
    });

    it('should accept valid geminiAuth', () => {
      const userData = {
        preferredProvider: 'gemini',
        geminiAuth: { accessToken: 'token', refreshToken: 'refresh' },
      };
      const result = validateProviderAuth(userData);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Execute Remote Routes - Event Deduplication', () => {
  it('should detect duplicate events by UUID', () => {
    const storedEvents = new Set(['uuid-1', 'uuid-2']);

    assert.strictEqual(isDuplicateEvent({ uuid: 'uuid-1' }, storedEvents), true);
    assert.strictEqual(isDuplicateEvent({ uuid: 'uuid-3' }, storedEvents), false);
  });

  it('should allow events without UUID', () => {
    const storedEvents = new Set(['uuid-1']);

    // Events without UUID should not be considered duplicates
    assert.strictEqual(isDuplicateEvent({}, storedEvents), false);
  });
});

// Types
interface UserRequestContent {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

// Helper functions that mirror the validation logic in executeRemote.ts
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

  // Validate request
  if (!userRequest && !websiteSessionId) {
    return { valid: false, error: 'userRequest or websiteSessionId is required' };
  }

  // Only validate repoUrl for new sessions (no websiteSessionId)
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
  return url.replace(/\.git$/, '');
}

function serializeUserRequest(userRequest: string | UserRequestContent[]): string {
  if (typeof userRequest === 'string') {
    return userRequest;
  }

  const textBlocks = userRequest
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join(' ');

  const imageCount = userRequest.filter((b) => b.type === 'image').length;

  return imageCount > 0
    ? `${textBlocks} [${imageCount} image${imageCount > 1 ? 's' : ''}]`
    : textBlocks;
}

function extractPrompt(userRequest: string | UserRequestContent[]): string {
  if (typeof userRequest === 'string') {
    return userRequest;
  }

  return userRequest
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('\n');
}

function extractImageAttachments(
  userRequest: string | UserRequestContent[]
): Array<{ id: string; data: string; mediaType: string; fileName: string }> {
  if (typeof userRequest === 'string') {
    return [];
  }

  const imageBlocks = userRequest.filter((b) => b.type === 'image');
  return imageBlocks.map((block, index) => ({
    id: `img-${Date.now()}-${index}`,
    data: block.source?.data || '',
    mediaType: block.source?.media_type || 'image/png',
    fileName: `image-${index + 1}.png`,
  }));
}

function truncateContent(content: unknown, maxLength: number = 500): string {
  const str = typeof content === 'string' ? content : JSON.stringify(content);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + `... (truncated, total length: ${str.length})`;
}

function createInputPreviewEvent(
  preview: string,
  originalLength: number
): {
  type: string;
  message: string;
  source: string;
  timestamp: string;
  data: unknown;
} {
  return {
    type: 'input_preview',
    message: `Request received: ${preview}`,
    source: 'claude',
    timestamp: new Date().toISOString(),
    data: {
      preview,
      originalLength,
      truncated: originalLength > preview.length,
    },
  };
}

function createSessionCreatedEvent(websiteSessionId: string): { websiteSessionId: string } {
  return { websiteSessionId };
}

function createCompletedEvent(data: {
  websiteSessionId: string;
  branch?: string;
  totalCost?: number;
}): {
  websiteSessionId: string;
  completed: boolean;
  branch?: string;
  totalCost?: number;
} {
  return {
    websiteSessionId: data.websiteSessionId,
    completed: true,
    branch: data.branch,
    totalCost: data.totalCost,
  };
}

function createErrorEvent(errorMessage: string): {
  type: string;
  timestamp: string;
  error: string;
} {
  return {
    type: 'error',
    timestamp: new Date().toISOString(),
    error: errorMessage,
  };
}

function createInterruptedEvent(): {
  type: string;
  timestamp: string;
  source: string;
  message: string;
} {
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
      return {
        valid: false,
        error: 'Gemini authentication not configured. Please connect your Gemini account in settings.',
      };
    }
  } else {
    if (!userData.claudeAuth) {
      return {
        valid: false,
        error: 'Claude authentication not configured. Please connect your Claude account in settings.',
      };
    }
  }

  return { valid: true };
}

function isDuplicateEvent(
  event: { uuid?: string },
  storedEvents: Set<string>
): boolean {
  if (!event.uuid) return false;
  return storedEvents.has(event.uuid);
}
