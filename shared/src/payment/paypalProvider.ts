/**
 * PayPal Payment Provider
 * Implements payment processing using PayPal REST API
 */

import { APaymentProvider } from './APaymentProvider.js';
import { logger } from '../utils/logging/logger.js';

import type { CheckoutSession } from './types.js';
import type { CreateCheckoutRequest } from './types.js';
import type { CreatePaymentIntentRequest } from './types.js';
import type { CurrencyCode } from './types.js';
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

const VALID_CURRENCY_CODES: CurrencyCode[] = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

/**
 * Validates and returns a currency code, defaulting to USD if invalid
 */
function toCurrencyCode(currency: string): CurrencyCode {
  const upper = currency.toUpperCase() as CurrencyCode;
  return VALID_CURRENCY_CODES.includes(upper) ? upper : 'USD';
}

export interface PayPalConfig {
  clientId: string;
  clientSecret: string;
  webhookId: string;
  sandbox?: boolean;
}

interface PayPalAccessToken {
  token: string;
  expiresAt: number;
}

interface PayPalOrderResponse {
  id: string;
  status: string;
  links: Array<{ rel: string; href: string }>;
  purchase_units?: Array<{
    amount: { value: string; currency_code: string };
  }>;
}

interface PayPalCaptureResponse {
  id: string;
  status: string;
  purchase_units: Array<{
    payments: {
      captures: Array<{
        id: string;
        status: string;
        amount: { value: string; currency_code: string };
      }>;
    };
  }>;
}

interface PayPalRefundResponse {
  id: string;
  status: string;
  amount: { value: string; currency_code: string };
  create_time: string;
}

/**
 * Maps PayPal order status to our PaymentStatus
 */
function mapPayPalStatus(status: string): PaymentStatus {
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
 * Maps PayPal webhook event type to our WebhookEventType
 */
function mapPayPalEventType(type: string): WebhookEventType | null {
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

export class PayPalProvider extends APaymentProvider {
  readonly provider: PaymentProvider = 'paypal';
  private clientId: string;
  private clientSecret: string;
  private webhookId: string;
  private baseUrl: string;
  private accessToken: PayPalAccessToken | null = null;

  constructor(config: PayPalConfig) {
    super();
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.webhookId = config.webhookId;
    this.baseUrl = config.sandbox
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';
  }

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60000) {
      return this.accessToken.token;
    }

    try {
      const auth = Buffer.from(
        `${this.clientId}:${this.clientSecret}`
      ).toString('base64');

      const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'grant_type=client_credentials',
      });

      if (!response.ok) {
        throw new Error(`PayPal auth failed: ${response.status}`);
      }

      const data = (await response.json()) as {
        access_token: string;
        expires_in: number;
      };

      this.accessToken = {
        token: data.access_token,
        expiresAt: Date.now() + data.expires_in * 1000,
      };

      return this.accessToken.token;
    } catch (error) {
      logger.error('Failed to get PayPal access token', error as Error, {
        component: 'PayPalProvider',
      });
      throw error;
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PayPal API error ${response.status}: ${errorText}`);
    }

    return response.json() as T;
  }

  async createCheckoutSession(
    request: CreateCheckoutRequest
  ): Promise<CheckoutSession> {
    try {
      logger.info('Creating PayPal order', {
        component: 'PayPalProvider',
        customerId: request.customer.id,
        itemCount: request.lineItems.length,
      });

      const totalAmount = request.lineItems.reduce(
        (sum, item) => sum + item.amount * item.quantity,
        0
      );
      const currency = request.lineItems[0]?.currency || 'USD';

      const order = await this.request<PayPalOrderResponse>(
        'POST',
        '/v2/checkout/orders',
        {
          intent: 'CAPTURE',
          purchase_units: [
            {
              reference_id: request.metadata.purchaseId || request.metadata.userId,
              description: request.lineItems.map((i) => i.name).join(', '),
              custom_id: JSON.stringify(request.metadata),
              amount: {
                currency_code: currency,
                value: (totalAmount / 100).toFixed(2),
                breakdown: {
                  item_total: {
                    currency_code: currency,
                    value: (totalAmount / 100).toFixed(2),
                  },
                },
              },
              items: request.lineItems.map((item) => ({
                name: item.name.slice(0, 127),
                description: item.description?.slice(0, 127),
                unit_amount: {
                  currency_code: item.currency,
                  value: (item.amount / 100).toFixed(2),
                },
                quantity: String(item.quantity),
                category: 'DIGITAL_GOODS',
              })),
            },
          ],
          payment_source: {
            paypal: {
              experience_context: {
                brand_name: 'WebEDT',
                return_url: request.successUrl,
                cancel_url: request.cancelUrl,
                user_action: 'PAY_NOW',
                shipping_preference: 'NO_SHIPPING',
              },
            },
          },
        }
      );

      const approveLink = order.links.find((l) => l.rel === 'payer-action');

      logger.info('PayPal order created', {
        component: 'PayPalProvider',
        orderId: order.id,
      });

      return {
        id: order.id,
        provider: 'paypal',
        url: approveLink?.href || '',
        status: mapPayPalStatus(order.status),
        metadata: request.metadata,
      };
    } catch (error) {
      logger.error('Failed to create PayPal order', error as Error, {
        component: 'PayPalProvider',
      });
      throw error;
    }
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSession | null> {
    try {
      const order = await this.request<PayPalOrderResponse>(
        'GET',
        `/v2/checkout/orders/${sessionId}`
      );

      const purchaseUnit = order.purchase_units?.[0];
      let metadata: PaymentMetadata = { userId: '' };
      try {
        if (purchaseUnit && 'custom_id' in purchaseUnit) {
          metadata = JSON.parse((purchaseUnit as { custom_id?: string }).custom_id || '{}');
        }
      } catch {
        // Ignore parse errors
      }

      return {
        id: order.id,
        provider: 'paypal',
        url: '',
        status: mapPayPalStatus(order.status),
        metadata,
      };
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async createPaymentIntent(
    request: CreatePaymentIntentRequest
  ): Promise<PaymentIntent> {
    // PayPal uses orders instead of payment intents
    // Create an order that will be captured later
    const order = await this.request<PayPalOrderResponse>(
      'POST',
      '/v2/checkout/orders',
      {
        intent: 'CAPTURE',
        purchase_units: [
          {
            reference_id: request.metadata.purchaseId || request.metadata.userId,
            description: request.description || 'Payment',
            custom_id: JSON.stringify(request.metadata),
            amount: {
              currency_code: request.amount.currency,
              value: (request.amount.amount / 100).toFixed(2),
            },
          },
        ],
      }
    );

    return {
      id: order.id,
      provider: 'paypal',
      status: mapPayPalStatus(order.status),
      amount: request.amount,
      metadata: request.metadata,
      createdAt: new Date(),
    };
  }

  async getPaymentIntent(intentId: string): Promise<PaymentIntent | null> {
    try {
      const order = await this.request<PayPalOrderResponse>(
        'GET',
        `/v2/checkout/orders/${intentId}`
      );

      const purchaseUnit = order.purchase_units?.[0];
      let metadata: PaymentMetadata = { userId: '' };
      try {
        if (purchaseUnit && 'custom_id' in purchaseUnit) {
          metadata = JSON.parse((purchaseUnit as { custom_id?: string }).custom_id || '{}');
        }
      } catch {
        // Ignore parse errors
      }

      return {
        id: order.id,
        provider: 'paypal',
        status: mapPayPalStatus(order.status),
        amount: {
          amount: purchaseUnit
            ? Math.round(parseFloat(purchaseUnit.amount.value) * 100)
            : 0,
          currency: toCurrencyCode(purchaseUnit?.amount.currency_code || 'USD'),
        },
        metadata,
        createdAt: new Date(),
      };
    } catch (error) {
      if ((error as Error).message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  async cancelPaymentIntent(intentId: string): Promise<PaymentIntent> {
    logger.info('Voiding PayPal order', {
      component: 'PayPalProvider',
      orderId: intentId,
    });

    // PayPal orders can only be voided if they're authorized but not captured
    // For created/approved orders, we just return the current state
    const order = await this.getPaymentIntent(intentId);

    if (!order) {
      throw new Error('Order not found');
    }

    return {
      ...order,
      status: 'cancelled',
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    try {
      logger.info('Creating PayPal refund', {
        component: 'PayPalProvider',
        orderId: request.paymentIntentId,
        amount: request.amount,
      });

      // First, get the capture ID from the order
      const order = await this.request<PayPalCaptureResponse>(
        'GET',
        `/v2/checkout/orders/${request.paymentIntentId}`
      );

      const captureId = order.purchase_units?.[0]?.payments?.captures?.[0]?.id;
      if (!captureId) {
        throw new Error('No capture found for this order');
      }

      const refundBody: { note_to_payer?: string; amount?: { value: string; currency_code: string } } = {};
      if (request.reason) {
        refundBody.note_to_payer = request.reason.slice(0, 255);
      }
      if (request.amount) {
        const capture = order.purchase_units[0].payments.captures[0];
        refundBody.amount = {
          value: (request.amount / 100).toFixed(2),
          currency_code: capture.amount.currency_code,
        };
      }

      const refund = await this.request<PayPalRefundResponse>(
        'POST',
        `/v2/payments/captures/${captureId}/refund`,
        Object.keys(refundBody).length > 0 ? refundBody : undefined
      );

      logger.info('PayPal refund created', {
        component: 'PayPalProvider',
        refundId: refund.id,
        status: refund.status,
      });

      return {
        id: refund.id,
        provider: 'paypal',
        paymentIntentId: request.paymentIntentId,
        amount: {
          amount: Math.round(parseFloat(refund.amount.value) * 100),
          currency: toCurrencyCode(refund.amount.currency_code),
        },
        status: refund.status === 'COMPLETED' ? 'succeeded' : 'pending',
        reason: request.reason,
        createdAt: new Date(refund.create_time),
      };
    } catch (error) {
      logger.error('Failed to create PayPal refund', error as Error, {
        component: 'PayPalProvider',
        orderId: request.paymentIntentId,
      });
      throw error;
    }
  }

  async verifyWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<WebhookVerification> {
    try {
      // Parse webhook headers from signature parameter
      // Expected format: "transmission-id|timestamp|transmission-sig|algo|cert-url"
      const headerParts = signature.split('|');
      if (headerParts.length < 5) {
        return { isValid: false, error: 'Invalid signature format - expected 5 parts' };
      }

      const [transmissionId, timestamp, transmissionSig, authAlgo, certUrl] = headerParts;
      const payloadString =
        typeof payload === 'string' ? payload : payload.toString('utf8');
      const webhookEvent = JSON.parse(payloadString);

      // Verify with PayPal
      const verifyResponse = await this.request<{ verification_status: string }>(
        'POST',
        '/v1/notifications/verify-webhook-signature',
        {
          auth_algo: authAlgo || 'SHA256withRSA',
          cert_url: certUrl,
          transmission_id: transmissionId,
          transmission_sig: transmissionSig,
          transmission_time: timestamp,
          webhook_id: this.webhookId,
          webhook_event: webhookEvent,
        }
      );

      if (verifyResponse.verification_status !== 'SUCCESS') {
        return { isValid: false, error: 'Webhook verification failed' };
      }

      const eventType = mapPayPalEventType(webhookEvent.event_type);
      if (!eventType) {
        return { isValid: true, event: undefined };
      }

      const event = this.parsePayPalEvent(webhookEvent, eventType);
      return { isValid: true, event };
    } catch (error) {
      logger.error('PayPal webhook verification failed', error as Error, {
        component: 'PayPalProvider',
      });
      return { isValid: false, error: (error as Error).message };
    }
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    const startTime = Date.now();
    try {
      await this.getAccessToken();
      return {
        provider: 'paypal',
        healthy: true,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
      };
    } catch (error) {
      return {
        provider: 'paypal',
        healthy: false,
        latencyMs: Date.now() - startTime,
        lastChecked: new Date(),
        error: (error as Error).message,
      };
    }
  }

  /**
   * Capture an approved PayPal order
   */
  async captureOrder(orderId: string): Promise<PaymentIntent> {
    try {
      logger.info('Capturing PayPal order', {
        component: 'PayPalProvider',
        orderId,
      });

      const capture = await this.request<PayPalCaptureResponse>(
        'POST',
        `/v2/checkout/orders/${orderId}/capture`
      );

      const purchaseUnit = capture.purchase_units?.[0];
      const captureDetails = purchaseUnit?.payments?.captures?.[0];
      let metadata: PaymentMetadata = { userId: '' };
      try {
        if (purchaseUnit && 'custom_id' in purchaseUnit) {
          metadata = JSON.parse((purchaseUnit as { custom_id?: string }).custom_id || '{}');
        }
      } catch {
        // Ignore parse errors
      }

      logger.info('PayPal order captured', {
        component: 'PayPalProvider',
        orderId,
        captureId: captureDetails?.id,
        status: capture.status,
      });

      return {
        id: orderId,
        provider: 'paypal',
        status: mapPayPalStatus(capture.status),
        amount: {
          amount: captureDetails
            ? Math.round(parseFloat(captureDetails.amount.value) * 100)
            : 0,
          currency: toCurrencyCode(captureDetails?.amount.currency_code || 'USD'),
        },
        metadata,
        createdAt: new Date(),
      };
    } catch (error) {
      logger.error('Failed to capture PayPal order', error as Error, {
        component: 'PayPalProvider',
        orderId,
      });
      throw error;
    }
  }

  private parsePayPalEvent(
    event: {
      id: string;
      event_type: string;
      resource: {
        id?: string;
        custom_id?: string;
        status?: string;
        amount?: { value: string; currency_code: string };
        supplementary_data?: { related_ids?: { order_id?: string } };
      };
      create_time: string;
    },
    eventType: WebhookEventType
  ): WebhookEvent {
    const resource = event.resource;
    let metadata: PaymentMetadata = { userId: '' };

    try {
      if (resource.custom_id) {
        metadata = JSON.parse(resource.custom_id);
      }
    } catch {
      // Ignore parse errors
    }

    return {
      id: event.id,
      type: eventType,
      provider: 'paypal',
      data: {
        paymentIntentId:
          resource.supplementary_data?.related_ids?.order_id || resource.id,
        status: resource.status ? mapPayPalStatus(resource.status) : undefined,
        metadata,
        amount: resource.amount
          ? {
              amount: Math.round(parseFloat(resource.amount.value) * 100),
              currency: toCurrencyCode(resource.amount.currency_code),
            }
          : undefined,
      },
      createdAt: new Date(event.create_time),
      rawPayload: event,
    };
  }
}

/**
 * Create PayPal provider from environment variables
 */
export function createPayPalProvider(): PayPalProvider | null {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const sandbox = process.env.PAYPAL_SANDBOX === 'true';

  if (!clientId || !clientSecret || !webhookId) {
    logger.warn('PayPal provider not configured: missing environment variables', {
      component: 'PayPalProvider',
      hasClientId: !!clientId,
      hasClientSecret: !!clientSecret,
      hasWebhookId: !!webhookId,
    });
    return null;
  }

  return new PayPalProvider({ clientId, clientSecret, webhookId, sandbox });
}
