/**
 * Trash Cleanup Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Trash Cleanup Service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see ATrashCleanupService for the abstract base class
 * @see TrashCleanupService for the concrete implementation
 */

import type { TrashCleanupResult } from './ATrashCleanupService.js';
import type { TrashCleanupSession } from './ATrashCleanupService.js';

export type { TrashCleanupResult } from './ATrashCleanupService.js';
export type { TrashCleanupSession } from './ATrashCleanupService.js';

/**
 * Interface for Trash Cleanup Service with full documentation.
 *
 * Provides methods for managing the soft-delete lifecycle of sessions.
 * Sessions moved to trash are retained for a configurable period before
 * permanent deletion, allowing users to recover accidentally deleted sessions.
 *
 * ## Soft Delete Workflow
 *
 * 1. User deletes session → Session marked with `deletedAt` timestamp
 * 2. Session appears in "Trash" for recovery (optional UI feature)
 * 3. After retention period expires → `cleanupExpiredTrash` permanently deletes
 * 4. Associated data (events, messages) is cascade-deleted
 *
 * ## Scheduled Cleanup
 *
 * The service supports scheduled background cleanup:
 * - `startScheduledCleanup()` - Start periodic cleanup job
 * - `stopScheduledCleanup()` - Stop the cleanup job
 *
 * Typical deployment runs cleanup daily or hourly to prevent trash accumulation.
 *
 * ## Usage
 *
 * ```typescript
 * const trashService = serviceProvider.get(ATrashCleanupService);
 *
 * // Start scheduled cleanup (e.g., in server startup)
 * trashService.startScheduledCleanup();
 *
 * // Manual cleanup for testing or maintenance
 * const result = await trashService.cleanupExpiredTrash(30); // 30-day retention
 * console.log(`Deleted ${result.sessionsDeleted} sessions`);
 *
 * // Stop on server shutdown
 * trashService.stopScheduledCleanup();
 * ```
 */
export interface ITrashCleanupServiceDocumentation {
  /**
   * Clean up all sessions that have exceeded the retention period.
   *
   * Finds all sessions in trash older than the specified retention period
   * and permanently deletes them along with their associated data.
   *
   * This operation:
   * 1. Queries for sessions where `deletedAt` is older than retention period
   * 2. Deletes events and messages for each session
   * 3. Deletes the session records
   * 4. Returns summary of what was deleted
   *
   * @param retentionDays - Number of days to retain sessions in trash
   * @returns Result with counts of deleted records and any errors encountered
   *
   * @example
   * ```typescript
   * // Clean up sessions older than 30 days
   * const result = await trashService.cleanupExpiredTrash(30);
   *
   * console.log(`Deleted ${result.sessionsDeleted} sessions`);
   * console.log(`Deleted ${result.eventsDeleted} events`);
   * console.log(`Deleted ${result.messagesDeleted} messages`);
   *
   * if (result.errors.length > 0) {
   *   console.error('Cleanup errors:', result.errors);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Aggressive cleanup - 7 day retention
   * const result = await trashService.cleanupExpiredTrash(7);
   * ```
   */
  cleanupExpiredTrash(
    retentionDays: number
  ): Promise<TrashCleanupResult>;

  /**
   * Get sessions in trash that have exceeded the retention period.
   *
   * Returns a list of sessions that would be deleted by `cleanupExpiredTrash`.
   * Use this for preview/confirmation UIs or reporting.
   *
   * @param retentionDays - Number of days to check against
   * @returns Array of sessions that have exceeded retention period
   *
   * @example
   * ```typescript
   * // Preview what would be deleted
   * const expired = await trashService.getExpiredTrashSessions(30);
   *
   * console.log(`${expired.length} sessions would be permanently deleted:`);
   * for (const session of expired) {
   *   console.log(`- ${session.id} (deleted ${session.deletedAt})`);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Use for admin dashboard statistics
   * const expired30 = await trashService.getExpiredTrashSessions(30);
   * const expired7 = await trashService.getExpiredTrashSessions(7);
   *
   * console.log(`Sessions older than 30 days: ${expired30.length}`);
   * console.log(`Sessions older than 7 days: ${expired7.length}`);
   * ```
   */
  getExpiredTrashSessions(
    retentionDays: number
  ): Promise<TrashCleanupSession[]>;

  /**
   * Permanently delete a specific session from trash.
   *
   * Immediately and permanently deletes a session and all associated data.
   * This bypasses the retention period and cannot be undone.
   *
   * Use cases:
   * - User explicitly requests permanent deletion from trash
   * - Admin cleanup of specific sessions
   * - GDPR/data deletion requests
   *
   * @param sessionId - The session ID to permanently delete
   * @returns Result with success status and message
   * @throws Error if session doesn't exist or is not in trash
   *
   * @example
   * ```typescript
   * // User clicks "Delete permanently" in trash view
   * const result = await trashService.deleteSessionPermanently('session-123');
   *
   * if (result.success) {
   *   console.log('Session permanently deleted');
   * } else {
   *   console.error(`Failed: ${result.message}`);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Admin bulk permanent deletion
   * const sessionIds = ['sess-1', 'sess-2', 'sess-3'];
   *
   * for (const id of sessionIds) {
   *   const result = await trashService.deleteSessionPermanently(id);
   *   console.log(`${id}: ${result.success ? 'deleted' : result.message}`);
   * }
   * ```
   */
  deleteSessionPermanently(
    sessionId: string
  ): Promise<{ success: boolean; message: string }>;

  /**
   * Start scheduled trash cleanup.
   *
   * Initiates a background job that periodically runs `cleanupExpiredTrash`.
   * The cleanup interval and retention period are typically configured via
   * environment variables or service configuration.
   *
   * Call this during server startup to enable automatic cleanup.
   *
   * @example
   * ```typescript
   * // In server initialization
   * const trashService = serviceProvider.get(ATrashCleanupService);
   * trashService.startScheduledCleanup();
   *
   * console.log('Trash cleanup scheduled');
   * ```
   *
   * @example
   * ```typescript
   * // Conditional startup based on environment
   * if (process.env.ENABLE_TRASH_CLEANUP === 'true') {
   *   trashService.startScheduledCleanup();
   * }
   * ```
   */
  startScheduledCleanup(): void;

  /**
   * Stop scheduled trash cleanup.
   *
   * Cancels the background cleanup job started by `startScheduledCleanup`.
   * Call this during graceful shutdown to prevent cleanup running during
   * shutdown or migration.
   *
   * Safe to call even if cleanup was never started.
   *
   * @example
   * ```typescript
   * // In graceful shutdown handler
   * process.on('SIGTERM', async () => {
   *   console.log('Shutting down...');
   *
   *   trashService.stopScheduledCleanup();
   *
   *   await server.close();
   *   process.exit(0);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Pause cleanup for maintenance
   * trashService.stopScheduledCleanup();
   *
   * // ... perform maintenance ...
   *
   * trashService.startScheduledCleanup();
   * ```
   */
  stopScheduledCleanup(): void;
}
