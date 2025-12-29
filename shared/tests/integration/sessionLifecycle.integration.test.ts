/**
 * Integration Tests for Session Lifecycle
 *
 * These tests verify the complete session lifecycle including:
 * - Session creation
 * - Session execution
 * - Session resume
 * - Session archival
 * - Session deletion (soft delete)
 * - State transitions
 * - Event storage and replay
 * - Multi-step transaction scenarios
 *
 * Note: These tests use mock services and don't require external API connections.
 *
 * Run these tests:
 *   npm run test:integration -w shared
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';
import {
  createMockUser,
  createMockChatSession,
  createMockRemoteSession,
  createMockClaudeAuth,
  createSSEEventCollector,
  createMockSSEEvent,
  createMockSystemEvent,
  createMockUserEvent,
  createMockAssistantEvent,
  createMockResultEvent,
  createMockTitleGenerationEvent,
  wait,
  waitFor,
  TEST_SESSION_STATUSES,
  TEST_REMOTE_SESSION_STATUSES,
} from './fixtures.js';

// ============================================================================
// Mock Session Management Implementation
// ============================================================================

type SessionStatus = 'pending' | 'running' | 'completed' | 'error';
type RemoteSessionStatus = 'idle' | 'running' | 'completed' | 'cancelled' | 'errored' | 'archived';

interface ChatSession {
  id: string;
  userId: string;
  userRequest: string;
  status: SessionStatus;
  provider: string;
  remoteSessionId: string | null;
  sessionPath: string | null;
  repositoryOwner: string | null;
  repositoryName: string | null;
  branch: string | null;
  totalCost: number | null;
  durationMs: number | null;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
  workerLastActivity: Date | null;
}

interface RemoteSession {
  id: string;
  title: string | null;
  status: RemoteSessionStatus;
  createdAt: string;
  updatedAt: string;
}

interface SessionEvent {
  id: string;
  sessionId: string;
  uuid: string;
  type: string;
  data: unknown;
  timestamp: Date;
}

/**
 * Mock Session Repository
 * Simulates database operations for session management
 */
class MockSessionRepository {
  private sessions: Map<string, ChatSession> = new Map();
  private events: Map<string, SessionEvent[]> = new Map();

  /**
   * Create a new session
   */
  create(params: {
    userId: string;
    userRequest: string;
    repositoryOwner?: string;
    repositoryName?: string;
  }): ChatSession {
    const session: ChatSession = {
      id: randomUUID(),
      userId: params.userId,
      userRequest: params.userRequest,
      status: 'pending',
      provider: 'claude',
      remoteSessionId: null,
      sessionPath: null,
      repositoryOwner: params.repositoryOwner || null,
      repositoryName: params.repositoryName || null,
      branch: null,
      totalCost: null,
      durationMs: null,
      createdAt: new Date(),
      completedAt: null,
      deletedAt: null,
      workerLastActivity: null,
    };

    this.sessions.set(session.id, session);
    this.events.set(session.id, []);
    return session;
  }

  /**
   * Get session by ID
   */
  getById(sessionId: string): ChatSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get session by ID for specific user
   */
  getByIdForUser(sessionId: string, userId: string): ChatSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && session.userId === userId && !session.deletedAt) {
      return session;
    }
    return undefined;
  }

  /**
   * List active sessions for user
   */
  listActive(userId: string): ChatSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.userId === userId && !s.deletedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * List deleted sessions for user
   */
  listDeleted(userId: string): ChatSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.userId === userId && s.deletedAt !== null)
      .sort((a, b) => (b.deletedAt?.getTime() || 0) - (a.deletedAt?.getTime() || 0));
  }

  /**
   * Update session
   */
  update(sessionId: string, updates: Partial<ChatSession>): ChatSession | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) return undefined;

    Object.assign(session, updates);
    return session;
  }

  /**
   * Update session status
   */
  updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      if (status === 'completed' || status === 'error') {
        session.completedAt = new Date();
      }
    }
  }

  /**
   * Soft delete session
   */
  softDelete(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session && !session.deletedAt) {
      session.deletedAt = new Date();
      return true;
    }
    return false;
  }

  /**
   * Restore soft-deleted session
   */
  restore(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (session && session.deletedAt) {
      session.deletedAt = null;
      return true;
    }
    return false;
  }

  /**
   * Permanently delete session
   */
  permanentDelete(sessionId: string): boolean {
    const existed = this.sessions.has(sessionId);
    this.sessions.delete(sessionId);
    this.events.delete(sessionId);
    return existed;
  }

  /**
   * Store event for session
   */
  storeEvent(sessionId: string, event: Omit<SessionEvent, 'id' | 'timestamp'>): SessionEvent {
    const stored: SessionEvent = {
      id: randomUUID(),
      ...event,
      timestamp: new Date(),
    };

    const events = this.events.get(sessionId) || [];
    events.push(stored);
    this.events.set(sessionId, events);

    return stored;
  }

  /**
   * Get events for session
   */
  getEvents(sessionId: string): SessionEvent[] {
    return this.events.get(sessionId) || [];
  }

  /**
   * Check if session exists for user
   */
  existsForUser(sessionId: string, userId: string): boolean {
    const session = this.sessions.get(sessionId);
    return !!session && session.userId === userId && !session.deletedAt;
  }

  /**
   * Count active sessions for user
   */
  countActive(userId: string): number {
    return this.listActive(userId).length;
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions.clear();
    this.events.clear();
  }
}

/**
 * Mock Remote Session Client
 * Simulates the Claude Remote Sessions API
 */
class MockRemoteSessionClient {
  private sessions: Map<string, RemoteSession> = new Map();
  private failNextRequest = false;

  /**
   * Create a new remote session
   */
  async createSession(params: {
    gitUrl: string;
    prompt: string;
    branch?: string;
  }): Promise<{ id: string; webUrl: string }> {
    if (this.failNextRequest) {
      this.failNextRequest = false;
      throw new Error('Failed to create remote session');
    }

    const session: RemoteSession = {
      id: `session_${randomUUID().replace(/-/g, '').slice(0, 24)}`,
      title: null,
      status: 'idle',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.sessions.set(session.id, session);

    return {
      id: session.id,
      webUrl: `https://claude.ai/workbench/${session.id}`,
    };
  }

  /**
   * Get remote session
   */
  async getSession(sessionId: string): Promise<RemoteSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * List remote sessions
   */
  async listSessions(): Promise<RemoteSession[]> {
    return Array.from(this.sessions.values())
      .filter(s => s.status !== 'archived');
  }

  /**
   * Archive remote session
   */
  async archiveSession(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = 'archived';
      session.updatedAt = new Date().toISOString();
      return true;
    }
    return false;
  }

  /**
   * Update remote session status
   */
  updateStatus(sessionId: string, status: RemoteSessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      session.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Update remote session title
   */
  updateTitle(sessionId: string, title: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.title = title;
      session.updatedAt = new Date().toISOString();
    }
  }

  /**
   * Set next request to fail
   */
  setFailNextRequest(): void {
    this.failNextRequest = true;
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions.clear();
    this.failNextRequest = false;
  }
}

/**
 * Mock Execution Provider
 * Simulates AI execution
 */
class MockExecutionProvider {
  private eventCallbacks: Map<string, (event: unknown) => void> = new Map();
  private runningExecutions: Set<string> = new Set();

  /**
   * Execute a prompt
   */
  async execute(
    params: {
      sessionId: string;
      prompt: string;
      gitUrl: string;
    },
    onEvent: (event: unknown) => void
  ): Promise<{ status: 'completed' | 'error'; totalCost: number; durationMs: number }> {
    this.runningExecutions.add(params.sessionId);
    this.eventCallbacks.set(params.sessionId, onEvent);

    // Simulate execution events
    const startTime = Date.now();

    onEvent(createMockSystemEvent('Execution started'));
    onEvent(createMockUserEvent(params.prompt));

    // Simulate some work
    await wait(10);

    onEvent(createMockAssistantEvent('Working on your request...'));

    await wait(10);

    onEvent(createMockAssistantEvent('Task completed successfully.'));

    const durationMs = Date.now() - startTime;
    const totalCost = 0.001234;

    onEvent(createMockResultEvent({
      totalCost,
      durationMs,
      status: 'completed',
    }));

    this.runningExecutions.delete(params.sessionId);
    this.eventCallbacks.delete(params.sessionId);

    return { status: 'completed', totalCost, durationMs };
  }

  /**
   * Resume a session
   */
  async resume(
    params: {
      sessionId: string;
      remoteSessionId: string;
      message: string;
    },
    onEvent: (event: unknown) => void
  ): Promise<{ status: 'completed' | 'error'; totalCost: number; durationMs: number }> {
    this.runningExecutions.add(params.sessionId);
    this.eventCallbacks.set(params.sessionId, onEvent);

    const startTime = Date.now();

    onEvent(createMockSystemEvent('Resume started'));
    onEvent(createMockUserEvent(params.message));

    await wait(10);

    onEvent(createMockAssistantEvent('Continuing from where we left off...'));

    const durationMs = Date.now() - startTime;
    const totalCost = 0.000567;

    onEvent(createMockResultEvent({
      totalCost,
      durationMs,
      status: 'completed',
    }));

    this.runningExecutions.delete(params.sessionId);
    this.eventCallbacks.delete(params.sessionId);

    return { status: 'completed', totalCost, durationMs };
  }

  /**
   * Interrupt execution
   */
  async interrupt(sessionId: string): Promise<void> {
    const callback = this.eventCallbacks.get(sessionId);
    if (callback) {
      callback(createMockSystemEvent('Execution interrupted'));
    }
    this.runningExecutions.delete(sessionId);
    this.eventCallbacks.delete(sessionId);
  }

  /**
   * Check if session is running
   */
  isRunning(sessionId: string): boolean {
    return this.runningExecutions.has(sessionId);
  }

  /**
   * Clear all executions
   */
  clear(): void {
    this.runningExecutions.clear();
    this.eventCallbacks.clear();
  }
}

/**
 * Session Lifecycle Manager
 * Coordinates all session operations
 */
class SessionLifecycleManager {
  constructor(
    private sessionRepo: MockSessionRepository,
    private remoteClient: MockRemoteSessionClient,
    private executionProvider: MockExecutionProvider
  ) {}

  /**
   * Create and execute a new session
   */
  async createAndExecute(params: {
    userId: string;
    userRequest: string;
    gitUrl: string;
    repositoryOwner: string;
    repositoryName: string;
  }): Promise<{
    session: ChatSession;
    events: unknown[];
    result: { status: string; totalCost: number; durationMs: number };
  }> {
    // Create local session
    const session = this.sessionRepo.create({
      userId: params.userId,
      userRequest: params.userRequest,
      repositoryOwner: params.repositoryOwner,
      repositoryName: params.repositoryName,
    });

    // Create remote session
    const remoteSession = await this.remoteClient.createSession({
      gitUrl: params.gitUrl,
      prompt: params.userRequest,
    });

    // Update local session with remote ID
    this.sessionRepo.update(session.id, {
      remoteSessionId: remoteSession.id,
      status: 'running',
      workerLastActivity: new Date(),
    });

    // Execute
    const events: unknown[] = [];
    const result = await this.executionProvider.execute(
      {
        sessionId: session.id,
        prompt: params.userRequest,
        gitUrl: params.gitUrl,
      },
      (event) => {
        events.push(event);
        // Store event
        const eventData = event as { type: string; data: unknown; uuid?: string };
        this.sessionRepo.storeEvent(session.id, {
          sessionId: session.id,
          uuid: eventData.uuid || randomUUID(),
          type: eventData.type,
          data: eventData.data,
        });
      }
    );

    // Update session with result
    this.sessionRepo.update(session.id, {
      status: result.status === 'completed' ? 'completed' : 'error',
      totalCost: result.totalCost,
      durationMs: result.durationMs,
      completedAt: new Date(),
    });

    // Update remote session status
    this.remoteClient.updateStatus(
      remoteSession.id,
      result.status === 'completed' ? 'completed' : 'errored'
    );

    return {
      session: this.sessionRepo.getById(session.id)!,
      events,
      result,
    };
  }

  /**
   * Resume an existing session
   */
  async resume(params: {
    sessionId: string;
    userId: string;
    message: string;
  }): Promise<{
    session: ChatSession;
    events: unknown[];
    result: { status: string; totalCost: number; durationMs: number };
  } | null> {
    const session = this.sessionRepo.getByIdForUser(params.sessionId, params.userId);
    if (!session || !session.remoteSessionId) {
      return null;
    }

    // Check if session can be resumed
    const remoteSession = await this.remoteClient.getSession(session.remoteSessionId);
    if (!remoteSession || remoteSession.status === 'archived') {
      return null;
    }

    // Update session status
    this.sessionRepo.update(session.id, {
      status: 'running',
      workerLastActivity: new Date(),
    });

    // Execute resume
    const events: unknown[] = [];
    const result = await this.executionProvider.resume(
      {
        sessionId: session.id,
        remoteSessionId: session.remoteSessionId,
        message: params.message,
      },
      (event) => {
        events.push(event);
        const eventData = event as { type: string; data: unknown; uuid?: string };
        this.sessionRepo.storeEvent(session.id, {
          sessionId: session.id,
          uuid: eventData.uuid || randomUUID(),
          type: eventData.type,
          data: eventData.data,
        });
      }
    );

    // Update session with result
    const previousCost = session.totalCost || 0;
    const previousDuration = session.durationMs || 0;

    this.sessionRepo.update(session.id, {
      status: result.status === 'completed' ? 'completed' : 'error',
      totalCost: previousCost + result.totalCost,
      durationMs: previousDuration + result.durationMs,
      completedAt: new Date(),
    });

    return {
      session: this.sessionRepo.getById(session.id)!,
      events,
      result,
    };
  }

  /**
   * Archive a session
   */
  async archive(sessionId: string, userId: string): Promise<boolean> {
    const session = this.sessionRepo.getByIdForUser(sessionId, userId);
    if (!session) {
      return false;
    }

    // Archive remote session if exists
    if (session.remoteSessionId) {
      await this.remoteClient.archiveSession(session.remoteSessionId);
    }

    // Soft delete local session
    return this.sessionRepo.softDelete(sessionId);
  }

  /**
   * Get session with events
   */
  getSessionWithEvents(sessionId: string, userId: string): {
    session: ChatSession;
    events: SessionEvent[];
  } | null {
    const session = this.sessionRepo.getByIdForUser(sessionId, userId);
    if (!session) {
      return null;
    }

    const events = this.sessionRepo.getEvents(sessionId);
    return { session, events };
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('Session Lifecycle Integration Tests', () => {
  let sessionRepo: MockSessionRepository;
  let remoteClient: MockRemoteSessionClient;
  let executionProvider: MockExecutionProvider;
  let lifecycleManager: SessionLifecycleManager;
  let user: ReturnType<typeof createMockUser>;

  beforeEach(() => {
    sessionRepo = new MockSessionRepository();
    remoteClient = new MockRemoteSessionClient();
    executionProvider = new MockExecutionProvider();
    lifecycleManager = new SessionLifecycleManager(
      sessionRepo,
      remoteClient,
      executionProvider
    );
    user = createMockUser();
  });

  afterEach(() => {
    sessionRepo.clear();
    remoteClient.clear();
    executionProvider.clear();
  });

  describe('Session Creation', () => {
    it('should create a new session with pending status', () => {
      const session = sessionRepo.create({
        userId: user.id,
        userRequest: 'Write a hello world function',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      assert.ok(session.id);
      assert.strictEqual(session.userId, user.id);
      assert.strictEqual(session.status, 'pending');
      assert.ok(session.createdAt);
      assert.strictEqual(session.completedAt, null);
      assert.strictEqual(session.deletedAt, null);
    });

    it('should generate unique session IDs', () => {
      const session1 = sessionRepo.create({
        userId: user.id,
        userRequest: 'Request 1',
      });

      const session2 = sessionRepo.create({
        userId: user.id,
        userRequest: 'Request 2',
      });

      assert.notStrictEqual(session1.id, session2.id);
    });

    it('should initialize empty events array', () => {
      const session = sessionRepo.create({
        userId: user.id,
        userRequest: 'Test',
      });

      const events = sessionRepo.getEvents(session.id);
      assert.strictEqual(events.length, 0);
    });
  });

  describe('Session Execution', () => {
    it('should execute a session successfully', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Write a hello world function',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      assert.ok(result.session);
      assert.strictEqual(result.session.status, 'completed');
      assert.ok(result.session.remoteSessionId);
      assert.ok(result.session.completedAt);
      assert.ok(result.session.totalCost! > 0);
      assert.ok(result.session.durationMs! > 0);
    });

    it('should store events during execution', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test request',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const events = sessionRepo.getEvents(result.session.id);
      assert.ok(events.length > 0);

      // Check for expected event types
      const eventTypes = events.map(e => e.type);
      assert.ok(eventTypes.includes('system'));
      assert.ok(eventTypes.includes('user'));
      assert.ok(eventTypes.includes('assistant'));
      assert.ok(eventTypes.includes('result'));
    });

    it('should update session status during execution', async () => {
      // We can't easily test the intermediate 'running' status since execution is fast,
      // but we can verify the final status
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      assert.strictEqual(result.session.status, 'completed');
    });
  });

  describe('Session Resume', () => {
    it('should resume a completed session', async () => {
      // First, create and execute a session
      const initial = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Initial request',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const initialCost = initial.session.totalCost!;
      const initialDuration = initial.session.durationMs!;
      const initialEventCount = sessionRepo.getEvents(initial.session.id).length;

      // Resume the session
      const resumed = await lifecycleManager.resume({
        sessionId: initial.session.id,
        userId: user.id,
        message: 'Continue with additional work',
      });

      assert.ok(resumed);
      assert.strictEqual(resumed.session.status, 'completed');

      // Cost and duration should accumulate
      assert.ok(resumed.session.totalCost! > initialCost);
      assert.ok(resumed.session.durationMs! > initialDuration);

      // New events should be added
      const totalEvents = sessionRepo.getEvents(initial.session.id).length;
      assert.ok(totalEvents > initialEventCount);
    });

    it('should not resume a non-existent session', async () => {
      const result = await lifecycleManager.resume({
        sessionId: 'non-existent',
        userId: user.id,
        message: 'Test',
      });

      assert.strictEqual(result, null);
    });

    it('should not resume a session for wrong user', async () => {
      const initial = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const result = await lifecycleManager.resume({
        sessionId: initial.session.id,
        userId: 'different-user-id',
        message: 'Test',
      });

      assert.strictEqual(result, null);
    });

    it('should not resume an archived session', async () => {
      const initial = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      // Archive the session
      await lifecycleManager.archive(initial.session.id, user.id);

      const result = await lifecycleManager.resume({
        sessionId: initial.session.id,
        userId: user.id,
        message: 'Test',
      });

      assert.strictEqual(result, null);
    });
  });

  describe('Session Archival', () => {
    it('should archive a session', async () => {
      const initial = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const result = await lifecycleManager.archive(initial.session.id, user.id);

      assert.strictEqual(result, true);

      // Session should be soft-deleted
      const session = sessionRepo.getById(initial.session.id);
      assert.ok(session?.deletedAt);

      // Remote session should be archived
      const remoteSession = await remoteClient.getSession(initial.session.remoteSessionId!);
      assert.strictEqual(remoteSession?.status, 'archived');
    });

    it('should not archive non-existent session', async () => {
      const result = await lifecycleManager.archive('non-existent', user.id);
      assert.strictEqual(result, false);
    });

    it('should not archive session for wrong user', async () => {
      const initial = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const result = await lifecycleManager.archive(initial.session.id, 'different-user');
      assert.strictEqual(result, false);
    });
  });

  describe('Session Listing', () => {
    it('should list active sessions for user', async () => {
      // Create multiple sessions
      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Session 1',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Session 2',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const sessions = sessionRepo.listActive(user.id);
      assert.strictEqual(sessions.length, 2);
    });

    it('should not include deleted sessions in active list', async () => {
      const session1 = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Session 1',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Session 2',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      // Delete first session
      await lifecycleManager.archive(session1.session.id, user.id);

      const activeSessions = sessionRepo.listActive(user.id);
      assert.strictEqual(activeSessions.length, 1);

      const deletedSessions = sessionRepo.listDeleted(user.id);
      assert.strictEqual(deletedSessions.length, 1);
    });

    it('should sort sessions by creation date (newest first)', async () => {
      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Session 1',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      await wait(10); // Ensure different timestamps

      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Session 2',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const sessions = sessionRepo.listActive(user.id);
      assert.strictEqual(sessions[0].userRequest, 'Session 2'); // Newest first
      assert.strictEqual(sessions[1].userRequest, 'Session 1');
    });

    it('should isolate sessions between users', async () => {
      const user2 = createMockUser();

      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'User 1 Session',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      await lifecycleManager.createAndExecute({
        userId: user2.id,
        userRequest: 'User 2 Session',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const user1Sessions = sessionRepo.listActive(user.id);
      const user2Sessions = sessionRepo.listActive(user2.id);

      assert.strictEqual(user1Sessions.length, 1);
      assert.strictEqual(user2Sessions.length, 1);
      assert.strictEqual(user1Sessions[0].userRequest, 'User 1 Session');
      assert.strictEqual(user2Sessions[0].userRequest, 'User 2 Session');
    });
  });

  describe('Event Storage and Replay', () => {
    it('should store all execution events', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test request',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const storedEvents = sessionRepo.getEvents(result.session.id);

      // All events from execution should be stored
      assert.strictEqual(storedEvents.length, result.events.length);
    });

    it('should store events with timestamps', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const events = sessionRepo.getEvents(result.session.id);

      for (const event of events) {
        assert.ok(event.timestamp instanceof Date);
        assert.ok(event.id);
        assert.ok(event.uuid);
      }
    });

    it('should preserve event order', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const events = sessionRepo.getEvents(result.session.id);

      // Timestamps should be in order
      for (let i = 1; i < events.length; i++) {
        assert.ok(events[i].timestamp >= events[i - 1].timestamp);
      }
    });

    it('should retrieve session with events', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const sessionWithEvents = lifecycleManager.getSessionWithEvents(
        result.session.id,
        user.id
      );

      assert.ok(sessionWithEvents);
      assert.ok(sessionWithEvents.session);
      assert.ok(sessionWithEvents.events.length > 0);
    });
  });

  describe('Session Soft Delete and Restore', () => {
    it('should soft delete a session', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const deleted = sessionRepo.softDelete(result.session.id);

      assert.strictEqual(deleted, true);

      const session = sessionRepo.getById(result.session.id);
      assert.ok(session?.deletedAt);
    });

    it('should restore a soft-deleted session', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      sessionRepo.softDelete(result.session.id);
      const restored = sessionRepo.restore(result.session.id);

      assert.strictEqual(restored, true);

      const session = sessionRepo.getById(result.session.id);
      assert.strictEqual(session?.deletedAt, null);
    });

    it('should not soft delete already deleted session', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      sessionRepo.softDelete(result.session.id);
      const secondDelete = sessionRepo.softDelete(result.session.id);

      assert.strictEqual(secondDelete, false);
    });

    it('should preserve events after soft delete', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const eventCountBefore = sessionRepo.getEvents(result.session.id).length;

      sessionRepo.softDelete(result.session.id);

      const eventCountAfter = sessionRepo.getEvents(result.session.id).length;

      assert.strictEqual(eventCountAfter, eventCountBefore);
    });
  });

  describe('Full Lifecycle Flow', () => {
    it('should complete full lifecycle: create → execute → resume → archive', async () => {
      // 1. Create and Execute
      const initial = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Write a function',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      assert.strictEqual(initial.session.status, 'completed');
      const initialEventCount = initial.events.length;
      const initialCost = initial.session.totalCost!;

      // 2. Resume
      const resumed = await lifecycleManager.resume({
        sessionId: initial.session.id,
        userId: user.id,
        message: 'Add tests for the function',
      });

      assert.ok(resumed);
      assert.strictEqual(resumed.session.status, 'completed');
      const resumedCost = resumed.session.totalCost!;
      assert.ok(resumedCost > initialCost);

      // 3. Resume again
      const resumed2 = await lifecycleManager.resume({
        sessionId: initial.session.id,
        userId: user.id,
        message: 'Add documentation',
      });

      assert.ok(resumed2);
      assert.ok(resumed2.session.totalCost! > resumedCost);

      // 4. Archive
      const archived = await lifecycleManager.archive(initial.session.id, user.id);
      assert.strictEqual(archived, true);

      // 5. Verify final state
      const finalSession = sessionRepo.getById(initial.session.id);
      assert.ok(finalSession?.deletedAt);

      const allEvents = sessionRepo.getEvents(initial.session.id);
      assert.ok(allEvents.length > initialEventCount * 2); // Multiple executions
    });

    it('should handle multiple sequential sessions', async () => {
      const sessions: ChatSession[] = [];

      for (let i = 0; i < 3; i++) {
        const result = await lifecycleManager.createAndExecute({
          userId: user.id,
          userRequest: `Request ${i + 1}`,
          gitUrl: 'https://github.com/owner/repo.git',
          repositoryOwner: 'owner',
          repositoryName: 'repo',
        });
        sessions.push(result.session);
      }

      // All sessions should be completed
      for (const session of sessions) {
        assert.strictEqual(session.status, 'completed');
      }

      // All should appear in active list
      const activeSessions = sessionRepo.listActive(user.id);
      assert.strictEqual(activeSessions.length, 3);

      // Archive one
      await lifecycleManager.archive(sessions[0].id, user.id);

      // Now only 2 active
      const remainingActive = sessionRepo.listActive(user.id);
      assert.strictEqual(remainingActive.length, 2);
    });
  });

  describe('Status Transitions', () => {
    it('should track all valid status values', () => {
      for (const status of TEST_SESSION_STATUSES) {
        const session = sessionRepo.create({
          userId: user.id,
          userRequest: 'Test',
        });

        sessionRepo.updateStatus(session.id, status);

        const updated = sessionRepo.getById(session.id);
        assert.strictEqual(updated?.status, status);
      }
    });

    it('should set completedAt on terminal statuses', () => {
      const session = sessionRepo.create({
        userId: user.id,
        userRequest: 'Test',
      });

      assert.strictEqual(session.completedAt, null);

      sessionRepo.updateStatus(session.id, 'completed');

      const updated = sessionRepo.getById(session.id);
      assert.ok(updated?.completedAt);
    });

    it('should handle error status correctly', () => {
      const session = sessionRepo.create({
        userId: user.id,
        userRequest: 'Test',
      });

      sessionRepo.updateStatus(session.id, 'error');

      const updated = sessionRepo.getById(session.id);
      assert.strictEqual(updated?.status, 'error');
      assert.ok(updated?.completedAt);
    });
  });

  describe('Edge Cases', () => {
    it('should handle session with no remote session ID', async () => {
      const session = sessionRepo.create({
        userId: user.id,
        userRequest: 'Test',
      });

      // Try to resume session without remote ID
      const result = await lifecycleManager.resume({
        sessionId: session.id,
        userId: user.id,
        message: 'Test',
      });

      assert.strictEqual(result, null);
    });

    it('should handle permanent delete', async () => {
      const result = await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      const deleted = sessionRepo.permanentDelete(result.session.id);

      assert.strictEqual(deleted, true);
      assert.strictEqual(sessionRepo.getById(result.session.id), undefined);
      assert.strictEqual(sessionRepo.getEvents(result.session.id).length, 0);
    });

    it('should handle session count', async () => {
      assert.strictEqual(sessionRepo.countActive(user.id), 0);

      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test 1',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      assert.strictEqual(sessionRepo.countActive(user.id), 1);

      await lifecycleManager.createAndExecute({
        userId: user.id,
        userRequest: 'Test 2',
        gitUrl: 'https://github.com/owner/repo.git',
        repositoryOwner: 'owner',
        repositoryName: 'repo',
      });

      assert.strictEqual(sessionRepo.countActive(user.id), 2);
    });
  });
});
