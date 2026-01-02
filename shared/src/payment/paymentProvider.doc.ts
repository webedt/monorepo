/**
 * Payment Provider Documentation Interface
 *
 * This file contains the fully-documented interface for Payment Providers.
 * Implementation classes should extend APaymentProvider and implement
 * all abstract methods.
 *
 * @see APaymentProvider for the abstract base class
 * @see StripePaymentProvider for the Stripe implementation
 * @see PayPalPaymentProvider for the PayPal implementation
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

export type { CheckoutSession } from './types.js';
export type { CreateCheckoutRequest } from './types.js';
export type { CreatePaymentIntentRequest } from './types.js';
export type { PaymentIntent } from './types.js';
export type { PaymentProvider } from './types.js';
export type { ProviderHealthStatus } from './types.js';
export type { RefundRequest } from './types.js';
export type { RefundResult } from './types.js';
export type { WebhookVerification } from './types.js';

/**
 * Interface for Payment Provider with full documentation.
 *
 * Payment providers handle all payment processing operations including
 * checkout sessions, payment intents, refunds, and webhook verification.
 * The interface abstracts differences between payment processors (Stripe,
 * PayPal, etc.) behind a common API.
 *
 * ## Available Providers
 *
 * - **StripePaymentProvider**: Stripe payment processing
 * - **PayPalPaymentProvider**: PayPal payment processing
 *
 * ## Payment Flows
 *
 * ### Checkout Session Flow (Recommended)
 * 1. Create checkout session with line items
 * 2. Redirect user to hosted checkout page
 * 3. Receive webhook on completion
 * 4. Fulfill order
 *
 * ### Payment Intent Flow (Custom UI)
 * 1. Create payment intent with amount
 * 2. Collect card details via Elements/SDK
 * 3. Confirm payment on client
 * 4. Receive webhook on completion
 *
 * ## Webhook Handling
 *
 * All providers require webhook verification for security:
 * ```typescript
 * app.post('/webhook', async (req, res) => {
 *   const result = await provider.verifyWebhook(
 *     req.body,
 *     req.headers['stripe-signature']
 *   );
 *
 *   if (!result.isValid) {
 *     return res.status(400).send(result.error);
 *   }
 *
 *   // Process verified event
 *   await handlePaymentEvent(result.event);
 *   res.json({ received: true });
 * });
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * const provider = new StripePaymentProvider(config);
 *
 * // Create checkout session
 * const session = await provider.createCheckoutSession({
 *   customer: { id: 'cust-123', email: 'user@example.com' },
 *   lineItems: [
 *     { id: 'prod-1', name: 'Pro Plan', amount: 1999, currency: 'USD', quantity: 1 },
 *   ],
 *   metadata: { userId: 'user-123' },
 *   successUrl: 'https://app.com/success',
 *   cancelUrl: 'https://app.com/cancel',
 * });
 *
 * // Redirect user to checkout
 * redirect(session.url);
 * ```
 */
export interface IPaymentProviderDocumentation {
  /**
   * Payment provider identifier.
   *
   * Used to identify which provider processed a payment in logs,
   * analytics, and stored records.
   *
   * @example
   * ```typescript
   * console.log(`Payment processed by: ${provider.provider}`);
   * // Output: "Payment processed by: stripe"
   * ```
   */
  readonly provider: PaymentProvider;

  /**
   * Create a hosted checkout session.
   *
   * Creates a new checkout session that redirects the user to a
   * provider-hosted payment page. This is the recommended approach
   * as it handles PCI compliance automatically.
   *
   * @param request - Checkout session configuration
   * @param request.customer - Customer information (id, email, name)
   * @param request.lineItems - Products/services being purchased
   * @param request.metadata - Custom metadata to attach to payment
   * @param request.successUrl - URL to redirect on successful payment
   * @param request.cancelUrl - URL to redirect if user cancels
   * @param request.mode - Payment or subscription (default: 'payment')
   * @returns Created checkout session with redirect URL
   * @throws Error if session creation fails
   *
   * @example
   * ```typescript
   * const session = await provider.createCheckoutSession({
   *   customer: {
   *     id: 'cust-123',
   *     email: 'user@example.com',
   *     name: 'John Doe',
   *   },
   *   lineItems: [
   *     {
   *       id: 'credits-100',
   *       name: '100 AI Credits',
   *       description: 'Credits for AI code generation',
   *       amount: 999, // $9.99 in cents
   *       currency: 'USD',
   *       quantity: 1,
   *     },
   *   ],
   *   metadata: {
   *     userId: 'user-123',
   *     purchaseId: 'purchase-456',
   *   },
   *   successUrl: 'https://app.com/checkout/success?session={CHECKOUT_SESSION_ID}',
   *   cancelUrl: 'https://app.com/checkout/cancel',
   * });
   *
   * // Redirect user to hosted checkout
   * res.redirect(303, session.url);
   * ```
   *
   * @example
   * ```typescript
   * // Subscription checkout
   * const session = await provider.createCheckoutSession({
   *   customer: { id: 'cust-123', email: 'user@example.com' },
   *   lineItems: [
   *     { id: 'pro-monthly', name: 'Pro Plan', amount: 1999, currency: 'USD', quantity: 1 },
   *   ],
   *   metadata: { userId: 'user-123' },
   *   successUrl: 'https://app.com/success',
   *   cancelUrl: 'https://app.com/cancel',
   *   mode: 'subscription',
   * });
   * ```
   */
  createCheckoutSession(
    request: CreateCheckoutRequest
  ): Promise<CheckoutSession>;

  /**
   * Retrieve a checkout session by ID.
   *
   * Fetches the current state of a checkout session. Use this to:
   * - Verify payment completion on success page
   * - Check session status for pending payments
   * - Retrieve session details for order fulfillment
   *
   * @param sessionId - The checkout session ID
   * @returns Checkout session if found, null if not found
   * @throws Error if retrieval fails (network, auth, etc.)
   *
   * @example
   * ```typescript
   * // On success page, verify the payment
   * const sessionId = req.query.session_id;
   * const session = await provider.getCheckoutSession(sessionId);
   *
   * if (!session) {
   *   return res.status(404).send('Session not found');
   * }
   *
   * if (session.status === 'succeeded') {
   *   await fulfillOrder(session.metadata.purchaseId);
   *   res.send('Thank you for your purchase!');
   * } else {
   *   res.send('Payment pending or failed');
   * }
   * ```
   */
  getCheckoutSession(
    sessionId: string
  ): Promise<CheckoutSession | null>;

  /**
   * Create a payment intent for custom checkout UI.
   *
   * Creates a payment intent that can be confirmed with a custom
   * checkout form using Stripe Elements or similar. Use this when
   * you need full control over the checkout UI.
   *
   * @param request - Payment intent configuration
   * @param request.amount - Payment amount and currency
   * @param request.customer - Customer information
   * @param request.metadata - Custom metadata
   * @param request.paymentMethodTypes - Accepted payment methods
   * @param request.description - Payment description
   * @returns Created payment intent with client secret
   * @throws Error if creation fails
   *
   * @example
   * ```typescript
   * const intent = await provider.createPaymentIntent({
   *   amount: { amount: 2500, currency: 'USD' },
   *   customer: { id: 'cust-123', email: 'user@example.com' },
   *   metadata: { userId: 'user-123', orderId: 'order-789' },
   *   description: 'Order #789',
   * });
   *
   * // Send client secret to frontend
   * res.json({ clientSecret: intent.clientSecret });
   *
   * // Frontend confirms with Stripe.js:
   * // stripe.confirmCardPayment(clientSecret, { payment_method: {...} })
   * ```
   */
  createPaymentIntent(
    request: CreatePaymentIntentRequest
  ): Promise<PaymentIntent>;

  /**
   * Retrieve a payment intent by ID.
   *
   * Fetches the current state of a payment intent including status,
   * amount, and metadata. Use this to check payment status or
   * retrieve details for refunds.
   *
   * @param intentId - The payment intent ID
   * @returns Payment intent if found, null if not found
   *
   * @example
   * ```typescript
   * const intent = await provider.getPaymentIntent('pi_abc123');
   *
   * if (intent?.status === 'succeeded') {
   *   console.log(`Payment of ${intent.amount.amount} ${intent.amount.currency} succeeded`);
   * }
   * ```
   */
  getPaymentIntent(
    intentId: string
  ): Promise<PaymentIntent | null>;

  /**
   * Cancel a payment intent.
   *
   * Cancels an uncaptured payment intent. Can only be called on
   * intents that are not yet succeeded or captured.
   *
   * @param intentId - The payment intent ID to cancel
   * @returns Updated payment intent with cancelled status
   * @throws Error if intent cannot be cancelled (already succeeded, etc.)
   *
   * @example
   * ```typescript
   * // User abandons checkout, cancel the intent
   * try {
   *   const cancelled = await provider.cancelPaymentIntent('pi_abc123');
   *   console.log('Payment intent cancelled');
   * } catch (error) {
   *   // Intent may have already succeeded
   *   console.error('Could not cancel:', error.message);
   * }
   * ```
   */
  cancelPaymentIntent(
    intentId: string
  ): Promise<PaymentIntent>;

  /**
   * Process a refund.
   *
   * Refunds a payment intent fully or partially. Refunds are
   * processed asynchronously and may take several days to appear
   * in the customer's account.
   *
   * @param request - Refund configuration
   * @param request.paymentIntentId - The payment intent to refund
   * @param request.amount - Amount to refund in cents (omit for full refund)
   * @param request.reason - Optional reason for the refund
   * @param request.metadata - Optional metadata to attach
   * @returns Refund result with status
   * @throws Error if refund fails (already refunded, etc.)
   *
   * @example
   * ```typescript
   * // Full refund
   * const refund = await provider.refund({
   *   paymentIntentId: 'pi_abc123',
   *   reason: 'Customer requested cancellation',
   * });
   *
   * console.log(`Refund ${refund.id}: ${refund.status}`);
   * ```
   *
   * @example
   * ```typescript
   * // Partial refund (refund $5.00 of a $25.00 payment)
   * const refund = await provider.refund({
   *   paymentIntentId: 'pi_abc123',
   *   amount: 500, // $5.00 in cents
   *   reason: 'Partial service credit',
   * });
   * ```
   */
  refund(
    request: RefundRequest
  ): Promise<RefundResult>;

  /**
   * Verify a webhook signature and parse the event.
   *
   * Verifies that a webhook request came from the payment provider
   * and has not been tampered with. Always verify webhooks before
   * processing to prevent fraud.
   *
   * @param payload - Raw request body (string or Buffer)
   * @param signature - Signature header from the request
   * @returns Verification result with parsed event if valid
   *
   * @example
   * ```typescript
   * app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
   *   const verification = await provider.verifyWebhook(
   *     req.body,
   *     req.headers['stripe-signature'] as string
   *   );
   *
   *   if (!verification.isValid) {
   *     console.error('Webhook verification failed:', verification.error);
   *     return res.status(400).send('Invalid signature');
   *   }
   *
   *   const event = verification.event!;
   *
   *   switch (event.type) {
   *     case 'checkout.session.completed':
   *       await handleCheckoutComplete(event.data);
   *       break;
   *     case 'payment_intent.succeeded':
   *       await handlePaymentSuccess(event.data);
   *       break;
   *     case 'charge.refunded':
   *       await handleRefund(event.data);
   *       break;
   *   }
   *
   *   res.json({ received: true });
   * });
   * ```
   */
  verifyWebhook(
    payload: string | Buffer,
    signature: string
  ): Promise<WebhookVerification>;

  /**
   * Check provider health and connectivity.
   *
   * Performs a lightweight health check to verify the provider
   * is accessible and responding. Use this for monitoring and
   * readiness probes.
   *
   * @returns Health status with latency and any errors
   *
   * @example
   * ```typescript
   * // Kubernetes readiness probe
   * app.get('/ready', async (req, res) => {
   *   const health = await provider.healthCheck();
   *
   *   if (health.healthy) {
   *     res.json({
   *       status: 'ok',
   *       provider: health.provider,
   *       latencyMs: health.latencyMs,
   *     });
   *   } else {
   *     res.status(503).json({
   *       status: 'unhealthy',
   *       provider: health.provider,
   *       error: health.error,
   *     });
   *   }
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Periodic health monitoring
   * setInterval(async () => {
   *   const health = await provider.healthCheck();
   *   metrics.gauge('payment_provider_healthy', health.healthy ? 1 : 0);
   *   metrics.histogram('payment_provider_latency', health.latencyMs);
   * }, 30000);
   * ```
   */
  healthCheck(): Promise<ProviderHealthStatus>;
}
