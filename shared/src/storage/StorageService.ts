/**
 * Storage Service - User storage quota management
 *
 * Tracks and enforces per-user storage quotas.
 * Default quota: 5 GB per user ("Few GB per user" requirement)
 */

import { db, users, eq, sql } from '../db/index.js';

// Storage tier definitions (in bytes)
export const STORAGE_TIERS = {
  FREE: 1 * 1024 * 1024 * 1024,      // 1 GB
  BASIC: 5 * 1024 * 1024 * 1024,     // 5 GB (default)
  PRO: 25 * 1024 * 1024 * 1024,      // 25 GB
  ENTERPRISE: 100 * 1024 * 1024 * 1024, // 100 GB
} as const;

export type StorageTier = keyof typeof STORAGE_TIERS;

export interface StorageStats {
  usedBytes: bigint;
  quotaBytes: bigint;
  availableBytes: bigint;
  usagePercent: number;
  breakdown: StorageBreakdown;
}

export interface StorageBreakdown {
  messages: bigint;
  events: bigint;
  liveChatMessages: bigint;
  workspaceEvents: bigint;
  images: bigint;
  total: bigint;
}

export interface StorageQuotaCheck {
  allowed: boolean;
  usedBytes: bigint;
  quotaBytes: bigint;
  availableBytes: bigint;
  requestedBytes: bigint;
}

/**
 * Calculate the byte size of a base64-encoded string's original data
 */
export function calculateBase64Size(base64String: string): number {
  if (!base64String) return 0;

  // Remove data URL prefix if present (e.g., "data:image/png;base64,")
  const base64Data = base64String.includes(',')
    ? base64String.split(',')[1]
    : base64String;

  if (!base64Data) return 0;

  // Calculate original byte size from base64
  // Base64 encodes 3 bytes as 4 characters
  // Account for padding characters
  const paddingCount = (base64Data.match(/=+$/) || [''])[0].length;
  return Math.floor((base64Data.length * 3) / 4) - paddingCount;
}

/**
 * Calculate the byte size of a JSON object when serialized
 */
export function calculateJsonSize(data: unknown): number {
  if (data === null || data === undefined) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(data), 'utf8');
  } catch {
    return 0;
  }
}

/**
 * Calculate the byte size of a string
 */
export function calculateStringSize(str: string | null | undefined): number {
  if (!str) return 0;
  return Buffer.byteLength(str, 'utf8');
}

/**
 * Storage Service for managing user storage quotas
 */
export class StorageService {
  /**
   * Check if a user exists in the database
   */
  static async userExists(userId: string): Promise<boolean> {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return !!user;
  }

  /**
   * Get storage statistics for a user (includes full breakdown)
   * Note: This is an expensive operation - use checkQuota for quota checks
   */
  static async getStorageStats(userId: string): Promise<StorageStats> {
    const [user] = await db
      .select({
        storageQuotaBytes: users.storageQuotaBytes,
        storageUsedBytes: users.storageUsedBytes,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const quotaBytes = BigInt(user.storageQuotaBytes);
    const usedBytes = BigInt(user.storageUsedBytes);
    const availableBytes = quotaBytes > usedBytes ? quotaBytes - usedBytes : BigInt(0);
    const usagePercent = quotaBytes > 0
      ? Number((usedBytes * BigInt(10000)) / quotaBytes) / 100
      : 0;

    // Get breakdown (expensive - only call when explicitly requested)
    const breakdown = await this.getStorageBreakdown(userId);

    return {
      usedBytes,
      quotaBytes,
      availableBytes,
      usagePercent,
      breakdown,
    };
  }

  /**
   * Get detailed storage breakdown by category using aggregate SQL queries
   * Note: This is an expensive operation - use sparingly
   */
  static async getStorageBreakdown(userId: string): Promise<StorageBreakdown> {
    // Use aggregate queries in PostgreSQL to avoid loading all rows into memory
    // PostgreSQL's pg_column_size and octet_length functions help estimate sizes

    // Calculate messages storage using aggregate query
    const messagesResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(COALESCE(octet_length(m.content), 0)), 0)::bigint as content_size,
        COALESCE(SUM(COALESCE(octet_length(m.images::text), 0)), 0)::bigint as images_size
      FROM messages m
      INNER JOIN chat_sessions cs ON m.chat_session_id = cs.id
      WHERE cs.user_id = ${userId}
    `);
    const messagesRow = (messagesResult.rows as any[])[0] || { content_size: '0', images_size: '0' };
    const messagesSize = BigInt(messagesRow.content_size || 0);
    // Images are stored as JSON, approximate size from serialized length
    const imagesFromMessages = BigInt(messagesRow.images_size || 0);

    // Calculate events storage
    const eventsResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(COALESCE(octet_length(e.event_data::text), 0)), 0)::bigint as events_size
      FROM events e
      INNER JOIN chat_sessions cs ON e.chat_session_id = cs.id
      WHERE cs.user_id = ${userId}
    `);
    const eventsRow = (eventsResult.rows as any[])[0] || { events_size: '0' };
    const eventsSize = BigInt(eventsRow.events_size || 0);

    // Calculate live chat messages storage
    const liveChatResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(COALESCE(octet_length(content), 0)), 0)::bigint as content_size,
        COALESCE(SUM(COALESCE(octet_length(images::text), 0)), 0)::bigint as images_size,
        COALESCE(SUM(COALESCE(octet_length(tool_calls::text), 0)), 0)::bigint as tool_calls_size
      FROM live_chat_messages
      WHERE user_id = ${userId}
    `);
    const liveChatRow = (liveChatResult.rows as any[])[0] || { content_size: '0', images_size: '0', tool_calls_size: '0' };
    const liveChatSize = BigInt(liveChatRow.content_size || 0) + BigInt(liveChatRow.tool_calls_size || 0);
    const imagesFromLiveChat = BigInt(liveChatRow.images_size || 0);

    // Calculate workspace events storage
    const workspaceResult = await db.execute(sql`
      SELECT
        COALESCE(SUM(COALESCE(octet_length(payload::text), 0)), 0)::bigint as payload_size
      FROM workspace_events
      WHERE user_id = ${userId}
    `);
    const workspaceRow = (workspaceResult.rows as any[])[0] || { payload_size: '0' };
    const workspaceEventsSize = BigInt(workspaceRow.payload_size || 0);

    // Total images (from messages + live chat)
    const imagesSize = imagesFromMessages + imagesFromLiveChat;

    const total = messagesSize + eventsSize + liveChatSize + workspaceEventsSize + imagesSize;

    return {
      messages: messagesSize,
      events: eventsSize,
      liveChatMessages: liveChatSize,
      workspaceEvents: workspaceEventsSize,
      images: imagesSize,
      total,
    };
  }

  /**
   * Check if a user has enough storage quota for additional bytes
   * Uses cached storageUsedBytes for performance - does NOT call getStorageBreakdown
   */
  static async checkQuota(userId: string, additionalBytes: number): Promise<StorageQuotaCheck> {
    // Use cached values only - no expensive breakdown calculation
    const [user] = await db
      .select({
        storageQuotaBytes: users.storageQuotaBytes,
        storageUsedBytes: users.storageUsedBytes,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const quotaBytes = BigInt(user.storageQuotaBytes);
    const usedBytes = BigInt(user.storageUsedBytes);
    const availableBytes = quotaBytes > usedBytes ? quotaBytes - usedBytes : BigInt(0);
    const requestedBytes = BigInt(additionalBytes);

    return {
      allowed: availableBytes >= requestedBytes,
      usedBytes,
      quotaBytes,
      availableBytes,
      requestedBytes,
    };
  }

  /**
   * Add storage usage for a user using atomic SQL UPDATE
   * This prevents race conditions from concurrent requests
   */
  static async addUsage(userId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;

    // Use atomic SQL increment to prevent race conditions
    const result = await db.execute(sql`
      UPDATE users
      SET storage_used_bytes = (COALESCE(storage_used_bytes::bigint, 0) + ${bytes})::text
      WHERE id = ${userId}
      RETURNING id
    `);

    if ((result.rows as any[]).length === 0) {
      throw new Error(`User not found: ${userId}`);
    }
  }

  /**
   * Remove storage usage for a user using atomic SQL UPDATE
   * This prevents race conditions and ensures usage doesn't go negative
   */
  static async removeUsage(userId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;

    // Use atomic SQL decrement with GREATEST to prevent negative values
    const result = await db.execute(sql`
      UPDATE users
      SET storage_used_bytes = GREATEST(0, COALESCE(storage_used_bytes::bigint, 0) - ${bytes})::text
      WHERE id = ${userId}
      RETURNING id
    `);

    if ((result.rows as any[]).length === 0) {
      throw new Error(`User not found: ${userId}`);
    }
  }

  /**
   * Recalculate and update storage usage from actual data
   * Call this periodically or when there's a discrepancy
   */
  static async recalculateUsage(userId: string): Promise<bigint> {
    const breakdown = await this.getStorageBreakdown(userId);

    await db
      .update(users)
      .set({ storageUsedBytes: breakdown.total.toString() })
      .where(eq(users.id, userId));

    return breakdown.total;
  }

  /**
   * Update storage quota for a user (admin operation)
   */
  static async setQuota(userId: string, quotaBytes: bigint): Promise<void> {
    const result = await db
      .update(users)
      .set({ storageQuotaBytes: quotaBytes.toString() })
      .where(eq(users.id, userId))
      .returning({ id: users.id });

    if (result.length === 0) {
      throw new Error(`User not found: ${userId}`);
    }
  }

  /**
   * Set storage quota based on tier
   */
  static async setTier(userId: string, tier: StorageTier): Promise<void> {
    const quotaBytes = BigInt(STORAGE_TIERS[tier]);
    await this.setQuota(userId, quotaBytes);
  }

  /**
   * Format bytes as human-readable string
   */
  static formatBytes(bytes: bigint | number): string {
    const b = typeof bytes === 'bigint' ? Number(bytes) : bytes;
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let size = b;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }

    return `${size.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  }
}

export default StorageService;
