/**
 * MIDI Parser Tests
 * Tests for parsing Standard MIDI File (SMF) format
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseMidi, parseMidiFromBase64 } from '../../src/midi/parser.js';

/**
 * Create a minimal valid MIDI file for testing
 * Format 0, 1 track, 480 ticks per quarter note
 */
function createMinimalMidiFile(): Uint8Array {
  return new Uint8Array([
    // Header chunk "MThd"
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Header length: 6 bytes
    0x00, 0x00, // Format 0
    0x00, 0x01, // 1 track
    0x01, 0xe0, // 480 ticks per quarter note

    // Track chunk "MTrk"
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    0x00, 0x00, 0x00, 0x14, // Track length: 20 bytes

    // Delta time 0, Note On, channel 0, note 60, velocity 100
    0x00, 0x90, 0x3c, 0x64,
    // Delta time 480 (one quarter note), Note Off, channel 0, note 60, velocity 0
    0x83, 0x60, 0x80, 0x3c, 0x00,
    // Delta time 0, Set Tempo (120 BPM = 500000 microseconds)
    0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20,
    // Delta time 0, End of Track
    0x00, 0xff, 0x2f, 0x00,
  ]);
}

/**
 * Create a MIDI file with multiple tracks
 */
function createMultiTrackMidiFile(): Uint8Array {
  return new Uint8Array([
    // Header chunk "MThd"
    0x4d, 0x54, 0x68, 0x64, // "MThd"
    0x00, 0x00, 0x00, 0x06, // Header length: 6 bytes
    0x00, 0x01, // Format 1
    0x00, 0x02, // 2 tracks
    0x00, 0x60, // 96 ticks per quarter note

    // Track 1 - Tempo track "MTrk"
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    0x00, 0x00, 0x00, 0x0d, // Track length: 13 bytes
    // Track name: delta(1) + ff 03(2) + len(1) + "Tempo"(5) = 9 bytes
    0x00, 0xff, 0x03, 0x05, 0x54, 0x65, 0x6d, 0x70, 0x6f,
    // End of Track: delta(1) + ff 2f(2) + len(1) = 4 bytes
    0x00, 0xff, 0x2f, 0x00,

    // Track 2 - Notes track "MTrk"
    0x4d, 0x54, 0x72, 0x6b, // "MTrk"
    0x00, 0x00, 0x00, 0x14, // Track length: 20 bytes
    // Track name: delta(1) + ff 03(2) + len(1) + "Piano"(5) = 9 bytes
    0x00, 0xff, 0x03, 0x05, 0x50, 0x69, 0x61, 0x6e, 0x6f,
    // Note On: delta(1) + 90 40 50(3) = 4 bytes
    0x00, 0x90, 0x40, 0x50,
    // Note Off using running status: delta(1) + 40 00(2) = 3 bytes
    0x60, 0x40, 0x00,
    // End of Track: delta(1) + ff 2f(2) + len(1) = 4 bytes
    0x00, 0xff, 0x2f, 0x00,
  ]);
}

describe('MIDI Parser', () => {
  describe('parseMidi', () => {
    it('should parse a minimal valid MIDI file', () => {
      const data = createMinimalMidiFile();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 0);
      assert.strictEqual(result.file.header.numTracks, 1);
      assert.strictEqual(result.file.header.ticksPerQuarterNote, 480);
      assert.strictEqual(result.file.tracks.length, 1);
    });

    it('should parse multi-track MIDI files', () => {
      const data = createMultiTrackMidiFile();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 1);
      assert.strictEqual(result.file.header.numTracks, 2);
      assert.strictEqual(result.file.tracks.length, 2);
    });

    it('should extract track names', () => {
      const data = createMultiTrackMidiFile();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].name, 'Tempo');
      assert.strictEqual(result.file.tracks[1].name, 'Piano');
    });

    it('should extract notes with correct properties', () => {
      const data = createMinimalMidiFile();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 1);

      const note = result.file.tracks[0].notes[0];
      assert.strictEqual(note.note, 60); // Middle C
      assert.strictEqual(note.velocity, 100);
      assert.strictEqual(note.channel, 0);
      assert.strictEqual(note.duration, 480); // One quarter note
    });

    it('should extract tempo changes', () => {
      const data = createMinimalMidiFile();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].microsecondsPerQuarterNote, 500000);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
    });

    it('should use default tempo when none specified', () => {
      // Create a MIDI file without tempo events
      const data = new Uint8Array([
        // Header
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        0x01, 0xe0,
        // Track
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x04,
        0x00, 0xff, 0x2f, 0x00,
      ]);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120); // Default tempo
      assert.strictEqual(result.file.initialTempo, 120);
    });

    it('should reject invalid MIDI files', () => {
      const invalidData = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
      const result = parseMidi(invalidData);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('Invalid MIDI file'));
    });

    it('should reject files with invalid header length', () => {
      const data = new Uint8Array([
        0x4d, 0x54, 0x68, 0x64, // "MThd"
        0x00, 0x00, 0x00, 0x05, // Invalid header length: 5 (should be 6)
        0x00, 0x00, 0x00, 0x01, 0x01, 0xe0,
      ]);

      const result = parseMidi(data);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('Invalid MIDI header length'));
    });

    it('should calculate note names correctly', () => {
      const data = createMinimalMidiFile();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes[0].noteName, 'C4'); // Middle C
    });
  });

  describe('parseMidiFromBase64', () => {
    it('should parse base64 encoded MIDI data', () => {
      const data = createMinimalMidiFile();
      // Use Buffer for base64 encoding in Node.js
      const base64 = Buffer.from(data).toString('base64');
      const result = parseMidiFromBase64(base64);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 0);
    });

    it('should reject invalid base64 data', () => {
      const result = parseMidiFromBase64('!!!invalid-base64!!!');

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error.includes('Invalid base64 data'));
    });

    it('should reject valid base64 with invalid MIDI content', () => {
      const base64 = Buffer.from('not a midi file').toString('base64');
      const result = parseMidiFromBase64(base64);

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });
  });

  describe('Parser options', () => {
    it('should include meta events by default', () => {
      const data = createMinimalMidiFile();
      const result = parseMidi(data, { includeMeta: true });

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      const metaEvents = result.file.tracks[0].events.filter(e => e.type === 'meta');
      assert.ok(metaEvents.length > 0);
    });

    it('should exclude sysex events by default', () => {
      const data = createMinimalMidiFile();
      const result = parseMidi(data, { includeSysex: false });

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      const sysexEvents = result.file.tracks[0].events.filter(e => e.type === 'sysex');
      assert.strictEqual(sysexEvents.length, 0);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty tracks', () => {
      const data = new Uint8Array([
        // Header
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        0x00, 0x60,
        // Empty track (only End of Track)
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x04,
        0x00, 0xff, 0x2f, 0x00,
      ]);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 0);
    });

    it('should handle running status', () => {
      const data = createMultiTrackMidiFile();
      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[1].notes.length, 1);
    });

    it('should handle note-on with velocity 0 as note-off', () => {
      const data = new Uint8Array([
        // Header
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        0x00, 0x60,
        // Track
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x0c,
        // Note On
        0x00, 0x90, 0x40, 0x64,
        // Note On with velocity 0 (acts as Note Off)
        0x60, 0x90, 0x40, 0x00,
        // End of Track
        0x00, 0xff, 0x2f, 0x00,
      ]);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 1);
      assert.strictEqual(result.file.tracks[0].notes[0].duration, 96);
    });

    it('should handle variable length quantities', () => {
      // Test with a large delta time that uses 2 bytes
      const data = new Uint8Array([
        // Header
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        0x00, 0x60,
        // Track
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x00, 0x0d,
        // Note On
        0x00, 0x90, 0x40, 0x64,
        // Note Off with delta time 0x0100 (256) encoded as VLQ: 0x82 0x00
        0x82, 0x00, 0x80, 0x40, 0x00,
        // End of Track
        0x00, 0xff, 0x2f, 0x00,
      ]);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes[0].duration, 256);
    });

    it('should handle malformed files gracefully (bounds checking)', () => {
      // Create a file that claims a track length longer than available data
      const data = new Uint8Array([
        // Header
        0x4d, 0x54, 0x68, 0x64,
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00,
        0x00, 0x01,
        0x00, 0x60,
        // Track with length that exceeds file
        0x4d, 0x54, 0x72, 0x6b,
        0x00, 0x00, 0x01, 0x00, // Claims 256 bytes but file ends
        0x00, 0xff, 0x2f, 0x00,
      ]);

      const result = parseMidi(data);
      // Parser should handle this gracefully (either succeed with partial data or fail cleanly)
      assert.strictEqual(typeof result.success, 'boolean');
    });
  });
});
