/**
 * Integration Tests for SSE Streaming
 *
 * These tests verify Server-Sent Events (SSE) streaming functionality including:
 * - Event format and structure
 * - Event deduplication
 * - Heartbeat mechanism
 * - Event replay (resume)
 * - Event broadcasting
 * - Connection lifecycle
 *
 * Note: These tests use mock event streams and don't require actual SSE connections.
 *
 * Run these tests:
 *   npm run test:integration -w shared
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { randomUUID } from 'crypto';
import {
  createMockSSEEvent,
  createMockSystemEvent,
  createMockUserEvent,
  createMockAssistantEvent,
  createMockResultEvent,
  createMockTitleGenerationEvent,
  createMockChatSession,
  createSSEEventCollector,
  formatSSEEvent,
  parseSSEEventString,
  wait,
} from './fixtures.js';

// ============================================================================
// Mock SSE Stream Implementation
// ============================================================================

interface SSEWriteOptions {
  enableDeduplication?: boolean;
  heartbeatInterval?: number;
}

/**
 * Mock SSE Response Writer
 * Simulates the SSE response behavior of an Express response
 */
class MockSSEWriter {
  private buffer: string[] = [];
  private sentEventUuids: Set<string> = new Set();
  private closed = false;
  private enableDeduplication: boolean;
  private heartbeatInterval: number;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: SSEWriteOptions = {}) {
    this.enableDeduplication = options.enableDeduplication ?? true;
    this.heartbeatInterval = options.heartbeatInterval ?? 15000;
  }

  /**
   * Start heartbeat timer
   */
  startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      if (!this.closed) {
        this.writeHeartbeat();
      }
    }, this.heartbeatInterval);
  }

  /**
   * Stop heartbeat timer
   */
  stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Write an event to the stream
   */
  writeEvent(event: { type: string; data: unknown; uuid?: string }): boolean {
    if (this.closed) return false;

    // Check for duplicate UUIDs
    if (this.enableDeduplication && event.uuid) {
      if (this.sentEventUuids.has(event.uuid)) {
        return false; // Deduplicated
      }
      this.sentEventUuids.add(event.uuid);
    }

    const eventString = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
    this.buffer.push(eventString);
    return true;
  }

  /**
   * Write a heartbeat comment
   */
  writeHeartbeat(): void {
    if (!this.closed) {
      this.buffer.push(': heartbeat\n\n');
    }
  }

  /**
   * Write replay markers
   */
  writeReplayStart(): void {
    this.writeEvent({ type: 'replay_start', data: { timestamp: new Date().toISOString() } });
  }

  writeReplayEnd(eventCount: number): void {
    this.writeEvent({ type: 'replay_end', data: { eventCount, timestamp: new Date().toISOString() } });
  }

  writeLiveStreamStart(): void {
    this.writeEvent({ type: 'live_stream_start', data: { timestamp: new Date().toISOString() } });
  }

  /**
   * Close the stream
   */
  close(): void {
    this.closed = true;
    this.stopHeartbeat();
  }

  /**
   * Get all buffered content
   */
  getBuffer(): string[] {
    return [...this.buffer];
  }

  /**
   * Get full response text
   */
  getResponseText(): string {
    return this.buffer.join('');
  }

  /**
   * Get parsed events
   */
  getParsedEvents(): Array<{ type: string; data: unknown }> {
    return this.buffer
      .filter(chunk => chunk.startsWith('event:'))
      .map(chunk => parseSSEEventString(chunk))
      .filter((event): event is NonNullable<typeof event> => event !== null);
  }

  /**
   * Check if stream is closed
   */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Get count of deduplicated events
   */
  getDeduplicatedCount(): number {
    return this.sentEventUuids.size;
  }

  /**
   * Reset the writer
   */
  reset(): void {
    this.buffer = [];
    this.sentEventUuids.clear();
    this.closed = false;
  }
}

/**
 * Mock Event Broadcaster
 * Simulates the sessionEventBroadcaster behavior
 */
class MockEventBroadcaster {
  private subscribers: Map<string, Map<string, (event: unknown) => void>> = new Map();
  private activeSessions: Set<string> = new Set();

  /**
   * Subscribe to events for a session
   */
  subscribe(
    sessionId: string,
    subscriberId: string,
    callback: (event: unknown) => void
  ): () => void {
    if (!this.subscribers.has(sessionId)) {
      this.subscribers.set(sessionId, new Map());
    }
    this.subscribers.get(sessionId)!.set(subscriberId, callback);

    // Return unsubscribe function
    return () => {
      const sessionSubs = this.subscribers.get(sessionId);
      if (sessionSubs) {
        sessionSubs.delete(subscriberId);
        if (sessionSubs.size === 0) {
          this.subscribers.delete(sessionId);
        }
      }
    };
  }

  /**
   * Broadcast an event to all subscribers
   */
  broadcast(sessionId: string, event: unknown): void {
    const sessionSubs = this.subscribers.get(sessionId);
    if (sessionSubs) {
      for (const callback of sessionSubs.values()) {
        callback(event);
      }
    }
  }

  /**
   * Mark session as active
   */
  markActive(sessionId: string): void {
    this.activeSessions.add(sessionId);
  }

  /**
   * Mark session as inactive
   */
  markInactive(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  /**
   * Check if session is active
   */
  isSessionActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Get subscriber count for a session
   */
  getSubscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size || 0;
  }

  /**
   * Clear all subscriptions
   */
  clear(): void {
    this.subscribers.clear();
    this.activeSessions.clear();
  }
}

/**
 * Mock Event Store
 * Simulates the database event storage
 */
class MockEventStore {
  private events: Map<string, Array<{ uuid: string; type: string; data: unknown; timestamp: Date }>> = new Map();

  /**
   * Store an event
   */
  storeEvent(
    sessionId: string,
    event: { uuid: string; type: string; data: unknown }
  ): void {
    if (!this.events.has(sessionId)) {
      this.events.set(sessionId, []);
    }

    // Check for duplicates
    const existing = this.events.get(sessionId)!;
    if (!existing.some(e => e.uuid === event.uuid)) {
      existing.push({
        ...event,
        timestamp: new Date(),
      });
    }
  }

  /**
   * Get events for a session
   */
  getEvents(sessionId: string): Array<{ uuid: string; type: string; data: unknown; timestamp: Date }> {
    return this.events.get(sessionId) || [];
  }

  /**
   * Get event UUIDs for a session
   */
  getEventUuids(sessionId: string): Set<string> {
    return new Set(this.getEvents(sessionId).map(e => e.uuid));
  }

  /**
   * Clear events for a session
   */
  clearSession(sessionId: string): void {
    this.events.delete(sessionId);
  }

  /**
   * Clear all events
   */
  clear(): void {
    this.events.clear();
  }
}

// ============================================================================
// Test Suites
// ============================================================================

describe('SSE Streaming Integration Tests', () => {
  let sseWriter: MockSSEWriter;
  let broadcaster: MockEventBroadcaster;
  let eventStore: MockEventStore;

  beforeEach(() => {
    sseWriter = new MockSSEWriter();
    broadcaster = new MockEventBroadcaster();
    eventStore = new MockEventStore();
  });

  afterEach(() => {
    sseWriter.close();
    broadcaster.clear();
    eventStore.clear();
  });

  describe('SSE Event Format', () => {
    it('should format events correctly', () => {
      const event = createMockSSEEvent({
        type: 'text',
        data: { content: 'Hello, world!' },
        uuid: 'test-uuid-123',
      });

      const formatted = formatSSEEvent(event);

      assert.ok(formatted.startsWith('event: text\n'));
      assert.ok(formatted.includes('data: '));
      assert.ok(formatted.endsWith('\n\n'));

      // Parse it back
      const parsed = parseSSEEventString(formatted);
      assert.ok(parsed);
      assert.strictEqual(parsed.type, 'text');
      assert.deepStrictEqual(parsed.data, { content: 'Hello, world!' });
    });

    it('should write events with correct format', () => {
      sseWriter.writeEvent({
        type: 'system',
        data: { message: 'Connected' },
        uuid: randomUUID(),
      });

      const buffer = sseWriter.getBuffer();
      assert.strictEqual(buffer.length, 1);
      assert.ok(buffer[0].startsWith('event: system\n'));
      assert.ok(buffer[0].includes('data: {"message":"Connected"}'));
    });

    it('should write heartbeat comments', () => {
      sseWriter.writeHeartbeat();

      const buffer = sseWriter.getBuffer();
      assert.strictEqual(buffer.length, 1);
      assert.strictEqual(buffer[0], ': heartbeat\n\n');
    });

    it('should handle complex event data', () => {
      const complexData = {
        content: 'Test message',
        nested: {
          level1: {
            level2: 'deep value',
          },
        },
        array: [1, 2, 3],
        boolean: true,
        number: 42.5,
      };

      sseWriter.writeEvent({
        type: 'complex',
        data: complexData,
        uuid: randomUUID(),
      });

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual(parsed.length, 1);
      assert.deepStrictEqual(parsed[0].data, complexData);
    });
  });

  describe('Event Deduplication', () => {
    it('should deduplicate events by UUID', () => {
      const uuid = randomUUID();

      const written1 = sseWriter.writeEvent({
        type: 'text',
        data: { content: 'First' },
        uuid,
      });

      const written2 = sseWriter.writeEvent({
        type: 'text',
        data: { content: 'Second (duplicate)' },
        uuid,
      });

      assert.strictEqual(written1, true);
      assert.strictEqual(written2, false);
      assert.strictEqual(sseWriter.getBuffer().length, 1);
    });

    it('should allow different UUIDs', () => {
      sseWriter.writeEvent({
        type: 'text',
        data: { content: 'First' },
        uuid: randomUUID(),
      });

      sseWriter.writeEvent({
        type: 'text',
        data: { content: 'Second' },
        uuid: randomUUID(),
      });

      assert.strictEqual(sseWriter.getBuffer().length, 2);
    });

    it('should track deduplicated count', () => {
      const uuid1 = randomUUID();
      const uuid2 = randomUUID();

      sseWriter.writeEvent({ type: 'text', data: {}, uuid: uuid1 });
      sseWriter.writeEvent({ type: 'text', data: {}, uuid: uuid1 }); // duplicate
      sseWriter.writeEvent({ type: 'text', data: {}, uuid: uuid2 });
      sseWriter.writeEvent({ type: 'text', data: {}, uuid: uuid1 }); // duplicate

      assert.strictEqual(sseWriter.getDeduplicatedCount(), 2);
    });

    it('should allow events without UUID when deduplication is disabled', () => {
      const writer = new MockSSEWriter({ enableDeduplication: false });

      writer.writeEvent({ type: 'text', data: { v: 1 } });
      writer.writeEvent({ type: 'text', data: { v: 2 } });

      assert.strictEqual(writer.getBuffer().length, 2);
    });

    it('should deduplicate in event store', () => {
      const sessionId = 'session-123';
      const uuid = randomUUID();

      eventStore.storeEvent(sessionId, { uuid, type: 'text', data: { v: 1 } });
      eventStore.storeEvent(sessionId, { uuid, type: 'text', data: { v: 2 } }); // duplicate

      const events = eventStore.getEvents(sessionId);
      assert.strictEqual(events.length, 1);
      assert.deepStrictEqual(events[0].data, { v: 1 }); // First one kept
    });
  });

  describe('Replay Markers', () => {
    it('should write replay start marker', () => {
      sseWriter.writeReplayStart();

      const events = sseWriter.getParsedEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'replay_start');
      assert.ok((events[0].data as Record<string, unknown>).timestamp);
    });

    it('should write replay end marker with count', () => {
      sseWriter.writeReplayEnd(10);

      const events = sseWriter.getParsedEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'replay_end');
      assert.strictEqual((events[0].data as Record<string, unknown>).eventCount, 10);
    });

    it('should write live stream start marker', () => {
      sseWriter.writeLiveStreamStart();

      const events = sseWriter.getParsedEvents();
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'live_stream_start');
    });

    it('should write markers in correct order for resume', () => {
      // Simulate resume flow
      sseWriter.writeReplayStart();

      // Replay stored events
      for (let i = 0; i < 3; i++) {
        sseWriter.writeEvent({
          type: 'text',
          data: { content: `Message ${i}` },
          uuid: randomUUID(),
        });
      }

      sseWriter.writeReplayEnd(3);
      sseWriter.writeLiveStreamStart();

      const events = sseWriter.getParsedEvents();
      assert.strictEqual(events[0].type, 'replay_start');
      assert.strictEqual(events[1].type, 'text');
      assert.strictEqual(events[2].type, 'text');
      assert.strictEqual(events[3].type, 'text');
      assert.strictEqual(events[4].type, 'replay_end');
      assert.strictEqual(events[5].type, 'live_stream_start');
    });
  });

  describe('Event Broadcasting', () => {
    it('should subscribe and receive events', () => {
      const sessionId = 'session-123';
      const received: unknown[] = [];

      broadcaster.subscribe(sessionId, 'subscriber-1', (event) => {
        received.push(event);
      });

      broadcaster.broadcast(sessionId, { type: 'text', data: 'Hello' });
      broadcaster.broadcast(sessionId, { type: 'text', data: 'World' });

      assert.strictEqual(received.length, 2);
    });

    it('should broadcast to multiple subscribers', () => {
      const sessionId = 'session-123';
      const received1: unknown[] = [];
      const received2: unknown[] = [];

      broadcaster.subscribe(sessionId, 'subscriber-1', (event) => {
        received1.push(event);
      });

      broadcaster.subscribe(sessionId, 'subscriber-2', (event) => {
        received2.push(event);
      });

      broadcaster.broadcast(sessionId, { type: 'text', data: 'Test' });

      assert.strictEqual(received1.length, 1);
      assert.strictEqual(received2.length, 1);
    });

    it('should unsubscribe correctly', () => {
      const sessionId = 'session-123';
      const received: unknown[] = [];

      const unsubscribe = broadcaster.subscribe(sessionId, 'subscriber-1', (event) => {
        received.push(event);
      });

      broadcaster.broadcast(sessionId, { type: 'text', data: 'Before' });
      unsubscribe();
      broadcaster.broadcast(sessionId, { type: 'text', data: 'After' });

      assert.strictEqual(received.length, 1);
    });

    it('should track active sessions', () => {
      const sessionId = 'session-123';

      assert.strictEqual(broadcaster.isSessionActive(sessionId), false);

      broadcaster.markActive(sessionId);
      assert.strictEqual(broadcaster.isSessionActive(sessionId), true);

      broadcaster.markInactive(sessionId);
      assert.strictEqual(broadcaster.isSessionActive(sessionId), false);
    });

    it('should isolate broadcasts between sessions', () => {
      const session1 = 'session-1';
      const session2 = 'session-2';
      const received1: unknown[] = [];
      const received2: unknown[] = [];

      broadcaster.subscribe(session1, 'sub-1', (event) => received1.push(event));
      broadcaster.subscribe(session2, 'sub-2', (event) => received2.push(event));

      broadcaster.broadcast(session1, { message: 'For session 1' });
      broadcaster.broadcast(session2, { message: 'For session 2' });

      assert.strictEqual(received1.length, 1);
      assert.strictEqual(received2.length, 1);
      assert.deepStrictEqual((received1[0] as Record<string, unknown>).message, 'For session 1');
      assert.deepStrictEqual((received2[0] as Record<string, unknown>).message, 'For session 2');
    });

    it('should track subscriber count', () => {
      const sessionId = 'session-123';

      assert.strictEqual(broadcaster.getSubscriberCount(sessionId), 0);

      const unsub1 = broadcaster.subscribe(sessionId, 'sub-1', () => {});
      assert.strictEqual(broadcaster.getSubscriberCount(sessionId), 1);

      broadcaster.subscribe(sessionId, 'sub-2', () => {});
      assert.strictEqual(broadcaster.getSubscriberCount(sessionId), 2);

      unsub1();
      assert.strictEqual(broadcaster.getSubscriberCount(sessionId), 1);
    });
  });

  describe('Event Store', () => {
    it('should store and retrieve events', () => {
      const sessionId = 'session-123';

      eventStore.storeEvent(sessionId, {
        uuid: randomUUID(),
        type: 'text',
        data: { content: 'Hello' },
      });

      const events = eventStore.getEvents(sessionId);
      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].type, 'text');
    });

    it('should get event UUIDs', () => {
      const sessionId = 'session-123';
      const uuid1 = randomUUID();
      const uuid2 = randomUUID();

      eventStore.storeEvent(sessionId, { uuid: uuid1, type: 'text', data: {} });
      eventStore.storeEvent(sessionId, { uuid: uuid2, type: 'text', data: {} });

      const uuids = eventStore.getEventUuids(sessionId);
      assert.ok(uuids.has(uuid1));
      assert.ok(uuids.has(uuid2));
      assert.strictEqual(uuids.size, 2);
    });

    it('should clear session events', () => {
      const sessionId = 'session-123';

      eventStore.storeEvent(sessionId, { uuid: randomUUID(), type: 'text', data: {} });
      eventStore.storeEvent(sessionId, { uuid: randomUUID(), type: 'text', data: {} });

      eventStore.clearSession(sessionId);

      assert.strictEqual(eventStore.getEvents(sessionId).length, 0);
    });

    it('should add timestamp to stored events', () => {
      const sessionId = 'session-123';
      const before = new Date();

      eventStore.storeEvent(sessionId, { uuid: randomUUID(), type: 'text', data: {} });

      const events = eventStore.getEvents(sessionId);
      assert.ok(events[0].timestamp >= before);
    });
  });

  describe('Stream Lifecycle', () => {
    it('should not write after close', () => {
      sseWriter.writeEvent({ type: 'text', data: {}, uuid: randomUUID() });
      sseWriter.close();

      const written = sseWriter.writeEvent({ type: 'text', data: {}, uuid: randomUUID() });

      assert.strictEqual(written, false);
      assert.strictEqual(sseWriter.getBuffer().length, 1);
    });

    it('should report closed state', () => {
      assert.strictEqual(sseWriter.isClosed(), false);
      sseWriter.close();
      assert.strictEqual(sseWriter.isClosed(), true);
    });

    it('should reset writer state', () => {
      sseWriter.writeEvent({ type: 'text', data: {}, uuid: randomUUID() });
      sseWriter.close();

      sseWriter.reset();

      assert.strictEqual(sseWriter.isClosed(), false);
      assert.strictEqual(sseWriter.getBuffer().length, 0);
      assert.strictEqual(sseWriter.getDeduplicatedCount(), 0);
    });
  });

  describe('Event Types', () => {
    it('should handle system events', () => {
      const event = createMockSystemEvent('Session started');

      sseWriter.writeEvent(event);

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual(parsed[0].type, 'system');
      assert.strictEqual((parsed[0].data as Record<string, unknown>).message, 'Session started');
    });

    it('should handle user events', () => {
      const event = createMockUserEvent('User prompt');

      sseWriter.writeEvent(event);

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual(parsed[0].type, 'user');
      assert.strictEqual((parsed[0].data as Record<string, unknown>).content, 'User prompt');
    });

    it('should handle assistant events', () => {
      const event = createMockAssistantEvent('Assistant response');

      sseWriter.writeEvent(event);

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual(parsed[0].type, 'assistant');
      assert.strictEqual((parsed[0].data as Record<string, unknown>).content, 'Assistant response');
    });

    it('should handle result events', () => {
      const event = createMockResultEvent({
        totalCost: 0.005,
        durationMs: 10000,
        status: 'completed',
      });

      sseWriter.writeEvent(event);

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual(parsed[0].type, 'result');
      assert.strictEqual((parsed[0].data as Record<string, unknown>).total_cost_usd, 0.005);
      assert.strictEqual((parsed[0].data as Record<string, unknown>).duration_ms, 10000);
    });

    it('should handle title generation events', () => {
      const event = createMockTitleGenerationEvent('Test Title', 'claude/test-branch');

      sseWriter.writeEvent(event);

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual(parsed[0].type, 'title_generation');
      assert.strictEqual((parsed[0].data as Record<string, unknown>).title, 'Test Title');
      assert.strictEqual((parsed[0].data as Record<string, unknown>).branch, 'claude/test-branch');
    });
  });

  describe('Full Execution Flow', () => {
    it('should simulate complete execution stream', () => {
      const session = createMockChatSession();
      const collector = createSSEEventCollector();

      // Simulate execution flow
      const events = [
        createMockSystemEvent('Session connected'),
        createMockUserEvent('Write a hello world function'),
        createMockTitleGenerationEvent('Hello World Function', 'claude/hello-world'),
        createMockAssistantEvent('I\'ll create a simple hello world function...'),
        createMockAssistantEvent('function helloWorld() { console.log("Hello!"); }'),
        createMockResultEvent({ totalCost: 0.002, durationMs: 5000, status: 'completed' }),
      ];

      for (const event of events) {
        sseWriter.writeEvent(event);
        collector.callback(event);
      }

      // Verify all events written
      assert.strictEqual(sseWriter.getBuffer().length, 6);
      assert.strictEqual(collector.events.length, 6);

      // Verify event types
      assert.ok(collector.hasEventType('system'));
      assert.ok(collector.hasEventType('user'));
      assert.ok(collector.hasEventType('title_generation'));
      assert.ok(collector.hasEventType('assistant'));
      assert.ok(collector.hasEventType('result'));

      // Verify last event is result
      const lastEvent = collector.getLastEvent();
      assert.strictEqual(lastEvent?.type, 'result');
    });

    it('should simulate resume flow with replay', () => {
      const sessionId = 'session-123';

      // Store some events (from previous execution)
      const storedEvents = [
        { uuid: randomUUID(), type: 'system', data: { message: 'Started' } },
        { uuid: randomUUID(), type: 'user', data: { content: 'Original prompt' } },
        { uuid: randomUUID(), type: 'assistant', data: { content: 'Working...' } },
      ];

      for (const event of storedEvents) {
        eventStore.storeEvent(sessionId, event);
      }

      // Simulate resume: replay stored events
      sseWriter.writeReplayStart();

      const existingUuids = eventStore.getEventUuids(sessionId);
      for (const event of eventStore.getEvents(sessionId)) {
        sseWriter.writeEvent(event);
      }

      sseWriter.writeReplayEnd(storedEvents.length);
      sseWriter.writeLiveStreamStart();

      // Simulate new events from live stream
      const newEvents = [
        { uuid: randomUUID(), type: 'assistant', data: { content: 'Continuing...' } },
        { uuid: randomUUID(), type: 'result', data: { status: 'completed' } },
      ];

      for (const event of newEvents) {
        // Only write if not already sent
        if (!existingUuids.has(event.uuid)) {
          sseWriter.writeEvent(event);
          eventStore.storeEvent(sessionId, event);
        }
      }

      // Verify replay structure
      const events = sseWriter.getParsedEvents();
      assert.strictEqual(events[0].type, 'replay_start');
      // After replay_start (1) + stored events (3), replay_end is at index 4
      assert.strictEqual(events[storedEvents.length + 1].type, 'replay_end');
      // live_stream_start is at index 5
      assert.strictEqual(events[storedEvents.length + 2].type, 'live_stream_start');
      // result is the last event
      assert.strictEqual(events[events.length - 1].type, 'result');
    });

    it('should handle deduplication during resume with live events', () => {
      const sessionId = 'session-123';
      const sharedUuid = randomUUID();

      // Store event
      eventStore.storeEvent(sessionId, {
        uuid: sharedUuid,
        type: 'assistant',
        data: { content: 'Original' },
      });

      // Replay stored event
      sseWriter.writeReplayStart();
      for (const event of eventStore.getEvents(sessionId)) {
        sseWriter.writeEvent(event);
      }
      sseWriter.writeReplayEnd(1);

      // Try to write same event as "live" (should be deduplicated)
      const written = sseWriter.writeEvent({
        uuid: sharedUuid,
        type: 'assistant',
        data: { content: 'Duplicate' },
      });

      assert.strictEqual(written, false);
      assert.strictEqual(sseWriter.getDeduplicatedCount(), 1); // Only 1 unique UUID
    });
  });

  describe('Error Handling', () => {
    it('should handle JSON serialization of special values', () => {
      // undefined values are removed in JSON.stringify
      const event = {
        type: 'text',
        data: {
          defined: 'value',
          nested: { a: 1 },
        },
        uuid: randomUUID(),
      };

      sseWriter.writeEvent(event);

      const parsed = sseWriter.getParsedEvents();
      assert.ok(parsed[0]);
    });

    it('should handle empty data', () => {
      sseWriter.writeEvent({
        type: 'ping',
        data: {},
        uuid: randomUUID(),
      });

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual(parsed.length, 1);
      assert.deepStrictEqual(parsed[0].data, {});
    });

    it('should handle array data', () => {
      sseWriter.writeEvent({
        type: 'list',
        data: [1, 2, 3],
        uuid: randomUUID(),
      });

      const parsed = sseWriter.getParsedEvents();
      assert.deepStrictEqual(parsed[0].data, [1, 2, 3]);
    });
  });

  describe('Correlation Context', () => {
    it('should include correlation ID in events', () => {
      const correlationId = randomUUID();

      sseWriter.writeEvent({
        type: 'text',
        data: {
          content: 'Test',
          correlationId,
        },
        uuid: randomUUID(),
      });

      const parsed = sseWriter.getParsedEvents();
      assert.strictEqual((parsed[0].data as Record<string, unknown>).correlationId, correlationId);
    });

    it('should propagate correlation ID across events', () => {
      const correlationId = randomUUID();

      const events = [
        createMockSystemEvent('Start'),
        createMockUserEvent('Prompt'),
        createMockAssistantEvent('Response'),
      ].map(e => ({
        ...e,
        data: { ...(e.data as Record<string, unknown>), correlationId },
      }));

      for (const event of events) {
        sseWriter.writeEvent(event);
      }

      const parsed = sseWriter.getParsedEvents();
      for (const event of parsed) {
        assert.strictEqual((event.data as Record<string, unknown>).correlationId, correlationId);
      }
    });
  });
});
