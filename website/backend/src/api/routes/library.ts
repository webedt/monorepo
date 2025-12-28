/**
 * Library Routes
 * Handles user's game library management
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, eq, and, desc, asc, sql } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get hidden games (must be before /:gameId to avoid being treated as gameId)
router.get('/hidden/all', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const hiddenItems = await db
      .select({
        libraryItem: userLibrary,
        game: games,
      })
      .from(userLibrary)
      .innerJoin(games, eq(userLibrary.gameId, games.id))
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.hidden, true)
        )
      )
      .orderBy(desc(userLibrary.acquiredAt));

    res.json({
      success: true,
      data: {
        items: hiddenItems.map((item) => ({
          ...item.libraryItem,
          game: item.game,
        })),
        total: hiddenItems.length,
      },
    });
  } catch (error) {
    logger.error('Get hidden games error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to fetch hidden games' });
  }
});

// Get library statistics (must be before /:gameId to avoid being treated as gameId)
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Use SQL aggregation for efficient stats computation
    const [stats] = await db
      .select({
        totalGames: sql<number>`COUNT(*)::int`,
        installedGames: sql<number>`COUNT(*) FILTER (WHERE ${userLibrary.installStatus} = 'installed')::int`,
        favoriteGames: sql<number>`COUNT(*) FILTER (WHERE ${userLibrary.favorite} = true)::int`,
        totalPlaytimeMinutes: sql<number>`COALESCE(SUM(${userLibrary.playtimeMinutes}), 0)::int`,
      })
      .from(userLibrary)
      .where(eq(userLibrary.userId, authReq.user!.id));

    const totalPlaytimeMinutes = stats?.totalPlaytimeMinutes ?? 0;

    res.json({
      success: true,
      data: {
        totalGames: stats?.totalGames ?? 0,
        installedGames: stats?.installedGames ?? 0,
        favoriteGames: stats?.favoriteGames ?? 0,
        totalPlaytimeMinutes,
        totalPlaytimeHours: Math.round(totalPlaytimeMinutes / 60),
      },
    });
  } catch (error) {
    logger.error('Get library stats error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to fetch library stats' });
  }
});

// Get user's library
router.get('/', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const {
      sort = 'acquiredAt',
      order = 'desc',
      favorite,
      installed,
    } = req.query;

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    // Build conditions for database-level filtering
    const conditions = [
      eq(userLibrary.userId, authReq.user!.id),
      eq(userLibrary.hidden, false),
    ];

    // Apply filters at database level
    if (favorite === 'true') {
      conditions.push(eq(userLibrary.favorite, true));
    }

    if (installed === 'true') {
      conditions.push(eq(userLibrary.installStatus, 'installed'));
    }

    // Determine sort order at database level
    let orderByClause;
    switch (sort) {
      case 'title':
        orderByClause = order === 'asc' ? asc(games.title) : desc(games.title);
        break;
      case 'lastPlayed':
        orderByClause = order === 'asc'
          ? asc(userLibrary.lastPlayedAt)
          : desc(userLibrary.lastPlayedAt);
        break;
      case 'playtime':
        orderByClause = order === 'asc'
          ? asc(userLibrary.playtimeMinutes)
          : desc(userLibrary.playtimeMinutes);
        break;
      case 'acquiredAt':
      default:
        orderByClause = order === 'asc'
          ? asc(userLibrary.acquiredAt)
          : desc(userLibrary.acquiredAt);
    }

    // Get library items with database-level filtering, sorting, and pagination
    const libraryItems = await db
      .select({
        libraryItem: userLibrary,
        game: games,
      })
      .from(userLibrary)
      .innerJoin(games, eq(userLibrary.gameId, games.id))
      .where(and(...conditions))
      .orderBy(orderByClause)
      .limit(limit)
      .offset(offset);

    // Get total count using SQL COUNT for efficiency
    const [countResult] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(userLibrary)
      .where(and(...conditions));

    const total = countResult?.count ?? 0;

    res.json({
      success: true,
      data: {
        items: libraryItems.map((item) => ({
          ...item.libraryItem,
          game: item.game,
        })),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    logger.error('Get library error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to fetch library' });
  }
});

// Get specific library item
router.get('/:gameId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;

    const [libraryItem] = await db
      .select({
        libraryItem: userLibrary,
        game: games,
      })
      .from(userLibrary)
      .innerJoin(games, eq(userLibrary.gameId, games.id))
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, gameId)
        )
      )
      .limit(1);

    if (!libraryItem) {
      res.status(404).json({ success: false, error: 'Game not in library' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...libraryItem.libraryItem,
        game: libraryItem.game,
      },
    });
  } catch (error) {
    logger.error('Get library item error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to fetch library item' });
  }
});

// Toggle favorite
router.post('/:gameId/favorite', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;

    // Get current state
    const [libraryItem] = await db
      .select()
      .from(userLibrary)
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, gameId)
        )
      )
      .limit(1);

    if (!libraryItem) {
      res.status(404).json({ success: false, error: 'Game not in library' });
      return;
    }

    // Toggle favorite
    const [updated] = await db
      .update(userLibrary)
      .set({ favorite: !libraryItem.favorite })
      .where(eq(userLibrary.id, libraryItem.id))
      .returning();

    res.json({
      success: true,
      data: { item: updated },
    });
  } catch (error) {
    logger.error('Toggle favorite error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to toggle favorite' });
  }
});

// Hide/unhide game from library
router.post('/:gameId/hide', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;
    const { hidden = true } = req.body;

    // Get current state
    const [libraryItem] = await db
      .select()
      .from(userLibrary)
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, gameId)
        )
      )
      .limit(1);

    if (!libraryItem) {
      res.status(404).json({ success: false, error: 'Game not in library' });
      return;
    }

    // Update hidden status
    const [updated] = await db
      .update(userLibrary)
      .set({ hidden })
      .where(eq(userLibrary.id, libraryItem.id))
      .returning();

    res.json({
      success: true,
      data: { item: updated },
    });
  } catch (error) {
    logger.error('Hide game error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to hide game' });
  }
});

// Update install status
router.post('/:gameId/install-status', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;
    const { status } = req.body;

    if (!['not_installed', 'installing', 'installed'].includes(status)) {
      res.status(400).json({ success: false, error: 'Invalid install status' });
      return;
    }

    // Get current state
    const [libraryItem] = await db
      .select()
      .from(userLibrary)
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, gameId)
        )
      )
      .limit(1);

    if (!libraryItem) {
      res.status(404).json({ success: false, error: 'Game not in library' });
      return;
    }

    // Update install status
    const [updated] = await db
      .update(userLibrary)
      .set({ installStatus: status })
      .where(eq(userLibrary.id, libraryItem.id))
      .returning();

    res.json({
      success: true,
      data: { item: updated },
    });
  } catch (error) {
    logger.error('Update install status error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to update install status' });
  }
});

// Update playtime
router.post('/:gameId/playtime', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;
    const { minutes } = req.body;

    if (typeof minutes !== 'number' || minutes < 0) {
      res.status(400).json({ success: false, error: 'Invalid playtime' });
      return;
    }

    // Get current state
    const [libraryItem] = await db
      .select()
      .from(userLibrary)
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, gameId)
        )
      )
      .limit(1);

    if (!libraryItem) {
      res.status(404).json({ success: false, error: 'Game not in library' });
      return;
    }

    // Update playtime and last played
    const [updated] = await db
      .update(userLibrary)
      .set({
        playtimeMinutes: libraryItem.playtimeMinutes + minutes,
        lastPlayedAt: new Date(),
      })
      .where(eq(userLibrary.id, libraryItem.id))
      .returning();

    res.json({
      success: true,
      data: { item: updated },
    });
  } catch (error) {
    logger.error('Update playtime error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to update playtime' });
  }
});

export default router;
