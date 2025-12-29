/**
 * Test Fixtures for Integration Tests
 *
 * Provides factory functions, mock data, and cleanup utilities
 * for integration testing payment flows, SSE streaming, GitHub OAuth,
 * and session lifecycle operations.
 */

import { randomUUID } from 'crypto';

// ============================================================================
// Type Definitions
// ============================================================================

export interface MockUser {
  id: string;
  email: string;
  displayName: string | null;
  passwordHash: string;
  isAdmin: boolean;
  createdAt: Date;
  githubId: string | null;
  githubAccessToken: string | null;
  claudeAuth: MockClaudeAuth | null;
}

export interface MockClaudeAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface MockChatSession {
  id: string;
  userId: string;
  userRequest: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  provider: string;
  remoteSessionId: string | null;
  sessionPath: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  branch: string | null;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
}

export interface MockPaymentTransaction {
  id: string;
  userId: string;
  purchaseId: string | null;
  provider: 'stripe' | 'paypal';
  providerTransactionId: string;
  providerSessionId: string;
  type: 'checkout' | 'payment_intent' | 'refund';
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  amount: number;
  currency: string;
  metadata: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}

export interface MockGame {
  id: string;
  title: string;
  price: number;
  currency: string;
  downloadCount: number;
}

export interface MockPurchase {
  id: string;
  userId: string;
  gameId: string;
  amount: number;
  currency: string;
  status: 'completed' | 'refunded' | 'pending_refund';
  paymentMethod: 'credit_card' | 'paypal' | 'free';
  completedAt: Date | null;
  refundedAt: Date | null;
  createdAt: Date;
}

export interface MockStripeWebhookEvent {
  id: string;
  type: string;
  created: number;
  data: {
    object: Record<string, unknown>;
  };
}

export interface MockPayPalWebhookEvent {
  id: string;
  event_type: string;
  create_time: string;
  resource: Record<string, unknown>;
}

export interface MockSSEEvent {
  type: string;
  data: Record<string, unknown>;
  uuid?: string;
}

// ============================================================================
// Factory Functions - Users
// ============================================================================

export function createMockUser(overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: `user-${randomUUID()}`,
    email: `test-${randomUUID().slice(0, 8)}@example.com`,
    displayName: 'Test User',
    passwordHash: '$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234',
    isAdmin: false,
    createdAt: new Date(),
    githubId: null,
    githubAccessToken: null,
    claudeAuth: null,
    ...overrides,
  };
}

export function createMockClaudeAuth(overrides: Partial<MockClaudeAuth> = {}): MockClaudeAuth {
  return {
    accessToken: `claude-access-${randomUUID()}`,
    refreshToken: `claude-refresh-${randomUUID()}`,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
}

// ============================================================================
// Factory Functions - Sessions
// ============================================================================

export function createMockChatSession(overrides: Partial<MockChatSession> = {}): MockChatSession {
  const id = `session-${randomUUID()}`;
  return {
    id,
    userId: `user-${randomUUID()}`,
    userRequest: 'Test request prompt',
    status: 'pending',
    provider: 'claude',
    remoteSessionId: null,
    sessionPath: null,
    repositoryOwner: 'testowner',
    repositoryName: 'testrepo',
    branch: null,
    createdAt: new Date(),
    completedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

export function createMockRemoteSession(overrides: Partial<{
  id: string;
  title: string;
  session_status: string;
  created_at: string;
  updated_at: string;
  session_context: {
    sources?: Array<{ type: string; url?: string }>;
    outcomes?: Array<{ type: string; git_info?: { branches?: string[] } }>;
  };
}> = {}) {
  return {
    id: `session_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
    title: 'Test Remote Session',
    session_status: 'completed',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    session_context: {
      sources: [{ type: 'git_repository', url: 'https://github.com/owner/repo.git' }],
      outcomes: [{ type: 'git_repository', git_info: { branches: ['claude/test-branch'] } }]
    },
    ...overrides,
  };
}

// ============================================================================
// Factory Functions - Payments
// ============================================================================

export function createMockGame(overrides: Partial<MockGame> = {}): MockGame {
  return {
    id: `game-${randomUUID()}`,
    title: 'Test Game',
    price: 999, // $9.99 in cents
    currency: 'USD',
    downloadCount: 0,
    ...overrides,
  };
}

export function createMockPaymentTransaction(overrides: Partial<MockPaymentTransaction> = {}): MockPaymentTransaction {
  return {
    id: `txn-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    purchaseId: null,
    provider: 'stripe',
    providerTransactionId: `pi_${randomUUID().replace(/-/g, '')}`,
    providerSessionId: `cs_${randomUUID().replace(/-/g, '')}`,
    type: 'checkout',
    status: 'pending',
    amount: 999,
    currency: 'USD',
    metadata: {},
    errorMessage: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    completedAt: null,
    ...overrides,
  };
}

export function createMockPurchase(overrides: Partial<MockPurchase> = {}): MockPurchase {
  return {
    id: `purchase-${randomUUID()}`,
    userId: `user-${randomUUID()}`,
    gameId: `game-${randomUUID()}`,
    amount: 999,
    currency: 'USD',
    status: 'completed',
    paymentMethod: 'credit_card',
    completedAt: new Date(),
    refundedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Factory Functions - Stripe Webhooks
// ============================================================================

export function createStripeCheckoutCompletedEvent(overrides: {
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

export function createStripePaymentIntentSucceededEvent(overrides: {
  paymentIntentId?: string;
  metadata?: Record<string, string>;
  amount?: number;
} = {}): MockStripeWebhookEvent {
  const paymentIntentId = overrides.paymentIntentId || `pi_${randomUUID().replace(/-/g, '')}`;

  return {
    id: `evt_${randomUUID().replace(/-/g, '')}`,
    type: 'payment_intent.succeeded',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: paymentIntentId,
        object: 'payment_intent',
        status: 'succeeded',
        amount: overrides.amount || 999,
        currency: 'usd',
        metadata: overrides.metadata || {},
      },
    },
  };
}

export function createStripeRefundEvent(overrides: {
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
        currency: 'usd',
      },
    },
  };
}

// ============================================================================
// Factory Functions - PayPal Webhooks
// ============================================================================

export function createPayPalOrderCompletedEvent(overrides: {
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

export function createPayPalCaptureCompletedEvent(overrides: {
  captureId?: string;
  orderId?: string;
  amount?: string;
} = {}): MockPayPalWebhookEvent {
  const captureId = overrides.captureId || randomUUID();

  return {
    id: `WH-${randomUUID()}`,
    event_type: 'PAYMENT.CAPTURE.COMPLETED',
    create_time: new Date().toISOString(),
    resource: {
      id: captureId,
      status: 'COMPLETED',
      supplementary_data: {
        related_ids: {
          order_id: overrides.orderId || randomUUID(),
        },
      },
      amount: {
        value: overrides.amount || '9.99',
        currency_code: 'USD',
      },
    },
  };
}

// ============================================================================
// Factory Functions - SSE Events
// ============================================================================

export function createMockSSEEvent(overrides: Partial<MockSSEEvent> = {}): MockSSEEvent {
  return {
    type: 'text',
    data: { content: 'Test content' },
    uuid: randomUUID(),
    ...overrides,
  };
}

export function createMockSystemEvent(message: string): MockSSEEvent {
  return {
    type: 'system',
    data: { message },
    uuid: randomUUID(),
  };
}

export function createMockUserEvent(content: string): MockSSEEvent {
  return {
    type: 'user',
    data: { content },
    uuid: randomUUID(),
  };
}

export function createMockAssistantEvent(content: string): MockSSEEvent {
  return {
    type: 'assistant',
    data: { content },
    uuid: randomUUID(),
  };
}

export function createMockResultEvent(overrides: {
  totalCost?: number;
  durationMs?: number;
  status?: string;
} = {}): MockSSEEvent {
  return {
    type: 'result',
    data: {
      total_cost_usd: overrides.totalCost ?? 0.001234,
      duration_ms: overrides.durationMs ?? 5000,
      status: overrides.status ?? 'completed',
    },
    uuid: randomUUID(),
  };
}

export function createMockTitleGenerationEvent(title: string, branch: string): MockSSEEvent {
  return {
    type: 'title_generation',
    data: { title, branch },
    uuid: randomUUID(),
  };
}

// ============================================================================
// Factory Functions - GitHub OAuth
// ============================================================================

export function createMockGitHubOAuthState(overrides: {
  sessionId?: string;
  userId?: string;
  timestamp?: number;
  returnOrigin?: string;
  returnPath?: string;
} = {}): string {
  const state = {
    sessionId: overrides.sessionId || randomUUID(),
    userId: overrides.userId || randomUUID(),
    timestamp: overrides.timestamp || Date.now(),
    returnOrigin: overrides.returnOrigin || 'http://localhost:3000',
    returnPath: overrides.returnPath || '/settings',
  };
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

export function createMockGitHubTokenResponse(overrides: {
  accessToken?: string;
  error?: string;
} = {}): Record<string, unknown> {
  if (overrides.error) {
    return { error: overrides.error };
  }
  return {
    access_token: overrides.accessToken || `ghu_${randomUUID().replace(/-/g, '')}`,
    token_type: 'bearer',
    scope: 'repo,workflow,user:email',
  };
}

export function createMockGitHubUser(overrides: {
  id?: number;
  login?: string;
  email?: string;
} = {}): Record<string, unknown> {
  return {
    id: overrides.id || Math.floor(Math.random() * 1000000),
    login: overrides.login || `testuser${Math.floor(Math.random() * 1000)}`,
    email: overrides.email || `test@example.com`,
    name: 'Test User',
    avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
  };
}

// ============================================================================
// Test Data Collections
// ============================================================================

export const TEST_CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'] as const;

export const TEST_PAYMENT_AMOUNTS = {
  small: 99,      // $0.99
  medium: 999,    // $9.99
  large: 4999,    // $49.99
  premium: 9999,  // $99.99
};

export const TEST_SESSION_STATUSES = ['pending', 'running', 'completed', 'error'] as const;

export const TEST_REMOTE_SESSION_STATUSES = [
  'idle',
  'running',
  'completed',
  'cancelled',
  'errored',
  'archived',
] as const;

export const TEST_WEBHOOK_EVENT_TYPES = {
  stripe: [
    'checkout.session.completed',
    'checkout.session.expired',
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
    'charge.dispute.created',
  ],
  paypal: [
    'CHECKOUT.ORDER.APPROVED',
    'CHECKOUT.ORDER.COMPLETED',
    'PAYMENT.CAPTURE.COMPLETED',
    'PAYMENT.CAPTURE.DENIED',
    'PAYMENT.CAPTURE.REFUNDED',
  ],
};

// ============================================================================
// Mock Services
// ============================================================================

/**
 * Mock console for capturing output in tests
 */
export interface MockConsole {
  logs: string[];
  errors: string[];
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  reset: () => void;
  getOutput: () => string;
  getErrorOutput: () => string;
}

export function createMockConsole(): MockConsole {
  const logs: string[] = [];
  const errors: string[] = [];

  return {
    logs,
    errors,
    log: (...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    },
    error: (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    },
    reset: () => {
      logs.length = 0;
      errors.length = 0;
    },
    getOutput: () => logs.join('\n'),
    getErrorOutput: () => errors.join('\n'),
  };
}

/**
 * Event collector for SSE streams
 */
export interface SSEEventCollector {
  events: MockSSEEvent[];
  callback: (event: MockSSEEvent) => void;
  getEventsByType: (type: string) => MockSSEEvent[];
  hasEventType: (type: string) => boolean;
  getLastEvent: () => MockSSEEvent | undefined;
  reset: () => void;
}

export function createSSEEventCollector(): SSEEventCollector {
  const events: MockSSEEvent[] = [];

  return {
    events,
    callback: (event: MockSSEEvent) => {
      events.push(event);
    },
    getEventsByType: (type: string) => events.filter(e => e.type === type),
    hasEventType: (type: string) => events.some(e => e.type === type),
    getLastEvent: () => events[events.length - 1],
    reset: () => {
      events.length = 0;
    },
  };
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Wait for a specified duration
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await wait(interval);
  }

  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Generate a Stripe-like webhook signature (for testing signature verification)
 */
export function generateMockStripeSignature(
  payload: string,
  secret: string
): string {
  // This is a simplified mock - real signatures use HMAC-SHA256
  const timestamp = Math.floor(Date.now() / 1000);
  return `t=${timestamp},v1=mock_signature_${secret.slice(0, 8)}`;
}

/**
 * Generate a PayPal-like webhook signature header
 */
export function generateMockPayPalSignature(overrides: {
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

/**
 * Parse SSE event string into structured event
 */
export function parseSSEEventString(eventString: string): MockSSEEvent | null {
  const lines = eventString.trim().split('\n');
  let eventType = 'message';
  let data = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('data: ')) {
      data = line.slice(6);
    }
  }

  if (!data) return null;

  try {
    return {
      type: eventType,
      data: JSON.parse(data),
    };
  } catch {
    return {
      type: eventType,
      data: { raw: data },
    };
  }
}

/**
 * Format event as SSE string
 */
export function formatSSEEvent(event: MockSSEEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}
