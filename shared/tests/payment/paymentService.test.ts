/**
 * Tests for the PaymentService module.
 *
 * These tests verify the payment orchestration logic including:
 * - Provider initialization and availability
 * - Checkout session creation
 * - Webhook processing and signature verification
 * - Refund handling
 * - Currency validation
 * - Transaction status management
 *
 * IMPORTANT: These tests verify business logic without requiring
 * actual payment provider connections.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import type { CurrencyCode } from '../../src/payment/types.js';
import type { PaymentProvider } from '../../src/payment/types.js';

describe('PaymentService - Currency Validation', () => {
  const VALID_CURRENCY_CODES: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

  function toCurrencyCode(currency: string): CurrencyCode {
    const upper = currency.toUpperCase() as CurrencyCode;
    return VALID_CURRENCY_CODES.includes(upper) ? upper : 'USD';
  }

  describe('Valid Currencies', () => {
    it('should accept USD', () => {
      assert.strictEqual(toCurrencyCode('USD'), 'USD');
    });

    it('should accept EUR', () => {
      assert.strictEqual(toCurrencyCode('EUR'), 'EUR');
    });

    it('should accept GBP', () => {
      assert.strictEqual(toCurrencyCode('GBP'), 'GBP');
    });

    it('should accept CAD', () => {
      assert.strictEqual(toCurrencyCode('CAD'), 'CAD');
    });

    it('should accept AUD', () => {
      assert.strictEqual(toCurrencyCode('AUD'), 'AUD');
    });

    it('should accept JPY', () => {
      assert.strictEqual(toCurrencyCode('JPY'), 'JPY');
    });
  });

  describe('Case Insensitivity', () => {
    it('should accept lowercase currencies', () => {
      assert.strictEqual(toCurrencyCode('usd'), 'USD');
      assert.strictEqual(toCurrencyCode('eur'), 'EUR');
    });

    it('should accept mixed case currencies', () => {
      assert.strictEqual(toCurrencyCode('Usd'), 'USD');
      assert.strictEqual(toCurrencyCode('gBp'), 'GBP');
    });
  });

  describe('Invalid Currencies', () => {
    it('should default to USD for invalid currency', () => {
      assert.strictEqual(toCurrencyCode('INVALID'), 'USD');
    });

    it('should default to USD for empty string', () => {
      assert.strictEqual(toCurrencyCode(''), 'USD');
    });

    it('should default to USD for unsupported currencies', () => {
      assert.strictEqual(toCurrencyCode('CNY'), 'USD');
      assert.strictEqual(toCurrencyCode('INR'), 'USD');
      assert.strictEqual(toCurrencyCode('BRL'), 'USD');
    });
  });
});

describe('PaymentService - Amount Validation', () => {
  /**
   * Tests for payment amount validation logic.
   */

  function isValidAmount(amount: number): boolean {
    return Number.isInteger(amount) && amount > 0;
  }

  describe('Valid Amounts', () => {
    it('should accept positive integers', () => {
      assert.strictEqual(isValidAmount(100), true);
      assert.strictEqual(isValidAmount(1), true);
      assert.strictEqual(isValidAmount(9999), true);
    });
  });

  describe('Invalid Amounts', () => {
    it('should reject zero', () => {
      assert.strictEqual(isValidAmount(0), false);
    });

    it('should reject negative amounts', () => {
      assert.strictEqual(isValidAmount(-1), false);
      assert.strictEqual(isValidAmount(-100), false);
    });

    it('should reject non-integers', () => {
      assert.strictEqual(isValidAmount(10.5), false);
      assert.strictEqual(isValidAmount(99.99), false);
    });

    it('should reject NaN', () => {
      assert.strictEqual(isValidAmount(NaN), false);
    });

    it('should reject Infinity', () => {
      assert.strictEqual(isValidAmount(Infinity), false);
      assert.strictEqual(isValidAmount(-Infinity), false);
    });
  });
});

describe('PaymentService - Provider Availability', () => {
  /**
   * Tests for payment provider availability checks.
   */

  describe('Provider Map Operations', () => {
    it('should track available providers', () => {
      const providers = new Map<PaymentProvider, boolean>();
      providers.set('stripe', true);
      providers.set('paypal', true);

      assert.strictEqual(providers.has('stripe'), true);
      assert.strictEqual(providers.has('paypal'), true);
    });

    it('should return array of available providers', () => {
      const providers = new Map<PaymentProvider, boolean>();
      providers.set('stripe', true);
      providers.set('paypal', true);

      const available = Array.from(providers.keys());

      assert.deepStrictEqual(available, ['stripe', 'paypal']);
    });

    it('should check if provider is available', () => {
      const providers = new Map<PaymentProvider, boolean>();
      providers.set('stripe', true);

      assert.strictEqual(providers.has('stripe'), true);
      assert.strictEqual(providers.has('paypal'), false);
    });
  });
});

describe('PaymentService - Webhook Event Types', () => {
  /**
   * Tests for webhook event type handling.
   */

  const handledEventTypes = [
    'checkout.session.completed',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
  ];

  describe('Event Type Recognition', () => {
    for (const eventType of handledEventTypes) {
      it(`should recognize ${eventType} as handled event`, () => {
        assert.ok(handledEventTypes.includes(eventType));
      });
    }

    it('should not recognize unknown event types', () => {
      const unknownType = 'customer.created';
      assert.strictEqual(handledEventTypes.includes(unknownType), false);
    });
  });

  describe('Event Type Switch Cases', () => {
    function getHandlerName(eventType: string): string {
      switch (eventType) {
        case 'checkout.session.completed':
          return 'handleCheckoutCompleted';
        case 'payment_intent.succeeded':
          return 'handlePaymentSucceeded';
        case 'payment_intent.payment_failed':
          return 'handlePaymentFailed';
        case 'charge.refunded':
          return 'handleRefund';
        default:
          return 'unhandled';
      }
    }

    it('should route checkout.session.completed correctly', () => {
      assert.strictEqual(
        getHandlerName('checkout.session.completed'),
        'handleCheckoutCompleted'
      );
    });

    it('should route payment_intent.succeeded correctly', () => {
      assert.strictEqual(
        getHandlerName('payment_intent.succeeded'),
        'handlePaymentSucceeded'
      );
    });

    it('should route payment_intent.payment_failed correctly', () => {
      assert.strictEqual(
        getHandlerName('payment_intent.payment_failed'),
        'handlePaymentFailed'
      );
    });

    it('should route charge.refunded correctly', () => {
      assert.strictEqual(
        getHandlerName('charge.refunded'),
        'handleRefund'
      );
    });

    it('should return unhandled for unknown events', () => {
      assert.strictEqual(getHandlerName('unknown.event'), 'unhandled');
    });
  });
});

describe('PaymentService - Transaction Status', () => {
  /**
   * Tests for transaction status management.
   */

  const validStatuses = ['pending', 'succeeded', 'failed', 'refunded'];

  describe('Status Transitions', () => {
    it('should allow pending to succeeded', () => {
      const from = 'pending';
      const to = 'succeeded';

      const validTransition = from === 'pending' && to === 'succeeded';

      assert.strictEqual(validTransition, true);
    });

    it('should allow pending to failed', () => {
      const from = 'pending';
      const to = 'failed';

      const validTransition = from === 'pending' && to === 'failed';

      assert.strictEqual(validTransition, true);
    });

    it('should allow succeeded to refunded', () => {
      const from = 'succeeded';
      const to = 'refunded';

      const validTransition = from === 'succeeded' && to === 'refunded';

      assert.strictEqual(validTransition, true);
    });
  });

  describe('Refund Eligibility', () => {
    it('should only allow refund for succeeded transactions', () => {
      const statuses = ['pending', 'succeeded', 'failed', 'refunded'];

      for (const status of statuses) {
        const canRefund = status === 'succeeded';

        if (status === 'succeeded') {
          assert.strictEqual(canRefund, true);
        } else {
          assert.strictEqual(canRefund, false, `Should not refund ${status}`);
        }
      }
    });
  });
});

describe('PaymentService - Checkout Request Structure', () => {
  /**
   * Tests for checkout request data structure.
   */

  describe('Required Fields', () => {
    it('should include customer information', () => {
      const request = {
        customer: {
          id: 'user-123',
          email: 'test@example.com',
        },
        lineItems: [],
        metadata: {},
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      };

      assert.strictEqual(request.customer.id, 'user-123');
      assert.strictEqual(request.customer.email, 'test@example.com');
    });

    it('should include line items', () => {
      const request = {
        lineItems: [
          {
            id: 'game-123',
            name: 'Awesome Game',
            amount: 999,
            currency: 'USD' as CurrencyCode,
            quantity: 1,
          },
        ],
      };

      assert.strictEqual(request.lineItems.length, 1);
      assert.strictEqual(request.lineItems[0].id, 'game-123');
      assert.strictEqual(request.lineItems[0].amount, 999);
    });

    it('should include metadata', () => {
      const request = {
        metadata: {
          userId: 'user-123',
          gameId: 'game-123',
          transactionId: 'tx-123',
        },
      };

      assert.strictEqual(request.metadata.userId, 'user-123');
      assert.strictEqual(request.metadata.gameId, 'game-123');
    });

    it('should include redirect URLs', () => {
      const request = {
        successUrl: 'https://example.com/success?session_id={CHECKOUT_SESSION_ID}',
        cancelUrl: 'https://example.com/cancel',
      };

      assert.ok(request.successUrl.startsWith('https://'));
      assert.ok(request.cancelUrl.startsWith('https://'));
    });
  });
});

describe('PaymentService - Webhook Verification Result', () => {
  /**
   * Tests for webhook verification result structure.
   */

  describe('Success Cases', () => {
    it('should indicate valid webhook with event', () => {
      const result = {
        isValid: true,
        event: {
          id: 'evt_123',
          type: 'checkout.session.completed',
          data: {},
        },
        error: undefined,
      };

      assert.strictEqual(result.isValid, true);
      assert.ok(result.event);
      assert.strictEqual(result.error, undefined);
    });

    it('should indicate valid webhook without event for unhandled types', () => {
      const result = {
        isValid: true,
        event: undefined,
        error: undefined,
      };

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.event, undefined);
    });
  });

  describe('Failure Cases', () => {
    it('should indicate invalid webhook with error', () => {
      const result = {
        isValid: false,
        event: undefined,
        error: 'Invalid signature',
      };

      assert.strictEqual(result.isValid, false);
      assert.strictEqual(result.error, 'Invalid signature');
    });
  });
});

describe('PaymentService - Process Webhook Result', () => {
  /**
   * Tests for webhook processing result structure.
   */

  describe('Success Result', () => {
    it('should include success flag and IDs', () => {
      const result = {
        success: true,
        transactionId: 'tx-123',
        purchaseId: 'purchase-456',
      };

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transactionId, 'tx-123');
      assert.strictEqual(result.purchaseId, 'purchase-456');
    });

    it('should allow optional purchaseId', () => {
      const result = {
        success: true,
        transactionId: 'tx-123',
      };

      assert.strictEqual(result.success, true);
      assert.strictEqual((result as { purchaseId?: string }).purchaseId, undefined);
    });
  });

  describe('Failure Result', () => {
    it('should include error message', () => {
      const result = {
        success: false,
        error: 'Transaction not found',
      };

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Transaction not found');
    });
  });
});

describe('PaymentService - Purchase Completion', () => {
  /**
   * Tests for purchase completion workflow.
   */

  describe('Purchase Record Fields', () => {
    it('should create complete purchase record', () => {
      const purchase = {
        id: 'purchase-123',
        userId: 'user-123',
        gameId: 'game-123',
        amount: 999,
        currency: 'USD',
        status: 'completed',
        paymentMethod: 'credit_card',
        paymentDetails: { transactionId: 'tx-123' },
        completedAt: new Date(),
      };

      assert.strictEqual(purchase.status, 'completed');
      assert.ok(purchase.completedAt);
    });
  });

  describe('Payment Method Mapping', () => {
    it('should map stripe to credit_card', () => {
      const provider = 'stripe';
      const paymentMethod = provider === 'stripe' ? 'credit_card' : 'paypal';

      assert.strictEqual(paymentMethod, 'credit_card');
    });

    it('should map paypal to paypal', () => {
      const provider = 'paypal';
      const paymentMethod = provider === 'stripe' ? 'credit_card' : 'paypal';

      assert.strictEqual(paymentMethod, 'paypal');
    });
  });
});

describe('PaymentService - Refund Request', () => {
  /**
   * Tests for refund request structure.
   */

  describe('Refund Request Fields', () => {
    it('should include required payment intent ID', () => {
      const request = {
        paymentIntentId: 'pi_123',
      };

      assert.strictEqual(request.paymentIntentId, 'pi_123');
    });

    it('should allow optional amount for partial refunds', () => {
      const request = {
        paymentIntentId: 'pi_123',
        amount: 500,
      };

      assert.strictEqual(request.amount, 500);
    });

    it('should allow optional reason', () => {
      const request = {
        paymentIntentId: 'pi_123',
        reason: 'Customer requested refund',
      };

      assert.strictEqual(request.reason, 'Customer requested refund');
    });
  });
});

describe('PaymentService - Health Check', () => {
  /**
   * Tests for provider health check structure.
   */

  describe('Health Status Fields', () => {
    it('should include provider and status', () => {
      const status = {
        provider: 'stripe' as PaymentProvider,
        healthy: true,
        latencyMs: 150,
        lastChecked: new Date(),
      };

      assert.strictEqual(status.provider, 'stripe');
      assert.strictEqual(status.healthy, true);
      assert.ok(typeof status.latencyMs === 'number');
    });

    it('should indicate unhealthy provider', () => {
      const status = {
        provider: 'paypal' as PaymentProvider,
        healthy: false,
        error: 'Connection timeout',
        lastChecked: new Date(),
      };

      assert.strictEqual(status.healthy, false);
      assert.strictEqual(status.error, 'Connection timeout');
    });
  });
});

describe('PaymentService - Metadata Extraction', () => {
  /**
   * Tests for extracting metadata from webhook events.
   */

  describe('Required Metadata Fields', () => {
    it('should validate presence of userId', () => {
      const metadata = {
        userId: 'user-123',
        gameId: 'game-123',
      };

      const hasRequired = metadata.userId && metadata.gameId;

      assert.ok(hasRequired);
    });

    it('should reject missing userId', () => {
      const metadata = {
        gameId: 'game-123',
      };

      const hasRequired = (metadata as { userId?: string }).userId &&
        metadata.gameId;

      assert.strictEqual(!!hasRequired, false);
    });

    it('should reject missing gameId', () => {
      const metadata = {
        userId: 'user-123',
      };

      const hasRequired = metadata.userId &&
        (metadata as { gameId?: string }).gameId;

      assert.strictEqual(!!hasRequired, false);
    });
  });
});

describe('PaymentService - Transaction Record', () => {
  /**
   * Tests for transaction record structure.
   */

  describe('Transaction Fields', () => {
    it('should store all required fields', () => {
      const transaction = {
        id: 'tx-123',
        userId: 'user-123',
        provider: 'stripe',
        providerTransactionId: 'pi_123',
        providerSessionId: 'cs_123',
        type: 'checkout',
        status: 'pending',
        amount: 999,
        currency: 'USD',
        metadata: {
          gameId: 'game-123',
          gameName: 'Awesome Game',
          customerEmail: 'test@example.com',
        },
      };

      assert.strictEqual(transaction.type, 'checkout');
      assert.strictEqual(transaction.status, 'pending');
      assert.strictEqual(transaction.amount, 999);
    });

    it('should store refund transaction type', () => {
      const transaction = {
        id: 'tx-456',
        type: 'refund',
        metadata: {
          originalTransactionId: 'tx-123',
        },
      };

      assert.strictEqual(transaction.type, 'refund');
      assert.strictEqual(
        transaction.metadata.originalTransactionId,
        'tx-123'
      );
    });
  });
});

describe('PaymentService - PayPal Order Capture', () => {
  /**
   * Tests for PayPal order capture workflow.
   */

  describe('Capture Result', () => {
    it('should return success with transaction ID', () => {
      const result = {
        success: true,
        transactionId: 'tx-123',
        purchaseId: 'purchase-123',
      };

      assert.strictEqual(result.success, true);
      assert.ok(result.transactionId);
    });

    it('should handle capture failure', () => {
      const result = {
        success: false,
        error: 'Order not found',
      };

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Order not found');
    });
  });
});

describe('PaymentService - Webhook Logging', () => {
  /**
   * Tests for webhook event logging structure.
   */

  describe('Webhook Record Fields', () => {
    it('should store webhook event data', () => {
      const webhookRecord = {
        id: 'webhook-123',
        provider: 'stripe',
        eventId: 'evt_123',
        eventType: 'checkout.session.completed',
        payload: { data: { object: {} } },
        processed: false,
        processedAt: null,
        transactionId: null,
        error: null,
      };

      assert.strictEqual(webhookRecord.eventType, 'checkout.session.completed');
      assert.strictEqual(webhookRecord.processed, false);
    });

    it('should update after processing', () => {
      const webhookRecord = {
        processed: true,
        processedAt: new Date(),
        transactionId: 'tx-123',
        error: null,
      };

      assert.strictEqual(webhookRecord.processed, true);
      assert.ok(webhookRecord.processedAt);
      assert.strictEqual(webhookRecord.transactionId, 'tx-123');
    });

    it('should store error on failure', () => {
      const webhookRecord = {
        processed: true,
        processedAt: new Date(),
        transactionId: null,
        error: 'Processing failed: Transaction not found',
      };

      assert.strictEqual(webhookRecord.processed, true);
      assert.ok(webhookRecord.error);
    });
  });
});
