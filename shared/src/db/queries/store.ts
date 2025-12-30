/**
 * Store Query Helpers
 *
 * Composable query utilities for games, wishlists, and user library operations.
 * Reduces duplication in store routes.
 */

import { eq, and, desc, sql, inArray } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { db, games, userLibrary, wishlists } from '../index.js';
import type { Game, UserLibraryItem, WishlistItem } from '../schema.js';
import {
  getPaginationParams,
  buildPaginationMeta,
  type PaginationOptions,
  type PaginatedResult,
} from '../queryHelpers.js';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Game filter options
 */
export interface GameFilterOptions {
  /** Only show published games (default: true) */
  publishedOnly?: boolean;
  /** Only show featured games */
  featured?: boolean;
  /** Filter by genre */
  genre?: string;
  /** Filter by tag */
  tag?: string;
  /** Filter by price range */
  priceRange?: {
    min?: number;
    max?: number;
  };
  /** Only show free games */
  freeOnly?: boolean;
  /** Search query (matches title, description, developer, publisher) */
  search?: string;
}

/**
 * Game sort options
 */
export type GameSortField = 'releaseDate' | 'title' | 'price' | 'rating' | 'downloads' | 'updatedAt';

/**
 * Wishlist item with game details
 */
export interface WishlistWithGame extends WishlistItem {
  game: Game;
}

/**
 * Library item with game details
 */
export interface LibraryWithGame extends UserLibraryItem {
  game: Game;
}

// =============================================================================
// GAME QUERIES
// =============================================================================

/**
 * Build conditions for game queries
 */
export function buildGameConditions(options: GameFilterOptions = {}): SQL | undefined {
  const conditions: SQL[] = [];

  // Default to published only
  if (options.publishedOnly !== false) {
    conditions.push(eq(games.status, 'published'));
  }

  if (options.featured) {
    conditions.push(eq(games.featured, true));
  }

  if (options.freeOnly) {
    conditions.push(eq(games.price, 0));
  }

  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return and(...conditions);
}

/**
 * Find a game by ID
 */
export async function findGameById(
  id: string,
  options?: { publishedOnly?: boolean }
): Promise<Game | null> {
  const conditions: SQL[] = [eq(games.id, id)];

  if (options?.publishedOnly !== false) {
    conditions.push(eq(games.status, 'published'));
  }

  const [game] = await db
    .select()
    .from(games)
    .where(and(...conditions))
    .limit(1);

  return game ?? null;
}

/**
 * Find a published game by ID (common use case)
 */
export async function findPublishedGame(id: string): Promise<Game | null> {
  return findGameById(id, { publishedOnly: true });
}

/**
 * Get featured games
 */
export async function getFeaturedGames(limit: number = 10): Promise<Game[]> {
  return db
    .select()
    .from(games)
    .where(
      and(
        eq(games.featured, true),
        eq(games.status, 'published')
      )
    )
    .orderBy(desc(games.updatedAt))
    .limit(limit);
}

/**
 * Get all published games (for client-side filtering)
 */
export async function getAllPublishedGames(): Promise<Game[]> {
  return db
    .select()
    .from(games)
    .where(eq(games.status, 'published'));
}

/**
 * Get unique genres from published games
 */
export async function getUniqueGenres(): Promise<string[]> {
  const allGames = await db
    .select({ genres: games.genres })
    .from(games)
    .where(eq(games.status, 'published'));

  const genreSet = new Set<string>();
  for (const game of allGames) {
    if (game.genres) {
      for (const genre of game.genres) {
        genreSet.add(genre);
      }
    }
  }

  return Array.from(genreSet).sort();
}

/**
 * Get unique tags from published games
 */
export async function getUniqueTags(): Promise<string[]> {
  const allGames = await db
    .select({ tags: games.tags })
    .from(games)
    .where(eq(games.status, 'published'));

  const tagSet = new Set<string>();
  for (const game of allGames) {
    if (game.tags) {
      for (const tag of game.tags) {
        tagSet.add(tag);
      }
    }
  }

  return Array.from(tagSet).sort();
}

// =============================================================================
// USER LIBRARY QUERIES
// =============================================================================

/**
 * Check if a user owns a game
 */
export async function userOwnsGame(userId: string, gameId: string): Promise<boolean> {
  const [item] = await db
    .select({ id: userLibrary.id })
    .from(userLibrary)
    .where(
      and(
        eq(userLibrary.userId, userId),
        eq(userLibrary.gameId, gameId)
      )
    )
    .limit(1);

  return !!item;
}

/**
 * Get user's library item for a game
 */
export async function getUserLibraryItem(
  userId: string,
  gameId: string
): Promise<UserLibraryItem | null> {
  const [item] = await db
    .select()
    .from(userLibrary)
    .where(
      and(
        eq(userLibrary.userId, userId),
        eq(userLibrary.gameId, gameId)
      )
    )
    .limit(1);

  return item ?? null;
}

/**
 * Get user's entire library with game details
 */
export async function getUserLibrary(
  userId: string,
  options?: {
    hiddenOnly?: boolean;
    favoritesOnly?: boolean;
    pagination?: PaginationOptions;
  }
): Promise<PaginatedResult<LibraryWithGame>> {
  const { pagination, hiddenOnly, favoritesOnly } = options ?? {};
  const { limit, offset } = getPaginationParams(pagination);

  const conditions: SQL[] = [eq(userLibrary.userId, userId)];

  if (hiddenOnly) {
    conditions.push(eq(userLibrary.hidden, true));
  }

  if (favoritesOnly) {
    conditions.push(eq(userLibrary.favorite, true));
  }

  const whereClause = and(...conditions);

  const items = await db
    .select({
      libraryItem: userLibrary,
      game: games,
    })
    .from(userLibrary)
    .innerJoin(games, eq(userLibrary.gameId, games.id))
    .where(whereClause)
    .orderBy(desc(userLibrary.acquiredAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userLibrary)
    .where(whereClause);

  const total = countResult?.count ?? 0;

  const data = items.map(item => ({
    ...item.libraryItem,
    game: item.game,
  }));

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * Get IDs of games user owns
 */
export async function getUserOwnedGameIds(userId: string): Promise<Set<string>> {
  const items = await db
    .select({ gameId: userLibrary.gameId })
    .from(userLibrary)
    .where(eq(userLibrary.userId, userId));

  return new Set(items.map(i => i.gameId));
}

// =============================================================================
// WISHLIST QUERIES
// =============================================================================

/**
 * Check if a game is in user's wishlist
 */
export async function isGameInWishlist(userId: string, gameId: string): Promise<boolean> {
  const [item] = await db
    .select({ id: wishlists.id })
    .from(wishlists)
    .where(
      and(
        eq(wishlists.userId, userId),
        eq(wishlists.gameId, gameId)
      )
    )
    .limit(1);

  return !!item;
}

/**
 * Get user's wishlist with game details
 */
export async function getUserWishlist(
  userId: string,
  pagination?: PaginationOptions
): Promise<PaginatedResult<WishlistWithGame>> {
  const { limit, offset } = getPaginationParams(pagination);

  const items = await db
    .select({
      wishlistItem: wishlists,
      game: games,
    })
    .from(wishlists)
    .innerJoin(games, eq(wishlists.gameId, games.id))
    .where(eq(wishlists.userId, userId))
    .orderBy(desc(wishlists.addedAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(wishlists)
    .where(eq(wishlists.userId, userId));

  const total = countResult?.count ?? 0;

  const data = items.map(item => ({
    ...item.wishlistItem,
    game: item.game,
  }));

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * Get IDs of games in user's wishlist
 */
export async function getUserWishlistGameIds(userId: string): Promise<Set<string>> {
  const items = await db
    .select({ gameId: wishlists.gameId })
    .from(wishlists)
    .where(eq(wishlists.userId, userId));

  return new Set(items.map(i => i.gameId));
}

// =============================================================================
// COMBINED CHECKS
// =============================================================================

/**
 * Check game status for a user (owned, wishlisted, available)
 */
export async function getGameStatusForUser(
  userId: string,
  gameId: string
): Promise<{
  owned: boolean;
  wishlisted: boolean;
  game: Game | null;
}> {
  const [game, owned, wishlisted] = await Promise.all([
    findPublishedGame(gameId),
    userOwnsGame(userId, gameId),
    isGameInWishlist(userId, gameId),
  ]);

  return { game, owned, wishlisted };
}

/**
 * Get game status for multiple games at once (batch operation)
 */
export async function getGamesStatusForUser(
  userId: string,
  gameIds: string[]
): Promise<Map<string, { owned: boolean; wishlisted: boolean }>> {
  if (gameIds.length === 0) return new Map();

  const [ownedIds, wishlistIds] = await Promise.all([
    getUserOwnedGameIds(userId),
    getUserWishlistGameIds(userId),
  ]);

  const result = new Map<string, { owned: boolean; wishlisted: boolean }>();

  for (const gameId of gameIds) {
    result.set(gameId, {
      owned: ownedIds.has(gameId),
      wishlisted: wishlistIds.has(gameId),
    });
  }

  return result;
}
