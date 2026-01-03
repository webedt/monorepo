/**
 * Storage Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Storage Service.
 * The Storage Service manages per-user storage quotas, tracks usage across
 * different data types, and enforces storage limits.
 *
 * @see StorageService for the implementation class
 */

/**
 * Storage tier definitions with quota limits
 */
export const STORAGE_TIERS = {
  FREE: 1 * 1024 * 1024 * 1024,        // 1 GB
  BASIC: 5 * 1024 * 1024 * 1024,       // 5 GB (default)
  PRO: 25 * 1024 * 1024 * 1024,        // 25 GB
  ENTERPRISE: 100 * 1024 * 1024 * 1024, // 100 GB
} as const;

export type StorageTier = keyof typeof STORAGE_TIERS;

/**
 * Complete storage statistics for a user
 */
export interface StorageStats {
  /** Total bytes currently used */
  usedBytes: bigint;
  /** Total quota in bytes */
  quotaBytes: bigint;
  /** Remaining available bytes */
  availableBytes: bigint;
  /** Usage as percentage (0-100) */
  usagePercent: number;
  /** Breakdown by data type */
  breakdown: StorageBreakdown;
}

/**
 * Storage usage breakdown by category
 */
export interface StorageBreakdown {
  /** Chat message content size */
  messages: bigint;
  /** Session event data size */
  events: bigint;
  /** Live chat message content size */
  liveChatMessages: bigint;
  /** Workspace event payload size */
  workspaceEvents: bigint;
  /** Image attachment size */
  images: bigint;
  /** Total of all categories */
  total: bigint;
}

/**
 * Result of a quota check operation
 */
export interface StorageQuotaCheck {
  /** Whether the requested storage is allowed */
  allowed: boolean;
  /** Current bytes used */
  usedBytes: bigint;
  /** Total quota in bytes */
  quotaBytes: bigint;
  /** Remaining available bytes */
  availableBytes: bigint;
  /** Bytes requested for this operation */
  requestedBytes: bigint;
}

/**
 * Interface for Storage Service with full documentation.
 *
 * The Storage Service provides centralized management of user storage quotas.
 * It tracks storage usage across messages, events, images, and other data types,
 * enforcing per-user limits based on their subscription tier.
 *
 * ## Features
 *
 * - **Tiered Quotas**: FREE (1GB), BASIC (5GB), PRO (25GB), ENTERPRISE (100GB)
 * - **Usage Tracking**: Atomic increment/decrement with race condition prevention
 * - **Detailed Breakdown**: Storage usage by category (messages, events, images)
 * - **Quota Enforcement**: Check before write to prevent quota exceeded errors
 * - **Admin Operations**: Set custom quotas or tiers per user
 *
 * ## Storage Breakdown Categories
 *
 * | Category | Description |
 * |----------|-------------|
 * | messages | Chat message text content |
 * | events | Session event JSON payloads |
 * | liveChatMessages | Live chat content and tool calls |
 * | workspaceEvents | Workspace file operation payloads |
 * | images | Base64-encoded image attachments |
 *
 * ## Usage Patterns
 *
 * ### Before Writing Data
 * ```typescript
 * // Check quota before creating message
 * const messageSize = calculateStringSize(content) + calculateJsonSize(images);
 * const check = await StorageService.checkQuota(userId, messageSize);
 *
 * if (!check.allowed) {
 *   throw new Error(`Storage quota exceeded. Used: ${StorageService.formatBytes(check.usedBytes)} / ${StorageService.formatBytes(check.quotaBytes)}`);
 * }
 *
 * // Create message
 * await createMessage(content, images);
 *
 * // Update usage
 * await StorageService.addUsage(userId, messageSize);
 * ```
 *
 * ### After Deleting Data
 * ```typescript
 * // Calculate size being freed
 * const freedBytes = calculateStringSize(message.content);
 *
 * // Delete message
 * await deleteMessage(messageId);
 *
 * // Decrement usage
 * await StorageService.removeUsage(userId, freedBytes);
 * ```
 *
 * ## Performance Considerations
 *
 * - `checkQuota()` uses cached values - O(1) database read
 * - `getStorageStats()` and `getStorageBreakdown()` run aggregate queries - expensive
 * - `addUsage()` and `removeUsage()` use atomic SQL - safe for concurrent requests
 */
export interface IStorageServiceDocumentation {
  /**
   * Check if a user exists in the database.
   *
   * @param userId - The user ID to check
   * @returns True if user exists
   *
   * @example
   * ```typescript
   * if (await StorageService.userExists(userId)) {
   *   const stats = await StorageService.getStorageStats(userId);
   * }
   * ```
   */
  userExists(userId: string): Promise<boolean>;

  /**
   * Get complete storage statistics for a user.
   *
   * Returns usage stats including a full breakdown by category.
   * This is an expensive operation that runs aggregate queries.
   * Use `checkQuota()` for simple quota checks.
   *
   * @param userId - The user ID to get stats for
   * @returns Complete storage statistics with breakdown
   * @throws Error if user not found
   *
   * @example
   * ```typescript
   * const stats = await StorageService.getStorageStats(userId);
   *
   * console.log(`Usage: ${stats.usagePercent.toFixed(1)}%`);
   * console.log(`Used: ${StorageService.formatBytes(stats.usedBytes)}`);
   * console.log(`Available: ${StorageService.formatBytes(stats.availableBytes)}`);
   *
   * // Show breakdown
   * console.log('Breakdown:');
   * console.log(`  Messages: ${StorageService.formatBytes(stats.breakdown.messages)}`);
   * console.log(`  Events: ${StorageService.formatBytes(stats.breakdown.events)}`);
   * console.log(`  Images: ${StorageService.formatBytes(stats.breakdown.images)}`);
   * ```
   *
   * @example
   * ```typescript
   * // Display storage in settings page
   * const stats = await StorageService.getStorageStats(userId);
   *
   * res.json({
   *   used: StorageService.formatBytes(stats.usedBytes),
   *   quota: StorageService.formatBytes(stats.quotaBytes),
   *   available: StorageService.formatBytes(stats.availableBytes),
   *   usagePercent: stats.usagePercent,
   *   breakdown: {
   *     messages: StorageService.formatBytes(stats.breakdown.messages),
   *     events: StorageService.formatBytes(stats.breakdown.events),
   *     images: StorageService.formatBytes(stats.breakdown.images),
   *   },
   * });
   * ```
   */
  getStorageStats(userId: string): Promise<StorageStats>;

  /**
   * Get detailed storage breakdown by category.
   *
   * Runs aggregate SQL queries to calculate exact storage usage
   * per category. This is an expensive operation - cache results
   * or use sparingly.
   *
   * @param userId - The user ID to get breakdown for
   * @returns Storage breakdown by category
   *
   * @example
   * ```typescript
   * const breakdown = await StorageService.getStorageBreakdown(userId);
   *
   * // Find largest category
   * const categories = [
   *   { name: 'Messages', bytes: breakdown.messages },
   *   { name: 'Events', bytes: breakdown.events },
   *   { name: 'Images', bytes: breakdown.images },
   * ];
   *
   * categories.sort((a, b) => Number(b.bytes - a.bytes));
   * console.log(`Largest category: ${categories[0].name}`);
   * ```
   */
  getStorageBreakdown(userId: string): Promise<StorageBreakdown>;

  /**
   * Check if a user has enough quota for additional storage.
   *
   * Uses cached `storageUsedBytes` from the user record for fast
   * quota checks. Does NOT run expensive breakdown queries.
   *
   * @param userId - The user ID to check
   * @param additionalBytes - Number of bytes to be added
   * @returns Quota check result with allowed flag
   * @throws Error if user not found
   *
   * @example
   * ```typescript
   * // Check before uploading image
   * const imageSize = calculateBase64Size(base64Data);
   * const check = await StorageService.checkQuota(userId, imageSize);
   *
   * if (!check.allowed) {
   *   return res.status(413).json({
   *     error: 'Storage quota exceeded',
   *     used: StorageService.formatBytes(check.usedBytes),
   *     quota: StorageService.formatBytes(check.quotaBytes),
   *     required: StorageService.formatBytes(check.requestedBytes),
   *   });
   * }
   *
   * // Proceed with upload
   * await uploadImage(base64Data);
   * await StorageService.addUsage(userId, imageSize);
   * ```
   *
   * @example
   * ```typescript
   * // Batch check for multiple items
   * const totalSize = items.reduce((sum, item) =>
   *   sum + calculateJsonSize(item), 0
   * );
   *
   * const check = await StorageService.checkQuota(userId, totalSize);
   * if (!check.allowed) {
   *   throw new QuotaExceededError(check);
   * }
   * ```
   */
  checkQuota(userId: string, additionalBytes: number): Promise<StorageQuotaCheck>;

  /**
   * Add storage usage for a user.
   *
   * Uses atomic SQL UPDATE to prevent race conditions from
   * concurrent requests. Call this after successfully storing data.
   *
   * @param userId - The user ID to update
   * @param bytes - Number of bytes to add (must be positive)
   * @throws Error if user not found
   *
   * @example
   * ```typescript
   * // After creating a message
   * const messageSize = calculateStringSize(content);
   * await createMessage({ userId, content });
   * await StorageService.addUsage(userId, messageSize);
   * ```
   *
   * @example
   * ```typescript
   * // Transaction-safe usage tracking
   * await db.transaction(async (tx) => {
   *   await tx.insert(messages).values({ userId, content });
   *
   *   // If insert fails, usage won't be updated
   *   await StorageService.addUsage(userId, calculateStringSize(content));
   * });
   * ```
   */
  addUsage(userId: string, bytes: number): Promise<void>;

  /**
   * Remove storage usage for a user.
   *
   * Uses atomic SQL UPDATE with GREATEST to prevent negative values.
   * Call this after deleting data.
   *
   * @param userId - The user ID to update
   * @param bytes - Number of bytes to remove (must be positive)
   * @throws Error if user not found
   *
   * @example
   * ```typescript
   * // After deleting a message
   * const message = await getMessage(messageId);
   * const freedBytes = calculateStringSize(message.content);
   *
   * await deleteMessage(messageId);
   * await StorageService.removeUsage(userId, freedBytes);
   * ```
   *
   * @example
   * ```typescript
   * // Bulk delete with usage tracking
   * const messages = await getMessagesForSession(sessionId);
   * const totalSize = messages.reduce((sum, m) =>
   *   sum + calculateStringSize(m.content), 0
   * );
   *
   * await deleteMessagesForSession(sessionId);
   * await StorageService.removeUsage(userId, totalSize);
   * ```
   */
  removeUsage(userId: string, bytes: number): Promise<void>;

  /**
   * Recalculate storage usage from actual data.
   *
   * Runs aggregate queries to calculate true storage usage and
   * updates the cached value. Use this periodically or when
   * discrepancies are detected.
   *
   * @param userId - The user ID to recalculate
   * @returns The recalculated total usage in bytes
   *
   * @example
   * ```typescript
   * // Periodic recalculation job
   * async function recalculateAllUsage() {
   *   const users = await getAllUsers();
   *
   *   for (const user of users) {
   *     const actual = await StorageService.recalculateUsage(user.id);
   *     console.log(`User ${user.id}: ${StorageService.formatBytes(actual)}`);
   *   }
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Fix discrepancy
   * const stats = await StorageService.getStorageStats(userId);
   * if (stats.usedBytes !== stats.breakdown.total) {
   *   console.log('Discrepancy detected, recalculating...');
   *   await StorageService.recalculateUsage(userId);
   * }
   * ```
   */
  recalculateUsage(userId: string): Promise<bigint>;

  /**
   * Set a custom storage quota for a user.
   *
   * Admin operation to set a specific quota in bytes.
   * Use `setTier()` for standard tier-based quotas.
   *
   * @param userId - The user ID to update
   * @param quotaBytes - New quota in bytes
   * @throws Error if user not found
   *
   * @example
   * ```typescript
   * // Set 50GB custom quota
   * await StorageService.setQuota(userId, BigInt(50 * 1024 * 1024 * 1024));
   * ```
   *
   * @example
   * ```typescript
   * // Double current quota
   * const stats = await StorageService.getStorageStats(userId);
   * await StorageService.setQuota(userId, stats.quotaBytes * BigInt(2));
   * ```
   */
  setQuota(userId: string, quotaBytes: bigint): Promise<void>;

  /**
   * Set storage quota based on subscription tier.
   *
   * Updates the user's quota to match the predefined tier limit.
   * Use this when upgrading/downgrading subscriptions.
   *
   * @param userId - The user ID to update
   * @param tier - The storage tier (FREE, BASIC, PRO, ENTERPRISE)
   *
   * @example
   * ```typescript
   * // Upgrade user to PRO tier
   * await StorageService.setTier(userId, 'PRO');
   *
   * const stats = await StorageService.getStorageStats(userId);
   * console.log(`New quota: ${StorageService.formatBytes(stats.quotaBytes)}`);
   * // Output: "New quota: 25.00 GB"
   * ```
   *
   * @example
   * ```typescript
   * // Subscription webhook handler
   * async function handleSubscriptionChange(userId: string, plan: string) {
   *   const tierMap = {
   *     'free': 'FREE',
   *     'basic': 'BASIC',
   *     'pro': 'PRO',
   *     'enterprise': 'ENTERPRISE',
   *   };
   *
   *   const tier = tierMap[plan] as StorageTier;
   *   await StorageService.setTier(userId, tier);
   * }
   * ```
   */
  setTier(userId: string, tier: StorageTier): Promise<void>;

  /**
   * Format bytes as human-readable string.
   *
   * Converts byte values to appropriate units (B, KB, MB, GB, TB)
   * with two decimal places for non-byte units.
   *
   * @param bytes - Number of bytes (bigint or number)
   * @returns Formatted string (e.g., "1.50 GB")
   *
   * @example
   * ```typescript
   * StorageService.formatBytes(1024);        // "1.00 KB"
   * StorageService.formatBytes(1536);        // "1.50 KB"
   * StorageService.formatBytes(1073741824);  // "1.00 GB"
   * StorageService.formatBytes(BigInt(5368709120)); // "5.00 GB"
   * ```
   *
   * @example
   * ```typescript
   * // Display in API response
   * const stats = await StorageService.getStorageStats(userId);
   *
   * res.json({
   *   usage: `${StorageService.formatBytes(stats.usedBytes)} / ${StorageService.formatBytes(stats.quotaBytes)}`,
   * });
   * // Output: { usage: "2.34 GB / 5.00 GB" }
   * ```
   */
  formatBytes(bytes: bigint | number): string;
}

/**
 * Utility function: Calculate byte size of base64-encoded data.
 *
 * Computes the original byte size from a base64 string, accounting
 * for data URL prefixes and padding characters.
 *
 * @param base64String - Base64-encoded string (may include data URL prefix)
 * @returns Size in bytes of the original data
 *
 * @example
 * ```typescript
 * // Plain base64
 * calculateBase64Size('SGVsbG8gV29ybGQ='); // 11
 *
 * // With data URL prefix
 * calculateBase64Size('data:image/png;base64,iVBORw0KGgo...'); // Image size
 * ```
 */
export function calculateBase64Size(base64String: string): number;

/**
 * Utility function: Calculate byte size of JSON when serialized.
 *
 * @param data - Any JSON-serializable value
 * @returns UTF-8 byte size of the serialized JSON
 *
 * @example
 * ```typescript
 * calculateJsonSize({ name: 'test' }); // 15
 * calculateJsonSize([1, 2, 3]);        // 7
 * calculateJsonSize(null);             // 0
 * ```
 */
export function calculateJsonSize(data: unknown): number;

/**
 * Utility function: Calculate UTF-8 byte size of a string.
 *
 * @param str - Input string (may be null/undefined)
 * @returns UTF-8 byte size (0 for null/undefined)
 *
 * @example
 * ```typescript
 * calculateStringSize('Hello');   // 5
 * calculateStringSize('');       // 6 (2 bytes per character)
 * calculateStringSize(null);      // 0
 * ```
 */
export function calculateStringSize(str: string | null | undefined): number;
