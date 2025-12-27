/**
 * Purchases Routes
 * Handles game purchases and transaction history
 */

import { Router, Request, Response } from 'express';
import { db, games, userLibrary, purchases, wishlists, eq, and, desc } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// All routes require authentication
router.use(requireAuth);

// Purchase a game
router.post('/buy/:gameId', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const gameId = req.params.gameId;
    const { paymentMethod = 'free' } = req.body;

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

    // For free games, we can proceed directly
    // For paid games, this would integrate with a payment processor
    if (game.price > 0 && paymentMethod === 'free') {
      res.status(400).json({
        success: false,
        error: 'Payment required for this game',
        price: game.price,
        currency: game.currency,
      });
      return;
    }

    // Create purchase record
    const purchaseId = uuidv4();
    const [purchase] = await db
      .insert(purchases)
      .values({
        id: purchaseId,
        userId: authReq.user!.id,
        gameId,
        amount: game.price,
        currency: game.currency,
        status: 'completed',
        paymentMethod: game.price === 0 ? 'free' : paymentMethod,
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

    logger.info(`User ${authReq.user!.id} purchased game ${gameId}`, {
      component: 'Purchases',
      purchaseId,
      amount: game.price,
    });

    res.json({
      success: true,
      data: {
        purchase,
        libraryItem,
        message: game.price === 0 ? 'Game added to library' : 'Purchase complete',
      },
    });
  } catch (error) {
    logger.error('Purchase game error', error as Error, { component: 'Purchases' });
    res.status(500).json({ success: false, error: 'Failed to complete purchase' });
  }
});

// Get purchase history
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

// Request refund (admin approval would be needed in production)
router.post('/:purchaseId/refund', async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const purchaseId = req.params.purchaseId;
    const { reason } = req.body;

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

    // Process refund
    const [refundedPurchase] = await db
      .update(purchases)
      .set({
        status: 'refunded',
        refundedAt: new Date(),
        refundReason: reason || 'User requested refund',
      })
      .where(eq(purchases.id, purchaseId))
      .returning();

    // Remove from library
    await db
      .delete(userLibrary)
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, purchase.gameId)
        )
      );

    // Decrement download count
    const [game] = await db
      .select()
      .from(games)
      .where(eq(games.id, purchase.gameId))
      .limit(1);

    if (game) {
      await db
        .update(games)
        .set({ downloadCount: Math.max(0, game.downloadCount - 1) })
        .where(eq(games.id, purchase.gameId));
    }

    logger.info(`Refund processed for purchase ${purchaseId}`, {
      component: 'Purchases',
      userId: authReq.user!.id,
      gameId: purchase.gameId,
    });

    res.json({
      success: true,
      data: {
        purchase: refundedPurchase,
        message: 'Refund processed successfully',
      },
    });
  } catch (error) {
    logger.error('Refund error', error as Error, { component: 'Purchases' });
    res.status(500).json({ success: false, error: 'Failed to process refund' });
  }
});

// Get purchase statistics
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

export default router;
