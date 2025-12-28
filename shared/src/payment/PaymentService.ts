/**
 * Payment Service
 * Manages payment providers and coordinates payment operations
 */

import { v4 as uuidv4 } from 'uuid';
import { eq, and } from 'drizzle-orm';
import { db } from '../db/index.js';
import { paymentTransactions, paymentWebhooks, purchases, userLibrary, wishlists, games } from '../db/schema.js';
import { logger } from '../utils/logging/logger.js';
import { APaymentProvider } from './APaymentProvider.js';
import { createStripeProvider, StripeProvider } from './stripeProvider.js';
import { createPayPalProvider, PayPalProvider } from './paypalProvider.js';

import type { CheckoutSession } from './types.js';
import type { CreateCheckoutRequest } from './types.js';
import type { CurrencyCode } from './types.js';
import type { PaymentProvider } from './types.js';
import type { ProviderHealthStatus } from './types.js';
import type { RefundRequest } from './types.js';
import type { RefundResult } from './types.js';
import type { WebhookEvent } from './types.js';

const VALID_CURRENCY_CODES: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

/**
 * Validates and returns a currency code, defaulting to USD if invalid
 */
function toCurrencyCode(currency: string): CurrencyCode {
  const upper = currency.toUpperCase() as CurrencyCode;
  return VALID_CURRENCY_CODES.includes(upper) ? upper : 'USD';
}

export interface CreateCheckoutOptions {
  userId: string;
  userEmail: string;
  gameId: string;
  gameName: string;
  amount: number;
  currency: string;
  provider: PaymentProvider;
  successUrl: string;
  cancelUrl: string;
}

export interface ProcessWebhookResult {
  success: boolean;
  transactionId?: string;
  purchaseId?: string;
  error?: string;
}

export class PaymentService {
  private providers: Map<PaymentProvider, APaymentProvider> = new Map();

  constructor() {
    this.initializeProviders();
  }

  private initializeProviders(): void {
    const stripe = createStripeProvider();
    if (stripe) {
      this.providers.set('stripe', stripe);
      logger.info('Stripe payment provider initialized', {
        component: 'PaymentService',
      });
    }

    const paypal = createPayPalProvider();
    if (paypal) {
      this.providers.set('paypal', paypal);
      logger.info('PayPal payment provider initialized', {
        component: 'PaymentService',
      });
    }

    if (this.providers.size === 0) {
      logger.warn('No payment providers configured', {
        component: 'PaymentService',
      });
    }
  }

  getProvider(provider: PaymentProvider): APaymentProvider | undefined {
    return this.providers.get(provider);
  }

  getAvailableProviders(): PaymentProvider[] {
    return Array.from(this.providers.keys());
  }

  isProviderAvailable(provider: PaymentProvider): boolean {
    return this.providers.has(provider);
  }

  async createCheckout(options: CreateCheckoutOptions): Promise<CheckoutSession> {
    // Validate amount (must be a positive integer representing cents/smallest currency unit)
    if (!Number.isInteger(options.amount) || options.amount <= 0) {
      throw new Error(`Invalid amount: ${options.amount}. Amount must be a positive integer in smallest currency unit (e.g., cents)`);
    }

    const provider = this.getProvider(options.provider);
    if (!provider) {
      throw new Error(`Payment provider ${options.provider} not available`);
    }

    const transactionId = uuidv4();

    logger.info('Creating checkout session', {
      component: 'PaymentService',
      provider: options.provider,
      userId: options.userId,
      gameId: options.gameId,
      amount: options.amount,
    });

    // Create checkout request with validated currency
    const validatedCurrency = toCurrencyCode(options.currency);
    const request: CreateCheckoutRequest = {
      customer: {
        id: options.userId,
        email: options.userEmail,
      },
      lineItems: [
        {
          id: options.gameId,
          name: options.gameName,
          amount: options.amount,
          currency: validatedCurrency,
          quantity: 1,
        },
      ],
      metadata: {
        userId: options.userId,
        gameId: options.gameId,
        transactionId,
      },
      successUrl: options.successUrl,
      cancelUrl: options.cancelUrl,
    };

    const session = await provider.createCheckoutSession(request);

    // Store transaction in database
    await db.insert(paymentTransactions).values({
      id: transactionId,
      userId: options.userId,
      provider: options.provider,
      providerTransactionId: session.id,
      providerSessionId: session.id,
      type: 'checkout',
      status: 'pending',
      amount: options.amount,
      currency: options.currency,
      metadata: {
        gameId: options.gameId,
        gameName: options.gameName,
        customerEmail: options.userEmail,
      },
    });

    logger.info('Checkout session created', {
      component: 'PaymentService',
      transactionId,
      sessionId: session.id,
    });

    return session;
  }

  async processWebhook(
    provider: PaymentProvider,
    payload: string | Buffer,
    signature: string
  ): Promise<ProcessWebhookResult> {
    const paymentProvider = this.getProvider(provider);
    if (!paymentProvider) {
      return { success: false, error: `Provider ${provider} not available` };
    }

    // Verify webhook signature
    const verification = await paymentProvider.verifyWebhook(payload, signature);
    if (!verification.isValid) {
      logger.warn('Webhook verification failed', {
        component: 'PaymentService',
        provider,
        error: verification.error,
      });
      return { success: false, error: verification.error };
    }

    if (!verification.event) {
      // Valid but unhandled event type
      return { success: true };
    }

    // Log webhook event
    const webhookId = uuidv4();
    await db.insert(paymentWebhooks).values({
      id: webhookId,
      provider,
      eventId: verification.event.id,
      eventType: verification.event.type,
      payload: verification.event.rawPayload as Record<string, unknown>,
    });

    try {
      const result = await this.handleWebhookEvent(verification.event);

      // Update webhook as processed
      await db
        .update(paymentWebhooks)
        .set({
          transactionId: result.transactionId,
          processed: true,
          processedAt: new Date(),
        })
        .where(eq(paymentWebhooks.id, webhookId));

      return result;
    } catch (error) {
      // Log error
      await db
        .update(paymentWebhooks)
        .set({
          processed: true,
          processedAt: new Date(),
          error: (error as Error).message,
        })
        .where(eq(paymentWebhooks.id, webhookId));

      logger.error('Webhook processing failed', error as Error, {
        component: 'PaymentService',
        provider,
        eventType: verification.event.type,
      });

      return { success: false, error: (error as Error).message };
    }
  }

  private async handleWebhookEvent(event: WebhookEvent): Promise<ProcessWebhookResult> {
    logger.info('Processing webhook event', {
      component: 'PaymentService',
      eventType: event.type,
      provider: event.provider,
    });

    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event);

      case 'payment_intent.succeeded':
        return this.handlePaymentSucceeded(event);

      case 'payment_intent.payment_failed':
        return this.handlePaymentFailed(event);

      case 'charge.refunded':
        return this.handleRefund(event);

      default:
        logger.info('Unhandled webhook event type', {
          component: 'PaymentService',
          eventType: event.type,
        });
        return { success: true };
    }
  }

  private async handleCheckoutCompleted(event: WebhookEvent): Promise<ProcessWebhookResult> {
    const { checkoutSessionId, metadata } = event.data;

    if (!metadata?.userId || !metadata?.gameId) {
      return { success: false, error: 'Missing required metadata' };
    }

    // Find the transaction
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.providerSessionId, checkoutSessionId || ''))
      .limit(1);

    if (!transaction) {
      logger.warn('Transaction not found for checkout session', {
        component: 'PaymentService',
        sessionId: checkoutSessionId,
      });
      return { success: false, error: 'Transaction not found' };
    }

    // Update transaction status
    await db
      .update(paymentTransactions)
      .set({
        status: 'succeeded',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, transaction.id));

    // Create purchase and add to library
    const purchaseResult = await this.completePurchase(
      metadata.userId,
      metadata.gameId,
      transaction.id,
      transaction.amount,
      transaction.currency,
      event.provider
    );

    return {
      success: true,
      transactionId: transaction.id,
      purchaseId: purchaseResult.purchaseId,
    };
  }

  private async handlePaymentSucceeded(event: WebhookEvent): Promise<ProcessWebhookResult> {
    const { paymentIntentId, metadata } = event.data;

    if (!paymentIntentId) {
      return { success: true }; // No payment intent to process
    }

    // Find transaction by payment intent ID
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.providerTransactionId, paymentIntentId))
      .limit(1);

    if (!transaction) {
      logger.warn('Transaction not found for payment intent', {
        component: 'PaymentService',
        paymentIntentId,
      });
      return { success: true }; // Not our transaction
    }

    // Update transaction status
    await db
      .update(paymentTransactions)
      .set({
        status: 'succeeded',
        completedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, transaction.id));

    // If this transaction already has a purchase, we're done
    if (transaction.purchaseId) {
      return { success: true, transactionId: transaction.id };
    }

    // Complete the purchase
    if (metadata?.userId && metadata?.gameId) {
      const purchaseResult = await this.completePurchase(
        metadata.userId,
        metadata.gameId,
        transaction.id,
        transaction.amount,
        transaction.currency,
        event.provider
      );
      return {
        success: true,
        transactionId: transaction.id,
        purchaseId: purchaseResult.purchaseId,
      };
    }

    return { success: true, transactionId: transaction.id };
  }

  private async handlePaymentFailed(event: WebhookEvent): Promise<ProcessWebhookResult> {
    const { paymentIntentId, failureReason } = event.data;

    if (!paymentIntentId) {
      return { success: true };
    }

    // Find and update transaction
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.providerTransactionId, paymentIntentId))
      .limit(1);

    if (transaction) {
      await db
        .update(paymentTransactions)
        .set({
          status: 'failed',
          errorMessage: failureReason,
          updatedAt: new Date(),
        })
        .where(eq(paymentTransactions.id, transaction.id));

      return { success: true, transactionId: transaction.id };
    }

    return { success: true };
  }

  private async handleRefund(event: WebhookEvent): Promise<ProcessWebhookResult> {
    const { paymentIntentId } = event.data;

    if (!paymentIntentId) {
      return { success: true };
    }

    // Find the original transaction
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.providerTransactionId, paymentIntentId))
      .limit(1);

    if (transaction) {
      await db
        .update(paymentTransactions)
        .set({
          status: 'refunded',
          updatedAt: new Date(),
        })
        .where(eq(paymentTransactions.id, transaction.id));

      // Update purchase status if linked
      if (transaction.purchaseId) {
        await db
          .update(purchases)
          .set({
            status: 'refunded',
            refundedAt: new Date(),
          })
          .where(eq(purchases.id, transaction.purchaseId));
      }

      return { success: true, transactionId: transaction.id };
    }

    return { success: true };
  }

  private async completePurchase(
    userId: string,
    gameId: string,
    transactionId: string,
    amount: number,
    currency: string,
    provider: PaymentProvider
  ): Promise<{ purchaseId: string }> {
    const purchaseId = uuidv4();
    const libraryItemId = uuidv4();

    // Use transaction to ensure atomicity of all related database operations
    await db.transaction(async (tx) => {
      // Create purchase record
      await tx.insert(purchases).values({
        id: purchaseId,
        userId,
        gameId,
        amount,
        currency,
        status: 'completed',
        paymentMethod: provider === 'stripe' ? 'credit_card' : 'paypal',
        paymentDetails: { transactionId },
        completedAt: new Date(),
      });

      // Link transaction to purchase
      await tx
        .update(paymentTransactions)
        .set({ purchaseId })
        .where(eq(paymentTransactions.id, transactionId));

      // Add to user library
      await tx.insert(userLibrary).values({
        id: libraryItemId,
        userId,
        gameId,
        purchaseId,
      });

      // Remove from wishlist if present (only the specific game, not all wishlisted items)
      await tx
        .delete(wishlists)
        .where(and(eq(wishlists.userId, userId), eq(wishlists.gameId, gameId)));

      // Increment purchase count (more semantically accurate than download count)
      const [game] = await tx
        .select()
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (game) {
        await tx
          .update(games)
          .set({ downloadCount: game.downloadCount + 1 })
          .where(eq(games.id, gameId));
      }
    });

    logger.info('Purchase completed via webhook', {
      component: 'PaymentService',
      purchaseId,
      userId,
      gameId,
      transactionId,
    });

    return { purchaseId };
  }

  async refund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult> {
    // Get transaction
    const [transaction] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.id, transactionId))
      .limit(1);

    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== 'succeeded') {
      throw new Error('Transaction not eligible for refund');
    }

    const provider = this.getProvider(transaction.provider as PaymentProvider);
    if (!provider) {
      throw new Error(`Provider ${transaction.provider} not available`);
    }

    const request: RefundRequest = {
      paymentIntentId: transaction.providerTransactionId,
      amount,
      reason,
    };

    const result = await provider.refund(request);

    // Create refund transaction record
    const refundTransactionId = uuidv4();
    await db.insert(paymentTransactions).values({
      id: refundTransactionId,
      userId: transaction.userId,
      purchaseId: transaction.purchaseId,
      provider: transaction.provider,
      providerTransactionId: result.id,
      type: 'refund',
      status: result.status,
      amount: result.amount.amount,
      currency: result.amount.currency,
      metadata: {
        originalTransactionId: transactionId,
      },
    });

    logger.info('Refund processed', {
      component: 'PaymentService',
      refundId: result.id,
      originalTransactionId: transactionId,
    });

    return result;
  }

  async healthCheck(): Promise<ProviderHealthStatus[]> {
    const results: ProviderHealthStatus[] = [];

    for (const [, provider] of this.providers) {
      const status = await provider.healthCheck();
      results.push(status);
    }

    return results;
  }

  /**
   * Capture a PayPal order after user approval
   */
  async capturePayPalOrder(orderId: string): Promise<ProcessWebhookResult> {
    const paypal = this.getProvider('paypal') as PayPalProvider | undefined;
    if (!paypal) {
      return { success: false, error: 'PayPal provider not available' };
    }

    try {
      const result = await paypal.captureOrder(orderId);

      // Find the transaction
      const [transaction] = await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.providerTransactionId, orderId))
        .limit(1);

      if (!transaction) {
        return { success: false, error: 'Transaction not found' };
      }

      // Update transaction status
      await db
        .update(paymentTransactions)
        .set({
          status: result.status,
          completedAt: result.status === 'succeeded' ? new Date() : undefined,
          updatedAt: new Date(),
        })
        .where(eq(paymentTransactions.id, transaction.id));

      if (result.status === 'succeeded' && result.metadata?.userId && result.metadata?.gameId) {
        const purchaseResult = await this.completePurchase(
          result.metadata.userId,
          result.metadata.gameId,
          transaction.id,
          transaction.amount,
          transaction.currency,
          'paypal'
        );

        return {
          success: true,
          transactionId: transaction.id,
          purchaseId: purchaseResult.purchaseId,
        };
      }

      return { success: true, transactionId: transaction.id };
    } catch (error) {
      logger.error('PayPal capture failed', error as Error, {
        component: 'PaymentService',
        orderId,
      });
      return { success: false, error: (error as Error).message };
    }
  }
}

// Singleton instance
let paymentServiceInstance: PaymentService | null = null;

export function getPaymentService(): PaymentService {
  if (!paymentServiceInstance) {
    paymentServiceInstance = new PaymentService();
  }
  return paymentServiceInstance;
}
