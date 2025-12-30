/**
 * Payment Provider Utility Functions
 *
 * These pure utility functions are extracted from the payment providers
 * to enable direct unit testing without mocking external APIs.
 *
 * @module payment/utils
 */

import type { CurrencyCode } from './types.js';
import type { PaymentMetadata } from './types.js';
import type { PaymentStatus } from './types.js';
import type { WebhookEventType } from './types.js';

/**
 * Valid currency codes supported by the payment providers
 */
export const VALID_CURRENCY_CODES: readonly CurrencyCode[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

/**
 * Validates and returns a currency code, defaulting to USD if invalid.
 * Case-insensitive input is normalized to uppercase.
 *
 * @param currency - The currency code string to validate
 * @returns A valid CurrencyCode, defaulting to 'USD' if invalid
 */
export function toCurrencyCode(currency: string): CurrencyCode {
  const upper = currency.toUpperCase() as CurrencyCode;
  return VALID_CURRENCY_CODES.includes(upper) ? upper : 'USD';
}

/**
 * Sanitizes payment metadata by converting all values to strings
 * and removing undefined values. Required for Stripe metadata.
 *
 * @param metadata - The metadata object to sanitize
 * @returns A record with all values as strings
 */
export function sanitizeMetadata(metadata: PaymentMetadata): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      sanitized[key] = String(value);
    }
  }
  return sanitized;
}

/**
 * Maps a refund reason string to Stripe's allowed refund reason values.
 *
 * @param reason - The reason string (optional)
 * @returns One of 'duplicate', 'fraudulent', or 'requested_by_customer'
 */
export function mapRefundReason(
  reason?: string
): 'duplicate' | 'fraudulent' | 'requested_by_customer' {
  if (!reason) return 'requested_by_customer';
  const lowerReason = reason.toLowerCase();
  if (lowerReason.includes('duplicate')) return 'duplicate';
  if (lowerReason.includes('fraud')) return 'fraudulent';
  return 'requested_by_customer';
}

// ============================================================================
// Stripe-specific Utilities
// ============================================================================

/**
 * Maps Stripe payment intent status to internal PaymentStatus.
 *
 * @param status - The Stripe payment intent status
 * @returns The corresponding internal PaymentStatus
 */
export function mapStripeStatus(status: string): PaymentStatus {
  switch (status) {
    case 'succeeded':
      return 'succeeded';
    case 'processing':
      return 'processing';
    case 'requires_payment_method':
    case 'requires_confirmation':
    case 'requires_action':
      return 'requires_action';
    case 'canceled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Maps Stripe checkout session status to internal PaymentStatus.
 *
 * @param status - The checkout session status
 * @param paymentStatus - The payment status within the session
 * @returns The corresponding internal PaymentStatus
 */
export function mapStripeCheckoutStatus(
  status: string | null,
  paymentStatus: string | null
): PaymentStatus {
  if (status === 'complete' && paymentStatus === 'paid') {
    return 'succeeded';
  }
  if (status === 'expired') {
    return 'cancelled';
  }
  if (paymentStatus === 'unpaid') {
    return 'pending';
  }
  return 'pending';
}

/**
 * Maps Stripe webhook event type to internal WebhookEventType.
 *
 * @param type - The Stripe event type string
 * @returns The corresponding internal event type, or null if not mapped
 */
export function mapStripeEventType(type: string): WebhookEventType | null {
  const mapping: Record<string, WebhookEventType> = {
    'checkout.session.completed': 'checkout.session.completed',
    'checkout.session.expired': 'checkout.session.expired',
    'payment_intent.succeeded': 'payment_intent.succeeded',
    'payment_intent.payment_failed': 'payment_intent.payment_failed',
    'payment_intent.canceled': 'payment_intent.cancelled',
    'charge.refunded': 'charge.refunded',
    'charge.dispute.created': 'charge.dispute.created',
  };
  return mapping[type] || null;
}

// ============================================================================
// PayPal-specific Utilities
// ============================================================================

/**
 * Maps PayPal order status to internal PaymentStatus.
 *
 * @param status - The PayPal order status (case-insensitive)
 * @returns The corresponding internal PaymentStatus
 */
export function mapPayPalStatus(status: string): PaymentStatus {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
    case 'APPROVED':
      return 'succeeded';
    case 'CREATED':
    case 'SAVED':
    case 'PAYER_ACTION_REQUIRED':
      return 'requires_action';
    case 'VOIDED':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * Maps PayPal webhook event type to internal WebhookEventType.
 *
 * @param type - The PayPal event type string
 * @returns The corresponding internal event type, or null if not mapped
 */
export function mapPayPalEventType(type: string): WebhookEventType | null {
  const mapping: Record<string, WebhookEventType> = {
    'CHECKOUT.ORDER.APPROVED': 'checkout.session.completed',
    'CHECKOUT.ORDER.COMPLETED': 'checkout.session.completed',
    'PAYMENT.CAPTURE.COMPLETED': 'payment_intent.succeeded',
    'PAYMENT.CAPTURE.DENIED': 'payment_intent.payment_failed',
    'PAYMENT.CAPTURE.REFUNDED': 'charge.refunded',
    'CUSTOMER.DISPUTE.CREATED': 'charge.dispute.created',
  };
  return mapping[type] || null;
}

/**
 * Converts a dollar amount string to cents (integer).
 * Handles floating point precision issues with Math.round.
 *
 * @param dollars - The dollar amount as a string (e.g., "9.99")
 * @returns The amount in cents as an integer
 */
export function dollarsToCents(dollars: string): number {
  return Math.round(parseFloat(dollars) * 100);
}

/**
 * Converts cents (integer) to a dollar amount string.
 *
 * @param cents - The amount in cents
 * @returns The dollar amount formatted with 2 decimal places
 */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

// ============================================================================
// Error Handling Utilities
// ============================================================================

/**
 * Error class for PayPal API errors with status code.
 */
export class PayPalApiError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'PayPalApiError';
    this.statusCode = statusCode;
  }

  /**
   * Check if this is a "not found" error (404).
   */
  isNotFound(): boolean {
    return this.statusCode === 404;
  }
}

/**
 * Checks if an error is a PayPal "not found" (404) error.
 * Handles both PayPalApiError instances and legacy string-based error messages.
 *
 * @param error - The error to check
 * @returns True if the error indicates a resource was not found
 */
export function isPayPalNotFoundError(error: unknown): boolean {
  if (error instanceof PayPalApiError) {
    return error.isNotFound();
  }
  // Legacy fallback for string-based error messages
  if (error instanceof Error) {
    return error.message.includes('404') || error.message.includes('RESOURCE_NOT_FOUND');
  }
  return false;
}

/**
 * Checks if a Stripe error indicates a resource was not found.
 *
 * @param error - The error to check (should have a 'code' property for Stripe errors)
 * @returns True if the error indicates a resource was not found
 */
export function isStripeNotFoundError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code: string }).code === 'resource_missing';
  }
  return false;
}
