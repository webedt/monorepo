/**
 * Storage Routes
 * Handles user storage quota management and statistics
 */

import { Router, Request, Response } from 'express';
import { db, users, eq } from '@webedt/shared';
import { StorageService, STORAGE_TIERS } from '@webedt/shared';
import type { StorageTier } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * Get current user's storage statistics
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
 * Get storage breakdown by category
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
 * Recalculate and sync storage usage from actual data
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
 * Check if additional bytes can be added (quota check)
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
    console.error('Check storage quota error:', error);
    res.status(500).json({ success: false, error: 'Failed to check storage quota' });
  }
});

/**
 * Get available storage tiers
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
 * Get storage stats for a specific user (admin only)
 */
router.get('/admin/:userId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Check if user is admin
    const [currentUser] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!currentUser?.isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const { userId } = req.params;
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
 * Set storage quota for a user (admin only)
 */
router.post('/admin/:userId/quota', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Check if user is admin
    const [currentUser] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!currentUser?.isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const { userId } = req.params;
    const { quotaBytes } = req.body;

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
    console.error('Admin set storage quota error:', error);
    res.status(500).json({ success: false, error: 'Failed to set user storage quota' });
  }
});

/**
 * Set storage tier for a user (admin only)
 */
router.post('/admin/:userId/tier', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Check if user is admin
    const [currentUser] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!currentUser?.isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const { userId } = req.params;
    const { tier } = req.body;

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
    console.error('Admin set storage tier error:', error);
    res.status(500).json({ success: false, error: 'Failed to set user storage tier' });
  }
});

/**
 * Recalculate storage usage for a user (admin only)
 */
router.post('/admin/:userId/recalculate', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    // Check if user is admin
    const [currentUser] = await db
      .select({ isAdmin: users.isAdmin })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!currentUser?.isAdmin) {
      res.status(403).json({ success: false, error: 'Admin access required' });
      return;
    }

    const { userId } = req.params;
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
