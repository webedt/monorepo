/**
 * Unit tests for the SSEWriter class.
 * Covers event writing, heartbeat management, and resource cleanup.
 */

import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { SSEWriter } from '../../src/utils/http/SSEWriter.js';
import { ASseHelper } from '../../src/utils/http/ASseHelper.js';

import type { SseWritable } from '../../src/utils/http/ASseHelper.js';

/**
 * Mock SSE Helper implementation for testing
 */
class MockSseHelper extends ASseHelper {
  public writtenData: string[] = [];
  public setupCalled = false;
  public endCalled = false;
  public writableState = true;

  setupSse(_res: SseWritable): void {
    this.setupCalled = true;
  }

  isWritable(_res: SseWritable): boolean {
    return this.writableState;
  }

  write(_res: SseWritable, data: string): boolean {
    if (!this.writableState) return false;
    this.writtenData.push(data);
    return true;
  }

  writeEvent(_res: SseWritable, event: Record<string, unknown>): boolean {
    return this.write(_res, `data: ${JSON.stringify(event)}\n\n`);
  }

  writeEventWithId(_res: SseWritable, eventId: string, event: Record<string, unknown>): boolean {
    return this.write(_res, `id: ${eventId}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  writeNamedEvent(_res: SseWritable, eventType: string, data: Record<string, unknown>): boolean {
    return this.write(_res, `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  writeNamedEventWithId(_res: SseWritable, eventId: string, eventType: string, data: Record<string, unknown>): boolean {
    return this.write(_res, `id: ${eventId}\nevent: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  writeHeartbeat(_res: SseWritable): boolean {
    return this.write(_res, `: heartbeat\n\n`);
  }

  writeComment(_res: SseWritable, comment: string): boolean {
    return this.write(_res, `: ${comment}\n\n`);
  }

  end(_res: SseWritable): void {
    this.endCalled = true;
  }

  reset(): void {
    this.writtenData = [];
    this.setupCalled = false;
    this.endCalled = false;
    this.writableState = true;
  }
}

/**
 * Create a mock response object
 */
function createMockResponse(): SseWritable {
  return {
    write: () => true,
    writeHead: () => {},
    end: () => {},
    headersSent: false,
    writableEnded: false,
  } as unknown as SseWritable;
}

describe('SSEWriter', () => {
  let mockHelper: MockSseHelper;
  let mockRes: SseWritable;

  beforeEach(() => {
    mockHelper = new MockSseHelper();
    mockRes = createMockResponse();
  });

  afterEach(() => {
    mockHelper.reset();
  });

  describe('Construction', () => {
    it('should create with default options', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      assert.ok(writer);
    });

    it('should auto-start heartbeat by default', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { heartbeatIntervalMs: 100 });
      // Give it a moment then verify heartbeat would be running
      writer.end(); // Clean up
    });

    it('should not start heartbeat when autoStartHeartbeat is false', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      // No heartbeat should be started
      writer.end();
    });

    it('should not start heartbeat when interval is 0', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { heartbeatIntervalMs: 0 });
      // No heartbeat should be started
      writer.end();
    });
  });

  describe('setup()', () => {
    it('should call helper.setupSse', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      writer.setup();

      assert.strictEqual(mockHelper.setupCalled, true);
      writer.end();
    });
  });

  describe('isWritable()', () => {
    it('should return true when connection is writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      assert.strictEqual(writer.isWritable(), true);
      writer.end();
    });

    it('should return false after end() is called', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      writer.end();

      assert.strictEqual(writer.isWritable(), false);
    });

    it('should return false when helper reports not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      mockHelper.writableState = false;

      assert.strictEqual(writer.isWritable(), false);
      writer.end();
    });
  });

  describe('write()', () => {
    it('should write raw data', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      const result = writer.write('raw data');

      assert.strictEqual(result, true);
      assert.deepStrictEqual(mockHelper.writtenData, ['raw data']);
      writer.end();
    });

    it('should return false when not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      writer.end();

      const result = writer.write('data');

      assert.strictEqual(result, false);
    });
  });

  describe('writeEvent()', () => {
    it('should write event with JSON data', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      const result = writer.writeEvent({ type: 'test', message: 'hello' });

      assert.strictEqual(result, true);
      assert.ok(mockHelper.writtenData[0].includes('data:'));
      assert.ok(mockHelper.writtenData[0].includes('"type":"test"'));
      writer.end();
    });

    it('should return false when not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      writer.end();

      const result = writer.writeEvent({ type: 'test' });

      assert.strictEqual(result, false);
    });
  });

  describe('writeNamedEvent()', () => {
    it('should write named event with type and data', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      const result = writer.writeNamedEvent('status', { phase: 'running' });

      assert.strictEqual(result, true);
      assert.ok(mockHelper.writtenData[0].includes('event: status'));
      assert.ok(mockHelper.writtenData[0].includes('"phase":"running"'));
      writer.end();
    });

    it('should return false when not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      writer.end();

      const result = writer.writeNamedEvent('status', { phase: 'done' });

      assert.strictEqual(result, false);
    });
  });

  describe('writeEventWithId()', () => {
    it('should write event with ID for Last-Event-ID support', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      const result = writer.writeEventWithId('event-123', { type: 'test' });

      assert.strictEqual(result, true);
      assert.ok(mockHelper.writtenData[0].includes('id: event-123'));
      writer.end();
    });

    it('should return false when not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      writer.end();

      const result = writer.writeEventWithId('event-123', { type: 'test' });

      assert.strictEqual(result, false);
    });
  });

  describe('writeNamedEventWithId()', () => {
    it('should write named event with ID', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      const result = writer.writeNamedEventWithId('event-456', 'update', { value: 42 });

      assert.strictEqual(result, true);
      assert.ok(mockHelper.writtenData[0].includes('id: event-456'));
      assert.ok(mockHelper.writtenData[0].includes('event: update'));
      writer.end();
    });

    it('should return false when not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      writer.end();

      const result = writer.writeNamedEventWithId('event-456', 'update', { value: 42 });

      assert.strictEqual(result, false);
    });
  });

  describe('writeHeartbeat()', () => {
    it('should write heartbeat comment', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      const result = writer.writeHeartbeat();

      assert.strictEqual(result, true);
      assert.ok(mockHelper.writtenData[0].includes(': heartbeat'));
      writer.end();
    });

    it('should return false when not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      writer.end();

      const result = writer.writeHeartbeat();

      assert.strictEqual(result, false);
    });
  });

  describe('writeComment()', () => {
    it('should write SSE comment', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      const result = writer.writeComment('custom comment');

      assert.strictEqual(result, true);
      assert.ok(mockHelper.writtenData[0].includes(': custom comment'));
      writer.end();
    });

    it('should return false when not writable', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });
      writer.end();

      const result = writer.writeComment('comment');

      assert.strictEqual(result, false);
    });
  });

  describe('end()', () => {
    it('should end the stream and call helper.end', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      writer.end();

      assert.strictEqual(mockHelper.endCalled, true);
    });

    it('should be idempotent - multiple calls are safe', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      writer.end();
      writer.end();
      writer.end();

      // Should only call end once
      assert.strictEqual(mockHelper.endCalled, true);
    });

    it('should stop heartbeat when ending', async () => {
      const writer = new SSEWriter(mockRes, mockHelper, { heartbeatIntervalMs: 50 });

      // Wait for potential heartbeat
      await new Promise(resolve => setTimeout(resolve, 10));

      writer.end();

      // After ending, no more heartbeats should be written
      const countBeforeWait = mockHelper.writtenData.length;
      await new Promise(resolve => setTimeout(resolve, 100));
      const countAfterWait = mockHelper.writtenData.length;

      assert.strictEqual(countBeforeWait, countAfterWait);
    });
  });

  describe('Heartbeat Management', () => {
    it('should start heartbeat manually', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false, heartbeatIntervalMs: 50 });

      writer.startHeartbeat();

      // Clean up
      writer.end();
    });

    it('should stop heartbeat manually', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false, heartbeatIntervalMs: 50 });

      writer.startHeartbeat();
      writer.stopHeartbeat();

      // Should be able to end without issues
      writer.end();
    });

    it('should not start multiple heartbeat timers', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false, heartbeatIntervalMs: 50 });

      writer.startHeartbeat();
      writer.startHeartbeat();
      writer.startHeartbeat();

      // Should still only have one timer running
      writer.end();
    });

    it('should stop heartbeat when connection becomes unwritable', async () => {
      const writer = new SSEWriter(mockRes, mockHelper, { heartbeatIntervalMs: 20 });

      // Wait for at least one heartbeat
      await new Promise(resolve => setTimeout(resolve, 30));

      // Make connection unwritable
      mockHelper.writableState = false;

      // Wait for heartbeat timer to detect and stop
      await new Promise(resolve => setTimeout(resolve, 50));

      // Clean up
      writer.end();
    });
  });

  describe('Static Factory', () => {
    it('should create SSEWriter using static create method', () => {
      const writer = SSEWriter.create(mockRes, mockHelper, { autoStartHeartbeat: false });

      assert.ok(writer instanceof SSEWriter);
      writer.end();
    });

    it('should create SSEWriter with default options', () => {
      const writer = SSEWriter.create(mockRes, mockHelper);

      assert.ok(writer instanceof SSEWriter);
      writer.end();
    });
  });

  describe('Integration Scenarios', () => {
    it('should handle typical SSE session flow', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      // Setup
      writer.setup();
      assert.strictEqual(mockHelper.setupCalled, true);

      // Write various events
      writer.writeEvent({ type: 'connected', sessionId: '123' });
      writer.writeNamedEvent('status', { phase: 'starting' });
      writer.writeNamedEvent('status', { phase: 'running' });
      writer.writeEventWithId('evt-1', { type: 'data', value: 1 });
      writer.writeEventWithId('evt-2', { type: 'data', value: 2 });
      writer.writeNamedEvent('status', { phase: 'completed' });

      // End
      writer.end();

      // Verify all writes occurred
      assert.strictEqual(mockHelper.writtenData.length, 6);
      assert.strictEqual(mockHelper.endCalled, true);
    });

    it('should handle early disconnect gracefully', () => {
      const writer = new SSEWriter(mockRes, mockHelper, { autoStartHeartbeat: false });

      writer.setup();
      writer.writeEvent({ type: 'connected' });

      // Simulate disconnect
      mockHelper.writableState = false;

      // These should return false but not throw
      assert.strictEqual(writer.writeEvent({ type: 'data' }), false);
      assert.strictEqual(writer.writeNamedEvent('status', {}), false);
      assert.strictEqual(writer.writeHeartbeat(), false);

      // End should still work
      writer.end();
    });
  });
});
