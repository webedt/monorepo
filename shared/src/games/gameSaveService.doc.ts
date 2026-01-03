/**
 * Game Save Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Game Save Service.
 * The service manages cloud save synchronization, conflict resolution, and
 * save slot management for games on the platform.
 *
 * @see AGameSaveService for the abstract base class
 * @see GameSaveService for the implementation
 */

import type { CloudSave } from './types.js';
import type { CloudSaveQuota } from './types.js';
import type { CreateCloudSaveRequest } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { ResolveConflictRequest } from './types.js';
import type { SaveSlotType } from './types.js';
import type { SaveSyncStatus } from './types.js';

export type { CloudSave } from './types.js';
export type { CloudSaveQuota } from './types.js';
export type { CreateCloudSaveRequest } from './types.js';
export type { GamePlatformEventCallback } from './types.js';
export type { ResolveConflictRequest } from './types.js';
export type { SaveSlotType } from './types.js';
export type { SaveSyncStatus } from './types.js';

/**
 * Interface for Game Save Service with full documentation.
 *
 * The Game Save Service provides cloud save synchronization for games.
 * It handles save file upload/download, conflict detection and resolution,
 * quota management, and real-time sync status notifications.
 *
 * ## Features
 *
 * - **Cloud Sync**: Upload and download save files to cloud storage
 * - **Slot Management**: Multiple save slots per game
 * - **Conflict Detection**: Detect and resolve local/cloud conflicts
 * - **Quota Enforcement**: Per-user storage limits for saves
 * - **Real-time Events**: Subscribe to sync status updates
 *
 * ## Save Slot Types
 *
 * | Type | Description |
 * |------|-------------|
 * | manual | Player-initiated save |
 * | auto | Automatic checkpoint save |
 * | quick | Quick save slot |
 *
 * ## Sync Status Flow
 *
 * ```
 * pending -> uploading -> synced
 *                     \-> upload_failed
 *
 * pending -> downloading -> synced
 *                       \-> download_failed
 *
 * synced -> conflict -> (user resolution) -> synced
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * // Create a new save
 * const save = await gameSaveService.createSave({
 *   userId: 'user-123',
 *   gameId: 'game-456',
 *   slotNumber: 1,
 *   slotType: 'manual',
 *   localPath: '/saves/slot1.sav',
 *   sizeBytes: 1024000,
 *   checksum: 'sha256:abc123...',
 * });
 *
 * // Start upload
 * await gameSaveService.startUpload(save.id);
 *
 * // Complete after S3 upload
 * await gameSaveService.completeUpload(save.id, 's3://bucket/saves/...');
 * ```
 */
export interface IGameSaveServiceDocumentation {
  /**
   * Create a new cloud save record.
   *
   * Creates a pending save that can then be uploaded to cloud storage.
   *
   * @param request - Save creation parameters
   * @param request.userId - The player's user ID
   * @param request.gameId - The game ID
   * @param request.slotNumber - Save slot number (1-10 typically)
   * @param request.slotType - Type of save (manual, auto, quick)
   * @param request.localPath - Local file path on player's machine
   * @param request.sizeBytes - File size in bytes
   * @param request.checksum - File checksum for integrity
   * @returns Created save record
   *
   * @example
   * ```typescript
   * const save = await gameSaveService.createSave({
   *   userId: 'user-123',
   *   gameId: 'game-456',
   *   slotNumber: 1,
   *   slotType: 'manual',
   *   localPath: 'C:/Games/MyGame/saves/slot1.sav',
   *   sizeBytes: 2048576,
   *   checksum: 'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
   * });
   * ```
   */
  createSave(request: CreateCloudSaveRequest): Promise<CloudSave>;

  /**
   * Get a save by ID.
   *
   * @param saveId - The save record ID
   * @returns Save if found, null otherwise
   *
   * @example
   * ```typescript
   * const save = await gameSaveService.getSave('save-123');
   * if (save?.status === 'synced') {
   *   console.log(`Save ready: ${save.cloudUrl}`);
   * }
   * ```
   */
  getSave(saveId: string): Promise<CloudSave | null>;

  /**
   * Get all saves for a player's game.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @returns All saves for the game
   *
   * @example
   * ```typescript
   * const saves = await gameSaveService.getUserGameSaves(userId, gameId);
   * for (const save of saves) {
   *   console.log(`Slot ${save.slotNumber}: ${save.status}`);
   * }
   * ```
   */
  getUserGameSaves(userId: string, gameId: string): Promise<CloudSave[]>;

  /**
   * Get save for a specific slot.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @param slotNumber - The slot number
   * @returns Save in the slot, or null if empty
   *
   * @example
   * ```typescript
   * const save = await gameSaveService.getUserGameSavesBySlot(userId, gameId, 1);
   * if (!save) {
   *   console.log('Slot 1 is empty');
   * }
   * ```
   */
  getUserGameSavesBySlot(
    userId: string,
    gameId: string,
    slotNumber: number
  ): Promise<CloudSave | null>;

  /**
   * Get saves by slot type.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @param slotType - The type of save to filter
   * @returns Saves matching the type
   *
   * @example
   * ```typescript
   * // Get all autosaves
   * const autosaves = await gameSaveService.getUserSavesByType(userId, gameId, 'auto');
   * const latest = autosaves[0]; // Most recent autosave
   * ```
   */
  getUserSavesByType(
    userId: string,
    gameId: string,
    slotType: SaveSlotType
  ): Promise<CloudSave[]>;

  /**
   * List all saves across all games for a player.
   *
   * @param userId - The player's user ID
   * @returns All saves for the player
   *
   * @example
   * ```typescript
   * const allSaves = await gameSaveService.listAllUserSaves(userId);
   * const totalSize = allSaves.reduce((sum, s) => sum + s.sizeBytes, 0);
   * console.log(`Total save storage: ${formatBytes(totalSize)}`);
   * ```
   */
  listAllUserSaves(userId: string): Promise<CloudSave[]>;

  /**
   * Update a save record.
   *
   * @param saveId - The save ID to update
   * @param updates - Partial updates to apply
   * @returns Updated save record
   *
   * @example
   * ```typescript
   * const updated = await gameSaveService.updateSave(saveId, {
   *   localPath: 'C:/Games/MyGame/saves/renamed_slot1.sav',
   * });
   * ```
   */
  updateSave(
    saveId: string,
    updates: Partial<CreateCloudSaveRequest>
  ): Promise<CloudSave>;

  /**
   * Delete a save record.
   *
   * Also removes the file from cloud storage.
   *
   * @param saveId - The save ID to delete
   *
   * @example
   * ```typescript
   * await gameSaveService.deleteSave('save-123');
   * ```
   */
  deleteSave(saveId: string): Promise<void>;

  /**
   * Delete all saves for a game.
   *
   * Use with caution - removes all cloud saves for the game.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   *
   * @example
   * ```typescript
   * // When uninstalling a game
   * await gameSaveService.deleteGameSaves(userId, gameId);
   * ```
   */
  deleteGameSaves(userId: string, gameId: string): Promise<void>;

  /**
   * Mark a save as uploading.
   *
   * Call before starting the actual file upload.
   *
   * @param saveId - The save ID
   * @returns Updated save with 'uploading' status
   *
   * @example
   * ```typescript
   * const save = await gameSaveService.startUpload('save-123');
   * // Now upload to S3...
   * ```
   */
  startUpload(saveId: string): Promise<CloudSave>;

  /**
   * Mark upload as complete.
   *
   * @param saveId - The save ID
   * @param cloudUrl - URL where the save is stored
   * @returns Updated save with 'synced' status
   *
   * @example
   * ```typescript
   * const save = await gameSaveService.completeUpload(
   *   'save-123',
   *   's3://game-saves/user-123/game-456/slot1.sav'
   * );
   * ```
   */
  completeUpload(saveId: string, cloudUrl: string): Promise<CloudSave>;

  /**
   * Mark upload as failed.
   *
   * @param saveId - The save ID
   * @param errorMessage - Description of the failure
   * @returns Updated save with 'upload_failed' status
   *
   * @example
   * ```typescript
   * try {
   *   await uploadToS3(saveData);
   *   await gameSaveService.completeUpload(saveId, cloudUrl);
   * } catch (error) {
   *   await gameSaveService.failUpload(saveId, error.message);
   * }
   * ```
   */
  failUpload(saveId: string, errorMessage: string): Promise<CloudSave>;

  /**
   * Mark a save as downloading.
   *
   * @param saveId - The save ID
   * @returns Updated save with 'downloading' status
   *
   * @example
   * ```typescript
   * await gameSaveService.startDownload('save-123');
   * // Download from cloud...
   * ```
   */
  startDownload(saveId: string): Promise<CloudSave>;

  /**
   * Mark download as complete.
   *
   * @param saveId - The save ID
   * @param localPath - Local path where file was saved
   * @returns Updated save with 'synced' status
   *
   * @example
   * ```typescript
   * await gameSaveService.completeDownload(
   *   'save-123',
   *   'C:/Games/MyGame/saves/slot1.sav'
   * );
   * ```
   */
  completeDownload(saveId: string, localPath: string): Promise<CloudSave>;

  /**
   * Mark download as failed.
   *
   * @param saveId - The save ID
   * @param errorMessage - Description of the failure
   * @returns Updated save with 'download_failed' status
   */
  failDownload(saveId: string, errorMessage: string): Promise<CloudSave>;

  /**
   * Mark a save as having a conflict.
   *
   * Called when local and cloud versions differ and auto-resolution
   * is not possible.
   *
   * @param saveId - The save ID
   * @param localChecksum - Checksum of local file
   * @param localSizeBytes - Size of local file
   * @param localModifiedAt - Last modified time of local file
   * @returns Updated save with 'conflict' status
   *
   * @example
   * ```typescript
   * // During sync, detected different versions
   * await gameSaveService.markConflict(
   *   'save-123',
   *   'sha256:local...',
   *   2048576,
   *   new Date('2024-01-15T10:30:00Z')
   * );
   * ```
   */
  markConflict(
    saveId: string,
    localChecksum: string,
    localSizeBytes: number,
    localModifiedAt: Date
  ): Promise<CloudSave>;

  /**
   * Resolve a save conflict.
   *
   * @param request - Resolution parameters
   * @param request.saveId - The conflicted save ID
   * @param request.resolution - 'use_local' or 'use_cloud'
   * @returns Resolved save
   *
   * @example
   * ```typescript
   * // User chose to keep local version
   * await gameSaveService.resolveConflict({
   *   saveId: 'save-123',
   *   resolution: 'use_local',
   * });
   *
   * // Re-upload the local version
   * await gameSaveService.syncSave('save-123');
   * ```
   */
  resolveConflict(request: ResolveConflictRequest): Promise<CloudSave>;

  /**
   * Get all saves with unresolved conflicts.
   *
   * @param userId - The player's user ID
   * @returns Saves in 'conflict' status
   *
   * @example
   * ```typescript
   * const conflicts = await gameSaveService.getSavesWithConflicts(userId);
   * if (conflicts.length > 0) {
   *   showConflictResolutionDialog(conflicts);
   * }
   * ```
   */
  getSavesWithConflicts(userId: string): Promise<CloudSave[]>;

  /**
   * Get saves by sync status.
   *
   * @param userId - The player's user ID
   * @param status - The status to filter by
   * @returns Saves with the specified status
   *
   * @example
   * ```typescript
   * // Find failed uploads to retry
   * const failed = await gameSaveService.getSavesByStatus(userId, 'upload_failed');
   * for (const save of failed) {
   *   await retrySaveUpload(save);
   * }
   * ```
   */
  getSavesByStatus(userId: string, status: SaveSyncStatus): Promise<CloudSave[]>;

  /**
   * Get user's cloud save quota.
   *
   * @param userId - The player's user ID
   * @returns Quota information
   *
   * @example
   * ```typescript
   * const quota = await gameSaveService.getUserQuota(userId);
   * console.log(`${quota.usedBytes}/${quota.totalBytes} bytes used`);
   * ```
   */
  getUserQuota(userId: string): Promise<CloudSaveQuota>;

  /**
   * Get current quota usage.
   *
   * @param userId - The player's user ID
   * @returns Usage statistics
   *
   * @example
   * ```typescript
   * const usage = await gameSaveService.getQuotaUsage(userId);
   * console.log(`${usage.saveCount} saves using ${formatBytes(usage.usedBytes)}`);
   * ```
   */
  getQuotaUsage(userId: string): Promise<{ usedBytes: number; saveCount: number }>;

  /**
   * Sync a single save to cloud.
   *
   * Handles upload if local is newer, download if cloud is newer.
   *
   * @param saveId - The save ID to sync
   * @returns Updated save after sync
   *
   * @example
   * ```typescript
   * const save = await gameSaveService.syncSave('save-123');
   * console.log(`Sync complete: ${save.status}`);
   * ```
   */
  syncSave(saveId: string): Promise<CloudSave>;

  /**
   * Sync all saves for a game.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @returns All saves after sync
   *
   * @example
   * ```typescript
   * // On game launch
   * const saves = await gameSaveService.syncGameSaves(userId, gameId);
   * const hasConflicts = saves.some(s => s.status === 'conflict');
   * if (hasConflicts) {
   *   showConflictDialog();
   * }
   * ```
   */
  syncGameSaves(userId: string, gameId: string): Promise<CloudSave[]>;

  /**
   * Subscribe to save sync events.
   *
   * @param userId - The player's user ID
   * @param callback - Function called on each event
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = gameSaveService.subscribeToEvents(userId, (event) => {
   *   switch (event.type) {
   *     case 'upload_complete':
   *       showNotification('Save uploaded to cloud');
   *       break;
   *     case 'conflict_detected':
   *       showConflictDialog(event.save);
   *       break;
   *   }
   * });
   * ```
   */
  subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void;
}
