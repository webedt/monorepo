/**
 * Game Achievement Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Game Achievement Service.
 * The service manages game achievements, tracks player progress, and handles
 * achievement unlocking with real-time notifications.
 *
 * @see AGameAchievementService for the abstract base class
 * @see GameAchievementService for the implementation
 */

import type { Achievement } from './types.js';
import type { AchievementStats } from './types.js';
import type { CreateAchievementRequest } from './types.js';
import type { GamePlatformEventCallback } from './types.js';
import type { UnlockAchievementRequest } from './types.js';
import type { UpdateAchievementProgressRequest } from './types.js';
import type { UserAchievement } from './types.js';
import type { UserAchievementSummary } from './types.js';

export type { Achievement } from './types.js';
export type { AchievementStats } from './types.js';
export type { CreateAchievementRequest } from './types.js';
export type { GamePlatformEventCallback } from './types.js';
export type { UnlockAchievementRequest } from './types.js';
export type { UpdateAchievementProgressRequest } from './types.js';
export type { UserAchievement } from './types.js';
export type { UserAchievementSummary } from './types.js';

/**
 * Interface for Game Achievement Service with full documentation.
 *
 * The Game Achievement Service provides comprehensive achievement management
 * for games on the platform. It handles achievement definition, player progress
 * tracking, unlocking, and real-time event notifications.
 *
 * ## Features
 *
 * - **Achievement Definition**: Create and manage achievements per game
 * - **Progress Tracking**: Incremental progress for complex achievements
 * - **Instant Unlock**: Direct unlock for binary achievements
 * - **Global Stats**: Track unlock rates across all players
 * - **Real-time Events**: Subscribe to achievement unlock notifications
 * - **Notification Queue**: Track unread achievement notifications
 *
 * ## Achievement Types
 *
 * | Type | Description | Progress Model |
 * |------|-------------|----------------|
 * | Binary | Complete or not | No progress, direct unlock |
 * | Progressive | Incremental progress | 0-100% with milestones |
 * | Hidden | Secret achievements | Revealed on unlock |
 * | Rare | Low unlock rate | Special display treatment |
 *
 * ## Event-Driven Notifications
 *
 * ```typescript
 * // Subscribe to achievement events
 * const unsubscribe = achievementService.subscribeToEvents(userId, (event) => {
 *   if (event.type === 'achievement_unlocked') {
 *     showAchievementPopup(event.achievement);
 *   }
 * });
 *
 * // Cleanup on disconnect
 * socket.on('disconnect', unsubscribe);
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * // Create an achievement
 * const achievement = await achievementService.createAchievement({
 *   gameId: 'game-123',
 *   name: 'First Blood',
 *   description: 'Win your first battle',
 *   iconUrl: 'https://cdn.example.com/achievements/first-blood.png',
 *   points: 10,
 *   isHidden: false,
 * });
 *
 * // Unlock for a player
 * await achievementService.unlockAchievement({
 *   userId: 'user-456',
 *   achievementId: achievement.id,
 * });
 * ```
 */
export interface IGameAchievementServiceDocumentation {
  /**
   * Create a new achievement for a game.
   *
   * @param request - Achievement creation parameters
   * @param request.gameId - The game this achievement belongs to
   * @param request.name - Display name of the achievement
   * @param request.description - Description of how to unlock
   * @param request.iconUrl - URL to achievement icon
   * @param request.points - Point value (gamerscore equivalent)
   * @param request.isHidden - Whether to hide until unlocked
   * @param request.maxProgress - For progressive achievements, the target value
   * @returns Created achievement with generated ID
   *
   * @example
   * ```typescript
   * // Binary achievement
   * const achievement = await achievementService.createAchievement({
   *   gameId: 'game-123',
   *   name: 'Speed Demon',
   *   description: 'Complete a level in under 60 seconds',
   *   iconUrl: 'https://cdn.example.com/speed-demon.png',
   *   points: 25,
   *   isHidden: false,
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Progressive achievement
   * const collector = await achievementService.createAchievement({
   *   gameId: 'game-123',
   *   name: 'Collector',
   *   description: 'Collect 100 coins',
   *   iconUrl: 'https://cdn.example.com/collector.png',
   *   points: 50,
   *   isHidden: false,
   *   maxProgress: 100,
   * });
   * ```
   */
  createAchievement(request: CreateAchievementRequest): Promise<Achievement>;

  /**
   * Get an achievement by ID.
   *
   * @param achievementId - The achievement ID
   * @returns Achievement if found, null otherwise
   *
   * @example
   * ```typescript
   * const achievement = await achievementService.getAchievement('ach-123');
   * if (achievement) {
   *   console.log(`${achievement.name}: ${achievement.description}`);
   * }
   * ```
   */
  getAchievement(achievementId: string): Promise<Achievement | null>;

  /**
   * List all achievements for a game.
   *
   * Includes both active and inactive achievements.
   *
   * @param gameId - The game ID
   * @returns All achievements for the game
   *
   * @example
   * ```typescript
   * const achievements = await achievementService.listGameAchievements('game-123');
   * console.log(`Game has ${achievements.length} total achievements`);
   * ```
   */
  listGameAchievements(gameId: string): Promise<Achievement[]>;

  /**
   * List only active achievements for a game.
   *
   * Excludes deactivated achievements from the list.
   *
   * @param gameId - The game ID
   * @returns Active achievements only
   *
   * @example
   * ```typescript
   * // Show in achievement browser
   * const achievements = await achievementService.listActiveGameAchievements('game-123');
   * renderAchievementList(achievements);
   * ```
   */
  listActiveGameAchievements(gameId: string): Promise<Achievement[]>;

  /**
   * Update an existing achievement.
   *
   * @param achievementId - The achievement ID to update
   * @param updates - Partial updates to apply
   * @returns Updated achievement
   *
   * @example
   * ```typescript
   * const updated = await achievementService.updateAchievement('ach-123', {
   *   description: 'Win 10 battles without dying',
   *   points: 100,
   * });
   * ```
   */
  updateAchievement(
    achievementId: string,
    updates: Partial<CreateAchievementRequest>
  ): Promise<Achievement>;

  /**
   * Deactivate an achievement.
   *
   * Deactivated achievements are hidden from the achievement browser
   * but preserved for players who already earned them.
   *
   * @param achievementId - The achievement ID to deactivate
   *
   * @example
   * ```typescript
   * // Hide legacy achievement
   * await achievementService.deactivateAchievement('ach-old');
   * ```
   */
  deactivateAchievement(achievementId: string): Promise<void>;

  /**
   * Permanently delete an achievement.
   *
   * Warning: This removes the achievement from all player profiles.
   *
   * @param achievementId - The achievement ID to delete
   *
   * @example
   * ```typescript
   * // Only for development/testing
   * await achievementService.deleteAchievement('ach-test');
   * ```
   */
  deleteAchievement(achievementId: string): Promise<void>;

  /**
   * Unlock an achievement for a player.
   *
   * Immediately unlocks the achievement and emits a notification event.
   *
   * @param request - Unlock request parameters
   * @param request.userId - The player's user ID
   * @param request.achievementId - The achievement to unlock
   * @returns The user's achievement record
   *
   * @example
   * ```typescript
   * // Player completed the requirement
   * const userAchievement = await achievementService.unlockAchievement({
   *   userId: 'user-456',
   *   achievementId: 'ach-first-blood',
   * });
   *
   * console.log(`Unlocked at: ${userAchievement.unlockedAt}`);
   * ```
   */
  unlockAchievement(request: UnlockAchievementRequest): Promise<UserAchievement>;

  /**
   * Update progress on a progressive achievement.
   *
   * Automatically unlocks if progress reaches maxProgress.
   *
   * @param request - Progress update parameters
   * @param request.userId - The player's user ID
   * @param request.achievementId - The achievement to update
   * @param request.progress - New progress value or delta
   * @param request.isIncrement - If true, adds to current progress
   * @returns Updated user achievement record
   *
   * @example
   * ```typescript
   * // Increment progress
   * await achievementService.updateAchievementProgress({
   *   userId: 'user-456',
   *   achievementId: 'ach-collector',
   *   progress: 5, // Collected 5 more coins
   *   isIncrement: true,
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Set absolute progress
   * await achievementService.updateAchievementProgress({
   *   userId: 'user-456',
   *   achievementId: 'ach-playtime',
   *   progress: 120, // 120 minutes played
   *   isIncrement: false,
   * });
   * ```
   */
  updateAchievementProgress(
    request: UpdateAchievementProgressRequest
  ): Promise<UserAchievement>;

  /**
   * Get a player's record for a specific achievement.
   *
   * @param userId - The player's user ID
   * @param achievementId - The achievement ID
   * @returns User achievement if tracked, null if never started
   *
   * @example
   * ```typescript
   * const userAch = await achievementService.getUserAchievement(userId, achievementId);
   * if (userAch?.unlockedAt) {
   *   console.log('Already unlocked!');
   * } else if (userAch) {
   *   console.log(`Progress: ${userAch.progress}/${achievement.maxProgress}`);
   * }
   * ```
   */
  getUserAchievement(
    userId: string,
    achievementId: string
  ): Promise<UserAchievement | null>;

  /**
   * Get all achievement records for a player in a game.
   *
   * Includes unlocked and in-progress achievements.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @returns All user achievement records for the game
   *
   * @example
   * ```typescript
   * const userAchievements = await achievementService.getUserGameAchievements(userId, gameId);
   * console.log(`Player has progress on ${userAchievements.length} achievements`);
   * ```
   */
  getUserGameAchievements(userId: string, gameId: string): Promise<UserAchievement[]>;

  /**
   * Get only unlocked achievements for a player in a game.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @returns Only unlocked achievements
   *
   * @example
   * ```typescript
   * const unlocked = await achievementService.getUserUnlockedAchievements(userId, gameId);
   * const points = unlocked.reduce((sum, ua) => sum + ua.achievement.points, 0);
   * console.log(`Earned ${points} points`);
   * ```
   */
  getUserUnlockedAchievements(userId: string, gameId: string): Promise<UserAchievement[]>;

  /**
   * Get achievement summary for a player in a game.
   *
   * Provides quick stats without loading all achievement records.
   *
   * @param userId - The player's user ID
   * @param gameId - The game ID
   * @returns Summary with counts and completion percentage
   *
   * @example
   * ```typescript
   * const summary = await achievementService.getUserAchievementSummary(userId, gameId);
   * console.log(`${summary.unlockedCount}/${summary.totalCount} (${summary.completionPercent}%)`);
   * console.log(`Total points: ${summary.earnedPoints}/${summary.totalPoints}`);
   * ```
   */
  getUserAchievementSummary(userId: string, gameId: string): Promise<UserAchievementSummary>;

  /**
   * Get aggregate achievement statistics for a game.
   *
   * Provides insights into achievement difficulty and popularity.
   *
   * @param gameId - The game ID
   * @returns Game-wide achievement statistics
   *
   * @example
   * ```typescript
   * const stats = await achievementService.getGameAchievementStats(gameId);
   * console.log(`Average completion: ${stats.averageCompletionRate}%`);
   * console.log(`Rarest achievement: ${stats.rarestAchievement.name}`);
   * ```
   */
  getGameAchievementStats(gameId: string): Promise<AchievementStats>;

  /**
   * Get the global unlock rate for an achievement.
   *
   * Returns percentage of players who have unlocked this achievement.
   *
   * @param achievementId - The achievement ID
   * @returns Unlock rate as percentage (0-100)
   *
   * @example
   * ```typescript
   * const unlockRate = await achievementService.getGlobalUnlockRate(achievementId);
   * if (unlockRate < 5) {
   *   console.log('Ultra Rare achievement!');
   * }
   * ```
   */
  getGlobalUnlockRate(achievementId: string): Promise<number>;

  /**
   * Mark an achievement notification as read.
   *
   * Call after displaying the unlock notification to the player.
   *
   * @param userAchievementId - The user achievement record ID
   *
   * @example
   * ```typescript
   * // After showing popup
   * await achievementService.markAchievementNotified(userAchievement.id);
   * ```
   */
  markAchievementNotified(userAchievementId: string): Promise<void>;

  /**
   * Get unread achievement notifications for a player.
   *
   * Returns achievements unlocked since last notification.
   *
   * @param userId - The player's user ID
   * @returns Unread achievement notifications
   *
   * @example
   * ```typescript
   * // On login, check for unread achievements
   * const unread = await achievementService.getUnnotifiedAchievements(userId);
   * for (const userAch of unread) {
   *   showAchievementPopup(userAch);
   *   await achievementService.markAchievementNotified(userAch.id);
   * }
   * ```
   */
  getUnnotifiedAchievements(userId: string): Promise<UserAchievement[]>;

  /**
   * Subscribe to real-time achievement events for a player.
   *
   * Returns an unsubscribe function to clean up the subscription.
   *
   * @param userId - The player's user ID
   * @param callback - Function to call on each event
   * @returns Unsubscribe function
   *
   * @example
   * ```typescript
   * const unsubscribe = achievementService.subscribeToEvents(userId, (event) => {
   *   switch (event.type) {
   *     case 'achievement_unlocked':
   *       showUnlockPopup(event.achievement);
   *       break;
   *     case 'progress_updated':
   *       updateProgressUI(event.achievement, event.progress);
   *       break;
   *   }
   * });
   *
   * // On disconnect
   * unsubscribe();
   * ```
   */
  subscribeToEvents(
    userId: string,
    callback: GamePlatformEventCallback
  ): () => void;
}
