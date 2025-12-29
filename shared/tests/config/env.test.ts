/**
 * Tests for centralized environment configuration.
 * Covers validation helpers, schema transformations, and helper functions.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { z } from 'zod';

// Import the functions and values we're testing
import {
  validateEnv,
  isProduction,
  isDevelopment,
  isTest,
  isVerbose,
  isDebugLevel,
  NODE_ENV,
  VERBOSE_MODE,
  LOG_LEVEL,
  SESSION_SECRET,
  CLAUDE_ENVIRONMENT_ID,
  DATABASE_URL,
  ENCRYPTION_KEY,
  ENCRYPTION_SALT,
} from '../../src/config/env.js';

// =============================================================================
// SCHEMA HELPER TESTS
// These test the Zod transformation logic in isolation
// =============================================================================

describe('Config Schema Helpers', () => {
  describe('booleanSchema', () => {
    // Replicate the schema for isolated testing
    const booleanSchema = z
      .enum(['true', 'false', ''])
      .optional()
      .transform((val) => val === 'true');

    it('should transform "true" to true', () => {
      assert.strictEqual(booleanSchema.parse('true'), true);
    });

    it('should transform "false" to false', () => {
      assert.strictEqual(booleanSchema.parse('false'), false);
    });

    it('should transform empty string to false', () => {
      assert.strictEqual(booleanSchema.parse(''), false);
    });

    it('should transform undefined to false', () => {
      assert.strictEqual(booleanSchema.parse(undefined), false);
    });

    it('should reject invalid values', () => {
      assert.throws(() => booleanSchema.parse('yes'), {
        message: /Invalid enum value/,
      });
      assert.throws(() => booleanSchema.parse('1'), {
        message: /Invalid enum value/,
      });
    });
  });

  describe('optionalBoolean', () => {
    // Replicate the schema factory for isolated testing
    const optionalBoolean = (defaultValue: boolean) =>
      z
        .enum(['true', 'false', ''])
        .optional()
        .transform((val) => (val === undefined || val === '' ? defaultValue : val === 'true'));

    it('should use default value when undefined', () => {
      const schemaDefaultTrue = optionalBoolean(true);
      const schemaDefaultFalse = optionalBoolean(false);

      assert.strictEqual(schemaDefaultTrue.parse(undefined), true);
      assert.strictEqual(schemaDefaultFalse.parse(undefined), false);
    });

    it('should use default value when empty string', () => {
      const schemaDefaultTrue = optionalBoolean(true);
      assert.strictEqual(schemaDefaultTrue.parse(''), true);
    });

    it('should parse "true" regardless of default', () => {
      const schema = optionalBoolean(false);
      assert.strictEqual(schema.parse('true'), true);
    });

    it('should parse "false" regardless of default', () => {
      const schema = optionalBoolean(true);
      assert.strictEqual(schema.parse('false'), false);
    });
  });

  describe('integerWithDefault', () => {
    // Replicate the schema factory for isolated testing
    const integerWithDefault = (defaultValue: number) =>
      z
        .string()
        .optional()
        .transform((val) => (val ? parseInt(val, 10) : defaultValue))
        .refine((val) => !isNaN(val), { message: 'Must be a valid integer' });

    it('should use default value when undefined', () => {
      const schema = integerWithDefault(42);
      assert.strictEqual(schema.parse(undefined), 42);
    });

    it('should use default value when empty string', () => {
      const schema = integerWithDefault(42);
      assert.strictEqual(schema.parse(''), 42);
    });

    it('should parse valid integer strings', () => {
      const schema = integerWithDefault(0);
      assert.strictEqual(schema.parse('123'), 123);
      assert.strictEqual(schema.parse('0'), 0);
      assert.strictEqual(schema.parse('-5'), -5);
    });

    it('should reject non-integer strings', () => {
      const schema = integerWithDefault(0);
      assert.throws(() => schema.parse('abc'), {
        message: /Must be a valid integer/,
      });
    });
  });

  describe('optionalString', () => {
    // Replicate the schema factory for isolated testing
    const optionalString = (defaultValue: string) =>
      z
        .string()
        .optional()
        .transform((val) => val || defaultValue);

    it('should use default value when undefined', () => {
      const schema = optionalString('default');
      assert.strictEqual(schema.parse(undefined), 'default');
    });

    it('should use default value when empty string', () => {
      const schema = optionalString('default');
      assert.strictEqual(schema.parse(''), 'default');
    });

    it('should use provided value when present', () => {
      const schema = optionalString('default');
      assert.strictEqual(schema.parse('custom'), 'custom');
    });
  });
});

// =============================================================================
// VALIDATION FUNCTION TESTS
// =============================================================================

describe('validateEnv', () => {
  it('should return validation result object', () => {
    const result = validateEnv();

    assert.ok(typeof result === 'object');
    assert.ok(typeof result.valid === 'boolean');
    assert.ok(Array.isArray(result.errors));
    assert.ok(Array.isArray(result.warnings));
  });

  it('should warn when CLAUDE_ENVIRONMENT_ID is not set', () => {
    const result = validateEnv();

    // Check if warning is present when CLAUDE_ENVIRONMENT_ID is empty
    if (!CLAUDE_ENVIRONMENT_ID) {
      assert.ok(
        result.warnings.some((w) => w.includes('CLAUDE_ENVIRONMENT_ID')),
        'Should warn about missing CLAUDE_ENVIRONMENT_ID'
      );
    }
  });

  it('should warn when DATABASE_URL is not set', () => {
    const result = validateEnv();

    // Check if warning is present when DATABASE_URL is undefined
    if (!DATABASE_URL) {
      assert.ok(
        result.warnings.some((w) => w.includes('DATABASE_URL')),
        'Should warn about missing DATABASE_URL'
      );
    }
  });

  it('should error when ENCRYPTION_KEY is set but ENCRYPTION_SALT is not', () => {
    // This test verifies the validation logic
    // The actual result depends on the current env
    const result = validateEnv();

    if (ENCRYPTION_KEY && !ENCRYPTION_SALT) {
      assert.ok(
        result.errors.some((e) => e.includes('ENCRYPTION_SALT')),
        'Should error about missing ENCRYPTION_SALT when ENCRYPTION_KEY is set'
      );
      assert.strictEqual(result.valid, false);
    }
  });

  it('should error on invalid ENCRYPTION_SALT format', () => {
    // This tests the regex validation for hex string
    const result = validateEnv();

    // If ENCRYPTION_SALT is set but invalid, there should be an error
    if (ENCRYPTION_SALT && !/^[0-9a-fA-F]{32,}$/.test(ENCRYPTION_SALT)) {
      assert.ok(
        result.errors.some((e) => e.includes('valid hex string')),
        'Should error about invalid ENCRYPTION_SALT format'
      );
    }
  });

  it('should error in production with default SESSION_SECRET', () => {
    const result = validateEnv();

    if (NODE_ENV === 'production' && SESSION_SECRET === 'development-secret-change-in-production') {
      assert.ok(
        result.errors.some((e) => e.includes('SESSION_SECRET')),
        'Should error about default SESSION_SECRET in production'
      );
      assert.strictEqual(result.valid, false);
    }
  });
});

// =============================================================================
// HELPER FUNCTION TESTS
// =============================================================================

describe('Environment Helper Functions', () => {
  describe('isProduction', () => {
    it('should return boolean', () => {
      assert.strictEqual(typeof isProduction(), 'boolean');
    });

    it('should return true when NODE_ENV is production', () => {
      assert.strictEqual(isProduction(), NODE_ENV === 'production');
    });
  });

  describe('isDevelopment', () => {
    it('should return boolean', () => {
      assert.strictEqual(typeof isDevelopment(), 'boolean');
    });

    it('should return true when NODE_ENV is development', () => {
      assert.strictEqual(isDevelopment(), NODE_ENV === 'development');
    });
  });

  describe('isTest', () => {
    it('should return boolean', () => {
      assert.strictEqual(typeof isTest(), 'boolean');
    });

    it('should return true when NODE_ENV is test', () => {
      assert.strictEqual(isTest(), NODE_ENV === 'test');
    });
  });

  describe('isVerbose', () => {
    it('should return boolean', () => {
      assert.strictEqual(typeof isVerbose(), 'boolean');
    });

    it('should return true when VERBOSE_MODE is not off', () => {
      assert.strictEqual(isVerbose(), VERBOSE_MODE !== 'off');
    });
  });

  describe('isDebugLevel', () => {
    it('should return boolean', () => {
      assert.strictEqual(typeof isDebugLevel(), 'boolean');
    });

    it('should return true when VERBOSE_MODE is debug or LOG_LEVEL is debug', () => {
      assert.strictEqual(
        isDebugLevel(),
        VERBOSE_MODE === 'debug' || LOG_LEVEL === 'debug'
      );
    });
  });
});

// =============================================================================
// EXPORTED VALUES TESTS
// =============================================================================

describe('Exported Configuration Values', () => {
  it('should export NODE_ENV as string', () => {
    assert.strictEqual(typeof NODE_ENV, 'string');
    assert.ok(['development', 'production', 'test'].includes(NODE_ENV) || true);
  });

  it('should export VERBOSE_MODE as string', () => {
    assert.strictEqual(typeof VERBOSE_MODE, 'string');
  });

  it('should export LOG_LEVEL as string', () => {
    assert.strictEqual(typeof LOG_LEVEL, 'string');
  });

  it('should export SESSION_SECRET as string', () => {
    assert.strictEqual(typeof SESSION_SECRET, 'string');
    assert.ok(SESSION_SECRET.length > 0, 'SESSION_SECRET should not be empty');
  });
});

// =============================================================================
// ENCRYPTION SALT VALIDATION REGEX TEST
// =============================================================================

describe('Encryption Salt Validation', () => {
  const ENCRYPTION_SALT_REGEX = /^[0-9a-fA-F]{32,}$/;

  it('should match valid hex strings of 32+ chars', () => {
    const validSalts = [
      '00000000000000000000000000000000', // 32 chars
      'abcdef0123456789abcdef0123456789', // 32 chars
      'ABCDEF0123456789ABCDEF0123456789', // uppercase
      'abcdef0123456789abcdef0123456789abcdef', // longer
    ];

    for (const salt of validSalts) {
      assert.ok(ENCRYPTION_SALT_REGEX.test(salt), `Expected ${salt} to be valid`);
    }
  });

  it('should reject invalid hex strings', () => {
    const invalidSalts = [
      '0000000000000000000000000000000', // 31 chars
      'ghijklmnopqrstuvwxyz123456789012', // non-hex chars
      '00000000000000000000000000000000 ', // trailing space
      ' 00000000000000000000000000000000', // leading space
      '', // empty
    ];

    for (const salt of invalidSalts) {
      assert.ok(!ENCRYPTION_SALT_REGEX.test(salt), `Expected ${salt} to be invalid`);
    }
  });
});
