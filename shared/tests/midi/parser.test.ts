/**
 * Tests for the MIDI parser.
 * Covers parsing of MIDI file header, tracks, events, and error handling.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { MidiParser, parseMidi, parseMidiFromBase64 } from '../../src/midi/parser.js';

/**
 * Helper to create a simple MIDI file header chunk
 */
function createMidiHeader(format: number, numTracks: number, ticksPerQuarterNote: number): Uint8Array {
  const header = new Uint8Array(14);
  // "MThd"
  header[0] = 0x4d;
  header[1] = 0x54;
  header[2] = 0x68;
  header[3] = 0x64;
  // Length (6)
  header[4] = 0x00;
  header[5] = 0x00;
  header[6] = 0x00;
  header[7] = 0x06;
  // Format
  header[8] = (format >> 8) & 0xff;
  header[9] = format & 0xff;
  // Number of tracks
  header[10] = (numTracks >> 8) & 0xff;
  header[11] = numTracks & 0xff;
  // Ticks per quarter note
  header[12] = (ticksPerQuarterNote >> 8) & 0xff;
  header[13] = ticksPerQuarterNote & 0xff;
  return header;
}

/**
 * Helper to create an empty MIDI track
 */
function createEmptyTrack(): Uint8Array {
  const track = new Uint8Array(12);
  // "MTrk"
  track[0] = 0x4d;
  track[1] = 0x54;
  track[2] = 0x72;
  track[3] = 0x6b;
  // Length (4 bytes for end of track event)
  track[4] = 0x00;
  track[5] = 0x00;
  track[6] = 0x00;
  track[7] = 0x04;
  // End of track event: delta=0, meta=0xFF, type=0x2F, length=0
  track[8] = 0x00;
  track[9] = 0xff;
  track[10] = 0x2f;
  track[11] = 0x00;
  return track;
}

/**
 * Helper to create a track with a single note
 */
function createTrackWithNote(channel: number, note: number, velocity: number, duration: number): Uint8Array {
  // Track with: Note On, delay, Note Off, End of Track
  const events = new Uint8Array([
    // Note On: delta=0, status, note, velocity
    0x00, 0x90 | channel, note, velocity,
    // Note Off: delta=duration, status, note, velocity
    duration, 0x80 | channel, note, 0x40,
    // End of Track
    0x00, 0xff, 0x2f, 0x00,
  ]);

  const track = new Uint8Array(8 + events.length);
  // "MTrk"
  track[0] = 0x4d;
  track[1] = 0x54;
  track[2] = 0x72;
  track[3] = 0x6b;
  // Length
  track[4] = 0x00;
  track[5] = 0x00;
  track[6] = 0x00;
  track[7] = events.length;
  track.set(events, 8);
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
  describe('header parsing', () => {
    it('should parse a valid MIDI header', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createEmptyTrack();
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.header.format, 1);
      assert.strictEqual(result.file?.header.numTracks, 1);
      assert.strictEqual(result.file?.header.ticksPerQuarterNote, 480);
    });

    it('should parse format 0 MIDI files', () => {
      const header = createMidiHeader(0, 1, 96);
      const track = createEmptyTrack();
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.header.format, 0);
    });

    it('should parse format 2 MIDI files', () => {
      const header = createMidiHeader(2, 1, 96);
      const track = createEmptyTrack();
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.header.format, 2);
    });

    it('should reject invalid header chunk type', () => {
      const data = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      const result = parseMidi(data);
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid MIDI file'));
    });

    it('should reject invalid header length', () => {
      const header = new Uint8Array(14);
      header[0] = 0x4d;
      header[1] = 0x54;
      header[2] = 0x68;
      header[3] = 0x64;
      // Invalid length (5 instead of 6)
      header[4] = 0x00;
      header[5] = 0x00;
      header[6] = 0x00;
      header[7] = 0x05;

      const result = parseMidi(header);
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid MIDI header length'));
    });

    it('should reject invalid format', () => {
      const header = createMidiHeader(3, 1, 480);
      const track = createEmptyTrack();
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid MIDI format'));
    });
  });

  describe('track parsing', () => {
    it('should parse multiple tracks', () => {
      const header = createMidiHeader(1, 2, 480);
      const track1 = createEmptyTrack();
      const track2 = createEmptyTrack();
      const data = concatArrays(header, track1, track2);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks.length, 2);
    });

    it('should reject invalid track header', () => {
      const header = createMidiHeader(1, 1, 480);
      const invalidTrack = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const data = concatArrays(header, invalidTrack);

      const result = parseMidi(data);
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid track header'));
    });
  });

  describe('note event parsing', () => {
    it('should parse note on and off events', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createTrackWithNote(0, 60, 100, 96);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks[0].notes.length, 1);

      const note = result.file?.tracks[0].notes[0];
      assert.strictEqual(note?.note, 60);
      assert.strictEqual(note?.velocity, 100);
      assert.strictEqual(note?.channel, 0);
      assert.strictEqual(note?.duration, 96);
    });

    it('should parse notes on different channels', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createTrackWithNote(9, 36, 127, 48);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks[0].notes[0]?.channel, 9);
    });

    it('should convert MIDI note numbers to note names', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createTrackWithNote(0, 60, 100, 96);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks[0].notes[0]?.noteName, 'C4');
    });

    it('should handle note on with velocity 0 as note off', () => {
      const header = createMidiHeader(1, 1, 480);
      // Create track with Note On followed by Note On with velocity 0
      const events = new Uint8Array([
        0x00, 0x90, 60, 100, // Note On
        0x60, 0x90, 60, 0,   // Note On with velocity 0 = Note Off
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks[0].notes.length, 1);
      assert.strictEqual(result.file?.tracks[0].notes[0]?.duration, 0x60);
    });
  });

  describe('meta event parsing', () => {
    it('should parse tempo changes', () => {
      const header = createMidiHeader(1, 1, 480);
      // Track with tempo change (120 BPM = 500000 microseconds)
      const events = new Uint8Array([
        0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // Set Tempo to 500000
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tempoChanges.length, 1);
      assert.strictEqual(result.file?.tempoChanges[0].microsecondsPerQuarterNote, 500000);
      assert.strictEqual(result.file?.tempoChanges[0].bpm, 120);
    });

    it('should parse track names', () => {
      const header = createMidiHeader(1, 1, 480);
      // Track with name "Test"
      const events = new Uint8Array([
        0x00, 0xff, 0x03, 0x04, 0x54, 0x65, 0x73, 0x74, // Track Name "Test"
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks[0].name, 'Test');
    });

    it('should parse time signature', () => {
      const header = createMidiHeader(1, 1, 480);
      // Track with time signature 3/4
      const events = new Uint8Array([
        0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // Time Signature 3/4
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.timeSignatures.length, 1);
      assert.strictEqual(result.file?.timeSignatures[0].numerator, 3);
      assert.strictEqual(result.file?.timeSignatures[0].denominator, 4);
    });

    it('should filter meta events when includeMeta is false', () => {
      const header = createMidiHeader(1, 1, 480);
      // Track with track name meta event
      const events = new Uint8Array([
        0x00, 0xff, 0x03, 0x04, 0x54, 0x65, 0x73, 0x74,
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data, { includeMeta: false });
      assert.strictEqual(result.success, true);
      // Meta events should not be in the events array when includeMeta is false
      const metaEvents = result.file?.tracks[0].events.filter(e => e.type === 'meta') ?? [];
      assert.strictEqual(metaEvents.length, 0);
    });
  });

  describe('duration calculation', () => {
    it('should calculate file duration in ticks', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createTrackWithNote(0, 60, 100, 96);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.durationTicks, 96);
    });

    it('should calculate file duration in seconds', () => {
      const header = createMidiHeader(1, 1, 480);
      // Track with tempo and note
      const events = new Uint8Array([
        0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // 120 BPM
        0x00, 0x90, 60, 100, // Note On
        0x81, 0x40, 0x80, 60, 0x40, // Note Off at tick 192 (0x81 0x40 = 192)
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      // 192 ticks at 120 BPM with 480 ticks per quarter = 0.2 seconds
      assert.ok(Math.abs(result.file!.durationSeconds - 0.2) < 0.01);
    });

    it('should use default 120 BPM if no tempo specified', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createEmptyTrack();
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.initialTempo, 120);
    });
  });

  describe('base64 parsing', () => {
    it('should parse MIDI from valid base64', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createEmptyTrack();
      const data = concatArrays(header, track);
      const base64 = Buffer.from(data).toString('base64');

      const result = parseMidiFromBase64(base64);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.header.format, 1);
    });

    it('should return error for invalid base64', () => {
      const result = parseMidiFromBase64('not-valid-base64!!!');
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid base64'));
    });
  });

  describe('edge cases', () => {
    it('should handle ArrayBuffer input', () => {
      const header = createMidiHeader(1, 1, 480);
      const track = createEmptyTrack();
      const data = concatArrays(header, track);
      const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

      const parser = new MidiParser(arrayBuffer);
      const result = parser.parse();
      assert.strictEqual(result.success, true);
    });

    it('should handle running status', () => {
      const header = createMidiHeader(1, 1, 480);
      // Track with running status (omit status byte for second note)
      const events = new Uint8Array([
        0x00, 0x90, 60, 100, // Note On with status
        0x10, 62, 100,       // Note On using running status
        0x10, 0x80, 60, 64,  // Note Off for first note
        0x10, 0x80, 62, 64,  // Note Off for second note
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks[0].notes.length, 2);
    });

    it('should handle variable length quantity encoding', () => {
      const header = createMidiHeader(1, 1, 480);
      // Track with VLQ-encoded delta time (0x81 0x40 = 192)
      const events = new Uint8Array([
        0x00, 0x90, 60, 100,
        0x81, 0x40, 0x80, 60, 64,
        0x00, 0xff, 0x2f, 0x00,
      ]);
      const track = new Uint8Array(8 + events.length);
      track[0] = 0x4d;
      track[1] = 0x54;
      track[2] = 0x72;
      track[3] = 0x6b;
      track[7] = events.length;
      track.set(events, 8);
      const data = concatArrays(header, track);

      const result = parseMidi(data);
      assert.strictEqual(result.success, true);
      assert.strictEqual(result.file?.tracks[0].notes[0]?.duration, 192);
    });

    it('should handle empty file gracefully', () => {
      const result = parseMidi(new Uint8Array(0));
      assert.strictEqual(result.success, false);
    });

    it('should handle truncated file gracefully', () => {
      // Create a header that claims 1 track but has no track data
      const header = createMidiHeader(1, 1, 480);
      const result = parseMidi(header);
      assert.strictEqual(result.success, false);
      assert.ok(result.error?.includes('Invalid track header'));
    });
  });
});
