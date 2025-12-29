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
  return !!process.env.ENCRYPTION_KEY;
}

/**
 * Get or derive the encryption key from environment variable
 * Uses PBKDF2 for key derivation to handle variable-length passphrases
 */
function getEncryptionKey(): Buffer {
  if (cachedKey && cachedSalt === process.env.ENCRYPTION_SALT) {
    return cachedKey;
  }

  const passphrase = process.env.ENCRYPTION_KEY;
  if (!passphrase) {
    throw new Error(
      'ENCRYPTION_KEY environment variable is not set. ' +
      'Set a strong passphrase (32+ characters recommended) for data encryption.'
    );
  }

  // Use a fixed salt stored in environment (for consistent key derivation)
  // or generate one and store it
  let salt = process.env.ENCRYPTION_SALT;
  if (!salt) {
    // If no salt is provided, use a deterministic derivation from the key
    // This allows the system to work without explicit salt config
    salt = pbkdf2Sync(passphrase, 'webedt-encryption-salt', 1000, SALT_LENGTH, 'sha256').toString('hex');
  }

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
 */
export function encryptJson<T>(data: T): string {
  if (data === null || data === undefined) {
    return data as unknown as string;
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
    // Try to parse as JSON
    try {
      return JSON.parse(value as string) as T;
    } catch {
      return value as unknown as T;
    }
  }

  // If not encrypted, try parsing as JSON
  if (!isEncrypted(value as string)) {
    try {
      return JSON.parse(value as string) as T;
    } catch {
      return value as unknown as T;
    }
  }

  return decryptJson<T>(value as string);
}

/**
 * Re-encrypt data with a new key (for key rotation)
 * Decrypts with old key and encrypts with new key
 */
export function rotateEncryption(
  encryptedData: string,
  oldKey: string,
  newKey: string
): string {
  // Temporarily set the old key to decrypt
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalSalt = process.env.ENCRYPTION_SALT;

  try {
    // Clear cache and set old key
    cachedKey = null;
    cachedSalt = null;
    process.env.ENCRYPTION_KEY = oldKey;

    // Decrypt with old key
    const plaintext = decrypt(encryptedData);

    // Clear cache and set new key
    cachedKey = null;
    cachedSalt = null;
    process.env.ENCRYPTION_KEY = newKey;

    // Encrypt with new key
    return encrypt(plaintext);
  } finally {
    // Restore original key
    cachedKey = null;
    cachedSalt = null;
    process.env.ENCRYPTION_KEY = originalKey;
    process.env.ENCRYPTION_SALT = originalSalt;
  }
}

/**
 * Clear the cached encryption key (useful for testing or key rotation)
 */
export function clearKeyCache(): void {
  cachedKey = null;
  cachedSalt = null;
}

/**
 * Validate that the encryption key is properly configured
 */
export function validateEncryptionConfig(): { valid: boolean; error?: string } {
  if (!process.env.ENCRYPTION_KEY) {
    return {
      valid: false,
      error: 'ENCRYPTION_KEY environment variable is not set',
    };
  }

  if (process.env.ENCRYPTION_KEY.length < 16) {
    return {
      valid: false,
      error: 'ENCRYPTION_KEY should be at least 16 characters (32+ recommended)',
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
