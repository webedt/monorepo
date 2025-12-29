/**
 * Test App Factory
 *
 * Creates an Express application configured for integration testing.
 * Provides middleware injection for mocking authentication and database access.
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import type { User, Session } from 'lucia';

export interface TestAppOptions {
  /**
   * User to inject into authenticated requests. Set to null for unauthenticated.
   */
  user?: User | null;
  /**
   * Session to inject into authenticated requests.
   */
  authSession?: Session | null;
  /**
   * Custom middleware to run before routes
   */
  middleware?: Array<(req: Request, res: Response, next: NextFunction) => void>;
}

/**
 * Creates a test Express application with mocked authentication.
 *
 * By default, requests are authenticated with a test user.
 * Pass { user: null } to test unauthenticated requests.
 */
export function createTestApp(options: TestAppOptions = {}): Express {
  const app = express();

  // Parse JSON bodies
  app.use(express.json());

  // Inject mock auth based on options
  const mockUser = options.user !== undefined ? options.user : createMockUser();
  const mockSession = options.authSession !== undefined ? options.authSession : (mockUser ? createMockSession(mockUser.id) : null);

  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.user = mockUser;
    req.authSession = mockSession;
    // Add correlation ID for request tracking
    req.correlationId = 'test-correlation-id';
    next();
  });

  // Apply custom middleware
  if (options.middleware) {
    for (const mw of options.middleware) {
      app.use(mw);
    }
  }

  return app;
}

/**
 * Creates a mock user for testing.
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  return {
    id: 'test-user-id',
    email: 'test@example.com',
    displayName: null,
    passwordHash: '$2b$10$testhashedpassword',
    isAdmin: false,
    createdAt: new Date(),
    githubId: null,
    githubAccessToken: null,
    claudeAuth: null,
    codexAuth: null,
    geminiAuth: null,
    preferredProvider: 'claude',
    imageResizeMaxDimension: null,
    voiceCommandKeywords: [],
    defaultLandingPage: 'store',
    preferredModel: null,
    ...overrides,
  } as User;
}

/**
 * Creates a mock session for testing.
 */
export function createMockSession(userId: string = 'test-user-id'): Session {
  return {
    id: 'test-session-id',
    userId,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    fresh: false,
  };
}

/**
 * Creates a mock chat session for testing.
 */
export function createMockChatSession(overrides: Partial<MockChatSession> = {}): MockChatSession {
  const id = overrides.id || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    userId: 'test-user-id',
    sessionPath: 'owner__repo__branch',
    repositoryOwner: 'testowner',
    repositoryName: 'testrepo',
    repositoryUrl: 'https://github.com/testowner/testrepo',
    baseBranch: 'main',
    branch: 'feature-branch',
    userRequest: 'Test session request',
    status: 'pending',
    provider: 'claude',
    autoCommit: false,
    locked: false,
    workerSecret: null,
    workerId: null,
    workerStartedAt: null,
    workerLastActivity: null,
    totalCost: null,
    createdAt: new Date(),
    completedAt: null,
    deletedAt: null,
    shareToken: null,
    shareExpiresAt: null,
    remoteSessionId: null,
    isFavorite: false,
    ...overrides,
  };
}

export interface MockChatSession {
  id: string;
  userId: string;
  sessionPath: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryUrl: string;
  baseBranch: string;
  branch: string;
  userRequest: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  provider: string;
  autoCommit: boolean;
  locked: boolean;
  workerSecret: string | null;
  workerId: string | null;
  workerStartedAt: Date | null;
  workerLastActivity: Date | null;
  totalCost: number | null;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
  shareToken: string | null;
  shareExpiresAt: Date | null;
  remoteSessionId: string | null;
  isFavorite: boolean;
}

/**
 * Creates a mock event for testing.
 */
export function createMockEvent(overrides: Partial<MockEvent> = {}): MockEvent {
  return {
    id: Math.floor(Math.random() * 10000),
    chatSessionId: 'test-session-id',
    eventType: 'message',
    eventData: { type: 'text', content: 'Test message' },
    timestamp: new Date(),
    uuid: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...overrides,
  };
}

export interface MockEvent {
  id: number;
  chatSessionId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  timestamp: Date;
  uuid: string;
}

/**
 * Creates a mock message for testing.
 */
export function createMockMessage(overrides: Partial<MockMessage> = {}): MockMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    chatSessionId: 'test-session-id',
    type: 'user',
    content: 'Test message content',
    timestamp: new Date(),
    ...overrides,
  };
}

export interface MockMessage {
  id: string;
  chatSessionId: string;
  type: 'user' | 'assistant' | 'system' | 'error';
  content: string;
  timestamp: Date;
}

// Extend Express Request with our custom properties
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}
