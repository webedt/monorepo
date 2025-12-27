/**
 * Store Routes
 * Handles game store browsing, searching, and details
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, wishlists, eq, and, desc, ilike, or, gte, lte, sql } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Get featured games for store front
router.get('/featured', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

    const featuredGames = await db
      .select()
      .from(games)
      .where(and(eq(games.featured, true), eq(games.status, 'published')))
      .orderBy(desc(games.updatedAt))
      .limit(limit);

    res.json({
      success: true,
      data: { games: featuredGames },
    });
  } catch (error) {
    logger.error('Get featured games error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch featured games' });
  }
});

// Search/browse games in the store
router.get('/browse', async (req: Request, res: Response) => {
  try {
    const {
      q: query,
      genre,
      tag,
      sort = 'releaseDate',
      order = 'desc',
      minPrice,
      maxPrice,
      free,
    } = req.query;

    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    // Build conditions array for database-level filtering
    const conditions = [eq(games.status, 'published')];

    // Text search at database level using ilike
    if (query) {
      const searchPattern = `%${query as string}%`;
      conditions.push(
        or(
          ilike(games.title, searchPattern),
          ilike(games.description, searchPattern),
          ilike(games.developer, searchPattern),
          ilike(games.publisher, searchPattern)
        )!
      );
    }

    // Price filtering at database level
    if (free === 'true') {
      conditions.push(eq(games.price, 0));
    } else {
      if (minPrice) {
        const min = parseInt(minPrice as string);
        if (!isNaN(min)) {
          conditions.push(gte(games.price, min));
        }
      }
      if (maxPrice) {
        const max = parseInt(maxPrice as string);
        if (!isNaN(max)) {
          conditions.push(lte(games.price, max));
        }
      }
    }

    // Genre/tag filtering using PostgreSQL JSON containment
    // These use raw SQL since Drizzle doesn't have native JSON array support
    if (genre) {
      const genreValue = (genre as string).toLowerCase();
      conditions.push(
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${games.genres}) AS g WHERE LOWER(g) = ${genreValue})`
      );
    }

    if (tag) {
      const tagValue = (tag as string).toLowerCase();
      conditions.push(
        sql`EXISTS (SELECT 1 FROM jsonb_array_elements_text(${games.tags}) AS t WHERE LOWER(t) = ${tagValue})`
      );
    }

    // Determine sort column and order
    let orderByClause;
    switch (sort) {
      case 'title':
        orderByClause = order === 'asc'
          ? sql`${games.title} ASC`
          : sql`${games.title} DESC`;
        break;
      case 'price':
        orderByClause = order === 'asc'
          ? sql`${games.price} ASC`
          : sql`${games.price} DESC`;
        break;
      case 'rating':
        orderByClause = order === 'asc'
          ? sql`COALESCE(${games.averageScore}, 0) ASC`
          : sql`COALESCE(${games.averageScore}, 0) DESC`;
        break;
      case 'downloads':
        orderByClause = order === 'asc'
          ? sql`${games.downloadCount} ASC`
          : sql`${games.downloadCount} DESC`;
        break;
      case 'releaseDate':
      default:
        orderByClause = order === 'asc'
          ? sql`COALESCE(${games.releaseDate}, '1970-01-01'::timestamp) ASC`
          : sql`COALESCE(${games.releaseDate}, '1970-01-01'::timestamp) DESC`;
        break;
    }

    // Execute query with all filters at database level
    const filteredGames = await db
      .select()
      .from(games)
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Get total count for pagination (separate query for efficiency)
    const countResult = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(games)
      .where(and(...conditions));

    const total = countResult[0]?.count ?? 0;

    res.json({
      success: true,
      data: {
        games: filteredGames,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    logger.error('Browse games error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to browse games' });
  }
});

// Get game details by ID
router.get('/games/:id', async (req: Request, res: Response) => {
  try {
    const gameId = req.params.id;

    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.id, gameId))
      .limit(1);

    if (!game) {
      res.status(404).json({ success: false, error: 'Game not found' });
      return;
    }

    // Don't show unpublished games
    if (game.status !== 'published') {
      res.status(404).json({ success: false, error: 'Game not found' });
      return;
    }

    res.json({
      success: true,
      data: { game },
    });
  } catch (error) {
    logger.error('Get game details error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch game details' });
  }
});

// Check if user owns a game
router.get('/games/:id/owned', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.id;

    const [libraryItem] = await db
      .select()
      .from(userLibrary)
      .where(and(eq(userLibrary.userId, authReq.user!.id), eq(userLibrary.gameId, gameId)))
      .limit(1);

    res.json({
      success: true,
      data: { owned: !!libraryItem },
    });
  } catch (error) {
    logger.error('Check game ownership error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to check ownership' });
  }
});

// Get available genres
router.get('/genres', async (req: Request, res: Response) => {
  try {
    const allGames = await db
      .select({ genres: games.genres })
      .from(games)
      .where(eq(games.status, 'published'));

    // Collect unique genres
    const genreSet = new Set<string>();
    for (const game of allGames) {
      if (game.genres) {
        for (const genre of game.genres) {
          genreSet.add(genre);
        }
      }
    }

    const genres = Array.from(genreSet).sort();

    res.json({
      success: true,
      data: { genres },
    });
  } catch (error) {
    logger.error('Get genres error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch genres' });
  }
});

// Get available tags
router.get('/tags', async (req: Request, res: Response) => {
  try {
    const allGames = await db
      .select({ tags: games.tags })
      .from(games)
      .where(eq(games.status, 'published'));

    // Collect unique tags
    const tagSet = new Set<string>();
    for (const game of allGames) {
      if (game.tags) {
        for (const tag of game.tags) {
          tagSet.add(tag);
        }
      }
    }

    const tags = Array.from(tagSet).sort();

    res.json({
      success: true,
      data: { tags },
    });
  } catch (error) {
    logger.error('Get tags error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch tags' });
  }
});

// Add to wishlist
router.post('/wishlist/:gameId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;

    // Verify game exists
    const [game] = await db
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.status, 'published')))
      .limit(1);

    if (!game) {
      res.status(404).json({ success: false, error: 'Game not found' });
      return;
    }

    // Check if already in wishlist
    const [existing] = await db
      .select()
      .from(wishlists)
      .where(and(eq(wishlists.userId, authReq.user!.id), eq(wishlists.gameId, gameId)))
      .limit(1);

    if (existing) {
      res.status(400).json({ success: false, error: 'Game already in wishlist' });
      return;
    }

    // Check if already owned
    const [owned] = await db
      .select()
      .from(userLibrary)
      .where(and(eq(userLibrary.userId, authReq.user!.id), eq(userLibrary.gameId, gameId)))
      .limit(1);

    if (owned) {
      res.status(400).json({ success: false, error: 'Game already in library' });
      return;
    }

    // Add to wishlist
    const [wishlistItem] = await db
      .insert(wishlists)
      .values({
        id: uuidv4(),
        userId: authReq.user!.id,
        gameId,
      })
      .returning();

    res.json({
      success: true,
      data: { wishlistItem },
    });
  } catch (error) {
    logger.error('Add to wishlist error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to add to wishlist' });
  }
});

// Remove from wishlist
router.delete('/wishlist/:gameId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;

    await db
      .delete(wishlists)
      .where(and(eq(wishlists.userId, authReq.user!.id), eq(wishlists.gameId, gameId)));

    res.json({
      success: true,
      data: { message: 'Removed from wishlist' },
    });
  } catch (error) {
    logger.error('Remove from wishlist error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to remove from wishlist' });
  }
});

// Get user's wishlist
router.get('/wishlist', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const wishlistItems = await db
      .select({
        wishlistItem: wishlists,
        game: games,
      })
      .from(wishlists)
      .innerJoin(games, eq(wishlists.gameId, games.id))
      .where(eq(wishlists.userId, authReq.user!.id))
      .orderBy(desc(wishlists.addedAt));

    res.json({
      success: true,
      data: {
        items: wishlistItems.map((item) => ({
          ...item.wishlistItem,
          game: item.game,
        })),
        total: wishlistItems.length,
      },
    });
  } catch (error) {
    logger.error('Get wishlist error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch wishlist' });
  }
});

export default router;
