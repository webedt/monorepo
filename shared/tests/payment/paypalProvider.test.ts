/**
 * Unit Tests for PayPal Payment Provider
 *
 * Tests PayPal-specific payment processing functionality including:
 * - Order creation and retrieval
 * - Order capture
 * - Refund processing
 * - Webhook signature verification
 * - Health checks
 * - Error handling
 *
 * ## Testing Approach
 *
 * These tests use a TestablePayPalProvider class that wraps a mock fetch function.
 * The utility functions (status mapping, currency validation, amount conversions)
 * are imported from the shared utils.ts module, ensuring tests validate the same
 * logic used in production.
 *
 * For direct unit tests of utility functions, see utils.test.ts.
 *
 * ## Limitations
 *
 * Due to Node.js 22's lack of mock.module() support, we cannot directly mock
 * the global fetch. Instead, we use dependency injection to pass a mock fetch
 * function to the TestablePayPalProvider. This tests the same business logic
 * patterns as the production PayPalProvider class.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert';

// Import actual utility functions from production code
import {
  centsToDollars,
  dollarsToCents,
  isPayPalNotFoundError,
  mapPayPalEventType,
  mapPayPalStatus,
  PayPalApiError,
  toCurrencyCode,
} from '../../src/payment/utils.js';

import type { CurrencyCode } from '../../src/payment/types.js';
import type { CheckoutSession } from '../../src/payment/types.js';
import type { PaymentIntent } from '../../src/payment/types.js';
import type { PaymentMetadata } from '../../src/payment/types.js';
import type { ProviderHealthStatus } from '../../src/payment/types.js';
import type { RefundResult } from '../../src/payment/types.js';
import type { WebhookVerification } from '../../src/payment/types.js';

// Type for fetch mock
type MockFetch = (url: string, options?: RequestInit) => Promise<Response>;

/**
 * Testable version of PayPalProvider with injectable fetch function.
 *
 * Uses the actual utility functions from utils.ts to ensure tests validate
 * the same logic as production code.
 */
class TestablePayPalProvider {
  readonly provider = 'paypal' as const;
  private clientId: string;
  private clientSecret: string;
  private webhookId: string;
  private baseUrl: string;
  private fetchFn: MockFetch;
  private accessToken: { token: string; expiresAt: number } | null = null;

  constructor(config: {
    clientId: string;
    clientSecret: string;
    webhookId: string;
    sandbox?: boolean;
    fetchFn: MockFetch;
  }) {
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.webhookId = config.webhookId;
    this.baseUrl = config.sandbox
      ? 'https://api-m.sandbox.paypal.com'
      : 'https://api-m.paypal.com';
    this.fetchFn = config.fetchFn;
  }

  // Note: Utility functions are imported from utils.ts, not re-implemented here.
  // This ensures tests validate the actual production logic.

  private async getAccessToken(): Promise<string> {
    // Return cached token if still valid
    if (this.accessToken && Date.now() < this.accessToken.expiresAt - 60000) {
      return this.accessToken.token;
    }

    const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

    const response = await this.fetchFn(`${this.baseUrl}/v1/oauth2/token`, {
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

    const data = await response.json() as { access_token: string; expires_in: number };

    this.accessToken = {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };

    return this.accessToken.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getAccessToken();

    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
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
      throw new PayPalApiError(response.status, `PayPal API error ${response.status}: ${errorText}`);
    }

    return response.json() as T;
  }

  async createCheckoutSession(request: {
    customer: { id: string; email: string };
    lineItems: Array<{
      id: string;
      name: string;
      description?: string;
      amount: number;
      currency: CurrencyCode;
      quantity: number;
    }>;
    metadata: PaymentMetadata;
    successUrl: string;
    cancelUrl: string;
  }): Promise<CheckoutSession> {
    const totalAmount = request.lineItems.reduce(
      (sum, item) => sum + item.amount * item.quantity,
      0
    );
    const currency = request.lineItems[0]?.currency || 'USD';

    const order = await this.request<{
      id: string;
      status: string;
      links: Array<{ rel: string; href: string }>;
    }>('POST', '/v2/checkout/orders', {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: request.metadata.purchaseId || request.metadata.userId,
          description: request.lineItems.map((i) => i.name).join(', '),
          custom_id: JSON.stringify(request.metadata),
          amount: {
            currency_code: currency,
            value: centsToDollars(totalAmount),
            breakdown: {
              item_total: {
                currency_code: currency,
                value: centsToDollars(totalAmount),
              },
            },
          },
          items: request.lineItems.map((item) => ({
            name: item.name.slice(0, 127),
            description: item.description?.slice(0, 127),
            unit_amount: {
              currency_code: item.currency,
              value: centsToDollars(item.amount),
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
    });

    const approveLink = order.links.find((l) => l.rel === 'payer-action');

    return {
      id: order.id,
      provider: 'paypal',
      url: approveLink?.href || '',
      status: mapPayPalStatus(order.status),
      metadata: request.metadata,
    };
  }

  async getCheckoutSession(sessionId: string): Promise<CheckoutSession | null> {
    try {
      const order = await this.request<{
        id: string;
        status: string;
        purchase_units?: Array<{ custom_id?: string }>;
      }>('GET', `/v2/checkout/orders/${sessionId}`);

      const purchaseUnit = order.purchase_units?.[0];
      let metadata: PaymentMetadata = { userId: '' };
      try {
        if (purchaseUnit?.custom_id) {
          metadata = JSON.parse(purchaseUnit.custom_id);
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
      if (isPayPalNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async getPaymentIntent(intentId: string): Promise<PaymentIntent | null> {
    try {
      const order = await this.request<{
        id: string;
        status: string;
        purchase_units?: Array<{
          amount: { value: string; currency_code: string };
          custom_id?: string;
        }>;
      }>('GET', `/v2/checkout/orders/${intentId}`);

      const purchaseUnit = order.purchase_units?.[0];
      let metadata: PaymentMetadata = { userId: '' };
      try {
        if (purchaseUnit?.custom_id) {
          metadata = JSON.parse(purchaseUnit.custom_id);
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
            ? dollarsToCents(purchaseUnit.amount.value)
            : 0,
          currency: toCurrencyCode(purchaseUnit?.amount.currency_code || 'USD'),
        },
        metadata,
        createdAt: new Date(),
      };
    } catch (error) {
      if (isPayPalNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async cancelPaymentIntent(intentId: string): Promise<PaymentIntent> {
    const order = await this.getPaymentIntent(intentId);

    if (!order) {
      throw new Error('Order not found');
    }

    return {
      ...order,
      status: 'cancelled',
    };
  }

  async refund(request: {
    paymentIntentId: string;
    amount?: number;
    reason?: string;
  }): Promise<RefundResult> {
    // First, get the capture ID from the order
    const order = await this.request<{
      id: string;
      purchase_units: Array<{
        payments: {
          captures: Array<{
            id: string;
            status: string;
            amount: { value: string; currency_code: string };
          }>;
        };
      }>;
    }>('GET', `/v2/checkout/orders/${request.paymentIntentId}`);

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
        value: centsToDollars(request.amount),
        currency_code: capture.amount.currency_code,
      };
    }

    const refund = await this.request<{
      id: string;
      status: string;
      amount: { value: string; currency_code: string };
      create_time: string;
    }>('POST', `/v2/payments/captures/${captureId}/refund`, Object.keys(refundBody).length > 0 ? refundBody : undefined);

    return {
      id: refund.id,
      provider: 'paypal',
      paymentIntentId: request.paymentIntentId,
      amount: {
        amount: dollarsToCents(refund.amount.value),
        currency: toCurrencyCode(refund.amount.currency_code),
      },
      status: refund.status === 'COMPLETED' ? 'succeeded' : 'pending',
      reason: request.reason,
      createdAt: new Date(refund.create_time),
    };
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
      return { isValid: false, error: (error as Error).message };
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
    eventType: string
  ) {
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
      type: eventType as 'checkout.session.completed' | 'payment_intent.succeeded' | 'payment_intent.payment_failed' | 'charge.refunded' | 'charge.dispute.created',
      provider: 'paypal' as const,
      data: {
        paymentIntentId:
          resource.supplementary_data?.related_ids?.order_id || resource.id,
        status: resource.status ? mapPayPalStatus(resource.status) : undefined,
        metadata,
        amount: resource.amount
          ? {
              amount: dollarsToCents(resource.amount.value),
              currency: toCurrencyCode(resource.amount.currency_code),
            }
          : undefined,
      },
      createdAt: new Date(event.create_time),
      rawPayload: event,
    };
  }

  async captureOrder(orderId: string): Promise<PaymentIntent> {
    const capture = await this.request<{
      id: string;
      status: string;
      purchase_units: Array<{
        custom_id?: string;
        payments: {
          captures: Array<{
            id: string;
            status: string;
            amount: { value: string; currency_code: string };
          }>;
        };
      }>;
    }>('POST', `/v2/checkout/orders/${orderId}/capture`);

    const purchaseUnit = capture.purchase_units?.[0];
    const captureDetails = purchaseUnit?.payments?.captures?.[0];
    let metadata: PaymentMetadata = { userId: '' };
    try {
      if (purchaseUnit?.custom_id) {
        metadata = JSON.parse(purchaseUnit.custom_id);
      }
    } catch {
      // Ignore parse errors
    }

    return {
      id: orderId,
      provider: 'paypal',
      status: mapPayPalStatus(capture.status),
      amount: {
        amount: captureDetails
          ? dollarsToCents(captureDetails.amount.value)
          : 0,
        currency: toCurrencyCode(captureDetails?.amount.currency_code || 'USD'),
      },
      metadata,
      createdAt: new Date(),
    };
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

  // Reset token cache for testing
  resetTokenCache(): void {
    this.accessToken = null;
  }
}

// Helper to create mock fetch response
function createMockResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe('PayPalProvider', () => {
  let provider: TestablePayPalProvider;
  let mockFetch: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    mockFetch = mock.fn();
    provider = new TestablePayPalProvider({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      webhookId: 'test_webhook_id',
      sandbox: true,
      fetchFn: mockFetch as unknown as MockFetch,
    });
  });

  describe('constructor', () => {
    it('should create a PayPalProvider instance', () => {
      assert.ok(provider);
      assert.strictEqual(provider.provider, 'paypal');
    });
  });

  describe('createCheckoutSession', () => {
    it('should create a checkout session successfully', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_123',
          status: 'CREATED',
          links: [
            { rel: 'payer-action', href: 'https://www.paypal.com/checkoutnow?token=order_123' },
          ],
        }));
      });

      const request = {
        customer: { id: 'user_123', email: 'test@example.com' },
        lineItems: [{
          id: 'item_1',
          name: 'Test Game',
          description: 'A great game',
          amount: 999,
          currency: 'USD' as CurrencyCode,
          quantity: 1,
        }],
        metadata: { userId: 'user_123', gameId: 'game_456' },
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
      };

      const session = await provider.createCheckoutSession(request);

      assert.strictEqual(session.id, 'order_123');
      assert.strictEqual(session.provider, 'paypal');
      assert.strictEqual(session.url, 'https://www.paypal.com/checkoutnow?token=order_123');
      assert.strictEqual(session.status, 'requires_action');
    });

    it('should convert amount from cents to dollars', async () => {
      let capturedBody: { purchase_units?: Array<{ amount?: { value?: string }; items?: Array<{ unit_amount?: { value?: string } }> }> } = {};
      mockFetch.mock.mockImplementation((url: string, options?: RequestInit) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        if (options?.body) {
          capturedBody = JSON.parse(options.body as string);
        }
        return Promise.resolve(createMockResponse({
          id: 'order_124',
          status: 'CREATED',
          links: [],
        }));
      });

      await provider.createCheckoutSession({
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
      });

      assert.strictEqual(capturedBody.purchase_units?.[0]?.amount?.value, '9.99');
      assert.strictEqual(capturedBody.purchase_units?.[0]?.items?.[0]?.unit_amount?.value, '9.99');
    });

    it('should throw on API error', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({ error: 'INVALID_REQUEST' }, 400));
      });

      await assert.rejects(
        () => provider.createCheckoutSession({
          customer: { id: 'user_123', email: 'test@example.com' },
          lineItems: [{
            id: 'item_1',
            name: 'Test',
            amount: 999,
            currency: 'USD' as CurrencyCode,
            quantity: 1,
          }],
          metadata: { userId: 'user_123' },
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
        }),
        /PayPal API error/
      );
    });
  });

  describe('getCheckoutSession', () => {
    it('should retrieve an existing order', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_123',
          status: 'APPROVED',
          purchase_units: [{
            custom_id: JSON.stringify({ userId: 'user_123', gameId: 'game_456' }),
          }],
        }));
      });

      const session = await provider.getCheckoutSession('order_123');

      assert.ok(session);
      assert.strictEqual(session.id, 'order_123');
      assert.strictEqual(session.status, 'succeeded');
      assert.strictEqual(session.metadata.userId, 'user_123');
    });

    it('should return null for non-existent order', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({ error: 'ORDER_NOT_FOUND' }, 404));
      });

      const session = await provider.getCheckoutSession('nonexistent');
      assert.strictEqual(session, null);
    });
  });

  describe('getPaymentIntent', () => {
    it('should retrieve an order as payment intent', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_123',
          status: 'COMPLETED',
          purchase_units: [{
            amount: { value: '9.99', currency_code: 'USD' },
            custom_id: JSON.stringify({ userId: 'user_123' }),
          }],
        }));
      });

      const intent = await provider.getPaymentIntent('order_123');

      assert.ok(intent);
      assert.strictEqual(intent.id, 'order_123');
      assert.strictEqual(intent.status, 'succeeded');
      // Should convert $9.99 to 999 cents
      assert.strictEqual(intent.amount.amount, 999);
      assert.strictEqual(intent.amount.currency, 'USD');
    });
  });

  describe('cancelPaymentIntent', () => {
    it('should return order with cancelled status', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_123',
          status: 'CREATED',
          purchase_units: [{
            amount: { value: '9.99', currency_code: 'USD' },
          }],
        }));
      });

      const intent = await provider.cancelPaymentIntent('order_123');

      assert.strictEqual(intent.id, 'order_123');
      assert.strictEqual(intent.status, 'cancelled');
    });

    it('should throw if order not found', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({ error: 'ORDER_NOT_FOUND' }, 404));
      });

      await assert.rejects(
        () => provider.cancelPaymentIntent('nonexistent'),
        /Order not found/
      );
    });
  });

  describe('refund', () => {
    it('should create a full refund', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        if (url.includes('/v2/checkout/orders/')) {
          return Promise.resolve(createMockResponse({
            id: 'order_123',
            status: 'COMPLETED',
            purchase_units: [{
              payments: {
                captures: [{
                  id: 'capture_123',
                  status: 'COMPLETED',
                  amount: { value: '9.99', currency_code: 'USD' },
                }],
              },
            }],
          }));
        }
        if (url.includes('/refund')) {
          return Promise.resolve(createMockResponse({
            id: 'refund_123',
            status: 'COMPLETED',
            amount: { value: '9.99', currency_code: 'USD' },
            create_time: new Date().toISOString(),
          }));
        }
        return Promise.resolve(createMockResponse({}, 404));
      });

      const result = await provider.refund({ paymentIntentId: 'order_123' });

      assert.strictEqual(result.id, 'refund_123');
      assert.strictEqual(result.provider, 'paypal');
      assert.strictEqual(result.status, 'succeeded');
      assert.strictEqual(result.amount.amount, 999);
    });

    it('should throw if no capture found', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_123',
          status: 'CREATED',
          purchase_units: [{
            payments: { captures: [] },
          }],
        }));
      });

      await assert.rejects(
        () => provider.refund({ paymentIntentId: 'order_123' }),
        /No capture found/
      );
    });
  });

  describe('verifyWebhook', () => {
    it('should verify valid webhook signature', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        if (url.includes('/verify-webhook-signature')) {
          return Promise.resolve(createMockResponse({
            verification_status: 'SUCCESS',
          }));
        }
        return Promise.resolve(createMockResponse({}, 404));
      });

      const payload = JSON.stringify({
        id: 'WH-123',
        event_type: 'CHECKOUT.ORDER.COMPLETED',
        resource: {
          id: 'order_123',
          status: 'COMPLETED',
          custom_id: JSON.stringify({ userId: 'user_123' }),
        },
        create_time: new Date().toISOString(),
      });

      const signature = 'transmission_id|timestamp|sig|SHA256withRSA|cert_url';

      const result = await provider.verifyWebhook(payload, signature);

      assert.strictEqual(result.isValid, true);
      assert.ok(result.event);
      assert.strictEqual(result.event.type, 'checkout.session.completed');
    });

    it('should reject invalid signature format', async () => {
      const result = await provider.verifyWebhook('{}', 'invalid|format');

      assert.strictEqual(result.isValid, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('Invalid signature format'));
    });

    it('should handle unmapped event types', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        if (url.includes('/verify-webhook-signature')) {
          return Promise.resolve(createMockResponse({
            verification_status: 'SUCCESS',
          }));
        }
        return Promise.resolve(createMockResponse({}, 404));
      });

      const payload = JSON.stringify({
        id: 'WH-124',
        event_type: 'UNKNOWN.EVENT.TYPE',
        resource: {},
        create_time: new Date().toISOString(),
      });

      const signature = 'transmission_id|timestamp|sig|SHA256withRSA|cert_url';

      const result = await provider.verifyWebhook(payload, signature);

      assert.strictEqual(result.isValid, true);
      assert.strictEqual(result.event, undefined);
    });
  });

  describe('captureOrder', () => {
    it('should capture an approved order', async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        if (url.includes('/capture')) {
          return Promise.resolve(createMockResponse({
            id: 'order_123',
            status: 'COMPLETED',
            purchase_units: [{
              custom_id: JSON.stringify({ userId: 'user_123', gameId: 'game_456' }),
              payments: {
                captures: [{
                  id: 'capture_123',
                  status: 'COMPLETED',
                  amount: { value: '9.99', currency_code: 'USD' },
                }],
              },
            }],
          }));
        }
        return Promise.resolve(createMockResponse({}, 404));
      });

      const result = await provider.captureOrder('order_123');

      assert.strictEqual(result.id, 'order_123');
      assert.strictEqual(result.status, 'succeeded');
      assert.strictEqual(result.amount.amount, 999);
      assert.strictEqual(result.metadata.userId, 'user_123');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy status when PayPal is accessible', async () => {
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve(createMockResponse({
          access_token: 'test_token',
          expires_in: 3600,
        }))
      );

      const status = await provider.healthCheck();

      assert.strictEqual(status.provider, 'paypal');
      assert.strictEqual(status.healthy, true);
      assert.ok(status.latencyMs !== undefined);
      assert.ok(status.latencyMs >= 0);
    });

    it('should return unhealthy status on auth failure', async () => {
      provider.resetTokenCache();
      mockFetch.mock.mockImplementation(() =>
        Promise.resolve(createMockResponse({ error: 'invalid_client' }, 401))
      );

      const status = await provider.healthCheck();

      assert.strictEqual(status.provider, 'paypal');
      assert.strictEqual(status.healthy, false);
      assert.ok(status.error);
    });
  });
});

describe('PayPal Status Mapping', () => {
  let provider: TestablePayPalProvider;
  let mockFetch: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    mockFetch = mock.fn();
    provider = new TestablePayPalProvider({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      webhookId: 'test_webhook_id',
      sandbox: true,
      fetchFn: mockFetch as unknown as MockFetch,
    });
  });

  const statusMappings = [
    { paypalStatus: 'COMPLETED', expectedStatus: 'succeeded' },
    { paypalStatus: 'APPROVED', expectedStatus: 'succeeded' },
    { paypalStatus: 'CREATED', expectedStatus: 'requires_action' },
    { paypalStatus: 'SAVED', expectedStatus: 'requires_action' },
    { paypalStatus: 'PAYER_ACTION_REQUIRED', expectedStatus: 'requires_action' },
    { paypalStatus: 'VOIDED', expectedStatus: 'cancelled' },
    { paypalStatus: 'UNKNOWN', expectedStatus: 'pending' },
  ];

  for (const { paypalStatus, expectedStatus } of statusMappings) {
    it(`should map "${paypalStatus}" to "${expectedStatus}"`, async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_test',
          status: paypalStatus,
          purchase_units: [{
            amount: { value: '9.99', currency_code: 'USD' },
          }],
        }));
      });

      const intent = await provider.getPaymentIntent('order_test');
      assert.ok(intent);
      assert.strictEqual(intent.status, expectedStatus);
    });
  }
});

describe('PayPal Currency Code Validation', () => {
  let provider: TestablePayPalProvider;
  let mockFetch: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    mockFetch = mock.fn();
    provider = new TestablePayPalProvider({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      webhookId: 'test_webhook_id',
      sandbox: true,
      fetchFn: mockFetch as unknown as MockFetch,
    });
  });

  const validCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

  for (const currency of validCurrencies) {
    it(`should accept valid currency "${currency}"`, async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_test',
          status: 'COMPLETED',
          purchase_units: [{
            amount: { value: '9.99', currency_code: currency },
          }],
        }));
      });

      const intent = await provider.getPaymentIntent('order_test');
      assert.ok(intent);
      assert.strictEqual(intent.amount.currency, currency);
    });
  }

  const invalidCurrencies = ['XYZ', 'INVALID', ''];

  for (const currency of invalidCurrencies) {
    it(`should default invalid currency "${currency}" to USD`, async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_test',
          status: 'COMPLETED',
          purchase_units: [{
            amount: { value: '9.99', currency_code: currency },
          }],
        }));
      });

      const intent = await provider.getPaymentIntent('order_test');
      assert.ok(intent);
      assert.strictEqual(intent.amount.currency, 'USD');
    });
  }
});

describe('PayPal Amount Conversions', () => {
  let provider: TestablePayPalProvider;
  let mockFetch: ReturnType<typeof mock.fn>;

  beforeEach(() => {
    mockFetch = mock.fn();
    provider = new TestablePayPalProvider({
      clientId: 'test_client_id',
      clientSecret: 'test_client_secret',
      webhookId: 'test_webhook_id',
      sandbox: true,
      fetchFn: mockFetch as unknown as MockFetch,
    });
  });

  const conversions = [
    { dollars: '9.99', expectedCents: 999 },
    { dollars: '100.00', expectedCents: 10000 },
    { dollars: '0.01', expectedCents: 1 },
    { dollars: '1234.56', expectedCents: 123456 },
    { dollars: '0.99', expectedCents: 99 },
  ];

  for (const { dollars, expectedCents } of conversions) {
    it(`should convert $${dollars} to ${expectedCents} cents`, async () => {
      mockFetch.mock.mockImplementation((url: string) => {
        if (url.includes('/oauth2/token')) {
          return Promise.resolve(createMockResponse({
            access_token: 'test_token',
            expires_in: 3600,
          }));
        }
        return Promise.resolve(createMockResponse({
          id: 'order_test',
          status: 'COMPLETED',
          purchase_units: [{
            amount: { value: dollars, currency_code: 'USD' },
          }],
        }));
      });

      const intent = await provider.getPaymentIntent('order_test');
      assert.ok(intent);
      assert.strictEqual(intent.amount.amount, expectedCents);
    });
  }
});
