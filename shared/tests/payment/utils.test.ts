/**
 * Unit Tests for Payment Utility Functions
 *
 * Tests the shared utility functions used by payment providers.
 * These are pure functions that can be tested directly without mocking.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

import {
  centsToDollars,
  dollarsToCents,
  isPayPalNotFoundError,
  isStripeNotFoundError,
  mapPayPalEventType,
  mapPayPalStatus,
  mapRefundReason,
  mapStripeCheckoutStatus,
  mapStripeEventType,
  mapStripeStatus,
  PayPalApiError,
  sanitizeMetadata,
  toCurrencyCode,
  VALID_CURRENCY_CODES,
} from '../../src/payment/utils.js';

describe('Currency Code Validation', () => {
  describe('toCurrencyCode', () => {
    it('should return valid currency codes as-is', () => {
      for (const code of VALID_CURRENCY_CODES) {
        assert.strictEqual(toCurrencyCode(code), code);
      }
    });

    it('should normalize lowercase to uppercase', () => {
      assert.strictEqual(toCurrencyCode('usd'), 'USD');
      assert.strictEqual(toCurrencyCode('eur'), 'EUR');
      assert.strictEqual(toCurrencyCode('gbp'), 'GBP');
    });

    it('should default invalid currencies to USD', () => {
      assert.strictEqual(toCurrencyCode('XYZ'), 'USD');
      assert.strictEqual(toCurrencyCode('INVALID'), 'USD');
      assert.strictEqual(toCurrencyCode(''), 'USD');
    });
  });
});

describe('Metadata Sanitization', () => {
  describe('sanitizeMetadata', () => {
    it('should convert all values to strings', () => {
      const result = sanitizeMetadata({
        userId: 'user_123',
        gameId: 'game_456',
      });
      assert.strictEqual(result.userId, 'user_123');
      assert.strictEqual(result.gameId, 'game_456');
    });

    it('should exclude undefined values', () => {
      const result = sanitizeMetadata({
        userId: 'user_123',
        gameId: undefined,
      });
      assert.strictEqual(result.userId, 'user_123');
      assert.strictEqual('gameId' in result, false);
    });

    it('should convert non-string values to strings', () => {
      const result = sanitizeMetadata({
        userId: 'user_123',
        count: 42 as unknown as string,
        active: true as unknown as string,
      });
      assert.strictEqual(result.count, '42');
      assert.strictEqual(result.active, 'true');
    });
  });
});

describe('Refund Reason Mapping', () => {
  describe('mapRefundReason', () => {
    it('should map "duplicate" reason', () => {
      assert.strictEqual(mapRefundReason('duplicate charge'), 'duplicate');
      assert.strictEqual(mapRefundReason('Duplicate order'), 'duplicate');
    });

    it('should map "fraud" reason', () => {
      assert.strictEqual(mapRefundReason('fraud detected'), 'fraudulent');
      assert.strictEqual(mapRefundReason('FRAUDULENT transaction'), 'fraudulent');
    });

    it('should default to requested_by_customer', () => {
      assert.strictEqual(mapRefundReason('customer request'), 'requested_by_customer');
      assert.strictEqual(mapRefundReason('changed mind'), 'requested_by_customer');
      assert.strictEqual(mapRefundReason(), 'requested_by_customer');
      assert.strictEqual(mapRefundReason(''), 'requested_by_customer');
    });
  });
});

describe('Stripe Status Mapping', () => {
  describe('mapStripeStatus', () => {
    it('should map "succeeded" to "succeeded"', () => {
      assert.strictEqual(mapStripeStatus('succeeded'), 'succeeded');
    });

    it('should map "processing" to "processing"', () => {
      assert.strictEqual(mapStripeStatus('processing'), 'processing');
    });

    it('should map requires_* statuses to "requires_action"', () => {
      assert.strictEqual(mapStripeStatus('requires_payment_method'), 'requires_action');
      assert.strictEqual(mapStripeStatus('requires_confirmation'), 'requires_action');
      assert.strictEqual(mapStripeStatus('requires_action'), 'requires_action');
    });

    it('should map "canceled" to "cancelled"', () => {
      assert.strictEqual(mapStripeStatus('canceled'), 'cancelled');
    });

    it('should default unknown statuses to "pending"', () => {
      assert.strictEqual(mapStripeStatus('unknown'), 'pending');
      assert.strictEqual(mapStripeStatus(''), 'pending');
    });
  });

  describe('mapStripeCheckoutStatus', () => {
    it('should map complete+paid to succeeded', () => {
      assert.strictEqual(mapStripeCheckoutStatus('complete', 'paid'), 'succeeded');
    });

    it('should map expired to cancelled', () => {
      assert.strictEqual(mapStripeCheckoutStatus('expired', 'unpaid'), 'cancelled');
      assert.strictEqual(mapStripeCheckoutStatus('expired', null), 'cancelled');
    });

    it('should map unpaid to pending', () => {
      assert.strictEqual(mapStripeCheckoutStatus('open', 'unpaid'), 'pending');
      assert.strictEqual(mapStripeCheckoutStatus(null, 'unpaid'), 'pending');
    });

    it('should default to pending', () => {
      assert.strictEqual(mapStripeCheckoutStatus(null, null), 'pending');
      assert.strictEqual(mapStripeCheckoutStatus('unknown', null), 'pending');
    });
  });

  describe('mapStripeEventType', () => {
    it('should map checkout session events', () => {
      assert.strictEqual(mapStripeEventType('checkout.session.completed'), 'checkout.session.completed');
      assert.strictEqual(mapStripeEventType('checkout.session.expired'), 'checkout.session.expired');
    });

    it('should map payment intent events', () => {
      assert.strictEqual(mapStripeEventType('payment_intent.succeeded'), 'payment_intent.succeeded');
      assert.strictEqual(mapStripeEventType('payment_intent.payment_failed'), 'payment_intent.payment_failed');
      assert.strictEqual(mapStripeEventType('payment_intent.canceled'), 'payment_intent.cancelled');
    });

    it('should map charge events', () => {
      assert.strictEqual(mapStripeEventType('charge.refunded'), 'charge.refunded');
      assert.strictEqual(mapStripeEventType('charge.dispute.created'), 'charge.dispute.created');
    });

    it('should return null for unmapped events', () => {
      assert.strictEqual(mapStripeEventType('customer.created'), null);
      assert.strictEqual(mapStripeEventType('unknown.event'), null);
    });
  });
});

describe('PayPal Status Mapping', () => {
  describe('mapPayPalStatus', () => {
    it('should map success statuses to "succeeded"', () => {
      assert.strictEqual(mapPayPalStatus('COMPLETED'), 'succeeded');
      assert.strictEqual(mapPayPalStatus('APPROVED'), 'succeeded');
      assert.strictEqual(mapPayPalStatus('completed'), 'succeeded');
    });

    it('should map action required statuses', () => {
      assert.strictEqual(mapPayPalStatus('CREATED'), 'requires_action');
      assert.strictEqual(mapPayPalStatus('SAVED'), 'requires_action');
      assert.strictEqual(mapPayPalStatus('PAYER_ACTION_REQUIRED'), 'requires_action');
    });

    it('should map "VOIDED" to "cancelled"', () => {
      assert.strictEqual(mapPayPalStatus('VOIDED'), 'cancelled');
    });

    it('should default unknown statuses to "pending"', () => {
      assert.strictEqual(mapPayPalStatus('UNKNOWN'), 'pending');
      assert.strictEqual(mapPayPalStatus(''), 'pending');
    });
  });

  describe('mapPayPalEventType', () => {
    it('should map checkout order events', () => {
      assert.strictEqual(mapPayPalEventType('CHECKOUT.ORDER.APPROVED'), 'checkout.session.completed');
      assert.strictEqual(mapPayPalEventType('CHECKOUT.ORDER.COMPLETED'), 'checkout.session.completed');
    });

    it('should map payment capture events', () => {
      assert.strictEqual(mapPayPalEventType('PAYMENT.CAPTURE.COMPLETED'), 'payment_intent.succeeded');
      assert.strictEqual(mapPayPalEventType('PAYMENT.CAPTURE.DENIED'), 'payment_intent.payment_failed');
      assert.strictEqual(mapPayPalEventType('PAYMENT.CAPTURE.REFUNDED'), 'charge.refunded');
    });

    it('should map dispute events', () => {
      assert.strictEqual(mapPayPalEventType('CUSTOMER.DISPUTE.CREATED'), 'charge.dispute.created');
    });

    it('should return null for unmapped events', () => {
      assert.strictEqual(mapPayPalEventType('UNKNOWN.EVENT'), null);
      assert.strictEqual(mapPayPalEventType(''), null);
    });
  });
});

describe('Amount Conversions', () => {
  describe('dollarsToCents', () => {
    it('should convert dollar strings to cents', () => {
      assert.strictEqual(dollarsToCents('9.99'), 999);
      assert.strictEqual(dollarsToCents('100.00'), 10000);
      assert.strictEqual(dollarsToCents('0.01'), 1);
      assert.strictEqual(dollarsToCents('1234.56'), 123456);
    });

    it('should handle edge cases', () => {
      assert.strictEqual(dollarsToCents('0.00'), 0);
      assert.strictEqual(dollarsToCents('0.99'), 99);
    });
  });

  describe('centsToDollars', () => {
    it('should convert cents to dollar strings', () => {
      assert.strictEqual(centsToDollars(999), '9.99');
      assert.strictEqual(centsToDollars(10000), '100.00');
      assert.strictEqual(centsToDollars(1), '0.01');
      assert.strictEqual(centsToDollars(123456), '1234.56');
    });

    it('should handle edge cases', () => {
      assert.strictEqual(centsToDollars(0), '0.00');
      assert.strictEqual(centsToDollars(99), '0.99');
    });
  });
});

describe('Error Detection', () => {
  describe('PayPalApiError', () => {
    it('should create error with status code', () => {
      const error = new PayPalApiError(404, 'Not found');
      assert.strictEqual(error.statusCode, 404);
      assert.strictEqual(error.message, 'Not found');
      assert.strictEqual(error.name, 'PayPalApiError');
    });

    it('should detect not found errors', () => {
      const notFound = new PayPalApiError(404, 'Order not found');
      const serverError = new PayPalApiError(500, 'Internal error');

      assert.strictEqual(notFound.isNotFound(), true);
      assert.strictEqual(serverError.isNotFound(), false);
    });
  });

  describe('isPayPalNotFoundError', () => {
    it('should detect PayPalApiError 404', () => {
      const error = new PayPalApiError(404, 'Not found');
      assert.strictEqual(isPayPalNotFoundError(error), true);
    });

    it('should not match non-404 PayPalApiError', () => {
      const error = new PayPalApiError(500, 'Server error');
      assert.strictEqual(isPayPalNotFoundError(error), false);
    });

    it('should detect legacy string-based 404 errors', () => {
      const error = new Error('PayPal API error 404: Order not found');
      assert.strictEqual(isPayPalNotFoundError(error), true);
    });

    it('should detect RESOURCE_NOT_FOUND errors', () => {
      const error = new Error('RESOURCE_NOT_FOUND');
      assert.strictEqual(isPayPalNotFoundError(error), true);
    });

    it('should not match other errors', () => {
      const error = new Error('Network error');
      assert.strictEqual(isPayPalNotFoundError(error), false);
    });
  });

  describe('isStripeNotFoundError', () => {
    it('should detect resource_missing code', () => {
      const error = { code: 'resource_missing', message: 'Not found' };
      assert.strictEqual(isStripeNotFoundError(error), true);
    });

    it('should not match other codes', () => {
      const error = { code: 'card_declined', message: 'Card declined' };
      assert.strictEqual(isStripeNotFoundError(error), false);
    });

    it('should not match errors without code', () => {
      const error = new Error('Some error');
      assert.strictEqual(isStripeNotFoundError(error), false);
    });

    it('should handle null/undefined', () => {
      assert.strictEqual(isStripeNotFoundError(null), false);
      assert.strictEqual(isStripeNotFoundError(undefined), false);
    });
  });
});
