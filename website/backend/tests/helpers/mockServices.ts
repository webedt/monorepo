/**
 * Mock Service Provider Utilities
 *
 * Provides mock implementations for the ServiceProvider-based services
 * used throughout the backend routes.
 */

import type { MockChatSession, MockEvent } from './testApp.js';
import type { MockDb } from './mockDb.js';

/**
 * Mock Session Query Service
 *
 * Provides mock implementations for session query operations.
 */
export interface MockSessionQueryService {
  getById: (id: string) => Promise<MockChatSession | null>;
  listActive: (userId: string) => Promise<MockChatSession[]>;
  search: (
    userId: string,
    query: string,
    options?: { limit?: number; offset?: number; status?: string; favorite?: boolean }
  ) => Promise<{ sessions: MockChatSession[]; total: number }>;
}

export function createMockSessionQueryService(db: MockDb): MockSessionQueryService {
  return {
    async getById(id: string) {
      return db.getSession(id);
    },
    async listActive(userId: string) {
      return db.getSessionsByUserId(userId);
    },
    async search(userId: string, query: string, options = {}) {
      const sessions = db.getSessionsByUserId(userId).filter((s) => {
        const matchesQuery = s.userRequest?.toLowerCase().includes(query.toLowerCase()) ||
          s.repositoryName?.toLowerCase().includes(query.toLowerCase());
        const matchesStatus = !options.status || s.status === options.status;
        const matchesFavorite = options.favorite === undefined || s.isFavorite === options.favorite;
        return matchesQuery && matchesStatus && matchesFavorite;
      });

      const offset = options.offset || 0;
      const limit = options.limit || 50;

      return {
        sessions: sessions.slice(offset, offset + limit),
        total: sessions.length,
      };
    },
  };
}

/**
 * Mock Session Authorization Service
 *
 * Provides mock implementations for session authorization checks.
 */
export interface MockSessionAuthorizationService {
  verifyOwnership: (
    session: MockChatSession | null,
    userId: string
  ) => { authorized: boolean; error?: string; statusCode?: number };
  verifyShareTokenAccess: (
    session: MockChatSession | null,
    token: string
  ) => { authorized: boolean; error?: string; statusCode?: number };
}

export function createMockSessionAuthorizationService(): MockSessionAuthorizationService {
  return {
    verifyOwnership(session, userId) {
      if (!session) {
        return { authorized: false, error: 'Session not found', statusCode: 404 };
      }
      if (session.userId !== userId) {
        return { authorized: false, error: 'Access denied', statusCode: 403 };
      }
      return { authorized: true };
    },
    verifyShareTokenAccess(session, token) {
      if (!session) {
        return { authorized: false, error: 'Session not found', statusCode: 404 };
      }
      if (!session.shareToken || session.shareToken !== token) {
        return { authorized: false, error: 'Invalid share token', statusCode: 403 };
      }
      if (session.shareExpiresAt && new Date(session.shareExpiresAt) < new Date()) {
        return { authorized: false, error: 'Share link has expired', statusCode: 403 };
      }
      return { authorized: true };
    },
  };
}

/**
 * Mock Event Storage Service
 */
export interface MockEventStorageService {
  storeEvent: (sessionId: string, event: Partial<MockEvent>) => Promise<MockEvent>;
  getEvents: (sessionId: string) => Promise<MockEvent[]>;
}

export function createMockEventStorageService(db: MockDb): MockEventStorageService {
  return {
    async storeEvent(sessionId, eventData) {
      return db.createEvent({ chatSessionId: sessionId, ...eventData });
    },
    async getEvents(sessionId) {
      return db.getEvents(sessionId);
    },
  };
}

/**
 * Mock Session Cleanup Service
 */
export interface MockSessionCleanupService {
  deleteGitHubBranch: (
    token: string,
    owner: string,
    repo: string,
    branch: string
  ) => Promise<{ success: boolean; message: string }>;
  archiveClaudeRemoteSession: (
    sessionId: string,
    claudeAuth: unknown,
    environmentId?: string
  ) => Promise<{ success: boolean; message: string }>;
}

export function createMockSessionCleanupService(): MockSessionCleanupService {
  return {
    async deleteGitHubBranch(_token, _owner, _repo, _branch) {
      return { success: true, message: 'Branch deleted' };
    },
    async archiveClaudeRemoteSession(_sessionId, _claudeAuth, _environmentId) {
      return { success: true, message: 'Session archived' };
    },
  };
}

/**
 * Mock SSE Helper
 */
export interface MockSseHelper {
  write: (res: unknown, data: string) => boolean;
  close: (res: unknown) => void;
}

export function createMockSseHelper(): MockSseHelper {
  return {
    write(_res, _data) {
      return true;
    },
    close(_res) {
      // No-op
    },
  };
}

/**
 * Mock Session Event Broadcaster
 */
export interface MockSessionEventBroadcaster {
  isSessionActive: (sessionId: string) => boolean;
  subscribe: (
    sessionId: string,
    subscriberId: string,
    callback: (event: { eventType: string; data: unknown }) => void
  ) => () => void;
  broadcast: (sessionId: string, event: { eventType: string; data: unknown }) => void;
}

export function createMockSessionEventBroadcaster(): MockSessionEventBroadcaster {
  const activeSubscriptions = new Map<string, Map<string, (event: { eventType: string; data: unknown }) => void>>();
  const activeSessions = new Set<string>();

  return {
    isSessionActive(sessionId) {
      return activeSessions.has(sessionId);
    },
    subscribe(sessionId, subscriberId, callback) {
      if (!activeSubscriptions.has(sessionId)) {
        activeSubscriptions.set(sessionId, new Map());
      }
      activeSubscriptions.get(sessionId)!.set(subscriberId, callback);
      activeSessions.add(sessionId);

      return () => {
        const subs = activeSubscriptions.get(sessionId);
        if (subs) {
          subs.delete(subscriberId);
          if (subs.size === 0) {
            activeSubscriptions.delete(sessionId);
            activeSessions.delete(sessionId);
          }
        }
      };
    },
    broadcast(sessionId, event) {
      const subs = activeSubscriptions.get(sessionId);
      if (subs) {
        for (const callback of subs.values()) {
          callback(event);
        }
      }
    },
  };
}

/**
 * Combined mock services container
 */
export interface MockServices {
  sessionQueryService: MockSessionQueryService;
  sessionAuthorizationService: MockSessionAuthorizationService;
  eventStorageService: MockEventStorageService;
  sessionCleanupService: MockSessionCleanupService;
  sseHelper: MockSseHelper;
  sessionEventBroadcaster: MockSessionEventBroadcaster;
}

export function createMockServices(db: MockDb): MockServices {
  return {
    sessionQueryService: createMockSessionQueryService(db),
    sessionAuthorizationService: createMockSessionAuthorizationService(),
    eventStorageService: createMockEventStorageService(db),
    sessionCleanupService: createMockSessionCleanupService(),
    sseHelper: createMockSseHelper(),
    sessionEventBroadcaster: createMockSessionEventBroadcaster(),
  };
}
