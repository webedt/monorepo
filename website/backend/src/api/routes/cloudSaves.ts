/**
 * Cloud Saves Routes
 * Handles game save synchronization across devices
 */

import { Router, Request, Response } from 'express';
import { CloudSavesService, logger } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { fileOperationRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: CloudSaves
 *     description: Game save synchronization across devices
 */

// All routes require authentication and rate limiting
// Rate limit: 100 requests/minute (fileOperationRateLimiter - for file sync operations)
router.use(requireAuth);
router.use(fileOperationRateLimiter);

/**
 * @openapi
 * /cloud-saves/stats:
 *   get:
 *     tags:
 *       - CloudSaves
 *     summary: Get cloud save statistics
 *     description: Returns statistics about the user's cloud saves including total saves, size, and last sync time.
 *     responses:
 *       200:
 *         description: Statistics retrieved successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get cloud save statistics for the current user
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const stats = await CloudSavesService.getStats(authReq.user!.id);

    res.json({
      success: true,
      data: {
        totalSaves: stats.totalSaves,
        totalSizeBytes: stats.totalSize.toString(),
        gamesWithSaves: stats.gamesWithSaves,
        lastSyncAt: stats.lastSyncAt,
      },
    });
  } catch (error) {
    logger.error('Get cloud saves stats error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to fetch cloud saves stats' });
  }
});

/**
 * @openapi
 * /cloud-saves/sync-history:
 *   get:
 *     tags:
 *       - CloudSaves
 *     summary: Get sync history
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Sync history retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get sync history for debugging
router.get('/sync-history', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const history = await CloudSavesService.getSyncHistory(authReq.user!.id, limit);

    res.json({
      success: true,
      data: { history },
    });
  } catch (error) {
    logger.error('Get sync history error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to fetch sync history' });
  }
});

/**
 * @openapi
 * /cloud-saves/all:
 *   get:
 *     tags:
 *       - CloudSaves
 *     summary: List all saves
 *     description: Returns all cloud saves for the current user.
 *     responses:
 *       200:
 *         description: Saves retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// List all saves for the current user
router.get('/all', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const saves = await CloudSavesService.listAllSaves(authReq.user!.id);

    res.json({
      success: true,
      data: {
        saves: saves.map((save) => ({
          ...save,
          // Don't include full save data in list response
          saveData: undefined,
          hasData: !!save.saveData,
        })),
        total: saves.length,
      },
    });
  } catch (error) {
    logger.error('List all saves error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to fetch saves' });
  }
});

/**
 * @openapi
 * /cloud-saves/check-conflicts:
 *   post:
 *     tags:
 *       - CloudSaves
 *     summary: Check for sync conflicts
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - localSaves
 *             properties:
 *               localSaves:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     gameId:
 *                       type: string
 *                     slotNumber:
 *                       type: integer
 *                     checksum:
 *                       type: string
 *                     updatedAt:
 *                       type: string
 *                       format: date-time
 *     responses:
 *       200:
 *         description: Conflict check completed
 *       400:
 *         description: Invalid input
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Check for sync conflicts
router.post('/check-conflicts', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { localSaves } = req.body;

    if (!Array.isArray(localSaves)) {
      res.status(400).json({ success: false, error: 'localSaves must be an array' });
      return;
    }

    // Validate each element has required fields
    for (let i = 0; i < localSaves.length; i++) {
      const save = localSaves[i];
      if (!save || typeof save !== 'object') {
        res.status(400).json({ success: false, error: `localSaves[${i}] must be an object` });
        return;
      }
      if (typeof save.gameId !== 'string' || !save.gameId) {
        res.status(400).json({ success: false, error: `localSaves[${i}].gameId is required and must be a string` });
        return;
      }
      if (typeof save.slotNumber !== 'number' || !Number.isInteger(save.slotNumber)) {
        res.status(400).json({ success: false, error: `localSaves[${i}].slotNumber is required and must be an integer` });
        return;
      }
      if (typeof save.checksum !== 'string' || !save.checksum) {
        res.status(400).json({ success: false, error: `localSaves[${i}].checksum is required and must be a string` });
        return;
      }
      // Parse updatedAt if it's a string
      if (save.updatedAt) {
        if (typeof save.updatedAt === 'string') {
          save.updatedAt = new Date(save.updatedAt);
        }
        if (!(save.updatedAt instanceof Date) || isNaN(save.updatedAt.getTime())) {
          res.status(400).json({ success: false, error: `localSaves[${i}].updatedAt must be a valid date` });
          return;
        }
      } else {
        res.status(400).json({ success: false, error: `localSaves[${i}].updatedAt is required` });
        return;
      }
    }

    const conflicts = await CloudSavesService.checkSyncConflicts(authReq.user!.id, localSaves);

    res.json({
      success: true,
      data: {
        conflicts: conflicts.map((c) => ({
          localInfo: c.localInfo,
          remoteSave: { ...c.remoteSave, saveData: undefined },
          conflictType: c.conflictType,
        })),
        hasConflicts: conflicts.length > 0,
      },
    });
  } catch (error) {
    logger.error('Check sync conflicts error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to check conflicts' });
  }
});

/**
 * @openapi
 * /cloud-saves/games/{gameId}:
 *   get:
 *     tags:
 *       - CloudSaves
 *     summary: List game saves
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Game saves retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// List saves for a specific game
router.get('/games/:gameId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;

    const saves = await CloudSavesService.listSavesByGame(authReq.user!.id, gameId);

    res.json({
      success: true,
      data: {
        saves: saves.map((save) => ({
          ...save,
          // Don't include full save data in list response
          saveData: undefined,
          hasData: !!save.saveData,
        })),
        total: saves.length,
      },
    });
  } catch (error) {
    logger.error('List game saves error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to fetch game saves' });
  }
});

/**
 * @openapi
 * /cloud-saves/games/{gameId}/slots/{slotNumber}:
 *   get:
 *     tags:
 *       - CloudSaves
 *     summary: Get save slot
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: slotNumber
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Save retrieved
 *       400:
 *         description: Invalid slot number
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get a specific save slot
router.get('/games/:gameId/slots/:slotNumber', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;
    const slotNumber = parseInt(req.params.slotNumber);

    if (isNaN(slotNumber)) {
      res.status(400).json({ success: false, error: 'Invalid slot number' });
      return;
    }

    const result = await CloudSavesService.getSave(authReq.user!.id, gameId, slotNumber);

    if (!result) {
      res.status(404).json({ success: false, error: 'Save not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        save: result.save,
        game: result.game,
      },
    });
  } catch (error) {
    logger.error('Get save error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to fetch save' });
  }
});

/**
 * @openapi
 * /cloud-saves/games/{gameId}/slots/{slotNumber}:
 *   post:
 *     tags:
 *       - CloudSaves
 *     summary: Upload save
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: slotNumber
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - saveData
 *             properties:
 *               slotName:
 *                 type: string
 *               saveData:
 *                 type: string
 *               platformData:
 *                 type: object
 *               screenshotUrl:
 *                 type: string
 *               playTimeSeconds:
 *                 type: integer
 *               gameProgress:
 *                 type: number
 *     responses:
 *       200:
 *         description: Save uploaded
 *       400:
 *         description: Invalid input
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       413:
 *         description: Quota exceeded
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Upload/update a save
router.post('/games/:gameId/slots/:slotNumber', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;
    const slotNumber = parseInt(req.params.slotNumber);

    if (isNaN(slotNumber)) {
      res.status(400).json({ success: false, error: 'Invalid slot number' });
      return;
    }

    const { slotName, saveData, platformData, screenshotUrl, playTimeSeconds, gameProgress } = req.body;

    if (!saveData || typeof saveData !== 'string') {
      res.status(400).json({ success: false, error: 'saveData is required and must be a string' });
      return;
    }

    const save = await CloudSavesService.uploadSave({
      userId: authReq.user!.id,
      gameId,
      slotNumber,
      slotName,
      saveData,
      platformData,
      screenshotUrl,
      playTimeSeconds,
      gameProgress,
    });

    res.json({
      success: true,
      data: {
        save: {
          ...save,
          saveData: undefined, // Don't return full save data in response
          hasData: true,
        },
      },
      message: 'Save uploaded successfully',
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('quota exceeded')) {
      logger.warn('Upload save quota exceeded', { component: 'CloudSaves', userId: (req as AuthRequest).user!.id });
      res.status(413).json({ success: false, error: err.message });
      return;
    }
    logger.error('Upload save error', err, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to upload save' });
  }
});

/**
 * @openapi
 * /cloud-saves/games/{gameId}/slots/{slotNumber}:
 *   delete:
 *     tags:
 *       - CloudSaves
 *     summary: Delete save
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: slotNumber
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Save deleted
 *       400:
 *         description: Invalid slot
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Delete a save
router.delete('/games/:gameId/slots/:slotNumber', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;
    const slotNumber = parseInt(req.params.slotNumber);

    if (isNaN(slotNumber)) {
      res.status(400).json({ success: false, error: 'Invalid slot number' });
      return;
    }

    const deleted = await CloudSavesService.deleteSave(
      authReq.user!.id,
      gameId,
      slotNumber,
      req.body.platformData
    );

    if (!deleted) {
      res.status(404).json({ success: false, error: 'Save not found' });
      return;
    }

    res.json({
      success: true,
      message: 'Save deleted successfully',
    });
  } catch (error) {
    logger.error('Delete save error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to delete save' });
  }
});

/**
 * @openapi
 * /cloud-saves/saves/{saveId}/versions:
 *   get:
 *     tags:
 *       - CloudSaves
 *     summary: Get save versions
 *     parameters:
 *       - name: saveId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Versions retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get save versions for recovery
router.get('/saves/:saveId/versions', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { saveId } = req.params;

    const versions = await CloudSavesService.getSaveVersions(authReq.user!.id, saveId);

    res.json({
      success: true,
      data: {
        versions: versions.map((v) => ({
          ...v,
          // Don't include full save data in list
          saveData: undefined,
          hasData: !!v.saveData,
        })),
        total: versions.length,
      },
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('not found') || err.message.includes('access denied')) {
      res.status(404).json({ success: false, error: 'Save not found' });
      return;
    }
    logger.error('Get save versions error', err, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to fetch save versions' });
  }
});

/**
 * @openapi
 * /cloud-saves/saves/{saveId}/versions/{versionId}:
 *   get:
 *     tags:
 *       - CloudSaves
 *     summary: Get version data
 *     parameters:
 *       - name: saveId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: versionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Version retrieved
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Get a specific version's save data
router.get('/saves/:saveId/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { saveId, versionId } = req.params;

    // Use direct query instead of fetching all versions
    const version = await CloudSavesService.getVersionById(authReq.user!.id, saveId, versionId);

    if (!version) {
      res.status(404).json({ success: false, error: 'Version not found' });
      return;
    }

    res.json({
      success: true,
      data: { version },
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('not found') || err.message.includes('access denied')) {
      res.status(404).json({ success: false, error: 'Save not found' });
      return;
    }
    logger.error('Get version error', err, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to fetch version' });
  }
});

/**
 * @openapi
 * /cloud-saves/saves/{saveId}/versions/{versionId}/restore:
 *   post:
 *     tags:
 *       - CloudSaves
 *     summary: Restore version
 *     parameters:
 *       - name: saveId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: versionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Version restored
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
// Restore a save from a previous version
router.post('/saves/:saveId/versions/:versionId/restore', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { saveId, versionId } = req.params;

    const restoredSave = await CloudSavesService.restoreVersion(
      authReq.user!.id,
      saveId,
      versionId,
      req.body.platformData
    );

    res.json({
      success: true,
      data: {
        save: {
          ...restoredSave,
          saveData: undefined,
          hasData: true,
        },
      },
      message: 'Save restored successfully',
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('not found')) {
      res.status(404).json({ success: false, error: err.message });
      return;
    }
    logger.error('Restore version error', err, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to restore save' });
  }
});

export default router;
