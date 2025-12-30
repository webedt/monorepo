/**
 * Billing Routes
 * Handles subscription tier management and billing information
 */

import { Router, Request, Response } from 'express';
import { StorageService, STORAGE_TIERS, logger } from '@webedt/shared';
import type { StorageTier } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

/**
 * @openapi
 * tags:
 *   - name: Billing
 *     description: Subscription and billing management
 */

// Tier pricing configuration
const TIER_PRICING = {
  FREE: { price: 0, priceLabel: 'Free' },
  BASIC: { price: 9.99, priceLabel: '$9.99/mo' },
  PRO: { price: 29.99, priceLabel: '$29.99/mo' },
  ENTERPRISE: { price: 99.99, priceLabel: '$99.99/mo' },
} as const;

/**
 * @openapi
 * /billing/current:
 *   get:
 *     tags:
 *       - Billing
 *     summary: Get current billing information
 *     description: Returns the current user's subscription tier, usage statistics, and pricing information.
 *     responses:
 *       200:
 *         description: Billing information retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     tier:
 *                       type: string
 *                       enum: [FREE, BASIC, PRO, ENTERPRISE]
 *                     tierLabel:
 *                       type: string
 *                       example: Pro
 *                     price:
 *                       type: number
 *                       example: 29.99
 *                     priceLabel:
 *                       type: string
 *                       example: $29.99/mo
 *                     usedBytes:
 *                       type: string
 *                       description: Storage used in bytes
 *                     quotaBytes:
 *                       type: string
 *                       description: Total storage quota in bytes
 *                     availableBytes:
 *                       type: string
 *                       description: Available storage in bytes
 *                     usagePercent:
 *                       type: number
 *                       description: Percentage of quota used
 *                     usedFormatted:
 *                       type: string
 *                       description: Human-readable storage used
 *                       example: 1.5 GB
 *                     quotaFormatted:
 *                       type: string
 *                       description: Human-readable quota
 *                       example: 25 GB
 *                     availableFormatted:
 *                       type: string
 *                       description: Human-readable available storage
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/current', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user!.id;

    // Get user's storage stats
    const stats = await StorageService.getStorageStats(userId);

    // Determine tier based on quota
    let tier: StorageTier = 'BASIC';
    const quotaNum = Number(stats.quotaBytes);

    if (quotaNum <= STORAGE_TIERS.FREE) {
      tier = 'FREE';
    } else if (quotaNum <= STORAGE_TIERS.BASIC) {
      tier = 'BASIC';
    } else if (quotaNum <= STORAGE_TIERS.PRO) {
      tier = 'PRO';
    } else {
      tier = 'ENTERPRISE';
    }

    const pricing = TIER_PRICING[tier];

    res.json({
      success: true,
      data: {
        tier,
        tierLabel: tier.charAt(0) + tier.slice(1).toLowerCase(),
        price: pricing.price,
        priceLabel: pricing.priceLabel,
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
    logger.error('Get billing info error', error, { component: 'billing', operation: 'getCurrent' });
    res.status(500).json({ success: false, error: 'Failed to get billing information' });
  }
});

/**
 * @openapi
 * /billing/tiers:
 *   get:
 *     tags:
 *       - Billing
 *     summary: Get all pricing tiers
 *     description: Returns all available subscription tiers with pricing and features. Public endpoint.
 *     security: []
 *     responses:
 *       200:
 *         description: Pricing tiers retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     tiers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           id:
 *                             type: string
 *                             enum: [FREE, BASIC, PRO, ENTERPRISE]
 *                           name:
 *                             type: string
 *                             example: Pro
 *                           bytes:
 *                             type: string
 *                             description: Storage quota in bytes
 *                           formatted:
 *                             type: string
 *                             description: Human-readable storage quota
 *                             example: 25 GB
 *                           price:
 *                             type: number
 *                             example: 29.99
 *                           priceLabel:
 *                             type: string
 *                             example: $29.99/mo
 *                           features:
 *                             type: array
 *                             items:
 *                               type: string
 *                             description: List of features included in this tier
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/tiers', async (_req: Request, res: Response) => {
  try {
    const tiers = Object.entries(STORAGE_TIERS).map(([name, bytes]) => {
      const pricing = TIER_PRICING[name as StorageTier];
      return {
        id: name,
        name: name.charAt(0) + name.slice(1).toLowerCase(),
        bytes: bytes.toString(),
        formatted: StorageService.formatBytes(bytes),
        price: pricing.price,
        priceLabel: pricing.priceLabel,
        features: getTierFeatures(name as StorageTier),
      };
    });

    res.json({
      success: true,
      data: { tiers },
    });
  } catch (error) {
    logger.error('Get pricing tiers error', error, { component: 'billing', operation: 'getTiers' });
    res.status(500).json({ success: false, error: 'Failed to get pricing tiers' });
  }
});

/**
 * @openapi
 * /billing/change-plan:
 *   post:
 *     tags:
 *       - Billing
 *     summary: Change subscription tier
 *     description: Changes the user's subscription tier. Cannot downgrade if current usage exceeds new tier's quota.
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
 *                 enum: [FREE, BASIC, PRO, ENTERPRISE]
 *                 description: Target subscription tier
 *     responses:
 *       200:
 *         description: Plan changed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   type: object
 *                   properties:
 *                     message:
 *                       type: string
 *                       example: Successfully changed to PRO plan
 *                     tier:
 *                       type: string
 *                     tierLabel:
 *                       type: string
 *                     price:
 *                       type: number
 *                     priceLabel:
 *                       type: string
 *                     newQuotaBytes:
 *                       type: string
 *                     newQuotaFormatted:
 *                       type: string
 *       400:
 *         description: Invalid tier or cannot downgrade due to usage
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/change-plan', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user!.id;
    const { tier } = req.body;

    const validTiers = Object.keys(STORAGE_TIERS);
    if (!tier || !validTiers.includes(tier)) {
      res.status(400).json({
        success: false,
        error: `Invalid tier. Must be one of: ${validTiers.join(', ')}`,
      });
      return;
    }

    // Check if downgrading and user has more data than new quota
    if (tier !== 'ENTERPRISE') {
      const currentStats = await StorageService.getStorageStats(userId);
      const newQuota = STORAGE_TIERS[tier as StorageTier];

      if (Number(currentStats.usedBytes) > newQuota) {
        res.status(400).json({
          success: false,
          error: `Cannot downgrade to ${tier}. You are using ${StorageService.formatBytes(currentStats.usedBytes)} but the ${tier} plan only allows ${StorageService.formatBytes(newQuota)}. Please delete some data first.`,
        });
        return;
      }
    }

    await StorageService.setTier(userId, tier as StorageTier);
    const quotaBytes = STORAGE_TIERS[tier as StorageTier];
    const pricing = TIER_PRICING[tier as StorageTier];

    res.json({
      success: true,
      data: {
        message: `Successfully changed to ${tier} plan`,
        tier,
        tierLabel: tier.charAt(0) + tier.slice(1).toLowerCase(),
        price: pricing.price,
        priceLabel: pricing.priceLabel,
        newQuotaBytes: quotaBytes.toString(),
        newQuotaFormatted: StorageService.formatBytes(quotaBytes),
      },
    });
  } catch (error) {
    logger.error('Change plan error', error, { component: 'billing', operation: 'changePlan' });
    res.status(500).json({ success: false, error: 'Failed to change plan' });
  }
});

/**
 * Get feature list for a tier
 */
function getTierFeatures(tier: StorageTier): string[] {
  const features: Record<StorageTier, string[]> = {
    FREE: [
      '1 GB storage',
      'Basic agent access',
      'Community support',
      'Standard processing',
    ],
    BASIC: [
      '5 GB storage',
      'Full agent access',
      'Email support',
      'Priority processing',
      'Session history',
    ],
    PRO: [
      '25 GB storage',
      'Unlimited agent access',
      'Priority support',
      'Fastest processing',
      'Advanced analytics',
      'API access',
    ],
    ENTERPRISE: [
      '100 GB storage',
      'Unlimited everything',
      'Dedicated support',
      'SLA guarantee',
      'Custom integrations',
      'Team management',
      'Audit logs',
    ],
  };

  return features[tier] || [];
}

export default router;
