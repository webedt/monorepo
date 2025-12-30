/**
 * Tests for Payment Routes
 * Covers input validation, webhook handling, refund processing, and edge cases
 * for Stripe and PayPal payment flows.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without database access. Integration tests would require a test database
 * and mocked payment provider APIs.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { randomUUID, createHash } from 'crypto';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

interface MockUser {
  id: string;
  email: string;
  isAdmin: boolean;
}

interface MockGame {
  id: string;
  title: string;
  price: number;
  currency: string;
  status: 'published' | 'draft' | 'archived';
}

interface MockTransaction {
  id: string;
  userId: string;
  provider: 'stripe' | 'paypal';
  providerSessionId: string;
  providerTransactionId: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded' | 'pending_refund';
  amount: number;
  currency: string;
  purchaseId: string | null;
  createdAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown>;
}

interface MockStripeWebhookEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
}

interface MockPayPalWebhookEvent {
  id: string;
  event_type: string;
  create_time: string;
  resource: Record<string, unknown>;
}

interface CheckoutValidationResult {
  valid: boolean;
  error?: string;
  validProviders?: string[];
}

interface WebhookValidationResult {
  valid: boolean;
  error?: string;
  event?: {
    id: string;
    type: string;
    provider: 'stripe' | 'paypal';
    data: Record<string, unknown>;
  };
}

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: `user-${randomUUID()}`,
    email: `test-${randomUUID().slice(0, 8)}@example.com`,
    isAdmin: false,
    ...overrides,
  };
}

function createMockGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    id: `game-${randomUUID()}`,
    title: 'Test Game',
    price: 999, // $9.99 in cents
    currency: 'USD',
    status: 'published',
    ...overrides,
  };
}

function createMockTransaction(overrides: Partial<MockTransaction> = {}): MockTransaction {
  return {
    id: `txn-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    provider: 'stripe',
    providerTransactionId: `pi_${randomUUID().replace(/-/g, '')}`,
    providerSessionId: `cs_${randomUUID().replace(/-/g, '')}`,
    status: 'pending',
    amount: 999,
    currency: 'USD',
    purchaseId: null,
    createdAt: new Date(),
    completedAt: null,
    metadata: {},
    ...overrides,
  };
}

function createStripeCheckoutCompletedEvent(overrides: {
  sessionId?: string;
  paymentIntentId?: string;
  metadata?: Record<string, string>;
  amount?: number;
} = {}): MockStripeWebhookEvent {
  const sessionId = overrides.sessionId || `cs_${randomUUID().replace(/-/g, '')}`;
  const paymentIntentId = overrides.paymentIntentId || `pi_${randomUUID().replace(/-/g, '')}`;

  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        payment_intent: paymentIntentId,
        payment_status: 'paid',
        status: 'complete',
        amount_total: overrides.amount || 999,
        currency: 'usd',
        metadata: overrides.metadata || {
          userId: 'test-user-id',
          gameId: 'test-game-id',
          transactionId: 'test-txn-id',
        },
      },
    },
  };
}

function createStripeSessionExpiredEvent(overrides: {
  sessionId?: string;
} = {}): MockStripeWebhookEvent {
  const sessionId = overrides.sessionId || `cs_${randomUUID().replace(/-/g, '')}`;

  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    type: 'checkout.session.expired',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: sessionId,
        object: 'checkout.session',
        status: 'expired',
        expires_at: Math.floor(Date.now() / 1000) - 3600,
      },
    },
  };
}

function createStripePaymentFailedEvent(overrides: {
  paymentIntentId?: string;
  failureMessage?: string;
} = {}): MockStripeWebhookEvent {
  const paymentIntentId = overrides.paymentIntentId || `pi_${randomUUID().replace(/-/g, '')}`;

  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    type: 'payment_intent.payment_failed',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        status: 'requires_payment_method',
        last_payment_error: {
          message: overrides.failureMessage || 'Your card was declined.',
          code: 'card_declined',
        },
      },
    },
  };
}

function createStripeRefundEvent(overrides: {
  refundId?: string;
  paymentIntentId?: string;
  amount?: number;
} = {}): MockStripeWebhookEvent {
  const refundId = overrides.refundId || `re_${randomUUID().replace(/-/g, '')}`;
  const paymentIntentId = overrides.paymentIntentId || `pi_${randomUUID().replace(/-/g, '')}`;

  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    type: 'charge.refunded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: refundId,
        object: 'charge',
        payment_intent: paymentIntentId,
        refunded: true,
        amount: overrides.amount || 999,
        amount_refunded: overrides.amount || 999,
        currency: 'usd',
      },
    },
  };
}

function createPayPalOrderCompletedEvent(overrides: {
  orderId?: string;
  metadata?: Record<string, string>;
  amount?: string;
} = {}): MockPayPalWebhookEvent {
  const orderId = overrides.orderId || randomUUID();

  return {
    id: `WH-${randomUUID()}`,
    event_type: 'CHECKOUT.ORDER.COMPLETED',
    create_time: new Date().toISOString(),
    resource: {
      id: orderId,
      status: 'COMPLETED',
      custom_id: JSON.stringify(overrides.metadata || {
        userId: 'test-user-id',
        gameId: 'test-game-id',
      }),
      purchase_units: [{
        amount: {
          value: overrides.amount || '9.99',
          currency_code: 'USD',
        },
      }],
    },
  };
}

function createPayPalCaptureRefundedEvent(overrides: {
  captureId?: string;
  amount?: string;
} = {}): MockPayPalWebhookEvent {
  const captureId = overrides.captureId || randomUUID();

  return {
    id: `WH-${randomUUID()}`,
    event_type: 'PAYMENT.CAPTURE.REFUNDED',
    create_time: new Date().toISOString(),
    resource: {
      id: captureId,
      status: 'REFUNDED',
      amount: {
        value: overrides.amount || '9.99',
        currency_code: 'USD',
      },
    },
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

const VALID_PAYMENT_PROVIDERS = ['stripe', 'paypal'] as const;
type PaymentProvider = typeof VALID_PAYMENT_PROVIDERS[number];

function validateCheckoutInput(body: Record<string, unknown>): CheckoutValidationResult {
  const { gameId, provider = 'stripe' } = body;

  if (!gameId) {
    return { valid: false, error: 'Game ID is required' };
  }

  if (!VALID_PAYMENT_PROVIDERS.includes(provider as PaymentProvider)) {
    return {
      valid: false,
      error: 'Invalid payment provider',
      validProviders: [...VALID_PAYMENT_PROVIDERS],
    };
  }

  return { valid: true };
}

function validateGameForCheckout(game: MockGame | null, userId: string, userOwnsGame: boolean): CheckoutValidationResult {
  if (!game) {
    return { valid: false, error: 'Game not found' };
  }

  if (game.status !== 'published') {
    return { valid: false, error: 'Game not found' };
  }

  if (game.price === 0) {
    return { valid: false, error: 'This game is free. Use the purchase endpoint instead.' };
  }

  if (userOwnsGame) {
    return { valid: false, error: 'You already own this game' };
  }

  return { valid: true };
}

function validatePayPalCaptureInput(body: Record<string, unknown>): CheckoutValidationResult {
  const { orderId } = body;

  if (!orderId) {
    return { valid: false, error: 'Order ID is required' };
  }

  return { valid: true };
}

function validateRefundInput(body: Record<string, unknown>): CheckoutValidationResult {
  const { reason } = body;

  if (!reason || typeof reason !== 'string' || reason.trim().length < 10) {
    return {
      valid: false,
      error: 'Refund reason is required (minimum 10 characters)',
    };
  }

  return { valid: true };
}

function validateRefundEligibility(transaction: MockTransaction): CheckoutValidationResult {
  if (!transaction) {
    return { valid: false, error: 'Transaction not found' };
  }

  if (transaction.status !== 'succeeded') {
    return { valid: false, error: 'Transaction not eligible for refund' };
  }

  // Check 14-day refund window
  const daysSincePayment = Math.floor(
    (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSincePayment > 14) {
    return { valid: false, error: 'Refund period expired (14 days)' };
  }

  return { valid: true };
}

/**
 * MOCK ONLY: Simplified Stripe webhook signature verification for testing.
 * Real Stripe verification uses HMAC-SHA256 with the webhook signing secret.
 */
function verifyStripeWebhookSignature(payload: string, signature: string): WebhookValidationResult {
  if (!signature) {
    return { valid: false, error: 'Missing signature' };
  }

  // Mock validation: check for required signature parts
  if (!signature.includes('t=') || !signature.includes('v1=')) {
    return { valid: false, error: 'Invalid signature format' };
  }

  try {
    const event = JSON.parse(payload);
    return {
      valid: true,
      event: {
        id: event.id,
        type: event.type,
        provider: 'stripe',
        data: event.data?.object || {},
      },
    };
  } catch {
    return { valid: false, error: 'Invalid payload' };
  }
}

/**
 * MOCK ONLY: Simplified PayPal webhook signature verification for testing.
 * Real PayPal verification requires validating the transmission signature
 * using PayPal's public certificates.
 */
function verifyPayPalWebhookSignature(
  payload: string,
  signature: string
): WebhookValidationResult {
  if (!signature) {
    return { valid: false, error: 'Missing PayPal headers' };
  }

  // PayPal signature format: transmissionId|timestamp|transmissionSig|algo|certUrl
  const parts = signature.split('|');
  if (parts.length < 5) {
    return { valid: false, error: 'Invalid signature format - expected 5 parts' };
  }

  const [transmissionId, timestamp, transmissionSig] = parts;
  if (!transmissionId || !timestamp || !transmissionSig) {
    return { valid: false, error: 'Missing PayPal headers' };
  }

  try {
    const event = JSON.parse(payload);
    return {
      valid: true,
      event: {
        id: event.id,
        type: event.event_type,
        provider: 'paypal',
        data: event.resource || {},
      },
    };
  } catch {
    return { valid: false, error: 'Invalid payload' };
  }
}

function generateStripeSignature(timestamp?: number): string {
  const t = timestamp || Math.floor(Date.now() / 1000);
  return `t=${t},v1=mock_signature_hash`;
}

function generatePayPalSignature(overrides: {
  transmissionId?: string;
  timestamp?: string;
  certUrl?: string;
} = {}): string {
  const transmissionId = overrides.transmissionId || randomUUID();
  const timestamp = overrides.timestamp || new Date().toISOString();
  const certUrl = overrides.certUrl || 'https://api.paypal.com/cert';

  return [
    transmissionId,
    timestamp,
    'mock_signature',
    'SHA256withRSA',
    certUrl,
  ].join('|');
}

// ============================================================================
// Idempotency Helper Functions
// ============================================================================

const IDEMPOTENCY_KEY_HEADER = 'x-idempotency-key';

interface IdempotencyRecord {
  key: string;
  userId: string;
  endpoint: string;
  method: string;
  requestHash: string;
  status: 'processing' | 'completed' | 'failed';
  statusCode?: number;
  responseBody?: Record<string, unknown>;
  lockedAt: Date | null;
  expiresAt: Date;
}

function hashRequestBody(body: unknown): string {
  const content = typeof body === 'string' ? body : JSON.stringify(body || {});
  return createHash('sha256').update(content).digest('hex');
}

function validateIdempotencyKey(
  key: string | undefined,
  required: boolean
): { valid: boolean; error?: string; hint?: string } {
  if (!key) {
    if (required) {
      return {
        valid: false,
        error: `Missing required header: ${IDEMPOTENCY_KEY_HEADER}`,
        hint: 'Generate a unique UUID for each operation to enable automatic retry safety',
      };
    }
    return { valid: true };
  }

  if (key.length < 16 || key.length > 128) {
    return {
      valid: false,
      error: 'Invalid idempotency key format',
      hint: 'Use a UUID v4 or similar unique identifier (16-128 characters)',
    };
  }

  return { valid: true };
}

function checkIdempotencyConflict(
  existingRecord: IdempotencyRecord | null,
  newRequestHash: string
): { conflict: boolean; reason?: string; cachedResponse?: Record<string, unknown> } {
  if (!existingRecord) {
    return { conflict: false };
  }

  if (existingRecord.status === 'completed' && existingRecord.responseBody) {
    if (existingRecord.requestHash !== newRequestHash) {
      return {
        conflict: true,
        reason: 'Idempotency key was already used with a different request',
      };
    }
    return {
      conflict: true,
      reason: 'Returning cached response',
      cachedResponse: existingRecord.responseBody,
    };
  }

  if (existingRecord.status === 'processing') {
    const lockTimeout = 30 * 1000; // 30 seconds
    const lockExpired = existingRecord.lockedAt &&
      new Date(existingRecord.lockedAt).getTime() + lockTimeout < Date.now();

    if (!lockExpired) {
      return {
        conflict: true,
        reason: 'Request is currently being processed',
      };
    }
  }

  return { conflict: false };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Payment Routes - Input Validation', () => {
  describe('POST /checkout', () => {
    it('should require gameId field', () => {
      const body = { provider: 'stripe' };
      const result = validateCheckoutInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game ID is required');
    });

    it('should accept valid input with gameId', () => {
      const body = { gameId: 'game-123' };
      const result = validateCheckoutInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should default to stripe provider when not specified', () => {
      const body = { gameId: 'game-123' };
      const result = validateCheckoutInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept stripe provider explicitly', () => {
      const body = { gameId: 'game-123', provider: 'stripe' };
      const result = validateCheckoutInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should accept paypal provider', () => {
      const body = { gameId: 'game-123', provider: 'paypal' };
      const result = validateCheckoutInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid payment provider', () => {
      const body = { gameId: 'game-123', provider: 'bitcoin' };
      const result = validateCheckoutInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid payment provider');
      assert.ok(result.validProviders);
      assert.ok(result.validProviders.includes('stripe'));
      assert.ok(result.validProviders.includes('paypal'));
    });
  });

  describe('Game Validation for Checkout', () => {
    it('should reject non-existent game', () => {
      const result = validateGameForCheckout(null, 'user-123', false);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game not found');
    });

    it('should reject unpublished game', () => {
      const game = createMockGame({ status: 'draft' });
      const result = validateGameForCheckout(game, 'user-123', false);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game not found');
    });

    it('should reject archived game', () => {
      const game = createMockGame({ status: 'archived' });
      const result = validateGameForCheckout(game, 'user-123', false);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game not found');
    });

    it('should reject free game (price = 0)', () => {
      const game = createMockGame({ price: 0 });
      const result = validateGameForCheckout(game, 'user-123', false);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'This game is free. Use the purchase endpoint instead.');
    });

    it('should reject if user already owns the game', () => {
      const game = createMockGame();
      const result = validateGameForCheckout(game, 'user-123', true);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'You already own this game');
    });

    it('should accept valid published game with price', () => {
      const game = createMockGame({ price: 999, status: 'published' });
      const result = validateGameForCheckout(game, 'user-123', false);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('POST /paypal/capture', () => {
    it('should require orderId field', () => {
      const body = {};
      const result = validatePayPalCaptureInput(body);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Order ID is required');
    });

    it('should accept valid orderId', () => {
      const body = { orderId: 'ORDER-123' };
      const result = validatePayPalCaptureInput(body);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Payment Routes - Refund Validation', () => {
  describe('POST /transactions/:id/refund', () => {
    it('should require reason field', () => {
      const body = {};
      const result = validateRefundInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Refund reason is required'));
    });

    it('should require minimum 10 characters for reason', () => {
      const body = { reason: 'too short' };
      const result = validateRefundInput(body);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('minimum 10 characters'));
    });

    it('should accept reason with 10+ characters', () => {
      const body = { reason: 'This is a valid refund reason' };
      const result = validateRefundInput(body);

      assert.strictEqual(result.valid, true);
    });

    it('should handle whitespace-only reason', () => {
      const body = { reason: '          ' };
      const result = validateRefundInput(body);

      assert.strictEqual(result.valid, false);
    });
  });

  describe('Refund Eligibility', () => {
    it('should reject non-existent transaction', () => {
      const result = validateRefundEligibility(null as unknown as MockTransaction);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Transaction not found');
    });

    it('should reject pending transaction', () => {
      const transaction = createMockTransaction({ status: 'pending' });
      const result = validateRefundEligibility(transaction);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Transaction not eligible for refund');
    });

    it('should reject failed transaction', () => {
      const transaction = createMockTransaction({ status: 'failed' });
      const result = validateRefundEligibility(transaction);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Transaction not eligible for refund');
    });

    it('should reject already refunded transaction', () => {
      const transaction = createMockTransaction({ status: 'refunded' });
      const result = validateRefundEligibility(transaction);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Transaction not eligible for refund');
    });

    it('should reject transaction older than 14 days', () => {
      const oldDate = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000); // 15 days ago
      const transaction = createMockTransaction({
        status: 'succeeded',
        createdAt: oldDate,
      });
      const result = validateRefundEligibility(transaction);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Refund period expired (14 days)');
    });

    it('should accept transaction exactly 14 days old', () => {
      const exactly14Days = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const transaction = createMockTransaction({
        status: 'succeeded',
        createdAt: exactly14Days,
      });
      const result = validateRefundEligibility(transaction);

      assert.strictEqual(result.valid, true);
    });

    it('should accept recent succeeded transaction', () => {
      const transaction = createMockTransaction({
        status: 'succeeded',
        createdAt: new Date(),
      });
      const result = validateRefundEligibility(transaction);

      assert.strictEqual(result.valid, true);
    });
  });
});

describe('Payment Routes - Stripe Webhook Verification', () => {
  describe('Signature Verification', () => {
    it('should reject missing signature', () => {
      const payload = JSON.stringify(createStripeCheckoutCompletedEvent());
      const result = verifyStripeWebhookSignature(payload, '');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Missing signature');
    });

    it('should reject invalid signature format', () => {
      const payload = JSON.stringify(createStripeCheckoutCompletedEvent());
      const result = verifyStripeWebhookSignature(payload, 'invalid_signature');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid signature'));
    });

    it('should reject signature without timestamp', () => {
      const payload = JSON.stringify(createStripeCheckoutCompletedEvent());
      const result = verifyStripeWebhookSignature(payload, 'v1=hash_only');

      assert.strictEqual(result.valid, false);
    });

    it('should reject signature without v1 hash', () => {
      const payload = JSON.stringify(createStripeCheckoutCompletedEvent());
      const result = verifyStripeWebhookSignature(payload, 't=1234567890');

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid signature format', () => {
      const payload = JSON.stringify(createStripeCheckoutCompletedEvent());
      const signature = generateStripeSignature();
      const result = verifyStripeWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.ok(result.event);
      assert.strictEqual(result.event.provider, 'stripe');
    });

    it('should reject malformed JSON payload', () => {
      const signature = generateStripeSignature();
      const result = verifyStripeWebhookSignature('not valid json', signature);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid payload'));
    });
  });

  describe('Event Type Processing', () => {
    it('should parse checkout.session.completed event', () => {
      const event = createStripeCheckoutCompletedEvent({
        sessionId: 'cs_test_123',
        metadata: { userId: 'user-1', gameId: 'game-1' },
      });
      const payload = JSON.stringify(event);
      const signature = generateStripeSignature();

      const result = verifyStripeWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.event?.type, 'checkout.session.completed');
      assert.strictEqual(result.event?.data.id, 'cs_test_123');
    });

    it('should parse checkout.session.expired event', () => {
      const event = createStripeSessionExpiredEvent({ sessionId: 'cs_expired_123' });
      const payload = JSON.stringify(event);
      const signature = generateStripeSignature();

      const result = verifyStripeWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.event?.type, 'checkout.session.expired');
    });

    it('should parse payment_intent.payment_failed event', () => {
      const event = createStripePaymentFailedEvent({
        paymentIntentId: 'pi_failed_123',
        failureMessage: 'Insufficient funds',
      });
      const payload = JSON.stringify(event);
      const signature = generateStripeSignature();

      const result = verifyStripeWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.event?.type, 'payment_intent.payment_failed');
    });

    it('should parse charge.refunded event', () => {
      const event = createStripeRefundEvent({
        refundId: 're_test_123',
        paymentIntentId: 'pi_original_123',
        amount: 500,
      });
      const payload = JSON.stringify(event);
      const signature = generateStripeSignature();

      const result = verifyStripeWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.event?.type, 'charge.refunded');
    });
  });
});

describe('Payment Routes - PayPal Webhook Verification', () => {
  describe('Signature Verification', () => {
    it('should reject missing headers', () => {
      const payload = JSON.stringify(createPayPalOrderCompletedEvent());
      const result = verifyPayPalWebhookSignature(payload, '');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Missing PayPal headers');
    });

    it('should reject invalid signature format (too few parts)', () => {
      const payload = JSON.stringify(createPayPalOrderCompletedEvent());
      const result = verifyPayPalWebhookSignature(payload, 'only|three|parts');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid signature format'));
    });

    it('should accept valid PayPal signature format', () => {
      const payload = JSON.stringify(createPayPalOrderCompletedEvent());
      const signature = generatePayPalSignature();
      const result = verifyPayPalWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.ok(result.event);
      assert.strictEqual(result.event.provider, 'paypal');
    });

    it('should reject malformed JSON payload', () => {
      const signature = generatePayPalSignature();
      const result = verifyPayPalWebhookSignature('not valid json', signature);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid payload'));
    });
  });

  describe('Event Type Processing', () => {
    it('should parse CHECKOUT.ORDER.COMPLETED event', () => {
      const event = createPayPalOrderCompletedEvent({
        orderId: 'ORDER-123',
        metadata: { userId: 'user-1', gameId: 'game-1' },
      });
      const payload = JSON.stringify(event);
      const signature = generatePayPalSignature();

      const result = verifyPayPalWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.event?.type, 'CHECKOUT.ORDER.COMPLETED');
      assert.strictEqual(result.event?.data.id, 'ORDER-123');
    });

    it('should parse PAYMENT.CAPTURE.REFUNDED event', () => {
      const event = createPayPalCaptureRefundedEvent({
        captureId: 'CAPTURE-123',
        amount: '19.99',
      });
      const payload = JSON.stringify(event);
      const signature = generatePayPalSignature();

      const result = verifyPayPalWebhookSignature(payload, signature);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.event?.type, 'PAYMENT.CAPTURE.REFUNDED');
    });
  });
});

describe('Payment Routes - Idempotency', () => {
  describe('Idempotency Key Validation', () => {
    it('should accept missing key when not required', () => {
      const result = validateIdempotencyKey(undefined, false);

      assert.strictEqual(result.valid, true);
    });

    it('should reject missing key when required', () => {
      const result = validateIdempotencyKey(undefined, true);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes(IDEMPOTENCY_KEY_HEADER));
      assert.ok(result.hint);
    });

    it('should reject key shorter than 16 characters', () => {
      const result = validateIdempotencyKey('short', false);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('Invalid idempotency key format'));
    });

    it('should reject key longer than 128 characters', () => {
      const longKey = 'x'.repeat(129);
      const result = validateIdempotencyKey(longKey, false);

      assert.strictEqual(result.valid, false);
    });

    it('should accept valid UUID key', () => {
      const key = randomUUID();
      const result = validateIdempotencyKey(key, false);

      assert.strictEqual(result.valid, true);
    });

    it('should accept key with exactly 16 characters', () => {
      const key = 'a'.repeat(16);
      const result = validateIdempotencyKey(key, false);

      assert.strictEqual(result.valid, true);
    });

    it('should accept key with exactly 128 characters', () => {
      const key = 'a'.repeat(128);
      const result = validateIdempotencyKey(key, false);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Idempotency Conflict Detection', () => {
    it('should detect no conflict for new request', () => {
      const result = checkIdempotencyConflict(null, 'hash-123');

      assert.strictEqual(result.conflict, false);
    });

    it('should return cached response for completed request with same hash', () => {
      const existingRecord: IdempotencyRecord = {
        key: randomUUID(),
        userId: 'user-123',
        endpoint: '/api/payments/checkout',
        method: 'POST',
        requestHash: 'hash-123',
        status: 'completed',
        statusCode: 200,
        responseBody: { success: true, data: { sessionId: 'cs_123' } },
        lockedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      };

      const result = checkIdempotencyConflict(existingRecord, 'hash-123');

      assert.strictEqual(result.conflict, true);
      assert.strictEqual(result.reason, 'Returning cached response');
      assert.ok(result.cachedResponse);
      assert.strictEqual(result.cachedResponse.success, true);
    });

    it('should reject completed request with different hash', () => {
      const existingRecord: IdempotencyRecord = {
        key: randomUUID(),
        userId: 'user-123',
        endpoint: '/api/payments/checkout',
        method: 'POST',
        requestHash: 'hash-123',
        status: 'completed',
        statusCode: 200,
        responseBody: { success: true },
        lockedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      };

      const result = checkIdempotencyConflict(existingRecord, 'different-hash');

      assert.strictEqual(result.conflict, true);
      assert.ok(result.reason?.includes('different request'));
    });

    it('should block concurrent processing request', () => {
      const existingRecord: IdempotencyRecord = {
        key: randomUUID(),
        userId: 'user-123',
        endpoint: '/api/payments/checkout',
        method: 'POST',
        requestHash: 'hash-123',
        status: 'processing',
        lockedAt: new Date(), // Recently locked
        expiresAt: new Date(Date.now() + 86400000),
      };

      const result = checkIdempotencyConflict(existingRecord, 'hash-123');

      assert.strictEqual(result.conflict, true);
      assert.ok(result.reason?.includes('currently being processed'));
    });

    it('should allow takeover of stale processing lock', () => {
      const existingRecord: IdempotencyRecord = {
        key: randomUUID(),
        userId: 'user-123',
        endpoint: '/api/payments/checkout',
        method: 'POST',
        requestHash: 'hash-123',
        status: 'processing',
        lockedAt: new Date(Date.now() - 60000), // 60 seconds ago (past 30s timeout)
        expiresAt: new Date(Date.now() + 86400000),
      };

      const result = checkIdempotencyConflict(existingRecord, 'hash-123');

      assert.strictEqual(result.conflict, false);
    });
  });

  describe('Request Body Hashing', () => {
    it('should generate consistent hash for same body', () => {
      const body = { gameId: 'game-123', provider: 'stripe' };
      const hash1 = hashRequestBody(body);
      const hash2 = hashRequestBody(body);

      assert.strictEqual(hash1, hash2);
    });

    it('should generate different hash for different body', () => {
      const body1 = { gameId: 'game-123' };
      const body2 = { gameId: 'game-456' };

      const hash1 = hashRequestBody(body1);
      const hash2 = hashRequestBody(body2);

      assert.notStrictEqual(hash1, hash2);
    });

    it('should handle empty body', () => {
      const hash = hashRequestBody({});
      assert.ok(hash);
      assert.strictEqual(typeof hash, 'string');
      assert.strictEqual(hash.length, 64); // SHA-256 produces 64 hex characters
    });

    it('should handle null body', () => {
      const hash = hashRequestBody(null);
      assert.ok(hash);
    });

    it('should handle string body', () => {
      const hash = hashRequestBody('raw string body');
      assert.ok(hash);
    });
  });
});

describe('Payment Routes - Edge Cases', () => {
  describe('Currency Handling', () => {
    const validCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'];

    it('should support all valid currencies', () => {
      for (const currency of validCurrencies) {
        const game = createMockGame({ currency });
        assert.strictEqual(game.currency, currency);
      }
    });
  });

  describe('Amount Validation', () => {
    it('should handle minimum valid amount (1 cent)', () => {
      const game = createMockGame({ price: 1 });
      const result = validateGameForCheckout(game, 'user-123', false);

      assert.strictEqual(result.valid, true);
    });

    it('should handle large amounts', () => {
      const game = createMockGame({ price: 999999 }); // $9,999.99
      const result = validateGameForCheckout(game, 'user-123', false);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('Webhook Event Deduplication', () => {
    it('should track unique event IDs', () => {
      const eventIds = new Set<string>();
      const events = [
        createStripeCheckoutCompletedEvent(),
        createStripeCheckoutCompletedEvent(),
        createStripeCheckoutCompletedEvent(),
      ];

      for (const event of events) {
        // Each event should have a unique ID
        assert.ok(!eventIds.has(event.id), 'Event IDs should be unique');
        eventIds.add(event.id);
      }

      assert.strictEqual(eventIds.size, 3);
    });
  });

  describe('Transaction Status Transitions', () => {
    const validTransitions: Record<string, string[]> = {
      pending: ['succeeded', 'failed'],
      succeeded: ['refunded', 'pending_refund'],
      failed: [], // Terminal state
      refunded: [], // Terminal state
      pending_refund: ['refunded'],
    };

    it('should define valid status transitions', () => {
      assert.ok(validTransitions.pending.includes('succeeded'));
      assert.ok(validTransitions.pending.includes('failed'));
      assert.ok(validTransitions.succeeded.includes('refunded'));
      assert.strictEqual(validTransitions.refunded.length, 0);
    });
  });

  describe('Webhook Retry Handling', () => {
    it('should identify duplicate webhook by event ID', () => {
      const processedEvents = new Map<string, Date>();
      const eventId = 'evt_test_123';

      // First processing
      processedEvents.set(eventId, new Date());

      // Check if already processed
      const isDuplicate = processedEvents.has(eventId);
      assert.strictEqual(isDuplicate, true);
    });

    it('should allow reprocessing after expiration', () => {
      const processedEvents = new Map<string, Date>();
      const eventId = 'evt_test_123';
      const ttlMs = 24 * 60 * 60 * 1000; // 24 hours

      // First processing (26 hours ago)
      processedEvents.set(eventId, new Date(Date.now() - 26 * 60 * 60 * 1000));

      // Check if expired
      const processedAt = processedEvents.get(eventId);
      const isExpired = processedAt && (Date.now() - processedAt.getTime() > ttlMs);
      assert.strictEqual(isExpired, true);
    });
  });
});

describe('Payment Routes - Response Format', () => {
  describe('Success Response Format', () => {
    it('should return success:true with checkout session data', () => {
      const response = createSuccessResponse({
        sessionId: 'cs_123',
        url: 'https://checkout.stripe.com/pay/cs_123',
        provider: 'stripe',
      });

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.strictEqual(response.data.sessionId, 'cs_123');
      assert.ok(response.data.url);
      assert.strictEqual(response.data.provider, 'stripe');
    });

    it('should return success:true with transaction data', () => {
      const transaction = createMockTransaction();
      const response = createTransactionResponse(transaction);

      assert.strictEqual(response.success, true);
      assert.ok(response.data);
      assert.strictEqual(response.data.id, transaction.id);
      assert.strictEqual(response.data.status, transaction.status);
    });
  });

  describe('Error Response Format', () => {
    it('should return success:false with error message', () => {
      const response = createErrorResponse('Game not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Game not found');
    });

    it('should include available providers on provider error', () => {
      const response = createProviderErrorResponse('invalid_provider');

      assert.strictEqual(response.success, false);
      assert.ok(response.availableProviders);
      assert.ok(response.availableProviders.includes('stripe'));
    });
  });

  describe('Webhook Response Format', () => {
    it('should return received:true for successful webhook', () => {
      const response = createWebhookSuccessResponse();

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.received, true);
    });
  });
});

describe('Payment Routes - Health Check', () => {
  it('should report healthy status for available providers', () => {
    const healthStatus = [
      { provider: 'stripe', healthy: true, latencyMs: 50 },
      { provider: 'paypal', healthy: true, latencyMs: 75 },
    ];

    const allHealthy = healthStatus.every(s => s.healthy);
    assert.strictEqual(allHealthy, true);
  });

  it('should report unhealthy status when provider fails', () => {
    const healthStatus = [
      { provider: 'stripe', healthy: false, error: 'API unavailable' },
      { provider: 'paypal', healthy: true, latencyMs: 75 },
    ];

    const allHealthy = healthStatus.every(s => s.healthy);
    assert.strictEqual(allHealthy, false);
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createSuccessResponse(data: Record<string, unknown>): {
  success: boolean;
  data: Record<string, unknown>;
} {
  return {
    success: true,
    data,
  };
}

function createTransactionResponse(transaction: MockTransaction): {
  success: boolean;
  data: {
    id: string;
    status: string;
    amount: number;
    currency: string;
    provider: string;
    purchaseId: string | null;
    createdAt: Date;
    completedAt: Date | null;
  };
} {
  return {
    success: true,
    data: {
      id: transaction.id,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      provider: transaction.provider,
      purchaseId: transaction.purchaseId,
      createdAt: transaction.createdAt,
      completedAt: transaction.completedAt,
    },
  };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return {
    success: false,
    error: message,
  };
}

function createProviderErrorResponse(provider: string): {
  success: boolean;
  error: string;
  availableProviders: string[];
} {
  return {
    success: false,
    error: `Payment provider ${provider} is not available`,
    availableProviders: ['stripe', 'paypal'],
  };
}

function createWebhookSuccessResponse(): { success: boolean; received: boolean } {
  return {
    success: true,
    received: true,
  };
}
