/**
 * Storage Service - User storage quota management
 *
 * Tracks and enforces per-user storage quotas.
 * Default quota: 5 GB per user ("Few GB per user" requirement)
 */

import { db, users, messages, events, liveChatMessages, workspaceEvents, eq, sql } from '../db/index.js';

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
   * Get storage statistics for a user
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

    // Get breakdown
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
   * Get detailed storage breakdown by category
   */
  static async getStorageBreakdown(userId: string): Promise<StorageBreakdown> {
    // Calculate messages storage (content + images)
    const messageRows = await db
      .select({
        content: messages.content,
        images: messages.images,
      })
      .from(messages)
      .innerJoin(
        sql`chat_sessions`,
        sql`${messages.chatSessionId} = chat_sessions.id AND chat_sessions.user_id = ${userId}`
      );

    let messagesSize = BigInt(0);
    let imagesSize = BigInt(0);

    for (const row of messageRows) {
      messagesSize += BigInt(calculateStringSize(row.content));

      if (row.images && Array.isArray(row.images)) {
        for (const img of row.images) {
          if (img.data) {
            imagesSize += BigInt(calculateBase64Size(img.data));
          }
        }
      }
    }

    // Calculate events storage
    const eventRows = await db
      .select({
        eventData: events.eventData,
      })
      .from(events)
      .innerJoin(
        sql`chat_sessions`,
        sql`${events.chatSessionId} = chat_sessions.id AND chat_sessions.user_id = ${userId}`
      );

    let eventsSize = BigInt(0);
    for (const row of eventRows) {
      eventsSize += BigInt(calculateJsonSize(row.eventData));
    }

    // Calculate live chat messages storage
    const liveChatRows = await db
      .select({
        content: liveChatMessages.content,
        images: liveChatMessages.images,
        toolCalls: liveChatMessages.toolCalls,
      })
      .from(liveChatMessages)
      .where(eq(liveChatMessages.userId, userId));

    let liveChatSize = BigInt(0);
    for (const row of liveChatRows) {
      liveChatSize += BigInt(calculateStringSize(row.content));
      liveChatSize += BigInt(calculateJsonSize(row.toolCalls));

      if (row.images && Array.isArray(row.images)) {
        for (const img of row.images) {
          if (img.data) {
            imagesSize += BigInt(calculateBase64Size(img.data));
          }
        }
      }
    }

    // Calculate workspace events storage
    const workspaceRows = await db
      .select({
        payload: workspaceEvents.payload,
      })
      .from(workspaceEvents)
      .where(eq(workspaceEvents.userId, userId));

    let workspaceEventsSize = BigInt(0);
    for (const row of workspaceRows) {
      workspaceEventsSize += BigInt(calculateJsonSize(row.payload));
    }

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
   */
  static async checkQuota(userId: string, additionalBytes: number): Promise<StorageQuotaCheck> {
    const stats = await this.getStorageStats(userId);
    const requestedBytes = BigInt(additionalBytes);

    return {
      allowed: stats.availableBytes >= requestedBytes,
      usedBytes: stats.usedBytes,
      quotaBytes: stats.quotaBytes,
      availableBytes: stats.availableBytes,
      requestedBytes,
    };
  }

  /**
   * Add storage usage for a user
   */
  static async addUsage(userId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;

    const [user] = await db
      .select({
        storageUsedBytes: users.storageUsedBytes,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const currentUsed = BigInt(user.storageUsedBytes);
    const newUsed = currentUsed + BigInt(bytes);

    await db
      .update(users)
      .set({ storageUsedBytes: newUsed.toString() })
      .where(eq(users.id, userId));
  }

  /**
   * Remove storage usage for a user (when data is deleted)
   */
  static async removeUsage(userId: string, bytes: number): Promise<void> {
    if (bytes <= 0) return;

    const [user] = await db
      .select({
        storageUsedBytes: users.storageUsedBytes,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const currentUsed = BigInt(user.storageUsedBytes);
    const bytesToRemove = BigInt(bytes);
    const newUsed = currentUsed > bytesToRemove ? currentUsed - bytesToRemove : BigInt(0);

    await db
      .update(users)
      .set({ storageUsedBytes: newUsed.toString() })
      .where(eq(users.id, userId));
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
    await db
      .update(users)
      .set({ storageQuotaBytes: quotaBytes.toString() })
      .where(eq(users.id, userId));
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
