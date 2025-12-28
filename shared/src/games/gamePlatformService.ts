/**
 * Game Platform Service Implementation
 * Manages platforms and system requirements
 */

import { randomUUID } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { gamePlatforms, gameSystemRequirements } from '../db/schema.js';
import { AGamePlatformService } from './AGamePlatformService.js';

import type { CreatePlatformRequest } from './types.js';
import type { CreateSystemRequirementsRequest } from './types.js';
import type { Platform } from './types.js';
import type { PlatformOS } from './types.js';
import type { SystemRequirements } from './types.js';

export class GamePlatformService extends AGamePlatformService {
  async createPlatform(request: CreatePlatformRequest): Promise<Platform> {
    const id = randomUUID();
    const now = new Date();

    const [result] = await db
      .insert(gamePlatforms)
      .values({
        id,
        os: request.os,
        architecture: request.architecture,
        displayName: request.displayName,
        iconUrl: request.iconUrl,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapPlatform(result);
  }

  async getPlatform(platformId: string): Promise<Platform | null> {
    const [result] = await db
      .select()
      .from(gamePlatforms)
      .where(eq(gamePlatforms.id, platformId))
      .limit(1);

    return result ? this.mapPlatform(result) : null;
  }

  async getPlatformByOsArch(
    os: PlatformOS,
    architecture: string
  ): Promise<Platform | null> {
    const [result] = await db
      .select()
      .from(gamePlatforms)
      .where(
        and(
          eq(gamePlatforms.os, os),
          eq(gamePlatforms.architecture, architecture)
        )
      )
      .limit(1);

    return result ? this.mapPlatform(result) : null;
  }

  async listPlatforms(): Promise<Platform[]> {
    const results = await db.select().from(gamePlatforms);
    return results.map((r) => this.mapPlatform(r));
  }

  async listActivePlatforms(): Promise<Platform[]> {
    const results = await db
      .select()
      .from(gamePlatforms)
      .where(eq(gamePlatforms.isActive, true));
    return results.map((r) => this.mapPlatform(r));
  }

  async updatePlatform(
    platformId: string,
    updates: Partial<CreatePlatformRequest>
  ): Promise<Platform> {
    const [result] = await db
      .update(gamePlatforms)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(gamePlatforms.id, platformId))
      .returning();

    if (!result) {
      throw new Error(`Platform not found: ${platformId}`);
    }

    return this.mapPlatform(result);
  }

  async deactivatePlatform(platformId: string): Promise<void> {
    await db
      .update(gamePlatforms)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(gamePlatforms.id, platformId));
  }

  async createSystemRequirements(
    request: CreateSystemRequirementsRequest
  ): Promise<SystemRequirements> {
    const id = randomUUID();
    const now = new Date();

    const [result] = await db
      .insert(gameSystemRequirements)
      .values({
        id,
        gameId: request.gameId,
        platformId: request.platformId,
        level: request.level,
        osVersion: request.osVersion,
        processor: request.processor,
        memory: request.memory,
        graphics: request.graphics,
        graphicsMemory: request.graphicsMemory,
        graphicsApi: request.graphicsApi,
        storage: request.storage,
        additionalNotes: request.additionalNotes,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapSystemRequirements(result);
  }

  async getSystemRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements[]> {
    const results = await db
      .select()
      .from(gameSystemRequirements)
      .where(
        and(
          eq(gameSystemRequirements.gameId, gameId),
          eq(gameSystemRequirements.platformId, platformId)
        )
      );

    return results.map((r) => this.mapSystemRequirements(r));
  }

  async getMinimumRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements | null> {
    const [result] = await db
      .select()
      .from(gameSystemRequirements)
      .where(
        and(
          eq(gameSystemRequirements.gameId, gameId),
          eq(gameSystemRequirements.platformId, platformId),
          eq(gameSystemRequirements.level, 'minimum')
        )
      )
      .limit(1);

    return result ? this.mapSystemRequirements(result) : null;
  }

  async getRecommendedRequirements(
    gameId: string,
    platformId: string
  ): Promise<SystemRequirements | null> {
    const [result] = await db
      .select()
      .from(gameSystemRequirements)
      .where(
        and(
          eq(gameSystemRequirements.gameId, gameId),
          eq(gameSystemRequirements.platformId, platformId),
          eq(gameSystemRequirements.level, 'recommended')
        )
      )
      .limit(1);

    return result ? this.mapSystemRequirements(result) : null;
  }

  async updateSystemRequirements(
    requirementsId: string,
    updates: Partial<CreateSystemRequirementsRequest>
  ): Promise<SystemRequirements> {
    const [result] = await db
      .update(gameSystemRequirements)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(gameSystemRequirements.id, requirementsId))
      .returning();

    if (!result) {
      throw new Error(`System requirements not found: ${requirementsId}`);
    }

    return this.mapSystemRequirements(result);
  }

  async deleteSystemRequirements(requirementsId: string): Promise<void> {
    await db
      .delete(gameSystemRequirements)
      .where(eq(gameSystemRequirements.id, requirementsId));
  }

  async getGamePlatforms(gameId: string): Promise<Platform[]> {
    const requirements = await db
      .select()
      .from(gameSystemRequirements)
      .where(eq(gameSystemRequirements.gameId, gameId));

    const platformIds = [...new Set(requirements.map((r) => r.platformId))];

    if (platformIds.length === 0) {
      return [];
    }

    const platforms = await Promise.all(
      platformIds.map((id) => this.getPlatform(id))
    );

    return platforms.filter((p): p is Platform => p !== null);
  }

  async isGameAvailableOnPlatform(
    gameId: string,
    platformId: string
  ): Promise<boolean> {
    const [result] = await db
      .select()
      .from(gameSystemRequirements)
      .where(
        and(
          eq(gameSystemRequirements.gameId, gameId),
          eq(gameSystemRequirements.platformId, platformId)
        )
      )
      .limit(1);

    return !!result;
  }

  private mapPlatform(row: typeof gamePlatforms.$inferSelect): Platform {
    return {
      id: row.id,
      os: row.os as PlatformOS,
      architecture: row.architecture as 'x64' | 'x86' | 'arm64',
      displayName: row.displayName,
      iconUrl: row.iconUrl ?? undefined,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapSystemRequirements(
    row: typeof gameSystemRequirements.$inferSelect
  ): SystemRequirements {
    return {
      id: row.id,
      gameId: row.gameId,
      platformId: row.platformId,
      level: row.level as 'minimum' | 'recommended',
      osVersion: row.osVersion ?? undefined,
      processor: row.processor ?? undefined,
      memory: row.memory ?? undefined,
      graphics: row.graphics ?? undefined,
      graphicsMemory: row.graphicsMemory ?? undefined,
      graphicsApi: row.graphicsApi as SystemRequirements['graphicsApi'],
      storage: row.storage ?? undefined,
      additionalNotes: row.additionalNotes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
