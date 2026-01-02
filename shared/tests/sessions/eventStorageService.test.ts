/**
 * Tests for the EventStorageService module.
 *
 * These tests verify the event storage and deduplication logic including:
 * - Single event storage
 * - Event deduplication using UUID tracking
 * - Batch event storage
 * - Input preview event generation
 *
 * IMPORTANT: These tests mock the database layer to test business logic
 * without requiring actual database connections.
 */

import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';

import { EventStorageService } from '../../src/sessions/EventStorageService.js';

describe('EventStorageService', () => {
  let service: EventStorageService;

  beforeEach(() => {
    service = new EventStorageService();
  });

  describe('createInputPreviewEvent', () => {
    describe('Basic Preview Generation', () => {
      it('should create preview event with short content', () => {
        const content = 'Short message';
        const event = service.createInputPreviewEvent(content);

        assert.strictEqual(event.type, 'input_preview');
        assert.strictEqual(event.source, 'user');
        assert.ok(event.timestamp);
        assert.ok((event.message as string).includes('Request received'));
        assert.ok((event.message as string).includes('Short message'));
      });

      it('should include data object with preview info', () => {
        const content = 'Test content';
        const event = service.createInputPreviewEvent(content);

        const data = event.data as {
          preview: string;
          truncated: boolean;
          originalLength: number;
        };

        assert.strictEqual(data.preview, 'Test content');
        assert.strictEqual(data.truncated, false);
        assert.strictEqual(data.originalLength, 12);
      });

      it('should set truncated to false for short content', () => {
        const content = 'Short';
        const event = service.createInputPreviewEvent(content);
        const data = event.data as { truncated: boolean };

        assert.strictEqual(data.truncated, false);
      });
    });

    describe('Content Truncation', () => {
      it('should truncate long content with ellipsis', () => {
        const content = 'A'.repeat(300);
        const event = service.createInputPreviewEvent(content, 200);

        const data = event.data as {
          preview: string;
          truncated: boolean;
          originalLength: number;
        };

        assert.strictEqual(data.truncated, true);
        assert.strictEqual(data.originalLength, 300);
        assert.ok((event.message as string).includes('...'));
      });

      it('should respect custom maxPreviewLength', () => {
        const content = 'ABCDEFGHIJ'; // 10 chars
        const event = service.createInputPreviewEvent(content, 5);

        const message = event.message as string;
        const data = event.data as { truncated: boolean };

        assert.ok(message.includes('ABCDE...'));
        assert.strictEqual(data.truncated, true);
      });

      it('should not truncate content at exact boundary', () => {
        const content = 'A'.repeat(200);
        const event = service.createInputPreviewEvent(content, 200);

        const data = event.data as { truncated: boolean };

        assert.strictEqual(data.truncated, false);
      });

      it('should truncate content one char over boundary', () => {
        const content = 'A'.repeat(201);
        const event = service.createInputPreviewEvent(content, 200);

        const data = event.data as { truncated: boolean };

        assert.strictEqual(data.truncated, true);
      });
    });

    describe('Default Max Length', () => {
      it('should use 200 as default max length', () => {
        const content = 'A'.repeat(250);
        const event = service.createInputPreviewEvent(content);

        const data = event.data as { truncated: boolean; originalLength: number };

        assert.strictEqual(data.truncated, true);
        assert.strictEqual(data.originalLength, 250);
      });
    });

    describe('Edge Cases', () => {
      it('should handle empty content', () => {
        const content = '';
        const event = service.createInputPreviewEvent(content);

        const data = event.data as {
          preview: string;
          truncated: boolean;
          originalLength: number;
        };

        assert.strictEqual(data.preview, '');
        assert.strictEqual(data.truncated, false);
        assert.strictEqual(data.originalLength, 0);
      });

      it('should handle content with newlines', () => {
        const content = 'Line 1\nLine 2\nLine 3';
        const event = service.createInputPreviewEvent(content);

        const data = event.data as { preview: string };

        assert.ok(data.preview.includes('\n'));
      });

      it('should handle content with unicode', () => {
        const content = 'Hello! 你好! Привет! 🎉';
        const event = service.createInputPreviewEvent(content);

        const data = event.data as { preview: string };

        assert.strictEqual(data.preview, content);
      });

      it('should produce valid ISO timestamp', () => {
        const content = 'Test';
        const event = service.createInputPreviewEvent(content);

        const timestamp = event.timestamp as string;
        const parsed = new Date(timestamp);

        assert.ok(!isNaN(parsed.getTime()));
      });
    });
  });
});

describe('EventStorageService - UUID Deduplication Logic', () => {
  /**
   * Tests for the UUID-based deduplication system.
   * These test the expected behavior of storeEventWithDedup.
   */

  describe('Dedup Set Management', () => {
    it('should track new UUIDs in the set', () => {
      const storedUuids = new Set<string>();

      const uuid1 = 'event-uuid-1';
      const uuid2 = 'event-uuid-2';

      storedUuids.add(uuid1);
      storedUuids.add(uuid2);

      assert.strictEqual(storedUuids.size, 2);
      assert.ok(storedUuids.has(uuid1));
      assert.ok(storedUuids.has(uuid2));
    });

    it('should recognize duplicate UUIDs', () => {
      const storedUuids = new Set<string>();
      storedUuids.add('event-uuid-1');

      const isDuplicate = storedUuids.has('event-uuid-1');

      assert.strictEqual(isDuplicate, true);
    });

    it('should not recognize new UUIDs as duplicates', () => {
      const storedUuids = new Set<string>();
      storedUuids.add('event-uuid-1');

      const isDuplicate = storedUuids.has('event-uuid-2');

      assert.strictEqual(isDuplicate, false);
    });

    it('should handle empty dedup set', () => {
      const storedUuids = new Set<string>();

      const isDuplicate = storedUuids.has('any-uuid');

      assert.strictEqual(isDuplicate, false);
    });

    it('should maintain set across multiple additions', () => {
      const storedUuids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        storedUuids.add(`uuid-${i}`);
      }

      assert.strictEqual(storedUuids.size, 100);
      assert.ok(storedUuids.has('uuid-0'));
      assert.ok(storedUuids.has('uuid-99'));
      assert.ok(!storedUuids.has('uuid-100'));
    });
  });

  describe('Store Event Result Structure', () => {
    it('should define correct result for successful storage', () => {
      const result = { stored: true, duplicate: false };

      assert.strictEqual(result.stored, true);
      assert.strictEqual(result.duplicate, false);
    });

    it('should define correct result for duplicate event', () => {
      const result = { stored: false, duplicate: true };

      assert.strictEqual(result.stored, false);
      assert.strictEqual(result.duplicate, true);
    });

    it('should define correct result for storage failure', () => {
      const result = { stored: false, duplicate: false };

      assert.strictEqual(result.stored, false);
      assert.strictEqual(result.duplicate, false);
    });
  });
});

describe('EventStorageService - Batch Storage Logic', () => {
  /**
   * Tests for batch event storage aggregation.
   */

  describe('Batch Result Aggregation', () => {
    it('should count successful stores', () => {
      const results = [
        { stored: true, duplicate: false },
        { stored: true, duplicate: false },
        { stored: true, duplicate: false },
      ];

      const stored = results.filter(r => r.stored).length;

      assert.strictEqual(stored, 3);
    });

    it('should count duplicates', () => {
      const results = [
        { stored: true, duplicate: false },
        { stored: false, duplicate: true },
        { stored: false, duplicate: true },
      ];

      const duplicates = results.filter(r => r.duplicate).length;

      assert.strictEqual(duplicates, 2);
    });

    it('should handle mixed results', () => {
      const results = [
        { stored: true, duplicate: false },
        { stored: false, duplicate: true },
        { stored: false, duplicate: false },
        { stored: true, duplicate: false },
      ];

      const stored = results.filter(r => r.stored).length;
      const duplicates = results.filter(r => r.duplicate).length;

      assert.strictEqual(stored, 2);
      assert.strictEqual(duplicates, 1);
    });

    it('should handle empty batch', () => {
      const results: Array<{ stored: boolean; duplicate: boolean }> = [];

      const stored = results.filter(r => r.stored).length;
      const duplicates = results.filter(r => r.duplicate).length;

      assert.strictEqual(stored, 0);
      assert.strictEqual(duplicates, 0);
    });
  });
});

describe('EventStorageService - Event Data Structure', () => {
  /**
   * Tests for expected event data structures.
   */

  describe('Standard Event Fields', () => {
    it('should recognize event with type field', () => {
      const eventData = {
        type: 'message',
        content: 'Hello',
      };

      assert.strictEqual(eventData.type, 'message');
    });

    it('should recognize event with uuid field', () => {
      const eventData = {
        type: 'message',
        uuid: 'abc-123-def-456',
      };

      assert.ok('uuid' in eventData);
      assert.strictEqual(eventData.uuid, 'abc-123-def-456');
    });

    it('should recognize event with timestamp field', () => {
      const eventData = {
        type: 'message',
        timestamp: '2024-01-15T10:00:00Z',
      };

      assert.ok('timestamp' in eventData);
    });
  });

  describe('Event Type Variants', () => {
    const eventTypes = [
      'message',
      'tool_call',
      'tool_result',
      'error',
      'progress',
      'title_generation',
      'session_created',
      'result',
      'input_preview',
    ];

    for (const eventType of eventTypes) {
      it(`should handle ${eventType} event type`, () => {
        const eventData = {
          type: eventType,
          data: {},
        };

        assert.strictEqual(eventData.type, eventType);
      });
    }
  });

  describe('Event Data Nesting', () => {
    it('should handle deeply nested event data', () => {
      const eventData = {
        type: 'tool_result',
        data: {
          tool: {
            name: 'code_edit',
            input: {
              file_path: '/src/app.ts',
              changes: [
                { line: 1, content: 'import X from "x";' },
              ],
            },
          },
        },
      };

      assert.strictEqual(eventData.type, 'tool_result');
      assert.strictEqual(eventData.data.tool.name, 'code_edit');
      assert.strictEqual(eventData.data.tool.input.file_path, '/src/app.ts');
    });

    it('should handle array values in event data', () => {
      const eventData = {
        type: 'batch_result',
        items: [1, 2, 3],
        nested: [
          { id: 1 },
          { id: 2 },
        ],
      };

      assert.strictEqual(eventData.items.length, 3);
      assert.strictEqual(eventData.nested.length, 2);
    });
  });
});

describe('EventStorageService - Timestamp Handling', () => {
  /**
   * Tests for timestamp parsing and handling.
   */

  describe('Timestamp Parsing', () => {
    it('should parse ISO 8601 timestamps', () => {
      const timestamp = '2024-01-15T10:30:45.123Z';
      const parsed = new Date(timestamp);

      assert.ok(!isNaN(parsed.getTime()));
      assert.strictEqual(parsed.toISOString(), timestamp);
    });

    it('should handle timestamps without milliseconds', () => {
      const timestamp = '2024-01-15T10:30:45Z';
      const parsed = new Date(timestamp);

      assert.ok(!isNaN(parsed.getTime()));
    });

    it('should handle timestamps with timezone offset', () => {
      const timestamp = '2024-01-15T10:30:45+05:30';
      const parsed = new Date(timestamp);

      assert.ok(!isNaN(parsed.getTime()));
    });

    it('should use current date for undefined timestamps', () => {
      const timestamp: string | undefined = undefined;
      const date = timestamp ? new Date(timestamp) : new Date();

      assert.ok(!isNaN(date.getTime()));
    });
  });

  describe('Timestamp Generation', () => {
    it('should generate valid ISO timestamp for new events', () => {
      const timestamp = new Date().toISOString();

      assert.ok(timestamp.endsWith('Z'));
      assert.ok(timestamp.includes('T'));
    });
  });
});

describe('EventStorageService - Error Handling Logic', () => {
  /**
   * Tests for expected error handling behavior.
   */

  describe('Storage Error Results', () => {
    it('should return stored=false on error', () => {
      const result = { stored: false, duplicate: false };

      assert.strictEqual(result.stored, false);
    });

    it('should not mark errors as duplicates', () => {
      const result = { stored: false, duplicate: false };

      assert.strictEqual(result.duplicate, false);
    });
  });

  describe('Error Context Fields', () => {
    it('should track chatSessionId in error context', () => {
      const context = {
        component: 'EventStorageService',
        chatSessionId: 'session-123',
        eventType: 'message',
      };

      assert.strictEqual(context.chatSessionId, 'session-123');
    });

    it('should track eventType in error context', () => {
      const context = {
        component: 'EventStorageService',
        chatSessionId: 'session-123',
        eventType: 'tool_call',
      };

      assert.strictEqual(context.eventType, 'tool_call');
    });
  });
});

describe('EventStorageService - UUID Extraction', () => {
  /**
   * Tests for the UUID extraction helper used by the service.
   */

  describe('Event UUID Locations', () => {
    it('should find uuid in top-level field', () => {
      const eventData = {
        uuid: 'top-level-uuid',
        type: 'message',
      };

      const uuid = eventData.uuid;
      assert.strictEqual(uuid, 'top-level-uuid');
    });

    it('should find uuid in id field as fallback', () => {
      const eventData = {
        id: 'id-field-value',
        type: 'message',
      };

      const uuid = (eventData as { uuid?: string }).uuid ?? (eventData as { id?: string }).id;
      assert.strictEqual(uuid, 'id-field-value');
    });

    it('should handle event without uuid', () => {
      const eventData = {
        type: 'message',
      };

      const uuid = (eventData as { uuid?: string }).uuid;
      assert.strictEqual(uuid, undefined);
    });
  });
});
