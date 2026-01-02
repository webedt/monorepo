/**
 * Payment Query Helpers
 *
 * Composable query utilities for payment transactions and webhooks.
 * Reduces duplication in payment routes.
 */

import { eq, and, desc, sql, inArray, gte, lte } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  db,
  paymentTransactions,
  paymentWebhooks,
  purchases,
  games,
  userLibrary,
} from '../index.js';
import type {
  PaymentTransaction,
  PaymentWebhook,
  Purchase,
  Game,
} from '../schema.js';
import {
  getPaginationParams,
  buildPaginationMeta,
  combineConditions,
  buildTimeRangeConditions,
  type PaginationOptions,
  type PaginatedResult,
} from '../queryHelpers.js';

// Import existing types to avoid duplication
import type { PaymentProvider } from '../../payment/types.js';

// Re-export for convenience
export type { PaymentProvider };

// =============================================================================
// TYPES
// =============================================================================

/**
 * Payment transaction status values
 */
export type TransactionStatus =
  | 'pending'
  | 'requires_action'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'refunded'
  | 'pending_refund';

/**
 * Transaction with related game info
 */
export interface TransactionWithGame extends PaymentTransaction {
  game?: Game | null;
}

/**
 * Transaction filter options
 */
export interface TransactionFilterOptions {
  /** Filter by user ID */
  userId?: string;
  /** Filter by status */
  status?: TransactionStatus | TransactionStatus[];
  /** Filter by provider */
  provider?: PaymentProvider;
  /** Filter by time range */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
  /** Filter by transaction type */
  type?: 'checkout' | 'payment_intent' | 'refund';
}

/**
 * Webhook filter options
 */
export interface WebhookFilterOptions {
  /** Filter by provider */
  provider?: PaymentProvider;
  /** Filter by event type */
  eventType?: string;
  /** Filter by processed status */
  processed?: boolean;
  /** Filter by time range */
  timeRange?: {
    start?: Date;
    end?: Date;
  };
}

// =============================================================================
// CONDITION BUILDERS
// =============================================================================

/**
 * Build WHERE conditions for transaction queries
 */
export function buildTransactionConditions(
  options: TransactionFilterOptions
): SQL | undefined {
  const conditions: SQL[] = [];

  if (options.userId) {
    conditions.push(eq(paymentTransactions.userId, options.userId));
  }

  if (options.status) {
    if (Array.isArray(options.status)) {
      conditions.push(inArray(paymentTransactions.status, options.status));
    } else {
      conditions.push(eq(paymentTransactions.status, options.status));
    }
  }

  if (options.provider) {
    conditions.push(eq(paymentTransactions.provider, options.provider));
  }

  if (options.type) {
    conditions.push(eq(paymentTransactions.type, options.type));
  }

  if (options.timeRange) {
    const timeConditions = buildTimeRangeConditions(
      paymentTransactions.createdAt,
      options.timeRange
    );
    conditions.push(...timeConditions);
  }

  return combineConditions(...conditions);
}

/**
 * Build WHERE conditions for webhook queries
 */
export function buildWebhookConditions(
  options: WebhookFilterOptions
): SQL | undefined {
  const conditions: SQL[] = [];

  if (options.provider) {
    conditions.push(eq(paymentWebhooks.provider, options.provider));
  }

  if (options.eventType) {
    conditions.push(eq(paymentWebhooks.eventType, options.eventType));
  }

  if (options.processed !== undefined) {
    conditions.push(eq(paymentWebhooks.processed, options.processed));
  }

  if (options.timeRange) {
    const timeConditions = buildTimeRangeConditions(
      paymentWebhooks.createdAt,
      options.timeRange
    );
    conditions.push(...timeConditions);
  }

  return combineConditions(...conditions);
}

// =============================================================================
// SINGLE RECORD QUERIES
// =============================================================================

/**
 * Find a transaction by ID
 */
export async function findTransactionById(
  id: string
): Promise<PaymentTransaction | null> {
  const [transaction] = await db
    .select()
    .from(paymentTransactions)
    .where(eq(paymentTransactions.id, id))
    .limit(1);

  return transaction ?? null;
}

/**
 * Find a transaction by ID with ownership check
 */
export async function findUserTransaction(
  id: string,
  userId: string
): Promise<PaymentTransaction | null> {
  const [transaction] = await db
    .select()
    .from(paymentTransactions)
    .where(
      and(
        eq(paymentTransactions.id, id),
        eq(paymentTransactions.userId, userId)
      )
    )
    .limit(1);

  return transaction ?? null;
}

/**
 * Find a transaction by provider session ID
 */
export async function findTransactionBySessionId(
  sessionId: string,
  userId?: string
): Promise<PaymentTransaction | null> {
  const conditions: SQL[] = [eq(paymentTransactions.providerSessionId, sessionId)];

  if (userId) {
    conditions.push(eq(paymentTransactions.userId, userId));
  }

  const [transaction] = await db
    .select()
    .from(paymentTransactions)
    .where(and(...conditions))
    .limit(1);

  return transaction ?? null;
}

/**
 * Find a transaction by provider transaction ID (e.g., PayPal order ID)
 */
export async function findTransactionByProviderId(
  providerTransactionId: string,
  options?: { userId?: string; provider?: PaymentProvider }
): Promise<PaymentTransaction | null> {
  const conditions: SQL[] = [
    eq(paymentTransactions.providerTransactionId, providerTransactionId),
  ];

  if (options?.userId) {
    conditions.push(eq(paymentTransactions.userId, options.userId));
  }

  if (options?.provider) {
    conditions.push(eq(paymentTransactions.provider, options.provider));
  }

  const [transaction] = await db
    .select()
    .from(paymentTransactions)
    .where(and(...conditions))
    .limit(1);

  return transaction ?? null;
}

/**
 * Find a webhook by event ID (for deduplication)
 */
export async function findWebhookByEventId(
  provider: PaymentProvider,
  eventId: string
): Promise<PaymentWebhook | null> {
  const [webhook] = await db
    .select()
    .from(paymentWebhooks)
    .where(
      and(
        eq(paymentWebhooks.provider, provider),
        eq(paymentWebhooks.eventId, eventId)
      )
    )
    .limit(1);

  return webhook ?? null;
}

// =============================================================================
// LIST QUERIES
// =============================================================================

/**
 * List transactions with filtering and pagination
 */
export async function listTransactions(
  options: TransactionFilterOptions & { pagination?: PaginationOptions }
): Promise<PaginatedResult<PaymentTransaction>> {
  const { pagination, ...filterOptions } = options;
  const { limit, offset } = getPaginationParams(pagination);

  const conditions = buildTransactionConditions(filterOptions);

  const data = await db
    .select()
    .from(paymentTransactions)
    .where(conditions)
    .orderBy(desc(paymentTransactions.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentTransactions)
    .where(conditions);

  const total = countResult?.count ?? 0;

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

/**
 * List transactions for a user (most common use case)
 */
export async function listUserTransactions(
  userId: string,
  options?: Omit<TransactionFilterOptions, 'userId'> & { pagination?: PaginationOptions }
): Promise<PaginatedResult<PaymentTransaction>> {
  return listTransactions({ ...options, userId });
}

/**
 * List unprocessed webhooks (for retry/monitoring)
 */
export async function listUnprocessedWebhooks(
  options?: { provider?: PaymentProvider; limit?: number }
): Promise<PaymentWebhook[]> {
  const conditions: SQL[] = [eq(paymentWebhooks.processed, false)];

  if (options?.provider) {
    conditions.push(eq(paymentWebhooks.provider, options.provider));
  }

  return db
    .select()
    .from(paymentWebhooks)
    .where(and(...conditions))
    .orderBy(desc(paymentWebhooks.createdAt))
    .limit(options?.limit ?? 100);
}

// =============================================================================
// COUNT QUERIES
// =============================================================================

/**
 * Count transactions for a user
 */
export async function countUserTransactions(
  userId: string,
  options?: Omit<TransactionFilterOptions, 'userId'>
): Promise<number> {
  const conditions = buildTransactionConditions({ ...options, userId });

  const [result] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(paymentTransactions)
    .where(conditions);

  return result?.count ?? 0;
}

/**
 * Count transactions by status for analytics
 */
export async function countTransactionsByStatus(
  options?: { userId?: string; provider?: PaymentProvider }
): Promise<Record<string, number>> {
  const conditions: SQL[] = [];

  if (options?.userId) {
    conditions.push(eq(paymentTransactions.userId, options.userId));
  }

  if (options?.provider) {
    conditions.push(eq(paymentTransactions.provider, options.provider));
  }

  const results = await db
    .select({
      status: paymentTransactions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(paymentTransactions)
    .where(combineConditions(...conditions))
    .groupBy(paymentTransactions.status);

  return Object.fromEntries(results.map(r => [r.status, r.count]));
}

// =============================================================================
// OWNERSHIP & VALIDATION
// =============================================================================

/**
 * Check if a user owns a game (via library)
 */
export async function userOwnsGame(
  userId: string,
  gameId: string
): Promise<boolean> {
  const [item] = await db
    .select({ id: userLibrary.id })
    .from(userLibrary)
    .where(
      and(
        eq(userLibrary.userId, userId),
        eq(userLibrary.gameId, gameId)
      )
    )
    .limit(1);

  return !!item;
}

/**
 * Check if a game exists and is published
 */
export async function findPublishedGame(gameId: string): Promise<Game | null> {
  const [game] = await db
    .select()
    .from(games)
    .where(
      and(
        eq(games.id, gameId),
        eq(games.status, 'published')
      )
    )
    .limit(1);

  return game ?? null;
}

/**
 * Check if a transaction is eligible for refund
 */
export async function isRefundEligible(
  transactionId: string,
  userId: string,
  refundWindowDays: number = 14
): Promise<{
  eligible: boolean;
  reason?: 'not_found' | 'not_succeeded' | 'expired' | 'already_refunding';
  transaction?: PaymentTransaction;
}> {
  const transaction = await findUserTransaction(transactionId, userId);

  if (!transaction) {
    return { eligible: false, reason: 'not_found' };
  }

  if (transaction.status === 'pending_refund' || transaction.status === 'refunded') {
    return { eligible: false, reason: 'already_refunding', transaction };
  }

  if (transaction.status !== 'succeeded') {
    return { eligible: false, reason: 'not_succeeded', transaction };
  }

  const daysSincePayment = Math.floor(
    (Date.now() - new Date(transaction.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  if (daysSincePayment > refundWindowDays) {
    return { eligible: false, reason: 'expired', transaction };
  }

  return { eligible: true, transaction };
}

// =============================================================================
// PURCHASE HELPERS
// =============================================================================

/**
 * Find a purchase by ID
 */
export async function findPurchaseById(id: string): Promise<Purchase | null> {
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(eq(purchases.id, id))
    .limit(1);

  return purchase ?? null;
}

/**
 * Find a user's purchase for a game
 */
export async function findUserPurchase(
  userId: string,
  gameId: string
): Promise<Purchase | null> {
  const [purchase] = await db
    .select()
    .from(purchases)
    .where(
      and(
        eq(purchases.userId, userId),
        eq(purchases.gameId, gameId),
        eq(purchases.status, 'completed')
      )
    )
    .limit(1);

  return purchase ?? null;
}

/**
 * List purchases for a user
 */
export async function listUserPurchases(
  userId: string,
  options?: { pagination?: PaginationOptions; status?: string }
): Promise<PaginatedResult<Purchase>> {
  const { pagination, status } = options ?? {};
  const { limit, offset } = getPaginationParams(pagination);

  const conditions: SQL[] = [eq(purchases.userId, userId)];

  if (status) {
    conditions.push(eq(purchases.status, status));
  }

  const whereClause = and(...conditions);

  const data = await db
    .select()
    .from(purchases)
    .where(whereClause)
    .orderBy(desc(purchases.createdAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(purchases)
    .where(whereClause);

  const total = countResult?.count ?? 0;

  return {
    data,
    meta: buildPaginationMeta(total, pagination),
  };
}

// =============================================================================
// ANALYTICS HELPERS
// =============================================================================

/**
 * Get revenue statistics for a time period
 */
export async function getRevenueStats(options?: {
  startDate?: Date;
  endDate?: Date;
  provider?: PaymentProvider;
}): Promise<{
  totalRevenue: number;
  transactionCount: number;
  averageTransactionValue: number;
  refundTotal: number;
}> {
  const conditions: SQL[] = [eq(paymentTransactions.status, 'succeeded')];

  if (options?.provider) {
    conditions.push(eq(paymentTransactions.provider, options.provider));
  }

  if (options?.startDate || options?.endDate) {
    const timeConditions = buildTimeRangeConditions(
      paymentTransactions.completedAt,
      { start: options?.startDate, end: options?.endDate }
    );
    conditions.push(...timeConditions);
  }

  const [stats] = await db
    .select({
      totalRevenue: sql<number>`COALESCE(SUM(${paymentTransactions.amount}), 0)::int`,
      transactionCount: sql<number>`count(*)::int`,
    })
    .from(paymentTransactions)
    .where(and(...conditions));

  // Get refund total separately
  const refundConditions: SQL[] = [eq(paymentTransactions.status, 'refunded')];
  if (options?.provider) {
    refundConditions.push(eq(paymentTransactions.provider, options.provider));
  }
  if (options?.startDate || options?.endDate) {
    const timeConditions = buildTimeRangeConditions(
      paymentTransactions.completedAt,
      { start: options?.startDate, end: options?.endDate }
    );
    refundConditions.push(...timeConditions);
  }

  const [refundStats] = await db
    .select({
      refundTotal: sql<number>`COALESCE(SUM(${paymentTransactions.amount}), 0)::int`,
    })
    .from(paymentTransactions)
    .where(and(...refundConditions));

  const totalRevenue = stats?.totalRevenue ?? 0;
  const transactionCount = stats?.transactionCount ?? 0;

  return {
    totalRevenue,
    transactionCount,
    averageTransactionValue: transactionCount > 0 ? Math.round(totalRevenue / transactionCount) : 0,
    refundTotal: refundStats?.refundTotal ?? 0,
  };
}
