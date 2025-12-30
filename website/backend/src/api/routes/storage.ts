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
import { z } from 'zod';
import { StorageService, STORAGE_TIERS, validateRequest, CommonSchemas } from '@webedt/shared';
import type { StorageTier } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

// ============================================================================
// Validation Schemas
// ============================================================================

const checkQuotaSchema = {
  body: z.object({
    bytes: z.number().nonnegative('Bytes must be a non-negative number'),
  }),
};

const userIdParamsSchema = {
  params: z.object({
    userId: CommonSchemas.uuid,
  }),
};

const setQuotaSchema = {
  params: z.object({
    userId: CommonSchemas.uuid,
  }),
  body: z.object({
    quotaBytes: z.string().min(1, 'quotaBytes is required').refine(
      (val) => {
        try {
          const parsed = BigInt(val);
          return parsed >= 0;
        } catch {
          return false;
        }
      },
      { message: 'quotaBytes must be a valid number string' }
    ),
  }),
};

const setTierSchema = {
  params: z.object({
    userId: CommonSchemas.uuid,
  }),
  body: z.object({
    tier: z.enum(['free', 'basic', 'pro', 'enterprise'] as const, {
      errorMap: () => ({ message: `Invalid tier. Must be one of: ${Object.keys(STORAGE_TIERS).join(', ')}` }),
    }),
  }),
};

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
    console.error('Get storage stats error:', error);
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
    console.error('Get storage breakdown error:', error);
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
    console.error('Recalculate storage error:', error);
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
router.post('/check', requireAuth, validateRequest(checkQuotaSchema), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { bytes } = req.body;

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
    console.error('Check storage quota error:', error);
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
    console.error('Get storage tiers error:', error);
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
router.get('/admin/:userId', requireAuth, requireAdmin, validateRequest(userIdParamsSchema), async (req: Request, res: Response) => {
  try {
    const { userId } = (req as Request & { validatedParams: { userId: string } }).validatedParams;

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
    console.error('Admin get storage stats error:', error);
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
router.post('/admin/:userId/quota', requireAuth, requireAdmin, validateRequest(setQuotaSchema), async (req: Request, res: Response) => {
  try {
    const { userId } = (req as Request & { validatedParams: { userId: string } }).validatedParams;
    const { quotaBytes } = req.body;

    // Validate target user exists
    const exists = await StorageService.userExists(userId);
    if (!exists) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

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
  } catch (error) {
    console.error('Admin set storage quota error:', error);
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
router.post('/admin/:userId/tier', requireAuth, requireAdmin, validateRequest(setTierSchema), async (req: Request, res: Response) => {
  try {
    const { userId } = (req as Request & { validatedParams: { userId: string } }).validatedParams;
    const { tier } = req.body;

    // Validate target user exists
    const exists = await StorageService.userExists(userId);
    if (!exists) {
      res.status(404).json({ success: false, error: 'User not found' });
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
    console.error('Admin set storage tier error:', error);
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
router.post('/admin/:userId/recalculate', requireAuth, requireAdmin, validateRequest(userIdParamsSchema), async (req: Request, res: Response) => {
  try {
    const { userId } = (req as Request & { validatedParams: { userId: string } }).validatedParams;

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
    console.error('Admin recalculate storage error:', error);
    res.status(500).json({ success: false, error: 'Failed to recalculate user storage usage' });
  }
});

export default router;
