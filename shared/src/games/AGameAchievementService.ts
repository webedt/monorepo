/**
 * Abstract Game Achievement Service
 * Defines the interface for achievement management
 */

import type { Achievement } from './types.js';
import type { AchievementStats } from './types.js';
import type { CreateAchievementRequest } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { UnlockAchievementRequest } from './types.js';
import type { UpdateAchievementProgressRequest } from './types.js';
import type { UserAchievement } from './types.js';
import type { UserAchievementSummary } from './types.js';

export abstract class AGameAchievementService {
  abstract createAchievement(
    request: CreateAchievementRequest
  ): Promise<Achievement>;

  abstract getAchievement(
    achievementId: string
  ): Promise<Achievement | null>;

  abstract listGameAchievements(
    gameId: string
  ): Promise<Achievement[]>;

  abstract listActiveGameAchievements(
    gameId: string
  ): Promise<Achievement[]>;

  abstract updateAchievement(
    achievementId: string,
    updates: Partial<CreateAchievementRequest>
  ): Promise<Achievement>;

  abstract deactivateAchievement(
    achievementId: string
  ): Promise<void>;

  abstract deleteAchievement(
    achievementId: string
  ): Promise<void>;

  abstract unlockAchievement(
    request: UnlockAchievementRequest
  ): Promise<UserAchievement>;

  abstract updateAchievementProgress(
    request: UpdateAchievementProgressRequest
  ): Promise<UserAchievement>;

  abstract getUserAchievement(
    userId: string,
    achievementId: string
  ): Promise<UserAchievement | null>;

  abstract getUserGameAchievements(
    userId: string,
    gameId: string
  ): Promise<UserAchievement[]>;

  abstract getUserUnlockedAchievements(
    userId: string,
    gameId: string
  ): Promise<UserAchievement[]>;

  abstract getUserAchievementSummary(
    userId: string,
    gameId: string
  ): Promise<UserAchievementSummary>;

  abstract getGameAchievementStats(
    gameId: string
  ): Promise<AchievementStats>;

  abstract getGlobalUnlockRate(
    achievementId: string
  ): Promise<number>;

  abstract markAchievementNotified(
    userAchievementId: string
  ): Promise<void>;

  abstract getUnnotifiedAchievements(
    userId: string
  ): Promise<UserAchievement[]>;

  abstract subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void;
}
