/**
 * Storage Routes
 * Handles user storage quota management and statistics
 */

/**
 * @openapi
 * tags:
 *   - name: Storage
 *     description: File storage quota management and statistics
 */

import { Router, Request, Response } from 'express';
import { StorageService, STORAGE_TIERS, logger } from '@webedt/shared';
import type { StorageTier } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

/**
 * @openapi
 * /api/storage:
 *   get:
 *     tags: [Storage]
 *     summary: Get current user's storage statistics
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Storage statistics returned successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const stats = await StorageService.getStorageStats(authReq.user!.id);

    res.json({
      success: true,
      data: {
        usedBytes: stats.usedBytes.toString(),
        quotaBytes: stats.quotaBytes.toString(),
        availableBytes: stats.availableBytes.toString(),
        usagePercent: stats.usagePercent,
        usedFormatted: StorageService.formatBytes(stats.usedBytes),
        quotaFormatted: StorageService.formatBytes(stats.quotaBytes),
        availableFormatted: StorageService.formatBytes(stats.availableBytes),
        breakdown: {
          messages: stats.breakdown.messages.toString(),
          events: stats.breakdown.events.toString(),
          liveChatMessages: stats.breakdown.liveChatMessages.toString(),
          workspaceEvents: stats.breakdown.workspaceEvents.toString(),
          images: stats.breakdown.images.toString(),
          total: stats.breakdown.total.toString(),
        },
      },
    });
  } catch (error) {
    logger.error('Get storage stats error', error, { component: 'storage', operation: 'getStats' });
    res.status(500).json({ success: false, error: 'Failed to get storage statistics' });
  }
});

/**
 * @openapi
 * /api/storage/breakdown:
 *   get:
 *     tags: [Storage]
 *     summary: Get storage breakdown by category
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Storage breakdown returned successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/breakdown', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const breakdown = await StorageService.getStorageBreakdown(authReq.user!.id);

    res.json({
      success: true,
      data: {
        messages: {
          bytes: breakdown.messages.toString(),
          formatted: StorageService.formatBytes(breakdown.messages),
        },
        events: {
          bytes: breakdown.events.toString(),
          formatted: StorageService.formatBytes(breakdown.events),
        },
        liveChatMessages: {
          bytes: breakdown.liveChatMessages.toString(),
          formatted: StorageService.formatBytes(breakdown.liveChatMessages),
        },
        workspaceEvents: {
          bytes: breakdown.workspaceEvents.toString(),
          formatted: StorageService.formatBytes(breakdown.workspaceEvents),
        },
        images: {
          bytes: breakdown.images.toString(),
          formatted: StorageService.formatBytes(breakdown.images),
        },
        total: {
          bytes: breakdown.total.toString(),
          formatted: StorageService.formatBytes(breakdown.total),
        },
      },
    });
  } catch (error) {
    logger.error('Get storage breakdown error', error, { component: 'storage', operation: 'getBreakdown' });
    res.status(500).json({ success: false, error: 'Failed to get storage breakdown' });
  }
});

/**
 * @openapi
 * /api/storage/recalculate:
 *   post:
 *     tags: [Storage]
 *     summary: Recalculate and sync storage usage from actual data
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Storage usage recalculated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/recalculate', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const newTotal = await StorageService.recalculateUsage(authReq.user!.id);

    res.json({
      success: true,
      data: {
        message: 'Storage usage recalculated',
        newTotalBytes: newTotal.toString(),
        newTotalFormatted: StorageService.formatBytes(newTotal),
      },
    });
  } catch (error) {
    logger.error('Recalculate storage error', error, { component: 'storage', operation: 'recalculate' });
    res.status(500).json({ success: false, error: 'Failed to recalculate storage usage' });
  }
});

/**
 * @openapi
 * /api/storage/check:
 *   post:
 *     tags: [Storage]
 *     summary: Check if additional bytes can be added (quota check)
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - bytes
 *             properties:
 *               bytes:
 *                 type: number
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Quota check completed successfully
 *       400:
 *         description: Invalid bytes value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/check', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { bytes } = req.body;

    if (typeof bytes !== 'number' || bytes < 0) {
      res.status(400).json({
        success: false,
        error: 'Invalid bytes value. Must be a non-negative number.',
      });
      return;
    }

    const check = await StorageService.checkQuota(authReq.user!.id, bytes);

    res.json({
      success: true,
      data: {
        allowed: check.allowed,
        usedBytes: check.usedBytes.toString(),
        quotaBytes: check.quotaBytes.toString(),
        availableBytes: check.availableBytes.toString(),
        requestedBytes: check.requestedBytes.toString(),
        usedFormatted: StorageService.formatBytes(check.usedBytes),
        quotaFormatted: StorageService.formatBytes(check.quotaBytes),
        availableFormatted: StorageService.formatBytes(check.availableBytes),
        requestedFormatted: StorageService.formatBytes(check.requestedBytes),
      },
    });
  } catch (error) {
    logger.error('Check storage quota error', error, { component: 'storage', operation: 'checkQuota' });
    res.status(500).json({ success: false, error: 'Failed to check storage quota' });
  }
});

/**
 * @openapi
 * /api/storage/tiers:
 *   get:
 *     tags: [Storage]
 *     summary: Get available storage tiers
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Storage tiers returned successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/tiers', requireAuth, async (_req: Request, res: Response) => {
  try {
    const tiers = Object.entries(STORAGE_TIERS).map(([name, bytes]) => ({
      name,
      bytes: bytes.toString(),
      formatted: StorageService.formatBytes(bytes),
    }));

    res.json({
      success: true,
      data: { tiers },
    });
  } catch (error) {
    logger.error('Get storage tiers error', error, { component: 'storage', operation: 'getTiers' });
    res.status(500).json({ success: false, error: 'Failed to get storage tiers' });
  }
});

// ============================================================================
// ADMIN ENDPOINTS
// ============================================================================

/**
 * @openapi
 * /api/storage/admin/{userId}:
 *   get:
 *     tags: [Storage]
 *     summary: Get storage stats for a specific user (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: User storage statistics returned successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/admin/:userId', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Validate target user exists
    const exists = await StorageService.userExists(userId);
    if (!exists) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const stats = await StorageService.getStorageStats(userId);

    res.json({
      success: true,
      data: {
        userId,
        usedBytes: stats.usedBytes.toString(),
        quotaBytes: stats.quotaBytes.toString(),
        availableBytes: stats.availableBytes.toString(),
        usagePercent: stats.usagePercent,
        usedFormatted: StorageService.formatBytes(stats.usedBytes),
        quotaFormatted: StorageService.formatBytes(stats.quotaBytes),
        availableFormatted: StorageService.formatBytes(stats.availableBytes),
      },
    });
  } catch (error) {
    logger.error('Admin get storage stats error', error, { component: 'storage', operation: 'adminGetStats' });
    res.status(500).json({ success: false, error: 'Failed to get user storage statistics' });
  }
});

/**
 * @openapi
 * /api/storage/admin/{userId}/quota:
 *   post:
 *     tags: [Storage]
 *     summary: Set storage quota for a user (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
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
 *               - quotaBytes
 *             properties:
 *               quotaBytes:
 *                 type: string
 *     responses:
 *       200:
 *         description: Storage quota updated successfully
 *       400:
 *         description: Invalid quota value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/admin/:userId/quota', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { quotaBytes } = req.body;

    // Validate target user exists
    const exists = await StorageService.userExists(userId);
    if (!exists) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    if (!quotaBytes || typeof quotaBytes !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Invalid quotaBytes. Must be a string representing bytes.',
      });
      return;
    }

    try {
      const quota = BigInt(quotaBytes);
      await StorageService.setQuota(userId, quota);

      res.json({
        success: true,
        data: {
          message: 'Storage quota updated',
          userId,
          newQuotaBytes: quota.toString(),
          newQuotaFormatted: StorageService.formatBytes(quota),
        },
      });
    } catch {
      res.status(400).json({
        success: false,
        error: 'Invalid quotaBytes value. Must be a valid number string.',
      });
    }
  } catch (error) {
    logger.error('Admin set storage quota error', error, { component: 'storage', operation: 'adminSetQuota' });
    res.status(500).json({ success: false, error: 'Failed to set user storage quota' });
  }
});

/**
 * @openapi
 * /api/storage/admin/{userId}/tier:
 *   post:
 *     tags: [Storage]
 *     summary: Set storage tier for a user (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
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
 *               - tier
 *             properties:
 *               tier:
 *                 type: string
 *     responses:
 *       200:
 *         description: Storage tier updated successfully
 *       400:
 *         description: Invalid tier value
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/admin/:userId/tier', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const { tier } = req.body;

    // Validate target user exists
    const exists = await StorageService.userExists(userId);
    if (!exists) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const validTiers = Object.keys(STORAGE_TIERS);
    if (!tier || !validTiers.includes(tier)) {
      res.status(400).json({
        success: false,
        error: `Invalid tier. Must be one of: ${validTiers.join(', ')}`,
      });
      return;
    }

    await StorageService.setTier(userId, tier as StorageTier);
    const quotaBytes = STORAGE_TIERS[tier as StorageTier];

    res.json({
      success: true,
      data: {
        message: 'Storage tier updated',
        userId,
        tier,
        newQuotaBytes: quotaBytes.toString(),
        newQuotaFormatted: StorageService.formatBytes(quotaBytes),
      },
    });
  } catch (error) {
    logger.error('Admin set storage tier error', error, { component: 'storage', operation: 'adminSetTier' });
    res.status(500).json({ success: false, error: 'Failed to set user storage tier' });
  }
});

/**
 * @openapi
 * /api/storage/admin/{userId}/recalculate:
 *   post:
 *     tags: [Storage]
 *     summary: Recalculate storage usage for a user (admin only)
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: userId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Storage usage recalculated successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       403:
 *         $ref: '#/components/responses/Forbidden'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/admin/:userId/recalculate', requireAuth, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;

    // Validate target user exists
    const exists = await StorageService.userExists(userId);
    if (!exists) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    const newTotal = await StorageService.recalculateUsage(userId);

    res.json({
      success: true,
      data: {
        message: 'Storage usage recalculated',
        userId,
        newTotalBytes: newTotal.toString(),
        newTotalFormatted: StorageService.formatBytes(newTotal),
      },
    });
  } catch (error) {
    logger.error('Admin recalculate storage error', error, { component: 'storage', operation: 'adminRecalculate' });
    res.status(500).json({ success: false, error: 'Failed to recalculate user storage usage' });
  }
});

export default router;
