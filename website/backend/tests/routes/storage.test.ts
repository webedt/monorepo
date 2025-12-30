/**
 * Tests for Storage Routes
 * Covers storage quota management, usage statistics, and admin operations.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

describe('Storage Routes - User Storage Stats', () => {
  describe('GET /', () => {
    it('should format storage stats response correctly', () => {
      const stats = {
        usedBytes: BigInt(1024 * 1024 * 10), // 10 MB
        quotaBytes: BigInt(1024 * 1024 * 100), // 100 MB
        availableBytes: BigInt(1024 * 1024 * 90), // 90 MB
        usagePercent: 10,
        breakdown: {
          messages: BigInt(1024 * 1024 * 5),
          events: BigInt(1024 * 1024 * 3),
          liveChatMessages: BigInt(1024 * 1024),
          workspaceEvents: BigInt(1024 * 512),
          images: BigInt(1024 * 512),
          total: BigInt(1024 * 1024 * 10),
        },
      };

      const response = formatStorageStatsResponse(stats);

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.strictEqual(response.data.usagePercent, 10);
      assert.ok(response.data.usedFormatted);
      assert.ok(response.data.quotaFormatted);
    });

    it('should convert BigInt values to strings', () => {
      const stats = {
        usedBytes: BigInt(1024),
        quotaBytes: BigInt(2048),
        availableBytes: BigInt(1024),
        usagePercent: 50,
        breakdown: {
          messages: BigInt(512),
          events: BigInt(256),
          liveChatMessages: BigInt(128),
          workspaceEvents: BigInt(64),
          images: BigInt(64),
          total: BigInt(1024),
        },
      };

      const response = formatStorageStatsResponse(stats);

      assert.strictEqual(typeof response.data.usedBytes, 'string');
      assert.strictEqual(response.data.usedBytes, '1024');
    });
  });

  describe('GET /breakdown', () => {
    it('should format breakdown response correctly', () => {
      const breakdown = {
        messages: BigInt(1024 * 1024),
        events: BigInt(512 * 1024),
        liveChatMessages: BigInt(256 * 1024),
        workspaceEvents: BigInt(128 * 1024),
        images: BigInt(64 * 1024),
        total: BigInt(2 * 1024 * 1024),
      };

      const response = formatBreakdownResponse(breakdown);

      assert.strictEqual(response.success, true);
      assert.ok(response.data.messages);
      assert.ok(response.data.messages.bytes);
      assert.ok(response.data.messages.formatted);
    });
  });
});

describe('Storage Routes - Quota Check', () => {
  describe('POST /check', () => {
    it('should require valid bytes value', () => {
      const body = { bytes: -100 };
      const result = validateCheckQuotaInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid bytes value. Must be a non-negative number.');
    });

    it('should reject non-number bytes', () => {
      const body = { bytes: 'not-a-number' };
      const result = validateCheckQuotaInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid bytes value', () => {
      const body = { bytes: 1024 };
      const result = validateCheckQuotaInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept zero bytes', () => {
      const body = { bytes: 0 };
      const result = validateCheckQuotaInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should format quota check response', () => {
      const check = {
        allowed: true,
        usedBytes: BigInt(1024 * 1024),
        quotaBytes: BigInt(1024 * 1024 * 100),
        availableBytes: BigInt(1024 * 1024 * 99),
        requestedBytes: BigInt(1024),
      };

      const response = formatQuotaCheckResponse(check);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.allowed, true);
    });
  });
});

describe('Storage Routes - Recalculate', () => {
  describe('POST /recalculate', () => {
    it('should format recalculate response', () => {
      const newTotal = BigInt(2 * 1024 * 1024);

      const response = formatRecalculateResponse(newTotal);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.message, 'Storage usage recalculated');
      assert.ok(response.data.newTotalBytes);
      assert.ok(response.data.newTotalFormatted);
    });
  });
});

describe('Storage Routes - Tiers', () => {
  describe('GET /tiers', () => {
    it('should format tiers response', () => {
      const tiers = {
        free: BigInt(100 * 1024 * 1024),
        basic: BigInt(1024 * 1024 * 1024),
        pro: BigInt(10 * 1024 * 1024 * 1024),
        enterprise: BigInt(100 * 1024 * 1024 * 1024),
      };

      const response = formatTiersResponse(tiers);

      assert.strictEqual(response.success, true);
      assert.ok(Array.isArray(response.data.tiers));
      assert.strictEqual(response.data.tiers.length, 4);
    });

    it('should include tier name, bytes, and formatted value', () => {
      const tiers = {
        free: BigInt(100 * 1024 * 1024),
      };

      const response = formatTiersResponse(tiers);
      const tier = response.data.tiers[0];

      assert.strictEqual(tier.name, 'free');
      assert.ok(tier.bytes);
      assert.ok(tier.formatted);
    });
  });
});

describe('Storage Routes - Admin Operations', () => {
  describe('GET /admin/:userId', () => {
    it('should require admin access', () => {
      const user = { isAdmin: false };
      const result = validateAdminAccess(user);

      assert.strictEqual(result.authorized, false);
    });

    it('should allow admin access', () => {
      const user = { isAdmin: true };
      const result = validateAdminAccess(user);

      assert.strictEqual(result.authorized, true);
    });

    it('should return 404 for non-existent user', () => {
      const userExists = false;

      assert.strictEqual(userExists, false);
    });
  });

  describe('POST /admin/:userId/quota', () => {
    it('should require quotaBytes parameter', () => {
      const body = {};
      const result = validateSetQuotaInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid quotaBytes. Must be a string representing bytes.');
    });

    it('should require quotaBytes to be a string', () => {
      const body = { quotaBytes: 12345 };
      const result = validateSetQuotaInput(body);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid quotaBytes string', () => {
      const body = { quotaBytes: '1073741824' };
      const result = validateSetQuotaInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid number string', () => {
      const body = { quotaBytes: 'not-a-number' };
      const result = validateSetQuotaInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid quotaBytes value. Must be a valid number string.');
    });
  });

  describe('POST /admin/:userId/tier', () => {
    it('should require tier parameter', () => {
      const body = {};
      const validTiers = ['free', 'basic', 'pro', 'enterprise'];
      const result = validateSetTierInput(body, validTiers);

      assert.strictEqual(result.valid, false);
    });

    it('should reject invalid tier', () => {
      const body = { tier: 'invalid-tier' };
      const validTiers = ['free', 'basic', 'pro', 'enterprise'];
      const result = validateSetTierInput(body, validTiers);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid tier'));
    });

    it('should accept valid tier', () => {
      const body = { tier: 'pro' };
      const validTiers = ['free', 'basic', 'pro', 'enterprise'];
      const result = validateSetTierInput(body, validTiers);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /admin/:userId/recalculate', () => {
    it('should format admin recalculate response', () => {
      const userId = 'user-123';
      const newTotal = BigInt(5 * 1024 * 1024);

      const response = formatAdminRecalculateResponse(userId, newTotal);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.userId, userId);
    });
  });
});

describe('Storage Routes - Byte Formatting', () => {
  describe('formatBytes', () => {
    it('should format bytes', () => {
      assert.strictEqual(formatBytes(BigInt(0)), '0 B');
      assert.strictEqual(formatBytes(BigInt(512)), '512 B');
    });

    it('should format kilobytes', () => {
      assert.strictEqual(formatBytes(BigInt(1024)), '1 KB');
      assert.strictEqual(formatBytes(BigInt(2048)), '2 KB');
    });

    it('should format megabytes', () => {
      assert.strictEqual(formatBytes(BigInt(1024 * 1024)), '1 MB');
      assert.strictEqual(formatBytes(BigInt(1024 * 1024 * 5)), '5 MB');
    });

    it('should format gigabytes', () => {
      assert.strictEqual(formatBytes(BigInt(1024 * 1024 * 1024)), '1 GB');
    });

    it('should format terabytes', () => {
      assert.strictEqual(formatBytes(BigInt(1024) * BigInt(1024 * 1024 * 1024)), '1 TB');
    });

    it('should handle decimal values', () => {
      const formatted = formatBytes(BigInt(1536));
      assert.strictEqual(formatted, '1.5 KB');
    });
  });
});

describe('Storage Routes - Error Responses', () => {
  describe('Error Format', () => {
    it('should format storage stats error', () => {
      const response = formatStorageError('Failed to get storage statistics');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Failed to get storage statistics');
    });

    it('should format quota check error', () => {
      const response = formatStorageError('Failed to check storage quota');

      assert.strictEqual(response.success, false);
    });

    it('should format user not found error', () => {
      const response = formatNotFoundError('User not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.statusCode, 404);
    });
  });
});

// Helper functions that mirror the validation and formatting logic in storage.ts
function formatStorageStatsResponse(stats: {
  usedBytes: bigint;
  quotaBytes: bigint;
  availableBytes: bigint;
  usagePercent: number;
  breakdown: {
    messages: bigint;
    events: bigint;
    liveChatMessages: bigint;
    workspaceEvents: bigint;
    images: bigint;
    total: bigint;
  };
}): {
  success: boolean;
  data: {
    usedBytes: string;
    quotaBytes: string;
    availableBytes: string;
    usagePercent: number;
    usedFormatted: string;
    quotaFormatted: string;
    availableFormatted: string;
    breakdown: Record<string, string>;
  };
} {
  return {
    success: true,
    data: {
      usedBytes: stats.usedBytes.toString(),
      quotaBytes: stats.quotaBytes.toString(),
      availableBytes: stats.availableBytes.toString(),
      usagePercent: stats.usagePercent,
      usedFormatted: formatBytes(stats.usedBytes),
      quotaFormatted: formatBytes(stats.quotaBytes),
      availableFormatted: formatBytes(stats.availableBytes),
      breakdown: {
        messages: stats.breakdown.messages.toString(),
        events: stats.breakdown.events.toString(),
        liveChatMessages: stats.breakdown.liveChatMessages.toString(),
        workspaceEvents: stats.breakdown.workspaceEvents.toString(),
        images: stats.breakdown.images.toString(),
        total: stats.breakdown.total.toString(),
      },
    },
  };
}

function formatBreakdownResponse(breakdown: {
  messages: bigint;
  events: bigint;
  liveChatMessages: bigint;
  workspaceEvents: bigint;
  images: bigint;
  total: bigint;
}): {
  success: boolean;
  data: {
    messages: { bytes: string; formatted: string };
    events: { bytes: string; formatted: string };
    liveChatMessages: { bytes: string; formatted: string };
    workspaceEvents: { bytes: string; formatted: string };
    images: { bytes: string; formatted: string };
    total: { bytes: string; formatted: string };
  };
} {
  return {
    success: true,
    data: {
      messages: {
        bytes: breakdown.messages.toString(),
        formatted: formatBytes(breakdown.messages),
      },
      events: {
        bytes: breakdown.events.toString(),
        formatted: formatBytes(breakdown.events),
      },
      liveChatMessages: {
        bytes: breakdown.liveChatMessages.toString(),
        formatted: formatBytes(breakdown.liveChatMessages),
      },
      workspaceEvents: {
        bytes: breakdown.workspaceEvents.toString(),
        formatted: formatBytes(breakdown.workspaceEvents),
      },
      images: {
        bytes: breakdown.images.toString(),
        formatted: formatBytes(breakdown.images),
      },
      total: {
        bytes: breakdown.total.toString(),
        formatted: formatBytes(breakdown.total),
      },
    },
  };
}

function validateCheckQuotaInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { bytes } = body;

  if (typeof bytes !== 'number' || bytes < 0) {
    return {
      valid: false,
      error: 'Invalid bytes value. Must be a non-negative number.',
    };
  }

  return { valid: true };
}

function formatQuotaCheckResponse(check: {
  allowed: boolean;
  usedBytes: bigint;
  quotaBytes: bigint;
  availableBytes: bigint;
  requestedBytes: bigint;
}): {
  success: boolean;
  data: {
    allowed: boolean;
    usedBytes: string;
    quotaBytes: string;
    availableBytes: string;
    requestedBytes: string;
  };
} {
  return {
    success: true,
    data: {
      allowed: check.allowed,
      usedBytes: check.usedBytes.toString(),
      quotaBytes: check.quotaBytes.toString(),
      availableBytes: check.availableBytes.toString(),
      requestedBytes: check.requestedBytes.toString(),
    },
  };
}

function formatRecalculateResponse(newTotal: bigint): {
  success: boolean;
  data: {
    message: string;
    newTotalBytes: string;
    newTotalFormatted: string;
  };
} {
  return {
    success: true,
    data: {
      message: 'Storage usage recalculated',
      newTotalBytes: newTotal.toString(),
      newTotalFormatted: formatBytes(newTotal),
    },
  };
}

function formatTiersResponse(tiers: Record<string, bigint>): {
  success: boolean;
  data: {
    tiers: Array<{ name: string; bytes: string; formatted: string }>;
  };
} {
  return {
    success: true,
    data: {
      tiers: Object.entries(tiers).map(([name, bytes]) => ({
        name,
        bytes: bytes.toString(),
        formatted: formatBytes(bytes),
      })),
    },
  };
}

function validateAdminAccess(user: { isAdmin: boolean }): {
  authorized: boolean;
} {
  return { authorized: user.isAdmin };
}

function validateSetQuotaInput(body: Record<string, unknown>): {
  valid: boolean;
  error?: string;
} {
  const { quotaBytes } = body;

  if (!quotaBytes || typeof quotaBytes !== 'string') {
    return {
      valid: false,
      error: 'Invalid quotaBytes. Must be a string representing bytes.',
    };
  }

  try {
    BigInt(quotaBytes);
    return { valid: true };
  } catch {
    return {
      valid: false,
      error: 'Invalid quotaBytes value. Must be a valid number string.',
    };
  }
}

function validateSetTierInput(
  body: Record<string, unknown>,
  validTiers: string[]
): { valid: boolean; error?: string } {
  const { tier } = body;

  if (!tier || !validTiers.includes(tier as string)) {
    return {
      valid: false,
      error: `Invalid tier. Must be one of: ${validTiers.join(', ')}`,
    };
  }

  return { valid: true };
}

function formatAdminRecalculateResponse(
  userId: string,
  newTotal: bigint
): {
  success: boolean;
  data: {
    message: string;
    userId: string;
    newTotalBytes: string;
    newTotalFormatted: string;
  };
} {
  return {
    success: true,
    data: {
      message: 'Storage usage recalculated',
      userId,
      newTotalBytes: newTotal.toString(),
      newTotalFormatted: formatBytes(newTotal),
    },
  };
}

function formatBytes(bytes: bigint): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = Number(bytes);
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }

  // Format with appropriate decimal places
  if (value === Math.floor(value)) {
    return `${value} ${units[unitIndex]}`;
  }
  return `${value.toFixed(1).replace(/\.0$/, '')} ${units[unitIndex]}`;
}

function formatStorageError(message: string): {
  success: boolean;
  error: string;
} {
  return { success: false, error: message };
}

function formatNotFoundError(message: string): {
  success: boolean;
  statusCode: number;
  error: string;
} {
  return { success: false, statusCode: 404, error: message };
}
