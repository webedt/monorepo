/**
 * Library Routes
 * Handles user's game library management
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, purchases, eq, and, desc } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendInternalError,
} from '@webedt/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get recently played games (must be before /:gameId to avoid being treated as gameId)
router.get('/recent', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const limit = Math.min(parseInt(req.query.limit as string) || 6, 20);

    // Get library items that have been played, sorted by most recent
    const recentItems = await db
      .select({
        libraryItem: userLibrary,
        game: games,
      })
      .from(userLibrary)
      .innerJoin(games, eq(userLibrary.gameId, games.id))
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.hidden, false)
        )
      )
      .orderBy(desc(userLibrary.lastPlayedAt));

    // Filter to only items that have been played and limit
    const playedItems = recentItems
      .filter((item) => item.libraryItem.lastPlayedAt !== null)
      .slice(0, limit);

    sendSuccess(res, {
      items: playedItems.map((item) => ({
        ...item.libraryItem,
        game: item.game,
      })),
      total: playedItems.length,
    });
  } catch (error) {
    logger.error('Get recently played error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to fetch recently played games');
  }
});

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

    sendSuccess(res, {
      items: hiddenItems.map((item) => ({
        ...item.libraryItem,
        game: item.game,
      })),
      total: hiddenItems.length,
    });
  } catch (error) {
    logger.error('Get hidden games error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to fetch hidden games');
  }
});

// Get library statistics (must be before /:gameId to avoid being treated as gameId)
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const libraryItems = await db
      .select()
      .from(userLibrary)
      .where(eq(userLibrary.userId, authReq.user!.id));

    const totalGames = libraryItems.length;
    const installedGames = libraryItems.filter(
      (item) => item.installStatus === 'installed'
    ).length;
    const favoriteGames = libraryItems.filter((item) => item.favorite).length;
    const totalPlaytimeMinutes = libraryItems.reduce(
      (sum, item) => sum + item.playtimeMinutes,
      0
    );

    sendSuccess(res, {
      totalGames,
      installedGames,
      favoriteGames,
      totalPlaytimeMinutes,
      totalPlaytimeHours: Math.round(totalPlaytimeMinutes / 60),
    });
  } catch (error) {
    logger.error('Get library stats error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to fetch library stats');
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

    // Get library items with game details
    let libraryItems = await db
      .select({
        libraryItem: userLibrary,
        game: games,
      })
      .from(userLibrary)
      .innerJoin(games, eq(userLibrary.gameId, games.id))
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.hidden, false)
        )
      );

    // Apply filters
    if (favorite === 'true') {
      libraryItems = libraryItems.filter((item) => item.libraryItem.favorite);
    }

    if (installed === 'true') {
      libraryItems = libraryItems.filter(
        (item) => item.libraryItem.installStatus === 'installed'
      );
    }

    // Sort
    const sortOrder = order === 'asc' ? 1 : -1;
    libraryItems.sort((a, b) => {
      switch (sort) {
        case 'title':
          return sortOrder * a.game.title.localeCompare(b.game.title);
        case 'lastPlayed':
          const playedA = a.libraryItem.lastPlayedAt
            ? new Date(a.libraryItem.lastPlayedAt).getTime()
            : 0;
          const playedB = b.libraryItem.lastPlayedAt
            ? new Date(b.libraryItem.lastPlayedAt).getTime()
            : 0;
          return sortOrder * (playedA - playedB);
        case 'playtime':
          return (
            sortOrder *
            (a.libraryItem.playtimeMinutes - b.libraryItem.playtimeMinutes)
          );
        case 'acquiredAt':
        default:
          const acqA = new Date(a.libraryItem.acquiredAt).getTime();
          const acqB = new Date(b.libraryItem.acquiredAt).getTime();
          return sortOrder * (acqA - acqB);
      }
    });

    // Paginate
    const total = libraryItems.length;
    const paginatedItems = libraryItems.slice(offset, offset + limit);

    sendSuccess(res, {
      items: paginatedItems.map((item) => ({
        ...item.libraryItem,
        game: item.game,
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Get library error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to fetch library');
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
      sendNotFound(res, 'Game not in library');
      return;
    }

    sendSuccess(res, {
      ...libraryItem.libraryItem,
      game: libraryItem.game,
    });
  } catch (error) {
    logger.error('Get library item error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to fetch library item');
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
      sendNotFound(res, 'Game not in library');
      return;
    }

    // Toggle favorite
    const [updated] = await db
      .update(userLibrary)
      .set({ favorite: !libraryItem.favorite })
      .where(eq(userLibrary.id, libraryItem.id))
      .returning();

    sendSuccess(res, { item: updated });
  } catch (error) {
    logger.error('Toggle favorite error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to toggle favorite');
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
      sendNotFound(res, 'Game not in library');
      return;
    }

    // Update hidden status
    const [updated] = await db
      .update(userLibrary)
      .set({ hidden })
      .where(eq(userLibrary.id, libraryItem.id))
      .returning();

    sendSuccess(res, { item: updated });
  } catch (error) {
    logger.error('Hide game error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to hide game');
  }
});

// Update install status
router.post('/:gameId/install-status', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;
    const { status } = req.body;

    if (!['not_installed', 'installing', 'installed'].includes(status)) {
      sendError(res, 'Invalid install status', 400);
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
      sendNotFound(res, 'Game not in library');
      return;
    }

    // Update install status
    const [updated] = await db
      .update(userLibrary)
      .set({ installStatus: status })
      .where(eq(userLibrary.id, libraryItem.id))
      .returning();

    sendSuccess(res, { item: updated });
  } catch (error) {
    logger.error('Update install status error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to update install status');
  }
});

// Update playtime
router.post('/:gameId/playtime', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;
    const { minutes } = req.body;

    if (typeof minutes !== 'number' || minutes < 0) {
      sendError(res, 'Invalid playtime', 400);
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
      sendNotFound(res, 'Game not in library');
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

    sendSuccess(res, { item: updated });
  } catch (error) {
    logger.error('Update playtime error', error as Error, { component: 'Library' });
    sendInternalError(res, 'Failed to update playtime');
  }
});

export default router;
