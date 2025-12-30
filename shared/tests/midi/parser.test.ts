/**
 * Tests for the MIDI Parser module.
 * Covers parsing, bounds checking, edge cases, and error handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMidi, parseMidiFromBase64, MidiParser } from '../../src/midi/parser.js';

// Helper to create a minimal valid MIDI file
function createMinimalMidi(options: {
  format?: number;
  numTracks?: number;
  ticksPerQuarterNote?: number;
  tracks?: Uint8Array[];
} = {}): Uint8Array {
  const format = options.format ?? 0;
  const numTracks = options.numTracks ?? 1;
  const tpqn = options.ticksPerQuarterNote ?? 480;

  // Header chunk
  const header = new Uint8Array([
    0x4d, 0x54, 0x68, 0x64, // MThd
    0x00, 0x00, 0x00, 0x06, // length = 6
    (format >> 8) & 0xff, format & 0xff, // format
    (numTracks >> 8) & 0xff, numTracks & 0xff, // numTracks
    (tpqn >> 8) & 0xff, tpqn & 0xff, // ticksPerQuarterNote
  ]);

  // Default track: just an end-of-track event
  const defaultTrack = new Uint8Array([
    0x4d, 0x54, 0x72, 0x6b, // MTrk
    0x00, 0x00, 0x00, 0x04, // length = 4
    0x00, 0xff, 0x2f, 0x00, // delta=0, meta event, end of track, length=0
  ]);

  const tracks = options.tracks ?? [defaultTrack];

  // Combine all parts
  const totalLength = header.length + tracks.reduce((sum, t) => sum + t.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  result.set(header, offset);
  offset += header.length;

  for (const track of tracks) {
    result.set(track, offset);
    offset += track.length;
  }

  return result;
}

// Helper to create a track with a single note
function createTrackWithNote(
  noteNumber: number,
  velocity: number,
  startDelta: number,
  duration: number,
  channel: number = 0
): Uint8Array {
  // Track data
  const trackData = new Uint8Array([
    // Note On
    ...encodeVariableLength(startDelta),
    0x90 | channel, // Note On, channel
    noteNumber,
    velocity,
    // Note Off
    ...encodeVariableLength(duration),
    0x80 | channel, // Note Off, channel
    noteNumber,
    0x40, // release velocity
    // End of track
    0x00, 0xff, 0x2f, 0x00,
  ]);

  // Track header + data
  const length = trackData.length;
  const result = new Uint8Array(8 + length);
  result.set([0x4d, 0x54, 0x72, 0x6b], 0); // MTrk
  result.set([
    (length >> 24) & 0xff,
    (length >> 16) & 0xff,
    (length >> 8) & 0xff,
    length & 0xff,
  ], 4);
  result.set(trackData, 8);

  return result;
}

function encodeVariableLength(value: number): number[] {
  if (value < 0x80) return [value];
  const bytes: number[] = [];
  bytes.unshift(value & 0x7f);
  value >>= 7;
  while (value > 0) {
    bytes.unshift((value & 0x7f) | 0x80);
    value >>= 7;
  }
  return bytes;
}

describe('MidiParser', () => {
  describe('Header Parsing', () => {
    it('should parse a valid MIDI header', () => {
      const midi = createMinimalMidi({ format: 0, numTracks: 1, ticksPerQuarterNote: 480 });
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 0);
      assert.strictEqual(result.file.header.numTracks, 1);
      assert.strictEqual(result.file.header.ticksPerQuarterNote, 480);
    });

    it('should reject invalid header magic', () => {
      const badMidi = new Uint8Array([
        0x52, 0x49, 0x46, 0x46, // "RIFF" instead of "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
      ]);

      const result = parseMidi(badMidi);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('expected "MThd"'));
    });

    it('should reject invalid header length', () => {
      const badMidi = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, // MThd
        0x00, 0x00, 0x00, 0x04, // length = 4 (should be 6)
        0x00, 0x00, 0x00, 0x01,
      ]);

      const result = parseMidi(badMidi);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid MIDI header length'));
    });

    it('should reject invalid MIDI format', () => {
      const badMidi = createMinimalMidi({ format: 5 }); // Invalid format

      const result = parseMidi(badMidi);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid MIDI format'));
    });
  });

  describe('Bounds Checking', () => {
    it('should error on truncated file when reading header', () => {
      const truncated = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, // MThd - only 4 bytes
      ]);

      const result = parseMidi(truncated);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Unexpected end of file'));
    });

    it('should error on truncated track header', () => {
      const header = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
        0x4d, 0x54, 0x72, // MTr - incomplete
      ]);

      const result = parseMidi(header);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Unexpected end of file'));
    });

    it('should error on truncated note data', () => {
      const header = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x05, // Track length = 5
        0x00, 0x90, 0x3c, // Note on but missing velocity byte
      ]);

      const result = parseMidi(header);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Unexpected end of file'));
    });
  });

  describe('Note Parsing', () => {
    it('should parse a simple note', () => {
      const track = createTrackWithNote(60, 100, 0, 480, 0);
      const midi = createMinimalMidi({ tracks: [track] });

      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks.length, 1);
      assert.strictEqual(result.file.tracks[0].notes.length, 1);

      const note = result.file.tracks[0].notes[0];
      assert.strictEqual(note.note, 60);
      assert.strictEqual(note.velocity, 100);
      assert.strictEqual(note.channel, 0);
      assert.strictEqual(note.duration, 480);
    });

    it('should handle note-on with velocity 0 as note-off', () => {
      // Track with note-on velocity 0 instead of note-off
      const trackData = new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x0b,
        0x00, 0x90, 0x3c, 0x64, // Note on C4, velocity 100
        0x60, 0x90, 0x3c, 0x00, // Note on C4, velocity 0 (= note off)
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);

      const midi = createMinimalMidi({ tracks: [trackData] });
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 1);
      assert.strictEqual(result.file.tracks[0].notes[0].duration, 0x60);
    });

    it('should handle overlapping notes on same channel/pitch', () => {
      // Two overlapping notes
      const trackData = new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x14,
        0x00, 0x90, 0x3c, 0x64, // Note on C4, velocity 100
        0x30, 0x90, 0x3c, 0x50, // Another note on C4 (overlapping)
        0x30, 0x80, 0x3c, 0x40, // Note off (for first)
        0x30, 0x80, 0x3c, 0x40, // Note off (for second)
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);

      const midi = createMinimalMidi({ tracks: [trackData] });
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // Should have two separate notes
      assert.strictEqual(result.file.tracks[0].notes.length, 2);
    });
  });

  describe('Tempo Parsing', () => {
    it('should use default tempo if none specified', () => {
      const midi = createMinimalMidi();
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
    });

    it('should parse tempo meta event', () => {
      const trackData = new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x0b,
        0x00, 0xff, 0x51, 0x03, // Set tempo meta event
        0x07, 0xa1, 0x20, // 500000 microseconds = 120 BPM
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);

      const midi = createMinimalMidi({ tracks: [trackData] });
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].microsecondsPerQuarterNote, 500000);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
    });

    it('should ignore tempo of zero', () => {
      const trackData = new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x0b,
        0x00, 0xff, 0x51, 0x03, // Set tempo meta event
        0x00, 0x00, 0x00, // 0 microseconds (invalid)
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);

      const midi = createMinimalMidi({ tracks: [trackData] });
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // Should fall back to default tempo since 0 is invalid
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
    });
  });

  describe('SMPTE Time Division', () => {
    it('should handle SMPTE time division', () => {
      // Create MIDI with SMPTE time division (30 fps, 80 ticks/frame)
      const midi = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, // MThd
        0x00, 0x00, 0x00, 0x06, // length = 6
        0x00, 0x00, // format 0
        0x00, 0x01, // 1 track
        0xe2, 0x50, // SMPTE: -30 fps (0xe2 = -30 as signed byte), 80 ticks/frame
        0x4d, 0x54, 0x72, 0x6b, // MTrk
        0x00, 0x00, 0x00, 0x04, // length = 4
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);

      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // Should convert SMPTE to approximate ticks per quarter note
      assert.ok(result.file.header.ticksPerQuarterNote > 0);
    });
  });

  describe('Running Status', () => {
    it('should handle running status for consecutive notes', () => {
      const trackData = new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x10,
        0x00, 0x90, 0x3c, 0x64, // Note on C4
        0x30, 0x3c, 0x00, // Running status: note off (velocity 0)
        0x00, 0x3e, 0x64, // Running status: note on D4
        0x30, 0x3e, 0x00, // Running status: note off
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);

      const midi = createMinimalMidi({ tracks: [trackData] });
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 2);
    });
  });

  describe('Base64 Parsing', () => {
    it('should parse MIDI from base64 string', () => {
      const midi = createMinimalMidi();
      const base64 = Buffer.from(midi).toString('base64');

      const result = parseMidiFromBase64(base64);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
    });

    it('should handle invalid base64', () => {
      const result = parseMidiFromBase64('not-valid-base64!!!');

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid base64'));
    });
  });

  describe('Variable Length Quantity', () => {
    it('should handle VLQ values correctly', () => {
      // Create track with large delta time using VLQ
      const trackData = new Uint8Array([
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x08,
        0x81, 0x00, // VLQ for 128
        0x90, 0x3c, 0x64, // Note on
        0x00, 0xff, 0x2f, 0x00, // End of track
      ]);

      const midi = createMinimalMidi({ tracks: [trackData] });
      const result = parseMidi(midi);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // The note on event should have absolute time of 128
      const events = result.file.tracks[0].events.filter(e => e.type === 'noteOn');
      assert.ok(events.length > 0);
      assert.strictEqual(events[0].absoluteTime, 128);
    });
  });
});
