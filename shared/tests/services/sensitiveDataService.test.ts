/**
 * Tests for SensitiveDataService.
 * Covers encryption/decryption of user sensitive fields.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  encryptUserFields,
  decryptUserFields,
  decryptUser,
  hasEncryptedFields,
  hasUnencryptedSensitiveData,
} from '../../src/services/sensitiveDataService.js';
import { clearKeyCache, isEncrypted } from '../../src/utils/encryption.js';

// Valid test salt (32 hex characters = 16 bytes)
const TEST_SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('SensitiveDataService', () => {
  // Store original env vars
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

  describe('encryptUserFields', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-key-for-sensitive-data-service-32-chars';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should encrypt githubAccessToken', () => {
      const fields = { githubAccessToken: 'gho_xxxxxxxxxxxxx' };
      const encrypted = encryptUserFields(fields);

      assert.ok(encrypted.githubAccessToken);
      assert.ok(isEncrypted(encrypted.githubAccessToken as string));
    });

    it('should encrypt claudeAuth JSON', () => {
      const fields = {
        claudeAuth: {
          accessToken: 'claude-token',
          refreshToken: 'refresh-token',
          expiresAt: Date.now() + 3600000,
        },
      };
      const encrypted = encryptUserFields(fields);

      assert.ok(encrypted.claudeAuth);
      assert.ok(typeof encrypted.claudeAuth === 'string');
      assert.ok(isEncrypted(encrypted.claudeAuth as string));
    });

    it('should encrypt codexAuth JSON', () => {
      const fields = {
        codexAuth: {
          apiKey: 'sk-xxxxxxxx',
          accessToken: 'oauth-token',
        },
      };
      const encrypted = encryptUserFields(fields);

      assert.ok(encrypted.codexAuth);
      assert.ok(typeof encrypted.codexAuth === 'string');
    });

    it('should encrypt geminiAuth JSON', () => {
      const fields = {
        geminiAuth: {
          accessToken: 'ya29.xxxxx',
          refreshToken: '1//xxxxx',
          expiresAt: Date.now() + 3600000,
        },
      };
      const encrypted = encryptUserFields(fields);

      assert.ok(encrypted.geminiAuth);
      assert.ok(typeof encrypted.geminiAuth === 'string');
    });

    it('should encrypt openrouterApiKey', () => {
      const fields = { openrouterApiKey: 'sk-or-xxxxxxxxxxxxx' };
      const encrypted = encryptUserFields(fields);

      assert.ok(encrypted.openrouterApiKey);
      assert.ok(isEncrypted(encrypted.openrouterApiKey as string));
    });

    it('should encrypt imageAiKeys JSON', () => {
      const fields = {
        imageAiKeys: {
          openrouter: 'sk-or-xxxxx',
          google: 'AIzaxxxxxx',
        },
      };
      const encrypted = encryptUserFields(fields);

      assert.ok(encrypted.imageAiKeys);
      assert.ok(typeof encrypted.imageAiKeys === 'string');
    });

    it('should handle null values', () => {
      const fields = {
        claudeAuth: null,
        githubAccessToken: null,
      };
      const encrypted = encryptUserFields(fields);

      assert.strictEqual(encrypted.claudeAuth, null);
      assert.strictEqual(encrypted.githubAccessToken, null);
    });

    it('should not encrypt when encryption is disabled', () => {
      delete process.env.ENCRYPTION_KEY;
      clearKeyCache();

      const fields = { githubAccessToken: 'gho_xxxxxxxxxxxxx' };
      const result = encryptUserFields(fields);

      assert.strictEqual(result.githubAccessToken, fields.githubAccessToken);
    });
  });

  describe('decryptUserFields', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-key-for-sensitive-data-service-32-chars';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should decrypt encrypted githubAccessToken', () => {
      const original = { githubAccessToken: 'gho_xxxxxxxxxxxxx' };
      const encrypted = encryptUserFields(original);
      const decrypted = decryptUserFields(encrypted as any);

      assert.strictEqual(decrypted.githubAccessToken, original.githubAccessToken);
    });

    it('should decrypt encrypted claudeAuth', () => {
      const original = {
        claudeAuth: {
          accessToken: 'claude-token',
          refreshToken: 'refresh-token',
          expiresAt: 1234567890,
        },
      };
      const encrypted = encryptUserFields(original);
      const decrypted = decryptUserFields(encrypted as any);

      assert.deepStrictEqual(decrypted.claudeAuth, original.claudeAuth);
    });

    it('should handle unencrypted data (backward compatibility)', () => {
      const plainUser = {
        githubAccessToken: 'gho_plain',
        claudeAuth: {
          accessToken: 'plain-token',
          refreshToken: 'plain-refresh',
          expiresAt: 12345,
        },
      };
      const decrypted = decryptUserFields(plainUser as any);

      assert.strictEqual(decrypted.githubAccessToken, plainUser.githubAccessToken);
      assert.deepStrictEqual(decrypted.claudeAuth, plainUser.claudeAuth);
    });

    it('should handle null values', () => {
      const user = {
        claudeAuth: null,
        githubAccessToken: null,
      };
      const decrypted = decryptUserFields(user as any);

      assert.strictEqual(decrypted.claudeAuth, null);
      assert.strictEqual(decrypted.githubAccessToken, null);
    });
  });

  describe('decryptUser', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-key-for-sensitive-data-service-32-chars';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should decrypt all sensitive fields in user object', () => {
      const original = {
        id: 'user-123',
        email: 'test@example.com',
        githubAccessToken: 'gho_xxxxx',
        claudeAuth: {
          accessToken: 'token',
          refreshToken: 'refresh',
          expiresAt: 12345,
        },
        openrouterApiKey: 'sk-or-xxxxx',
      };

      const encrypted = {
        ...original,
        ...encryptUserFields({
          githubAccessToken: original.githubAccessToken,
          claudeAuth: original.claudeAuth,
          openrouterApiKey: original.openrouterApiKey,
        }),
      };

      const decrypted = decryptUser(encrypted as any);

      assert.strictEqual(decrypted.id, original.id);
      assert.strictEqual(decrypted.email, original.email);
      assert.strictEqual(decrypted.githubAccessToken, original.githubAccessToken);
      assert.deepStrictEqual(decrypted.claudeAuth, original.claudeAuth);
      assert.strictEqual(decrypted.openrouterApiKey, original.openrouterApiKey);
    });

    it('should return null for null input', () => {
      const result = decryptUser(null as any);
      assert.strictEqual(result, null);
    });
  });

  describe('hasEncryptedFields', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-key-for-sensitive-data-service-32-chars';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should return true for user with encrypted fields', () => {
      const encrypted = encryptUserFields({
        githubAccessToken: 'gho_xxxx',
      });

      assert.strictEqual(hasEncryptedFields(encrypted as any), true);
    });

    it('should return false for user with plain fields', () => {
      const plain = {
        githubAccessToken: 'gho_plain',
        claudeAuth: { accessToken: 'token', refreshToken: 'refresh', expiresAt: 123 },
      };

      assert.strictEqual(hasEncryptedFields(plain as any), false);
    });

    it('should return false for user with no sensitive data', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
      };

      assert.strictEqual(hasEncryptedFields(user as any), false);
    });
  });

  describe('hasUnencryptedSensitiveData', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-key-for-sensitive-data-service-32-chars';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should return true for user with plain text token', () => {
      const user = {
        githubAccessToken: 'gho_plain_token',
      };

      assert.strictEqual(hasUnencryptedSensitiveData(user as any), true);
    });

    it('should return true for user with plain JSON auth', () => {
      const user = {
        claudeAuth: { accessToken: 'token', refreshToken: 'refresh', expiresAt: 123 },
      };

      assert.strictEqual(hasUnencryptedSensitiveData(user as any), true);
    });

    it('should return false for user with encrypted data', () => {
      const encrypted = encryptUserFields({
        githubAccessToken: 'gho_xxxx',
        claudeAuth: { accessToken: 'token', refreshToken: 'refresh', expiresAt: 123 },
      });

      assert.strictEqual(hasUnencryptedSensitiveData(encrypted as any), false);
    });

    it('should return false for user with no sensitive data', () => {
      const user = {
        id: 'user-123',
        email: 'test@example.com',
      };

      assert.strictEqual(hasUnencryptedSensitiveData(user as any), false);
    });
  });

  describe('Round-trip encryption', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-key-for-round-trip-testing-32-chars';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should correctly round-trip all sensitive fields', () => {
      const original = {
        githubAccessToken: 'gho_real_token_12345',
        claudeAuth: {
          accessToken: 'claude-access-token',
          refreshToken: 'claude-refresh-token',
          expiresAt: Date.now() + 3600000,
          scopes: ['user:read', 'repo:write'],
        },
        codexAuth: {
          apiKey: 'sk-openai-key',
          accessToken: 'openai-oauth-token',
          expiresAt: Date.now() + 7200000,
        },
        geminiAuth: {
          accessToken: 'ya29.google-token',
          refreshToken: '1//google-refresh',
          expiresAt: Date.now() + 3600000,
          tokenType: 'Bearer',
          scope: 'https://www.googleapis.com/auth/cloud-platform',
        },
        openrouterApiKey: 'sk-or-openrouter-key',
        imageAiKeys: {
          openrouter: 'sk-or-image-key',
          cometapi: 'comet-api-key',
          google: 'AIza-google-key',
        },
      };

      // Encrypt
      const encrypted = encryptUserFields(original);

      // Verify all fields are encrypted
      assert.ok(isEncrypted(encrypted.githubAccessToken as string));
      assert.ok(isEncrypted(encrypted.claudeAuth as string));
      assert.ok(isEncrypted(encrypted.codexAuth as string));
      assert.ok(isEncrypted(encrypted.geminiAuth as string));
      assert.ok(isEncrypted(encrypted.openrouterApiKey as string));
      assert.ok(isEncrypted(encrypted.imageAiKeys as string));

      // Decrypt
      const decrypted = decryptUserFields(encrypted as any);

      // Verify all fields match original
      assert.strictEqual(decrypted.githubAccessToken, original.githubAccessToken);
      assert.deepStrictEqual(decrypted.claudeAuth, original.claudeAuth);
      assert.deepStrictEqual(decrypted.codexAuth, original.codexAuth);
      assert.deepStrictEqual(decrypted.geminiAuth, original.geminiAuth);
      assert.strictEqual(decrypted.openrouterApiKey, original.openrouterApiKey);
      assert.deepStrictEqual(decrypted.imageAiKeys, original.imageAiKeys);
    });
  });
});
