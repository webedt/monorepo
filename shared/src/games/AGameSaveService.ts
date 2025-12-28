/**
 * Abstract Game Save Service
 * Defines the interface for cloud save synchronization
 */

import type { CloudSave } from './types.js';
import type { CloudSaveQuota } from './types.js';
import type { CreateCloudSaveRequest } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { ResolveConflictRequest } from './types.js';
import type { SaveSlotType } from './types.js';
import type { SaveSyncStatus } from './types.js';

export abstract class AGameSaveService {
  abstract createSave(
    request: CreateCloudSaveRequest
  ): Promise<CloudSave>;

  abstract getSave(
    saveId: string
  ): Promise<CloudSave | null>;

  abstract getUserGameSaves(
    userId: string,
    gameId: string
  ): Promise<CloudSave[]>;

  abstract getUserGameSavesBySlot(
    userId: string,
    gameId: string,
    slotNumber: number
  ): Promise<CloudSave | null>;

  abstract getUserSavesByType(
    userId: string,
    gameId: string,
    slotType: SaveSlotType
  ): Promise<CloudSave[]>;

  abstract listAllUserSaves(
    userId: string
  ): Promise<CloudSave[]>;

  abstract updateSave(
    saveId: string,
    updates: Partial<CreateCloudSaveRequest>
  ): Promise<CloudSave>;

  abstract deleteSave(
    saveId: string
  ): Promise<void>;

  abstract deleteGameSaves(
    userId: string,
    gameId: string
  ): Promise<void>;

  abstract startUpload(
    saveId: string
  ): Promise<CloudSave>;

  abstract completeUpload(
    saveId: string,
    cloudUrl: string
  ): Promise<CloudSave>;

  abstract failUpload(
    saveId: string,
    errorMessage: string
  ): Promise<CloudSave>;

  abstract startDownload(
    saveId: string
  ): Promise<CloudSave>;

  abstract completeDownload(
    saveId: string,
    localPath: string
  ): Promise<CloudSave>;

  abstract failDownload(
    saveId: string,
    errorMessage: string
  ): Promise<CloudSave>;

  abstract markConflict(
    saveId: string,
    localChecksum: string,
    localSizeBytes: number,
    localModifiedAt: Date
  ): Promise<CloudSave>;

  abstract resolveConflict(
    request: ResolveConflictRequest
  ): Promise<CloudSave>;

  abstract getSavesWithConflicts(
    userId: string
  ): Promise<CloudSave[]>;

  abstract getSavesByStatus(
    userId: string,
    status: SaveSyncStatus
  ): Promise<CloudSave[]>;

  abstract getUserQuota(
    userId: string
  ): Promise<CloudSaveQuota>;

  abstract getQuotaUsage(
    userId: string
  ): Promise<{ usedBytes: number; saveCount: number }>;

  abstract syncSave(
    saveId: string
  ): Promise<CloudSave>;

  abstract syncGameSaves(
    userId: string,
    gameId: string
  ): Promise<CloudSave[]>;

  abstract subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void;
}
