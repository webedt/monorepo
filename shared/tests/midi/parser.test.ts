/**
 * Tests for MIDI parser.
 * Covers binary format handling, edge cases, and malformed data handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MidiParser, parseMidi, parseMidiFromBase64 } from '../../src/midi/index.js';

/**
 * Helper to create a minimal valid MIDI file header
 */
function createMidiHeader(
  format: number = 0,
  numTracks: number = 1,
  ticksPerQuarterNote: number = 480
): Uint8Array {
  return new Uint8Array([
    // MThd
    0x4d, 0x54, 0x68, 0x64,
    // Length (6)
    0x00, 0x00, 0x00, 0x06,
    // Format
    (format >> 8) & 0xff, format & 0xff,
    // Number of tracks
    (numTracks >> 8) & 0xff, numTracks & 0xff,
    // Ticks per quarter note
    (ticksPerQuarterNote >> 8) & 0xff, ticksPerQuarterNote & 0xff,
  ]);
}

/**
 * Helper to create a minimal track
 */
function createTrack(events: Uint8Array): Uint8Array {
  const length = events.length;
  const header = new Uint8Array([
    // MTrk
    0x4d, 0x54, 0x72, 0x6b,
    // Length
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ]);
  const result = new Uint8Array(header.length + events.length);
  result.set(header);
  result.set(events, header.length);
  return result;
}

/**
 * Helper to combine arrays
 */
function concat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

describe('MidiParser', () => {
  describe('Header parsing', () => {
    it('should parse valid Format 0 header', () => {
      const header = createMidiHeader(0, 1, 480);
      const track = createTrack(new Uint8Array([0x00, 0xff, 0x2f, 0x00])); // End of track
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 0);
      assert.strictEqual(result.file.header.numTracks, 1);
      assert.strictEqual(result.file.header.ticksPerQuarterNote, 480);
    });

    it('should parse valid Format 1 header', () => {
      const header = createMidiHeader(1, 2, 960);
      const track1 = createTrack(new Uint8Array([0x00, 0xff, 0x2f, 0x00]));
      const track2 = createTrack(new Uint8Array([0x00, 0xff, 0x2f, 0x00]));
      const data = concat(header, track1, track2);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 1);
      assert.strictEqual(result.file.header.numTracks, 2);
    });

    it('should reject invalid header signature', () => {
      const data = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // "RIFF" instead of "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
      ]);

      const result = parseMidi(data);
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('MThd'));
    });

    it('should reject invalid MIDI format', () => {
      const data = new Uint8Array([
        // MThd
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x05, // Format 5 (invalid)
        0x00, 0x01,
        0x01, 0xe0,
      ]);

      const result = parseMidi(data);
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('format'));
    });
  });

  describe('Time signature parsing with bounds checking', () => {
    it('should parse valid time signature', () => {
      const header = createMidiHeader(0, 1, 480);
      // Time signature: 4/4, with all 4 bytes
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08, // Time sig: 4/4
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.timeSignatures.length, 1);
      assert.strictEqual(result.file.timeSignatures[0].numerator, 4);
      assert.strictEqual(result.file.timeSignatures[0].denominator, 4);
    });

    it('should handle malformed time signature with insufficient bytes', () => {
      const header = createMidiHeader(0, 1, 480);
      // Malformed time signature with only 2 bytes instead of 4
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x58, 0x02, 0x04, 0x02, // Only 2 bytes
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      // Should parse without crashing, using defaults
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
    });

    it('should handle empty time signature data', () => {
      const header = createMidiHeader(0, 1, 480);
      // Time signature meta event with 0 length
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x58, 0x00, // 0 bytes
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      // Should parse without crashing, using defaults
      assert.strictEqual(result.success, true);
    });
  });

  describe('Tempo parsing with zero protection', () => {
    it('should parse valid tempo', () => {
      const header = createMidiHeader(0, 1, 480);
      // Tempo: 500000 microseconds = 120 BPM
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // Tempo: 500000
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].microsecondsPerQuarterNote, 500000);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
    });

    it('should handle zero tempo gracefully', () => {
      const header = createMidiHeader(0, 1, 480);
      // Tempo: 0 microseconds (would cause division by zero)
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x51, 0x03, 0x00, 0x00, 0x00, // Tempo: 0
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // Should use default tempo instead of producing Infinity
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.ok(Number.isFinite(result.file.tempoChanges[0].bpm));
    });

    it('should handle malformed tempo with insufficient bytes', () => {
      const header = createMidiHeader(0, 1, 480);
      // Tempo with only 2 bytes instead of 3
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x51, 0x02, 0x07, 0xa1, // Only 2 bytes
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      // Should parse without crashing
      assert.strictEqual(result.success, true);
    });
  });

  describe('Key signature parsing with bounds checking', () => {
    it('should parse valid key signature', () => {
      const header = createMidiHeader(0, 1, 480);
      // Key signature: G major (1 sharp, major)
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x59, 0x02, 0x01, 0x00, // 1 sharp, major
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
    });

    it('should handle malformed key signature with insufficient bytes', () => {
      const header = createMidiHeader(0, 1, 480);
      // Key signature with only 1 byte instead of 2
      const trackEvents = new Uint8Array([
        0x00, 0xff, 0x59, 0x01, 0x01, // Only 1 byte
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      // Should parse without crashing
      assert.strictEqual(result.success, true);
    });
  });

  describe('Overlapping notes handling', () => {
    it('should handle overlapping notes of the same pitch', () => {
      const header = createMidiHeader(0, 1, 480);
      // Two C4 notes that overlap
      const trackEvents = new Uint8Array([
        // Note On C4, velocity 100
        0x00, 0x90, 0x3c, 0x64,
        // Delta 100, Note On C4 again (overlapping)
        0x64, 0x90, 0x3c, 0x50,
        // Delta 100, Note Off for first C4
        0x64, 0x80, 0x3c, 0x40,
        // Delta 100, Note Off for second C4
        0x64, 0x80, 0x3c, 0x40,
        // End of track
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // Should have 2 separate notes, not 1
      assert.strictEqual(result.file.tracks[0].notes.length, 2);

      // First note should have correct duration
      const note1 = result.file.tracks[0].notes[0];
      assert.strictEqual(note1.note, 60); // C4
      assert.strictEqual(note1.startTime, 0);
      assert.strictEqual(note1.duration, 200); // 100 + 100 ticks

      // Second note should also exist with its own duration
      const note2 = result.file.tracks[0].notes[1];
      assert.strictEqual(note2.note, 60); // C4
      assert.strictEqual(note2.startTime, 100);
      assert.strictEqual(note2.duration, 200); // 100 + 100 ticks
    });

    it('should handle note on with velocity 0 as note off', () => {
      const header = createMidiHeader(0, 1, 480);
      const trackEvents = new Uint8Array([
        // Note On C4, velocity 100
        0x00, 0x90, 0x3c, 0x64,
        // Delta 480, Note On with velocity 0 (equivalent to Note Off)
        0x83, 0x60, 0x90, 0x3c, 0x00,
        // End of track
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 1);
      assert.strictEqual(result.file.tracks[0].notes[0].duration, 480);
    });
  });

  describe('Base64 parsing', () => {
    it('should parse MIDI from valid base64', () => {
      const header = createMidiHeader(0, 1, 480);
      const track = createTrack(new Uint8Array([0x00, 0xff, 0x2f, 0x00]));
      const data = concat(header, track);

      // Convert to base64
      let binary = '';
      for (let i = 0; i < data.length; i++) {
        binary += String.fromCharCode(data[i]);
      }
      const base64 = btoa(binary);

      const result = parseMidiFromBase64(base64);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
    });

    it('should reject invalid base64', () => {
      const result = parseMidiFromBase64('not-valid-base64!!!');
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('base64'));
    });
  });

  describe('Default tempo handling', () => {
    it('should use 120 BPM default when no tempo is specified', () => {
      const header = createMidiHeader(0, 1, 480);
      // Track with no tempo event
      const trackEvents = new Uint8Array([
        0x00, 0x90, 0x3c, 0x64, // Note On
        0x83, 0x60, 0x80, 0x3c, 0x40, // Note Off after 480 ticks
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);
      const track = createTrack(trackEvents);
      const data = concat(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
      assert.strictEqual(result.file.initialTempo, 120);
    });
  });
});
