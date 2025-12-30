/**
 * Game Install Service Implementation
 * Manages game installations, downloads, and updates
 */

import { randomUUID } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { gameBuilds, gameInstallations } from '../db/schema.js';
import { AGameInstallService } from './AGameInstallService.js';

import type { CreateInstallationRequest } from './types.js';
import type { DownloadProgress } from './types.js';
import type { GameBuild } from './types.js';
import type { GameInstallation } from './types.js';
import type { GamePlatformEvent } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { InstallStatus } from './types.js';
import type { UpdateInstallationStatusRequest } from './types.js';

export class GameInstallService extends AGameInstallService {
  private eventSubscribers = new Map<string, Set<GamePlatformEventCallback>>();

  async createInstallation(
    request: CreateInstallationRequest
  ): Promise<GameInstallation> {
    const id = randomUUID();
    const now = new Date();

    const [result] = await db
      .insert(gameInstallations)
      .values({
        id,
        userId: request.userId,
        gameId: request.gameId,
        platformId: request.platformId,
        status: 'not_installed',
        installPath: request.installPath,
        playtimeMinutes: 0,
        autoUpdate: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapInstallation(result);
  }

  async getInstallation(installationId: string): Promise<GameInstallation | null> {
    const [result] = await db
      .select()
      .from(gameInstallations)
      .where(eq(gameInstallations.id, installationId))
      .limit(1);

    return result ? this.mapInstallation(result) : null;
  }

  async getInstallationByUserGame(
    userId: string,
    gameId: string
  ): Promise<GameInstallation | null> {
    const [result] = await db
      .select()
      .from(gameInstallations)
      .where(
        and(
          eq(gameInstallations.userId, userId),
          eq(gameInstallations.gameId, gameId)
        )
      )
      .limit(1);

    return result ? this.mapInstallation(result) : null;
  }

  async listUserInstallations(userId: string): Promise<GameInstallation[]> {
    const results = await db
      .select()
      .from(gameInstallations)
      .where(eq(gameInstallations.userId, userId));

    return results.map((r) => this.mapInstallation(r));
  }

  async listUserInstallationsByStatus(
    userId: string,
    status: InstallStatus
  ): Promise<GameInstallation[]> {
    const results = await db
      .select()
      .from(gameInstallations)
      .where(
        and(
          eq(gameInstallations.userId, userId),
          eq(gameInstallations.status, status)
        )
      );

    return results.map((r) => this.mapInstallation(r));
  }

  async updateInstallationStatus(
    installationId: string,
    updates: UpdateInstallationStatusRequest
  ): Promise<GameInstallation> {
    const [result] = await db
      .update(gameInstallations)
      .set({
        status: updates.status,
        version: updates.version,
        installedSizeBytes: updates.installedSizeBytes?.toString(),
        downloadProgress: updates.downloadProgress,
        errorMessage: updates.errorMessage,
        updatedAt: new Date(),
      })
      .where(eq(gameInstallations.id, installationId))
      .returning();

    if (!result) {
      throw new Error(`Installation not found: ${installationId}`);
    }

    return this.mapInstallation(result);
  }

  async updateDownloadProgress(
    installationId: string,
    progress: DownloadProgress
  ): Promise<GameInstallation> {
    const [result] = await db
      .update(gameInstallations)
      .set({
        downloadProgress: progress,
        updatedAt: new Date(),
      })
      .where(eq(gameInstallations.id, installationId))
      .returning();

    if (!result) {
      throw new Error(`Installation not found: ${installationId}`);
    }

    const installation = this.mapInstallation(result);

    this.emitEvent({
      type: 'installation_progress',
      userId: installation.userId,
      gameId: installation.gameId,
      timestamp: new Date(),
      data: { installationId, progress },
    });

    return installation;
  }

  async startInstallation(installationId: string): Promise<GameInstallation> {
    const installation = await this.updateInstallationStatus(installationId, {
      status: 'downloading',
    });

    this.emitEvent({
      type: 'installation_started',
      userId: installation.userId,
      gameId: installation.gameId,
      timestamp: new Date(),
      data: { installationId },
    });

    return installation;
  }

  async pauseInstallation(installationId: string): Promise<GameInstallation> {
    const installation = await this.updateInstallationStatus(installationId, {
      status: 'paused',
    });

    this.emitEvent({
      type: 'installation_paused',
      userId: installation.userId,
      gameId: installation.gameId,
      timestamp: new Date(),
      data: { installationId },
    });

    return installation;
  }

  async resumeInstallation(installationId: string): Promise<GameInstallation> {
    return this.startInstallation(installationId);
  }

  async cancelInstallation(installationId: string): Promise<void> {
    const installation = await this.getInstallation(installationId);
    if (!installation) {
      throw new Error(`Installation not found: ${installationId}`);
    }

    await db
      .update(gameInstallations)
      .set({
        status: 'not_installed',
        downloadProgress: null,
        updatedAt: new Date(),
      })
      .where(eq(gameInstallations.id, installationId));
  }

  async completeInstallation(
    installationId: string,
    version: string,
    installedSizeBytes: number
  ): Promise<GameInstallation> {
    const installation = await this.updateInstallationStatus(installationId, {
      status: 'installed',
      version,
      installedSizeBytes,
    });

    this.emitEvent({
      type: 'installation_completed',
      userId: installation.userId,
      gameId: installation.gameId,
      timestamp: new Date(),
      data: { installationId, version, installedSizeBytes },
    });

    return installation;
  }

  async markInstallationError(
    installationId: string,
    errorMessage: string
  ): Promise<GameInstallation> {
    const installation = await this.updateInstallationStatus(installationId, {
      status: 'error',
      errorMessage,
    });

    this.emitEvent({
      type: 'installation_failed',
      userId: installation.userId,
      gameId: installation.gameId,
      timestamp: new Date(),
      data: { installationId, errorMessage },
    });

    return installation;
  }

  async uninstallGame(installationId: string): Promise<void> {
    await db
      .update(gameInstallations)
      .set({
        status: 'not_installed',
        version: null,
        installedSizeBytes: null,
        downloadProgress: null,
        updatedAt: new Date(),
      })
      .where(eq(gameInstallations.id, installationId));
  }

  async updatePlaytime(
    installationId: string,
    additionalMinutes: number
  ): Promise<GameInstallation> {
    const installation = await this.getInstallation(installationId);
    if (!installation) {
      throw new Error(`Installation not found: ${installationId}`);
    }

    const [result] = await db
      .update(gameInstallations)
      .set({
        playtimeMinutes: installation.playtimeMinutes + additionalMinutes,
        lastPlayedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(gameInstallations.id, installationId))
      .returning();

    return this.mapInstallation(result);
  }

  async setAutoUpdate(
    installationId: string,
    enabled: boolean
  ): Promise<GameInstallation> {
    const [result] = await db
      .update(gameInstallations)
      .set({
        autoUpdate: enabled,
        updatedAt: new Date(),
      })
      .where(eq(gameInstallations.id, installationId))
      .returning();

    if (!result) {
      throw new Error(`Installation not found: ${installationId}`);
    }

    return this.mapInstallation(result);
  }

  async getLatestBuild(
    gameId: string,
    platformId: string
  ): Promise<GameBuild | null> {
    const [result] = await db
      .select()
      .from(gameBuilds)
      .where(
        and(
          eq(gameBuilds.gameId, gameId),
          eq(gameBuilds.platformId, platformId),
          eq(gameBuilds.isPrerelease, false)
        )
      )
      .orderBy(desc(gameBuilds.createdAt))
      .limit(1);

    return result ? this.mapBuild(result) : null;
  }

  async listGameBuilds(gameId: string, platformId: string): Promise<GameBuild[]> {
    const results = await db
      .select()
      .from(gameBuilds)
      .where(
        and(
          eq(gameBuilds.gameId, gameId),
          eq(gameBuilds.platformId, platformId)
        )
      )
      .orderBy(desc(gameBuilds.createdAt));

    return results.map((r) => this.mapBuild(r));
  }

  async checkForUpdates(installationId: string): Promise<GameBuild | null> {
    const installation = await this.getInstallation(installationId);
    if (!installation || !installation.version) {
      return null;
    }

    const latestBuild = await this.getLatestBuild(
      installation.gameId,
      installation.platformId
    );

    if (!latestBuild || latestBuild.version === installation.version) {
      return null;
    }

    this.emitEvent({
      type: 'update_available',
      userId: installation.userId,
      gameId: installation.gameId,
      timestamp: new Date(),
      data: {
        installationId,
        currentVersion: installation.version,
        newVersion: latestBuild.version,
      },
    });

    return latestBuild;
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

  private mapInstallation(
    row: typeof gameInstallations.$inferSelect
  ): GameInstallation {
    return {
      id: row.id,
      userId: row.userId,
      gameId: row.gameId,
      platformId: row.platformId,
      status: row.status as InstallStatus,
      installPath: row.installPath ?? undefined,
      version: row.version ?? undefined,
      installedSizeBytes: row.installedSizeBytes
        ? parseInt(row.installedSizeBytes, 10)
        : undefined,
      downloadProgress: row.downloadProgress as DownloadProgress | undefined,
      lastPlayedAt: row.lastPlayedAt ?? undefined,
      playtimeMinutes: row.playtimeMinutes,
      autoUpdate: row.autoUpdate,
      errorMessage: row.errorMessage ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapBuild(row: typeof gameBuilds.$inferSelect): GameBuild {
    return {
      id: row.id,
      gameId: row.gameId,
      platformId: row.platformId,
      version: row.version,
      buildNumber: row.buildNumber ?? undefined,
      sizeBytes: parseInt(row.sizeBytes, 10),
      checksum: row.checksum ?? undefined,
      checksumType: row.checksumType as 'md5' | 'sha256' | undefined,
      releaseNotes: row.releaseNotes ?? undefined,
      isMandatory: row.isMandatory,
      isPrerelease: row.isPrerelease,
      downloadUrl: row.downloadUrl ?? undefined,
      createdAt: row.createdAt,
    };
  }
}
