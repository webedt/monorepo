/**
 * Idempotency Key Generation and Management
 *
 * Provides client-side utilities for generating idempotency keys
 * to ensure safe retries of critical operations like payments and bulk actions.
 *
 * Usage:
 * - Call generateIdempotencyKey() for each unique operation
 * - Pass the key in the X-Idempotency-Key header
 * - The server will cache responses and return them on duplicate requests
 *
 * For automatic retry safety, use withIdempotencyKey() wrapper
 */

// Header name must match backend
export const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';

/**
 * Generate a unique idempotency key using the browser's crypto API
 * Returns a UUID v4 string
 */
export function generateIdempotencyKey(): string {
  // Use crypto.randomUUID if available (most modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older browsers: generate UUID v4 manually
  // Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  const getRandomHex = (length: number): string => {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  };

  const hex = getRandomHex(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16), // Version 4
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20), // Variant
    hex.slice(20, 32),
  ].join('-');
}

/**
 * Storage key prefix for persisted idempotency keys
 */
const IDEMPOTENCY_STORAGE_PREFIX = 'idempotency_';

/**
 * Get or create an idempotency key for a specific operation
 * Useful for ensuring the same key is used across retries
 *
 * @param operationId - Unique identifier for the operation (e.g., 'checkout_game123')
 * @param ttlMs - Time to live in milliseconds (default: 24 hours)
 * @returns The idempotency key for this operation
 */
export function getOrCreateIdempotencyKey(operationId: string, ttlMs: number = 24 * 60 * 60 * 1000): string {
  const storageKey = IDEMPOTENCY_STORAGE_PREFIX + operationId;

  try {
    const stored = sessionStorage.getItem(storageKey);
    if (stored) {
      const { key, expiresAt } = JSON.parse(stored);
      if (new Date(expiresAt) > new Date()) {
        return key;
      }
    }

    // Generate new key
    const key = generateIdempotencyKey();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    sessionStorage.setItem(storageKey, JSON.stringify({ key, expiresAt }));
    return key;
  } catch {
    // If storage fails, just generate a new key
    return generateIdempotencyKey();
  }
}

/**
 * Clear a stored idempotency key after successful completion
 * Call this after the operation succeeds to allow new operations
 *
 * @param operationId - The operation identifier used in getOrCreateIdempotencyKey
 */
export function clearIdempotencyKey(operationId: string): void {
  const storageKey = IDEMPOTENCY_STORAGE_PREFIX + operationId;
  try {
    sessionStorage.removeItem(storageKey);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Create headers object with idempotency key
 *
 * @param key - Optional pre-generated key (generates new one if not provided)
 * @returns Headers object to spread into fetch options
 */
export function createIdempotencyHeaders(key?: string): Record<string, string> {
  return {
    [IDEMPOTENCY_KEY_HEADER]: key || generateIdempotencyKey(),
  };
}

/**
 * Operation-specific idempotency key generators
 * These create consistent keys based on operation parameters
 */
export const IdempotencyKeys = {
  /**
   * Generate key for payment checkout
   */
  checkout: (gameId: string, provider: string = 'stripe'): string => {
    return getOrCreateIdempotencyKey(`checkout_${gameId}_${provider}`);
  },

  /**
   * Generate key for PayPal capture
   */
  paypalCapture: (orderId: string): string => {
    return getOrCreateIdempotencyKey(`paypal_capture_${orderId}`);
  },

  /**
   * Generate key for refund request
   */
  refund: (transactionId: string): string => {
    return getOrCreateIdempotencyKey(`refund_${transactionId}`);
  },

  /**
   * Generate key for bulk delete operation
   */
  bulkDelete: (sessionIds: string[]): string => {
    // Create a deterministic key based on the session IDs
    const sortedIds = [...sessionIds].sort().join(',');
    return getOrCreateIdempotencyKey(`bulk_delete_${sortedIds.slice(0, 100)}`);
  },

  /**
   * Generate key for bulk restore operation
   */
  bulkRestore: (sessionIds: string[]): string => {
    const sortedIds = [...sessionIds].sort().join(',');
    return getOrCreateIdempotencyKey(`bulk_restore_${sortedIds.slice(0, 100)}`);
  },

  /**
   * Generate key for empty trash operation
   */
  emptyTrash: (): string => {
    // Use timestamp-based key so user can empty trash multiple times
    // but not accidentally trigger duplicates within the same session
    const timestamp = Math.floor(Date.now() / 1000); // Second precision
    return getOrCreateIdempotencyKey(`empty_trash_${timestamp}`);
  },

  /**
   * Generate key for bulk archive operation
   */
  bulkArchive: (sessionIds: string[]): string => {
    const sortedIds = [...sessionIds].sort().join(',');
    return getOrCreateIdempotencyKey(`bulk_archive_${sortedIds.slice(0, 100)}`);
  },

  /**
   * Clear checkout key after successful purchase
   */
  clearCheckout: (gameId: string, provider: string = 'stripe'): void => {
    clearIdempotencyKey(`checkout_${gameId}_${provider}`);
  },

  /**
   * Clear refund key after successful request
   */
  clearRefund: (transactionId: string): void => {
    clearIdempotencyKey(`refund_${transactionId}`);
  },

  /**
   * Clear bulk operation keys
   */
  clearBulkDelete: (sessionIds: string[]): void => {
    const sortedIds = [...sessionIds].sort().join(',');
    clearIdempotencyKey(`bulk_delete_${sortedIds.slice(0, 100)}`);
  },

  clearBulkRestore: (sessionIds: string[]): void => {
    const sortedIds = [...sessionIds].sort().join(',');
    clearIdempotencyKey(`bulk_restore_${sortedIds.slice(0, 100)}`);
  },
};
