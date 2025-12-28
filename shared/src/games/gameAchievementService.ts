/**
 * Game Achievement Service Implementation
 * Manages achievements, user progress, and statistics
 */

import { randomUUID } from 'crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { gameAchievements, userAchievements } from '../db/schema.js';
import { AGameAchievementService } from './AGameAchievementService.js';

import type { Achievement } from './types.js';
import type { AchievementRarity } from './types.js';
import type { AchievementStats } from './types.js';
import type { AchievementType } from './types.js';
import type { CreateAchievementRequest } from './types.js';
import type { GamePlatformEvent } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { UnlockAchievementRequest } from './types.js';
import type { UpdateAchievementProgressRequest } from './types.js';
import type { UserAchievement } from './types.js';
import type { UserAchievementSummary } from './types.js';

export class GameAchievementService extends AGameAchievementService {
  private eventSubscribers = new Map<string, Set<GamePlatformEventCallback>>();

  async createAchievement(request: CreateAchievementRequest): Promise<Achievement> {
    const id = randomUUID();
    const now = new Date();

    const [result] = await db
      .insert(gameAchievements)
      .values({
        id,
        gameId: request.gameId,
        name: request.name,
        description: request.description,
        hiddenDescription: request.hiddenDescription,
        iconUrl: request.iconUrl,
        iconLockedUrl: request.iconLockedUrl,
        points: request.points ?? 10,
        rarity: request.rarity ?? 'common',
        type: request.type ?? 'standard',
        maxProgress: request.maxProgress,
        sortOrder: request.sortOrder ?? 0,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    return this.mapAchievement(result);
  }

  async getAchievement(achievementId: string): Promise<Achievement | null> {
    const [result] = await db
      .select()
      .from(gameAchievements)
      .where(eq(gameAchievements.id, achievementId))
      .limit(1);

    return result ? this.mapAchievement(result) : null;
  }

  async listGameAchievements(gameId: string): Promise<Achievement[]> {
    const results = await db
      .select()
      .from(gameAchievements)
      .where(eq(gameAchievements.gameId, gameId))
      .orderBy(gameAchievements.sortOrder);

    return results.map((r) => this.mapAchievement(r));
  }

  async listActiveGameAchievements(gameId: string): Promise<Achievement[]> {
    const results = await db
      .select()
      .from(gameAchievements)
      .where(
        and(
          eq(gameAchievements.gameId, gameId),
          eq(gameAchievements.isActive, true)
        )
      )
      .orderBy(gameAchievements.sortOrder);

    return results.map((r) => this.mapAchievement(r));
  }

  async updateAchievement(
    achievementId: string,
    updates: Partial<CreateAchievementRequest>
  ): Promise<Achievement> {
    const [result] = await db
      .update(gameAchievements)
      .set({
        ...updates,
        updatedAt: new Date(),
      })
      .where(eq(gameAchievements.id, achievementId))
      .returning();

    if (!result) {
      throw new Error(`Achievement not found: ${achievementId}`);
    }

    return this.mapAchievement(result);
  }

  async deactivateAchievement(achievementId: string): Promise<void> {
    await db
      .update(gameAchievements)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(gameAchievements.id, achievementId));
  }

  async deleteAchievement(achievementId: string): Promise<void> {
    await db
      .delete(gameAchievements)
      .where(eq(gameAchievements.id, achievementId));
  }

  async unlockAchievement(request: UnlockAchievementRequest): Promise<UserAchievement> {
    const achievement = await this.getAchievement(request.achievementId);
    if (!achievement) {
      throw new Error(`Achievement not found: ${request.achievementId}`);
    }

    const existing = await this.getUserAchievement(
      request.userId,
      request.achievementId
    );

    if (existing?.unlocked) {
      return existing;
    }

    const now = new Date();

    if (existing) {
      const [result] = await db
        .update(userAchievements)
        .set({
          unlocked: true,
          unlockedAt: now,
          progress: achievement.maxProgress ?? undefined,
          updatedAt: now,
        })
        .where(eq(userAchievements.id, existing.id))
        .returning();

      const userAchievement = this.mapUserAchievement(result);
      this.emitUnlockEvent(request.userId, achievement, userAchievement);
      return userAchievement;
    }

    const id = randomUUID();
    const [result] = await db
      .insert(userAchievements)
      .values({
        id,
        userId: request.userId,
        achievementId: request.achievementId,
        gameId: achievement.gameId,
        unlocked: true,
        unlockedAt: now,
        progress: achievement.maxProgress,
        notified: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const userAchievement = this.mapUserAchievement(result);
    this.emitUnlockEvent(request.userId, achievement, userAchievement);
    return userAchievement;
  }

  async updateAchievementProgress(
    request: UpdateAchievementProgressRequest
  ): Promise<UserAchievement> {
    const achievement = await this.getAchievement(request.achievementId);
    if (!achievement) {
      throw new Error(`Achievement not found: ${request.achievementId}`);
    }

    if (achievement.type !== 'progressive' || !achievement.maxProgress) {
      throw new Error('Achievement does not support progress tracking');
    }

    const existing = await this.getUserAchievement(
      request.userId,
      request.achievementId
    );

    const now = new Date();
    const shouldUnlock = request.progress >= achievement.maxProgress;

    if (existing) {
      if (existing.unlocked) {
        return existing;
      }

      const [result] = await db
        .update(userAchievements)
        .set({
          progress: request.progress,
          unlocked: shouldUnlock,
          unlockedAt: shouldUnlock ? now : undefined,
          updatedAt: now,
        })
        .where(eq(userAchievements.id, existing.id))
        .returning();

      const userAchievement = this.mapUserAchievement(result);

      if (shouldUnlock) {
        this.emitUnlockEvent(request.userId, achievement, userAchievement);
      } else {
        this.emitProgressEvent(request.userId, achievement, userAchievement);
      }

      return userAchievement;
    }

    const id = randomUUID();
    const [result] = await db
      .insert(userAchievements)
      .values({
        id,
        userId: request.userId,
        achievementId: request.achievementId,
        gameId: achievement.gameId,
        unlocked: shouldUnlock,
        unlockedAt: shouldUnlock ? now : undefined,
        progress: request.progress,
        notified: false,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    const userAchievement = this.mapUserAchievement(result);

    if (shouldUnlock) {
      this.emitUnlockEvent(request.userId, achievement, userAchievement);
    } else {
      this.emitProgressEvent(request.userId, achievement, userAchievement);
    }

    return userAchievement;
  }

  async getUserAchievement(
    userId: string,
    achievementId: string
  ): Promise<UserAchievement | null> {
    const [result] = await db
      .select()
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.userId, userId),
          eq(userAchievements.achievementId, achievementId)
        )
      )
      .limit(1);

    return result ? this.mapUserAchievement(result) : null;
  }

  async getUserGameAchievements(
    userId: string,
    gameId: string
  ): Promise<UserAchievement[]> {
    const results = await db
      .select()
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.userId, userId),
          eq(userAchievements.gameId, gameId)
        )
      );

    return results.map((r) => this.mapUserAchievement(r));
  }

  async getUserUnlockedAchievements(
    userId: string,
    gameId: string
  ): Promise<UserAchievement[]> {
    const results = await db
      .select()
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.userId, userId),
          eq(userAchievements.gameId, gameId),
          eq(userAchievements.unlocked, true)
        )
      );

    return results.map((r) => this.mapUserAchievement(r));
  }

  async getUserAchievementSummary(
    userId: string,
    gameId: string
  ): Promise<UserAchievementSummary> {
    const achievements = await this.listActiveGameAchievements(gameId);
    const userAchievementsList = await this.getUserGameAchievements(userId, gameId);

    const totalCount = achievements.length;
    const totalPoints = achievements.reduce((sum, a) => sum + a.points, 0);

    const unlockedAchievements = userAchievementsList.filter((ua) => ua.unlocked);
    const unlockedCount = unlockedAchievements.length;

    const earnedPoints = unlockedAchievements.reduce((sum, ua) => {
      const achievement = achievements.find((a) => a.id === ua.achievementId);
      return sum + (achievement?.points ?? 0);
    }, 0);

    const completionPercentage =
      totalCount > 0 ? Math.round((unlockedCount / totalCount) * 100) : 0;

    const unlockedDates = unlockedAchievements
      .map((ua) => ua.unlockedAt)
      .filter((d): d is Date => d !== undefined);

    const lastUnlockedAt =
      unlockedDates.length > 0
        ? new Date(Math.max(...unlockedDates.map((d) => d.getTime())))
        : undefined;

    return {
      userId,
      gameId,
      unlockedCount,
      totalCount,
      earnedPoints,
      totalPoints,
      completionPercentage,
      lastUnlockedAt,
    };
  }

  async getGameAchievementStats(gameId: string): Promise<AchievementStats> {
    const achievements = await this.listActiveGameAchievements(gameId);
    const totalAchievements = achievements.length;
    const totalPoints = achievements.reduce((sum, a) => sum + a.points, 0);

    const globalUnlockRates = new Map<string, number>();

    for (const achievement of achievements) {
      const rate = await this.getGlobalUnlockRate(achievement.id);
      globalUnlockRates.set(achievement.id, rate);
    }

    return {
      gameId,
      totalAchievements,
      totalPoints,
      globalUnlockRates,
    };
  }

  async getGlobalUnlockRate(achievementId: string): Promise<number> {
    const [totalResult] = await db
      .select({ count: count() })
      .from(userAchievements)
      .where(eq(userAchievements.achievementId, achievementId));

    const [unlockedResult] = await db
      .select({ count: count() })
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.achievementId, achievementId),
          eq(userAchievements.unlocked, true)
        )
      );

    const total = totalResult?.count ?? 0;
    const unlocked = unlockedResult?.count ?? 0;

    return total > 0 ? Math.round((unlocked / total) * 100) : 0;
  }

  async markAchievementNotified(userAchievementId: string): Promise<void> {
    await db
      .update(userAchievements)
      .set({ notified: true, updatedAt: new Date() })
      .where(eq(userAchievements.id, userAchievementId));
  }

  async getUnnotifiedAchievements(userId: string): Promise<UserAchievement[]> {
    const results = await db
      .select()
      .from(userAchievements)
      .where(
        and(
          eq(userAchievements.userId, userId),
          eq(userAchievements.unlocked, true),
          eq(userAchievements.notified, false)
        )
      );

    return results.map((r) => this.mapUserAchievement(r));
  }

  subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void {
    if (!this.eventSubscribers.has(userId)) {
      this.eventSubscribers.set(userId, new Set());
    }
    this.eventSubscribers.get(userId)!.add(callback);

    return () => {
      this.eventSubscribers.get(userId)?.delete(callback);
    };
  }

  private emitUnlockEvent(
    userId: string,
    achievement: Achievement,
    userAchievement: UserAchievement
  ): void {
    this.emitEvent({
      type: 'achievement_unlocked',
      userId,
      gameId: achievement.gameId,
      timestamp: new Date(),
      data: {
        achievementId: achievement.id,
        achievementName: achievement.name,
        points: achievement.points,
        rarity: achievement.rarity,
        userAchievementId: userAchievement.id,
      },
    });
  }

  private emitProgressEvent(
    userId: string,
    achievement: Achievement,
    userAchievement: UserAchievement
  ): void {
    this.emitEvent({
      type: 'achievement_progress',
      userId,
      gameId: achievement.gameId,
      timestamp: new Date(),
      data: {
        achievementId: achievement.id,
        achievementName: achievement.name,
        progress: userAchievement.progress,
        maxProgress: achievement.maxProgress,
      },
    });
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

  private mapAchievement(row: typeof gameAchievements.$inferSelect): Achievement {
    return {
      id: row.id,
      gameId: row.gameId,
      name: row.name,
      description: row.description,
      hiddenDescription: row.hiddenDescription ?? undefined,
      iconUrl: row.iconUrl ?? undefined,
      iconLockedUrl: row.iconLockedUrl ?? undefined,
      points: row.points,
      rarity: row.rarity as AchievementRarity,
      type: row.type as AchievementType,
      maxProgress: row.maxProgress ?? undefined,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapUserAchievement(
    row: typeof userAchievements.$inferSelect
  ): UserAchievement {
    return {
      id: row.id,
      usedId: row.userId,
      achievementId: row.achievementId,
      gameId: row.gameId,
      unlocked: row.unlocked,
      unlockedAt: row.unlockedAt ?? undefined,
      progress: row.progress ?? undefined,
      notified: row.notified,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
