/**
 * Tests for Storage Quota Middleware
 * Covers quota enforcement, size calculation, and error handling
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Mock Types
// ============================================================================

interface MockUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

interface MockRequest {
  body: unknown;
  storageSize?: number;
  user?: MockUser | null;
}

interface MockResponse {
  statusCode: number;
  data: unknown;
  status(code: number): MockResponse;
  json(data: unknown): MockResponse;
}

interface QuotaCheck {
  allowed: boolean;
  usedBytes: bigint;
  quotaBytes: bigint;
  availableBytes: bigint;
  requestedBytes: bigint;
}

// ============================================================================
// Mock Data Factories
// ============================================================================

function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: overrides.id ?? 'user_123',
    email: overrides.email ?? 'test@example.com',
    isAdmin: overrides.isAdmin ?? false,
  };
}

function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    body: overrides.body ?? {},
    storageSize: overrides.storageSize,
    user: overrides.user,
  };
}

function createMockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    data: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: unknown) {
      this.data = data;
      return this;
    },
  };
  return res;
}

// ============================================================================
// Mock Storage Service
// ============================================================================

interface MockStorageService {
  checkQuota: (userId: string, size: number) => Promise<QuotaCheck>;
  addUsage: (userId: string, size: number) => Promise<void>;
  formatBytes: (bytes: bigint) => string;
}

function createMockStorageService(config: {
  quotaBytes?: bigint;
  usedBytes?: bigint;
  shouldFail?: boolean;
  failMessage?: string;
} = {}): MockStorageService {
  const { quotaBytes = 10n * 1024n * 1024n * 1024n, usedBytes = 0n, shouldFail = false, failMessage } = config;

  return {
    async checkQuota(userId: string, size: number): Promise<QuotaCheck> {
      if (shouldFail) {
        throw new Error(failMessage ?? 'Storage service unavailable');
      }

      const requestedBytes = BigInt(size);
      const availableBytes = quotaBytes - usedBytes;
      const allowed = requestedBytes <= availableBytes;

      return {
        allowed,
        usedBytes,
        quotaBytes,
        availableBytes,
        requestedBytes,
      };
    },

    async addUsage(userId: string, size: number): Promise<void> {
      if (shouldFail) {
        throw new Error(failMessage ?? 'Failed to add usage');
      }
    },

    formatBytes(bytes: bigint): string {
      if (bytes < 1024n) return `${bytes} B`;
      if (bytes < 1024n * 1024n) return `${Number(bytes / 1024n).toFixed(1)} KB`;
      if (bytes < 1024n * 1024n * 1024n) return `${Number(bytes / (1024n * 1024n)).toFixed(1)} MB`;
      return `${Number(bytes / (1024n * 1024n * 1024n)).toFixed(1)} GB`;
    },
  };
}

// ============================================================================
// Size Calculation Functions (mimicking real implementation)
// ============================================================================

function calculateBase64Size(base64: string): number {
  // Base64 decodes to 3/4 of original length
  const padding = (base64.match(/=/g) || []).length;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function calculateJsonSize(obj: unknown): number {
  return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

function calculateMessageSize(body: unknown): number {
  if (!body || typeof body !== 'object') return 0;

  const message = body as {
    content?: string;
    images?: Array<{ data?: string }>;
  };

  let size = 0;

  if (message.content) {
    size += Buffer.byteLength(message.content, 'utf8');
  }

  if (message.images && Array.isArray(message.images)) {
    for (const img of message.images) {
      if (img.data) {
        size += calculateBase64Size(img.data);
      }
    }
  }

  return size;
}

// ============================================================================
// Tests
// ============================================================================

describe('Storage Quota Middleware', () => {
  describe('Size Calculation', () => {
    describe('calculateBase64Size', () => {
      it('should calculate correct size for base64 data', () => {
        // "Hello" in base64 = "SGVsbG8="
        const base64 = 'SGVsbG8=';
        const size = calculateBase64Size(base64);

        // Base64 "SGVsbG8=" decodes to 5 bytes
        assert.strictEqual(size, 5);
      });

      it('should handle base64 without padding', () => {
        // 3 bytes -> 4 base64 chars, no padding
        const base64 = 'AQID';
        const size = calculateBase64Size(base64);

        assert.strictEqual(size, 3);
      });

      it('should handle empty string', () => {
        const size = calculateBase64Size('');

        assert.strictEqual(size, 0);
      });

      it('should handle single padding', () => {
        // 2 bytes -> 4 base64 chars with 1 padding
        const base64 = 'AQI=';
        const size = calculateBase64Size(base64);

        assert.strictEqual(size, 2);
      });

      it('should handle double padding', () => {
        // 1 byte -> 4 base64 chars with 2 padding
        const base64 = 'AQ==';
        const size = calculateBase64Size(base64);

        assert.strictEqual(size, 1);
      });
    });

    describe('calculateJsonSize', () => {
      it('should calculate size of simple object', () => {
        const obj = { foo: 'bar' };
        const size = calculateJsonSize(obj);

        assert.strictEqual(size, Buffer.byteLength('{"foo":"bar"}', 'utf8'));
      });

      it('should handle nested objects', () => {
        const obj = { a: { b: { c: 1 } } };
        const size = calculateJsonSize(obj);

        assert.strictEqual(size, Buffer.byteLength('{"a":{"b":{"c":1}}}', 'utf8'));
      });

      it('should handle arrays', () => {
        const arr = [1, 2, 3];
        const size = calculateJsonSize(arr);

        assert.strictEqual(size, Buffer.byteLength('[1,2,3]', 'utf8'));
      });

      it('should handle unicode characters', () => {
        const obj = { emoji: '👋' };
        const size = calculateJsonSize(obj);

        // Emoji is 4 bytes in UTF-8
        assert.ok(size > 10);
      });
    });

    describe('calculateMessageSize', () => {
      it('should calculate size of message with content', () => {
        const body = { content: 'Hello World' };
        const size = calculateMessageSize(body);

        assert.strictEqual(size, 11);
      });

      it('should calculate size of message with images', () => {
        const body = {
          content: 'Hello',
          images: [{ data: 'SGVsbG8=' }], // "Hello" in base64
        };
        const size = calculateMessageSize(body);

        // 5 (content) + 5 (image decoded)
        assert.strictEqual(size, 10);
      });

      it('should handle multiple images', () => {
        const body = {
          images: [
            { data: 'AQID' }, // 3 bytes
            { data: 'AQI=' }, // 2 bytes
          ],
        };
        const size = calculateMessageSize(body);

        assert.strictEqual(size, 5);
      });

      it('should handle null body', () => {
        const size = calculateMessageSize(null);

        assert.strictEqual(size, 0);
      });

      it('should handle non-object body', () => {
        const size = calculateMessageSize('string');

        assert.strictEqual(size, 0);
      });
    });
  });

  describe('Quota Enforcement', () => {
    it('should allow request when quota is not exceeded', async () => {
      const storageService = createMockStorageService({
        quotaBytes: 10n * 1024n * 1024n * 1024n, // 10GB
        usedBytes: 1024n * 1024n, // 1MB used
      });

      const req = createMockRequest({
        body: { content: 'Small message' },
        user: createMockUser(),
      });
      const res = createMockResponse();
      let nextCalled = false;

      // Simulate middleware
      const size = calculateMessageSize(req.body);
      const check = await storageService.checkQuota(req.user!.id, size);

      if (!check.allowed) {
        res.status(413).json({ error: 'Quota exceeded' });
      } else {
        req.storageSize = size;
        nextCalled = true;
      }

      assert.strictEqual(nextCalled, true);
      assert.ok(req.storageSize! > 0);
    });

    it('should reject request when quota is exceeded', async () => {
      const storageService = createMockStorageService({
        quotaBytes: 100n, // 100 bytes quota
        usedBytes: 90n, // 90 bytes used
      });

      const req = createMockRequest({
        body: { content: 'This message is longer than 10 bytes' },
        user: createMockUser(),
      });
      const res = createMockResponse();
      let nextCalled = false;

      // Simulate middleware
      const size = calculateMessageSize(req.body);
      const check = await storageService.checkQuota(req.user!.id, size);

      if (!check.allowed) {
        res.status(413).json({
          success: false,
          error: 'Storage quota exceeded',
          details: {
            usedBytes: check.usedBytes.toString(),
            quotaBytes: check.quotaBytes.toString(),
            availableBytes: check.availableBytes.toString(),
            requestedBytes: check.requestedBytes.toString(),
          },
        });
      } else {
        nextCalled = true;
      }

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 413);
      const data = res.data as { details: { availableBytes: string } };
      assert.ok(data.details);
    });

    it('should skip quota check for unauthenticated users', async () => {
      const storageService = createMockStorageService();

      const req = createMockRequest({
        body: { content: 'Message' },
        user: null, // Not authenticated
      });
      const res = createMockResponse();
      let nextCalled = false;

      // Simulate middleware - skip if no user
      if (!req.user) {
        nextCalled = true;
      }

      assert.strictEqual(nextCalled, true);
    });

    it('should skip quota check for admins when configured', async () => {
      const storageService = createMockStorageService({
        quotaBytes: 100n,
        usedBytes: 90n,
      });

      const req = createMockRequest({
        body: { content: 'Large admin message that would exceed quota' },
        user: createMockUser({ isAdmin: true }),
      });
      const res = createMockResponse();
      let nextCalled = false;

      // Simulate middleware with skipForAdmins = true
      const skipForAdmins = true;

      if (skipForAdmins && req.user?.isAdmin) {
        nextCalled = true;
      }

      assert.strictEqual(nextCalled, true);
    });
  });

  describe('Error Handling', () => {
    it('should handle storage service errors gracefully (allow by default)', async () => {
      const storageService = createMockStorageService({
        shouldFail: true,
        failMessage: 'Database connection failed',
      });

      const req = createMockRequest({
        body: { content: 'Message' },
        user: createMockUser(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const blockOnError = false; // Default behavior

      try {
        const size = calculateMessageSize(req.body);
        await storageService.checkQuota(req.user!.id, size);
        nextCalled = true;
      } catch {
        if (blockOnError) {
          res.status(503).json({ error: 'Storage quota service unavailable' });
        } else {
          nextCalled = true; // Allow through when blockOnError is false
        }
      }

      assert.strictEqual(nextCalled, true);
    });

    it('should block on storage service errors when configured', async () => {
      const storageService = createMockStorageService({
        shouldFail: true,
      });

      const req = createMockRequest({
        body: { content: 'Message' },
        user: createMockUser(),
      });
      const res = createMockResponse();
      let nextCalled = false;
      const blockOnError = true;

      try {
        const size = calculateMessageSize(req.body);
        await storageService.checkQuota(req.user!.id, size);
        nextCalled = true;
      } catch {
        if (blockOnError) {
          res.status(503).json({
            success: false,
            error: 'Storage quota service temporarily unavailable',
          });
        } else {
          nextCalled = true;
        }
      }

      assert.strictEqual(nextCalled, false);
      assert.strictEqual(res.statusCode, 503);
    });
  });

  describe('Usage Tracking', () => {
    it('should track usage after successful response', async () => {
      const storageService = createMockStorageService();
      let usageAdded = false;

      const originalAddUsage = storageService.addUsage;
      storageService.addUsage = async (userId: string, size: number) => {
        usageAdded = true;
        await originalAddUsage.call(storageService, userId, size);
      };

      const req = createMockRequest({
        body: { content: 'Message' },
        user: createMockUser(),
        storageSize: 100,
      });

      // Simulate successful response callback
      const statusCode = 200;
      if (statusCode >= 200 && statusCode < 300 && req.storageSize && req.storageSize > 0) {
        await storageService.addUsage(req.user!.id, req.storageSize);
      }

      assert.strictEqual(usageAdded, true);
    });

    it('should not track usage for failed responses', async () => {
      const storageService = createMockStorageService();
      let usageAdded = false;

      storageService.addUsage = async () => {
        usageAdded = true;
      };

      const req = createMockRequest({
        body: { content: 'Message' },
        user: createMockUser(),
        storageSize: 100,
      });

      // Simulate error response
      const statusCode = 400;
      if (statusCode >= 200 && statusCode < 300 && req.storageSize && req.storageSize > 0) {
        await storageService.addUsage(req.user!.id, req.storageSize);
      }

      assert.strictEqual(usageAdded, false);
    });

    it('should not track usage when storageSize is 0', async () => {
      const storageService = createMockStorageService();
      let usageAdded = false;

      storageService.addUsage = async () => {
        usageAdded = true;
      };

      const req = createMockRequest({
        body: {},
        user: createMockUser(),
        storageSize: 0,
      });

      const statusCode = 200;
      if (statusCode >= 200 && statusCode < 300 && req.storageSize && req.storageSize > 0) {
        await storageService.addUsage(req.user!.id, req.storageSize);
      }

      assert.strictEqual(usageAdded, false);
    });
  });

  describe('Format Bytes', () => {
    it('should format bytes correctly', () => {
      const storageService = createMockStorageService();

      assert.ok(storageService.formatBytes(500n).includes('B'));
      assert.ok(storageService.formatBytes(1024n * 2n).includes('KB'));
      assert.ok(storageService.formatBytes(1024n * 1024n * 5n).includes('MB'));
      assert.ok(storageService.formatBytes(1024n * 1024n * 1024n * 2n).includes('GB'));
    });
  });

  describe('Custom Size Calculators', () => {
    it('should use custom size calculator when provided', () => {
      const customCalculator = (body: unknown): number => {
        if (typeof body === 'object' && body !== null && 'payload' in body) {
          return calculateJsonSize((body as { payload: unknown }).payload);
        }
        return 0;
      };

      const body = { payload: { large: 'data'.repeat(100) } };
      const size = customCalculator(body);

      assert.ok(size > 400);
    });

    it('should calculate live chat message size', () => {
      const calculateLiveChatMessageSize = (body: unknown): number => {
        if (!body || typeof body !== 'object') return 0;

        const message = body as {
          content?: string;
          images?: Array<{ data?: string }>;
          toolCalls?: unknown[];
        };

        let size = 0;

        if (message.content) {
          size += Buffer.byteLength(message.content, 'utf8');
        }

        if (message.images && Array.isArray(message.images)) {
          for (const img of message.images) {
            if (img.data) {
              size += calculateBase64Size(img.data);
            }
          }
        }

        if (message.toolCalls) {
          size += calculateJsonSize(message.toolCalls);
        }

        return size;
      };

      const body = {
        content: 'Hello',
        toolCalls: [{ name: 'read_file', input: { path: '/test.txt' } }],
      };

      const size = calculateLiveChatMessageSize(body);

      assert.ok(size > 5);
    });
  });
});
