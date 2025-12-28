/**
 * Payment Module
 * Stripe and PayPal payment provider integrations
 */

// Types
export type { PaymentProvider } from './types.js';
export type { PaymentStatus } from './types.js';
export type { PaymentMethodType } from './types.js';
export type { CurrencyCode } from './types.js';
export type { PaymentAmount } from './types.js';
export type { PaymentCustomer } from './types.js';
export type { LineItem } from './types.js';
export type { PaymentMetadata } from './types.js';
export type { CreateCheckoutRequest } from './types.js';
export type { CheckoutSession } from './types.js';
export type { CreatePaymentIntentRequest } from './types.js';
export type { PaymentIntent } from './types.js';
export type { RefundRequest } from './types.js';
export type { RefundResult } from './types.js';
export type { WebhookEventType } from './types.js';
export type { WebhookEvent } from './types.js';
export type { WebhookVerification } from './types.js';
export type { PaymentProviderConfig } from './types.js';
export type { ProviderHealthStatus } from './types.js';

// Abstract provider
export { APaymentProvider } from './APaymentProvider.js';

// Provider implementations
export { StripeProvider, createStripeProvider } from './stripeProvider.js';
export type { StripeConfig } from './stripeProvider.js';

export { PayPalProvider, createPayPalProvider } from './paypalProvider.js';
export type { PayPalConfig } from './paypalProvider.js';

// Payment service
export { PaymentService, getPaymentService } from './PaymentService.js';
export type { CreateCheckoutOptions } from './PaymentService.js';
export type { ProcessWebhookResult } from './PaymentService.js';
