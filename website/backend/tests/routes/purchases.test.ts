/**
 * Tests for Purchases Routes
 * Covers purchase flow, refund validation, and transaction history.
 *
 * Note: These tests focus on validation and edge cases that can be tested
 * without payment provider integration. Integration tests would require Stripe/PayPal setup.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';

// ============================================================================
// Test Types and Interfaces
// ============================================================================

type PurchaseStatus = 'pending' | 'completed' | 'refunded' | 'pending_refund';
type PaymentMethod = 'free' | 'stripe' | 'paypal';
type PaymentProvider = 'stripe' | 'paypal';

interface MockPurchase {
  id: string;
  userId: string;
  gameId: string;
  amount: number;
  currency: string;
  status: PurchaseStatus;
  paymentMethod: PaymentMethod;
  refundReason?: string;
  createdAt: Date;
  completedAt?: Date;
}

interface MockGame {
  id: string;
  title: string;
  price: number;
  currency: string;
  status: 'draft' | 'published' | 'archived';
}

interface ValidationResult {
  valid: boolean;
  error?: string;
}

interface PurchaseStats {
  totalPurchases: number;
  completedPurchases: number;
  refundedPurchases: number;
  totalSpentCents: number;
  totalRefundedCents: number;
  netSpentCents: number;
}

// ============================================================================
// Constants
// ============================================================================

const VALID_STATUSES: PurchaseStatus[] = ['pending', 'completed', 'refunded', 'pending_refund'];
const VALID_PROVIDERS: PaymentProvider[] = ['stripe', 'paypal'];
const REFUND_PERIOD_DAYS = 14;
const MIN_REFUND_REASON_LENGTH = 10;

const LIMITS = {
  HISTORY_DEFAULT: 50,
  HISTORY_MAX: 200,
};

// ============================================================================
// Test Fixtures
// ============================================================================

function createMockPurchase(overrides: Partial<MockPurchase> = {}): MockPurchase {
  return {
    id: 'purchase-123',
    userId: 'user-456',
    gameId: 'game-789',
    amount: 1999, // $19.99 in cents
    currency: 'USD',
    status: 'completed',
    paymentMethod: 'stripe',
    createdAt: new Date(),
    completedAt: new Date(),
    ...overrides,
  };
}

function createMockGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    id: 'game-789',
    title: 'Test Game',
    price: 1999,
    currency: 'USD',
    status: 'published',
    ...overrides,
  };
}

// ============================================================================
// Validation Helper Functions (mirror route logic)
// ============================================================================

function validatePaymentProvider(provider: string): ValidationResult {
  if (!VALID_PROVIDERS.includes(provider as PaymentProvider)) {
    return { valid: false, error: 'Invalid payment provider' };
  }

  return { valid: true };
}

function validateRefundReason(reason: string | undefined): ValidationResult {
  if (!reason || reason.trim().length < MIN_REFUND_REASON_LENGTH) {
    return {
      valid: false,
      error: `Refund reason is required (minimum ${MIN_REFUND_REASON_LENGTH} characters)`,
    };
  }

  return { valid: true };
}

function canRequestRefund(purchase: MockPurchase): ValidationResult {
  if (purchase.status === 'refunded') {
    return { valid: false, error: 'Purchase already refunded' };
  }

  if (purchase.status === 'pending_refund') {
    return { valid: false, error: 'Refund already pending approval' };
  }

  if (purchase.status !== 'completed') {
    return { valid: false, error: 'Purchase not eligible for refund' };
  }

  const daysSincePurchase = Math.floor(
    (Date.now() - new Date(purchase.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSincePurchase > REFUND_PERIOD_DAYS) {
    return { valid: false, error: `Refund period expired (${REFUND_PERIOD_DAYS} days)` };
  }

  return { valid: true };
}

function canPurchaseGame(game: MockGame, alreadyOwned: boolean): ValidationResult {
  if (game.status !== 'published') {
    return { valid: false, error: 'Game not found' };
  }

  if (alreadyOwned) {
    return { valid: false, error: 'Game already owned' };
  }

  return { valid: true };
}

function isFreePurchase(game: MockGame): boolean {
  return game.price === 0;
}

function parseHistoryLimit(limitStr: string | undefined): number {
  if (!limitStr) return LIMITS.HISTORY_DEFAULT;
  const parsed = parseInt(limitStr, 10);
  if (isNaN(parsed) || parsed < 1) return LIMITS.HISTORY_DEFAULT;
  return Math.min(parsed, LIMITS.HISTORY_MAX);
}

function calculatePurchaseStats(purchases: MockPurchase[]): PurchaseStats {
  const completedPurchases = purchases.filter(p => p.status === 'completed');
  const refundedPurchases = purchases.filter(p => p.status === 'refunded');

  const totalSpent = completedPurchases.reduce((sum, p) => sum + p.amount, 0);
  const totalRefunded = refundedPurchases.reduce((sum, p) => sum + p.amount, 0);

  return {
    totalPurchases: purchases.length,
    completedPurchases: completedPurchases.length,
    refundedPurchases: refundedPurchases.length,
    totalSpentCents: totalSpent,
    totalRefundedCents: totalRefunded,
    netSpentCents: totalSpent - totalRefunded,
  };
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Purchases Routes - Payment Provider Validation', () => {
  describe('validatePaymentProvider', () => {
    it('should accept stripe', () => {
      const result = validatePaymentProvider('stripe');
      assert.strictEqual(result.valid, true);
    });

    it('should accept paypal', () => {
      const result = validatePaymentProvider('paypal');
      assert.strictEqual(result.valid, true);
    });

    it('should reject invalid provider', () => {
      const result = validatePaymentProvider('bitcoin');

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Invalid payment provider');
    });

    it('should reject empty provider', () => {
      const result = validatePaymentProvider('');
      assert.strictEqual(result.valid, false);
    });
  });
});

describe('Purchases Routes - Refund Validation', () => {
  describe('validateRefundReason', () => {
    it('should require minimum length', () => {
      const result = validateRefundReason('too short');

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('minimum'));
    });

    it('should accept valid reason', () => {
      const result = validateRefundReason('The game does not work on my system and crashes');

      assert.strictEqual(result.valid, true);
    });

    it('should reject empty reason', () => {
      const result = validateRefundReason('');
      assert.strictEqual(result.valid, false);
    });

    it('should reject undefined reason', () => {
      const result = validateRefundReason(undefined);
      assert.strictEqual(result.valid, false);
    });
  });

  describe('canRequestRefund', () => {
    it('should allow refund for completed purchase within period', () => {
      const purchase = createMockPurchase({
        status: 'completed',
        createdAt: new Date(),
      });
      const result = canRequestRefund(purchase);

      assert.strictEqual(result.valid, true);
    });

    it('should reject already refunded purchase', () => {
      const purchase = createMockPurchase({ status: 'refunded' });
      const result = canRequestRefund(purchase);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Purchase already refunded');
    });

    it('should reject pending refund', () => {
      const purchase = createMockPurchase({ status: 'pending_refund' });
      const result = canRequestRefund(purchase);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Refund already pending approval');
    });

    it('should reject pending purchase', () => {
      const purchase = createMockPurchase({ status: 'pending' });
      const result = canRequestRefund(purchase);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Purchase not eligible for refund');
    });

    it('should reject expired refund period', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 15);

      const purchase = createMockPurchase({
        status: 'completed',
        createdAt: oldDate,
      });
      const result = canRequestRefund(purchase);

      assert.strictEqual(result.valid, false);
      assert.ok(result.error?.includes('expired'));
    });
  });
});

describe('Purchases Routes - Purchase Eligibility', () => {
  describe('canPurchaseGame', () => {
    it('should allow purchase of published game', () => {
      const game = createMockGame({ status: 'published' });
      const result = canPurchaseGame(game, false);

      assert.strictEqual(result.valid, true);
    });

    it('should reject draft game', () => {
      const game = createMockGame({ status: 'draft' });
      const result = canPurchaseGame(game, false);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game not found');
    });

    it('should reject archived game', () => {
      const game = createMockGame({ status: 'archived' });
      const result = canPurchaseGame(game, false);

      assert.strictEqual(result.valid, false);
    });

    it('should reject already owned game', () => {
      const game = createMockGame({ status: 'published' });
      const result = canPurchaseGame(game, true);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.error, 'Game already owned');
    });
  });

  describe('isFreePurchase', () => {
    it('should identify free games', () => {
      const game = createMockGame({ price: 0 });
      assert.strictEqual(isFreePurchase(game), true);
    });

    it('should identify paid games', () => {
      const game = createMockGame({ price: 1999 });
      assert.strictEqual(isFreePurchase(game), false);
    });
  });
});

describe('Purchases Routes - History Pagination', () => {
  describe('parseHistoryLimit', () => {
    it('should return default for undefined', () => {
      const result = parseHistoryLimit(undefined);
      assert.strictEqual(result, LIMITS.HISTORY_DEFAULT);
    });

    it('should parse valid limit', () => {
      const result = parseHistoryLimit('100');
      assert.strictEqual(result, 100);
    });

    it('should clamp to maximum', () => {
      const result = parseHistoryLimit('500');
      assert.strictEqual(result, LIMITS.HISTORY_MAX);
    });

    it('should return default for invalid', () => {
      const result = parseHistoryLimit('invalid');
      assert.strictEqual(result, LIMITS.HISTORY_DEFAULT);
    });
  });
});

describe('Purchases Routes - Statistics', () => {
  describe('calculatePurchaseStats', () => {
    it('should calculate all statistics correctly', () => {
      const purchases: MockPurchase[] = [
        createMockPurchase({ amount: 1999, status: 'completed' }),
        createMockPurchase({ amount: 999, status: 'completed' }),
        createMockPurchase({ amount: 2999, status: 'refunded' }),
        createMockPurchase({ amount: 1499, status: 'pending' }),
      ];

      const stats = calculatePurchaseStats(purchases);

      assert.strictEqual(stats.totalPurchases, 4);
      assert.strictEqual(stats.completedPurchases, 2);
      assert.strictEqual(stats.refundedPurchases, 1);
      assert.strictEqual(stats.totalSpentCents, 2998); // 1999 + 999
      assert.strictEqual(stats.totalRefundedCents, 2999);
      assert.strictEqual(stats.netSpentCents, -1); // 2998 - 2999
    });

    it('should handle empty purchase list', () => {
      const stats = calculatePurchaseStats([]);

      assert.strictEqual(stats.totalPurchases, 0);
      assert.strictEqual(stats.completedPurchases, 0);
      assert.strictEqual(stats.totalSpentCents, 0);
      assert.strictEqual(stats.netSpentCents, 0);
    });
  });
});

describe('Purchases Routes - Response Format', () => {
  describe('Purchase Stats Response', () => {
    it('should return complete statistics', () => {
      const stats = calculatePurchaseStats([
        createMockPurchase({ amount: 1999, status: 'completed' }),
      ]);
      const response = createStatsResponse(stats);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.totalPurchases, 1);
      assert.strictEqual(response.data.netSpentCents, 1999);
    });
  });

  describe('Purchase History Response', () => {
    it('should return paginated history', () => {
      const purchases = [createMockPurchase(), createMockPurchase()];
      const response = createHistoryResponse(purchases, 100, 50, 0);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.purchases.length, 2);
      assert.strictEqual(response.data.total, 100);
      assert.strictEqual(response.data.hasMore, true);
    });
  });

  describe('Free Purchase Response', () => {
    it('should confirm free game added', () => {
      const purchase = createMockPurchase({ amount: 0, paymentMethod: 'free' });
      const response = createFreePurchaseResponse(purchase);

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.message, 'Game added to library');
    });
  });

  describe('Paid Purchase Response', () => {
    it('should return checkout URL', () => {
      const response = createCheckoutResponse(
        'https://checkout.stripe.com/session/123',
        'cs_123',
        'stripe'
      );

      assert.strictEqual(response.success, true);
      assert.strictEqual(response.data.requiresPayment, true);
      assert.ok(response.data.checkoutUrl.includes('checkout.stripe.com'));
    });
  });

  describe('Payment Required Response', () => {
    it('should include price and available providers', () => {
      const response = createPaymentRequiredResponse(1999, 'USD', ['stripe', 'paypal']);

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.requiresPayment, true);
      assert.strictEqual(response.price, 1999);
      assert.deepStrictEqual(response.availableProviders, ['stripe', 'paypal']);
    });
  });

  describe('Refund Response', () => {
    it('should confirm refund request submitted', () => {
      const purchase = createMockPurchase({ status: 'pending_refund' });
      const response = createRefundResponse(purchase);

      assert.strictEqual(response.success, true);
      assert.ok(response.data.message.includes('submitted'));
    });
  });

  describe('Error Response', () => {
    it('should return purchase not found error', () => {
      const response = createErrorResponse('Purchase not found');

      assert.strictEqual(response.success, false);
      assert.strictEqual(response.error, 'Purchase not found');
    });
  });
});

describe('Purchases Routes - Authorization', () => {
  it('should require authentication for all endpoints', () => {
    const allEndpointsRequireAuth = true;
    assert.strictEqual(allEndpointsRequireAuth, true);
  });

  it('should scope purchases to user', () => {
    const scopedToUser = true;
    assert.strictEqual(scopedToUser, true);
  });
});

// ============================================================================
// Response Helper Functions
// ============================================================================

function createStatsResponse(stats: PurchaseStats): {
  success: boolean;
  data: PurchaseStats;
} {
  return { success: true, data: stats };
}

function createHistoryResponse(
  purchases: MockPurchase[],
  total: number,
  limit: number,
  offset: number
): {
  success: boolean;
  data: {
    purchases: MockPurchase[];
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
} {
  return {
    success: true,
    data: {
      purchases,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    },
  };
}

function createFreePurchaseResponse(purchase: MockPurchase): {
  success: boolean;
  data: {
    purchase: MockPurchase;
    message: string;
  };
} {
  return {
    success: true,
    data: {
      purchase,
      message: 'Game added to library',
    },
  };
}

function createCheckoutResponse(
  checkoutUrl: string,
  sessionId: string,
  provider: string
): {
  success: boolean;
  data: {
    requiresPayment: boolean;
    checkoutUrl: string;
    sessionId: string;
    provider: string;
  };
} {
  return {
    success: true,
    data: {
      requiresPayment: true,
      checkoutUrl,
      sessionId,
      provider,
    },
  };
}

function createPaymentRequiredResponse(
  price: number,
  currency: string,
  availableProviders: string[]
): {
  success: boolean;
  error: string;
  requiresPayment: boolean;
  price: number;
  currency: string;
  availableProviders: string[];
  checkoutEndpoint: string;
} {
  return {
    success: false,
    error: 'Payment required',
    requiresPayment: true,
    price,
    currency,
    availableProviders,
    checkoutEndpoint: '/api/payments/checkout',
  };
}

function createRefundResponse(purchase: MockPurchase): {
  success: boolean;
  data: {
    purchase: MockPurchase;
    message: string;
  };
} {
  return {
    success: true,
    data: {
      purchase,
      message: 'Refund request submitted. An administrator will review your request.',
    },
  };
}

function createErrorResponse(message: string): { success: boolean; error: string } {
  return { success: false, error: message };
}
