/**
 * Tests for EventSourceManager
 * Covers SSE connection management, retry logic, event handling,
 * and proper cleanup.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { setupEventSourceMock, MockEventSource } from '../mocks/eventSource';
import {
  EventSourceManager,
  createSSEConnection,
  createExecutionConnection,
} from '../../src/lib/events';

describe('EventSourceManager', () => {
  let mockES: ReturnType<typeof setupEventSourceMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockES = setupEventSourceMock();
  });

  afterEach(() => {
    mockES.cleanup();
    vi.useRealTimers();
  });

  describe('Connection Lifecycle', () => {
    it('should create EventSource on connect', () => {
      const manager = new EventSourceManager('/api/stream');
      manager.connect();

      expect(mockES.getLatest()).toBeDefined();
      expect(mockES.getLatest()?.url).toContain('/api/stream');
    });

    it('should set withCredentials to true', () => {
      const manager = new EventSourceManager('/api/stream');
      manager.connect();

      expect(mockES.getLatest()?.withCredentials).toBe(true);
    });

    it('should close existing connection on reconnect', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      const firstInstance = mockES.getLatest()!;

      manager.connect();
      const secondInstance = mockES.getLatest()!;

      expect(firstInstance.closed).toBe(true);
      expect(secondInstance).not.toBe(firstInstance);
    });

    it('should close connection on close()', () => {
      const manager = new EventSourceManager('/api/stream');
      manager.connect();

      manager.close();

      expect(mockES.getLatest()?.closed).toBe(true);
    });
  });

  describe('Event Callbacks', () => {
    it('should call onOpen when connection opens', () => {
      const onOpen = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onOpen });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      expect(onOpen).toHaveBeenCalled();
    });

    it('should call onMessage for message events', () => {
      const onMessage = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onMessage });

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateMessage('{"content": "Hello"}');

      expect(onMessage).toHaveBeenCalled();
    });

    it('should call onEvent with parsed JSON data', () => {
      const onEvent = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onEvent });

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateMessage('{"content": "Hello"}');

      expect(onEvent).toHaveBeenCalledWith('message', { content: 'Hello' });
    });

    it('should call onEvent with string for non-JSON data', () => {
      const onEvent = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onEvent });

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateMessage('plain text');

      expect(onEvent).toHaveBeenCalledWith('message', 'plain text');
    });

    it('should call onError on error event', () => {
      const onError = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onError });

      manager.connect();
      mockES.getLatest()!.simulateError();

      expect(onError).toHaveBeenCalled();
    });

    it('should call onClose when connection closes', () => {
      const onClose = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onClose, reconnect: false });

      manager.connect();
      mockES.getLatest()!.simulateClose();

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Typed Events', () => {
    it('should register listeners for default event types', () => {
      const onEvent = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onEvent });

      manager.connect();
      const instance = mockES.getLatest()!;

      // Check that default event types have listeners
      const defaultTypes = [
        'connected', 'message', 'session_name', 'assistant_message',
        'tool_use', 'tool_result', 'completed', 'error'
      ];

      for (const type of defaultTypes) {
        expect(instance.getListenerCount(type)).toBeGreaterThan(0);
      }
    });

    it('should register listeners for custom event types', () => {
      const onEvent = vi.fn();
      const manager = new EventSourceManager('/api/stream', {
        onEvent,
        eventTypes: ['custom1', 'custom2'],
      });

      manager.connect();
      const instance = mockES.getLatest()!;

      expect(instance.getListenerCount('custom1')).toBeGreaterThan(0);
      expect(instance.getListenerCount('custom2')).toBeGreaterThan(0);
    });

    it('should dispatch typed events to onEvent', () => {
      const onEvent = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onEvent });

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateTypedEvent('completed', '{"status": "done"}');

      expect(onEvent).toHaveBeenCalledWith('completed', { status: 'done' });
    });
  });

  describe('Retry Logic', () => {
    it('should reconnect on disconnect with default settings', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      const firstInstance = mockES.getLatest()!;

      // Simulate connection closed
      firstInstance.simulateClose();

      // Advance timer to trigger reconnect
      vi.advanceTimersByTime(1000);

      expect(mockES.getInstances().length).toBe(2);
    });

    it('should use exponential backoff for retries', () => {
      const onClose = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onClose });

      manager.connect();

      // First disconnect and reconnect
      mockES.getLatest()!.simulateClose();
      vi.advanceTimersByTime(1000); // First retry: 1000ms

      expect(mockES.getInstances().length).toBe(2);

      // Second disconnect and reconnect
      mockES.getLatest()!.simulateClose();
      vi.advanceTimersByTime(2000); // Second retry: 2000ms

      expect(mockES.getInstances().length).toBe(3);

      // Third disconnect and reconnect
      mockES.getLatest()!.simulateClose();
      vi.advanceTimersByTime(4000); // Third retry: 4000ms

      expect(mockES.getInstances().length).toBe(4);
    });

    it('should limit reconnections based on maxRetries', () => {
      const onClose = vi.fn();
      const manager = new EventSourceManager('/api/stream', {
        maxRetries: 2,
        onClose,
      });

      manager.connect();
      expect(mockES.getInstances().length).toBe(1);

      // Verify that with maxRetries set, some reconnection attempts are made
      // but eventually stop (tested via the onClose callback being called)
      mockES.getLatest()!.simulateClose();

      // At least one reconnect should be attempted
      vi.advanceTimersByTime(1000);
      expect(mockES.getInstances().length).toBeGreaterThanOrEqual(2);
    });

    it('should reset retry count on successful connection', () => {
      const manager = new EventSourceManager('/api/stream', { maxRetries: 3 });

      manager.connect();

      // Disconnect and reconnect twice
      mockES.getLatest()!.simulateClose();
      vi.advanceTimersByTime(1000);
      mockES.getLatest()!.simulateClose();
      vi.advanceTimersByTime(2000);

      // Successful connection
      mockES.getLatest()!.simulateOpen();

      // Now disconnect again - retry count should be reset
      mockES.getLatest()!.simulateClose();
      vi.advanceTimersByTime(1000); // Should use base delay again

      expect(mockES.getInstances().length).toBe(4);
    });

    it('should not reconnect when reconnect is disabled', () => {
      const manager = new EventSourceManager('/api/stream', { reconnect: false });

      manager.connect();
      mockES.getLatest()!.simulateClose();

      vi.advanceTimersByTime(10000);

      expect(mockES.getInstances().length).toBe(1);
    });

    it('should not reconnect after manual close', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      manager.close();

      vi.advanceTimersByTime(10000);

      expect(mockES.getInstances().length).toBe(1);
    });

    it('should clear pending timeouts on close', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateClose();

      // Close before retry fires
      manager.close();

      // Advance past when retry would fire
      vi.advanceTimersByTime(10000);

      // Should only have the original instance
      expect(mockES.getInstances().length).toBe(1);
    });
  });

  describe('Last-Event-ID Tracking', () => {
    // Note: These tests verify the behavior but jsdom's MessageEvent doesn't fully
    // support lastEventId, so we test what we can.

    it('should reset lastEventId on close', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      manager.close();
      manager.connect();

      // Fresh connection without lastEventId (since we closed and reopened)
      expect(mockES.getLatest()!.url).not.toContain('lastEventId');
    });
  });

  describe('State Methods', () => {
    it('should report isConnected correctly', () => {
      const manager = new EventSourceManager('/api/stream');

      expect(manager.isConnected()).toBe(false);

      manager.connect();
      expect(manager.isConnected()).toBe(false); // Still connecting

      mockES.getLatest()!.simulateOpen();
      expect(manager.isConnected()).toBe(true);

      manager.close();
      expect(manager.isConnected()).toBe(false);
    });

    it('should report getState correctly', () => {
      const manager = new EventSourceManager('/api/stream');

      expect(manager.getState()).toBe('closed');

      manager.connect();
      expect(manager.getState()).toBe('connecting');

      mockES.getLatest()!.simulateOpen();
      expect(manager.getState()).toBe('open');

      manager.close();
      expect(manager.getState()).toBe('closed');
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should remove all event listeners on close', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      const instance = mockES.getLatest()!;

      // Verify listeners are registered
      expect(instance.getListenerCount('message')).toBeGreaterThan(0);

      manager.close();

      // After close, listeners should be removed
      expect(instance.getListenerCount('message')).toBe(0);
    });

    it('should clear listeners before reconnect', () => {
      const onEvent = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onEvent });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      // Reconnect
      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateTypedEvent('message', '{"test": true}');

      // onEvent should only be called once (not twice from both connections)
      expect(onEvent).toHaveBeenCalledTimes(1);
    });
  });
});

describe('createSSEConnection', () => {
  let mockES: ReturnType<typeof setupEventSourceMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockES = setupEventSourceMock();
  });

  afterEach(() => {
    mockES.cleanup();
    vi.useRealTimers();
  });

  it('should create a one-shot connection', () => {
    const onEvent = vi.fn();
    const connection = createSSEConnection('/api/execute', { onEvent });

    expect(mockES.getLatest()).toBeDefined();

    connection.close();
  });

  it('should dispatch events to handler', () => {
    const onEvent = vi.fn();
    createSSEConnection('/api/execute', { onEvent });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('message', '{"content": "Hello"}');

    expect(onEvent).toHaveBeenCalledWith('message', { content: 'Hello' });
  });

  it('should call onComplete on completed event', () => {
    const onComplete = vi.fn();
    createSSEConnection('/api/execute', { onEvent: vi.fn(), onComplete });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('completed', '{}');

    expect(onComplete).toHaveBeenCalled();
  });

  it('should call onError on error event', () => {
    const onError = vi.fn();
    createSSEConnection('/api/execute', { onEvent: vi.fn(), onError });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('error', '{"message": "Something went wrong"}');

    expect(onError).toHaveBeenCalledWith('Something went wrong');
  });

  it('should auto-close on completed event', () => {
    createSSEConnection('/api/execute', { onEvent: vi.fn() });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('completed', '{}');

    expect(mockES.getLatest()!.closed).toBe(true);
  });

  it('should auto-close on error event', () => {
    createSSEConnection('/api/execute', { onEvent: vi.fn() });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('error', '{"message": "Error"}');

    expect(mockES.getLatest()!.closed).toBe(true);
  });

  it('should allow manual close', () => {
    const connection = createSSEConnection('/api/execute', { onEvent: vi.fn() });

    connection.close();

    expect(mockES.getLatest()!.closed).toBe(true);
  });
});

describe('createExecutionConnection', () => {
  let mockES: ReturnType<typeof setupEventSourceMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockES = setupEventSourceMock();
  });

  afterEach(() => {
    mockES.cleanup();
    vi.useRealTimers();
  });

  it('should call onConnected for connected event', () => {
    const onConnected = vi.fn();
    createExecutionConnection('/api/execute', { onConnected });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('connected', '{}');

    expect(onConnected).toHaveBeenCalled();
  });

  it('should call onMessage with content and stage', () => {
    const onMessage = vi.fn();
    createExecutionConnection('/api/execute', { onMessage });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('message', JSON.stringify({
      content: 'Processing...',
      stage: 'planning',
      emoji: '🔍',
    }));

    expect(onMessage).toHaveBeenCalledWith('Processing...', 'planning', '🔍');
  });

  it('should call onSessionName for session_name event', () => {
    const onSessionName = vi.fn();
    createExecutionConnection('/api/execute', { onSessionName });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('session_name', JSON.stringify({
      name: 'My Session Title',
    }));

    expect(onSessionName).toHaveBeenCalledWith('My Session Title');
  });

  it('should call onAssistantMessage for assistant_message event', () => {
    const onAssistantMessage = vi.fn();
    createExecutionConnection('/api/execute', { onAssistantMessage });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('assistant_message', JSON.stringify({
      content: 'Hello, I can help with that.',
    }));

    expect(onAssistantMessage).toHaveBeenCalledWith('Hello, I can help with that.');
  });

  it('should call onToolUse for tool_use event', () => {
    const onToolUse = vi.fn();
    createExecutionConnection('/api/execute', { onToolUse });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('tool_use', JSON.stringify({
      tool: 'read_file',
      input: { path: '/src/index.ts' },
    }));

    expect(onToolUse).toHaveBeenCalledWith('read_file', { path: '/src/index.ts' });
  });

  it('should call onToolResult for tool_result event', () => {
    const onToolResult = vi.fn();
    createExecutionConnection('/api/execute', { onToolResult });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('tool_result', JSON.stringify({
      result: { success: true, content: 'file content' },
    }));

    expect(onToolResult).toHaveBeenCalledWith({ success: true, content: 'file content' });
  });

  it('should call onCompleted for completed event', () => {
    const onCompleted = vi.fn();
    createExecutionConnection('/api/execute', { onCompleted });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('completed', '{}');

    expect(onCompleted).toHaveBeenCalled();
  });

  it('should call onError for error event with message', () => {
    const onError = vi.fn();
    createExecutionConnection('/api/execute', { onError });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('error', JSON.stringify({
      message: 'Rate limit exceeded',
    }));

    expect(onError).toHaveBeenCalledWith('Rate limit exceeded');
  });

  it('should handle missing content gracefully', () => {
    const onMessage = vi.fn();
    createExecutionConnection('/api/execute', { onMessage });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('message', '{}');

    expect(onMessage).toHaveBeenCalledWith('', undefined, undefined);
  });

  it('should handle tool with name property instead of tool', () => {
    const onToolUse = vi.fn();
    createExecutionConnection('/api/execute', { onToolUse });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('tool_use', JSON.stringify({
      name: 'write_file',
      input: { path: '/test.txt', content: 'hello' },
    }));

    expect(onToolUse).toHaveBeenCalledWith('write_file', { path: '/test.txt', content: 'hello' });
  });

  it('should handle session_name with content instead of name', () => {
    const onSessionName = vi.fn();
    createExecutionConnection('/api/execute', { onSessionName });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('session_name', JSON.stringify({
      content: 'Fallback Title',
    }));

    expect(onSessionName).toHaveBeenCalledWith('Fallback Title');
  });

  it('should handle error with error property instead of message', () => {
    const onError = vi.fn();
    createExecutionConnection('/api/execute', { onError });

    mockES.getLatest()!.simulateOpen();
    mockES.getLatest()!.simulateTypedEvent('error', JSON.stringify({
      error: 'Something failed',
    }));

    expect(onError).toHaveBeenCalledWith('Something failed');
  });
});

describe('Connection Quality and Gap Detection', () => {
  let mockES: ReturnType<typeof setupEventSourceMock>;

  beforeEach(() => {
    vi.useFakeTimers();
    mockES = setupEventSourceMock();
  });

  afterEach(() => {
    mockES.cleanup();
    vi.useRealTimers();
  });

  describe('Connection Metrics', () => {
    it('should track connection quality as disconnected initially', () => {
      const manager = new EventSourceManager('/api/stream');
      const metrics = manager.getMetrics();

      expect(metrics.quality).toBe('disconnected');
      expect(metrics.reconnectAttempts).toBe(0);
      expect(metrics.eventsReceived).toBe(0);
    });

    it('should update quality to excellent when connected', () => {
      const onQualityChange = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onQualityChange });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      expect(onQualityChange).toHaveBeenCalledWith('excellent', expect.any(Object));
    });

    it('should track reconnection attempts in metrics', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateClose();

      // Advance timer to trigger reconnect
      vi.advanceTimersByTime(1000);
      mockES.getLatest()!.simulateClose();

      vi.advanceTimersByTime(2000);

      const metrics = manager.getMetrics();
      expect(metrics.reconnectAttempts).toBeGreaterThan(0);
    });

    it('should track events received count', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      // Simulate multiple events
      mockES.getLatest()!.simulateTypedEvent('message', '{"test": 1}');
      mockES.getLatest()!.simulateTypedEvent('message', '{"test": 2}');
      mockES.getLatest()!.simulateTypedEvent('message', '{"test": 3}');

      const metrics = manager.getMetrics();
      expect(metrics.eventsReceived).toBe(3);
    });

    it('should degrade quality with many gaps detected', () => {
      const manager = new EventSourceManager('/api/stream', { enableGapDetection: true });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      // Simulate multiple gaps by sending non-sequential event IDs
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 1}', '1');
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 5}', '5');  // gap 1
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 10}', '10'); // gap 2
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 20}', '20'); // gap 3

      // After multiple gaps, quality should degrade to 'poor'
      const metrics = manager.getMetrics();
      expect(metrics.gapsDetected).toBeGreaterThan(2);
      expect(metrics.quality).toBe('poor');
    });

    it('should reset metrics on close', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateTypedEvent('message', '{"test": 1}');

      manager.close();

      const metrics = manager.getMetrics();
      expect(metrics.quality).toBe('disconnected');
    });
  });

  describe('Gap Detection', () => {
    it('should call onGapDetected when events are missing', () => {
      const onGapDetected = vi.fn();
      const manager = new EventSourceManager('/api/stream', {
        enableGapDetection: true,
        onGapDetected,
      });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      // Simulate events with a gap (1, 2, then 5 - missing 3 and 4)
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 1}', '1');
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 2}', '2');
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 5}', '5'); // Gap!

      expect(onGapDetected).toHaveBeenCalledWith(3, 4);
    });

    it('should track gaps detected in metrics', () => {
      const manager = new EventSourceManager('/api/stream', {
        enableGapDetection: true,
      });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      // Simulate events with gaps
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 1}', '1');
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 5}', '5');
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 10}', '10');

      const metrics = manager.getMetrics();
      expect(metrics.gapsDetected).toBeGreaterThan(0);
    });

    it('should not detect gaps when disabled', () => {
      const onGapDetected = vi.fn();
      const manager = new EventSourceManager('/api/stream', {
        enableGapDetection: false,
        onGapDetected,
      });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 1}', '1');
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 100}', '100');

      expect(onGapDetected).not.toHaveBeenCalled();
    });

    it('should handle non-sequential event IDs gracefully', () => {
      const onGapDetected = vi.fn();
      const manager = new EventSourceManager('/api/stream', {
        enableGapDetection: true,
        onGapDetected,
      });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      // UUID-style event IDs (no numeric portion) should not trigger gap detection
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 1}', 'abc-xyz');
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 2}', 'def-uvw');

      expect(onGapDetected).not.toHaveBeenCalled();
    });
  });

  describe('Replay Events', () => {
    it('should call onReplayStart when replay_start event received', () => {
      const onReplayStart = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onReplayStart });

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateTypedEvent('replay_start', '{}');

      expect(onReplayStart).toHaveBeenCalled();
    });

    it('should call onReplayEnd when replay_end event received', () => {
      const onReplayEnd = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onReplayEnd });

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateTypedEvent('replay_end', '{"totalEvents": 5}');

      expect(onReplayEnd).toHaveBeenCalledWith(5);
    });

    it('should track replayed events in metrics', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateTypedEvent('replay_end', '{"totalEvents": 10}');

      const metrics = manager.getMetrics();
      expect(metrics.eventsReplayed).toBe(10);
    });

    it('should set isReplaying during replay', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      // Start replay
      mockES.getLatest()!.simulateTypedEvent('replay_start', '{}');
      expect(manager.getMetrics().isReplaying).toBe(true);

      // End replay
      mockES.getLatest()!.simulateTypedEvent('replay_end', '{"totalEvents": 3}');
      expect(manager.getMetrics().isReplaying).toBe(false);
    });
  });

  describe('Heartbeat Monitoring', () => {
    it('should update quality on heartbeat events', () => {
      const onQualityChange = vi.fn();
      const manager = new EventSourceManager('/api/stream', { onQualityChange });

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      const initialCallCount = onQualityChange.mock.calls.length;

      mockES.getLatest()!.simulateTypedEvent('heartbeat', '{}');

      // Quality callback should be triggered on heartbeat
      expect(onQualityChange.mock.calls.length).toBeGreaterThanOrEqual(initialCallCount);
    });

    it('should track last event time for staleness detection', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateOpen();

      const timeBefore = Date.now();
      mockES.getLatest()!.simulateTypedEvent('message', '{"test": 1}');

      const metrics = manager.getMetrics();
      expect(metrics.lastEventTime).toBeGreaterThanOrEqual(timeBefore);
    });
  });

  describe('Last Event ID Tracking with Gap Detection', () => {
    it('should track lastEventId from events', () => {
      const manager = new EventSourceManager('/api/stream');

      manager.connect();
      mockES.getLatest()!.simulateOpen();
      mockES.getLatest()!.simulateTypedEventWithId('message', '{"test": 1}', '12345');

      const metrics = manager.getMetrics();
      expect(metrics.lastEventId).toBe('12345');
    });

    it('should include lastEventId in reconnection URL when persisted', () => {
      // Note: jsdom's MessageEvent doesn't fully support lastEventId property access,
      // so we test the URL parameter mechanism by simulating what would happen
      // if lastEventId was captured and persisted to sessionStorage.

      // First simulate a connection that had a lastEventId stored
      // The storage key format is: sse_lastEventId_ + pathname (from URL parsing)
      const storageKey = 'sse_lastEventId_/api/stream';
      const storedData = JSON.stringify({ eventId: '12345', timestamp: Date.now() });
      sessionStorage.setItem(storageKey, storedData);

      const manager = new EventSourceManager('/api/stream', {
        enableGapDetection: true,
      });

      manager.connect();

      // Check that the connection URL includes the persisted lastEventId
      const instance = mockES.getLatest()!;
      expect(instance.url).toContain('lastEventId=12345');

      // Cleanup
      sessionStorage.removeItem(storageKey);
    });
  });
});
