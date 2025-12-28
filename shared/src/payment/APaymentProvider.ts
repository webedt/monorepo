/**
 * Abstract Payment Provider
 * Defines the interface for payment provider implementations
 */

import type { CheckoutSession } from './types.js';
import type { CreateCheckoutRequest } from './types.js';
import type { CreatePaymentIntentRequest } from './types.js';
import type { PaymentIntent } from './types.js';
import type { PaymentProvider } from './types.js';
import type { ProviderHealthStatus } from './types.js';
import type { RefundRequest } from './types.js';
import type { RefundResult } from './types.js';
import type { WebhookVerification } from './types.js';

export abstract class APaymentProvider {
  abstract readonly provider: PaymentProvider;

  abstract createCheckoutSession(
    request: CreateCheckoutRequest
  ): Promise<CheckoutSession>;

  abstract getCheckoutSession(
    sessionId: string
  ): Promise<CheckoutSession | null>;

  abstract createPaymentIntent(
    request: CreatePaymentIntentRequest
  ): Promise<PaymentIntent>;

  abstract getPaymentIntent(
    intentId: string
  ): Promise<PaymentIntent | null>;

  abstract cancelPaymentIntent(
    intentId: string
  ): Promise<PaymentIntent>;

  abstract refund(
    request: RefundRequest
  ): Promise<RefundResult>;

  abstract verifyWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<WebhookVerification>;

  abstract healthCheck(): Promise<ProviderHealthStatus>;
}
