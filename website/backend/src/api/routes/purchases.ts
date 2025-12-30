/**
 * Purchases Routes
 * Handles game purchases and transaction history
 */

/**
 * @openapi
 * tags:
 *   - name: Purchases
 *     description: Game purchases and transaction history
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, purchases, wishlists, eq, and, desc, getPaymentService, FRONTEND_URL, FRONTEND_PORT } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

import type { PaymentProvider } from '@webedt/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

/**
 * @openapi
 * /api/purchases/stats/summary:
 *   get:
 *     summary: Get purchase statistics summary
 *     tags: [Purchases]
 *     security:
 *       - sessionAuth: []
 *     responses:
 *       200:
 *         description: Purchase statistics
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
 *                     totalPurchases:
 *                       type: integer
 *                     completedPurchases:
 *                       type: integer
 *                     refundedPurchases:
 *                       type: integer
 *                     totalSpentCents:
 *                       type: number
 *                     totalRefundedCents:
 *                       type: number
 *                     netSpentCents:
 *                       type: number
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/stats/summary', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const allPurchases = await db
      .select()
      .from(purchases)
      .where(eq(purchases.userId, authReq.user!.id));

    const completedPurchases = allPurchases.filter(
      (p) => p.status === 'completed'
    );
    const refundedPurchases = allPurchases.filter((p) => p.status === 'refunded');

    const totalSpent = completedPurchases.reduce(
      (sum, p) => sum + p.amount,
      0
    );
    const totalRefunded = refundedPurchases.reduce(
      (sum, p) => sum + p.amount,
      0
    );

    res.json({
      success: true,
      data: {
        totalPurchases: allPurchases.length,
        completedPurchases: completedPurchases.length,
        refundedPurchases: refundedPurchases.length,
        totalSpentCents: totalSpent,
        totalRefundedCents: totalRefunded,
        netSpentCents: totalSpent - totalRefunded,
      },
    });
  } catch (error) {
    logger.error('Get purchase stats error', error as Error, { component: 'Purchases' });
    res.status(500).json({ success: false, error: 'Failed to fetch purchase stats' });
  }
});

/**
 * @openapi
 * /api/purchases/history:
 *   get:
 *     summary: Get purchase history
 *     tags: [Purchases]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: limit
 *         in: query
 *         schema:
 *           type: integer
 *           default: 50
 *           maximum: 200
 *       - name: offset
 *         in: query
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Purchase history with game details
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
 *                     purchases:
 *                       type: array
 *                       items:
 *                         type: object
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
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/history', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const purchaseHistory = await db
      .select({
        purchase: purchases,
        game: games,
      })
      .from(purchases)
      .innerJoin(games, eq(purchases.gameId, games.id))
      .where(eq(purchases.userId, authReq.user!.id))
      .orderBy(desc(purchases.createdAt))
      .limit(limit)
      .offset(offset);

    // Get total count
    const allPurchases = await db
      .select({ id: purchases.id })
      .from(purchases)
      .where(eq(purchases.userId, authReq.user!.id));

    const total = allPurchases.length;

    res.json({
      success: true,
      data: {
        purchases: purchaseHistory.map((item) => ({
          ...item.purchase,
          game: item.game,
        })),
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    logger.error('Get purchase history error', error as Error, { component: 'Purchases' });
    res.status(500).json({ success: false, error: 'Failed to fetch purchase history' });
  }
});

/**
 * @openapi
 * /api/purchases/buy/{gameId}:
 *   post:
 *     summary: Purchase a game
 *     description: Free games are added immediately. Paid games redirect to checkout or return payment details.
 *     tags: [Purchases]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: gameId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               provider:
 *                 type: string
 *                 enum: [stripe, paypal]
 *                 description: Payment provider (required for paid games to create checkout)
 *     responses:
 *       200:
 *         description: Free game purchased or checkout session created
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: object
 *                   description: Free game purchase
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     data:
 *                       type: object
 *                       properties:
 *                         purchase:
 *                           type: object
 *                         libraryItem:
 *                           type: object
 *                         message:
 *                           type: string
 *                 - type: object
 *                   description: Paid game checkout
 *                   properties:
 *                     success:
 *                       type: boolean
 *                     data:
 *                       type: object
 *                       properties:
 *                         requiresPayment:
 *                           type: boolean
 *                         checkoutUrl:
 *                           type: string
 *                         sessionId:
 *                           type: string
 *                         provider:
 *                           type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       402:
 *         description: Payment required
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 error:
 *                   type: string
 *                 requiresPayment:
 *                   type: boolean
 *                 price:
 *                   type: number
 *                 currency:
 *                   type: string
 *                 availableProviders:
 *                   type: array
 *                   items:
 *                     type: string
 *                 checkoutEndpoint:
 *                   type: string
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/buy/:gameId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;
    const { provider } = req.body;

    // Get game details
    const [game] = await db
      .select()
      .from(games)
      .where(and(eq(games.id, gameId), eq(games.status, 'published')))
      .limit(1);

    if (!game) {
      res.status(404).json({ success: false, error: 'Game not found' });
      return;
    }

    // Check if already owned
    const [existingLibraryItem] = await db
      .select()
      .from(userLibrary)
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, gameId)
        )
      )
      .limit(1);

    if (existingLibraryItem) {
      res.status(400).json({ success: false, error: 'Game already owned' });
      return;
    }

    // For paid games, redirect to payment checkout
    if (game.price > 0) {
      const paymentService = getPaymentService();
      const availableProviders = paymentService.getAvailableProviders();

      // If a provider is specified, create a checkout session
      if (provider) {
        const validProviders: PaymentProvider[] = ['stripe', 'paypal'];
        if (!validProviders.includes(provider)) {
          res.status(400).json({
            success: false,
            error: 'Invalid payment provider',
            validProviders,
          });
          return;
        }

        if (!paymentService.isProviderAvailable(provider)) {
          res.status(400).json({
            success: false,
            error: `Payment provider ${provider} is not available`,
            availableProviders,
          });
          return;
        }

        // Build checkout URLs (provider-specific placeholders)
        const baseUrl = FRONTEND_URL || `http://localhost:${FRONTEND_PORT}`;
        // Stripe replaces {CHECKOUT_SESSION_ID}; PayPal appends its own token/PayerID params
        const successUrl = provider === 'stripe'
          ? `${baseUrl}/store/purchase-success?session_id={CHECKOUT_SESSION_ID}&game_id=${gameId}&provider=stripe`
          : `${baseUrl}/store/purchase-success?game_id=${gameId}&provider=paypal`;
        const cancelUrl = `${baseUrl}/store/games/${gameId}`;

        const session = await paymentService.createCheckout({
          userId: authReq.user!.id,
          userEmail: authReq.user!.email,
          gameId,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider,
          successUrl,
          cancelUrl,
        });

        res.json({
          success: true,
          data: {
            requiresPayment: true,
            checkoutUrl: session.url,
            sessionId: session.id,
            provider: session.provider,
          },
        });
        return;
      }

      // No provider specified - return payment required response
      res.status(402).json({
        success: false,
        error: 'Payment required',
        requiresPayment: true,
        price: game.price,
        currency: game.currency,
        availableProviders,
        checkoutEndpoint: '/api/payments/checkout',
      });
      return;
    }

    // Free game - complete purchase directly
    const purchaseId = uuidv4();
    const [purchase] = await db
      .insert(purchases)
      .values({
        id: purchaseId,
        userId: authReq.user!.id,
        gameId,
        amount: 0,
        currency: game.currency,
        status: 'completed',
        paymentMethod: 'free',
        completedAt: new Date(),
      })
      .returning();

    // Add to library
    const libraryItemId = uuidv4();
    const [libraryItem] = await db
      .insert(userLibrary)
      .values({
        id: libraryItemId,
        userId: authReq.user!.id,
        gameId,
        purchaseId,
      })
      .returning();

    // Remove from wishlist if present
    await db
      .delete(wishlists)
      .where(
        and(
          eq(wishlists.userId, authReq.user!.id),
          eq(wishlists.gameId, gameId)
        )
      );

    // Increment download count
    await db
      .update(games)
      .set({ downloadCount: game.downloadCount + 1 })
      .where(eq(games.id, gameId));

    logger.info(`User ${authReq.user!.id} acquired free game ${gameId}`, {
      component: 'Purchases',
      purchaseId,
    });

    res.json({
      success: true,
      data: {
        purchase,
        libraryItem,
        message: 'Game added to library',
      },
    });
  } catch (error) {
    logger.error('Purchase game error', error as Error, { component: 'Purchases' });
    res.status(500).json({ success: false, error: 'Failed to complete purchase' });
  }
});

/**
 * @openapi
 * /api/purchases/{purchaseId}:
 *   get:
 *     summary: Get specific purchase details
 *     tags: [Purchases]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: purchaseId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Purchase details with game information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:purchaseId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const purchaseId = req.params.purchaseId;

    const [purchase] = await db
      .select({
        purchase: purchases,
        game: games,
      })
      .from(purchases)
      .innerJoin(games, eq(purchases.gameId, games.id))
      .where(
        and(
          eq(purchases.id, purchaseId),
          eq(purchases.userId, authReq.user!.id)
        )
      )
      .limit(1);

    if (!purchase) {
      res.status(404).json({ success: false, error: 'Purchase not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        ...purchase.purchase,
        game: purchase.game,
      },
    });
  } catch (error) {
    logger.error('Get purchase error', error as Error, { component: 'Purchases' });
    res.status(500).json({ success: false, error: 'Failed to fetch purchase' });
  }
});

/**
 * @openapi
 * /api/purchases/{purchaseId}/refund:
 *   post:
 *     summary: Request refund for a purchase
 *     description: Submit a refund request (requires admin approval, within 14 days)
 *     tags: [Purchases]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: purchaseId
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
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *                 minLength: 10
 *     responses:
 *       200:
 *         description: Refund request submitted
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
 *                     purchase:
 *                       type: object
 *                     message:
 *                       type: string
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:purchaseId/refund', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const purchaseId = req.params.purchaseId;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      res.status(400).json({
        success: false,
        error: 'Refund reason is required (minimum 10 characters)',
      });
      return;
    }

    const [purchase] = await db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.id, purchaseId),
          eq(purchases.userId, authReq.user!.id)
        )
      )
      .limit(1);

    if (!purchase) {
      res.status(404).json({ success: false, error: 'Purchase not found' });
      return;
    }

    if (purchase.status === 'refunded') {
      res.status(400).json({ success: false, error: 'Purchase already refunded' });
      return;
    }

    if (purchase.status === 'pending_refund') {
      res.status(400).json({ success: false, error: 'Refund already pending approval' });
      return;
    }

    if (purchase.status !== 'completed') {
      res.status(400).json({ success: false, error: 'Purchase not eligible for refund' });
      return;
    }

    // Check refund eligibility (e.g., within 14 days)
    const daysSincePurchase = Math.floor(
      (Date.now() - new Date(purchase.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSincePurchase > 14) {
      res.status(400).json({
        success: false,
        error: 'Refund period expired (14 days)',
      });
      return;
    }

    // Set refund as pending - requires admin approval
    // Library access is NOT removed until admin approves
    const [pendingRefund] = await db
      .update(purchases)
      .set({
        status: 'pending_refund',
        refundReason: reason.trim(),
      })
      .where(eq(purchases.id, purchaseId))
      .returning();

    logger.info(`Refund requested for purchase ${purchaseId}`, {
      component: 'Purchases',
      userId: authReq.user!.id,
      gameId: purchase.gameId,
      status: 'pending_refund',
    });

    res.json({
      success: true,
      data: {
        purchase: pendingRefund,
        message: 'Refund request submitted. An administrator will review your request.',
      },
    });
  } catch (error) {
    logger.error('Refund error', error as Error, { component: 'Purchases' });
    res.status(500).json({ success: false, error: 'Failed to process refund' });
  }
});

export default router;
