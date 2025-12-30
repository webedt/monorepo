/**
 * Tests for the MIDI Parser module.
 * Covers bounds checking, SMPTE parsing, overlapping notes, and tempo handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MidiParser, parseMidi, parseMidiFromBase64 } from '../../src/midi/parser.js';

/**
 * Helper to create a minimal valid MIDI file header
 */
function createMidiHeader(format: number = 0, numTracks: number = 1, timeDivision: number = 480): Uint8Array {
  const header = new Uint8Array(14);
  // "MThd"
  header[0] = 0x4D; header[1] = 0x54; header[2] = 0x68; header[3] = 0x64;
  // Header length (6)
  header[4] = 0x00; header[5] = 0x00; header[6] = 0x00; header[7] = 0x06;
  // Format
  header[8] = (format >> 8) & 0xFF; header[9] = format & 0xFF;
  // Number of tracks
  header[10] = (numTracks >> 8) & 0xFF; header[11] = numTracks & 0xFF;
  // Time division
  header[12] = (timeDivision >> 8) & 0xFF; header[13] = timeDivision & 0xFF;
  return header;
}

/**
 * Helper to create a minimal MIDI track
 */
function createMidiTrack(events: number[]): Uint8Array {
  const trackData = new Uint8Array(events);
  const track = new Uint8Array(8 + trackData.length);
  // "MTrk"
  track[0] = 0x4D; track[1] = 0x54; track[2] = 0x72; track[3] = 0x6B;
  // Track length
  const len = trackData.length;
  track[4] = (len >> 24) & 0xFF;
  track[5] = (len >> 16) & 0xFF;
  track[6] = (len >> 8) & 0xFF;
  track[7] = len & 0xFF;
  // Track data
  track.set(trackData, 8);
  return track;
}

/**
 * Helper to concatenate Uint8Arrays
 */
function concatArrays(...arrays: Uint8Array[]): Uint8Array {
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
  describe('Bounds Checking', () => {
    it('should throw on truncated header', () => {
      const truncated = new Uint8Array([0x4D, 0x54, 0x68, 0x64]); // Just "MThd"
      const result = parseMidi(truncated);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Unexpected end of file') || result.error?.includes('need'));
    });

    it('should throw on truncated track header', () => {
      const header = createMidiHeader(0, 1, 480);
      const truncatedTrack = new Uint8Array([0x4D, 0x54, 0x72, 0x6B]); // Just "MTrk"
      const data = concatArrays(header, truncatedTrack);
      const result = parseMidi(data);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Unexpected end of file') || result.error?.includes('need'));
    });

    it('should throw on truncated event data', () => {
      const header = createMidiHeader(0, 1, 480);
      // Track with incomplete note event (missing velocity byte)
      const track = createMidiTrack([
        0x00, 0x90, 0x3C, // Delta=0, NoteOn channel 0, note 60, missing velocity
      ]);
      const data = concatArrays(header, track);
      const result = parseMidi(data);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Unexpected end of file') || result.error?.includes('position'));
    });

    it('should handle empty file', () => {
      const result = parseMidi(new Uint8Array(0));

      assert.strictEqual(result.success, false);
      assert.ok(result.error);
    });
  });

  describe('SMPTE Time Division', () => {
    it('should parse SMPTE time division correctly', () => {
      // SMPTE 30fps with 80 ticks per frame: 0xE250 (high byte = -30, low byte = 80)
      const timeDivision = 0xE250; // -30 fps (0xE2 = -30 as signed), 80 ticks
      const header = createMidiHeader(0, 1, timeDivision);
      // Add minimal end-of-track
      const track = createMidiTrack([0x00, 0xFF, 0x2F, 0x00]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // 30 fps * 80 ticks / 2 = 1200 approximate ticks per quarter note
      assert.strictEqual(result.file.header.ticksPerQuarterNote, 1200);
    });

    it('should parse standard time division correctly', () => {
      const header = createMidiHeader(0, 1, 480);
      const track = createMidiTrack([0x00, 0xFF, 0x2F, 0x00]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.ticksPerQuarterNote, 480);
    });
  });

  describe('Overlapping Notes', () => {
    it('should handle overlapping notes on same pitch correctly', () => {
      const header = createMidiHeader(0, 1, 480);
      // Two overlapping notes on same pitch (C4 = 60)
      // Note 1: On at tick 0, Off at tick 480
      // Note 2: On at tick 240, Off at tick 720
      const track = createMidiTrack([
        0x00, 0x90, 0x3C, 0x64,       // Delta=0, NoteOn C4 vel=100
        0x81, 0x70, 0x90, 0x3C, 0x64, // Delta=240, NoteOn C4 vel=100 (overlapping)
        0x81, 0x70, 0x80, 0x3C, 0x00, // Delta=240, NoteOff C4 (ends first note)
        0x81, 0x70, 0x80, 0x3C, 0x00, // Delta=240, NoteOff C4 (ends second note)
        0x00, 0xFF, 0x2F, 0x00,       // End of track
      ]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 2);

      // First note: starts at 0, ends at 480 (duration 480)
      const note1 = result.file.tracks[0].notes[0];
      assert.strictEqual(note1.startTime, 0);
      assert.strictEqual(note1.duration, 480);

      // Second note: starts at 240, ends at 720 (duration 480)
      const note2 = result.file.tracks[0].notes[1];
      assert.strictEqual(note2.startTime, 240);
      assert.strictEqual(note2.duration, 480);
    });

    it('should handle non-overlapping notes correctly', () => {
      const header = createMidiHeader(0, 1, 480);
      const track = createMidiTrack([
        0x00, 0x90, 0x3C, 0x64,       // Delta=0, NoteOn C4
        0x83, 0x60, 0x80, 0x3C, 0x00, // Delta=480, NoteOff C4
        0x00, 0x90, 0x3E, 0x64,       // Delta=0, NoteOn D4
        0x83, 0x60, 0x80, 0x3E, 0x00, // Delta=480, NoteOff D4
        0x00, 0xFF, 0x2F, 0x00,       // End of track
      ]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 2);
    });
  });

  describe('Tempo Handling', () => {
    it('should ignore zero tempo events', () => {
      const header = createMidiHeader(0, 1, 480);
      // Set tempo to 0 (invalid)
      const track = createMidiTrack([
        0x00, 0xFF, 0x51, 0x03, 0x00, 0x00, 0x00, // Set tempo to 0 (should be ignored)
        0x00, 0xFF, 0x2F, 0x00,                   // End of track
      ]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      // Should use default tempo (120 BPM = 500000 microseconds)
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
    });

    it('should parse valid tempo correctly', () => {
      const header = createMidiHeader(0, 1, 480);
      // Set tempo to 500000 microseconds (120 BPM)
      const track = createMidiTrack([
        0x00, 0xFF, 0x51, 0x03, 0x07, 0xA1, 0x20, // Set tempo to 500000
        0x00, 0xFF, 0x2F, 0x00,                   // End of track
      ]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tempoChanges.length, 1);
      assert.strictEqual(result.file.tempoChanges[0].microsecondsPerQuarterNote, 500000);
      assert.strictEqual(result.file.tempoChanges[0].bpm, 120);
    });
  });

  describe('Basic Parsing', () => {
    it('should parse a minimal valid MIDI file', () => {
      const header = createMidiHeader(0, 1, 480);
      const track = createMidiTrack([
        0x00, 0xFF, 0x2F, 0x00, // End of track
      ]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.header.format, 0);
      assert.strictEqual(result.file.header.numTracks, 1);
      assert.strictEqual(result.file.tracks.length, 1);
    });

    it('should parse note events correctly', () => {
      const header = createMidiHeader(0, 1, 480);
      const track = createMidiTrack([
        0x00, 0x90, 0x3C, 0x64,       // NoteOn C4 vel=100
        0x83, 0x60, 0x80, 0x3C, 0x00, // NoteOff C4 after 480 ticks
        0x00, 0xFF, 0x2F, 0x00,       // End of track
      ]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 1);

      const note = result.file.tracks[0].notes[0];
      assert.strictEqual(note.note, 60);
      assert.strictEqual(note.noteName, 'C4');
      assert.strictEqual(note.velocity, 100);
      assert.strictEqual(note.startTime, 0);
      assert.strictEqual(note.duration, 480);
    });

    it('should reject invalid header chunk type', () => {
      const invalid = new Uint8Array([
        0x58, 0x54, 0x68, 0x64, // "XThd" instead of "MThd"
        0x00, 0x00, 0x00, 0x06,
        0x00, 0x00, 0x00, 0x01, 0x01, 0xE0,
      ]);

      const result = parseMidi(invalid);

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('MThd'));
    });
  });

  describe('Base64 Parsing', () => {
    it('should parse base64 encoded MIDI', () => {
      const header = createMidiHeader(0, 1, 480);
      const track = createMidiTrack([0x00, 0xFF, 0x2F, 0x00]);
      const data = concatArrays(header, track);
      const base64 = Buffer.from(data).toString('base64');

      const result = parseMidiFromBase64(base64);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
    });

    it('should reject invalid base64', () => {
      const result = parseMidiFromBase64('not-valid-base64!!!');

      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('base64') || result.error?.includes('Invalid'));
    });
  });

  describe('Running Status', () => {
    it('should handle running status correctly', () => {
      const header = createMidiHeader(0, 1, 480);
      // Note on followed by running status note on
      const track = createMidiTrack([
        0x00, 0x90, 0x3C, 0x64, // NoteOn C4 vel=100
        0x60, 0x3E, 0x64,       // Running status: NoteOn D4 vel=100 (delta=96)
        0x60, 0x80, 0x3C, 0x00, // NoteOff C4
        0x00, 0x80, 0x3E, 0x00, // NoteOff D4
        0x00, 0xFF, 0x2F, 0x00, // End of track
      ]);
      const data = concatArrays(header, track);

      const result = parseMidi(data);

      assert.strictEqual(result.success, true);
      assert.ok(result.file);
      assert.strictEqual(result.file.tracks[0].notes.length, 2);
    });
  });
});
