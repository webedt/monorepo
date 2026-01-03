/**
 * Encrypted Column Types for Drizzle ORM
 *
 * Provides custom column types that automatically encrypt data on write
 * and decrypt on read, ensuring sensitive credentials are always stored
 * encrypted in the database.
 *
 * Features:
 * - Automatic encryption using AES-256-GCM
 * - Transparent decryption on read
 * - Backward compatibility with unencrypted data
 * - Type-safe JSON handling for complex auth objects
 *
 * Implementation Note:
 * For JSON columns, encrypted data is stored as a JSON string primitive
 * (e.g., "v1:iv:tag:ciphertext"). PostgreSQL's JSONB accepts string primitives
 * as valid JSON, allowing us to store encrypted data without schema migration.
 */

import { customType } from 'drizzle-orm/pg-core';
import { safeJsonParse } from '../utils/api/safeJson.js';

import {
  safeEncrypt,
  safeDecrypt,
  safeEncryptJson,
  safeDecryptJson,
  isEncrypted,
  isEncryptionEnabled,
} from '../utils/encryption.js';

/**
 * Encrypted text column type
 *
 * Automatically encrypts string values when writing to the database
 * and decrypts when reading. Handles null values and backward
 * compatibility with unencrypted data.
 *
 * Usage in schema:
 * ```ts
 * githubAccessToken: encryptedText('github_access_token'),
 * ```
 */
export const encryptedText = customType<{
  data: string;
  driverData: string;
}>({
  dataType() {
    return 'text';
  },
  toDriver(value: string): string {
    if (value === null || value === undefined) {
      return value;
    }
    // Encrypt if encryption is enabled and value is not already encrypted
    if (isEncryptionEnabled() && !isEncrypted(value)) {
      return safeEncrypt(value) ?? value;
    }
    return value;
  },
  fromDriver(value: string): string {
    if (value === null || value === undefined) {
      return value;
    }
    // Decrypt if the value is encrypted
    return safeDecrypt(value) ?? value;
  },
});

/**
 * Create an encrypted JSON column type for a specific data structure
 *
 * Automatically encrypts JSON objects when writing to the database
 * and decrypts when reading. The encrypted data is stored in a JSON
 * column as either:
 * - An encrypted string (when encryption enabled): "v1:iv:tag:ciphertext"
 * - A plain JSON object (when encryption disabled or legacy data)
 *
 * This maintains backward compatibility with existing JSON data while
 * enabling transparent encryption for new writes.
 *
 * Usage in schema:
 * ```ts
 * claudeAuth: encryptedJsonColumn<ClaudeAuthData>('claude_auth'),
 * ```
 */
export function encryptedJsonColumn<T>(columnName: string) {
  return customType<{
    data: T | null;
    driverData: unknown;
  }>({
    dataType() {
      // Keep as JSON for backward compatibility - encrypted data stored as JSON string
      return 'json';
    },
    toDriver(value: T | null): unknown {
      if (value === null || value === undefined) {
        return null;
      }
      // Encrypt JSON to string if encryption is enabled
      if (isEncryptionEnabled()) {
        // Return encrypted string - PostgreSQL JSON accepts string primitives
        return safeEncryptJson(value);
      }
      // Store as plain JSON object when encryption is disabled
      return value;
    },
    fromDriver(value: unknown): T | null {
      if (value === null || value === undefined) {
        return null;
      }
      // Handle encrypted string
      if (typeof value === 'string') {
        if (isEncrypted(value)) {
          return safeDecryptJson<T>(value);
        }
        // Try to parse as JSON string (shouldn't happen but handle gracefully)
        const parseResult = safeJsonParse<T>(value, {
          component: 'EncryptedColumns',
          logErrors: true,
          logLevel: 'debug',
        });
        return parseResult.success ? parseResult.data : null;
      }
      // Handle plain JSON object (legacy unencrypted data or encryption disabled)
      if (typeof value === 'object') {
        return value as T;
      }
      return null;
    },
  })(columnName);
}

// Re-export type definitions for use in schema.ts
// Types are defined in authTypes.ts to avoid circular dependencies
export type {
  ClaudeAuthData,
  CodexAuthData,
  GeminiAuthData,
  ImageAiKeysData,
} from './authTypes.js';
