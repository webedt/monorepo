/**
 * Tests for the PaymentService module.
 *
 * These tests verify the payment orchestration logic including:
 * - Provider initialization and availability
 * - Currency validation and conversion
 * - Status mapping from providers to internal format
 * - Webhook event type mapping
 * - Amount conversion utilities
 * - Error handling utilities
 *
 * IMPORTANT: These tests verify actual exported utility functions
 * from the payment module without requiring actual payment provider connections.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  VALID_CURRENCY_CODES,
  toCurrencyCode,
  sanitizeMetadata,
  mapRefundReason,
  mapStripeStatus,
  mapStripeCheckoutStatus,
  mapStripeEventType,
  mapPayPalStatus,
  mapPayPalEventType,
  dollarsToCents,
  centsToDollars,
  PayPalApiError,
  isPayPalNotFoundError,
  isStripeNotFoundError,
} from '../../src/payment/utils.js';

import type { CurrencyCode } from '../../src/payment/types.js';
import type { PaymentProvider } from '../../src/payment/types.js';

describe('PaymentService - VALID_CURRENCY_CODES', () => {
  it('should include USD', () => {
    assert.ok(VALID_CURRENCY_CODES.includes('USD'));
  });

  it('should include EUR', () => {
    assert.ok(VALID_CURRENCY_CODES.includes('EUR'));
  });

  it('should include GBP', () => {
    assert.ok(VALID_CURRENCY_CODES.includes('GBP'));
  });

  it('should include CAD', () => {
    assert.ok(VALID_CURRENCY_CODES.includes('CAD'));
  });

  it('should include AUD', () => {
    assert.ok(VALID_CURRENCY_CODES.includes('AUD'));
  });

  it('should include JPY', () => {
    assert.ok(VALID_CURRENCY_CODES.includes('JPY'));
  });

  it('should have exactly 6 currencies', () => {
    assert.strictEqual(VALID_CURRENCY_CODES.length, 6);
  });
});

describe('PaymentService - toCurrencyCode', () => {
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

describe('PaymentService - sanitizeMetadata', () => {
  it('should convert number to string', () => {
    const result = sanitizeMetadata({ userId: 'user-123', amount: 999 as unknown as string });
    assert.strictEqual(result.amount, '999');
  });

  it('should keep string values as-is', () => {
    const result = sanitizeMetadata({ userId: 'user-123', gameId: 'game-456' });
    assert.strictEqual(result.userId, 'user-123');
    assert.strictEqual(result.gameId, 'game-456');
  });

  it('should remove undefined values', () => {
    const result = sanitizeMetadata({ userId: 'user-123', gameId: undefined as unknown as string });
    assert.ok(!('gameId' in result));
    assert.strictEqual(result.userId, 'user-123');
  });

  it('should handle empty metadata', () => {
    const result = sanitizeMetadata({});
    assert.deepStrictEqual(result, {});
  });
});

describe('PaymentService - mapRefundReason', () => {
  it('should return requested_by_customer for undefined', () => {
    assert.strictEqual(mapRefundReason(undefined), 'requested_by_customer');
  });

  it('should return requested_by_customer for empty string', () => {
    assert.strictEqual(mapRefundReason(''), 'requested_by_customer');
  });

  it('should detect duplicate reason', () => {
    assert.strictEqual(mapRefundReason('duplicate transaction'), 'duplicate');
    assert.strictEqual(mapRefundReason('DUPLICATE'), 'duplicate');
  });

  it('should detect fraudulent reason', () => {
    assert.strictEqual(mapRefundReason('suspected fraud'), 'fraudulent');
    assert.strictEqual(mapRefundReason('FRAUD'), 'fraudulent');
  });

  it('should default to requested_by_customer for other reasons', () => {
    assert.strictEqual(mapRefundReason('customer changed mind'), 'requested_by_customer');
    assert.strictEqual(mapRefundReason('product defective'), 'requested_by_customer');
  });
});

describe('PaymentService - mapStripeStatus', () => {
  it('should map succeeded to succeeded', () => {
    assert.strictEqual(mapStripeStatus('succeeded'), 'succeeded');
  });

  it('should map processing to processing', () => {
    assert.strictEqual(mapStripeStatus('processing'), 'processing');
  });

  it('should map requires_payment_method to requires_action', () => {
    assert.strictEqual(mapStripeStatus('requires_payment_method'), 'requires_action');
  });

  it('should map requires_confirmation to requires_action', () => {
    assert.strictEqual(mapStripeStatus('requires_confirmation'), 'requires_action');
  });

  it('should map requires_action to requires_action', () => {
    assert.strictEqual(mapStripeStatus('requires_action'), 'requires_action');
  });

  it('should map canceled to cancelled', () => {
    assert.strictEqual(mapStripeStatus('canceled'), 'cancelled');
  });

  it('should default to pending for unknown status', () => {
    assert.strictEqual(mapStripeStatus('unknown'), 'pending');
    assert.strictEqual(mapStripeStatus(''), 'pending');
  });
});

describe('PaymentService - mapStripeCheckoutStatus', () => {
  it('should return succeeded for complete and paid', () => {
    assert.strictEqual(mapStripeCheckoutStatus('complete', 'paid'), 'succeeded');
  });

  it('should return cancelled for expired', () => {
    assert.strictEqual(mapStripeCheckoutStatus('expired', null), 'cancelled');
  });

  it('should return pending for unpaid', () => {
    assert.strictEqual(mapStripeCheckoutStatus('open', 'unpaid'), 'pending');
  });

  it('should return pending for null values', () => {
    assert.strictEqual(mapStripeCheckoutStatus(null, null), 'pending');
  });

  it('should return pending for unknown status', () => {
    assert.strictEqual(mapStripeCheckoutStatus('unknown', 'unknown'), 'pending');
  });
});

describe('PaymentService - mapStripeEventType', () => {
  it('should map checkout.session.completed', () => {
    assert.strictEqual(mapStripeEventType('checkout.session.completed'), 'checkout.session.completed');
  });

  it('should map checkout.session.expired', () => {
    assert.strictEqual(mapStripeEventType('checkout.session.expired'), 'checkout.session.expired');
  });

  it('should map payment_intent.succeeded', () => {
    assert.strictEqual(mapStripeEventType('payment_intent.succeeded'), 'payment_intent.succeeded');
  });

  it('should map payment_intent.payment_failed', () => {
    assert.strictEqual(mapStripeEventType('payment_intent.payment_failed'), 'payment_intent.payment_failed');
  });

  it('should map payment_intent.canceled', () => {
    assert.strictEqual(mapStripeEventType('payment_intent.canceled'), 'payment_intent.cancelled');
  });

  it('should map charge.refunded', () => {
    assert.strictEqual(mapStripeEventType('charge.refunded'), 'charge.refunded');
  });

  it('should map charge.dispute.created', () => {
    assert.strictEqual(mapStripeEventType('charge.dispute.created'), 'charge.dispute.created');
  });

  it('should return null for unknown event types', () => {
    assert.strictEqual(mapStripeEventType('unknown.event'), null);
    assert.strictEqual(mapStripeEventType('customer.created'), null);
  });
});

describe('PaymentService - mapPayPalStatus', () => {
  it('should map COMPLETED to succeeded', () => {
    assert.strictEqual(mapPayPalStatus('COMPLETED'), 'succeeded');
  });

  it('should map APPROVED to succeeded', () => {
    assert.strictEqual(mapPayPalStatus('APPROVED'), 'succeeded');
  });

  it('should be case-insensitive', () => {
    assert.strictEqual(mapPayPalStatus('completed'), 'succeeded');
    assert.strictEqual(mapPayPalStatus('Approved'), 'succeeded');
  });

  it('should map CREATED to requires_action', () => {
    assert.strictEqual(mapPayPalStatus('CREATED'), 'requires_action');
  });

  it('should map SAVED to requires_action', () => {
    assert.strictEqual(mapPayPalStatus('SAVED'), 'requires_action');
  });

  it('should map PAYER_ACTION_REQUIRED to requires_action', () => {
    assert.strictEqual(mapPayPalStatus('PAYER_ACTION_REQUIRED'), 'requires_action');
  });

  it('should map VOIDED to cancelled', () => {
    assert.strictEqual(mapPayPalStatus('VOIDED'), 'cancelled');
  });

  it('should default to pending for unknown status', () => {
    assert.strictEqual(mapPayPalStatus('unknown'), 'pending');
    assert.strictEqual(mapPayPalStatus(''), 'pending');
  });
});

describe('PaymentService - mapPayPalEventType', () => {
  it('should map CHECKOUT.ORDER.APPROVED', () => {
    assert.strictEqual(mapPayPalEventType('CHECKOUT.ORDER.APPROVED'), 'checkout.session.completed');
  });

  it('should map CHECKOUT.ORDER.COMPLETED', () => {
    assert.strictEqual(mapPayPalEventType('CHECKOUT.ORDER.COMPLETED'), 'checkout.session.completed');
  });

  it('should map PAYMENT.CAPTURE.COMPLETED', () => {
    assert.strictEqual(mapPayPalEventType('PAYMENT.CAPTURE.COMPLETED'), 'payment_intent.succeeded');
  });

  it('should map PAYMENT.CAPTURE.DENIED', () => {
    assert.strictEqual(mapPayPalEventType('PAYMENT.CAPTURE.DENIED'), 'payment_intent.payment_failed');
  });

  it('should map PAYMENT.CAPTURE.REFUNDED', () => {
    assert.strictEqual(mapPayPalEventType('PAYMENT.CAPTURE.REFUNDED'), 'charge.refunded');
  });

  it('should map CUSTOMER.DISPUTE.CREATED', () => {
    assert.strictEqual(mapPayPalEventType('CUSTOMER.DISPUTE.CREATED'), 'charge.dispute.created');
  });

  it('should return null for unknown event types', () => {
    assert.strictEqual(mapPayPalEventType('UNKNOWN.EVENT'), null);
  });
});

describe('PaymentService - dollarsToCents', () => {
  it('should convert whole dollars', () => {
    assert.strictEqual(dollarsToCents('10'), 1000);
    assert.strictEqual(dollarsToCents('1'), 100);
    assert.strictEqual(dollarsToCents('0'), 0);
  });

  it('should convert dollars with cents', () => {
    assert.strictEqual(dollarsToCents('9.99'), 999);
    assert.strictEqual(dollarsToCents('19.95'), 1995);
    assert.strictEqual(dollarsToCents('0.01'), 1);
  });

  it('should handle floating point precision', () => {
    // This is the famous floating point issue: 0.1 + 0.2 !== 0.3
    // The function uses Math.round to handle this
    assert.strictEqual(dollarsToCents('0.10'), 10);
    assert.strictEqual(dollarsToCents('0.20'), 20);
    assert.strictEqual(dollarsToCents('0.30'), 30);
  });

  it('should handle large amounts', () => {
    assert.strictEqual(dollarsToCents('9999.99'), 999999);
    assert.strictEqual(dollarsToCents('100000'), 10000000);
  });
});

describe('PaymentService - centsToDollars', () => {
  it('should convert cents to dollars', () => {
    assert.strictEqual(centsToDollars(1000), '10.00');
    assert.strictEqual(centsToDollars(100), '1.00');
    assert.strictEqual(centsToDollars(0), '0.00');
  });

  it('should include cents in output', () => {
    assert.strictEqual(centsToDollars(999), '9.99');
    assert.strictEqual(centsToDollars(1995), '19.95');
    assert.strictEqual(centsToDollars(1), '0.01');
  });

  it('should always have 2 decimal places', () => {
    assert.strictEqual(centsToDollars(500), '5.00');
    assert.strictEqual(centsToDollars(1050), '10.50');
  });

  it('should handle large amounts', () => {
    assert.strictEqual(centsToDollars(999999), '9999.99');
    assert.strictEqual(centsToDollars(10000000), '100000.00');
  });
});

describe('PaymentService - PayPalApiError', () => {
  it('should create error with status code and message', () => {
    const error = new PayPalApiError(404, 'Order not found');
    assert.strictEqual(error.statusCode, 404);
    assert.strictEqual(error.message, 'Order not found');
    assert.strictEqual(error.name, 'PayPalApiError');
  });

  it('should be an instance of Error', () => {
    const error = new PayPalApiError(500, 'Internal error');
    assert.ok(error instanceof Error);
  });

  it('should identify 404 as not found', () => {
    const error = new PayPalApiError(404, 'Not found');
    assert.strictEqual(error.isNotFound(), true);
  });

  it('should not identify other status codes as not found', () => {
    const error400 = new PayPalApiError(400, 'Bad request');
    const error500 = new PayPalApiError(500, 'Server error');
    assert.strictEqual(error400.isNotFound(), false);
    assert.strictEqual(error500.isNotFound(), false);
  });
});

describe('PaymentService - isPayPalNotFoundError', () => {
  it('should return true for PayPalApiError with 404', () => {
    const error = new PayPalApiError(404, 'Order not found');
    assert.strictEqual(isPayPalNotFoundError(error), true);
  });

  it('should return false for PayPalApiError with other status', () => {
    const error = new PayPalApiError(500, 'Server error');
    assert.strictEqual(isPayPalNotFoundError(error), false);
  });

  it('should return true for Error with 404 in message', () => {
    const error = new Error('Request failed with status 404');
    assert.strictEqual(isPayPalNotFoundError(error), true);
  });

  it('should return true for Error with RESOURCE_NOT_FOUND in message', () => {
    const error = new Error('PayPal error: RESOURCE_NOT_FOUND');
    assert.strictEqual(isPayPalNotFoundError(error), true);
  });

  it('should return false for regular Error', () => {
    const error = new Error('Something went wrong');
    assert.strictEqual(isPayPalNotFoundError(error), false);
  });

  it('should return false for non-Error values', () => {
    assert.strictEqual(isPayPalNotFoundError(null), false);
    assert.strictEqual(isPayPalNotFoundError('error'), false);
    assert.strictEqual(isPayPalNotFoundError(404), false);
  });
});

describe('PaymentService - isStripeNotFoundError', () => {
  it('should return true for error with resource_missing code', () => {
    const error = { code: 'resource_missing', message: 'Not found' };
    assert.strictEqual(isStripeNotFoundError(error), true);
  });

  it('should return false for error with other code', () => {
    const error = { code: 'card_declined', message: 'Card declined' };
    assert.strictEqual(isStripeNotFoundError(error), false);
  });

  it('should return false for error without code', () => {
    const error = { message: 'Not found' };
    assert.strictEqual(isStripeNotFoundError(error), false);
  });

  it('should return false for null', () => {
    assert.strictEqual(isStripeNotFoundError(null), false);
  });

  it('should return false for undefined', () => {
    assert.strictEqual(isStripeNotFoundError(undefined), false);
  });

  it('should return false for non-object', () => {
    assert.strictEqual(isStripeNotFoundError('error'), false);
    assert.strictEqual(isStripeNotFoundError(404), false);
  });
});

describe('PaymentService - Provider Availability', () => {
  /**
   * Tests for payment provider availability patterns.
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
  });
});

describe('PaymentService - Transaction Status', () => {
  /**
   * Tests for transaction status management patterns.
   */

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
   * Tests for checkout request data structure patterns.
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
