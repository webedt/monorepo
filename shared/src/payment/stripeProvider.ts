/**
 * Stripe Payment Provider
 * Implements payment processing using Stripe API
 */

import Stripe from 'stripe';
import { APaymentProvider } from './APaymentProvider.js';
import { logger } from '../utils/logging/logger.js';

import type { CheckoutSession } from './types.js';
import type { CreateCheckoutRequest } from './types.js';
import type { CreatePaymentIntentRequest } from './types.js';
import type { PaymentIntent } from './types.js';
import type { PaymentMetadata } from './types.js';
import type { PaymentProvider } from './types.js';
import type { PaymentStatus } from './types.js';
import type { ProviderHealthStatus } from './types.js';
import type { RefundRequest } from './types.js';
import type { RefundResult } from './types.js';
import type { WebhookEvent } from './types.js';
import type { WebhookEventType } from './types.js';
import type { WebhookVerification } from './types.js';

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  apiVersion?: string;
}

/**
 * Maps Stripe payment intent status to our PaymentStatus
 */
function mapStripeStatus(status: Stripe.PaymentIntent.Status): PaymentStatus {
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
 * Maps Stripe checkout session status to our PaymentStatus
 */
function mapStripeCheckoutStatus(
  status: Stripe.Checkout.Session.Status | null,
  paymentStatus: Stripe.Checkout.Session.PaymentStatus | null
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
 * Maps Stripe event type to our WebhookEventType
 */
function mapStripeEventType(type: string): WebhookEventType | null {
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

export class StripeProvider extends APaymentProvider {
  readonly provider: PaymentProvider = 'stripe';
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(config: StripeConfig) {
    super();
    this.stripe = new Stripe(config.secretKey, {
      apiVersion: '2025-04-30.basil' as Stripe.LatestApiVersion,
      typescript: true,
    });
    this.webhookSecret = config.webhookSecret;
  }

  async createCheckoutSession(
    request: CreateCheckoutRequest
  ): Promise<CheckoutSession> {
    try {
      logger.info('Creating Stripe checkout session', {
        component: 'StripeProvider',
        customerId: request.customer.id,
        itemCount: request.lineItems.length,
      });

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
        metadata: this.sanitizeMetadata(request.metadata),
        success_url: request.successUrl,
        cancel_url: request.cancelUrl,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
      });

      logger.info('Stripe checkout session created', {
        component: 'StripeProvider',
        sessionId: session.id,
      });

      return {
        id: session.id,
        provider: 'stripe',
        url: session.url!,
        status: mapStripeCheckoutStatus(session.status, session.payment_status),
        expiresAt: session.expires_at
          ? new Date(session.expires_at * 1000)
          : undefined,
        metadata: request.metadata,
      };
    } catch (error) {
      logger.error('Failed to create Stripe checkout session', error as Error, {
        component: 'StripeProvider',
      });
      throw error;
    }
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSession | null> {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId);

      return {
        id: session.id,
        provider: 'stripe',
        url: session.url || '',
        status: mapStripeCheckoutStatus(session.status, session.payment_status),
        expiresAt: session.expires_at
          ? new Date(session.expires_at * 1000)
          : undefined,
        metadata: (session.metadata as PaymentMetadata) || {},
      };
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async createPaymentIntent(
    request: CreatePaymentIntentRequest
  ): Promise<PaymentIntent> {
    try {
      logger.info('Creating Stripe payment intent', {
        component: 'StripeProvider',
        amount: request.amount.amount,
        currency: request.amount.currency,
      });

      const intent = await this.stripe.paymentIntents.create({
        amount: request.amount.amount,
        currency: request.amount.currency.toLowerCase(),
        metadata: this.sanitizeMetadata(request.metadata),
        description: request.description,
        automatic_payment_methods: { enabled: true },
      });

      logger.info('Stripe payment intent created', {
        component: 'StripeProvider',
        intentId: intent.id,
      });

      return {
        id: intent.id,
        provider: 'stripe',
        clientSecret: intent.client_secret || undefined,
        status: mapStripeStatus(intent.status),
        amount: {
          amount: intent.amount,
          currency: intent.currency.toUpperCase() as 'USD',
        },
        metadata: request.metadata,
        createdAt: new Date(intent.created * 1000),
      };
    } catch (error) {
      logger.error('Failed to create Stripe payment intent', error as Error, {
        component: 'StripeProvider',
      });
      throw error;
    }
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
          currency: intent.currency.toUpperCase() as 'USD',
        },
        metadata: (intent.metadata as PaymentMetadata) || {},
        createdAt: new Date(intent.created * 1000),
      };
    } catch (error) {
      if ((error as Stripe.errors.StripeError).code === 'resource_missing') {
        return null;
      }
      throw error;
    }
  }

  async cancelPaymentIntent(intentId: string): Promise<PaymentIntent> {
    try {
      logger.info('Cancelling Stripe payment intent', {
        component: 'StripeProvider',
        intentId,
      });

      const intent = await this.stripe.paymentIntents.cancel(intentId);

      return {
        id: intent.id,
        provider: 'stripe',
        clientSecret: intent.client_secret || undefined,
        status: mapStripeStatus(intent.status),
        amount: {
          amount: intent.amount,
          currency: intent.currency.toUpperCase() as 'USD',
        },
        metadata: (intent.metadata as PaymentMetadata) || {},
        createdAt: new Date(intent.created * 1000),
      };
    } catch (error) {
      logger.error('Failed to cancel Stripe payment intent', error as Error, {
        component: 'StripeProvider',
        intentId,
      });
      throw error;
    }
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    try {
      logger.info('Creating Stripe refund', {
        component: 'StripeProvider',
        paymentIntentId: request.paymentIntentId,
        amount: request.amount,
      });

      const refund = await this.stripe.refunds.create({
        payment_intent: request.paymentIntentId,
        amount: request.amount,
        reason: this.mapRefundReason(request.reason),
        metadata: request.metadata
          ? this.sanitizeMetadata(request.metadata)
          : undefined,
      });

      logger.info('Stripe refund created', {
        component: 'StripeProvider',
        refundId: refund.id,
        status: refund.status,
      });

      return {
        id: refund.id,
        provider: 'stripe',
        paymentIntentId: request.paymentIntentId,
        amount: {
          amount: refund.amount || 0,
          currency: (refund.currency?.toUpperCase() || 'USD') as 'USD',
        },
        status: refund.status === 'succeeded' ? 'succeeded' : 'pending',
        reason: request.reason,
        createdAt: new Date(refund.created * 1000),
      };
    } catch (error) {
      logger.error('Failed to create Stripe refund', error as Error, {
        component: 'StripeProvider',
        paymentIntentId: request.paymentIntentId,
      });
      throw error;
    }
  }

  async verifyWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<WebhookVerification> {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.webhookSecret
      );

      const eventType = mapStripeEventType(event.type);
      if (!eventType) {
        return {
          isValid: true,
          event: undefined,
        };
      }

      const webhookEvent = this.parseStripeEvent(event, eventType);

      return {
        isValid: true,
        event: webhookEvent,
      };
    } catch (error) {
      logger.error('Stripe webhook verification failed', error as Error, {
        component: 'StripeProvider',
      });
      return {
        isValid: false,
        error: (error as Error).message,
      };
    }
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

  private sanitizeMetadata(
    metadata: PaymentMetadata
  ): Record<string, string> {
    const sanitized: Record<string, string> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (value !== undefined) {
        sanitized[key] = String(value);
      }
    }
    return sanitized;
  }

  private mapRefundReason(
    reason?: string
  ): 'duplicate' | 'fraudulent' | 'requested_by_customer' | undefined {
    if (!reason) return 'requested_by_customer';
    const lowerReason = reason.toLowerCase();
    if (lowerReason.includes('duplicate')) return 'duplicate';
    if (lowerReason.includes('fraud')) return 'fraudulent';
    return 'requested_by_customer';
  }

  private parseStripeEvent(
    event: Stripe.Event,
    eventType: WebhookEventType
  ): WebhookEvent {
    const baseEvent: WebhookEvent = {
      id: event.id,
      type: eventType,
      provider: 'stripe',
      data: {},
      createdAt: new Date(event.created * 1000),
      rawPayload: event,
    };

    // Parse based on event type
    if (event.type.startsWith('checkout.session')) {
      const session = event.data.object as Stripe.Checkout.Session;
      baseEvent.data = {
        checkoutSessionId: session.id,
        paymentIntentId: session.payment_intent as string | undefined,
        status: mapStripeCheckoutStatus(session.status, session.payment_status),
        metadata: (session.metadata as PaymentMetadata) || {},
        amount: session.amount_total
          ? {
              amount: session.amount_total,
              currency: (session.currency?.toUpperCase() || 'USD') as 'USD',
            }
          : undefined,
      };
    } else if (event.type.startsWith('payment_intent')) {
      const intent = event.data.object as Stripe.PaymentIntent;
      baseEvent.data = {
        paymentIntentId: intent.id,
        status: mapStripeStatus(intent.status),
        metadata: (intent.metadata as PaymentMetadata) || {},
        amount: {
          amount: intent.amount,
          currency: intent.currency.toUpperCase() as 'USD',
        },
        failureReason: intent.last_payment_error?.message,
      };
    } else if (event.type.startsWith('charge')) {
      const charge = event.data.object as Stripe.Charge;
      baseEvent.data = {
        paymentIntentId: charge.payment_intent as string | undefined,
        status: charge.refunded ? 'refunded' : 'succeeded',
        metadata: (charge.metadata as PaymentMetadata) || {},
        amount: {
          amount: charge.amount,
          currency: charge.currency.toUpperCase() as 'USD',
        },
      };
    }

    return baseEvent;
  }
}

/**
 * Create Stripe provider from environment variables
 */
export function createStripeProvider(): StripeProvider | null {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secretKey || !webhookSecret) {
    logger.warn('Stripe provider not configured: missing environment variables', {
      component: 'StripeProvider',
      hasSecretKey: !!secretKey,
      hasWebhookSecret: !!webhookSecret,
    });
    return null;
  }

  return new StripeProvider({ secretKey, webhookSecret });
}
