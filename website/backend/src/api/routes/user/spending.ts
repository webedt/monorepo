/**
 * User Spending Limits Routes
 * Handles spending limits configuration and tracking
 */

import { Router, Request, Response } from 'express';
import { db, users, eq, logger } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';

const router = Router();

/**
 * @openapi
 * /api/user/spending-limits:
 *   get:
 *     tags: [User]
 *     summary: Get spending limits configuration
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Spending limits configuration returned
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/spending-limits', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const [user] = await db
      .select({
        spendingLimitEnabled: users.spendingLimitEnabled,
        monthlyBudgetCents: users.monthlyBudgetCents,
        perTransactionLimitCents: users.perTransactionLimitCents,
        spendingResetDay: users.spendingResetDay,
        currentMonthSpentCents: users.currentMonthSpentCents,
        spendingLimitAction: users.spendingLimitAction,
        spendingResetAt: users.spendingResetAt,
      })
      .from(users)
      .where(eq(users.id, authReq.user!.id))
      .limit(1);

    if (!user) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }

    // Calculate remaining budget
    const monthlyBudget = Number(user.monthlyBudgetCents) || 0;
    const currentSpent = Number(user.currentMonthSpentCents) || 0;
    const remainingBudget = Math.max(0, monthlyBudget - currentSpent);
    const usagePercent = monthlyBudget > 0 ? (currentSpent / monthlyBudget) * 100 : 0;

    res.json({
      success: true,
      data: {
        enabled: user.spendingLimitEnabled,
        monthlyBudgetCents: user.monthlyBudgetCents,
        perTransactionLimitCents: user.perTransactionLimitCents,
        resetDay: user.spendingResetDay,
        currentMonthSpentCents: user.currentMonthSpentCents,
        remainingBudgetCents: String(remainingBudget),
        usagePercent: Math.round(usagePercent * 100) / 100,
        limitAction: user.spendingLimitAction,
        lastResetAt: user.spendingResetAt?.toISOString() || null,
      },
    });
  } catch (error) {
    logger.error('Get spending limits error', error, { component: 'user', operation: 'getSpendingLimits' });
    res.status(500).json({ success: false, error: 'Failed to get spending limits' });
  }
});

/**
 * @openapi
 * /api/user/spending-limits:
 *   post:
 *     tags: [User]
 *     summary: Update spending limits configuration
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               enabled:
 *                 type: boolean
 *               monthlyBudgetCents:
 *                 type: string
 *               perTransactionLimitCents:
 *                 type: string
 *               resetDay:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 31
 *               limitAction:
 *                 type: string
 *                 enum: [warn, block]
 *     responses:
 *       200:
 *         description: Spending limits updated successfully
 *       400:
 *         description: Invalid settings
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/spending-limits', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { enabled, monthlyBudgetCents, perTransactionLimitCents, resetDay, limitAction } = req.body;

    const updates: {
      spendingLimitEnabled?: boolean;
      monthlyBudgetCents?: string;
      perTransactionLimitCents?: string;
      spendingResetDay?: number;
      spendingLimitAction?: string;
    } = {};

    // Validate and set enabled flag
    if (typeof enabled === 'boolean') {
      updates.spendingLimitEnabled = enabled;
    }

    // Validate and set monthly budget (in cents)
    if (monthlyBudgetCents !== undefined) {
      const budget = Number(monthlyBudgetCents);
      if (isNaN(budget) || budget < 0) {
        res.status(400).json({
          success: false,
          error: 'Monthly budget must be a non-negative number',
        });
        return;
      }
      updates.monthlyBudgetCents = String(Math.round(budget));
    }

    // Validate and set per-transaction limit (in cents)
    if (perTransactionLimitCents !== undefined) {
      const limit = Number(perTransactionLimitCents);
      if (isNaN(limit) || limit < 0) {
        res.status(400).json({
          success: false,
          error: 'Per-transaction limit must be a non-negative number',
        });
        return;
      }
      updates.perTransactionLimitCents = String(Math.round(limit));
    }

    // Validate and set reset day (1-31)
    if (resetDay !== undefined) {
      const day = Number(resetDay);
      if (isNaN(day) || day < 1 || day > 31) {
        res.status(400).json({
          success: false,
          error: 'Reset day must be between 1 and 31',
        });
        return;
      }
      updates.spendingResetDay = day;
    }

    // Validate and set limit action
    if (limitAction !== undefined) {
      const validActions = ['warn', 'block'];
      if (!validActions.includes(limitAction)) {
        res.status(400).json({
          success: false,
          error: 'Limit action must be one of: warn, block',
        });
        return;
      }
      updates.spendingLimitAction = limitAction;
    }

    if (Object.keys(updates).length === 0) {
      res.status(400).json({
        success: false,
        error: 'No valid settings to update',
      });
      return;
    }

    await db
      .update(users)
      .set(updates)
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Spending limits updated successfully' },
    });
  } catch (error) {
    logger.error('Update spending limits error', error, { component: 'user', operation: 'updateSpendingLimits' });
    res.status(500).json({ success: false, error: 'Failed to update spending limits' });
  }
});

/**
 * @openapi
 * /api/user/spending-limits/reset:
 *   post:
 *     tags: [User]
 *     summary: Reset current month spending
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Monthly spending reset successfully
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/spending-limits/reset', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    await db
      .update(users)
      .set({
        currentMonthSpentCents: '0',
        spendingResetAt: new Date(),
      })
      .where(eq(users.id, authReq.user!.id));

    res.json({
      success: true,
      data: { message: 'Monthly spending reset successfully' },
    });
  } catch (error) {
    logger.error('Reset spending error', error, { component: 'user', operation: 'resetSpending' });
    res.status(500).json({ success: false, error: 'Failed to reset spending' });
  }
});

export default router;
