/**
 * Payment Provider Types
 * Core types and interfaces for payment processing
 */

/**
 * Supported payment providers
 */
export type PaymentProvider = 'stripe' | 'paypal';

/**
 * Payment intent status
 */
export type PaymentStatus =
  | 'pending'
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded';

/**
 * Payment method types
 */
export type PaymentMethodType = 'card' | 'paypal' | 'wallet';

/**
 * Currency codes (ISO 4217)
 */
export type CurrencyCode = 'USD' | 'EUR' | 'GBP' | 'CAD' | 'AUD' | 'JPY';

/**
 * Amount in smallest currency unit (e.g., cents for USD)
 */
export interface PaymentAmount {
  amount: number;
  currency: CurrencyCode;
}

/**
 * Customer information for payment
 */
export interface PaymentCustomer {
  id: string;
  email: string;
  name?: string;
}

/**
 * Line item for checkout
 */
export interface LineItem {
  id: string;
  name: string;
  description?: string;
  amount: number;
  currency: CurrencyCode;
  quantity: number;
  imageUrl?: string;
}

/**
 * Metadata attached to payment
 */
export interface PaymentMetadata {
  userId: string;
  gameId?: string;
  purchaseId?: string;
  [key: string]: string | undefined;
}

/**
 * Create checkout session request
 */
export interface CreateCheckoutRequest {
  customer: PaymentCustomer;
  lineItems: LineItem[];
  metadata: PaymentMetadata;
  successUrl: string;
  cancelUrl: string;
  mode?: 'payment' | 'subscription';
}

/**
 * Checkout session response
 */
export interface CheckoutSession {
  id: string;
  provider: PaymentProvider;
  url: string;
  status: PaymentStatus;
  expiresAt?: Date;
  metadata: PaymentMetadata;
}

/**
 * Create payment intent request
 */
export interface CreatePaymentIntentRequest {
  amount: PaymentAmount;
  customer: PaymentCustomer;
  metadata: PaymentMetadata;
  paymentMethodTypes?: PaymentMethodType[];
  description?: string;
}

/**
 * Payment intent response
 */
export interface PaymentIntent {
  id: string;
  provider: PaymentProvider;
  clientSecret?: string;
  status: PaymentStatus;
  amount: PaymentAmount;
  metadata: PaymentMetadata;
  createdAt: Date;
}

/**
 * Refund request
 */
export interface RefundRequest {
  paymentIntentId: string;
  amount?: number;
  reason?: string;
  metadata?: PaymentMetadata;
}

/**
 * Refund response
 */
export interface RefundResult {
  id: string;
  provider: PaymentProvider;
  paymentIntentId: string;
  amount: PaymentAmount;
  status: 'pending' | 'succeeded' | 'failed';
  reason?: string;
  createdAt: Date;
}

/**
 * Webhook event types
 */
export type WebhookEventType =
  | 'checkout.session.completed'
  | 'checkout.session.expired'
  | 'payment_intent.succeeded'
  | 'payment_intent.payment_failed'
  | 'payment_intent.cancelled'
  | 'charge.refunded'
  | 'charge.dispute.created';

/**
 * Webhook event payload
 */
export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  provider: PaymentProvider;
  data: {
    checkoutSessionId?: string;
    paymentIntentId?: string;
    amount?: PaymentAmount;
    status?: PaymentStatus;
    metadata?: PaymentMetadata;
    failureReason?: string;
  };
  createdAt: Date;
  rawPayload: unknown;
}

/**
 * Webhook verification result
 */
export interface WebhookVerification {
  isValid: boolean;
  event?: WebhookEvent;
  error?: string;
}

/**
 * Payment provider configuration
 */
export interface PaymentProviderConfig {
  provider: PaymentProvider;
  enabled: boolean;
  testMode: boolean;
  publicKey?: string;
  secretKey?: string;
  webhookSecret?: string;
  clientId?: string;
}

/**
 * Provider health status
 */
export interface ProviderHealthStatus {
  provider: PaymentProvider;
  healthy: boolean;
  latencyMs?: number;
  lastChecked: Date;
  error?: string;
}
