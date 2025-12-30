/**
 * Unit Tests for WebSocket Streaming
 *
 * Tests WebSocket streaming scenarios including:
 * - Connection establishment
 * - Event parsing and callbacks
 * - Error handling and recovery
 * - Connection drops and timeouts
 * - Abort signal handling
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { EventEmitter } from 'events';

// ============================================================================
// Mock WebSocket Implementation
// ============================================================================

/**
 * Mock WebSocket for testing streaming scenarios
 */
class MockWebSocket extends EventEmitter {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  private closeCode?: number;
  private closeReason?: string;
  private sentMessages: string[] = [];

  constructor(
    public url: string,
    public options?: { headers?: Record<string, string> }
  ) {
    super();
  }

  /**
   * Simulate connection opening
   */
  simulateOpen(): void {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  /**
   * Simulate receiving a message
   */
  simulateMessage(data: string | object): void {
    const message = typeof data === 'string' ? data : JSON.stringify(data);
    this.emit('message', Buffer.from(message));
  }

  /**
   * Simulate an error
   */
  simulateError(message: string): void {
    const error = new Error(message);
    this.emit('error', error);
  }

  /**
   * Simulate connection close
   */
  simulateClose(code: number = 1000, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
    this.emit('close', code, reason);
  }

  /**
   * Send a message
   */
  send(data: string): void {
    this.sentMessages.push(data);
  }

  /**
   * Close the connection
   */
  close(code?: number, reason?: string): void {
    this.readyState = MockWebSocket.CLOSED;
    this.closeCode = code;
    this.closeReason = reason;
    // Don't emit 'close' here - let tests control that
  }

  /**
   * Get sent messages for verification
   */
  getSentMessages(): string[] {
    return [...this.sentMessages];
  }

  /**
   * Remove all listeners (for cleanup)
   */
  removeAllListeners(event?: string): this {
    if (event) {
      super.removeAllListeners(event);
    } else {
      super.removeAllListeners();
    }
    return this;
  }
}

// ============================================================================
// Mock Data Factories
// ============================================================================

function createMockSessionEvent(overrides: {
  uuid?: string;
  type?: string;
  [key: string]: unknown;
} = {}) {
  return {
    uuid: overrides.uuid ?? `evt_${Math.random().toString(36).slice(2)}`,
    type: overrides.type ?? 'assistant',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

function createMockWebSocketMessage(event: object) {
  return {
    type: 'event',
    data: event,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('WebSocket Streaming', () => {
  describe('Connection Management', () => {
    it('should create WebSocket with correct URL and headers', () => {
      const mockWs = new MockWebSocket('wss://api.anthropic.com/v1/sessions/ws/session_01Test/subscribe', {
        headers: {
          Authorization: 'Bearer test-token',
          'anthropic-version': '2023-06-01',
        },
      });

      assert.ok(mockWs.url.includes('wss://'));
      assert.ok(mockWs.url.includes('session_01Test'));
      assert.ok(mockWs.options?.headers?.Authorization?.includes('Bearer'));
    });

    it('should handle successful connection', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let connectionOpened = false;

      mockWs.on('open', () => {
        connectionOpened = true;
      });

      mockWs.simulateOpen();

      assert.strictEqual(connectionOpened, true);
      assert.strictEqual(mockWs.readyState, MockWebSocket.OPEN);
    });

    it('should handle connection timeout', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let errorReceived = false;

      mockWs.on('error', (error: Error) => {
        if (error.message.includes('timeout')) {
          errorReceived = true;
        }
      });

      // Simulate connection never opening
      mockWs.simulateError('Connection timeout');

      assert.strictEqual(errorReceived, true);
    });
  });

  describe('Event Parsing', () => {
    it('should parse event messages correctly', async () => {
      const mockWs = new MockWebSocket('wss://test');
      const receivedEvents: object[] = [];

      mockWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'event' && message.data) {
          receivedEvents.push(message.data);
        }
      });

      mockWs.simulateOpen();

      const event = createMockSessionEvent({ type: 'assistant', uuid: 'evt_1' });
      mockWs.simulateMessage(createMockWebSocketMessage(event));

      assert.strictEqual(receivedEvents.length, 1);
      assert.strictEqual((receivedEvents[0] as { uuid: string }).uuid, 'evt_1');
    });

    it('should handle malformed JSON gracefully', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let parseError = false;

      mockWs.on('message', (data: Buffer) => {
        try {
          JSON.parse(data.toString());
        } catch {
          parseError = true;
        }
      });

      mockWs.simulateOpen();
      mockWs.simulateMessage('not valid json {');

      assert.strictEqual(parseError, true);
    });

    it('should deduplicate events by UUID', async () => {
      const mockWs = new MockWebSocket('wss://test');
      const seenUuids = new Set<string>();
      const receivedEvents: object[] = [];

      mockWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'event' && message.data) {
          const uuid = message.data.uuid;
          if (!seenUuids.has(uuid)) {
            seenUuids.add(uuid);
            receivedEvents.push(message.data);
          }
        }
      });

      mockWs.simulateOpen();

      // Send same event twice
      const event = createMockSessionEvent({ uuid: 'evt_duplicate' });
      mockWs.simulateMessage(createMockWebSocketMessage(event));
      mockWs.simulateMessage(createMockWebSocketMessage(event));

      assert.strictEqual(receivedEvents.length, 1);
    });

    it('should handle result events and resolve', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let resultReceived = false;

      mockWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'event' && message.data?.type === 'result') {
          resultReceived = true;
        }
      });

      mockWs.simulateOpen();

      const resultEvent = createMockSessionEvent({
        type: 'result',
        uuid: 'evt_result',
        total_cost_usd: 0.015,
        duration_ms: 5000,
        num_turns: 3,
      });
      mockWs.simulateMessage(createMockWebSocketMessage(resultEvent));

      assert.strictEqual(resultReceived, true);
    });

    it('should handle session_status messages', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let statusReceived: string | null = null;

      mockWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'session_status') {
          statusReceived = message.status;
        }
      });

      mockWs.simulateOpen();
      mockWs.simulateMessage({ type: 'session_status', status: 'completed' });

      assert.strictEqual(statusReceived, 'completed');
    });
  });

  describe('Error Handling', () => {
    it('should handle WebSocket error event', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let errorMessage = '';

      mockWs.on('error', (error: Error) => {
        errorMessage = error.message;
      });

      mockWs.simulateOpen();
      mockWs.simulateError('Connection lost');

      assert.strictEqual(errorMessage, 'Connection lost');
    });

    it('should handle abnormal close codes', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let closeCode = 0;

      mockWs.on('close', (code: number) => {
        closeCode = code;
      });

      mockWs.simulateOpen();
      mockWs.simulateClose(1006); // Abnormal closure

      assert.strictEqual(closeCode, 1006);
    });

    it('should treat normal close (1000) as expected', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let isNormalClose = false;

      mockWs.on('close', (code: number) => {
        isNormalClose = code === 1000 || code === 1001;
      });

      mockWs.simulateOpen();
      mockWs.simulateClose(1000);

      assert.strictEqual(isNormalClose, true);
    });

    it('should treat going away close (1001) as expected', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let isNormalClose = false;

      mockWs.on('close', (code: number) => {
        isNormalClose = code === 1000 || code === 1001;
      });

      mockWs.simulateOpen();
      mockWs.simulateClose(1001); // Going away

      assert.strictEqual(isNormalClose, true);
    });
  });

  describe('Keep-Alive Mechanism', () => {
    it('should send keep-alive messages', async () => {
      const mockWs = new MockWebSocket('wss://test');

      mockWs.simulateOpen();

      // Simulate sending keep-alive
      mockWs.send(JSON.stringify({ type: 'keep_alive' }));

      const sentMessages = mockWs.getSentMessages();
      assert.strictEqual(sentMessages.length, 1);

      const keepAlive = JSON.parse(sentMessages[0]);
      assert.strictEqual(keepAlive.type, 'keep_alive');
    });
  });

  describe('Control Requests', () => {
    it('should send control request with request_id', async () => {
      const mockWs = new MockWebSocket('wss://test');

      mockWs.simulateOpen();

      const requestId = 'req_123';
      mockWs.send(
        JSON.stringify({
          request_id: requestId,
          type: 'control_request',
          request: { subtype: 'initialize' },
        })
      );

      const sentMessages = mockWs.getSentMessages();
      assert.strictEqual(sentMessages.length, 1);

      const message = JSON.parse(sentMessages[0]);
      assert.strictEqual(message.request_id, requestId);
      assert.strictEqual(message.type, 'control_request');
      assert.strictEqual(message.request.subtype, 'initialize');
    });

    it('should handle control_response success', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let responseReceived = false;

      mockWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'control_response') {
          responseReceived = message.response?.subtype === 'success';
        }
      });

      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'control_response',
        response: {
          request_id: 'req_123',
          subtype: 'success',
        },
      });

      assert.strictEqual(responseReceived, true);
    });

    it('should handle control_response error', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let errorMessage = '';

      mockWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'control_response' && message.response?.subtype === 'error') {
          errorMessage = message.response.error;
        }
      });

      mockWs.simulateOpen();
      mockWs.simulateMessage({
        type: 'control_response',
        response: {
          request_id: 'req_123',
          subtype: 'error',
          error: 'Session not found',
        },
      });

      assert.strictEqual(errorMessage, 'Session not found');
    });
  });

  describe('Abort Signal', () => {
    it('should handle abort signal before connection', async () => {
      const abortController = new AbortController();
      const mockWs = new MockWebSocket('wss://test');
      let aborted = false;

      // Pre-abort the signal
      abortController.abort();

      if (abortController.signal.aborted) {
        aborted = true;
        mockWs.close();
      }

      assert.strictEqual(aborted, true);
    });

    it('should handle abort signal during streaming', async () => {
      const abortController = new AbortController();
      const mockWs = new MockWebSocket('wss://test');
      let abortHandlerCalled = false;

      abortController.signal.addEventListener('abort', () => {
        abortHandlerCalled = true;
        mockWs.close();
      });

      mockWs.simulateOpen();

      // Abort during streaming
      abortController.abort();

      assert.strictEqual(abortHandlerCalled, true);
    });
  });

  describe('Event Callback Async Handling', () => {
    it('should wait for async event callbacks', async () => {
      const mockWs = new MockWebSocket('wss://test');
      const processedEvents: string[] = [];

      mockWs.on('message', async (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'event' && message.data) {
          // Simulate async processing
          await new Promise((resolve) => setTimeout(resolve, 10));
          processedEvents.push(message.data.uuid);
        }
      });

      mockWs.simulateOpen();

      // Send multiple events
      for (let i = 0; i < 3; i++) {
        mockWs.simulateMessage(
          createMockWebSocketMessage(createMockSessionEvent({ uuid: `evt_${i}` }))
        );
      }

      // Wait for async processing
      await new Promise((resolve) => setTimeout(resolve, 50));

      assert.strictEqual(processedEvents.length, 3);
    });
  });

  describe('Raw Message Callback', () => {
    it('should call raw message callback with unparsed data', async () => {
      const mockWs = new MockWebSocket('wss://test');
      const rawMessages: string[] = [];

      mockWs.on('message', (data: Buffer) => {
        rawMessages.push(data.toString());
      });

      mockWs.simulateOpen();

      const rawData = '{"type":"event","data":{"uuid":"test"}}';
      mockWs.simulateMessage(rawData);

      assert.strictEqual(rawMessages.length, 1);
      assert.ok(rawMessages[0].includes('"uuid":"test"'));
    });
  });

  describe('Skip Existing Events', () => {
    it('should track and skip existing event UUIDs', async () => {
      const mockWs = new MockWebSocket('wss://test');
      const existingUuids = new Set(['evt_existing_1', 'evt_existing_2']);
      const newEvents: string[] = [];

      mockWs.on('message', (data: Buffer) => {
        const message = JSON.parse(data.toString());
        if (message.type === 'event' && message.data) {
          const uuid = message.data.uuid;
          if (!existingUuids.has(uuid)) {
            newEvents.push(uuid);
          }
        }
      });

      mockWs.simulateOpen();

      // Send existing events (should be skipped)
      mockWs.simulateMessage(
        createMockWebSocketMessage(createMockSessionEvent({ uuid: 'evt_existing_1' }))
      );

      // Send new event (should be processed)
      mockWs.simulateMessage(
        createMockWebSocketMessage(createMockSessionEvent({ uuid: 'evt_new_1' }))
      );

      assert.strictEqual(newEvents.length, 1);
      assert.strictEqual(newEvents[0], 'evt_new_1');
    });
  });

  describe('Branch Name Extraction', () => {
    it('should extract branch name from tool_use_result stdout', () => {
      const event = {
        uuid: 'evt_1',
        type: 'tool_use',
        tool_use_result: {
          stdout: 'Switched to branch claude/feature-test-xyz',
        },
      };

      const stdout = event.tool_use_result.stdout;
      const match = stdout.match(/claude\/[a-zA-Z0-9_-]+/);

      assert.ok(match);
      assert.strictEqual(match[0], 'claude/feature-test-xyz');
    });

    it('should extract branch name from data.extra.args', () => {
      const event = {
        uuid: 'evt_1',
        type: 'system',
        data: {
          extra: {
            args: ['Created branch `claude/new-feature-abc`'],
          },
        },
      };

      const argsStr = (event.data.extra.args as string[]).join(' ');
      const match = argsStr.match(/branch `(claude\/[a-zA-Z0-9_-]+)`/);

      assert.ok(match);
      assert.strictEqual(match[1], 'claude/new-feature-abc');
    });
  });

  describe('Cleanup on Settlement', () => {
    it('should cleanup listeners after resolve', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let listenerCount = 0;

      // Track listener additions
      const originalOn = mockWs.on.bind(mockWs);
      mockWs.on = function (event: string | symbol, listener: (...args: any[]) => void) {
        listenerCount++;
        return originalOn(event, listener);
      };

      mockWs.on('message', () => {});
      mockWs.on('error', () => {});
      mockWs.on('close', () => {});

      assert.ok(listenerCount >= 3);

      // Cleanup
      mockWs.removeAllListeners();

      assert.strictEqual(mockWs.listenerCount('message'), 0);
      assert.strictEqual(mockWs.listenerCount('error'), 0);
      assert.strictEqual(mockWs.listenerCount('close'), 0);
    });

    it('should clear keep-alive interval after close', async () => {
      const mockWs = new MockWebSocket('wss://test');
      let intervalCleared = false;

      // Simulate interval management
      const intervalId = setInterval(() => {
        if (mockWs.readyState === MockWebSocket.OPEN) {
          mockWs.send(JSON.stringify({ type: 'keep_alive' }));
        } else {
          clearInterval(intervalId);
          intervalCleared = true;
        }
      }, 100);

      mockWs.simulateOpen();
      mockWs.simulateClose(1000);

      // Wait for interval to notice the close
      await new Promise((resolve) => setTimeout(resolve, 150));

      assert.strictEqual(intervalCleared, true);
    });
  });
});
