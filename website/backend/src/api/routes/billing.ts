/**
 * Billing Routes
 * Handles subscription tier management and billing information
 */

import { Router, Request, Response } from 'express';
import {
  sendSuccess,
  sendError,
  sendInternalError,
} from '@webedt/shared';
import { StorageService, STORAGE_TIERS } from '@webedt/shared';
import type { StorageTier } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// Tier pricing configuration
const TIER_PRICING = {
  FREE: { price: 0, priceLabel: 'Free' },
  BASIC: { price: 9.99, priceLabel: '$9.99/mo' },
  PRO: { price: 29.99, priceLabel: '$29.99/mo' },
  ENTERPRISE: { price: 99.99, priceLabel: '$99.99/mo' },
} as const;

/**
 * Get current user's billing/plan information
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

    sendSuccess(res, {
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
    });
  } catch (error) {
    console.error('Get billing info error:', error);
    sendInternalError(res, 'Failed to get billing information');
  }
});

/**
 * Get all available pricing tiers
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

    sendSuccess(res, { tiers });
  } catch (error) {
    console.error('Get pricing tiers error:', error);
    sendInternalError(res, 'Failed to get pricing tiers');
  }
});

/**
 * Change user's subscription tier
 */
router.post('/change-plan', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user!.id;
    const { tier } = req.body;

    const validTiers = Object.keys(STORAGE_TIERS);
    if (!tier || !validTiers.includes(tier)) {
      sendError(res, `Invalid tier. Must be one of: ${validTiers.join(', ')}`, 400);
      return;
    }

    // Check if downgrading and user has more data than new quota
    if (tier !== 'ENTERPRISE') {
      const currentStats = await StorageService.getStorageStats(userId);
      const newQuota = STORAGE_TIERS[tier as StorageTier];

      if (Number(currentStats.usedBytes) > newQuota) {
        sendError(res, `Cannot downgrade to ${tier}. You are using ${StorageService.formatBytes(currentStats.usedBytes)} but the ${tier} plan only allows ${StorageService.formatBytes(newQuota)}. Please delete some data first.`, 400);
        return;
      }
    }

    await StorageService.setTier(userId, tier as StorageTier);
    const quotaBytes = STORAGE_TIERS[tier as StorageTier];
    const pricing = TIER_PRICING[tier as StorageTier];

    sendSuccess(res, {
      message: `Successfully changed to ${tier} plan`,
      tier,
      tierLabel: tier.charAt(0) + tier.slice(1).toLowerCase(),
      price: pricing.price,
      priceLabel: pricing.priceLabel,
      newQuotaBytes: quotaBytes.toString(),
      newQuotaFormatted: StorageService.formatBytes(quotaBytes),
    });
  } catch (error) {
    console.error('Change plan error:', error);
    sendInternalError(res, 'Failed to change plan');
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
