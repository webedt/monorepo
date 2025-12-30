/**
 * Store Routes
 * Handles game store browsing, searching, and details
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     Game:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 *         developer:
 *           type: string
 *         publisher:
 *           type: string
 *         releaseDate:
 *           type: string
 *           format: date-time
 *         status:
 *           type: string
 *           enum: [draft, published, archived]
 *         featured:
 *           type: boolean
 *         genres:
 *           type: array
 *           items:
 *             type: string
 *         tags:
 *           type: array
 *           items:
 *             type: string
 *         averageScore:
 *           type: number
 *         downloadCount:
 *           type: number
 *     WishlistItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         userId:
 *           type: string
 *         gameId:
 *           type: string
 *         addedAt:
 *           type: string
 *           format: date-time
 */

import { Router, Request, Response } from 'express';
import {
  db,
  games,
  userLibrary,
  wishlists,
  eq,
  and,
  desc,
  parseOffsetPagination,
  buildLegacyPaginatedResponse,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

/**
 * @openapi
 * /api/store/featured:
 *   get:
 *     tags: [Store]
 *     summary: Get featured games
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Featured games list
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     games:
 *                       type: array
 *                       items:
 *                         $ref: '#/components/schemas/Game'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/store/new:
 *   get:
 *     tags: [Store]
 *     summary: Get newly released games
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *           maximum: 50
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *           maximum: 90
 *         description: Days back to check for releases
 *     responses:
 *       200:
 *         description: New releases list
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

    res.json({
      success: true,
      data: { games: newGames },
    });
  } catch (error) {
    logger.error('Get new games error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch new games' });
  }
});

/**
 * @openapi
 * /api/store/highlights:
 *   get:
 *     tags: [Store]
 *     summary: Get store highlights (featured + new releases)
 *     parameters:
 *       - in: query
 *         name: featuredLimit
 *         schema:
 *           type: integer
 *           default: 6
 *           maximum: 20
 *       - in: query
 *         name: newLimit
 *         schema:
 *           type: integer
 *           default: 6
 *           maximum: 20
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 30
 *           maximum: 90
 *     responses:
 *       200:
 *         description: Combined featured and new games
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

    res.json({
      success: true,
      data: {
        featured: featuredGames,
        new: newGames,
        hasHighlights: featuredGames.length > 0 || newGames.length > 0,
      },
    });
  } catch (error) {
    logger.error('Get store highlights error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch store highlights' });
  }
});

/**
 * @openapi
 * /api/store/browse:
 *   get:
 *     tags: [Store]
 *     summary: Browse and search games
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search query
 *       - in: query
 *         name: genre
 *         schema:
 *           type: string
 *       - in: query
 *         name: tag
 *         schema:
 *           type: string
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [releaseDate, title, price, rating, downloads]
 *           default: releaseDate
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: minPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: maxPrice
 *         schema:
 *           type: number
 *       - in: query
 *         name: free
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Paginated game list
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

    const pagination = parseOffsetPagination(req.query as Record<string, unknown>);

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
    const paginatedGames = allGames.slice(
      pagination.offset,
      pagination.offset + pagination.limit
    );

    res.json(buildLegacyPaginatedResponse(paginatedGames, total, pagination, 'games'));
  } catch (error) {
    logger.error('Browse games error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to browse games' });
  }
});

/**
 * @openapi
 * /api/store/games/{id}:
 *   get:
 *     tags: [Store]
 *     summary: Get game details
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     game:
 *                       $ref: '#/components/schemas/Game'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/store/games/{id}/owned:
 *   get:
 *     tags: [Store]
 *     summary: Check if user owns a game
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Ownership status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     owned:
 *                       type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/store/genres:
 *   get:
 *     tags: [Store]
 *     summary: Get available game genres
 *     responses:
 *       200:
 *         description: List of genres
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     genres:
 *                       type: array
 *                       items:
 *                         type: string
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/store/tags:
 *   get:
 *     tags: [Store]
 *     summary: Get available game tags
 *     responses:
 *       200:
 *         description: List of tags
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     tags:
 *                       type: array
 *                       items:
 *                         type: string
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/store/wishlist/{gameId}:
 *   post:
 *     tags: [Store, Wishlist]
 *     summary: Add game to wishlist
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game added to wishlist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     wishlistItem:
 *                       $ref: '#/components/schemas/WishlistItem'
 *       400:
 *         description: Already in wishlist or library
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/store/wishlist/{gameId}:
 *   delete:
 *     tags: [Store, Wishlist]
 *     summary: Remove game from wishlist
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game removed from wishlist
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/store/wishlist:
 *   get:
 *     tags: [Store, Wishlist]
 *     summary: Get user's wishlist
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: User's wishlist
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     items:
 *                       type: array
 *                       items:
 *                         allOf:
 *                           - $ref: '#/components/schemas/WishlistItem'
 *                           - type: object
 *                             properties:
 *                               game:
 *                                 $ref: '#/components/schemas/Game'
 *                     total:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get('/wishlist', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const pagination = parseOffsetPagination(req.query as Record<string, unknown>);

    // Get total count
    const allWishlistItems = await db
      .select({
        wishlistItem: wishlists,
        game: games,
      })
      .from(wishlists)
      .innerJoin(games, eq(wishlists.gameId, games.id))
      .where(eq(wishlists.userId, authReq.user!.id))
      .orderBy(desc(wishlists.addedAt));

    const total = allWishlistItems.length;
    const paginatedItems = allWishlistItems.slice(
      pagination.offset,
      pagination.offset + pagination.limit
    );

    res.json({
      success: true,
      data: {
        items: paginatedItems.map((item) => ({
          ...item.wishlistItem,
          game: item.game,
        })),
        total,
        limit: pagination.limit,
        offset: pagination.offset,
        hasMore: pagination.offset + pagination.limit < total,
      },
    });
  } catch (error) {
    logger.error('Get wishlist error', error as Error, { component: 'Store' });
    res.status(500).json({ success: false, error: 'Failed to fetch wishlist' });
  }
});

export default router;
