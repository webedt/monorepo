/**
 * Cloud Saves Service - Game save synchronization across devices
 *
 * Provides cloud storage for game saves with:
 * - Multi-slot save management
 * - Version history for recovery
 * - Cross-device sync tracking
 * - Storage quota integration
 */

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

import { db, cloudSaves, cloudSaveVersions, cloudSaveSyncLog, games, eq, and, desc, sql, inArray, or } from '../db/index.js';
import { StorageService, calculateStringSize } from '../storage/StorageService.js';

import type { CloudSave, NewCloudSave, CloudSaveVersion, CloudSaveSyncLog } from '../db/index.js';

// Interface for local save info used in conflict checking
export interface LocalSaveInfo {
  gameId: string;
  slotNumber: number;
  checksum: string;
  updatedAt: Date;
}

// Maximum number of versions to keep per save
const MAX_VERSIONS_PER_SAVE = 5;

// Maximum save slots per game per user
const MAX_SLOTS_PER_GAME = 10;

export interface SaveUploadParams {
  userId: string;
  gameId: string;
  slotNumber: number;
  slotName?: string;
  saveData: string;
  platformData?: {
    deviceName?: string;
    platform?: string;
    gameVersion?: string;
    browserInfo?: string;
  };
  screenshotUrl?: string;
  playTimeSeconds?: number;
  gameProgress?: {
    level?: number;
    chapter?: string;
    percentage?: number;
    customData?: Record<string, unknown>;
  };
}

export interface SaveDownloadResult {
  save: CloudSave;
  game: { id: string; title: string } | null;
}

export interface CloudSaveWithGame extends CloudSave {
  game?: { id: string; title: string; coverImage: string | null };
}

export interface SyncConflict {
  localInfo: LocalSaveInfo;
  remoteSave: CloudSave;
  conflictType: 'newer_remote' | 'newer_local' | 'both_modified';
}

export interface CloudSaveStats {
  totalSaves: number;
  totalSize: bigint;
  gamesWithSaves: number;
  lastSyncAt: Date | null;
}

/**
 * Cloud Saves Service for managing game saves across devices
 */
export class CloudSavesService {
  /**
   * Calculate checksum for save data integrity verification
   */
  static calculateChecksum(data: string): string {
    return createHash('sha256').update(data).digest('hex');
  }

  /**
   * Upload or update a cloud save
   * Creates version history for existing saves
   */
  static async uploadSave(params: SaveUploadParams): Promise<CloudSave> {
    const {
      userId,
      gameId,
      slotNumber,
      slotName,
      saveData,
      platformData,
      screenshotUrl,
      playTimeSeconds,
      gameProgress,
    } = params;

    // Validate slot number
    if (slotNumber < 1 || slotNumber > MAX_SLOTS_PER_GAME) {
      throw new Error(`Slot number must be between 1 and ${MAX_SLOTS_PER_GAME}`);
    }

    // Calculate save size and checksum
    const fileSize = calculateStringSize(saveData);
    const checksum = this.calculateChecksum(saveData);

    // Check if save already exists
    const [existingSave] = await db
      .select()
      .from(cloudSaves)
      .where(
        and(
          eq(cloudSaves.userId, userId),
          eq(cloudSaves.gameId, gameId),
          eq(cloudSaves.slotNumber, slotNumber)
        )
      )
      .limit(1);

    // Calculate size difference for storage tracking
    const sizeDiff = existingSave ? fileSize - existingSave.fileSize : fileSize;

    // Check storage quota only if we're adding storage (new save or larger update)
    if (sizeDiff > 0) {
      const quotaCheck = await StorageService.checkQuota(userId, sizeDiff);
      if (!quotaCheck.allowed) {
        throw new Error(
          `Storage quota exceeded. Available: ${StorageService.formatBytes(quotaCheck.availableBytes)}, ` +
          `Requested: ${StorageService.formatBytes(BigInt(sizeDiff))}`
        );
      }
    }

    let save: CloudSave;

    if (existingSave) {
      // Create version history before updating
      await this.createVersion(existingSave);

      // Update existing save
      const [updatedSave] = await db
        .update(cloudSaves)
        .set({
          slotName: slotName ?? existingSave.slotName,
          saveData,
          fileSize,
          checksum,
          platformData: platformData ?? existingSave.platformData,
          screenshotUrl: screenshotUrl ?? existingSave.screenshotUrl,
          playTimeSeconds: playTimeSeconds ?? existingSave.playTimeSeconds,
          gameProgress: gameProgress ?? existingSave.gameProgress,
          lastPlayedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(cloudSaves.id, existingSave.id))
        .returning();

      save = updatedSave;

      // Update storage usage
      if (sizeDiff !== 0) {
        if (sizeDiff > 0) {
          await StorageService.addUsage(userId, sizeDiff);
        } else {
          await StorageService.removeUsage(userId, Math.abs(sizeDiff));
        }
      }
    } else {
      // Create new save
      const newSave: NewCloudSave = {
        id: randomUUID(),
        userId,
        gameId,
        slotNumber,
        slotName,
        saveData,
        fileSize,
        checksum,
        platformData,
        screenshotUrl,
        playTimeSeconds: playTimeSeconds ?? 0,
        gameProgress,
        lastPlayedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const [createdSave] = await db
        .insert(cloudSaves)
        .values(newSave)
        .returning();

      save = createdSave;

      // Track storage usage
      await StorageService.addUsage(userId, fileSize);
    }

    // Log sync operation
    await this.logSyncOperation(userId, save.id, 'upload', platformData, 'success', fileSize);

    return save;
  }

  /**
   * Create a version snapshot of an existing save
   */
  private static async createVersion(save: CloudSave): Promise<void> {
    // Get current version count
    const versionResult = await db
      .select({ maxVersion: sql<number>`COALESCE(MAX(version), 0)` })
      .from(cloudSaveVersions)
      .where(eq(cloudSaveVersions.cloudSaveId, save.id));

    const nextVersion = (versionResult[0]?.maxVersion ?? 0) + 1;

    // Insert new version
    await db.insert(cloudSaveVersions).values({
      id: randomUUID(),
      cloudSaveId: save.id,
      version: nextVersion,
      saveData: save.saveData,
      fileSize: save.fileSize,
      checksum: save.checksum,
      platformData: save.platformData,
      createdAt: new Date(),
    });

    // Prune old versions if exceeding limit
    await this.pruneVersions(save.id, save.userId);
  }

  /**
   * Remove old versions beyond the retention limit
   */
  private static async pruneVersions(cloudSaveId: string, userId: string): Promise<void> {
    // Get versions to delete (oldest beyond MAX_VERSIONS_PER_SAVE)
    const versionsToDelete = await db
      .select({ id: cloudSaveVersions.id, fileSize: cloudSaveVersions.fileSize })
      .from(cloudSaveVersions)
      .where(eq(cloudSaveVersions.cloudSaveId, cloudSaveId))
      .orderBy(desc(cloudSaveVersions.version))
      .offset(MAX_VERSIONS_PER_SAVE);

    if (versionsToDelete.length > 0) {
      // Calculate total bytes to free
      const freedBytes = versionsToDelete.reduce((sum, v) => sum + v.fileSize, 0);
      const versionIds = versionsToDelete.map((v) => v.id);

      // Batch delete all versions at once
      await db.delete(cloudSaveVersions).where(inArray(cloudSaveVersions.id, versionIds));

      // Update storage usage
      if (freedBytes > 0) {
        await StorageService.removeUsage(userId, freedBytes);
      }
    }
  }

  /**
   * Get a specific save by game and slot
   */
  static async getSave(
    userId: string,
    gameId: string,
    slotNumber: number
  ): Promise<SaveDownloadResult | null> {
    const result = await db
      .select({
        save: cloudSaves,
        game: {
          id: games.id,
          title: games.title,
        },
      })
      .from(cloudSaves)
      .leftJoin(games, eq(cloudSaves.gameId, games.id))
      .where(
        and(
          eq(cloudSaves.userId, userId),
          eq(cloudSaves.gameId, gameId),
          eq(cloudSaves.slotNumber, slotNumber)
        )
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    // Log download
    await this.logSyncOperation(userId, result[0].save.id, 'download', undefined, 'success', result[0].save.fileSize);

    return {
      save: result[0].save,
      game: result[0].game,
    };
  }

  /**
   * List all saves for a specific game
   */
  static async listSavesByGame(userId: string, gameId: string): Promise<CloudSave[]> {
    const saves = await db
      .select()
      .from(cloudSaves)
      .where(
        and(
          eq(cloudSaves.userId, userId),
          eq(cloudSaves.gameId, gameId)
        )
      )
      .orderBy(cloudSaves.slotNumber);

    return saves;
  }

  /**
   * List all saves for a user (across all games)
   */
  static async listAllSaves(userId: string): Promise<CloudSaveWithGame[]> {
    const results = await db
      .select({
        save: cloudSaves,
        game: {
          id: games.id,
          title: games.title,
          coverImage: games.coverImage,
        },
      })
      .from(cloudSaves)
      .leftJoin(games, eq(cloudSaves.gameId, games.id))
      .where(eq(cloudSaves.userId, userId))
      .orderBy(desc(cloudSaves.updatedAt));

    return results.map((r) => ({
      ...r.save,
      game: r.game ?? undefined,
    }));
  }

  /**
   * Get save versions for recovery
   */
  static async getSaveVersions(
    userId: string,
    cloudSaveId: string
  ): Promise<CloudSaveVersion[]> {
    // Verify ownership
    const [save] = await db
      .select()
      .from(cloudSaves)
      .where(
        and(
          eq(cloudSaves.id, cloudSaveId),
          eq(cloudSaves.userId, userId)
        )
      )
      .limit(1);

    if (!save) {
      throw new Error('Save not found or access denied');
    }

    const versions = await db
      .select()
      .from(cloudSaveVersions)
      .where(eq(cloudSaveVersions.cloudSaveId, cloudSaveId))
      .orderBy(desc(cloudSaveVersions.version));

    return versions;
  }

  /**
   * Get a specific version by ID with ownership verification
   */
  static async getVersionById(
    userId: string,
    cloudSaveId: string,
    versionId: string
  ): Promise<CloudSaveVersion | null> {
    // Verify ownership of the parent save
    const [save] = await db
      .select()
      .from(cloudSaves)
      .where(
        and(
          eq(cloudSaves.id, cloudSaveId),
          eq(cloudSaves.userId, userId)
        )
      )
      .limit(1);

    if (!save) {
      throw new Error('Save not found or access denied');
    }

    // Query the specific version directly
    const [version] = await db
      .select()
      .from(cloudSaveVersions)
      .where(
        and(
          eq(cloudSaveVersions.id, versionId),
          eq(cloudSaveVersions.cloudSaveId, cloudSaveId)
        )
      )
      .limit(1);

    return version ?? null;
  }

  /**
   * Restore a save from a previous version
   */
  static async restoreVersion(
    userId: string,
    cloudSaveId: string,
    versionId: string,
    platformData?: SaveUploadParams['platformData']
  ): Promise<CloudSave> {
    // Verify ownership
    const [save] = await db
      .select()
      .from(cloudSaves)
      .where(
        and(
          eq(cloudSaves.id, cloudSaveId),
          eq(cloudSaves.userId, userId)
        )
      )
      .limit(1);

    if (!save) {
      throw new Error('Save not found or access denied');
    }

    // Get the version to restore
    const [version] = await db
      .select()
      .from(cloudSaveVersions)
      .where(
        and(
          eq(cloudSaveVersions.id, versionId),
          eq(cloudSaveVersions.cloudSaveId, cloudSaveId)
        )
      )
      .limit(1);

    if (!version) {
      throw new Error('Version not found');
    }

    // Create version of current state before restoring
    await this.createVersion(save);

    // Calculate storage difference
    const sizeDiff = version.fileSize - save.fileSize;

    // Restore the version
    const [restoredSave] = await db
      .update(cloudSaves)
      .set({
        saveData: version.saveData,
        fileSize: version.fileSize,
        checksum: version.checksum,
        platformData: platformData ?? version.platformData,
        updatedAt: new Date(),
      })
      .where(eq(cloudSaves.id, cloudSaveId))
      .returning();

    // Update storage
    if (sizeDiff !== 0) {
      if (sizeDiff > 0) {
        await StorageService.addUsage(userId, sizeDiff);
      } else {
        await StorageService.removeUsage(userId, Math.abs(sizeDiff));
      }
    }

    return restoredSave;
  }

  /**
   * Delete a cloud save
   */
  static async deleteSave(
    userId: string,
    gameId: string,
    slotNumber: number,
    platformData?: SaveUploadParams['platformData']
  ): Promise<boolean> {
    const [save] = await db
      .select()
      .from(cloudSaves)
      .where(
        and(
          eq(cloudSaves.userId, userId),
          eq(cloudSaves.gameId, gameId),
          eq(cloudSaves.slotNumber, slotNumber)
        )
      )
      .limit(1);

    if (!save) {
      return false;
    }

    // Calculate total storage to free (save + versions)
    const versionsResult = await db
      .select({ totalSize: sql<string>`COALESCE(SUM(file_size), 0)` })
      .from(cloudSaveVersions)
      .where(eq(cloudSaveVersions.cloudSaveId, save.id));

    const versionsSize = BigInt(versionsResult[0]?.totalSize ?? 0);
    const totalSize = BigInt(save.fileSize) + versionsSize;

    // Delete (cascades to versions)
    await db.delete(cloudSaves).where(eq(cloudSaves.id, save.id));

    // Free storage
    await StorageService.removeUsage(userId, Number(totalSize));

    // Log deletion
    await this.logSyncOperation(userId, save.id, 'delete', platformData, 'success');

    return true;
  }

  /**
   * Get cloud save statistics for a user
   */
  static async getStats(userId: string): Promise<CloudSaveStats> {
    // Get total saves and size
    const savesResult = await db
      .select({
        count: sql<number>`COUNT(*)`,
        totalSize: sql<string>`COALESCE(SUM(file_size), 0)`,
      })
      .from(cloudSaves)
      .where(eq(cloudSaves.userId, userId));

    // Get unique games count
    const gamesResult = await db
      .select({
        count: sql<number>`COUNT(DISTINCT game_id)`,
      })
      .from(cloudSaves)
      .where(eq(cloudSaves.userId, userId));

    // Get last sync time
    const syncResult = await db
      .select({ lastSync: sql<Date>`MAX(created_at)` })
      .from(cloudSaveSyncLog)
      .where(eq(cloudSaveSyncLog.userId, userId));

    return {
      totalSaves: savesResult[0]?.count ?? 0,
      totalSize: BigInt(savesResult[0]?.totalSize ?? 0),
      gamesWithSaves: gamesResult[0]?.count ?? 0,
      lastSyncAt: syncResult[0]?.lastSync ?? null,
    };
  }

  /**
   * Check for sync conflicts between local and remote saves
   * Uses batch query to avoid N+1 database calls
   */
  static async checkSyncConflicts(
    userId: string,
    localSaves: LocalSaveInfo[]
  ): Promise<SyncConflict[]> {
    if (localSaves.length === 0) {
      return [];
    }

    // Build a single query with OR conditions for all local saves
    // This avoids N+1 queries by fetching all matching saves at once
    const conditions = localSaves.map((local) =>
      and(
        eq(cloudSaves.gameId, local.gameId),
        eq(cloudSaves.slotNumber, local.slotNumber)
      )
    );

    const remoteSaves = await db
      .select()
      .from(cloudSaves)
      .where(
        and(
          eq(cloudSaves.userId, userId),
          or(...conditions)
        )
      );

    // Create a map for quick lookup: "gameId:slotNumber" -> remote save
    const remoteMap = new Map<string, CloudSave>();
    for (const remote of remoteSaves) {
      const key = `${remote.gameId}:${remote.slotNumber}`;
      remoteMap.set(key, remote);
    }

    // Check for conflicts
    const conflicts: SyncConflict[] = [];
    for (const local of localSaves) {
      const key = `${local.gameId}:${local.slotNumber}`;
      const remote = remoteMap.get(key);

      if (remote && remote.checksum !== local.checksum) {
        // Determine conflict type
        const localTime = local.updatedAt.getTime();
        const remoteTime = remote.updatedAt.getTime();

        let conflictType: SyncConflict['conflictType'];
        if (remoteTime > localTime) {
          conflictType = 'newer_remote';
        } else if (localTime > remoteTime) {
          conflictType = 'newer_local';
        } else {
          conflictType = 'both_modified';
        }

        conflicts.push({
          localInfo: local,
          remoteSave: remote,
          conflictType,
        });
      }
    }

    return conflicts;
  }

  /**
   * Log a sync operation for debugging and analytics
   */
  private static async logSyncOperation(
    userId: string,
    cloudSaveId: string | null,
    operation: 'upload' | 'download' | 'delete' | 'conflict_resolved',
    deviceInfo?: SaveUploadParams['platformData'],
    status: 'success' | 'failed' | 'conflict' = 'success',
    bytesTransferred?: number,
    errorMessage?: string
  ): Promise<void> {
    await db.insert(cloudSaveSyncLog).values({
      id: randomUUID(),
      userId,
      cloudSaveId,
      operation,
      deviceInfo,
      status,
      bytesTransferred,
      errorMessage,
      createdAt: new Date(),
    });
  }

  /**
   * Get sync history for debugging
   */
  static async getSyncHistory(
    userId: string,
    limit = 50
  ): Promise<CloudSaveSyncLog[]> {
    const history = await db
      .select()
      .from(cloudSaveSyncLog)
      .where(eq(cloudSaveSyncLog.userId, userId))
      .orderBy(desc(cloudSaveSyncLog.createdAt))
      .limit(limit);

    return history;
  }
}

export default CloudSavesService;
