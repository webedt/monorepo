/**
 * Payment Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Payment Service.
 * The Payment Service coordinates payment operations across multiple providers
 * (Stripe, PayPal) and handles the complete payment lifecycle including
 * checkouts, webhooks, refunds, and purchase fulfillment.
 *
 * @see PaymentService for the implementation class
 * @see APaymentProvider for the provider abstraction
 * @see StripeProvider for the Stripe implementation
 * @see PayPalProvider for the PayPal implementation
 */

import type { CheckoutSession } from './types.js';
import type { PaymentProvider } from './types.js';
import type { ProviderHealthStatus } from './types.js';
import type { RefundResult } from './types.js';

export type { CheckoutSession } from './types.js';
export type { PaymentProvider } from './types.js';
export type { ProviderHealthStatus } from './types.js';
export type { RefundResult } from './types.js';

/**
 * Options for creating a checkout session
 */
export interface CreateCheckoutOptions {
  /** User ID initiating the purchase */
  userId: string;
  /** User's email address */
  userEmail: string;
  /** ID of the game being purchased */
  gameId: string;
  /** Display name of the game */
  gameName: string;
  /** Amount in smallest currency unit (e.g., cents for USD) */
  amount: number;
  /** Currency code (USD, EUR, GBP, etc.) */
  currency: string;
  /** Payment provider to use (stripe or paypal) */
  provider: PaymentProvider;
  /** URL to redirect on successful payment */
  successUrl: string;
  /** URL to redirect if payment is cancelled */
  cancelUrl: string;
}

/**
 * Result of processing a webhook
 */
export interface ProcessWebhookResult {
  /** Whether the webhook was processed successfully */
  success: boolean;
  /** ID of the associated transaction (if applicable) */
  transactionId?: string;
  /** ID of the created purchase (if applicable) */
  purchaseId?: string;
  /** Error message if processing failed */
  error?: string;
}

/**
 * Interface for Payment Service with full documentation.
 *
 * The Payment Service is the central coordinator for all payment operations.
 * It manages multiple payment providers, handles checkout creation, processes
 * webhooks, and coordinates purchase fulfillment with the game library.
 *
 * ## Features
 *
 * - **Multi-Provider Support**: Stripe and PayPal out of the box
 * - **Webhook Processing**: Secure verification and event handling
 * - **Transaction Tracking**: Full audit trail of all payment operations
 * - **Purchase Fulfillment**: Automatic library updates on successful payment
 * - **Refund Handling**: Full and partial refund support
 *
 * ## Payment Flow
 *
 * ### Checkout Flow
 * 1. Create checkout session with `createCheckout()`
 * 2. Redirect user to provider's hosted checkout page
 * 3. Receive webhook on `checkout.session.completed`
 * 4. Automatically create purchase and add to user library
 *
 * ### PayPal Order Capture
 * 1. Create checkout session with `createCheckout()` (provider: 'paypal')
 * 2. User approves on PayPal
 * 3. Capture order with `capturePayPalOrder()`
 * 4. Purchase fulfillment on successful capture
 *
 * ## Webhook Handling
 *
 * ```typescript
 * app.post('/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
 *   const result = await paymentService.processWebhook(
 *     'stripe',
 *     req.body,
 *     req.headers['stripe-signature'] as string
 *   );
 *
 *   if (!result.success) {
 *     return res.status(400).json({ error: result.error });
 *   }
 *
 *   res.json({ received: true });
 * });
 * ```
 *
 * ## Usage
 *
 * ```typescript
 * const paymentService = getPaymentService();
 *
 * // Create checkout session
 * const session = await paymentService.createCheckout({
 *   userId: 'user-123',
 *   userEmail: 'user@example.com',
 *   gameId: 'game-456',
 *   gameName: 'Epic Adventure',
 *   amount: 2999, // $29.99 in cents
 *   currency: 'USD',
 *   provider: 'stripe',
 *   successUrl: 'https://app.com/checkout/success',
 *   cancelUrl: 'https://app.com/checkout/cancel',
 * });
 *
 * // Redirect user to checkout
 * res.redirect(303, session.url);
 * ```
 */
export interface IPaymentServiceDocumentation {
  /**
   * Get a specific payment provider instance.
   *
   * Returns the configured provider instance for the given provider type.
   * Returns undefined if the provider is not configured or available.
   *
   * @param provider - The provider type ('stripe' or 'paypal')
   * @returns The provider instance or undefined if not available
   *
   * @example
   * ```typescript
   * const stripe = paymentService.getProvider('stripe');
   * if (stripe) {
   *   const session = await stripe.createCheckoutSession(request);
   * }
   * ```
   */
  getProvider(provider: PaymentProvider): unknown | undefined;

  /**
   * Get list of available payment providers.
   *
   * Returns an array of provider identifiers that are currently
   * configured and available for use.
   *
   * @returns Array of available provider identifiers
   *
   * @example
   * ```typescript
   * const providers = paymentService.getAvailableProviders();
   * console.log('Available providers:', providers);
   * // Output: ['stripe', 'paypal']
   *
   * // Show provider options in UI
   * providers.forEach(p => renderProviderOption(p));
   * ```
   */
  getAvailableProviders(): PaymentProvider[];

  /**
   * Check if a specific payment provider is available.
   *
   * Returns true if the provider is configured and ready to process
   * payments. Use this to conditionally show payment options in the UI.
   *
   * @param provider - The provider to check
   * @returns True if provider is available
   *
   * @example
   * ```typescript
   * if (paymentService.isProviderAvailable('paypal')) {
   *   showPayPalButton();
   * }
   *
   * if (!paymentService.isProviderAvailable('stripe')) {
   *   console.warn('Stripe not configured - check environment variables');
   * }
   * ```
   */
  isProviderAvailable(provider: PaymentProvider): boolean;

  /**
   * Create a checkout session for a game purchase.
   *
   * Creates a new checkout session with the specified provider and
   * stores the transaction in the database for tracking. Returns
   * a checkout session with a URL to redirect the user to.
   *
   * The amount must be a positive integer in the smallest currency
   * unit (e.g., cents for USD, pence for GBP).
   *
   * @param options - Checkout configuration
   * @param options.userId - User ID initiating the purchase
   * @param options.userEmail - User's email for receipts
   * @param options.gameId - ID of the game being purchased
   * @param options.gameName - Display name of the game
   * @param options.amount - Amount in smallest currency unit
   * @param options.currency - Currency code (USD, EUR, etc.)
   * @param options.provider - Payment provider to use
   * @param options.successUrl - URL for successful payment redirect
   * @param options.cancelUrl - URL for cancelled payment redirect
   * @returns Created checkout session with redirect URL
   * @throws Error if amount is invalid or provider unavailable
   *
   * @example
   * ```typescript
   * // Create Stripe checkout
   * const session = await paymentService.createCheckout({
   *   userId: 'user-123',
   *   userEmail: 'gamer@example.com',
   *   gameId: 'game-456',
   *   gameName: 'Space Explorer',
   *   amount: 1999, // $19.99
   *   currency: 'USD',
   *   provider: 'stripe',
   *   successUrl: `${APP_URL}/checkout/success?session={CHECKOUT_SESSION_ID}`,
   *   cancelUrl: `${APP_URL}/checkout/cancel`,
   * });
   *
   * // Redirect to hosted checkout
   * res.redirect(303, session.url);
   * ```
   *
   * @example
   * ```typescript
   * // Create PayPal checkout
   * const session = await paymentService.createCheckout({
   *   userId: 'user-123',
   *   userEmail: 'gamer@example.com',
   *   gameId: 'game-789',
   *   gameName: 'Racing Championship',
   *   amount: 4999, // $49.99
   *   currency: 'USD',
   *   provider: 'paypal',
   *   successUrl: `${APP_URL}/checkout/paypal/capture?token={TOKEN}`,
   *   cancelUrl: `${APP_URL}/checkout/cancel`,
   * });
   * ```
   */
  createCheckout(options: CreateCheckoutOptions): Promise<CheckoutSession>;

  /**
   * Process a webhook from a payment provider.
   *
   * Verifies the webhook signature, logs the event, and processes
   * it appropriately. Handles checkout completion, payment success/failure,
   * and refund events.
   *
   * Webhook processing is idempotent - duplicate events are safely ignored.
   *
   * @param provider - The payment provider sending the webhook
   * @param payload - Raw webhook payload (string or Buffer)
   * @param signature - Webhook signature header for verification
   * @returns Processing result with success status
   *
   * @example
   * ```typescript
   * // Express webhook endpoint for Stripe
   * app.post('/webhook/stripe',
   *   express.raw({ type: 'application/json' }),
   *   async (req, res) => {
   *     const result = await paymentService.processWebhook(
   *       'stripe',
   *       req.body,
   *       req.headers['stripe-signature'] as string
   *     );
   *
   *     if (!result.success) {
   *       console.error('Webhook failed:', result.error);
   *       return res.status(400).json({ error: result.error });
   *     }
   *
   *     if (result.purchaseId) {
   *       console.log('Purchase created:', result.purchaseId);
   *     }
   *
   *     res.json({ received: true });
   *   }
   * );
   * ```
   *
   * @example
   * ```typescript
   * // PayPal webhook with IPN
   * app.post('/webhook/paypal', async (req, res) => {
   *   const result = await paymentService.processWebhook(
   *     'paypal',
   *     JSON.stringify(req.body),
   *     req.headers['paypal-transmission-sig'] as string
   *   );
   *
   *   res.status(result.success ? 200 : 400).send();
   * });
   * ```
   */
  processWebhook(
    provider: PaymentProvider,
    payload: string | Buffer,
    signature: string
  ): Promise<ProcessWebhookResult>;

  /**
   * Process a refund for a transaction.
   *
   * Refunds a completed transaction, either fully or partially.
   * Creates a refund transaction record and updates the original
   * transaction and purchase status.
   *
   * @param transactionId - The transaction ID to refund
   * @param amount - Optional partial refund amount (omit for full refund)
   * @param reason - Optional reason for the refund
   * @returns Refund result with status
   * @throws Error if transaction not found or not eligible for refund
   *
   * @example
   * ```typescript
   * // Full refund
   * const refund = await paymentService.refund(
   *   'txn-abc123',
   *   undefined, // Full refund
   *   'Customer requested cancellation'
   * );
   *
   * console.log(`Refund ${refund.id}: ${refund.status}`);
   * ```
   *
   * @example
   * ```typescript
   * // Partial refund
   * const refund = await paymentService.refund(
   *   'txn-abc123',
   *   500, // $5.00 partial refund
   *   'Promotional credit'
   * );
   * ```
   *
   * @example
   * ```typescript
   * // Handle refund errors
   * try {
   *   await paymentService.refund('txn-abc123');
   * } catch (error) {
   *   if (error.message === 'Transaction not eligible for refund') {
   *     // Transaction already refunded or failed
   *   }
   * }
   * ```
   */
  refund(
    transactionId: string,
    amount?: number,
    reason?: string
  ): Promise<RefundResult>;

  /**
   * Check health of all payment providers.
   *
   * Performs health checks on all configured providers and returns
   * their status. Use this for monitoring and readiness probes.
   *
   * @returns Array of provider health statuses
   *
   * @example
   * ```typescript
   * // Kubernetes readiness probe
   * app.get('/ready/payments', async (req, res) => {
   *   const statuses = await paymentService.healthCheck();
   *
   *   const allHealthy = statuses.every(s => s.healthy);
   *
   *   res.status(allHealthy ? 200 : 503).json({
   *     status: allHealthy ? 'ok' : 'degraded',
   *     providers: statuses.map(s => ({
   *       provider: s.provider,
   *       healthy: s.healthy,
   *       latencyMs: s.latencyMs,
   *       error: s.error,
   *     })),
   *   });
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Periodic health monitoring
   * setInterval(async () => {
   *   const statuses = await paymentService.healthCheck();
   *
   *   for (const status of statuses) {
   *     metrics.gauge(`payment_provider_healthy_${status.provider}`,
   *       status.healthy ? 1 : 0
   *     );
   *     metrics.histogram(`payment_provider_latency_${status.provider}`,
   *       status.latencyMs
   *     );
   *   }
   * }, 60000);
   * ```
   */
  healthCheck(): Promise<ProviderHealthStatus[]>;

  /**
   * Capture a PayPal order after user approval.
   *
   * PayPal orders require a separate capture step after the user
   * approves the payment on PayPal's site. This method captures
   * the approved order and completes the purchase.
   *
   * @param orderId - The PayPal order ID to capture
   * @returns Processing result with transaction and purchase IDs
   *
   * @example
   * ```typescript
   * // PayPal return handler
   * app.get('/checkout/paypal/capture', async (req, res) => {
   *   const { token: orderId } = req.query;
   *
   *   const result = await paymentService.capturePayPalOrder(orderId as string);
   *
   *   if (!result.success) {
   *     return res.redirect(`/checkout/error?message=${result.error}`);
   *   }
   *
   *   res.redirect(`/library?purchased=${result.purchaseId}`);
   * });
   * ```
   *
   * @example
   * ```typescript
   * // API endpoint for PayPal capture
   * app.post('/api/checkout/paypal/capture', async (req, res) => {
   *   const { orderId } = req.body;
   *
   *   const result = await paymentService.capturePayPalOrder(orderId);
   *
   *   if (!result.success) {
   *     return res.status(400).json({ error: result.error });
   *   }
   *
   *   res.json({
   *     success: true,
   *     transactionId: result.transactionId,
   *     purchaseId: result.purchaseId,
   *   });
   * });
   * ```
   */
  capturePayPalOrder(orderId: string): Promise<ProcessWebhookResult>;
}
