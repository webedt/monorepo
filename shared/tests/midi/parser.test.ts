/**
 * Tests for the MIDI Parser module.
 * Covers parsing of MIDI file headers, tracks, events, and error handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMidi, parseMidiFromBase64, MidiParser } from '../../src/midi/parser.js';

/**
 * Create a minimal valid MIDI file buffer.
 * Format 0, 1 track, 480 ticks per quarter note.
 */
function createMinimalMidiBuffer(): Uint8Array {
  // Header chunk: MThd + length(6) + format(0) + numTracks(1) + ticksPerQuarterNote(480)
  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Length: 6
    0x00, 0x00, // Format: 0
    0x00, 0x01, // Num tracks: 1
    0x01, 0xe0, // Ticks per quarter note: 480
  ];

  // Track chunk with a single note
  // MTrk + length + events
  const trackEvents = [
    0x00, 0x90, 0x3c, 0x64, // Delta 0, Note On, C4, velocity 100
    0x60, 0x80, 0x3c, 0x00, // Delta 96 (0x60), Note Off, C4, velocity 0
    0x00, 0xff, 0x2f, 0x00, // Delta 0, End of Track
  ];

  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    0x00, 0x00, 0x00, trackEvents.length, // Length
  ];

  return new Uint8Array([...header, ...trackHeader, ...trackEvents]);
}

/**
 * Create a MIDI file with tempo change.
 */
function createMidiWithTempo(bpm: number): Uint8Array {
  const microsecondsPerQuarterNote = Math.round(60000000 / bpm);
  const tempo1 = (microsecondsPerQuarterNote >> 16) & 0xff;
  const tempo2 = (microsecondsPerQuarterNote >> 8) & 0xff;
  const tempo3 = microsecondsPerQuarterNote & 0xff;

  const header = [
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Length: 6
    0x00, 0x01, // Format: 1
    0x00, 0x02, // Num tracks: 2
    0x01, 0xe0, // Ticks per quarter note: 480
  ];

  // Track 0: Tempo track
  const tempoTrackEvents = [
    0x00, 0xff, 0x51, 0x03, tempo1, tempo2, tempo3, // Set Tempo
    0x00, 0xff, 0x2f, 0x00, // End of Track
  ];
  const tempoTrackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    0x00, 0x00, 0x00, tempoTrackEvents.length,
  ];

  // Track 1: Note track
  const noteTrackEvents = [
    0x00, 0x90, 0x3c, 0x64, // Note On
    0x60, 0x80, 0x3c, 0x00, // Note Off
    0x00, 0xff, 0x2f, 0x00, // End of Track
  ];
  const noteTrackHeader = [
    0x4d, 0x54, 0x72, 0x6b,
    0x00, 0x00, 0x00, noteTrackEvents.length,
  ];

  return new Uint8Array([
    ...header,
    ...tempoTrackHeader,
    ...tempoTrackEvents,
    ...noteTrackHeader,
    ...noteTrackEvents,
  ]);
}

describe('MidiParser', () => {
  describe('parseMidi', () => {
    it('should parse a minimal valid MIDI file', () => {
      const data = createMinimalMidiBuffer();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 0);
      assert.strictEqual(result.file.header.numTracks, 1);
      assert.strictEqual(result.file.header.ticksPerQuarterNote, 480);
    });

    it('should parse track data correctly', () => {
      const data = createMinimalMidiBuffer();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks.length, 1);

      const track = result.file.tracks[0];
      assert.strictEqual(track.index, 0);
      assert.strictEqual(track.notes.length, 1);

      const note = track.notes[0];
      assert.strictEqual(note.note, 60); // C4
      assert.strictEqual(note.velocity, 100);
      assert.strictEqual(note.startTime, 0);
      assert.strictEqual(note.duration, 96);
    });

    it('should extract tempo changes', () => {
      const bpm = 140;
      const data = createMidiWithTempo(bpm);
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.ok(result.file.tempoChanges.length > 0);
      // Allow small floating point variance
      assert.ok(Math.abs(result.file.tempoChanges[0].bpm - bpm) < 1);
    });

    it('should fail on invalid header', () => {
      const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const result = parseMidi(invalidData);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('MThd'));
    });

    it('should fail on empty data', () => {
      const emptyData = new Uint8Array(0);
      const result = parseMidi(emptyData);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it('should fail on truncated header', () => {
      const truncatedData = new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0x00]);
      const result = parseMidi(truncatedData);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });

    it('should fail on invalid header length', () => {
      const data = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x05, // Invalid length: 5 (should be 6)
        0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
      ]);
      const result = parseMidi(data);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('length'));
    });

    it('should handle ArrayBuffer input', () => {
      const data = createMinimalMidiBuffer();
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      const result = parseMidi(arrayBuffer);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
    });

    it('should use default tempo when none specified', () => {
      const data = createMinimalMidiBuffer();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120); // Default tempo
    });

    it('should convert MIDI note to name correctly', () => {
      const data = createMinimalMidiBuffer();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      const note = result.file.tracks[0].notes[0];
      assert.strictEqual(note.noteName, 'C4');
    });
  });

  describe('parseMidiFromBase64', () => {
    it('should parse valid base64 MIDI data', () => {
      const data = createMinimalMidiBuffer();
      const base64 = btoa(String.fromCharCode(...data));
      const result = parseMidiFromBase64(base64);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 0);
    });

    it('should fail on invalid base64', () => {
      const result = parseMidiFromBase64('not-valid-base64!!!');

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('base64'));
    });

    it('should fail on valid base64 but invalid MIDI', () => {
      const invalidMidi = btoa('This is not MIDI data');
      const result = parseMidiFromBase64(invalidMidi);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });
  });

  describe('MidiParser options', () => {
    it('should include meta events by default', () => {
      const data = createMinimalMidiBuffer();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);

      const metaEvents = result.file.tracks[0].events.filter(e => e.type === 'meta');
      assert.ok(metaEvents.length > 0);
    });

    it('should exclude meta events when includeMeta is false', () => {
      const data = createMinimalMidiBuffer();
      const result = parseMidi(data, { includeMeta: false });

      assert.strictEqual(result.success, true);
      assert.ok(result.file);

      const metaEvents = result.file.tracks[0].events.filter(e => e.type === 'meta');
      assert.strictEqual(metaEvents.length, 0);
    });
  });

  describe('Variable Length Quantity parsing', () => {
    it('should handle malformed VLQ at end of buffer', () => {
      // Create a buffer with an incomplete VLQ (high bit set but no continuation)
      const header = [
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        0x01, 0xe0,
      ];

      // Track with incomplete VLQ
      const trackEvents = [
        0x80, // VLQ with high bit set but buffer ends here
      ];
      const trackHeader = [
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, trackEvents.length,
      ];

      const data = new Uint8Array([...header, ...trackHeader, ...trackEvents]);
      const result = parseMidi(data);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('end of file') || result.error.includes('variable length'));
    });
  });

  describe('Format types', () => {
    it('should reject invalid MIDI format', () => {
      const data = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x06, // Length: 6
        0x00, 0x03, // Invalid format: 3
        0x00, 0x01, // Num tracks: 1
        0x01, 0xe0, // Ticks per quarter note: 480
      ]);
      const result = parseMidi(data);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('format'));
    });
  });
});
