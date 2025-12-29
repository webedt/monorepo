/**
 * Store Routes
 * Handles game store browsing, searching, and details
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, wishlists, eq, and, desc } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendInternalError,
} from '@webedt/shared';

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

    sendSuccess(res, { games: featuredGames });
  } catch (error) {
    logger.error('Get featured games error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to fetch featured games');
  }
});

// Get newly released games (released within the last 30 days)
router.get('/new', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);
    const daysBack = Math.min(parseInt(req.query.days as string) || 30, 90);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Fetch all published games, then filter by release date
    const allGames = await db
      .select()
      .from(games)
      .where(eq(games.status, 'published'));

    // Filter to games released within the specified period
    const newGames = allGames
      .filter((g) => {
        if (!g.releaseDate) return false;
        const releaseDate = new Date(g.releaseDate);
        return releaseDate >= cutoffDate;
      })
      .sort((a, b) => {
        const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return dateB - dateA; // Most recent first
      })
      .slice(0, limit);

    sendSuccess(res, { games: newGames });
  } catch (error) {
    logger.error('Get new games error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to fetch new games');
  }
});

// Get store highlights (featured + new items combined)
router.get('/highlights', async (req: Request, res: Response) => {
  try {
    const featuredLimit = Math.min(parseInt(req.query.featuredLimit as string) || 6, 20);
    const newLimit = Math.min(parseInt(req.query.newLimit as string) || 6, 20);
    const daysBack = Math.min(parseInt(req.query.days as string) || 30, 90);

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // Fetch all published games
    const allGames = await db
      .select()
      .from(games)
      .where(eq(games.status, 'published'));

    // Get featured games
    const featuredGames = allGames
      .filter((g) => g.featured)
      .sort((a, b) => {
        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, featuredLimit);

    // Get featured game IDs to exclude from new releases
    const featuredIds = new Set(featuredGames.map((g) => g.id));

    // Get new releases (excluding featured games to avoid duplicates)
    const newGames = allGames
      .filter((g) => {
        if (featuredIds.has(g.id)) return false;
        if (!g.releaseDate) return false;
        const releaseDate = new Date(g.releaseDate);
        return releaseDate >= cutoffDate;
      })
      .sort((a, b) => {
        const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
        const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
        return dateB - dateA;
      })
      .slice(0, newLimit);

    sendSuccess(res, {
      featured: featuredGames,
      new: newGames,
      hasHighlights: featuredGames.length > 0 || newGames.length > 0,
    });
  } catch (error) {
    logger.error('Get store highlights error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to fetch store highlights');
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

    // Build query - start with published games only
    let baseQuery = db
      .select()
      .from(games)
      .where(eq(games.status, 'published'));

    // Fetch all published games first, then filter in memory
    // (Drizzle doesn't easily support JSON array contains)
    let allGames = await baseQuery;

    // Apply filters
    if (query) {
      const searchTerm = (query as string).toLowerCase();
      allGames = allGames.filter(
        (g) =>
          g.title.toLowerCase().includes(searchTerm) ||
          g.description?.toLowerCase().includes(searchTerm) ||
          g.developer?.toLowerCase().includes(searchTerm) ||
          g.publisher?.toLowerCase().includes(searchTerm)
      );
    }

    if (genre) {
      const genreFilter = (genre as string).toLowerCase();
      allGames = allGames.filter((g) =>
        g.genres?.some((gen) => gen.toLowerCase() === genreFilter)
      );
    }

    if (tag) {
      const tagFilter = (tag as string).toLowerCase();
      allGames = allGames.filter((g) =>
        g.tags?.some((t) => t.toLowerCase() === tagFilter)
      );
    }

    if (free === 'true') {
      allGames = allGames.filter((g) => g.price === 0);
    } else {
      if (minPrice) {
        const min = parseInt(minPrice as string);
        allGames = allGames.filter((g) => g.price >= min);
      }
      if (maxPrice) {
        const max = parseInt(maxPrice as string);
        allGames = allGames.filter((g) => g.price <= max);
      }
    }

    // Sort
    const sortOrder = order === 'asc' ? 1 : -1;
    allGames.sort((a, b) => {
      switch (sort) {
        case 'title':
          return sortOrder * a.title.localeCompare(b.title);
        case 'price':
          return sortOrder * (a.price - b.price);
        case 'rating':
          return sortOrder * ((a.averageScore || 0) - (b.averageScore || 0));
        case 'downloads':
          return sortOrder * (a.downloadCount - b.downloadCount);
        case 'releaseDate':
        default:
          const dateA = a.releaseDate ? new Date(a.releaseDate).getTime() : 0;
          const dateB = b.releaseDate ? new Date(b.releaseDate).getTime() : 0;
          return sortOrder * (dateA - dateB);
      }
    });

    // Paginate
    const total = allGames.length;
    const paginatedGames = allGames.slice(offset, offset + limit);

    sendSuccess(res, {
      games: paginatedGames,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Browse games error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to browse games');
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
      sendNotFound(res, 'Game not found');
      return;
    }

    // Don't show unpublished games
    if (game.status !== 'published') {
      sendNotFound(res, 'Game not found');
      return;
    }

    sendSuccess(res, { game });
  } catch (error) {
    logger.error('Get game details error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to fetch game details');
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

    sendSuccess(res, { owned: !!libraryItem });
  } catch (error) {
    logger.error('Check game ownership error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to check ownership');
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

    sendSuccess(res, { genres });
  } catch (error) {
    logger.error('Get genres error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to fetch genres');
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

    sendSuccess(res, { tags });
  } catch (error) {
    logger.error('Get tags error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to fetch tags');
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
      sendNotFound(res, 'Game not found');
      return;
    }

    // Check if already in wishlist
    const [existing] = await db
      .select()
      .from(wishlists)
      .where(and(eq(wishlists.userId, authReq.user!.id), eq(wishlists.gameId, gameId)))
      .limit(1);

    if (existing) {
      sendError(res, 'Game already in wishlist', 400);
      return;
    }

    // Check if already owned
    const [owned] = await db
      .select()
      .from(userLibrary)
      .where(and(eq(userLibrary.userId, authReq.user!.id), eq(userLibrary.gameId, gameId)))
      .limit(1);

    if (owned) {
      sendError(res, 'Game already in library', 400);
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

    sendSuccess(res, { wishlistItem });
  } catch (error) {
    logger.error('Add to wishlist error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to add to wishlist');
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

    sendSuccess(res, { message: 'Removed from wishlist' });
  } catch (error) {
    logger.error('Remove from wishlist error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to remove from wishlist');
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

    sendSuccess(res, {
      items: wishlistItems.map((item) => ({
        ...item.wishlistItem,
        game: item.game,
      })),
      total: wishlistItems.length,
    });
  } catch (error) {
    logger.error('Get wishlist error', error as Error, { component: 'Store' });
    sendInternalError(res, 'Failed to fetch wishlist');
  }
});

export default router;
