/**
 * Mock Database Utilities
 *
 * Provides mock implementations for database operations used in route handlers.
 * Uses a simple in-memory store for testing without requiring a real database.
 */

import type { MockChatSession, MockEvent, MockMessage } from './testApp.js';
import { createMockChatSession, createMockEvent, createMockMessage } from './testApp.js';

/**
 * In-memory storage for mock database
 */
export interface MockDbState {
  sessions: Map<string, MockChatSession>;
  events: Map<string, MockEvent[]>;
  messages: Map<string, MockMessage[]>;
}

/**
 * Creates a fresh mock database state
 */
export function createMockDbState(): MockDbState {
  return {
    sessions: new Map(),
    events: new Map(),
    messages: new Map(),
  };
}

/**
 * Mock Database Implementation
 *
 * Provides CRUD operations backed by in-memory storage.
 * Useful for integration tests that need database behavior without a real database.
 */
export class MockDb {
  private state: MockDbState;

  constructor(initialState?: MockDbState) {
    this.state = initialState || createMockDbState();
  }

  // Session operations

  createSession(data: Partial<MockChatSession>): MockChatSession {
    const session = createMockChatSession(data);
    this.state.sessions.set(session.id, session);
    return session;
  }

  getSession(id: string): MockChatSession | null {
    return this.state.sessions.get(id) || null;
  }

  getSessionByShareToken(token: string): MockChatSession | null {
    for (const session of this.state.sessions.values()) {
      if (session.shareToken === token && !session.deletedAt) {
        return session;
      }
    }
    return null;
  }

  getSessionsByUserId(userId: string): MockChatSession[] {
    const result: MockChatSession[] = [];
    for (const session of this.state.sessions.values()) {
      if (session.userId === userId && !session.deletedAt) {
        result.push(session);
      }
    }
    return result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  updateSession(id: string, updates: Partial<MockChatSession>): MockChatSession | null {
    const session = this.state.sessions.get(id);
    if (!session) return null;

    const updated = { ...session, ...updates };
    this.state.sessions.set(id, updated);
    return updated;
  }

  deleteSession(id: string): boolean {
    const session = this.state.sessions.get(id);
    if (!session) return false;

    // Soft delete using immutable update
    const updated = { ...session, deletedAt: new Date() };
    this.state.sessions.set(id, updated);
    return true;
  }

  hardDeleteSession(id: string): boolean {
    return this.state.sessions.delete(id);
  }

  // Event operations

  createEvent(data: Partial<MockEvent>): MockEvent {
    const event = createMockEvent(data);
    const sessionId = event.chatSessionId;

    if (!this.state.events.has(sessionId)) {
      this.state.events.set(sessionId, []);
    }

    this.state.events.get(sessionId)!.push(event);
    return event;
  }

  getEvents(sessionId: string): MockEvent[] {
    return this.state.events.get(sessionId) || [];
  }

  // Message operations

  createMessage(data: Partial<MockMessage>): MockMessage {
    const message = createMockMessage(data);
    const sessionId = message.chatSessionId;

    if (!this.state.messages.has(sessionId)) {
      this.state.messages.set(sessionId, []);
    }

    this.state.messages.get(sessionId)!.push(message);
    return message;
  }

  getMessages(sessionId: string): MockMessage[] {
    return this.state.messages.get(sessionId) || [];
  }

  // Utility methods

  clear(): void {
    this.state.sessions.clear();
    this.state.events.clear();
    this.state.messages.clear();
  }

  getState(): MockDbState {
    return this.state;
  }

  /**
   * Seeds the database with test data
   */
  seed(data: {
    sessions?: Partial<MockChatSession>[];
    events?: Partial<MockEvent>[];
    messages?: Partial<MockMessage>[];
  }): void {
    if (data.sessions) {
      for (const session of data.sessions) {
        this.createSession(session);
      }
    }
    if (data.events) {
      for (const event of data.events) {
        this.createEvent(event);
      }
    }
    if (data.messages) {
      for (const msg of data.messages) {
        this.createMessage(msg);
      }
    }
  }
}

/**
 * Creates a configured mock database with optional seed data
 */
export function createMockDb(seedData?: {
  sessions?: Partial<MockChatSession>[];
  events?: Partial<MockEvent>[];
  messages?: Partial<MockMessage>[];
}): MockDb {
  const db = new MockDb();
  if (seedData) {
    db.seed(seedData);
  }
  return db;
}
