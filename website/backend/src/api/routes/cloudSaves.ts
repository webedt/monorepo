/**
 * Cloud Saves Routes
 * Handles game save synchronization across devices
 */

import { Router, Request, Response } from 'express';
import {
  CloudSavesService,
  logger,
  sendSuccess,
  sendError,
  sendNotFound,
  sendInternalError,
} from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get cloud save statistics for the current user
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const stats = await CloudSavesService.getStats(authReq.user!.id);

    sendSuccess(res, {
      totalSaves: stats.totalSaves,
      totalSizeBytes: stats.totalSize.toString(),
      gamesWithSaves: stats.gamesWithSaves,
      lastSyncAt: stats.lastSyncAt,
    });
  } catch (error) {
    logger.error('Get cloud saves stats error', error as Error, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to fetch cloud saves stats');
  }
});

// Get sync history for debugging
router.get('/sync-history', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const history = await CloudSavesService.getSyncHistory(authReq.user!.id, limit);

    sendSuccess(res, { history });
  } catch (error) {
    logger.error('Get sync history error', error as Error, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to fetch sync history');
  }
});

// List all saves for the current user
router.get('/all', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const saves = await CloudSavesService.listAllSaves(authReq.user!.id);

    sendSuccess(res, {
      saves: saves.map((save) => ({
        ...save,
        // Don't include full save data in list response
        saveData: undefined,
        hasData: !!save.saveData,
      })),
      total: saves.length,
    });
  } catch (error) {
    logger.error('List all saves error', error as Error, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to fetch saves');
  }
});

// Check for sync conflicts
router.post('/check-conflicts', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { localSaves } = req.body;

    if (!Array.isArray(localSaves)) {
      sendError(res, 'localSaves must be an array', 400);
      return;
    }

    // Validate each element has required fields
    for (let i = 0; i < localSaves.length; i++) {
      const save = localSaves[i];
      if (!save || typeof save !== 'object') {
        sendError(res, `localSaves[${i}] must be an object`, 400);
        return;
      }
      if (typeof save.gameId !== 'string' || !save.gameId) {
        sendError(res, `localSaves[${i}].gameId is required and must be a string`, 400);
        return;
      }
      if (typeof save.slotNumber !== 'number' || !Number.isInteger(save.slotNumber)) {
        sendError(res, `localSaves[${i}].slotNumber is required and must be an integer`, 400);
        return;
      }
      if (typeof save.checksum !== 'string' || !save.checksum) {
        sendError(res, `localSaves[${i}].checksum is required and must be a string`, 400);
        return;
      }
      // Parse updatedAt if it's a string
      if (save.updatedAt) {
        if (typeof save.updatedAt === 'string') {
          save.updatedAt = new Date(save.updatedAt);
        }
        if (!(save.updatedAt instanceof Date) || isNaN(save.updatedAt.getTime())) {
          sendError(res, `localSaves[${i}].updatedAt must be a valid date`, 400);
          return;
        }
      } else {
        sendError(res, `localSaves[${i}].updatedAt is required`, 400);
        return;
      }
    }

    const conflicts = await CloudSavesService.checkSyncConflicts(authReq.user!.id, localSaves);

    sendSuccess(res, {
      conflicts: conflicts.map((c) => ({
        localInfo: c.localInfo,
        remoteSave: { ...c.remoteSave, saveData: undefined },
        conflictType: c.conflictType,
      })),
      hasConflicts: conflicts.length > 0,
    });
  } catch (error) {
    logger.error('Check sync conflicts error', error as Error, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to check conflicts');
  }
});

// List saves for a specific game
router.get('/games/:gameId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;

    const saves = await CloudSavesService.listSavesByGame(authReq.user!.id, gameId);

    sendSuccess(res, {
      saves: saves.map((save) => ({
        ...save,
        // Don't include full save data in list response
        saveData: undefined,
        hasData: !!save.saveData,
      })),
      total: saves.length,
    });
  } catch (error) {
    logger.error('List game saves error', error as Error, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to fetch game saves');
  }
});

// Get a specific save slot
router.get('/games/:gameId/slots/:slotNumber', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;
    const slotNumber = parseInt(req.params.slotNumber);

    if (isNaN(slotNumber)) {
      sendError(res, 'Invalid slot number', 400);
      return;
    }

    const result = await CloudSavesService.getSave(authReq.user!.id, gameId, slotNumber);

    if (!result) {
      sendNotFound(res, 'Save not found');
      return;
    }

    sendSuccess(res, {
      save: result.save,
      game: result.game,
    });
  } catch (error) {
    logger.error('Get save error', error as Error, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to fetch save');
  }
});

// Upload/update a save
router.post('/games/:gameId/slots/:slotNumber', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;
    const slotNumber = parseInt(req.params.slotNumber);

    if (isNaN(slotNumber)) {
      sendError(res, 'Invalid slot number', 400);
      return;
    }

    const { slotName, saveData, platformData, screenshotUrl, playTimeSeconds, gameProgress } = req.body;

    if (!saveData || typeof saveData !== 'string') {
      sendError(res, 'saveData is required and must be a string', 400);
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

    sendSuccess(res, {
      save: {
        ...save,
        saveData: undefined, // Don't return full save data in response
        hasData: true,
      },
      message: 'Save uploaded successfully',
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('quota exceeded')) {
      logger.warn('Upload save quota exceeded', { component: 'CloudSaves', userId: (req as AuthRequest).user!.id });
      // HTTP 507 (Insufficient Storage) is semantically correct for quota exceeded
      sendError(res, err.message, 507);
      return;
    }
    logger.error('Upload save error', err, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to upload save');
  }
});

// Delete a save
router.delete('/games/:gameId/slots/:slotNumber', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId } = req.params;
    const slotNumber = parseInt(req.params.slotNumber);

    if (isNaN(slotNumber)) {
      sendError(res, 'Invalid slot number', 400);
      return;
    }

    const deleted = await CloudSavesService.deleteSave(
      authReq.user!.id,
      gameId,
      slotNumber,
      req.body.platformData
    );

    if (!deleted) {
      sendNotFound(res, 'Save not found');
      return;
    }

    sendSuccess(res, { message: 'Save deleted successfully' });
  } catch (error) {
    logger.error('Delete save error', error as Error, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to delete save');
  }
});

// Get save versions for recovery
router.get('/saves/:saveId/versions', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { saveId } = req.params;

    const versions = await CloudSavesService.getSaveVersions(authReq.user!.id, saveId);

    sendSuccess(res, {
      versions: versions.map((v) => ({
        ...v,
        // Don't include full save data in list
        saveData: undefined,
        hasData: !!v.saveData,
      })),
      total: versions.length,
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('not found') || err.message.includes('access denied')) {
      sendNotFound(res, 'Save not found');
      return;
    }
    logger.error('Get save versions error', err, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to fetch save versions');
  }
});

// Get a specific version's save data
router.get('/saves/:saveId/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { saveId, versionId } = req.params;

    // Use direct query instead of fetching all versions
    const version = await CloudSavesService.getVersionById(authReq.user!.id, saveId, versionId);

    if (!version) {
      sendNotFound(res, 'Version not found');
      return;
    }

    sendSuccess(res, { version });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('not found') || err.message.includes('access denied')) {
      sendNotFound(res, 'Save not found');
      return;
    }
    logger.error('Get version error', err, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to fetch version');
  }
});

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

    sendSuccess(res, {
      save: {
        ...restoredSave,
        saveData: undefined,
        hasData: true,
      },
      message: 'Save restored successfully',
    });
  } catch (error) {
    const err = error as Error;
    if (err.message.includes('not found')) {
      sendNotFound(res, err.message);
      return;
    }
    logger.error('Restore version error', err, { component: 'CloudSaves' });
    sendInternalError(res, 'Failed to restore save');
  }
});

export default router;
