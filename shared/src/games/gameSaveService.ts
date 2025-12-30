/**
 * Game Save Service Implementation
 * Manages cloud save synchronization and conflict resolution
 */

import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { gameCloudSaves } from '../db/schema.js';
import { AGameSaveService } from './AGameSaveService.js';

import type { CloudSave } from './types.js';
import type { CloudSaveConflict } from './types.js';
import type { CloudSaveQuota } from './types.js';
import type { CreateCloudSaveRequest } from './types.js';
import type { GamePlatformEvent } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { ResolveConflictRequest } from './types.js';
import type { SaveSlotType } from './types.js';
import type { SaveSyncStatus } from './types.js';

const DEFAULT_QUOTA_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const DEFAULT_MAX_SAVES = 100;

export class GameSaveService extends AGameSaveService {
  private eventSubscribers = new Map<string, Set<GamePlatformEventCallback>>();

  async createSave(request: CreateCloudSaveRequest): Promise<CloudSave> {
    const id = randomUUID();
    const now = new Date();

    const [result] = await db
      .insert(gameCloudSaves)
      .values({
        id,
        userId: request.userId,
        gameId: request.gameId,
        slotNumber: request.slotNumber,
        slotType: request.slotType,
        name: request.name,
        description: request.description,
        sizeBytes: request.sizeBytes.toString(),
        checksum: request.checksum,
        checksumType: request.checksumType,
        gameVersion: request.gameVersion,
        playtimeMinutes: request.playtimeMinutes,
        gameProgress: request.gameProgress,
        syncStatus: 'synced',
        localPath: request.localPath,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapCloudSave(result);
  }

  async getSave(saveId: string): Promise<CloudSave | null> {
    const [result] = await db
      .select()
      .from(gameCloudSaves)
      .where(eq(gameCloudSaves.id, saveId))
      .limit(1);

    return result ? this.mapCloudSave(result) : null;
  }

  async getUserGameSaves(userId: string, gameId: string): Promise<CloudSave[]> {
    const results = await db
      .select()
      .from(gameCloudSaves)
      .where(
        and(
          eq(gameCloudSaves.userId, userId),
          eq(gameCloudSaves.gameId, gameId)
        )
      )
      .orderBy(gameCloudSaves.slotNumber);

    return results.map((r) => this.mapCloudSave(r));
  }

  async getUserGameSavesBySlot(
    userId: string,
    gameId: string,
    slotNumber: number
  ): Promise<CloudSave | null> {
    const [result] = await db
      .select()
      .from(gameCloudSaves)
      .where(
        and(
          eq(gameCloudSaves.userId, userId),
          eq(gameCloudSaves.gameId, gameId),
          eq(gameCloudSaves.slotNumber, slotNumber)
        )
      )
      .limit(1);

    return result ? this.mapCloudSave(result) : null;
  }

  async getUserSavesByType(
    userId: string,
    gameId: string,
    slotType: SaveSlotType
  ): Promise<CloudSave[]> {
    const results = await db
      .select()
      .from(gameCloudSaves)
      .where(
        and(
          eq(gameCloudSaves.userId, userId),
          eq(gameCloudSaves.gameId, gameId),
          eq(gameCloudSaves.slotType, slotType)
        )
      );

    return results.map((r) => this.mapCloudSave(r));
  }

  async listAllUserSaves(userId: string): Promise<CloudSave[]> {
    const results = await db
      .select()
      .from(gameCloudSaves)
      .where(eq(gameCloudSaves.userId, userId));

    return results.map((r) => this.mapCloudSave(r));
  }

  async updateSave(
    saveId: string,
    updates: Partial<CreateCloudSaveRequest>
  ): Promise<CloudSave> {
    const updateData: Record<string, unknown> = {
      ...updates,
      updatedAt: new Date(),
    };

    if (updates.sizeBytes !== undefined) {
      updateData.sizeBytes = updates.sizeBytes.toString();
    }

    const [result] = await db
      .update(gameCloudSaves)
      .set(updateData)
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    if (!result) {
      throw new Error(`Save not found: ${saveId}`);
    }

    return this.mapCloudSave(result);
  }

  async deleteSave(saveId: string): Promise<void> {
    await db.delete(gameCloudSaves).where(eq(gameCloudSaves.id, saveId));
  }

  async deleteGameSaves(userId: string, gameId: string): Promise<void> {
    await db
      .delete(gameCloudSaves)
      .where(
        and(
          eq(gameCloudSaves.userId, userId),
          eq(gameCloudSaves.gameId, gameId)
        )
      );
  }

  async startUpload(saveId: string): Promise<CloudSave> {
    const [result] = await db
      .update(gameCloudSaves)
      .set({
        syncStatus: 'uploading',
        updatedAt: new Date(),
      })
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    if (!result) {
      throw new Error(`Save not found: ${saveId}`);
    }

    return this.mapCloudSave(result);
  }

  async completeUpload(saveId: string, cloudUrl: string): Promise<CloudSave> {
    const now = new Date();

    const [result] = await db
      .update(gameCloudSaves)
      .set({
        syncStatus: 'synced',
        cloudUrl,
        syncedAt: now,
        updatedAt: now,
      })
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    if (!result) {
      throw new Error(`Save not found: ${saveId}`);
    }

    const save = this.mapCloudSave(result);

    this.emitEvent({
      type: 'save_synced',
      userId: save.userId,
      gameId: save.gameId,
      timestamp: now,
      data: { saveId, cloudUrl },
    });

    return save;
  }

  async failUpload(saveId: string, errorMessage: string): Promise<CloudSave> {
    const [result] = await db
      .update(gameCloudSaves)
      .set({
        syncStatus: 'error',
        updatedAt: new Date(),
      })
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    if (!result) {
      throw new Error(`Save not found: ${saveId}`);
    }

    const save = this.mapCloudSave(result);

    this.emitEvent({
      type: 'save_error',
      userId: save.userId,
      gameId: save.gameId,
      timestamp: new Date(),
      data: { saveId, error: errorMessage },
    });

    return save;
  }

  async startDownload(saveId: string): Promise<CloudSave> {
    const [result] = await db
      .update(gameCloudSaves)
      .set({
        syncStatus: 'downloading',
        updatedAt: new Date(),
      })
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    if (!result) {
      throw new Error(`Save not found: ${saveId}`);
    }

    return this.mapCloudSave(result);
  }

  async completeDownload(saveId: string, localPath: string): Promise<CloudSave> {
    const now = new Date();

    const [result] = await db
      .update(gameCloudSaves)
      .set({
        syncStatus: 'synced',
        localPath,
        syncedAt: now,
        updatedAt: now,
      })
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    if (!result) {
      throw new Error(`Save not found: ${saveId}`);
    }

    const save = this.mapCloudSave(result);

    this.emitEvent({
      type: 'save_synced',
      userId: save.userId,
      gameId: save.gameId,
      timestamp: now,
      data: { saveId, localPath },
    });

    return save;
  }

  async failDownload(saveId: string, errorMessage: string): Promise<CloudSave> {
    const [result] = await db
      .update(gameCloudSaves)
      .set({
        syncStatus: 'error',
        updatedAt: new Date(),
      })
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    if (!result) {
      throw new Error(`Save not found: ${saveId}`);
    }

    const save = this.mapCloudSave(result);

    this.emitEvent({
      type: 'save_error',
      userId: save.userId,
      gameId: save.gameId,
      timestamp: new Date(),
      data: { saveId, error: errorMessage },
    });

    return save;
  }

  async markConflict(
    saveId: string,
    localChecksum: string,
    localSizeBytes: number,
    localModifiedAt: Date
  ): Promise<CloudSave> {
    const save = await this.getSave(saveId);
    if (!save) {
      throw new Error(`Save not found: ${saveId}`);
    }

    const conflictData: CloudSaveConflict = {
      localChecksum,
      cloudChecksum: save.checksum,
      localModifiedAt,
      cloudModifiedAt: save.syncedAt ?? save.updatedAt,
      localSizeBytes,
      cloudSizeBytes: save.sizeBytes,
    };

    // Store dates as ISO strings for database
    const dbConflictData = {
      localChecksum,
      cloudChecksum: save.checksum,
      localModifiedAt: localModifiedAt.toISOString(),
      cloudModifiedAt: (save.syncedAt ?? save.updatedAt).toISOString(),
      localSizeBytes,
      cloudSizeBytes: save.sizeBytes,
    };

    const [result] = await db
      .update(gameCloudSaves)
      .set({
        syncStatus: 'conflict',
        conflictData: dbConflictData,
        updatedAt: new Date(),
      })
      .where(eq(gameCloudSaves.id, saveId))
      .returning();

    const updatedSave = this.mapCloudSave(result);

    this.emitEvent({
      type: 'save_conflict',
      userId: save.userId,
      gameId: save.gameId,
      timestamp: new Date(),
      data: { saveId, conflictData },
    });

    return updatedSave;
  }

  async resolveConflict(request: ResolveConflictRequest): Promise<CloudSave> {
    const save = await this.getSave(request.saveId);
    if (!save) {
      throw new Error(`Save not found: ${request.saveId}`);
    }

    if (save.syncStatus !== 'conflict') {
      throw new Error('Save is not in conflict state');
    }

    const now = new Date();

    if (request.resolution === 'keep_both' && request.newSlotNumber !== undefined) {
      // Create a copy for the cloud version
      await db.insert(gameCloudSaves).values({
        id: randomUUID(),
        userId: save.userId,
        gameId: save.gameId,
        slotNumber: request.newSlotNumber,
        slotType: save.slotType,
        name: save.name ? `${save.name} (Cloud)` : undefined,
        description: save.description,
        sizeBytes: save.sizeBytes.toString(),
        checksum: save.checksum,
        checksumType: save.checksumType,
        gameVersion: save.gameVersion,
        playtimeMinutes: save.playtimeMinutes,
        gameProgress: save.gameProgress,
        syncStatus: 'synced',
        cloudUrl: save.cloudUrl,
        localPath: undefined,
        syncedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // Update the original save based on resolution
    const updateData: Record<string, unknown> = {
      syncStatus: 'synced',
      conflictData: null,
      syncedAt: now,
      updatedAt: now,
    };

    if (request.resolution === 'keep_local' && save.conflictData) {
      updateData.checksum = save.conflictData.localChecksum;
      updateData.sizeBytes = save.conflictData.localSizeBytes.toString();
    }

    const [result] = await db
      .update(gameCloudSaves)
      .set(updateData)
      .where(eq(gameCloudSaves.id, request.saveId))
      .returning();

    return this.mapCloudSave(result);
  }

  async getSavesWithConflicts(userId: string): Promise<CloudSave[]> {
    const results = await db
      .select()
      .from(gameCloudSaves)
      .where(
        and(
          eq(gameCloudSaves.userId, userId),
          eq(gameCloudSaves.syncStatus, 'conflict')
        )
      );

    return results.map((r) => this.mapCloudSave(r));
  }

  async getSavesByStatus(
    userId: string,
    status: SaveSyncStatus
  ): Promise<CloudSave[]> {
    const results = await db
      .select()
      .from(gameCloudSaves)
      .where(
        and(
          eq(gameCloudSaves.userId, userId),
          eq(gameCloudSaves.syncStatus, status)
        )
      );

    return results.map((r) => this.mapCloudSave(r));
  }

  async getUserQuota(userId: string): Promise<CloudSaveQuota> {
    const usage = await this.getQuotaUsage(userId);

    return {
      userId,
      usedBytes: usage.usedBytes,
      totalBytes: DEFAULT_QUOTA_BYTES,
      saveCount: usage.saveCount,
      maxSaves: DEFAULT_MAX_SAVES,
    };
  }

  async getQuotaUsage(
    userId: string
  ): Promise<{ usedBytes: number; saveCount: number }> {
    const saves = await this.listAllUserSaves(userId);
    const usedBytes = saves.reduce((sum, s) => sum + s.sizeBytes, 0);
    return { usedBytes, saveCount: saves.length };
  }

  async syncSave(saveId: string): Promise<CloudSave> {
    const save = await this.getSave(saveId);
    if (!save) {
      throw new Error(`Save not found: ${saveId}`);
    }

    // In a real implementation, this would trigger the actual sync process
    // For now, we just mark it as synced
    return this.completeUpload(saveId, save.cloudUrl ?? '');
  }

  async syncGameSaves(userId: string, gameId: string): Promise<CloudSave[]> {
    const saves = await this.getUserGameSaves(userId, gameId);
    const synced: CloudSave[] = [];

    for (const save of saves) {
      if (save.syncStatus !== 'synced') {
        const syncedSave = await this.syncSave(save.id);
        synced.push(syncedSave);
      } else {
        synced.push(save);
      }
    }

    return synced;
  }

  subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void {
    let subscribers = this.eventSubscribers.get(userId);
    if (!subscribers) {
      subscribers = new Set();
      this.eventSubscribers.set(userId, subscribers);
    }
    subscribers.add(callback);

    return () => {
      this.eventSubscribers.get(userId)?.delete(callback);
    };
  }

  private emitEvent(event: GamePlatformEvent): void {
    const subscribers = this.eventSubscribers.get(event.userId);
    if (subscribers) {
      for (const callback of subscribers) {
        try {
          callback(event);
        } catch {
          // Ignore callback errors
        }
      }
    }
  }

  private mapCloudSave(row: typeof gameCloudSaves.$inferSelect): CloudSave {
    let conflictData: CloudSaveConflict | undefined;
    if (row.conflictData) {
      const cd = row.conflictData;
      conflictData = {
        localChecksum: cd.localChecksum,
        cloudChecksum: cd.cloudChecksum,
        localModifiedAt: new Date(cd.localModifiedAt),
        cloudModifiedAt: new Date(cd.cloudModifiedAt),
        localSizeBytes: cd.localSizeBytes,
        cloudSizeBytes: cd.cloudSizeBytes,
      };
    }

    return {
      id: row.id,
      userId: row.userId,
      gameId: row.gameId,
      slotNumber: row.slotNumber,
      slotType: row.slotType as SaveSlotType,
      name: row.name ?? undefined,
      description: row.description ?? undefined,
      thumbnailUrl: row.thumbnailUrl ?? undefined,
      sizeBytes: parseInt(row.sizeBytes, 10),
      checksum: row.checksum,
      checksumType: row.checksumType as 'md5' | 'sha256',
      gameVersion: row.gameVersion ?? undefined,
      playtimeMinutes: row.playtimeMinutes ?? undefined,
      gameProgress: row.gameProgress as Record<string, unknown> | undefined,
      syncStatus: row.syncStatus as SaveSyncStatus,
      cloudUrl: row.cloudUrl ?? undefined,
      localPath: row.localPath ?? undefined,
      conflictData,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      syncedAt: row.syncedAt ?? undefined,
    };
  }
}
