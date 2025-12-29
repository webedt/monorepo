/**
 * Purchases Routes
 * Handles game purchases and transaction history
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, purchases, wishlists, eq, and, desc, getPaymentService } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import {
  sendSuccess,
  sendError,
  sendNotFound,
  sendForbidden,
  sendInternalError,
} from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

import type { PaymentProvider } from '@webedt/shared';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Get purchase statistics (must be before /:purchaseId to avoid being treated as purchaseId)
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

    sendSuccess(res, {
      totalPurchases: allPurchases.length,
      completedPurchases: completedPurchases.length,
      refundedPurchases: refundedPurchases.length,
      totalSpentCents: totalSpent,
      totalRefundedCents: totalRefunded,
      netSpentCents: totalSpent - totalRefunded,
    });
  } catch (error) {
    logger.error('Get purchase stats error', error as Error, { component: 'Purchases' });
    sendInternalError(res, 'Failed to fetch purchase stats');
  }
});

// Get purchase history (must be before /:purchaseId to avoid being treated as purchaseId)
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

    sendSuccess(res, {
      purchases: purchaseHistory.map((item) => ({
        ...item.purchase,
        game: item.game,
      })),
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (error) {
    logger.error('Get purchase history error', error as Error, { component: 'Purchases' });
    sendInternalError(res, 'Failed to fetch purchase history');
  }
});

// Purchase a game (free games only - paid games use /api/payments/checkout)
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
      sendNotFound(res, 'Game not found');
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
      sendError(res, 'Game already owned', 400);
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
          sendError(res, 'Invalid payment provider', 400);
          return;
        }

        if (!paymentService.isProviderAvailable(provider)) {
          sendError(res, `Payment provider ${provider} is not available`, 400);
          return;
        }

        // Build checkout URLs (provider-specific placeholders)
        const baseUrl = process.env.FRONTEND_URL || `http://localhost:${process.env.FRONTEND_PORT || 3000}`;
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

        sendSuccess(res, {
          requiresPayment: true,
          checkoutUrl: session.url,
          sessionId: session.id,
          provider: session.provider,
        });
        return;
      }

      // No provider specified - return payment required response
      sendError(res, 'Payment required', 402);
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

    sendSuccess(res, {
      purchase,
      libraryItem,
      message: 'Game added to library',
    });
  } catch (error) {
    logger.error('Purchase game error', error as Error, { component: 'Purchases' });
    sendInternalError(res, 'Failed to complete purchase');
  }
});

// Get specific purchase
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
      sendNotFound(res, 'Purchase not found');
      return;
    }

    sendSuccess(res, {
      ...purchase.purchase,
      game: purchase.game,
    });
  } catch (error) {
    logger.error('Get purchase error', error as Error, { component: 'Purchases' });
    sendInternalError(res, 'Failed to fetch purchase');
  }
});

// Request refund (requires admin approval)
router.post('/:purchaseId/refund', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const purchaseId = req.params.purchaseId;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      sendError(res, 'Refund reason is required (minimum 10 characters)', 400);
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
      sendNotFound(res, 'Purchase not found');
      return;
    }

    if (purchase.status === 'refunded') {
      sendError(res, 'Purchase already refunded', 400);
      return;
    }

    if (purchase.status === 'pending_refund') {
      sendError(res, 'Refund already pending approval', 400);
      return;
    }

    if (purchase.status !== 'completed') {
      sendError(res, 'Purchase not eligible for refund', 400);
      return;
    }

    // Check refund eligibility (e.g., within 14 days)
    const daysSincePurchase = Math.floor(
      (Date.now() - new Date(purchase.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSincePurchase > 14) {
      sendError(res, 'Refund period expired (14 days)', 400);
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

    sendSuccess(res, {
      purchase: pendingRefund,
      message: 'Refund request submitted. An administrator will review your request.',
    });
  } catch (error) {
    logger.error('Refund error', error as Error, { component: 'Purchases' });
    sendInternalError(res, 'Failed to process refund');
  }
});

export default router;
