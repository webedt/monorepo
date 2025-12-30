/**
 * Payment Routes
 * Handles Stripe and PayPal payment processing
 */

/**
 * @openapi
 * tags:
 *   - name: Payments
 *     description: Payment processing with Stripe and PayPal
 */

import { Router, Request, Response } from 'express';
import { db, games, paymentTransactions, userLibrary, eq, and, desc, sql, getPaymentService, FRONTEND_URL, FRONTEND_PORT, getRawBody } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';

import type { PaymentProvider } from '@webedt/shared';

const router = Router();

/**
 * @openapi
 * /api/payments/providers:
 *   get:
 *     summary: Get available payment providers
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Available payment providers
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
 *                     providers:
 *                       type: array
 *                       items:
 *                         type: string
 *                     stripe:
 *                       type: boolean
 *                     paypal:
 *                       type: boolean
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/providers', (req: Request, res: Response) => {
  try {
    const paymentService = getPaymentService();
    const providers = paymentService.getAvailableProviders();

    res.json({
      success: true,
      data: {
        providers,
        stripe: paymentService.isProviderAvailable('stripe'),
        paypal: paymentService.isProviderAvailable('paypal'),
      },
    });
  } catch (error) {
    logger.error('Get providers error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Failed to get providers' });
  }
});

/**
 * @openapi
 * /api/payments/checkout:
 *   post:
 *     summary: Create a checkout session
 *     tags: [Payments]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - gameId
 *             properties:
 *               gameId:
 *                 type: string
 *               provider:
 *                 type: string
 *                 enum: [stripe, paypal]
 *                 default: stripe
 *     responses:
 *       200:
 *         description: Checkout session created
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
 *                     sessionId:
 *                       type: string
 *                     url:
 *                       type: string
 *                     provider:
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
router.post('/checkout', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { gameId, provider = 'stripe' } = req.body;

    if (!gameId) {
      res.status(400).json({ success: false, error: 'Game ID is required' });
      return;
    }

    // Validate provider
    const validProviders: PaymentProvider[] = ['stripe', 'paypal'];
    if (!validProviders.includes(provider)) {
      res.status(400).json({
        success: false,
        error: 'Invalid payment provider',
        validProviders,
      });
      return;
    }

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

    if (game.price === 0) {
      res.status(400).json({
        success: false,
        error: 'This game is free. Use the purchase endpoint instead.',
      });
      return;
    }

    // Check if user already owns this game (duplicate purchase protection)
    const [existingOwnership] = await db
      .select()
      .from(userLibrary)
      .where(
        and(
          eq(userLibrary.userId, authReq.user!.id),
          eq(userLibrary.gameId, gameId)
        )
      )
      .limit(1);

    if (existingOwnership) {
      res.status(400).json({
        success: false,
        error: 'You already own this game',
      });
      return;
    }

    const paymentService = getPaymentService();

    if (!paymentService.isProviderAvailable(provider)) {
      res.status(400).json({
        success: false,
        error: `Payment provider ${provider} is not available`,
        availableProviders: paymentService.getAvailableProviders(),
      });
      return;
    }

    // Build success and cancel URLs (provider-specific placeholders)
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

    logger.info('Checkout session created', {
      component: 'Payments',
      userId: authReq.user!.id,
      gameId,
      provider,
      sessionId: session.id,
    });

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        url: session.url,
        provider: session.provider,
      },
    });
  } catch (error) {
    logger.error('Create checkout error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Failed to create checkout session' });
  }
});

/**
 * @openapi
 * /api/payments/checkout/{sessionId}:
 *   get:
 *     summary: Get checkout session status
 *     tags: [Payments]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: sessionId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Checkout session details
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
 *                     id:
 *                       type: string
 *                     status:
 *                       type: string
 *                     amount:
 *                       type: number
 *                     currency:
 *                       type: string
 *                     provider:
 *                       type: string
 *                     purchaseId:
 *                       type: string
 *                       nullable: true
 *                     createdAt:
 *                       type: string
 *                       format: date-time
 *                     completedAt:
 *                       type: string
 *                       format: date-time
 *                       nullable: true
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/checkout/:sessionId', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { sessionId } = req.params;

    // Find transaction
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.providerSessionId, sessionId),
          eq(paymentTransactions.userId, authReq.user!.id)
        )
      )
      .limit(1);

    if (!transaction) {
      res.status(404).json({ success: false, error: 'Session not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        id: transaction.id,
        status: transaction.status,
        amount: transaction.amount,
        currency: transaction.currency,
        provider: transaction.provider,
        purchaseId: transaction.purchaseId,
        createdAt: transaction.createdAt,
        completedAt: transaction.completedAt,
      },
    });
  } catch (error) {
    logger.error('Get checkout status error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Failed to get checkout status' });
  }
});

/**
 * @openapi
 * /api/payments/paypal/capture:
 *   post:
 *     summary: Capture PayPal order after user approval
 *     tags: [Payments]
 *     security:
 *       - sessionAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - orderId
 *             properties:
 *               orderId:
 *                 type: string
 *     responses:
 *       200:
 *         description: PayPal order captured successfully
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
 *                     transactionId:
 *                       type: string
 *                     purchaseId:
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
router.post('/paypal/capture', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { orderId } = req.body;

    if (!orderId) {
      res.status(400).json({ success: false, error: 'Order ID is required' });
      return;
    }

    // Verify the order belongs to this user
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.providerTransactionId, orderId),
          eq(paymentTransactions.userId, authReq.user!.id),
          eq(paymentTransactions.provider, 'paypal')
        )
      )
      .limit(1);

    if (!transaction) {
      res.status(404).json({ success: false, error: 'Order not found' });
      return;
    }

    const paymentService = getPaymentService();
    const result = await paymentService.capturePayPalOrder(orderId);

    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    logger.info('PayPal order captured', {
      component: 'Payments',
      userId: authReq.user!.id,
      orderId,
      purchaseId: result.purchaseId,
    });

    res.json({
      success: true,
      data: {
        transactionId: result.transactionId,
        purchaseId: result.purchaseId,
      },
    });
  } catch (error) {
    logger.error('PayPal capture error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Failed to capture PayPal order' });
  }
});

/**
 * @openapi
 * /api/payments/webhooks/stripe:
 *   post:
 *     summary: Stripe webhook handler
 *     description: Handles Stripe payment events (signature verification required)
 *     tags: [Payments]
 *     parameters:
 *       - name: stripe-signature
 *         in: header
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 received:
 *                   type: boolean
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post(
  '/webhooks/stripe',
  // Raw body needed for webhook signature verification
  async (req: Request, res: Response) => {
    try {
      const signature = req.headers['stripe-signature'] as string;
      if (!signature) {
        res.status(400).json({ success: false, error: 'Missing signature' });
        return;
      }

      // Get raw body - Express body-parser must be configured to preserve raw body
      // Signature verification requires the raw body; JSON.stringify() won't work
      const rawBody = getRawBody(req);
      if (!rawBody) {
        logger.warn('Stripe webhook missing raw body - configure express.raw() middleware', {
          component: 'Payments',
        });
        res.status(400).json({ success: false, error: 'Missing raw body for signature verification' });
        return;
      }

      const paymentService = getPaymentService();
      const result = await paymentService.processWebhook('stripe', rawBody, signature);

      if (!result.success) {
        logger.warn('Stripe webhook processing failed', {
          component: 'Payments',
          error: result.error,
        });
        res.status(400).json({ success: false, error: result.error });
        return;
      }

      logger.info('Stripe webhook processed', {
        component: 'Payments',
        transactionId: result.transactionId,
        purchaseId: result.purchaseId,
      });

      res.json({ success: true, received: true });
    } catch (error) {
      logger.error('Stripe webhook error', error as Error, { component: 'Payments' });
      res.status(500).json({ success: false, error: 'Webhook processing failed' });
    }
  }
);

/**
 * @openapi
 * /api/payments/webhooks/paypal:
 *   post:
 *     summary: PayPal webhook handler
 *     description: Handles PayPal payment events (signature verification required)
 *     tags: [Payments]
 *     parameters:
 *       - name: paypal-transmission-id
 *         in: header
 *         required: true
 *         schema:
 *           type: string
 *       - name: paypal-transmission-time
 *         in: header
 *         required: true
 *         schema:
 *           type: string
 *       - name: paypal-transmission-sig
 *         in: header
 *         required: true
 *         schema:
 *           type: string
 *       - name: paypal-auth-algo
 *         in: header
 *         schema:
 *           type: string
 *       - name: paypal-cert-url
 *         in: header
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Webhook processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 received:
 *                   type: boolean
 *       400:
 *         $ref: '#/components/responses/BadRequest'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/webhooks/paypal', async (req: Request, res: Response) => {
  try {
    // PayPal sends webhook headers with signature info
    const transmissionId = req.headers['paypal-transmission-id'] as string;
    const timestamp = req.headers['paypal-transmission-time'] as string;
    const transmissionSig = req.headers['paypal-transmission-sig'] as string;
    const algo = req.headers['paypal-auth-algo'] as string;
    const certUrl = req.headers['paypal-cert-url'] as string;

    if (!transmissionId || !timestamp || !transmissionSig) {
      res.status(400).json({ success: false, error: 'Missing PayPal headers' });
      return;
    }

    // Get raw body - prefer rawBody from middleware, fall back to JSON.stringify for compatibility
    // Note: For production, configure express.raw() middleware to preserve raw body
    const rawBody = getRawBody(req) ?? JSON.stringify(req.body);

    // Construct signature string for verification (pipe-delimited format expected by paypalProvider)
    const signature = `${transmissionId}|${timestamp}|${transmissionSig}|${algo}|${certUrl}`;

    const paymentService = getPaymentService();
    const result = await paymentService.processWebhook('paypal', rawBody, signature);

    if (!result.success) {
      logger.warn('PayPal webhook processing failed', {
        component: 'Payments',
        error: result.error,
      });
      res.status(400).json({ success: false, error: result.error });
      return;
    }

    logger.info('PayPal webhook processed', {
      component: 'Payments',
      transactionId: result.transactionId,
      purchaseId: result.purchaseId,
    });

    res.json({ success: true, received: true });
  } catch (error) {
    logger.error('PayPal webhook error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Webhook processing failed' });
  }
});

/**
 * @openapi
 * /api/payments/transactions:
 *   get:
 *     summary: Get user's payment transaction history
 *     tags: [Payments]
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
 *         description: Transaction history retrieved
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
 *                     transactions:
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
router.get('/transactions', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;

    const transactions = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.userId, authReq.user!.id))
      .orderBy(desc(paymentTransactions.createdAt))
      .limit(limit)
      .offset(offset);

    // Use efficient COUNT query instead of fetching all IDs
    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(paymentTransactions)
      .where(eq(paymentTransactions.userId, authReq.user!.id));

    const total = Number(countResult?.count ?? 0);

    res.json({
      success: true,
      data: {
        transactions,
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    });
  } catch (error) {
    logger.error('Get transactions error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Failed to get transactions' });
  }
});

/**
 * @openapi
 * /api/payments/transactions/{transactionId}/refund:
 *   post:
 *     summary: Request refund for a transaction
 *     description: Submit a refund request (requires admin approval, within 14 days)
 *     tags: [Payments]
 *     security:
 *       - sessionAuth: []
 *     parameters:
 *       - name: transactionId
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
router.post('/transactions/:transactionId/refund', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { transactionId } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 10) {
      res.status(400).json({
        success: false,
        error: 'Refund reason is required (minimum 10 characters)',
      });
      return;
    }

    // Find transaction
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.id, transactionId),
          eq(paymentTransactions.userId, authReq.user!.id)
        )
      )
      .limit(1);

    if (!transaction) {
      res.status(404).json({ success: false, error: 'Transaction not found' });
      return;
    }

    if (transaction.status !== 'succeeded') {
      res.status(400).json({ success: false, error: 'Transaction not eligible for refund' });
      return;
    }

    // Check refund eligibility (within 14 days)
    const daysSincePayment = Math.floor(
      (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSincePayment > 14) {
      res.status(400).json({
        success: false,
        error: 'Refund period expired (14 days)',
      });
      return;
    }

    // Update status to pending_refund - admin would then approve and trigger actual refund
    await db
      .update(paymentTransactions)
      .set({
        status: 'pending_refund',
        metadata: {
          ...transaction.metadata,
          refundReason: reason.trim(),
          refundRequestedAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, transactionId));

    logger.info('Refund requested', {
      component: 'Payments',
      transactionId,
      userId: authReq.user!.id,
    });

    res.json({
      success: true,
      data: {
        message: 'Refund request submitted. An administrator will review your request.',
      },
    });
  } catch (error) {
    logger.error('Request refund error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Failed to request refund' });
  }
});

/**
 * @openapi
 * /api/payments/health:
 *   get:
 *     summary: Payment provider health check
 *     tags: [Payments]
 *     responses:
 *       200:
 *         description: Health status of all payment providers
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
 *                     healthy:
 *                       type: boolean
 *                     providers:
 *                       type: array
 *                       items:
 *                         type: object
 *                         properties:
 *                           provider:
 *                             type: string
 *                           healthy:
 *                             type: boolean
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/health', async (req: Request, res: Response) => {
  try {
    const paymentService = getPaymentService();
    const healthStatus = await paymentService.healthCheck();

    const allHealthy = healthStatus.every((s) => s.healthy);

    res.json({
      success: true,
      data: {
        healthy: allHealthy,
        providers: healthStatus,
      },
    });
  } catch (error) {
    logger.error('Payment health check error', error as Error, { component: 'Payments' });
    res.status(500).json({ success: false, error: 'Health check failed' });
  }
});

export default router;
