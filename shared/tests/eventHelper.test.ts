/**
 * Tests for the Event Helper module.
 * Covers UUID extraction from event data objects.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { extractEventUuid } from '../src/utils/helpers/eventHelper.js';

describe('Event Helper Module', () => {
  describe('extractEventUuid', () => {
    describe('valid UUID extraction', () => {
      it('should extract a valid UUID string', () => {
        const eventData = { uuid: 'abc-123-def-456', type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, 'abc-123-def-456');
      });

      it('should extract UUID from event with many fields', () => {
        const eventData = {
          uuid: 'event-uuid-here',
          type: 'message',
          content: 'Hello world',
          timestamp: new Date().toISOString(),
        };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, 'event-uuid-here');
      });
    });

    describe('null returns for invalid/missing UUID', () => {
      it('should return null for empty string UUID', () => {
        const eventData = { uuid: '', type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should return null when uuid field is missing', () => {
        const eventData = { type: 'test', content: 'no uuid here' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should return null when uuid is undefined', () => {
        const eventData = { uuid: undefined, type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should return null when uuid is null', () => {
        const eventData = { uuid: null, type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should return null when uuid is a number', () => {
        const eventData = { uuid: 12345, type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should return null when uuid is an object', () => {
        const eventData = { uuid: { id: 'nested' }, type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should return null when uuid is an array', () => {
        const eventData = { uuid: ['a', 'b', 'c'], type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should return null when uuid is a boolean', () => {
        const eventData = { uuid: true, type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });
    });

    describe('edge cases', () => {
      it('should handle empty object', () => {
        const eventData = {};
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, null);
      });

      it('should handle whitespace-only UUID as valid (non-empty string)', () => {
        // Note: whitespace-only is technically a non-empty string
        const eventData = { uuid: '   ', type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, '   ');
      });

      it('should preserve UUID with special characters', () => {
        const eventData = { uuid: 'uuid-with-dashes_and_underscores.and.dots', type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, 'uuid-with-dashes_and_underscores.and.dots');
      });

      it('should handle very long UUID strings', () => {
        const longUuid = 'a'.repeat(1000);
        const eventData = { uuid: longUuid, type: 'test' };
        const result = extractEventUuid(eventData);

        assert.strictEqual(result, longUuid);
      });
    });
  });
});
