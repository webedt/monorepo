/**
 * Cloud Saves Routes
 * Handles game save synchronization across devices
 */

import { Router, Request, Response } from 'express';
import { CloudSavesService, logger } from '@webedt/shared';
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

// Check for sync conflicts
router.post('/check-conflicts', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { localSaves } = req.body;

    if (!Array.isArray(localSaves)) {
      res.status(400).json({ success: false, error: 'localSaves must be an array' });
      return;
    }

    const conflicts = await CloudSavesService.checkSyncConflicts(authReq.user!.id, localSaves);

    res.json({
      success: true,
      data: {
        conflicts: conflicts.map((c) => ({
          ...c,
          // Don't include full save data
          localSave: { ...c.localSave, saveData: undefined },
          remoteSave: { ...c.remoteSave, saveData: undefined },
        })),
        hasConflicts: conflicts.length > 0,
      },
    });
  } catch (error) {
    logger.error('Check sync conflicts error', error as Error, { component: 'CloudSaves' });
    res.status(500).json({ success: false, error: 'Failed to check conflicts' });
  }
});

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

// Get a specific version's save data
router.get('/saves/:saveId/versions/:versionId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { saveId, versionId } = req.params;

    const versions = await CloudSavesService.getSaveVersions(authReq.user!.id, saveId);
    const version = versions.find((v) => v.id === versionId);

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
