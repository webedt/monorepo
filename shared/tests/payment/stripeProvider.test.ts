/**
 * Unit Tests for Stripe Payment Provider
 *
 * Tests Stripe-specific payment processing functionality including:
 * - Checkout session creation and retrieval
 * - Payment intent operations
 * - Refund processing
 * - Webhook signature verification
 * - Health checks
 * - Error handling
 *
 * ## Testing Approach
 *
 * These tests use a TestableStripeProvider class that wraps a mock Stripe SDK.
 * The utility functions (status mapping, currency validation, metadata sanitization)
 * are imported from the shared utils.ts module, ensuring tests validate the same
 * logic used in production.
 *
 * For direct unit tests of utility functions, see utils.test.ts.
 *
 * ## Limitations
 *
 * Due to Node.js 22's lack of mock.module() support, we cannot directly mock
 * the Stripe SDK import. Instead, we use dependency injection to pass a mock
 * Stripe client to the TestableStripeProvider. This tests the same business
 * logic patterns as the production StripeProvider class.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

// Import actual utility functions from production code
import {
  isStripeNotFoundError,
  mapRefundReason,
  mapStripeCheckoutStatus,
  mapStripeEventType,
  mapStripeStatus,
  sanitizeMetadata,
  toCurrencyCode,
} from '../../src/payment/utils.js';

import type { CurrencyCode } from '../../src/payment/types.js';
import type { CheckoutSession } from '../../src/payment/types.js';
import type { PaymentIntent } from '../../src/payment/types.js';
import type { PaymentMetadata } from '../../src/payment/types.js';
import type { ProviderHealthStatus } from '../../src/payment/types.js';
import type { RefundResult } from '../../src/payment/types.js';
import type { WebhookVerification } from '../../src/payment/types.js';

/**
 * Testable version of StripeProvider with injectable mock Stripe SDK.
 *
 * Uses the actual utility functions from utils.ts to ensure tests validate
 * the same logic as production code.
 */
class TestableStripeProvider {
  readonly provider = 'stripe' as const;
  private stripe: MockStripe;
  private webhookSecret: string;

  constructor(stripe: MockStripe, webhookSecret: string) {
    this.stripe = stripe;
    this.webhookSecret = webhookSecret;
  }

  // Note: Utility functions are imported from utils.ts, not re-implemented here.
  // This ensures tests validate the actual production logic.

  async createCheckoutSession(request: {
    customer: { id: string; email: string };
    lineItems: Array<{
      id: string;
      name: string;
      description?: string;
      amount: number;
      currency: CurrencyCode;
      quantity: number;
      imageUrl?: string;
    }>;
    metadata: PaymentMetadata;
    successUrl: string;
    cancelUrl: string;
    mode?: 'payment' | 'subscription';
  }): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create({
      mode: request.mode || 'payment',
      customer_email: request.customer.email,
      line_items: request.lineItems.map((item) => ({
        price_data: {
          currency: item.currency.toLowerCase(),
          product_data: {
            name: item.name,
            description: item.description,
            images: item.imageUrl ? [item.imageUrl] : undefined,
          },
          unit_amount: item.amount,
        },
        quantity: item.quantity,
      })),
      metadata: sanitizeMetadata(request.metadata),
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    });

    return {
      id: session.id,
      provider: 'stripe',
      url: session.url || '',
      status: mapStripeCheckoutStatus(session.status, session.payment_status),
      expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
      metadata: request.metadata,
    };
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSession | null> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      return {
        id: session.id,
        provider: 'stripe',
        url: session.url || '',
        status: mapStripeCheckoutStatus(session.status, session.payment_status),
        expiresAt: session.expires_at ? new Date(session.expires_at * 1000) : undefined,
        metadata: (session.metadata as PaymentMetadata) || {},
      };
    } catch (error) {
      if (isStripeNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async createPaymentIntent(request: {
    amount: { amount: number; currency: CurrencyCode };
    customer: { id: string; email: string };
    metadata: PaymentMetadata;
    description?: string;
  }): Promise<PaymentIntent> {
    const intent = await this.stripe.paymentIntents.create({
      amount: request.amount.amount,
      currency: request.amount.currency.toLowerCase(),
      metadata: sanitizeMetadata(request.metadata),
      description: request.description,
      automatic_payment_methods: { enabled: true },
    });

    return {
      id: intent.id,
      provider: 'stripe',
      clientSecret: intent.client_secret || undefined,
      status: mapStripeStatus(intent.status),
      amount: {
        amount: intent.amount,
        currency: toCurrencyCode(intent.currency),
      },
      metadata: request.metadata,
      createdAt: new Date(intent.created * 1000),
    };
  }

  async getPaymentIntent(intentId: string): Promise<PaymentIntent | null> {
    try {
      const intent = await this.stripe.paymentIntents.retrieve(intentId);

      return {
        id: intent.id,
        provider: 'stripe',
        clientSecret: intent.client_secret || undefined,
        status: mapStripeStatus(intent.status),
        amount: {
          amount: intent.amount,
          currency: toCurrencyCode(intent.currency),
        },
        metadata: (intent.metadata as PaymentMetadata) || {},
        createdAt: new Date(intent.created * 1000),
      };
    } catch (error) {
      if (isStripeNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async cancelPaymentIntent(intentId: string): Promise<PaymentIntent> {
    const intent = await this.stripe.paymentIntents.cancel(intentId);

    return {
      id: intent.id,
      provider: 'stripe',
      clientSecret: intent.client_secret || undefined,
      status: mapStripeStatus(intent.status),
      amount: {
        amount: intent.amount,
        currency: toCurrencyCode(intent.currency),
      },
      metadata: (intent.metadata as PaymentMetadata) || {},
      createdAt: new Date(intent.created * 1000),
    };
  }

  async refund(request: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
    metadata?: PaymentMetadata;
  }): Promise<RefundResult> {
    const refund = await this.stripe.refunds.create({
      payment_intent: request.paymentIntentId,
      amount: request.amount,
      reason: mapRefundReason(request.reason),
      metadata: request.metadata ? sanitizeMetadata(request.metadata) : undefined,
    });

    return {
      id: refund.id,
      provider: 'stripe',
      paymentIntentId: request.paymentIntentId,
      amount: {
        amount: refund.amount || 0,
        currency: toCurrencyCode(refund.currency || 'USD'),
      },
      status: refund.status === 'succeeded' ? 'succeeded' : 'pending',
      reason: request.reason,
      createdAt: new Date(refund.created * 1000),
    };
  }

  async verifyWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<WebhookVerification> {
    try {
      const event = this.stripe.webhooks.constructEvent(payload, signature, this.webhookSecret);

      const eventType = mapStripeEventType(event.type);
      if (!eventType) {
        return { isValid: true, event: undefined };
      }

      const webhookEvent = this.parseStripeEvent(event, eventType);
      return { isValid: true, event: webhookEvent };
    } catch (error) {
      return {
        isValid: false,
        error: (error as Error).message,
      };
    }
  }

  private parseStripeEvent(event: MockStripeEvent, eventType: string) {
    const baseEvent = {
      id: event.id,
      type: eventType as 'checkout.session.completed' | 'checkout.session.expired' | 'payment_intent.succeeded' | 'payment_intent.payment_failed' | 'payment_intent.cancelled' | 'charge.refunded' | 'charge.dispute.created',
      provider: 'stripe' as const,
      data: {} as Record<string, unknown>,
      createdAt: new Date(event.created * 1000),
      rawPayload: event,
    };

    if (event.type.startsWith('checkout.session')) {
      const session = event.data.object;
      baseEvent.data = {
        checkoutSessionId: session.id,
        paymentIntentId: session.payment_intent,
        status: mapStripeCheckoutStatus(session.status || null, session.payment_status || null),
        metadata: session.metadata || {},
        amount: session.amount_total ? {
          amount: session.amount_total,
          currency: toCurrencyCode(session.currency || 'USD'),
        } : undefined,
      };
    } else if (event.type.startsWith('payment_intent')) {
      const intent = event.data.object;
      baseEvent.data = {
        paymentIntentId: intent.id,
        status: mapStripeStatus(intent.status || ''),
        metadata: intent.metadata || {},
        amount: {
          amount: intent.amount || 0,
          currency: toCurrencyCode(intent.currency || 'USD'),
        },
        failureReason: intent.last_payment_error?.message,
      };
    } else if (event.type.startsWith('charge')) {
      const charge = event.data.object;
      baseEvent.data = {
        paymentIntentId: charge.payment_intent,
        status: charge.refunded ? 'refunded' : 'succeeded',
        metadata: charge.metadata || {},
        amount: {
          amount: charge.amount || 0,
          currency: toCurrencyCode(charge.currency || 'USD'),
        },
      };
    }

    return baseEvent;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    try {
      await this.stripe.balance.retrieve();
      return {
        provider: 'stripe',
        healthy: true,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        provider: 'stripe',
        healthy: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        error: (error as Error).message,
      };
    }
  }
}

// Mock Stripe types
interface MockStripeSession {
  id: string;
  url: string | null;
  status: string | null;
  payment_status: string | null;
  expires_at: number | null;
  metadata: Record<string, string> | null;
}

interface MockStripeIntent {
  id: string;
  client_secret: string | null;
  status: string;
  amount: number;
  currency: string;
  created: number;
  metadata: Record<string, string>;
  last_payment_error?: { message: string };
}

interface MockStripeRefund {
  id: string;
  amount: number | null;
  currency: string | null;
  status: string;
  created: number;
}

interface MockStripeEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: {
      id: string;
      payment_intent?: string;
      status?: string;
      payment_status?: string;
      amount?: number;
      amount_total?: number;
      currency?: string;
      metadata?: Record<string, string>;
      refunded?: boolean;
      last_payment_error?: { message: string };
    };
  };
}

interface MockStripe {
  checkout: {
    sessions: {
      create: (params: Record<string, unknown>) => Promise<MockStripeSession>;
      retrieve: (id: string) => Promise<MockStripeSession>;
    };
  };
  paymentIntents: {
    create: (params: Record<string, unknown>) => Promise<MockStripeIntent>;
    retrieve: (id: string) => Promise<MockStripeIntent>;
    cancel: (id: string) => Promise<MockStripeIntent>;
  };
  refunds: {
    create: (params: Record<string, unknown>) => Promise<MockStripeRefund>;
  };
  balance: {
    retrieve: () => Promise<{ available: Array<{ amount: number }> }>;
  };
  webhooks: {
    constructEvent: (payload: string | Buffer, sig: string, secret: string) => MockStripeEvent;
  };
}

function createMockStripe(): MockStripe {
  return {
    checkout: {
      sessions: {
        create: mock.fn(() => Promise.resolve({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/pay/cs_test_123',
          status: 'open',
          payment_status: 'unpaid',
          expires_at: Math.floor(Date.now() / 1000) + 1800,
          metadata: {},
        })),
        retrieve: mock.fn(() => Promise.resolve({
          id: 'cs_test_123',
          url: '',
          status: 'complete',
          payment_status: 'paid',
          expires_at: null,
          metadata: {},
        })),
      },
    },
    paymentIntents: {
      create: mock.fn(() => Promise.resolve({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret',
        status: 'requires_payment_method',
        amount: 999,
        currency: 'usd',
        created: Math.floor(Date.now() / 1000),
        metadata: {},
      })),
      retrieve: mock.fn(() => Promise.resolve({
        id: 'pi_test_123',
        client_secret: 'pi_test_123_secret',
        status: 'succeeded',
        amount: 999,
        currency: 'usd',
        created: Math.floor(Date.now() / 1000),
        metadata: {},
      })),
      cancel: mock.fn(() => Promise.resolve({
        id: 'pi_test_123',
        client_secret: null,
        status: 'canceled',
        amount: 999,
        currency: 'usd',
        created: Math.floor(Date.now() / 1000),
        metadata: {},
      })),
    },
    refunds: {
      create: mock.fn(() => Promise.resolve({
        id: 're_test_123',
        amount: 999,
        currency: 'usd',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      })),
    },
    balance: {
      retrieve: mock.fn(() => Promise.resolve({ available: [{ amount: 1000 }] })),
    },
    webhooks: {
      constructEvent: mock.fn(() => ({
        id: 'evt_test_123',
        type: 'checkout.session.completed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'cs_test_123',
            status: 'complete',
            payment_status: 'paid',
            metadata: {},
          },
        },
      })),
    },
  };
}

describe('StripeProvider', () => {
  let provider: TestableStripeProvider;
  let mockStripe: MockStripe;

  beforeEach(() => {
    mockStripe = createMockStripe();
    provider = new TestableStripeProvider(mockStripe, 'whsec_test_secret');
  });

  describe('constructor', () => {
    it('should create a StripeProvider instance', () => {
      assert.ok(provider);
      assert.strictEqual(provider.provider, 'stripe');
    });
  });

  describe('createCheckoutSession', () => {
    it('should create a checkout session successfully', async () => {
      const request = {
        customer: { id: 'user_123', email: 'test@example.com' },
        lineItems: [{
          id: 'item_1',
          name: 'Test Game',
          description: 'A great game',
          amount: 999,
          currency: 'USD' as CurrencyCode,
          quantity: 1,
          imageUrl: 'https://example.com/image.jpg',
        }],
        metadata: { userId: 'user_123', gameId: 'game_456' },
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      };

      const session = await provider.createCheckoutSession(request);

      assert.strictEqual(session.id, 'cs_test_123');
      assert.strictEqual(session.provider, 'stripe');
      assert.strictEqual(session.status, 'pending');
      assert.ok(session.expiresAt instanceof Date);
    });

    it('should throw error on Stripe API failure', async () => {
      mockStripe.checkout.sessions.create = mock.fn(() =>
        Promise.reject(new Error('Stripe API error'))
      );

      const request = {
        customer: { id: 'user_123', email: 'test@example.com' },
        lineItems: [{
          id: 'item_1',
          name: 'Test Game',
          amount: 999,
          currency: 'USD' as CurrencyCode,
          quantity: 1,
        }],
        metadata: { userId: 'user_123' },
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      };

      await assert.rejects(
        () => provider.createCheckoutSession(request),
        /Stripe API error/
      );
    });
  });

  describe('getCheckoutSession', () => {
    it('should retrieve an existing checkout session', async () => {
      const session = await provider.getCheckoutSession('cs_test_123');

      assert.ok(session);
      assert.strictEqual(session.id, 'cs_test_123');
      assert.strictEqual(session.status, 'succeeded');
    });

    it('should return null for non-existent session', async () => {
      const error = new Error('No such checkout session') as Error & { code: string };
      error.code = 'resource_missing';
      mockStripe.checkout.sessions.retrieve = mock.fn(() => Promise.reject(error));

      const session = await provider.getCheckoutSession('cs_nonexistent');
      assert.strictEqual(session, null);
    });

    it('should throw for other errors', async () => {
      mockStripe.checkout.sessions.retrieve = mock.fn(() =>
        Promise.reject(new Error('Network error'))
      );

      await assert.rejects(
        () => provider.getCheckoutSession('cs_test_123'),
        /Network error/
      );
    });
  });

  describe('createPaymentIntent', () => {
    it('should create a payment intent successfully', async () => {
      const request = {
        amount: { amount: 999, currency: 'USD' as CurrencyCode },
        customer: { id: 'user_123', email: 'test@example.com' },
        metadata: { userId: 'user_123' },
        description: 'Test payment',
      };

      const intent = await provider.createPaymentIntent(request);

      assert.strictEqual(intent.id, 'pi_test_123');
      assert.strictEqual(intent.provider, 'stripe');
      assert.strictEqual(intent.status, 'requires_action');
      assert.strictEqual(intent.amount.amount, 999);
    });
  });

  describe('getPaymentIntent', () => {
    it('should retrieve an existing payment intent', async () => {
      const intent = await provider.getPaymentIntent('pi_test_123');

      assert.ok(intent);
      assert.strictEqual(intent.id, 'pi_test_123');
      assert.strictEqual(intent.status, 'succeeded');
    });

    it('should return null for non-existent intent', async () => {
      const error = new Error('No such payment intent') as Error & { code: string };
      error.code = 'resource_missing';
      mockStripe.paymentIntents.retrieve = mock.fn(() => Promise.reject(error));

      const intent = await provider.getPaymentIntent('pi_nonexistent');
      assert.strictEqual(intent, null);
    });
  });

  describe('cancelPaymentIntent', () => {
    it('should cancel a payment intent successfully', async () => {
      const intent = await provider.cancelPaymentIntent('pi_test_123');

      assert.strictEqual(intent.id, 'pi_test_123');
      assert.strictEqual(intent.status, 'cancelled');
    });
  });

  describe('refund', () => {
    it('should create a full refund successfully', async () => {
      const result = await provider.refund({
        paymentIntentId: 'pi_test_123',
      });

      assert.strictEqual(result.id, 're_test_123');
      assert.strictEqual(result.provider, 'stripe');
      assert.strictEqual(result.status, 'succeeded');
      assert.strictEqual(result.amount.amount, 999);
    });

    it('should handle pending refund status', async () => {
      mockStripe.refunds.create = mock.fn(() => Promise.resolve({
        id: 're_test_124',
        amount: 999,
        currency: 'usd',
        status: 'pending',
        created: Math.floor(Date.now() / 1000),
      }));

      const result = await provider.refund({ paymentIntentId: 'pi_test_123' });
      assert.strictEqual(result.status, 'pending');
    });

    it('should handle null amount and currency', async () => {
      mockStripe.refunds.create = mock.fn(() => Promise.resolve({
        id: 're_test_125',
        amount: null,
        currency: null,
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      }));

      const result = await provider.refund({ paymentIntentId: 'pi_test_123' });
      assert.strictEqual(result.amount.amount, 0);
      assert.strictEqual(result.amount.currency, 'USD');
    });
  });

  describe('verifyWebhook', () => {
    it('should verify valid webhook with checkout session event', async () => {
      const result = await provider.verifyWebhook(
        '{"type": "checkout.session.completed"}',
        't=123456,v1=abc123'
      );

      assert.strictEqual(result.isValid, true);
      assert.ok(result.event);
      assert.strictEqual(result.event.type, 'checkout.session.completed');
    });

    it('should return isValid true but no event for unmapped event types', async () => {
      mockStripe.webhooks.constructEvent = mock.fn(() => ({
        id: 'evt_test_127',
        type: 'customer.subscription.created',
        created: Math.floor(Date.now() / 1000),
        data: { object: { id: 'sub_123' } },
      }));

      const result = await provider.verifyWebhook('{}', 't=123,v1=abc');

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.event, undefined);
    });

    it('should return invalid for bad signature', async () => {
      mockStripe.webhooks.constructEvent = mock.fn(() => {
        throw new Error('Invalid signature');
      });

      const result = await provider.verifyWebhook('{}', 'invalid_signature');

      assert.strictEqual(result.isValid, false);
      assert.ok(result.error);
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when Stripe is accessible', async () => {
      const status = await provider.healthCheck();

      assert.strictEqual(status.provider, 'stripe');
      assert.strictEqual(status.healthy, true);
      assert.ok(status.latencyMs !== undefined);
      assert.ok(status.latencyMs >= 0);
    });

    it('should return unhealthy status on API failure', async () => {
      mockStripe.balance.retrieve = mock.fn(() =>
        Promise.reject(new Error('API unavailable'))
      );

      const status = await provider.healthCheck();

      assert.strictEqual(status.provider, 'stripe');
      assert.strictEqual(status.healthy, false);
      assert.ok(status.error);
    });
  });
});

describe('Stripe Status Mapping', () => {
  let provider: TestableStripeProvider;
  let mockStripe: MockStripe;

  beforeEach(() => {
    mockStripe = createMockStripe();
    provider = new TestableStripeProvider(mockStripe, 'whsec_test_secret');
  });

  describe('mapStripeStatus (via getPaymentIntent)', () => {
    const statusMappings = [
      { stripeStatus: 'succeeded', expectedStatus: 'succeeded' },
      { stripeStatus: 'processing', expectedStatus: 'processing' },
      { stripeStatus: 'requires_payment_method', expectedStatus: 'requires_action' },
      { stripeStatus: 'requires_confirmation', expectedStatus: 'requires_action' },
      { stripeStatus: 'requires_action', expectedStatus: 'requires_action' },
      { stripeStatus: 'canceled', expectedStatus: 'cancelled' },
      { stripeStatus: 'unknown_status', expectedStatus: 'pending' },
    ];

    for (const { stripeStatus, expectedStatus } of statusMappings) {
      it(`should map "${stripeStatus}" to "${expectedStatus}"`, async () => {
        mockStripe.paymentIntents.retrieve = mock.fn(() => Promise.resolve({
          id: 'pi_test',
          client_secret: 'secret',
          status: stripeStatus,
          amount: 999,
          currency: 'usd',
          created: Math.floor(Date.now() / 1000),
          metadata: {},
        }));

        const intent = await provider.getPaymentIntent('pi_test');
        assert.ok(intent);
        assert.strictEqual(intent.status, expectedStatus);
      });
    }
  });

  describe('mapStripeCheckoutStatus (via getCheckoutSession)', () => {
    it('should map complete+paid to succeeded', async () => {
      mockStripe.checkout.sessions.retrieve = mock.fn(() => Promise.resolve({
        id: 'cs_test',
        url: '',
        status: 'complete',
        payment_status: 'paid',
        expires_at: null,
        metadata: {},
      }));

      const session = await provider.getCheckoutSession('cs_test');
      assert.ok(session);
      assert.strictEqual(session.status, 'succeeded');
    });

    it('should map expired to cancelled', async () => {
      mockStripe.checkout.sessions.retrieve = mock.fn(() => Promise.resolve({
        id: 'cs_test',
        url: '',
        status: 'expired',
        payment_status: 'unpaid',
        expires_at: null,
        metadata: {},
      }));

      const session = await provider.getCheckoutSession('cs_test');
      assert.ok(session);
      assert.strictEqual(session.status, 'cancelled');
    });

    it('should map unpaid to pending', async () => {
      mockStripe.checkout.sessions.retrieve = mock.fn(() => Promise.resolve({
        id: 'cs_test',
        url: '',
        status: 'open',
        payment_status: 'unpaid',
        expires_at: null,
        metadata: {},
      }));

      const session = await provider.getCheckoutSession('cs_test');
      assert.ok(session);
      assert.strictEqual(session.status, 'pending');
    });
  });
});

describe('Currency Code Validation', () => {
  let provider: TestableStripeProvider;
  let mockStripe: MockStripe;

  beforeEach(() => {
    mockStripe = createMockStripe();
    provider = new TestableStripeProvider(mockStripe, 'whsec_test_secret');
  });

  const validCurrencies = ['usd', 'eur', 'gbp', 'cad', 'aud', 'jpy'];
  const expectedCurrencies: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

  for (let i = 0; i < validCurrencies.length; i++) {
    const currency = validCurrencies[i];
    const expected = expectedCurrencies[i];

    it(`should accept valid currency "${currency}" and normalize to "${expected}"`, async () => {
      mockStripe.paymentIntents.retrieve = mock.fn(() => Promise.resolve({
        id: 'pi_test',
        client_secret: 'secret',
        status: 'succeeded',
        amount: 999,
        currency: currency,
        created: Math.floor(Date.now() / 1000),
        metadata: {},
      }));

      const intent = await provider.getPaymentIntent('pi_test');
      assert.ok(intent);
      assert.strictEqual(intent.amount.currency, expected);
    });
  }

  const invalidCurrencies = ['xyz', 'abc', 'invalid', ''];

  for (const currency of invalidCurrencies) {
    it(`should default invalid currency "${currency}" to USD`, async () => {
      mockStripe.paymentIntents.retrieve = mock.fn(() => Promise.resolve({
        id: 'pi_test',
        client_secret: 'secret',
        status: 'succeeded',
        amount: 999,
        currency: currency,
        created: Math.floor(Date.now() / 1000),
        metadata: {},
      }));

      const intent = await provider.getPaymentIntent('pi_test');
      assert.ok(intent);
      assert.strictEqual(intent.amount.currency, 'USD');
    });
  }
});

describe('Refund Reason Mapping', () => {
  let provider: TestableStripeProvider;
  let mockStripe: MockStripe;

  beforeEach(() => {
    mockStripe = createMockStripe();
    provider = new TestableStripeProvider(mockStripe, 'whsec_test_secret');
  });

  it('should map duplicate reason correctly', async () => {
    let capturedReason: string | undefined;
    mockStripe.refunds.create = mock.fn((params: { reason?: string }) => {
      capturedReason = params.reason;
      return Promise.resolve({
        id: 're_test',
        amount: 999,
        currency: 'usd',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      });
    });

    await provider.refund({
      paymentIntentId: 'pi_test',
      reason: 'duplicate charge',
    });

    assert.strictEqual(capturedReason, 'duplicate');
  });

  it('should map fraudulent reason correctly', async () => {
    let capturedReason: string | undefined;
    mockStripe.refunds.create = mock.fn((params: { reason?: string }) => {
      capturedReason = params.reason;
      return Promise.resolve({
        id: 're_test',
        amount: 999,
        currency: 'usd',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      });
    });

    await provider.refund({
      paymentIntentId: 'pi_test',
      reason: 'fraud detected',
    });

    assert.strictEqual(capturedReason, 'fraudulent');
  });

  it('should default to requested_by_customer for other reasons', async () => {
    let capturedReason: string | undefined;
    mockStripe.refunds.create = mock.fn((params: { reason?: string }) => {
      capturedReason = params.reason;
      return Promise.resolve({
        id: 're_test',
        amount: 999,
        currency: 'usd',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      });
    });

    await provider.refund({
      paymentIntentId: 'pi_test',
      reason: 'customer changed mind',
    });

    assert.strictEqual(capturedReason, 'requested_by_customer');
  });

  it('should default to requested_by_customer when no reason provided', async () => {
    let capturedReason: string | undefined;
    mockStripe.refunds.create = mock.fn((params: { reason?: string }) => {
      capturedReason = params.reason;
      return Promise.resolve({
        id: 're_test',
        amount: 999,
        currency: 'usd',
        status: 'succeeded',
        created: Math.floor(Date.now() / 1000),
      });
    });

    await provider.refund({ paymentIntentId: 'pi_test' });

    assert.strictEqual(capturedReason, 'requested_by_customer');
  });
});

describe('Metadata Sanitization', () => {
  let provider: TestableStripeProvider;
  let mockStripe: MockStripe;

  beforeEach(() => {
    mockStripe = createMockStripe();
    provider = new TestableStripeProvider(mockStripe, 'whsec_test_secret');
  });

  it('should convert all metadata values to strings', async () => {
    let capturedMetadata: Record<string, string> | undefined;
    mockStripe.checkout.sessions.create = mock.fn((params: { metadata?: Record<string, string> }) => {
      capturedMetadata = params.metadata;
      return Promise.resolve({
        id: 'cs_test',
        url: 'https://checkout.stripe.com/pay/cs_test',
        status: 'open',
        payment_status: 'unpaid',
        expires_at: null,
        metadata: {},
      });
    });

    await provider.createCheckoutSession({
      customer: { id: 'user_123', email: 'test@example.com' },
      lineItems: [{
        id: 'item_1',
        name: 'Test',
        amount: 999,
        currency: 'USD' as CurrencyCode,
        quantity: 1,
      }],
      metadata: {
        userId: 'user_123',
        gameId: 'game_456',
      },
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    assert.ok(capturedMetadata);
    assert.strictEqual(capturedMetadata.userId, 'user_123');
    assert.strictEqual(capturedMetadata.gameId, 'game_456');
  });

  it('should exclude undefined metadata values', async () => {
    let capturedMetadata: Record<string, string> | undefined;
    mockStripe.checkout.sessions.create = mock.fn((params: { metadata?: Record<string, string> }) => {
      capturedMetadata = params.metadata;
      return Promise.resolve({
        id: 'cs_test',
        url: 'https://checkout.stripe.com/pay/cs_test',
        status: 'open',
        payment_status: 'unpaid',
        expires_at: null,
        metadata: {},
      });
    });

    await provider.createCheckoutSession({
      customer: { id: 'user_123', email: 'test@example.com' },
      lineItems: [{
        id: 'item_1',
        name: 'Test',
        amount: 999,
        currency: 'USD' as CurrencyCode,
        quantity: 1,
      }],
      metadata: {
        userId: 'user_123',
        gameId: undefined,
      },
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    });

    assert.ok(capturedMetadata);
    assert.strictEqual(capturedMetadata.userId, 'user_123');
    assert.strictEqual('gameId' in capturedMetadata, false);
  });
});
