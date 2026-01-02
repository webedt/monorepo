/**
 * Game/Store Entity Loader
 *
 * Provides batch loading capabilities for games and store items, preventing N+1
 * query problems when fetching game information across multiple operations.
 */

import { inArray, eq, and, sql } from 'drizzle-orm';
import { db, games, userLibrary, wishlists } from '../index.js';
import { DataLoader, createResultMap, groupBy } from '../dataLoader.js';

import type { Game } from '../schema.js';
import type { DataLoaderOptions } from '../dataLoader.js';

/**
 * Game summary info (lightweight version for lists)
 */
export interface GameSummary {
  id: string;
  title: string;
  shortDescription: string | null;
  price: number;
  currency: string;
  coverImage: string | null;
  developer: string | null;
  genres: string[] | null;
  tags: string[] | null;
  averageScore: number | null;
  reviewCount: number;
  downloadCount: number;
  featured: boolean;
  status: string;
  releaseDate: Date | null;
}

/**
 * User's ownership status for a game
 */
export interface GameOwnership {
  gameId: string;
  owned: boolean;
  wishlisted: boolean;
  acquiredAt: Date | null;
  favorite: boolean;
}

/**
 * Create a DataLoader for batch loading games by ID
 *
 * @example
 * const gameLoader = createGameLoader();
 * const [game1, game2] = await Promise.all([
 *   gameLoader.load('game-id-1'),
 *   gameLoader.load('game-id-2'),
 * ]);
 */
export function createGameLoader(options?: DataLoaderOptions): DataLoader<string, Game> {
  return new DataLoader<string, Game>(
    async (gameIds: string[]) => {
      const results = await db
        .select()
        .from(games)
        .where(inArray(games.id, gameIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading published games by ID
 * Filters out draft and archived games
 */
export function createPublishedGameLoader(options?: DataLoaderOptions): DataLoader<string, Game> {
  return new DataLoader<string, Game>(
    async (gameIds: string[]) => {
      const results = await db
        .select()
        .from(games)
        .where(
          and(
            inArray(games.id, gameIds),
            eq(games.status, 'published')
          )
        );

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading game summaries
 * Lightweight version for list displays
 */
export function createGameSummaryLoader(options?: DataLoaderOptions): DataLoader<string, GameSummary> {
  return new DataLoader<string, GameSummary>(
    async (gameIds: string[]) => {
      const results = await db
        .select({
          id: games.id,
          title: games.title,
          shortDescription: games.shortDescription,
          price: games.price,
          currency: games.currency,
          coverImage: games.coverImage,
          developer: games.developer,
          genres: games.genres,
          tags: games.tags,
          averageScore: games.averageScore,
          reviewCount: games.reviewCount,
          downloadCount: games.downloadCount,
          featured: games.featured,
          status: games.status,
          releaseDate: games.releaseDate,
        })
        .from(games)
        .where(inArray(games.id, gameIds));

      return createResultMap(results, 'id');
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading user's ownership status for games
 * Returns ownership info including owned status, wishlist status, and favorite
 *
 * @example
 * const ownershipLoader = createGameOwnershipLoader('user-123');
 * const [ownership1, ownership2] = await Promise.all([
 *   ownershipLoader.load('game-1'),
 *   ownershipLoader.load('game-2'),
 * ]);
 * // ownership1.owned, ownership1.wishlisted, etc.
 */
export function createGameOwnershipLoader(
  userId: string,
  options?: DataLoaderOptions
): DataLoader<string, GameOwnership> {
  return new DataLoader<string, GameOwnership>(
    async (gameIds: string[]) => {
      // Batch fetch library entries
      const libraryItems = await db
        .select({
          gameId: userLibrary.gameId,
          acquiredAt: userLibrary.acquiredAt,
          favorite: userLibrary.favorite,
        })
        .from(userLibrary)
        .where(
          and(
            eq(userLibrary.userId, userId),
            inArray(userLibrary.gameId, gameIds)
          )
        );

      // Batch fetch wishlist entries
      const wishlistItems = await db
        .select({
          gameId: wishlists.gameId,
        })
        .from(wishlists)
        .where(
          and(
            eq(wishlists.userId, userId),
            inArray(wishlists.gameId, gameIds)
          )
        );

      // Build lookup maps
      const libraryMap = new Map(libraryItems.map(item => [item.gameId, item]));
      const wishlistSet = new Set(wishlistItems.map(item => item.gameId));

      // Build result map
      const map = new Map<string, GameOwnership>();
      for (const gameId of gameIds) {
        const libraryItem = libraryMap.get(gameId);
        map.set(gameId, {
          gameId,
          owned: !!libraryItem,
          wishlisted: wishlistSet.has(gameId),
          acquiredAt: libraryItem?.acquiredAt ?? null,
          favorite: libraryItem?.favorite ?? false,
        });
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading games by user's library
 * Returns all games owned by a user
 */
export function createUserLibraryGamesLoader(options?: DataLoaderOptions): DataLoader<string, Game[]> {
  return new DataLoader<string, Game[]>(
    async (userIds: string[]) => {
      const libraryItems = await db
        .select({
          userId: userLibrary.userId,
          game: games,
        })
        .from(userLibrary)
        .innerJoin(games, eq(userLibrary.gameId, games.id))
        .where(inArray(userLibrary.userId, userIds));

      // Group by userId
      const map = new Map<string, Game[]>();
      for (const userId of userIds) {
        map.set(userId, []);
      }
      for (const item of libraryItems) {
        const list = map.get(item.userId);
        if (list) {
          list.push(item.game);
        }
      }
      return map;
    },
    options
  );
}

/**
 * Create a DataLoader for batch loading user's wishlist games
 */
export function createUserWishlistGamesLoader(options?: DataLoaderOptions): DataLoader<string, Game[]> {
  return new DataLoader<string, Game[]>(
    async (userIds: string[]) => {
      const wishlistItems = await db
        .select({
          userId: wishlists.userId,
          game: games,
        })
        .from(wishlists)
        .innerJoin(games, eq(wishlists.gameId, games.id))
        .where(inArray(wishlists.userId, userIds));

      // Group by userId
      const map = new Map<string, Game[]>();
      for (const userId of userIds) {
        map.set(userId, []);
      }
      for (const item of wishlistItems) {
        const list = map.get(item.userId);
        if (list) {
          list.push(item.game);
        }
      }
      return map;
    },
    options
  );
}
