/**
 * Library Routes
 * Handles user's game library management
 */

/**
 * @openapi
 * components:
 *   schemas:
 *     LibraryItem:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *         userId:
 *           type: string
 *         gameId:
 *           type: string
 *         acquiredAt:
 *           type: string
 *           format: date-time
 *         lastPlayedAt:
 *           type: string
 *           format: date-time
 *           nullable: true
 *         playtimeMinutes:
 *           type: integer
 *         installStatus:
 *           type: string
 *           enum: [not_installed, installing, installed]
 *         favorite:
 *           type: boolean
 *         hidden:
 *           type: boolean
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, purchases, eq, and, desc } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * @openapi
 * /api/library/recent:
 *   get:
 *     tags: [Library]
 *     summary: Get recently played games
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 6
 *           maximum: 20
 *     responses:
 *       200:
 *         description: Recently played games list
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
 *                           - $ref: '#/components/schemas/LibraryItem'
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

    res.json({
      success: true,
      data: {
        items: playedItems.map((item) => ({
          ...item.libraryItem,
          game: item.game,
        })),
        total: playedItems.length,
      },
    });
  } catch (error) {
    logger.error('Get recently played error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to fetch recently played games' });
  }
});

/**
 * @openapi
 * /api/library/hidden/all:
 *   get:
 *     tags: [Library]
 *     summary: Get hidden games
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Hidden games list
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
 *                           - $ref: '#/components/schemas/LibraryItem'
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

/**
 * @openapi
 * /api/library/stats/summary:
 *   get:
 *     tags: [Library]
 *     summary: Get library statistics
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Library statistics
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
 *                     totalGames:
 *                       type: integer
 *                     installedGames:
 *                       type: integer
 *                     favoriteGames:
 *                       type: integer
 *                     totalPlaytimeMinutes:
 *                       type: integer
 *                     totalPlaytimeHours:
 *                       type: integer
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

    res.json({
      success: true,
      data: {
        totalGames,
        installedGames,
        favoriteGames,
        totalPlaytimeMinutes,
        totalPlaytimeHours: Math.round(totalPlaytimeMinutes / 60),
      },
    });
  } catch (error) {
    logger.error('Get library stats error', error as Error, { component: 'Library' });
    res.status(500).json({ success: false, error: 'Failed to fetch library stats' });
  }
});

/**
 * @openapi
 * /api/library:
 *   get:
 *     tags: [Library]
 *     summary: Get user's game library
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [acquiredAt, title, lastPlayed, playtime]
 *           default: acquiredAt
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: favorite
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: installed
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: User's game library
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
 *                           - $ref: '#/components/schemas/LibraryItem'
 *                           - type: object
 *                             properties:
 *                               game:
 *                                 $ref: '#/components/schemas/Game'
 *                     total:
 *                       type: integer
 *                     limit:
 *                       type: integer
 *                     offset:
 *                       type: integer
 *                     hasMore:
 *                       type: boolean
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

    res.json({
      success: true,
      data: {
        items: paginatedItems.map((item) => ({
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

/**
 * @openapi
 * /api/library/{gameId}:
 *   get:
 *     tags: [Library]
 *     summary: Get specific library item
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
 *         description: Library item details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   allOf:
 *                     - $ref: '#/components/schemas/LibraryItem'
 *                     - type: object
 *                       properties:
 *                         game:
 *                           $ref: '#/components/schemas/Game'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Game not in library
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/library/{gameId}/favorite:
 *   post:
 *     tags: [Library]
 *     summary: Toggle favorite status
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
 *         description: Updated library item
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
 *                     item:
 *                       $ref: '#/components/schemas/LibraryItem'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Game not in library
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/library/{gameId}/hide:
 *   post:
 *     tags: [Library]
 *     summary: Hide or unhide game from library
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hidden:
 *                 type: boolean
 *                 default: true
 *     responses:
 *       200:
 *         description: Updated library item
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
 *                     item:
 *                       $ref: '#/components/schemas/LibraryItem'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Game not in library
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/library/{gameId}/install-status:
 *   post:
 *     tags: [Library]
 *     summary: Update game install status
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [not_installed, installing, installed]
 *     responses:
 *       200:
 *         description: Updated library item
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
 *                     item:
 *                       $ref: '#/components/schemas/LibraryItem'
 *       400:
 *         description: Invalid install status
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Game not in library
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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

/**
 * @openapi
 * /api/library/{gameId}/playtime:
 *   post:
 *     tags: [Library]
 *     summary: Update game playtime
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - in: path
 *         name: gameId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - minutes
 *             properties:
 *               minutes:
 *                 type: number
 *                 minimum: 0
 *                 description: Minutes to add to playtime
 *     responses:
 *       200:
 *         description: Updated library item with new playtime
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
 *                     item:
 *                       $ref: '#/components/schemas/LibraryItem'
 *       400:
 *         description: Invalid playtime value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         description: Game not in library
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
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
