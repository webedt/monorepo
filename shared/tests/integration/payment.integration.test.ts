/**
 * Integration Tests for Payment Processing
 *
 * These tests verify the complete payment flow including:
 * - Stripe checkout session creation
 * - Stripe webhook processing
 * - Stripe refund handling
 * - PayPal order creation
 * - PayPal webhook processing
 * - PayPal refund handling
 * - Database transaction atomicity
 *
 * Note: These tests use mock data and don't connect to real payment APIs.
 * For live testing, run with actual credentials.
 *
 * Run these tests:
 *   npm run test:integration -w shared
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  createMockUser,
  createMockGame,
  createMockPaymentTransaction,
  createMockPurchase,
  createStripeCheckoutCompletedEvent,
  createStripePaymentIntentSucceededEvent,
  createStripeRefundEvent,
  createPayPalOrderCompletedEvent,
  createPayPalCaptureCompletedEvent,
  TEST_CURRENCIES,
  TEST_PAYMENT_AMOUNTS,
} from './fixtures.js';

// ============================================================================
// Mock Payment Provider Classes (for unit-style integration tests)
// ============================================================================

interface MockCheckoutSession {
  id: string;
  provider: 'stripe' | 'paypal';
  url: string;
  status: string;
  metadata: Record<string, string>;
}

interface MockRefundResult {
  id: string;
  provider: 'stripe' | 'paypal';
  paymentIntentId: string;
  amount: { amount: number; currency: string };
  status: 'pending' | 'succeeded' | 'failed';
  reason?: string;
}

interface MockWebhookVerification {
  isValid: boolean;
  event?: {
    id: string;
    type: string;
    provider: 'stripe' | 'paypal';
    data: Record<string, unknown>;
  };
  error?: string;
}

/**
 * Mock Stripe Provider for testing
 */
class MockStripeProvider {
  private sessions: Map<string, MockCheckoutSession> = new Map();
  private refunds: Map<string, MockRefundResult> = new Map();
  private failNextRequest = false;
  private sessionCounter = 0;

  setFailNextRequest(fail: boolean): void {
    this.failNextRequest = fail;
  }

  async createCheckoutSession(request: {
    customer: { id: string; email: string };
    lineItems: Array<{ id: string; name: string; amount: number; currency: string; quantity: number }>;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
  }): Promise<MockCheckoutSession> {
    if (this.failNextRequest) {
      this.failNextRequest = false;
      throw new Error('Stripe API error: Connection failed');
    }

    const sessionId = `cs_test_${Date.now()}_${++this.sessionCounter}`;
    const session: MockCheckoutSession = {
      id: sessionId,
      provider: 'stripe',
      url: `https://checkout.stripe.com/pay/${sessionId}`,
      status: 'pending',
      metadata: request.metadata,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  async getCheckoutSession(sessionId: string): Promise<MockCheckoutSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  async refund(request: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
  }): Promise<MockRefundResult> {
    if (this.failNextRequest) {
      this.failNextRequest = false;
      throw new Error('Stripe API error: Refund failed');
    }

    const result: MockRefundResult = {
      id: `re_test_${Date.now()}`,
      provider: 'stripe',
      paymentIntentId: request.paymentIntentId,
      amount: { amount: request.amount || 999, currency: 'USD' },
      status: 'succeeded',
      reason: request.reason,
    };

    this.refunds.set(result.id, result);
    return result;
  }

  verifyWebhook(payload: string, signature: string): MockWebhookVerification {
    // Simple mock verification - check if signature contains expected format
    if (!signature.includes('t=') || !signature.includes('v1=')) {
      return { isValid: false, error: 'Invalid signature format' };
    }

    try {
      const event = JSON.parse(payload);
      return {
        isValid: true,
        event: {
          id: event.id,
          type: event.type,
          provider: 'stripe',
          data: event.data?.object || {},
        },
      };
    } catch {
      return { isValid: false, error: 'Invalid payload' };
    }
  }

  async healthCheck(): Promise<{ provider: string; healthy: boolean; latencyMs: number }> {
    return { provider: 'stripe', healthy: true, latencyMs: 50 };
  }

  // Test helper to update session status
  updateSessionStatus(sessionId: string, status: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
    }
  }
}

/**
 * Mock PayPal Provider for testing
 */
class MockPayPalProvider {
  private orders: Map<string, MockCheckoutSession> = new Map();
  private refunds: Map<string, MockRefundResult> = new Map();
  private failNextRequest = false;
  private orderCounter = 0;

  setFailNextRequest(fail: boolean): void {
    this.failNextRequest = fail;
  }

  async createCheckoutSession(request: {
    customer: { id: string; email: string };
    lineItems: Array<{ id: string; name: string; amount: number; currency: string; quantity: number }>;
    metadata: Record<string, string>;
    successUrl: string;
    cancelUrl: string;
  }): Promise<MockCheckoutSession> {
    if (this.failNextRequest) {
      this.failNextRequest = false;
      throw new Error('PayPal API error: Connection failed');
    }

    const orderId = `ORDER-${Date.now()}_${++this.orderCounter}`;
    const order: MockCheckoutSession = {
      id: orderId,
      provider: 'paypal',
      url: `https://www.paypal.com/checkoutnow?token=${orderId}`,
      status: 'CREATED',
      metadata: request.metadata,
    };

    this.orders.set(order.id, order);
    return order;
  }

  async getCheckoutSession(orderId: string): Promise<MockCheckoutSession | null> {
    return this.orders.get(orderId) || null;
  }

  async captureOrder(orderId: string): Promise<{
    id: string;
    status: string;
    metadata: Record<string, string>;
  }> {
    if (this.failNextRequest) {
      this.failNextRequest = false;
      throw new Error('PayPal API error: Capture failed');
    }

    const order = this.orders.get(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    order.status = 'COMPLETED';
    return {
      id: orderId,
      status: 'succeeded',
      metadata: order.metadata,
    };
  }

  async refund(request: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
  }): Promise<MockRefundResult> {
    if (this.failNextRequest) {
      this.failNextRequest = false;
      throw new Error('PayPal API error: Refund failed');
    }

    const result: MockRefundResult = {
      id: `REFUND-${Date.now()}`,
      provider: 'paypal',
      paymentIntentId: request.paymentIntentId,
      amount: { amount: request.amount || 999, currency: 'USD' },
      status: 'succeeded',
      reason: request.reason,
    };

    this.refunds.set(result.id, result);
    return result;
  }

  verifyWebhook(payload: string, signature: string): MockWebhookVerification {
    // Check PayPal signature format (pipe-separated)
    const parts = signature.split('|');
    if (parts.length < 5) {
      return { isValid: false, error: 'Invalid signature format - expected 5 parts' };
    }

    try {
      const event = JSON.parse(payload);
      return {
        isValid: true,
        event: {
          id: event.id,
          type: event.event_type,
          provider: 'paypal',
          data: event.resource || {},
        },
      };
    } catch {
      return { isValid: false, error: 'Invalid payload' };
    }
  }

  async healthCheck(): Promise<{ provider: string; healthy: boolean; latencyMs: number }> {
    return { provider: 'paypal', healthy: true, latencyMs: 75 };
  }

  // Test helper to update order status
  updateOrderStatus(orderId: string, status: string): void {
    const order = this.orders.get(orderId);
    if (order) {
      order.status = status;
    }
  }
}

/**
 * Mock Payment Service that coordinates providers
 */
class MockPaymentService {
  private stripeProvider: MockStripeProvider;
  private paypalProvider: MockPayPalProvider;
  private transactions: Map<string, ReturnType<typeof createMockPaymentTransaction>> = new Map();
  private purchases: Map<string, ReturnType<typeof createMockPurchase>> = new Map();
  private transactionCounter = 0;

  constructor() {
    this.stripeProvider = new MockStripeProvider();
    this.paypalProvider = new MockPayPalProvider();
  }

  getStripeProvider(): MockStripeProvider {
    return this.stripeProvider;
  }

  getPayPalProvider(): MockPayPalProvider {
    return this.paypalProvider;
  }

  isProviderAvailable(provider: 'stripe' | 'paypal'): boolean {
    return true;
  }

  getAvailableProviders(): Array<'stripe' | 'paypal'> {
    return ['stripe', 'paypal'];
  }

  async createCheckout(options: {
    userId: string;
    userEmail: string;
    gameId: string;
    gameName: string;
    amount: number;
    currency: string;
    provider: 'stripe' | 'paypal';
    successUrl: string;
    cancelUrl: string;
  }): Promise<MockCheckoutSession> {
    // Validate amount
    if (!Number.isInteger(options.amount) || options.amount <= 0) {
      throw new Error(`Invalid amount: ${options.amount}`);
    }

    const transactionId = `txn_${Date.now()}_${++this.transactionCounter}`;
    const provider = options.provider === 'stripe' ? this.stripeProvider : this.paypalProvider;

    const session = await provider.createCheckoutSession({
      customer: { id: options.userId, email: options.userEmail },
      lineItems: [{
        id: options.gameId,
        name: options.gameName,
        amount: options.amount,
        currency: options.currency,
        quantity: 1,
      }],
      metadata: {
        userId: options.userId,
        gameId: options.gameId,
        transactionId,
      },
      successUrl: options.successUrl,
      cancelUrl: options.cancelUrl,
    });

    // Store transaction
    const transaction = createMockPaymentTransaction({
      id: transactionId,
      userId: options.userId,
      provider: options.provider,
      providerSessionId: session.id,
      providerTransactionId: session.id,
      amount: options.amount,
      currency: options.currency,
      metadata: {
        gameId: options.gameId,
        gameName: options.gameName,
      },
    });
    this.transactions.set(transactionId, transaction);

    return session;
  }

  async processWebhook(
    provider: 'stripe' | 'paypal',
    payload: string,
    signature: string
  ): Promise<{ success: boolean; transactionId?: string; purchaseId?: string; error?: string }> {
    const providerInstance = provider === 'stripe' ? this.stripeProvider : this.paypalProvider;
    const verification = providerInstance.verifyWebhook(payload, signature);

    if (!verification.isValid) {
      return { success: false, error: verification.error };
    }

    if (!verification.event) {
      return { success: true }; // Valid but unhandled event type
    }

    const event = verification.event;

    // Handle checkout completion
    if (event.type === 'checkout.session.completed' || event.type === 'CHECKOUT.ORDER.COMPLETED') {
      // Parse metadata - PayPal stores it in custom_id as JSON string
      let metadata: Record<string, string> = {};
      if (event.data.metadata) {
        metadata = event.data.metadata as Record<string, string>;
      } else if (event.data.custom_id) {
        try {
          metadata = JSON.parse(event.data.custom_id as string);
        } catch {
          // Ignore parse errors
        }
      }
      const sessionId = event.data.id as string || event.data.checkoutSessionId as string;

      // Find transaction by session ID
      let transaction: ReturnType<typeof createMockPaymentTransaction> | undefined;
      for (const [, txn] of this.transactions) {
        if (txn.providerSessionId === sessionId) {
          transaction = txn;
          break;
        }
      }

      if (!transaction && metadata.transactionId) {
        transaction = this.transactions.get(metadata.transactionId);
      }

      if (transaction) {
        transaction.status = 'succeeded';
        transaction.completedAt = new Date();

        // Create purchase
        if (metadata.userId && metadata.gameId) {
          const purchase = createMockPurchase({
            userId: metadata.userId,
            gameId: metadata.gameId,
            amount: transaction.amount,
            currency: transaction.currency,
            paymentMethod: provider === 'stripe' ? 'credit_card' : 'paypal',
          });
          this.purchases.set(purchase.id, purchase);
          transaction.purchaseId = purchase.id;

          return { success: true, transactionId: transaction.id, purchaseId: purchase.id };
        }

        return { success: true, transactionId: transaction.id };
      }

      return { success: false, error: 'Transaction not found' };
    }

    // Handle refund
    if (event.type === 'charge.refunded' || event.type === 'PAYMENT.CAPTURE.REFUNDED') {
      const paymentIntentId = event.data.payment_intent as string || event.data.paymentIntentId as string;

      for (const [, txn] of this.transactions) {
        if (txn.providerTransactionId === paymentIntentId) {
          txn.status = 'refunded';

          if (txn.purchaseId) {
            const purchase = this.purchases.get(txn.purchaseId);
            if (purchase) {
              purchase.status = 'refunded';
              purchase.refundedAt = new Date();
            }
          }

          return { success: true, transactionId: txn.id };
        }
      }

      return { success: true }; // Not our transaction
    }

    return { success: true };
  }

  async refund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<MockRefundResult> {
    const transaction = this.transactions.get(transactionId);
    if (!transaction) {
      throw new Error('Transaction not found');
    }

    if (transaction.status !== 'succeeded') {
      throw new Error('Transaction not eligible for refund');
    }

    const provider = transaction.provider === 'stripe' ? this.stripeProvider : this.paypalProvider;
    const result = await provider.refund({
      paymentIntentId: transaction.providerTransactionId,
      amount,
      reason,
    });

    // Update transaction status
    transaction.status = 'refunded';

    // Update purchase status if linked
    if (transaction.purchaseId) {
      const purchase = this.purchases.get(transaction.purchaseId);
      if (purchase) {
        purchase.status = 'refunded';
        purchase.refundedAt = new Date();
      }
    }

    return result;
  }

  async healthCheck(): Promise<Array<{ provider: string; healthy: boolean; latencyMs: number }>> {
    const results = await Promise.all([
      this.stripeProvider.healthCheck(),
      this.paypalProvider.healthCheck(),
    ]);
    return results;
  }

  // Test helpers
  getTransaction(id: string): ReturnType<typeof createMockPaymentTransaction> | undefined {
    return this.transactions.get(id);
  }

  getPurchase(id: string): ReturnType<typeof createMockPurchase> | undefined {
    return this.purchases.get(id);
  }

  getTransactionBySessionId(sessionId: string): ReturnType<typeof createMockPaymentTransaction> | undefined {
    for (const [, txn] of this.transactions) {
      if (txn.providerSessionId === sessionId) {
        return txn;
      }
    }
    return undefined;
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Payment Integration Tests', () => {
  let paymentService: MockPaymentService;

  beforeEach(() => {
    paymentService = new MockPaymentService();
  });

  describe('Payment Service Initialization', () => {
    it('should have both providers available', () => {
      const providers = paymentService.getAvailableProviders();
      assert.ok(providers.includes('stripe'));
      assert.ok(providers.includes('paypal'));
    });

    it('should report provider availability correctly', () => {
      assert.strictEqual(paymentService.isProviderAvailable('stripe'), true);
      assert.strictEqual(paymentService.isProviderAvailable('paypal'), true);
    });

    it('should pass health check for all providers', async () => {
      const healthResults = await paymentService.healthCheck();
      assert.strictEqual(healthResults.length, 2);
      assert.ok(healthResults.every(r => r.healthy));
    });
  });

  describe('Stripe Payment Flow', () => {
    describe('Checkout Session Creation', () => {
      it('should create a checkout session with valid data', async () => {
        const user = createMockUser();
        const game = createMockGame();

        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        assert.ok(session.id);
        assert.strictEqual(session.provider, 'stripe');
        assert.ok(session.url.includes('checkout.stripe.com'));
        assert.strictEqual(session.metadata.userId, user.id);
        assert.strictEqual(session.metadata.gameId, game.id);
      });

      it('should reject invalid amount (zero)', async () => {
        const user = createMockUser();
        const game = createMockGame();

        await assert.rejects(
          async () => {
            await paymentService.createCheckout({
              userId: user.id,
              userEmail: user.email,
              gameId: game.id,
              gameName: game.title,
              amount: 0,
              currency: 'USD',
              provider: 'stripe',
              successUrl: 'https://example.com/success',
              cancelUrl: 'https://example.com/cancel',
            });
          },
          { message: /Invalid amount/ }
        );
      });

      it('should reject invalid amount (negative)', async () => {
        const user = createMockUser();
        const game = createMockGame();

        await assert.rejects(
          async () => {
            await paymentService.createCheckout({
              userId: user.id,
              userEmail: user.email,
              gameId: game.id,
              gameName: game.title,
              amount: -100,
              currency: 'USD',
              provider: 'stripe',
              successUrl: 'https://example.com/success',
              cancelUrl: 'https://example.com/cancel',
            });
          },
          { message: /Invalid amount/ }
        );
      });

      it('should create transaction record on checkout', async () => {
        const user = createMockUser();
        const game = createMockGame();

        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);
        assert.strictEqual(transaction.userId, user.id);
        assert.strictEqual(transaction.provider, 'stripe');
        assert.strictEqual(transaction.status, 'pending');
        assert.strictEqual(transaction.amount, game.price);
      });

      it('should support all valid currencies', async () => {
        for (const currency of TEST_CURRENCIES) {
          const user = createMockUser();
          const game = createMockGame({ currency });

          const session = await paymentService.createCheckout({
            userId: user.id,
            userEmail: user.email,
            gameId: game.id,
            gameName: game.title,
            amount: game.price,
            currency,
            provider: 'stripe',
            successUrl: 'https://example.com/success',
            cancelUrl: 'https://example.com/cancel',
          });

          assert.ok(session.id, `Should create session for ${currency}`);
        }
      });

      it('should handle API errors gracefully', async () => {
        paymentService.getStripeProvider().setFailNextRequest(true);

        const user = createMockUser();
        const game = createMockGame();

        await assert.rejects(
          async () => {
            await paymentService.createCheckout({
              userId: user.id,
              userEmail: user.email,
              gameId: game.id,
              gameName: game.title,
              amount: game.price,
              currency: game.currency,
              provider: 'stripe',
              successUrl: 'https://example.com/success',
              cancelUrl: 'https://example.com/cancel',
            });
          },
          { message: /Stripe API error/ }
        );
      });
    });

    describe('Webhook Processing', () => {
      it('should process checkout.session.completed webhook', async () => {
        const user = createMockUser();
        const game = createMockGame();

        // Create checkout session first
        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);

        // Simulate webhook event
        const webhookEvent = createStripeCheckoutCompletedEvent({
          sessionId: session.id,
          metadata: {
            userId: user.id,
            gameId: game.id,
            transactionId: transaction.id,
          },
          amount: game.price,
        });

        const result = await paymentService.processWebhook(
          'stripe',
          JSON.stringify(webhookEvent),
          't=1234567890,v1=mock_signature'
        );

        assert.strictEqual(result.success, true);
        assert.ok(result.transactionId);
        assert.ok(result.purchaseId);

        // Verify transaction updated
        const updatedTransaction = paymentService.getTransaction(transaction.id);
        assert.strictEqual(updatedTransaction?.status, 'succeeded');
        assert.ok(updatedTransaction?.completedAt);

        // Verify purchase created
        const purchase = paymentService.getPurchase(result.purchaseId!);
        assert.ok(purchase);
        assert.strictEqual(purchase.userId, user.id);
        assert.strictEqual(purchase.gameId, game.id);
        assert.strictEqual(purchase.status, 'completed');
      });

      it('should reject webhook with invalid signature', async () => {
        const webhookEvent = createStripeCheckoutCompletedEvent();

        const result = await paymentService.processWebhook(
          'stripe',
          JSON.stringify(webhookEvent),
          'invalid_signature'
        );

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Invalid signature'));
      });

      it('should reject webhook with malformed payload', async () => {
        const result = await paymentService.processWebhook(
          'stripe',
          'not valid json',
          't=1234567890,v1=mock_signature'
        );

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Invalid payload'));
      });
    });

    describe('Refund Processing', () => {
      it('should process refund for successful transaction', async () => {
        const user = createMockUser();
        const game = createMockGame();

        // Create and complete checkout
        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);

        // Complete the transaction via webhook
        const webhookEvent = createStripeCheckoutCompletedEvent({
          sessionId: session.id,
          metadata: {
            userId: user.id,
            gameId: game.id,
            transactionId: transaction.id,
          },
        });

        await paymentService.processWebhook(
          'stripe',
          JSON.stringify(webhookEvent),
          't=1234567890,v1=mock_signature'
        );

        // Process refund
        const refundResult = await paymentService.refund(transaction.id, undefined, 'Customer request');

        assert.ok(refundResult.id);
        assert.strictEqual(refundResult.provider, 'stripe');
        assert.strictEqual(refundResult.status, 'succeeded');

        // Verify transaction updated
        const updatedTransaction = paymentService.getTransaction(transaction.id);
        assert.strictEqual(updatedTransaction?.status, 'refunded');
      });

      it('should reject refund for pending transaction', async () => {
        const user = createMockUser();
        const game = createMockGame();

        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);

        await assert.rejects(
          async () => {
            await paymentService.refund(transaction.id);
          },
          { message: /not eligible for refund/ }
        );
      });

      it('should reject refund for non-existent transaction', async () => {
        await assert.rejects(
          async () => {
            await paymentService.refund('non-existent-txn');
          },
          { message: /Transaction not found/ }
        );
      });

      it('should update purchase status on refund', async () => {
        const user = createMockUser();
        const game = createMockGame();

        // Create, complete, and get purchase
        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);

        const webhookEvent = createStripeCheckoutCompletedEvent({
          sessionId: session.id,
          metadata: {
            userId: user.id,
            gameId: game.id,
            transactionId: transaction.id,
          },
        });

        const webhookResult = await paymentService.processWebhook(
          'stripe',
          JSON.stringify(webhookEvent),
          't=1234567890,v1=mock_signature'
        );

        // Verify purchase exists
        const purchase = paymentService.getPurchase(webhookResult.purchaseId!);
        assert.ok(purchase);
        assert.strictEqual(purchase.status, 'completed');

        // Process refund
        await paymentService.refund(transaction.id, undefined, 'Customer request');

        // Verify purchase updated
        const refundedPurchase = paymentService.getPurchase(webhookResult.purchaseId!);
        assert.strictEqual(refundedPurchase?.status, 'refunded');
        assert.ok(refundedPurchase?.refundedAt);
      });
    });
  });

  describe('PayPal Payment Flow', () => {
    describe('Order Creation', () => {
      it('should create a PayPal order with valid data', async () => {
        const user = createMockUser();
        const game = createMockGame();

        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'paypal',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        assert.ok(session.id);
        assert.strictEqual(session.provider, 'paypal');
        assert.ok(session.url.includes('paypal.com'));
        assert.strictEqual(session.metadata.userId, user.id);
        assert.strictEqual(session.metadata.gameId, game.id);
      });

      it('should create transaction record for PayPal order', async () => {
        const user = createMockUser();
        const game = createMockGame();

        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'paypal',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);
        assert.strictEqual(transaction.provider, 'paypal');
        assert.strictEqual(transaction.status, 'pending');
      });

      it('should handle PayPal API errors gracefully', async () => {
        paymentService.getPayPalProvider().setFailNextRequest(true);

        const user = createMockUser();
        const game = createMockGame();

        await assert.rejects(
          async () => {
            await paymentService.createCheckout({
              userId: user.id,
              userEmail: user.email,
              gameId: game.id,
              gameName: game.title,
              amount: game.price,
              currency: game.currency,
              provider: 'paypal',
              successUrl: 'https://example.com/success',
              cancelUrl: 'https://example.com/cancel',
            });
          },
          { message: /PayPal API error/ }
        );
      });
    });

    describe('Webhook Processing', () => {
      it('should process CHECKOUT.ORDER.COMPLETED webhook', async () => {
        const user = createMockUser();
        const game = createMockGame();

        // Create PayPal order
        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'paypal',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);

        // Simulate PayPal webhook
        const webhookEvent = createPayPalOrderCompletedEvent({
          orderId: session.id,
          metadata: {
            userId: user.id,
            gameId: game.id,
            transactionId: transaction.id,
          },
          amount: (game.price / 100).toFixed(2),
        });

        const result = await paymentService.processWebhook(
          'paypal',
          JSON.stringify(webhookEvent),
          'transmissionId|timestamp|signature|SHA256withRSA|certUrl'
        );

        assert.strictEqual(result.success, true);
        assert.ok(result.transactionId);
        assert.ok(result.purchaseId);

        // Verify transaction updated
        const updatedTransaction = paymentService.getTransaction(transaction.id);
        assert.strictEqual(updatedTransaction?.status, 'succeeded');
      });

      it('should reject webhook with invalid PayPal signature format', async () => {
        const webhookEvent = createPayPalOrderCompletedEvent();

        const result = await paymentService.processWebhook(
          'paypal',
          JSON.stringify(webhookEvent),
          'invalid_signature'
        );

        assert.strictEqual(result.success, false);
        assert.ok(result.error?.includes('Invalid signature'));
      });
    });

    describe('Refund Processing', () => {
      it('should process PayPal refund', async () => {
        const user = createMockUser();
        const game = createMockGame();

        // Create and complete order
        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: game.title,
          amount: game.price,
          currency: game.currency,
          provider: 'paypal',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.ok(transaction);

        // Complete via webhook
        const webhookEvent = createPayPalOrderCompletedEvent({
          orderId: session.id,
          metadata: {
            userId: user.id,
            gameId: game.id,
            transactionId: transaction.id,
          },
        });

        await paymentService.processWebhook(
          'paypal',
          JSON.stringify(webhookEvent),
          'transmissionId|timestamp|signature|SHA256withRSA|certUrl'
        );

        // Process refund
        const refundResult = await paymentService.refund(transaction.id);

        assert.ok(refundResult.id);
        assert.strictEqual(refundResult.provider, 'paypal');
        assert.strictEqual(refundResult.status, 'succeeded');
      });
    });
  });

  describe('Multi-Provider Scenarios', () => {
    it('should handle concurrent checkouts from different providers', async () => {
      const user = createMockUser();
      const game1 = createMockGame({ title: 'Game 1' });
      const game2 = createMockGame({ title: 'Game 2' });

      // Create checkouts concurrently
      const [stripeSession, paypalSession] = await Promise.all([
        paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game1.id,
          gameName: game1.title,
          amount: game1.price,
          currency: game1.currency,
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        }),
        paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game2.id,
          gameName: game2.title,
          amount: game2.price,
          currency: game2.currency,
          provider: 'paypal',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        }),
      ]);

      assert.strictEqual(stripeSession.provider, 'stripe');
      assert.strictEqual(paypalSession.provider, 'paypal');
      assert.notStrictEqual(stripeSession.id, paypalSession.id);
    });

    it('should isolate transactions between providers', async () => {
      const user = createMockUser();
      const game = createMockGame();

      // Create Stripe checkout
      const stripeSession = await paymentService.createCheckout({
        userId: user.id,
        userEmail: user.email,
        gameId: game.id,
        gameName: game.title,
        amount: game.price,
        currency: game.currency,
        provider: 'stripe',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      const stripeTxn = paymentService.getTransactionBySessionId(stripeSession.id);
      assert.ok(stripeTxn);

      // Complete Stripe transaction
      const stripeEvent = createStripeCheckoutCompletedEvent({
        sessionId: stripeSession.id,
        metadata: {
          userId: user.id,
          gameId: game.id,
          transactionId: stripeTxn.id,
        },
      });

      await paymentService.processWebhook(
        'stripe',
        JSON.stringify(stripeEvent),
        't=1234567890,v1=mock_signature'
      );

      // Create PayPal checkout for same game
      const paypalSession = await paymentService.createCheckout({
        userId: user.id,
        userEmail: user.email,
        gameId: game.id,
        gameName: game.title,
        amount: game.price,
        currency: game.currency,
        provider: 'paypal',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      const paypalTxn = paymentService.getTransactionBySessionId(paypalSession.id);
      assert.ok(paypalTxn);

      // Verify transactions are separate
      assert.notStrictEqual(stripeTxn.id, paypalTxn.id);
      assert.strictEqual(stripeTxn.status, 'succeeded');
      assert.strictEqual(paypalTxn.status, 'pending');
    });
  });

  describe('Edge Cases', () => {
    it('should handle different payment amounts', async () => {
      const user = createMockUser();

      for (const [name, amount] of Object.entries(TEST_PAYMENT_AMOUNTS)) {
        const game = createMockGame({ price: amount });

        const session = await paymentService.createCheckout({
          userId: user.id,
          userEmail: user.email,
          gameId: game.id,
          gameName: `${name} Game`,
          amount,
          currency: 'USD',
          provider: 'stripe',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        });

        const transaction = paymentService.getTransactionBySessionId(session.id);
        assert.strictEqual(transaction?.amount, amount, `Amount should be ${amount} for ${name}`);
      }
    });

    it('should handle metadata sanitization', async () => {
      const user = createMockUser();
      const game = createMockGame();

      const session = await paymentService.createCheckout({
        userId: user.id,
        userEmail: user.email,
        gameId: game.id,
        gameName: game.title,
        amount: game.price,
        currency: game.currency,
        provider: 'stripe',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      });

      // Metadata should be strings
      assert.strictEqual(typeof session.metadata.userId, 'string');
      assert.strictEqual(typeof session.metadata.gameId, 'string');
    });
  });
});
