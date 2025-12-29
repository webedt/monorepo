/**
 * Encryption utilities for sensitive data at rest
 *
 * Uses AES-256-GCM for authenticated encryption providing:
 * - Confidentiality (encryption)
 * - Authenticity (authentication tag)
 * - Integrity (tamper detection)
 *
 * Format: version:iv:authTag:ciphertext (all base64 encoded)
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from 'crypto';
import { logger } from './logging/logger.js';
import { ENCRYPTION_KEY, ENCRYPTION_SALT } from '../config/env.js';

// Constants
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const AUTH_TAG_LENGTH = 16; // 128 bits
const SALT_LENGTH = 16; // 128 bits for key derivation
const KEY_LENGTH = 32; // 256 bits for AES-256
const PBKDF2_ITERATIONS = 100000;
const CURRENT_VERSION = 'v1';

// Separator for encrypted data format
const SEPARATOR = ':';

// Cached derived key (derived once on startup)
let cachedKey: Buffer | null = null;
let cachedSalt: string | null = null;
let cachedPassphrase: string | null = null;

/**
 * Encrypted data format
 */
export interface EncryptedData {
  version: string;
  iv: string; // base64
  authTag: string; // base64
  ciphertext: string; // base64
}

/**
 * Check if encryption is enabled (ENCRYPTION_KEY is set)
 */
export function isEncryptionEnabled(): boolean {
  return !!ENCRYPTION_KEY;
}

/**
 * Get or derive the encryption key from environment variable
 * Uses PBKDF2 for key derivation to handle variable-length passphrases
 */
function getEncryptionKey(): Buffer {
  const passphrase = ENCRYPTION_KEY;
  const salt = ENCRYPTION_SALT;

  // Check if we can use cached key (both passphrase and salt unchanged)
  if (cachedKey && cachedPassphrase === passphrase && cachedSalt === salt) {
    return cachedKey;
  }

  if (!passphrase) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'Set a strong passphrase (32+ characters recommended) for data encryption.'
    );
  }

  // Require explicit salt for production security
  // Using PBKDF2 with the same key to derive a salt is cryptographically weak
  if (!salt) {
    throw new Error(
      'ENCRYPTION_SALT environment variable is not set. ' +
      'Generate a random 32-character hex string (16 bytes) for the salt. ' +
      'Example: openssl rand -hex 16'
    );
  }

  // Validate salt format (should be hex string of at least 16 bytes = 32 hex chars)
  if (!/^[0-9a-fA-F]{32,}$/.test(salt)) {
    throw new Error(
      'ENCRYPTION_SALT must be a valid hex string of at least 32 characters (16 bytes). ' +
      'Example: openssl rand -hex 16'
    );
  }

  cachedPassphrase = passphrase;
  cachedSalt = salt;
  cachedKey = pbkdf2Sync(
    passphrase,
    Buffer.from(salt, 'hex'),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha512'
  );

  return cachedKey;
}

/**
 * Encrypt a string value using AES-256-GCM
 * Returns the encrypted data in format: version:iv:authTag:ciphertext
 */
export function encrypt(plaintext: string): string {
  if (!plaintext) {
    return plaintext;
  }

  try {
    const key = getEncryptionKey();
    const iv = randomBytes(IV_LENGTH);

    const cipher = createCipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });

    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    // Format: version:iv:authTag:ciphertext (all base64)
    return [
      CURRENT_VERSION,
      iv.toString('base64'),
      authTag.toString('base64'),
      encrypted.toString('base64'),
    ].join(SEPARATOR);
  } catch (error) {
    logger.error('Encryption failed', error as Error, { component: 'Encryption' });
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted string
 * Expects format: version:iv:authTag:ciphertext
 */
export function decrypt(encryptedData: string): string {
  if (!encryptedData) {
    return encryptedData;
  }

  // Check if data looks encrypted (starts with version prefix)
  if (!encryptedData.startsWith(CURRENT_VERSION + SEPARATOR)) {
    // Data is not encrypted, return as-is (backward compatibility)
    return encryptedData;
  }

  try {
    const key = getEncryptionKey();
    const parts = encryptedData.split(SEPARATOR);

    if (parts.length !== 4) {
      throw new Error('Invalid encrypted data format');
    }

    const [version, ivBase64, authTagBase64, ciphertextBase64] = parts;

    if (version !== CURRENT_VERSION) {
      throw new Error(`Unsupported encryption version: ${version}`);
    }

    const iv = Buffer.from(ivBase64, 'base64');
    const authTag = Buffer.from(authTagBase64, 'base64');
    const ciphertext = Buffer.from(ciphertextBase64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv, {
      authTagLength: AUTH_TAG_LENGTH,
    });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString('utf8');
  } catch (error) {
    logger.error('Decryption failed', error as Error, { component: 'Encryption' });
    throw new Error('Failed to decrypt data - key may have changed or data is corrupted');
  }
}

/**
 * Encrypt a JSON object
 * Returns null for null/undefined input, encrypted string otherwise
 */
export function encryptJson<T>(data: T | null | undefined): string | null {
  if (data === null || data === undefined) {
    return null;
  }

  const jsonString = JSON.stringify(data);
  return encrypt(jsonString);
}

/**
 * Decrypt a JSON object
 */
export function decryptJson<T>(encryptedData: string): T | null {
  if (!encryptedData) {
    return null;
  }

  const jsonString = decrypt(encryptedData);
  try {
    return JSON.parse(jsonString) as T;
  } catch {
    // If JSON parse fails, the data might not be encrypted JSON
    // This handles backward compatibility
    return null;
  }
}

/**
 * Check if a string appears to be encrypted (has our format)
 */
export function isEncrypted(data: string): boolean {
  if (!data || typeof data !== 'string') {
    return false;
  }
  return data.startsWith(CURRENT_VERSION + SEPARATOR);
}

/**
 * Safely encrypt a value, returning original if encryption is disabled
 */
export function safeEncrypt(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isEncryptionEnabled()) {
    return value;
  }

  return encrypt(value);
}

/**
 * Safely decrypt a value, handling unencrypted data gracefully
 */
export function safeDecrypt(value: string | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isEncryptionEnabled()) {
    return value;
  }

  // If not encrypted, return as-is
  if (!isEncrypted(value)) {
    return value;
  }

  return decrypt(value);
}

/**
 * Safely encrypt a JSON value
 */
export function safeEncryptJson<T>(data: T | null | undefined): string | null {
  if (data === null || data === undefined) {
    return null;
  }

  if (!isEncryptionEnabled()) {
    // Return as JSON string for storage
    return JSON.stringify(data);
  }

  return encryptJson(data);
}

/**
 * Safely decrypt a JSON value, handling both encrypted and plain JSON
 * Returns null if the value cannot be decrypted or parsed as JSON
 */
export function safeDecryptJson<T>(value: string | T | null | undefined): T | null {
  if (value === null || value === undefined) {
    return null;
  }

  // If it's already an object (not encrypted), return as-is
  if (typeof value === 'object') {
    return value as T;
  }

  if (!isEncryptionEnabled()) {
    // Try to parse as JSON, return null if invalid
    try {
      return JSON.parse(value as string) as T;
    } catch {
      logger.warn('Failed to parse unencrypted JSON value', {
        component: 'Encryption',
        valueLength: (value as string).length,
      });
      return null;
    }
  }

  // If not encrypted, try parsing as JSON
  if (!isEncrypted(value as string)) {
    try {
      return JSON.parse(value as string) as T;
    } catch {
      logger.warn('Failed to parse unencrypted JSON value', {
        component: 'Encryption',
        valueLength: (value as string).length,
      });
      return null;
    }
  }

  return decryptJson<T>(value as string);
}

/**
 * Derive an encryption key from passphrase and salt
 * Used internally for key rotation without modifying global state
 */
function deriveKey(passphrase: string, salt: string): Buffer {
  if (!/^[0-9a-fA-F]{32,}$/.test(salt)) {
    throw new Error('Salt must be a valid hex string of at least 32 characters');
  }

  return pbkdf2Sync(
    passphrase,
    Buffer.from(salt, 'hex'),
    PBKDF2_ITERATIONS,
    KEY_LENGTH,
    'sha512'
  );
}

/**
 * Decrypt data using a specific key (for key rotation)
 * Does not use or modify the global key cache
 */
function decryptWithKey(encryptedData: string, key: Buffer): string {
  if (!encryptedData) {
    return encryptedData;
  }

  if (!encryptedData.startsWith(CURRENT_VERSION + SEPARATOR)) {
    return encryptedData;
  }

  const parts = encryptedData.split(SEPARATOR);
  if (parts.length !== 4) {
    throw new Error('Invalid encrypted data format');
  }

  const [version, ivBase64, authTagBase64, ciphertextBase64] = parts;
  if (version !== CURRENT_VERSION) {
    throw new Error(`Unsupported encryption version: ${version}`);
  }

  const iv = Buffer.from(ivBase64, 'base64');
  const authTag = Buffer.from(authTagBase64, 'base64');
  const ciphertext = Buffer.from(ciphertextBase64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

/**
 * Encrypt data using a specific key (for key rotation)
 * Does not use or modify the global key cache
 */
function encryptWithKey(plaintext: string, key: Buffer): string {
  if (!plaintext) {
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    CURRENT_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(SEPARATOR);
}

/**
 * Re-encrypt data with a new key (for key rotation)
 * Decrypts with old key and encrypts with new key
 * This function is thread-safe and does not modify global state
 */
export function rotateEncryption(
  encryptedData: string,
  oldPassphrase: string,
  oldSalt: string,
  newPassphrase: string,
  newSalt: string
): string {
  // Derive keys without modifying global state
  const oldKey = deriveKey(oldPassphrase, oldSalt);
  const newKey = deriveKey(newPassphrase, newSalt);

  // Decrypt with old key
  const plaintext = decryptWithKey(encryptedData, oldKey);

  // Encrypt with new key
  return encryptWithKey(plaintext, newKey);
}

/**
 * Clear the cached encryption key (useful for testing or key rotation)
 */
export function clearKeyCache(): void {
  cachedKey = null;
  cachedSalt = null;
  cachedPassphrase = null;
}

/**
 * Validate that the encryption key and salt are properly configured
 */
export function validateEncryptionConfig(): { valid: boolean; error?: string } {
  if (!ENCRYPTION_KEY) {
    return {
      valid: false,
      error: 'ENCRYPTION_KEY environment variable is not set',
    };
  }

  if (ENCRYPTION_KEY.length < 16) {
    return {
      valid: false,
      error: 'ENCRYPTION_KEY should be at least 16 characters (32+ recommended)',
    };
  }

  if (!ENCRYPTION_SALT) {
    return {
      valid: false,
      error: 'ENCRYPTION_SALT environment variable is not set. Generate with: openssl rand -hex 16',
    };
  }

  if (!/^[0-9a-fA-F]{32,}$/.test(ENCRYPTION_SALT)) {
    return {
      valid: false,
      error: 'ENCRYPTION_SALT must be a valid hex string of at least 32 characters (16 bytes)',
    };
  }

  // Test encryption/decryption
  try {
    const testData = 'encryption-test-' + Date.now();
    const encrypted = encrypt(testData);
    const decrypted = decrypt(encrypted);

    if (decrypted !== testData) {
      return {
        valid: false,
        error: 'Encryption/decryption round-trip test failed',
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: `Encryption test failed: ${(error as Error).message}`,
    };
  }

  return { valid: true };
}
