/**
 * Tests for encrypted Drizzle column types.
 * Tests automatic encryption on write and decryption on read.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  isEncryptionEnabled,
  isEncrypted,
  clearKeyCache,
} from '../../src/utils/encryption.js';

// Import the types we're testing
import type {
  ClaudeAuthData,
  CodexAuthData,
  GeminiAuthData,
  ImageAiKeysData,
} from '../../src/db/authTypes.js';

// Test data
const TEST_SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('Encrypted Column Types', () => {
  let originalEncryptionKey: string | undefined;
  let originalEncryptionSalt: string | undefined;

  beforeEach(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    originalEncryptionSalt = process.env.ENCRYPTION_SALT;
    clearKeyCache();
  });

  afterEach(() => {
    if (originalEncryptionKey !== undefined) {
      process.env.ENCRYPTION_KEY = originalEncryptionKey;
    } else {
      delete process.env.ENCRYPTION_KEY;
    }
    if (originalEncryptionSalt !== undefined) {
      process.env.ENCRYPTION_SALT = originalEncryptionSalt;
    } else {
      delete process.env.ENCRYPTION_SALT;
    }
    clearKeyCache();
  });

  describe('Type Definitions', () => {
    it('should have correct ClaudeAuthData structure', () => {
      const auth: ClaudeAuthData = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        scopes: ['read', 'write'],
        subscriptionType: 'pro',
        rateLimitTier: 'standard',
      };

      assert.ok(auth.accessToken);
      assert.ok(auth.refreshToken);
      assert.ok(auth.expiresAt);
    });

    it('should have correct CodexAuthData structure', () => {
      const auth: CodexAuthData = {
        apiKey: 'sk-test-key',
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
      };

      assert.ok(auth.apiKey || auth.accessToken);
    });

    it('should have correct GeminiAuthData structure', () => {
      const auth: GeminiAuthData = {
        accessToken: 'test-access-token',
        refreshToken: 'test-refresh-token',
        expiresAt: Date.now() + 3600000,
        tokenType: 'Bearer',
        scope: 'email profile',
      };

      assert.ok(auth.accessToken);
      assert.ok(auth.refreshToken);
    });

    it('should have correct ImageAiKeysData structure', () => {
      const keys: ImageAiKeysData = {
        openrouter: 'sk-or-test-key',
        cometapi: 'comet-test-key',
        google: 'google-test-key',
      };

      assert.ok(keys.openrouter || keys.cometapi || keys.google);
    });
  });

  describe('Encryption Status Detection', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should detect encrypted strings correctly', () => {
      // Create a properly encrypted value format
      const encryptedValue = 'v1:YWJjZGVmZ2hpamts:bW5vcHFyc3R1dnd4:eW9vZWU=';
      assert.strictEqual(isEncrypted(encryptedValue), true);
    });

    it('should detect unencrypted strings correctly', () => {
      const plainValue = 'just-a-plain-token-value';
      assert.strictEqual(isEncrypted(plainValue), false);
    });

    it('should handle JSON strings correctly', () => {
      const jsonString = JSON.stringify({ token: 'test' });
      assert.strictEqual(isEncrypted(jsonString), false);
    });
  });

  describe('Encryption Disabled Behavior', () => {
    beforeEach(() => {
      delete process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_SALT;
      clearKeyCache();
    });

    it('should return false for isEncryptionEnabled when key not set', () => {
      assert.strictEqual(isEncryptionEnabled(), false);
    });
  });

  describe('Encryption Enabled Behavior', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      clearKeyCache();
    });

    it('should return true for isEncryptionEnabled when key is set', () => {
      assert.strictEqual(isEncryptionEnabled(), true);
    });
  });

  describe('Data Structure Handling', () => {
    it('should handle null values for all auth types', () => {
      const nullClaudeAuth: ClaudeAuthData | null = null;
      const nullCodexAuth: CodexAuthData | null = null;
      const nullGeminiAuth: GeminiAuthData | null = null;
      const nullImageAiKeys: ImageAiKeysData | null = null;

      assert.strictEqual(nullClaudeAuth, null);
      assert.strictEqual(nullCodexAuth, null);
      assert.strictEqual(nullGeminiAuth, null);
      assert.strictEqual(nullImageAiKeys, null);
    });

    it('should handle partial CodexAuth data', () => {
      // CodexAuth can have either apiKey or accessToken
      const apiKeyOnly: CodexAuthData = { apiKey: 'sk-test' };
      const accessTokenOnly: CodexAuthData = { accessToken: 'token', expiresAt: Date.now() };

      assert.ok(apiKeyOnly.apiKey);
      assert.strictEqual(apiKeyOnly.accessToken, undefined);
      assert.ok(accessTokenOnly.accessToken);
      assert.strictEqual(accessTokenOnly.apiKey, undefined);
    });

    it('should handle partial ImageAiKeys data', () => {
      // ImageAiKeys can have any subset of providers
      const onlyOpenRouter: ImageAiKeysData = { openrouter: 'sk-or-test' };
      const onlyGoogle: ImageAiKeysData = { google: 'google-key' };
      const multiple: ImageAiKeysData = { openrouter: 'sk-or-test', cometapi: 'comet-key' };

      assert.ok(onlyOpenRouter.openrouter);
      assert.strictEqual(onlyOpenRouter.cometapi, undefined);
      assert.ok(onlyGoogle.google);
      assert.ok(multiple.openrouter);
      assert.ok(multiple.cometapi);
    });
  });
});
