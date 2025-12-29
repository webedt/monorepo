/**
 * Abstract Game Install Service
 * Defines the interface for game installation management
 */

import type { CreateInstallationRequest } from './types.js';
import type { DownloadProgress } from './types.js';
import type { GameBuild } from './types.js';
import type { GameInstallation } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { InstallStatus } from './types.js';
import type { UpdateInstallationStatusRequest } from './types.js';

export abstract class AGameInstallService {
  abstract createInstallation(
    request: CreateInstallationRequest
  ): Promise<GameInstallation>;

  abstract getInstallation(
    installationId: string
  ): Promise<GameInstallation | null>;

  abstract getInstallationByUserGame(
    userId: string,
    gameId: string
  ): Promise<GameInstallation | null>;

  abstract listUserInstallations(
    userId: string
  ): Promise<GameInstallation[]>;

  abstract listUserInstallationsByStatus(
    userId: string,
    status: InstallStatus
  ): Promise<GameInstallation[]>;

  abstract updateInstallationStatus(
    installationId: string,
    updates: UpdateInstallationStatusRequest
  ): Promise<GameInstallation>;

  abstract updateDownloadProgress(
    installationId: string,
    progress: DownloadProgress
  ): Promise<GameInstallation>;

  abstract startInstallation(
    installationId: string
  ): Promise<GameInstallation>;

  abstract pauseInstallation(
    installationId: string
  ): Promise<GameInstallation>;

  abstract resumeInstallation(
    installationId: string
  ): Promise<GameInstallation>;

  abstract cancelInstallation(
    installationId: string
  ): Promise<void>;

  abstract completeInstallation(
    installationId: string,
    version: string,
    installedSizeBytes: number
  ): Promise<GameInstallation>;

  abstract markInstallationError(
    installationId: string,
    errorMessage: string
  ): Promise<GameInstallation>;

  abstract uninstallGame(
    installationId: string
  ): Promise<void>;

  abstract updatePlaytime(
    installationId: string,
    additionalMinutes: number
  ): Promise<GameInstallation>;

  abstract setAutoUpdate(
    installationId: string,
    enabled: boolean
  ): Promise<GameInstallation>;

  abstract getLatestBuild(
    gameId: string,
    platformId: string
  ): Promise<GameBuild | null>;

  abstract listGameBuilds(
    gameId: string,
    platformId: string
  ): Promise<GameBuild[]>;

  abstract checkForUpdates(
    installationId: string
  ): Promise<GameBuild | null>;

  abstract subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void;
}
