/**
 * Tests for encryption utilities.
 * Covers AES-256-GCM encryption, key derivation, and JSON handling.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  isEncrypted,
  safeEncrypt,
  safeDecrypt,
  safeEncryptJson,
  safeDecryptJson,
  isEncryptionEnabled,
  validateEncryptionConfig,
  clearKeyCache,
} from '../src/utils/encryption.js';

// Valid test salt (32 hex characters = 16 bytes)
const TEST_SALT = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6';

describe('Encryption', () => {
  // Store original env vars
  let originalEncryptionKey: string | undefined;
  let originalEncryptionSalt: string | undefined;

  beforeEach(() => {
    originalEncryptionKey = process.env.ENCRYPTION_KEY;
    originalEncryptionSalt = process.env.ENCRYPTION_SALT;
    clearKeyCache();
  });

  afterEach(() => {
    // Restore original env vars
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

  describe('isEncryptionEnabled', () => {
    it('should return false when ENCRYPTION_KEY is not set', () => {
      delete process.env.ENCRYPTION_KEY;
      assert.strictEqual(isEncryptionEnabled(), false);
    });

    it('should return true when ENCRYPTION_KEY is set', () => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters';
      assert.strictEqual(isEncryptionEnabled(), true);
    });
  });

  describe('validateEncryptionConfig', () => {
    it('should fail when ENCRYPTION_KEY is not set', () => {
      delete process.env.ENCRYPTION_KEY;
      delete process.env.ENCRYPTION_SALT;
      const result = validateEncryptionConfig();
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('not set'));
    });

    it('should fail when ENCRYPTION_KEY is too short', () => {
      process.env.ENCRYPTION_KEY = 'short';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const result = validateEncryptionConfig();
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('at least 16 characters'));
    });

    it('should fail when ENCRYPTION_SALT is not set', () => {
      process.env.ENCRYPTION_KEY = 'this-is-a-valid-encryption-key-32-chars';
      delete process.env.ENCRYPTION_SALT;
      const result = validateEncryptionConfig();
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('ENCRYPTION_SALT'));
    });

    it('should fail when ENCRYPTION_SALT is invalid hex', () => {
      process.env.ENCRYPTION_KEY = 'this-is-a-valid-encryption-key-32-chars';
      process.env.ENCRYPTION_SALT = 'not-valid-hex';
      const result = validateEncryptionConfig();
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('hex string'));
    });

    it('should fail when ENCRYPTION_SALT is too short', () => {
      process.env.ENCRYPTION_KEY = 'this-is-a-valid-encryption-key-32-chars';
      process.env.ENCRYPTION_SALT = 'a1b2c3d4'; // Only 8 hex chars
      const result = validateEncryptionConfig();
      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('32 characters'));
    });

    it('should pass with valid ENCRYPTION_KEY and ENCRYPTION_SALT', () => {
      process.env.ENCRYPTION_KEY = 'this-is-a-valid-encryption-key-32-chars';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const result = validateEncryptionConfig();
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.error, undefined);
    });
  });

  describe('encrypt and decrypt', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should encrypt and decrypt a simple string', () => {
      const plaintext = 'Hello, World!';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      assert.notStrictEqual(encrypted, plaintext);
      assert.strictEqual(decrypted, plaintext);
    });

    it('should produce different ciphertexts for same plaintext (random IV)', () => {
      const plaintext = 'Same message';
      const encrypted1 = encrypt(plaintext);
      const encrypted2 = encrypt(plaintext);

      assert.notStrictEqual(encrypted1, encrypted2);
      assert.strictEqual(decrypt(encrypted1), plaintext);
      assert.strictEqual(decrypt(encrypted2), plaintext);
    });

    it('should handle empty string', () => {
      const plaintext = '';
      const encrypted = encrypt(plaintext);
      assert.strictEqual(encrypted, '');
    });

    it('should handle special characters and unicode', () => {
      const plaintext = '🔐 Sécurité: "quotes" & <brackets> 日本語';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      assert.strictEqual(decrypted, plaintext);
    });

    it('should handle long strings', () => {
      const plaintext = 'a'.repeat(10000);
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      assert.strictEqual(decrypted, plaintext);
    });

    it('should return unencrypted data as-is in decrypt', () => {
      const plaintext = 'not-encrypted-data';
      const result = decrypt(plaintext);
      assert.strictEqual(result, plaintext);
    });

    it('should throw error with wrong key', () => {
      const plaintext = 'secret message';
      const encrypted = encrypt(plaintext);

      // Change the key (keep salt same to isolate key change)
      process.env.ENCRYPTION_KEY = 'different-key-at-least-32-characters-long';
      clearKeyCache();

      assert.throws(() => decrypt(encrypted), /Failed to decrypt/);
    });
  });

  describe('isEncrypted', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should return true for encrypted data', () => {
      const encrypted = encrypt('test');
      assert.strictEqual(isEncrypted(encrypted), true);
    });

    it('should return false for plain text', () => {
      assert.strictEqual(isEncrypted('plain text'), false);
    });

    it('should return false for null/undefined', () => {
      assert.strictEqual(isEncrypted(null as any), false);
      assert.strictEqual(isEncrypted(undefined as any), false);
    });

    it('should return false for empty string', () => {
      assert.strictEqual(isEncrypted(''), false);
    });
  });

  describe('encryptJson and decryptJson', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should encrypt and decrypt JSON objects', () => {
      const data = { accessToken: 'abc123', refreshToken: 'xyz789' };
      const encrypted = encryptJson(data);
      const decrypted = decryptJson<typeof data>(encrypted);

      assert.deepStrictEqual(decrypted, data);
    });

    it('should handle nested objects', () => {
      const data = {
        user: {
          credentials: {
            token: 'secret',
            expiry: 12345,
          },
        },
      };
      const encrypted = encryptJson(data);
      const decrypted = decryptJson<typeof data>(encrypted);

      assert.deepStrictEqual(decrypted, data);
    });

    it('should handle arrays', () => {
      const data = ['token1', 'token2', 'token3'];
      const encrypted = encryptJson(data);
      const decrypted = decryptJson<typeof data>(encrypted);

      assert.deepStrictEqual(decrypted, data);
    });

    it('should return null for null input', () => {
      const encrypted = encryptJson(null);
      assert.strictEqual(encrypted, null);
    });
  });

  describe('safeEncrypt and safeDecrypt', () => {
    it('should return original value when encryption disabled', () => {
      delete process.env.ENCRYPTION_KEY;
      const value = 'test-token';

      assert.strictEqual(safeEncrypt(value), value);
      assert.strictEqual(safeDecrypt(value), value);
    });

    it('should encrypt when encryption is enabled', () => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const value = 'test-token';

      const encrypted = safeEncrypt(value);
      assert.notStrictEqual(encrypted, value);
      assert.strictEqual(safeDecrypt(encrypted), value);
    });

    it('should handle null values', () => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;

      assert.strictEqual(safeEncrypt(null), null);
      assert.strictEqual(safeDecrypt(null), null);
    });

    it('should decrypt unencrypted data as-is', () => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const plainValue = 'not-encrypted';

      assert.strictEqual(safeDecrypt(plainValue), plainValue);
    });
  });

  describe('safeEncryptJson and safeDecryptJson', () => {
    it('should return JSON string when encryption disabled', () => {
      delete process.env.ENCRYPTION_KEY;
      const data = { token: 'abc123' };

      const result = safeEncryptJson(data);
      assert.strictEqual(result, JSON.stringify(data));
    });

    it('should encrypt JSON when encryption is enabled', () => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const data = { token: 'abc123', expiry: 12345 };

      const encrypted = safeEncryptJson(data);
      assert.ok(isEncrypted(encrypted as string));

      const decrypted = safeDecryptJson<typeof data>(encrypted);
      assert.deepStrictEqual(decrypted, data);
    });

    it('should handle already-object values in decrypt', () => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const data = { token: 'abc123' };

      // If value is already an object, should return as-is
      const result = safeDecryptJson<typeof data>(data);
      assert.deepStrictEqual(result, data);
    });

    it('should handle plain JSON strings in decrypt', () => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const data = { token: 'abc123' };
      const jsonString = JSON.stringify(data);

      const result = safeDecryptJson<typeof data>(jsonString);
      assert.deepStrictEqual(result, data);
    });
  });

  describe('Encryption Format', () => {
    beforeEach(() => {
      process.env.ENCRYPTION_KEY = 'test-encryption-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = TEST_SALT;
    });

    it('should produce v1 format: version:iv:authTag:ciphertext', () => {
      const encrypted = encrypt('test');
      const parts = encrypted.split(':');

      assert.strictEqual(parts.length, 4);
      assert.strictEqual(parts[0], 'v1');

      // IV should be 12 bytes = 16 base64 chars
      assert.ok(parts[1].length >= 16);

      // Auth tag should be 16 bytes = 24 base64 chars
      assert.ok(parts[2].length >= 22);

      // Ciphertext should be present
      assert.ok(parts[3].length > 0);
    });
  });

  describe('Key Derivation', () => {
    it('should produce consistent keys for same passphrase and salt', () => {
      process.env.ENCRYPTION_KEY = 'consistent-key-test-at-least-32-characters';
      process.env.ENCRYPTION_SALT = TEST_SALT;
      const plaintext = 'test message';

      const encrypted1 = encrypt(plaintext);
      clearKeyCache();
      const encrypted2 = encrypt(plaintext);

      // Both should decrypt successfully
      assert.strictEqual(decrypt(encrypted1), plaintext);
      assert.strictEqual(decrypt(encrypted2), plaintext);
    });

    it('should work with different valid salts', () => {
      process.env.ENCRYPTION_KEY = 'test-key-at-least-32-characters-long';
      process.env.ENCRYPTION_SALT = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // 26 bytes in hex (52 chars)

      const plaintext = 'test with salt';
      const encrypted = encrypt(plaintext);
      const decrypted = decrypt(encrypted);

      assert.strictEqual(decrypted, plaintext);
    });

    it('should produce different ciphertext with different salt', () => {
      const plaintext = 'same message';
      process.env.ENCRYPTION_KEY = 'test-key-at-least-32-characters-long';

      // First salt
      process.env.ENCRYPTION_SALT = TEST_SALT;
      clearKeyCache();
      const encrypted1 = encrypt(plaintext);

      // Different salt
      process.env.ENCRYPTION_SALT = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7';
      clearKeyCache();
      const encrypted2 = encrypt(plaintext);

      // Same plaintext but different encryption due to different derived key
      // Note: encrypted texts will be different and cross-decryption should fail
      assert.notStrictEqual(encrypted1, encrypted2);

      // Each should decrypt with its own salt
      process.env.ENCRYPTION_SALT = TEST_SALT;
      clearKeyCache();
      assert.strictEqual(decrypt(encrypted1), plaintext);

      process.env.ENCRYPTION_SALT = 'b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7';
      clearKeyCache();
      assert.strictEqual(decrypt(encrypted2), plaintext);
    });
  });
});
