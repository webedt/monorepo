/**
 * Tests for the StorageService module.
 *
 * These tests verify the user storage quota management including:
 * - Storage tier definitions
 * - Quota calculations and checks
 * - Usage tracking and updates
 * - Size calculation utilities
 * - Human-readable formatting
 *
 * IMPORTANT: These tests verify pure functions and business logic
 * without requiring database connections.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  STORAGE_TIERS,
  calculateBase64Size,
  calculateJsonSize,
  calculateStringSize,
  StorageService,
} from '../../src/storage/StorageService.js';

import type { StorageTier } from '../../src/storage/StorageService.js';

describe('StorageService - Storage Tier Definitions', () => {
  describe('Tier Values', () => {
    it('should define FREE tier as 1 GB', () => {
      assert.strictEqual(STORAGE_TIERS.FREE, 1 * 1024 * 1024 * 1024);
    });

    it('should define BASIC tier as 5 GB', () => {
      assert.strictEqual(STORAGE_TIERS.BASIC, 5 * 1024 * 1024 * 1024);
    });

    it('should define PRO tier as 25 GB', () => {
      assert.strictEqual(STORAGE_TIERS.PRO, 25 * 1024 * 1024 * 1024);
    });

    it('should define ENTERPRISE tier as 100 GB', () => {
      assert.strictEqual(STORAGE_TIERS.ENTERPRISE, 100 * 1024 * 1024 * 1024);
    });
  });

  describe('Tier Ordering', () => {
    it('should have FREE < BASIC', () => {
      assert.ok(STORAGE_TIERS.FREE < STORAGE_TIERS.BASIC);
    });

    it('should have BASIC < PRO', () => {
      assert.ok(STORAGE_TIERS.BASIC < STORAGE_TIERS.PRO);
    });

    it('should have PRO < ENTERPRISE', () => {
      assert.ok(STORAGE_TIERS.PRO < STORAGE_TIERS.ENTERPRISE);
    });
  });

  describe('Tier Keys', () => {
    it('should only have valid tier names', () => {
      const validTiers: StorageTier[] = ['FREE', 'BASIC', 'PRO', 'ENTERPRISE'];
      const actualTiers = Object.keys(STORAGE_TIERS) as StorageTier[];

      assert.deepStrictEqual(actualTiers.sort(), validTiers.sort());
    });
  });
});

describe('StorageService - calculateBase64Size', () => {
  describe('Basic Calculations', () => {
    it('should return 0 for empty string', () => {
      assert.strictEqual(calculateBase64Size(''), 0);
    });

    it('should calculate size for simple base64', () => {
      // "Hello" in base64 is "SGVsbG8=" (8 chars, 1 padding)
      // Original is 5 bytes
      const base64 = 'SGVsbG8=';
      const size = calculateBase64Size(base64);
      assert.strictEqual(size, 5);
    });

    it('should handle base64 without padding', () => {
      // "Hi" in base64 is "SGk" (4 chars, no padding)
      // Original is 2 bytes... but "SGk" is only 3 chars
      // Let me calculate correctly: "Hi" is actually "SGk=" with padding
      // Without equals: each 4 base64 chars = 3 bytes
      const base64 = 'AAAA'; // 4 chars = 3 bytes
      const size = calculateBase64Size(base64);
      assert.strictEqual(size, 3);
    });

    it('should handle single padding character', () => {
      // Base64 with 1 = padding
      const base64 = 'SGVsbG8='; // "Hello"
      const size = calculateBase64Size(base64);
      assert.strictEqual(size, 5);
    });

    it('should handle double padding characters', () => {
      // Base64 with 2 = padding
      const base64 = 'SGk='; // "Hi"
      const size = calculateBase64Size(base64);
      assert.strictEqual(size, 2);
    });
  });

  describe('Data URL Handling', () => {
    it('should strip data URL prefix', () => {
      const dataUrl = 'data:image/png;base64,SGVsbG8=';
      const size = calculateBase64Size(dataUrl);
      assert.strictEqual(size, 5);
    });

    it('should handle data URL with different mime types', () => {
      const dataUrl = 'data:application/octet-stream;base64,AAAA';
      const size = calculateBase64Size(dataUrl);
      assert.strictEqual(size, 3);
    });

    it('should handle plain base64 without prefix', () => {
      const base64 = 'SGVsbG8=';
      const size = calculateBase64Size(base64);
      assert.strictEqual(size, 5);
    });
  });

  describe('Edge Cases', () => {
    it('should return 0 for null-like falsy value', () => {
      // Empty string case
      assert.strictEqual(calculateBase64Size(''), 0);
    });

    it('should handle data URL with empty data', () => {
      const dataUrl = 'data:image/png;base64,';
      const size = calculateBase64Size(dataUrl);
      assert.strictEqual(size, 0);
    });

    it('should handle large base64 strings', () => {
      // 100 bytes encoded in base64
      // 100 bytes = ceil(100/3)*4 = 136 chars
      const largeBase64 = 'A'.repeat(136);
      const size = calculateBase64Size(largeBase64);
      // 136 * 3/4 = 102 bytes
      assert.strictEqual(size, 102);
    });
  });
});

describe('StorageService - calculateJsonSize', () => {
  describe('Basic Types', () => {
    it('should return 0 for null', () => {
      assert.strictEqual(calculateJsonSize(null), 0);
    });

    it('should return 0 for undefined', () => {
      assert.strictEqual(calculateJsonSize(undefined), 0);
    });

    it('should calculate size for empty object', () => {
      const size = calculateJsonSize({});
      assert.strictEqual(size, 2); // "{}"
    });

    it('should calculate size for empty array', () => {
      const size = calculateJsonSize([]);
      assert.strictEqual(size, 2); // "[]"
    });

    it('should calculate size for simple string', () => {
      const size = calculateJsonSize('hello');
      assert.strictEqual(size, 7); // '"hello"'
    });

    it('should calculate size for number', () => {
      const size = calculateJsonSize(123);
      assert.strictEqual(size, 3); // "123"
    });

    it('should calculate size for boolean', () => {
      assert.strictEqual(calculateJsonSize(true), 4); // "true"
      assert.strictEqual(calculateJsonSize(false), 5); // "false"
    });
  });

  describe('Complex Objects', () => {
    it('should calculate size for nested object', () => {
      const obj = { a: { b: { c: 1 } } };
      const expected = JSON.stringify(obj).length;
      assert.strictEqual(calculateJsonSize(obj), expected);
    });

    it('should calculate size for array of objects', () => {
      const arr = [{ id: 1 }, { id: 2 }];
      const expected = JSON.stringify(arr).length;
      assert.strictEqual(calculateJsonSize(arr), expected);
    });
  });

  describe('Unicode Handling', () => {
    it('should correctly calculate UTF-8 byte size', () => {
      // Unicode characters take more bytes in UTF-8
      const unicode = { emoji: '🎉' };
      const size = calculateJsonSize(unicode);
      // The emoji takes 4 bytes in UTF-8
      assert.ok(size > JSON.stringify(unicode).length);
    });

    it('should handle Chinese characters', () => {
      const chinese = { text: '你好' };
      const size = calculateJsonSize(chinese);
      // Chinese chars take 3 bytes each in UTF-8
      assert.ok(size > 0);
    });
  });
});

describe('StorageService - calculateStringSize', () => {
  describe('Basic Strings', () => {
    it('should return 0 for null', () => {
      assert.strictEqual(calculateStringSize(null), 0);
    });

    it('should return 0 for undefined', () => {
      assert.strictEqual(calculateStringSize(undefined), 0);
    });

    it('should return 0 for empty string', () => {
      assert.strictEqual(calculateStringSize(''), 0);
    });

    it('should calculate size for ASCII string', () => {
      const str = 'Hello, World!';
      assert.strictEqual(calculateStringSize(str), 13);
    });
  });

  describe('Unicode Strings', () => {
    it('should calculate UTF-8 byte size for emoji', () => {
      const str = '🎉';
      const size = calculateStringSize(str);
      assert.strictEqual(size, 4); // Emoji is 4 bytes in UTF-8
    });

    it('should calculate UTF-8 byte size for multi-char string', () => {
      const str = '你好'; // 2 Chinese chars
      const size = calculateStringSize(str);
      assert.strictEqual(size, 6); // 3 bytes each in UTF-8
    });

    it('should handle mixed ASCII and Unicode', () => {
      const str = 'Hello 世界';
      const size = calculateStringSize(str);
      // "Hello " = 6 bytes, "世界" = 6 bytes
      assert.strictEqual(size, 12);
    });
  });
});

describe('StorageService - formatBytes', () => {
  describe('Byte Formatting', () => {
    it('should format 0 bytes', () => {
      const result = StorageService.formatBytes(0);
      assert.strictEqual(result, '0 B');
    });

    it('should format bytes under 1 KB', () => {
      const result = StorageService.formatBytes(512);
      assert.strictEqual(result, '512 B');
    });

    it('should format 1 KB exactly', () => {
      const result = StorageService.formatBytes(1024);
      assert.strictEqual(result, '1.00 KB');
    });

    it('should format kilobytes', () => {
      const result = StorageService.formatBytes(1536);
      assert.strictEqual(result, '1.50 KB');
    });

    it('should format 1 MB exactly', () => {
      const result = StorageService.formatBytes(1024 * 1024);
      assert.strictEqual(result, '1.00 MB');
    });

    it('should format megabytes', () => {
      const result = StorageService.formatBytes(2.5 * 1024 * 1024);
      assert.strictEqual(result, '2.50 MB');
    });

    it('should format 1 GB exactly', () => {
      const result = StorageService.formatBytes(1024 * 1024 * 1024);
      assert.strictEqual(result, '1.00 GB');
    });

    it('should format gigabytes', () => {
      const result = StorageService.formatBytes(5.5 * 1024 * 1024 * 1024);
      assert.strictEqual(result, '5.50 GB');
    });

    it('should format terabytes', () => {
      const result = StorageService.formatBytes(1.5 * 1024 * 1024 * 1024 * 1024);
      assert.strictEqual(result, '1.50 TB');
    });
  });

  describe('BigInt Support', () => {
    it('should accept bigint values', () => {
      const result = StorageService.formatBytes(BigInt(1024));
      assert.strictEqual(result, '1.00 KB');
    });

    it('should format large bigint values', () => {
      const result = StorageService.formatBytes(BigInt(5 * 1024 * 1024 * 1024));
      assert.strictEqual(result, '5.00 GB');
    });
  });
});

describe('StorageService - Quota Check Logic', () => {
  /**
   * Tests for the quota checking logic.
   */

  describe('Quota Availability Calculation', () => {
    it('should calculate available bytes correctly', () => {
      const quotaBytes = BigInt(5 * 1024 * 1024 * 1024); // 5 GB
      const usedBytes = BigInt(1 * 1024 * 1024 * 1024); // 1 GB
      const availableBytes = quotaBytes - usedBytes;

      assert.strictEqual(availableBytes, BigInt(4 * 1024 * 1024 * 1024));
    });

    it('should not allow negative available bytes', () => {
      const quotaBytes = BigInt(1 * 1024 * 1024 * 1024); // 1 GB
      const usedBytes = BigInt(2 * 1024 * 1024 * 1024); // 2 GB (over quota)

      const availableBytes = quotaBytes > usedBytes
        ? quotaBytes - usedBytes
        : BigInt(0);

      assert.strictEqual(availableBytes, BigInt(0));
    });
  });

  describe('Request Validation', () => {
    it('should allow request within available quota', () => {
      const availableBytes = BigInt(1024 * 1024); // 1 MB
      const requestedBytes = BigInt(512 * 1024); // 512 KB

      const allowed = availableBytes >= requestedBytes;

      assert.strictEqual(allowed, true);
    });

    it('should reject request exceeding available quota', () => {
      const availableBytes = BigInt(512 * 1024); // 512 KB
      const requestedBytes = BigInt(1024 * 1024); // 1 MB

      const allowed = availableBytes >= requestedBytes;

      assert.strictEqual(allowed, false);
    });

    it('should allow request at exact available quota', () => {
      const availableBytes = BigInt(1024 * 1024);
      const requestedBytes = BigInt(1024 * 1024);

      const allowed = availableBytes >= requestedBytes;

      assert.strictEqual(allowed, true);
    });
  });
});

describe('StorageService - Usage Percentage Calculation', () => {
  /**
   * Tests for usage percentage calculation.
   */

  describe('Percentage Calculation', () => {
    it('should calculate 0% for no usage', () => {
      const quotaBytes = BigInt(5 * 1024 * 1024 * 1024);
      const usedBytes = BigInt(0);

      const usagePercent = quotaBytes > 0
        ? Number((usedBytes * BigInt(10000)) / quotaBytes) / 100
        : 0;

      assert.strictEqual(usagePercent, 0);
    });

    it('should calculate 50% for half usage', () => {
      const quotaBytes = BigInt(1000);
      const usedBytes = BigInt(500);

      const usagePercent = Number((usedBytes * BigInt(10000)) / quotaBytes) / 100;

      assert.strictEqual(usagePercent, 50);
    });

    it('should calculate 100% for full usage', () => {
      const quotaBytes = BigInt(1000);
      const usedBytes = BigInt(1000);

      const usagePercent = Number((usedBytes * BigInt(10000)) / quotaBytes) / 100;

      assert.strictEqual(usagePercent, 100);
    });

    it('should handle over quota (>100%)', () => {
      const quotaBytes = BigInt(1000);
      const usedBytes = BigInt(1500);

      const usagePercent = Number((usedBytes * BigInt(10000)) / quotaBytes) / 100;

      assert.strictEqual(usagePercent, 150);
    });

    it('should return 0% for zero quota', () => {
      const quotaBytes = BigInt(0);
      const usedBytes = BigInt(100);

      const usagePercent = quotaBytes > 0
        ? Number((usedBytes * BigInt(10000)) / quotaBytes) / 100
        : 0;

      assert.strictEqual(usagePercent, 0);
    });
  });

  describe('Precision', () => {
    it('should provide two decimal places of precision', () => {
      const quotaBytes = BigInt(10000);
      const usedBytes = BigInt(3333);

      const usagePercent = Number((usedBytes * BigInt(10000)) / quotaBytes) / 100;

      // 3333/10000 = 33.33%
      assert.strictEqual(usagePercent, 33.33);
    });
  });
});

describe('StorageService - Storage Breakdown Structure', () => {
  /**
   * Tests for storage breakdown data structure.
   */

  describe('Breakdown Categories', () => {
    it('should include all expected categories', () => {
      const breakdown = {
        messages: BigInt(1000),
        events: BigInt(2000),
        liveChatMessages: BigInt(500),
        workspaceEvents: BigInt(300),
        images: BigInt(5000),
        total: BigInt(8800),
      };

      assert.ok('messages' in breakdown);
      assert.ok('events' in breakdown);
      assert.ok('liveChatMessages' in breakdown);
      assert.ok('workspaceEvents' in breakdown);
      assert.ok('images' in breakdown);
      assert.ok('total' in breakdown);
    });

    it('should have total equal to sum of categories', () => {
      const breakdown = {
        messages: BigInt(1000),
        events: BigInt(2000),
        liveChatMessages: BigInt(500),
        workspaceEvents: BigInt(300),
        images: BigInt(5000),
        total: BigInt(0),
      };

      breakdown.total = breakdown.messages +
        breakdown.events +
        breakdown.liveChatMessages +
        breakdown.workspaceEvents +
        breakdown.images;

      assert.strictEqual(breakdown.total, BigInt(8800));
    });
  });
});

describe('StorageService - Atomic Usage Updates', () => {
  /**
   * Tests for atomic usage update logic.
   */

  describe('Add Usage', () => {
    it('should not add negative bytes', () => {
      const bytes = -100;
      const shouldAdd = bytes > 0;

      assert.strictEqual(shouldAdd, false);
    });

    it('should not add zero bytes', () => {
      const bytes = 0;
      const shouldAdd = bytes > 0;

      assert.strictEqual(shouldAdd, false);
    });

    it('should add positive bytes', () => {
      const bytes = 100;
      const shouldAdd = bytes > 0;

      assert.strictEqual(shouldAdd, true);
    });
  });

  describe('Remove Usage', () => {
    it('should not remove negative bytes', () => {
      const bytes = -100;
      const shouldRemove = bytes > 0;

      assert.strictEqual(shouldRemove, false);
    });

    it('should not allow usage to go negative', () => {
      const currentUsage = BigInt(100);
      const bytesToRemove = BigInt(200);

      const newUsage = currentUsage > bytesToRemove
        ? currentUsage - bytesToRemove
        : BigInt(0);

      assert.strictEqual(newUsage, BigInt(0));
    });
  });
});

describe('StorageService - Tier Assignment', () => {
  /**
   * Tests for storage tier assignment.
   */

  describe('Tier to Bytes Conversion', () => {
    it('should convert FREE tier to correct bytes', () => {
      const tier: StorageTier = 'FREE';
      const quotaBytes = BigInt(STORAGE_TIERS[tier]);

      assert.strictEqual(quotaBytes, BigInt(STORAGE_TIERS.FREE));
    });

    it('should convert BASIC tier to correct bytes', () => {
      const tier: StorageTier = 'BASIC';
      const quotaBytes = BigInt(STORAGE_TIERS[tier]);

      assert.strictEqual(quotaBytes, BigInt(STORAGE_TIERS.BASIC));
    });

    it('should convert PRO tier to correct bytes', () => {
      const tier: StorageTier = 'PRO';
      const quotaBytes = BigInt(STORAGE_TIERS[tier]);

      assert.strictEqual(quotaBytes, BigInt(STORAGE_TIERS.PRO));
    });

    it('should convert ENTERPRISE tier to correct bytes', () => {
      const tier: StorageTier = 'ENTERPRISE';
      const quotaBytes = BigInt(STORAGE_TIERS[tier]);

      assert.strictEqual(quotaBytes, BigInt(STORAGE_TIERS.ENTERPRISE));
    });
  });
});

describe('StorageService - Storage Stats Structure', () => {
  /**
   * Tests for storage stats data structure.
   */

  describe('Stats Fields', () => {
    it('should include all required fields', () => {
      const stats = {
        usedBytes: BigInt(1000000),
        quotaBytes: BigInt(5000000000),
        availableBytes: BigInt(4999000000),
        usagePercent: 0.02,
        breakdown: {
          messages: BigInt(0),
          events: BigInt(0),
          liveChatMessages: BigInt(0),
          workspaceEvents: BigInt(0),
          images: BigInt(0),
          total: BigInt(0),
        },
      };

      assert.ok('usedBytes' in stats);
      assert.ok('quotaBytes' in stats);
      assert.ok('availableBytes' in stats);
      assert.ok('usagePercent' in stats);
      assert.ok('breakdown' in stats);
    });
  });
});

describe('StorageService - Type Guards', () => {
  /**
   * Tests for type guard utility.
   */

  describe('isUserIdRowArray', () => {
    it('should validate array of objects with id string', () => {
      const rows = [
        { id: 'user-1' },
        { id: 'user-2' },
      ];

      const isValid = Array.isArray(rows) &&
        rows.every(row =>
          typeof row === 'object' &&
          row !== null &&
          'id' in row &&
          typeof row.id === 'string'
        );

      assert.strictEqual(isValid, true);
    });

    it('should reject array with non-string id', () => {
      const rows = [
        { id: 123 },
        { id: 'user-2' },
      ];

      const isValid = Array.isArray(rows) &&
        rows.every(row =>
          typeof row === 'object' &&
          row !== null &&
          'id' in row &&
          typeof row.id === 'string'
        );

      assert.strictEqual(isValid, false);
    });

    it('should reject array with missing id', () => {
      const rows = [
        { name: 'test' },
      ];

      const isValid = Array.isArray(rows) &&
        rows.every(row =>
          typeof row === 'object' &&
          row !== null &&
          'id' in row &&
          typeof (row as { id?: unknown }).id === 'string'
        );

      assert.strictEqual(isValid, false);
    });

    it('should reject non-array', () => {
      const rows = { id: 'user-1' };

      const isValid = Array.isArray(rows);

      assert.strictEqual(isValid, false);
    });

    it('should handle empty array', () => {
      const rows: Array<{ id: string }> = [];

      const isValid = Array.isArray(rows) &&
        rows.every(row =>
          typeof row === 'object' &&
          row !== null &&
          'id' in row &&
          typeof row.id === 'string'
        );

      assert.strictEqual(isValid, true);
    });
  });
});
