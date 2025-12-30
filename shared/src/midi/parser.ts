/**
 * MIDI Parser
 * Parses Standard MIDI File (SMF) format
 */

import type { MidiEvent } from './types.js';
import type { MidiFile } from './types.js';
import type { MidiFormat } from './types.js';
import type { MidiHeader } from './types.js';
import type { MidiMetaEvent } from './types.js';
import type { MidiMetaEventSubtype } from './types.js';
import type { MidiNoteEvent } from './types.js';
import type { MidiParseOptions } from './types.js';
import type { MidiParseResult } from './types.js';
import type { MidiTempoChange } from './types.js';
import type { MidiTimeSignature } from './types.js';
import type { MidiTrack } from './types.js';

/**
 * MIDI Parser class for parsing binary MIDI data
 */
export class MidiParser {
  private data: Uint8Array;
  private position: number = 0;
  private options: MidiParseOptions;

  constructor(data: Uint8Array | ArrayBuffer, options: MidiParseOptions = {}) {
    this.data = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.options = {
      includeMeta: options.includeMeta ?? true,
      includeSysex: options.includeSysex ?? false,
    };
  }

  /**
   * Parse the MIDI file
   */
  parse(): MidiParseResult {
    try {
      this.position = 0;

      // Parse header
      const header = this.parseHeader();

      // Parse tracks
      const tracks: MidiTrack[] = [];
      const tempoChanges: MidiTempoChange[] = [];
      const timeSignatures: MidiTimeSignature[] = [];

      for (let i = 0; i < header.numTracks; i++) {
        const track = this.parseTrack(i, header.ticksPerQuarterNote);
        tracks.push(track);

        // Extract tempo changes and time signatures from track 0 (or all tracks for format 0)
        if (i === 0 || header.format === 0) {
          for (const event of track.events) {
            if (event.type === 'meta') {
              const metaEvent = event as MidiMetaEvent;
              if (metaEvent.subtype === 'setTempo' && metaEvent.tempo !== undefined) {
                tempoChanges.push({
                  time: event.absoluteTime,
                  microsecondsPerQuarterNote: metaEvent.tempo,
                  bpm: 60000000 / metaEvent.tempo,
                });
              }
              if (metaEvent.subtype === 'timeSignature') {
                timeSignatures.push({
                  time: event.absoluteTime,
                  numerator: metaEvent.numerator || 4,
                  denominator: metaEvent.denominator || 4,
                });
              }
            }
          }
        }
      }

      // Default tempo if none specified
      if (tempoChanges.length === 0) {
        tempoChanges.push({
          time: 0,
          microsecondsPerQuarterNote: 500000, // 120 BPM
          bpm: 120,
        });
      }

      // Calculate durations
      let durationTicks = 0;
      for (const track of tracks) {
        for (const event of track.events) {
          if (event.absoluteTime > durationTicks) {
            durationTicks = event.absoluteTime;
          }
        }
      }

      const durationSeconds = this.ticksToSeconds(
        durationTicks,
        tempoChanges,
        header.ticksPerQuarterNote
      );

      const file: MidiFile = {
        header,
        tracks,
        tempoChanges,
        timeSignatures,
        durationTicks,
        durationSeconds,
        initialTempo: tempoChanges[0].bpm,
      };

      return { success: true, file };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown parsing error',
      };
    }
  }

  /**
   * Parse the MIDI file header
   */
  private parseHeader(): MidiHeader {
    // Check for "MThd" header
    const chunkType = this.readString(4);
    if (chunkType !== 'MThd') {
      throw new Error(`Invalid MIDI file: expected "MThd", got "${chunkType}"`);
    }

    // Read header length (should be 6)
    const length = this.readUint32();
    if (length !== 6) {
      throw new Error(`Invalid MIDI header length: ${length}`);
    }

    // Read format, number of tracks, and time division
    const format = this.readUint16() as MidiFormat;
    if (format !== 0 && format !== 1 && format !== 2) {
      throw new Error(`Invalid MIDI format: ${format}`);
    }

    const numTracks = this.readUint16();
    const timeDivision = this.readUint16();

    // Handle time division
    let ticksPerQuarterNote: number;
    if (timeDivision & 0x8000) {
      // SMPTE format - convert to approximate ticks per quarter note
      const fps = -((timeDivision >> 8) | 0xffffff00);
      const ticksPerFrame = timeDivision & 0xff;
      // Approximate at 120 BPM
      ticksPerQuarterNote = Math.round((fps * ticksPerFrame) / 2);
    } else {
      ticksPerQuarterNote = timeDivision;
    }

    return { format, numTracks, ticksPerQuarterNote };
  }

  /**
   * Parse a MIDI track
   */
  private parseTrack(index: number, ticksPerQuarterNote: number): MidiTrack {
    // Check for "MTrk" header
    const chunkType = this.readString(4);
    if (chunkType !== 'MTrk') {
      throw new Error(`Invalid track header: expected "MTrk", got "${chunkType}"`);
    }

    const length = this.readUint32();
    const endPosition = this.position + length;

    const events: MidiEvent[] = [];
    let absoluteTime = 0;
    let runningStatus = 0;
    let trackName: string | undefined;

    // Note tracking for duration calculation
    const activeNotes: Map<string, { event: MidiEvent; startTime: number }> = new Map();
    const notes: MidiNoteEvent[] = [];

    while (this.position < endPosition) {
      const deltaTime = this.readVariableLengthQuantity();
      absoluteTime += deltaTime;

      const event = this.parseEvent(deltaTime, absoluteTime, runningStatus);
      if (event) {
        // Update running status for channel events
        if (event.channel !== undefined) {
          const statusByte = this.getStatusByte(event);
          if (statusByte !== undefined) {
            runningStatus = statusByte;
          }
        }

        // Track note on/off for duration calculation
        if (event.type === 'noteOn' && event.velocity > 0) {
          const key = `${event.channel}-${event.note}`;
          activeNotes.set(key, { event, startTime: absoluteTime });
        } else if (event.type === 'noteOff' || (event.type === 'noteOn' && event.velocity === 0)) {
          const key = `${event.channel}-${event.note}`;
          const activeNote = activeNotes.get(key);
          if (activeNote && activeNote.event.type === 'noteOn') {
            const noteEvent = activeNote.event;
            const duration = absoluteTime - activeNote.startTime;
            notes.push({
              note: noteEvent.note,
              noteName: this.midiNoteToName(noteEvent.note),
              velocity: noteEvent.velocity,
              channel: noteEvent.channel,
              startTime: activeNote.startTime,
              duration,
              startTimeSeconds: 0, // Will be calculated later
              durationSeconds: 0, // Will be calculated later
            });
            activeNotes.delete(key);
          }
        }

        // Extract track name
        if (event.type === 'meta' && event.subtype === 'trackName' && event.text) {
          trackName = event.text;
        }

        // Filter events based on options
        const shouldInclude =
          (event.type !== 'meta' && event.type !== 'sysex') ||
          (event.type === 'meta' && this.options.includeMeta) ||
          (event.type === 'sysex' && this.options.includeSysex);

        if (shouldInclude) {
          events.push(event);
        }
      }
    }

    // Ensure position is at end of track
    this.position = endPosition;

    return { index, name: trackName, events, notes };
  }

  /**
   * Parse a single MIDI event
   */
  private parseEvent(deltaTime: number, absoluteTime: number, runningStatus: number): MidiEvent | null {
    let statusByte = this.data[this.position];

    // Check for running status
    if (statusByte < 0x80) {
      if (runningStatus === 0) {
        throw new Error('Invalid running status');
      }
      statusByte = runningStatus;
    } else {
      this.position++;
    }

    const eventType = statusByte >> 4;
    const channel = statusByte & 0x0f;

    switch (eventType) {
      case 0x8: // Note Off
        return {
          type: 'noteOff',
          deltaTime,
          absoluteTime,
          channel,
          note: this.readByte(),
          velocity: this.readByte(),
        };

      case 0x9: // Note On
        return {
          type: 'noteOn',
          deltaTime,
          absoluteTime,
          channel,
          note: this.readByte(),
          velocity: this.readByte(),
        };

      case 0xa: // Note Aftertouch
        return {
          type: 'noteAftertouch',
          deltaTime,
          absoluteTime,
          channel,
          note: this.readByte(),
          pressure: this.readByte(),
        };

      case 0xb: // Control Change
        return {
          type: 'controlChange',
          deltaTime,
          absoluteTime,
          channel,
          controller: this.readByte(),
          value: this.readByte(),
        };

      case 0xc: // Program Change
        return {
          type: 'programChange',
          deltaTime,
          absoluteTime,
          channel,
          program: this.readByte(),
        };

      case 0xd: // Channel Aftertouch
        return {
          type: 'channelAftertouch',
          deltaTime,
          absoluteTime,
          channel,
          pressure: this.readByte(),
        };

      case 0xe: // Pitch Bend
        const lsb = this.readByte();
        const msb = this.readByte();
        return {
          type: 'pitchBend',
          deltaTime,
          absoluteTime,
          channel,
          value: ((msb << 7) | lsb) - 8192,
        };

      case 0xf: // System events
        return this.parseSystemEvent(statusByte, deltaTime, absoluteTime);

      default:
        return null;
    }
  }

  /**
   * Parse system events (meta and sysex)
   */
  private parseSystemEvent(statusByte: number, deltaTime: number, absoluteTime: number): MidiEvent | null {
    if (statusByte === 0xff) {
      // Meta event
      return this.parseMetaEvent(deltaTime, absoluteTime);
    } else if (statusByte === 0xf0 || statusByte === 0xf7) {
      // SysEx event
      const length = this.readVariableLengthQuantity();
      const data = this.data.slice(this.position, this.position + length);
      this.position += length;
      return {
        type: 'sysex',
        deltaTime,
        absoluteTime,
        data,
      };
    }
    return null;
  }

  /**
   * Parse a meta event
   */
  private parseMetaEvent(deltaTime: number, absoluteTime: number): MidiMetaEvent {
    const metaType = this.readByte();
    const length = this.readVariableLengthQuantity();
    const data = this.data.slice(this.position, this.position + length);
    this.position += length;

    const baseEvent: MidiMetaEvent = {
      type: 'meta',
      deltaTime,
      absoluteTime,
      subtype: 'unknown',
      data,
    };

    switch (metaType) {
      case 0x00: // Sequence Number
        baseEvent.subtype = 'sequenceNumber';
        break;

      case 0x01: // Text
        baseEvent.subtype = 'text';
        baseEvent.text = this.decodeText(data);
        break;

      case 0x02: // Copyright
        baseEvent.subtype = 'copyright';
        baseEvent.text = this.decodeText(data);
        break;

      case 0x03: // Track Name
        baseEvent.subtype = 'trackName';
        baseEvent.text = this.decodeText(data);
        break;

      case 0x04: // Instrument Name
        baseEvent.subtype = 'instrumentName';
        baseEvent.text = this.decodeText(data);
        break;

      case 0x05: // Lyrics
        baseEvent.subtype = 'lyrics';
        baseEvent.text = this.decodeText(data);
        break;

      case 0x06: // Marker
        baseEvent.subtype = 'marker';
        baseEvent.text = this.decodeText(data);
        break;

      case 0x07: // Cue Point
        baseEvent.subtype = 'cuePoint';
        baseEvent.text = this.decodeText(data);
        break;

      case 0x20: // Channel Prefix
        baseEvent.subtype = 'channelPrefix';
        break;

      case 0x2f: // End of Track
        baseEvent.subtype = 'endOfTrack';
        break;

      case 0x51: // Set Tempo
        baseEvent.subtype = 'setTempo';
        baseEvent.tempo = (data[0] << 16) | (data[1] << 8) | data[2];
        break;

      case 0x54: // SMPTE Offset
        baseEvent.subtype = 'smpteOffset';
        break;

      case 0x58: // Time Signature
        baseEvent.subtype = 'timeSignature';
        baseEvent.numerator = data[0];
        baseEvent.denominator = Math.pow(2, data[1]);
        baseEvent.metronome = data[2];
        baseEvent.thirtyseconds = data[3];
        break;

      case 0x59: // Key Signature
        baseEvent.subtype = 'keySignature';
        baseEvent.key = data[0] > 127 ? data[0] - 256 : data[0];
        baseEvent.scale = data[1];
        break;

      case 0x7f: // Sequencer Specific
        baseEvent.subtype = 'sequencerSpecific';
        break;
    }

    return baseEvent;
  }

  /**
   * Convert ticks to seconds using tempo changes
   */
  private ticksToSeconds(
    ticks: number,
    tempoChanges: MidiTempoChange[],
    ticksPerQuarterNote: number
  ): number {
    let seconds = 0;
    let lastTick = 0;
    let lastTempo = tempoChanges[0]?.microsecondsPerQuarterNote || 500000;

    for (const change of tempoChanges) {
      if (change.time > ticks) break;
      if (change.time > lastTick) {
        seconds += ((change.time - lastTick) * lastTempo) / (ticksPerQuarterNote * 1000000);
        lastTick = change.time;
      }
      lastTempo = change.microsecondsPerQuarterNote;
    }

    // Add remaining time at last tempo
    if (ticks > lastTick) {
      seconds += ((ticks - lastTick) * lastTempo) / (ticksPerQuarterNote * 1000000);
    }

    return seconds;
  }

  /**
   * Convert MIDI note number to note name
   */
  private midiNoteToName(note: number): string {
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const octave = Math.floor(note / 12) - 1;
    const noteName = noteNames[note % 12];
    return `${noteName}${octave}`;
  }

  /**
   * Get status byte for a channel event
   */
  private getStatusByte(event: MidiEvent): number | undefined {
    if (event.channel === undefined) return undefined;

    switch (event.type) {
      case 'noteOff': return 0x80 | event.channel;
      case 'noteOn': return 0x90 | event.channel;
      case 'noteAftertouch': return 0xa0 | event.channel;
      case 'controlChange': return 0xb0 | event.channel;
      case 'programChange': return 0xc0 | event.channel;
      case 'channelAftertouch': return 0xd0 | event.channel;
      case 'pitchBend': return 0xe0 | event.channel;
      default: return undefined;
    }
  }

  /**
   * Read a single byte
   */
  private readByte(): number {
    if (this.position >= this.data.length) {
      throw new Error('Unexpected end of file while reading byte');
    }
    return this.data[this.position++];
  }

  /**
   * Read a 16-bit unsigned integer (big-endian)
   */
  private readUint16(): number {
    if (this.position + 2 > this.data.length) {
      throw new Error('Unexpected end of file while reading 16-bit integer');
    }
    const value = (this.data[this.position] << 8) | this.data[this.position + 1];
    this.position += 2;
    return value;
  }

  /**
   * Read a 32-bit unsigned integer (big-endian)
   */
  private readUint32(): number {
    if (this.position + 4 > this.data.length) {
      throw new Error('Unexpected end of file while reading 32-bit integer');
    }
    const value =
      (this.data[this.position] << 24) |
      (this.data[this.position + 1] << 16) |
      (this.data[this.position + 2] << 8) |
      this.data[this.position + 3];
    this.position += 4;
    return value >>> 0; // Convert to unsigned
  }

  /**
   * Read a string of specified length
   */
  private readString(length: number): string {
    if (this.position + length > this.data.length) {
      throw new Error(`Unexpected end of file while reading ${length}-byte string`);
    }
    let result = '';
    for (let i = 0; i < length; i++) {
      result += String.fromCharCode(this.data[this.position++]);
    }
    return result;
  }

  /**
   * Read a variable length quantity (VLQ)
   */
  private readVariableLengthQuantity(): number {
    let value = 0;
    let byte: number;
    do {
      if (this.position >= this.data.length) {
        throw new Error('Unexpected end of file while reading variable length quantity');
      }
      byte = this.data[this.position++];
      value = (value << 7) | (byte & 0x7f);
    } while (byte & 0x80);
    return value;
  }

  /**
   * Decode text from bytes
   */
  private decodeText(data: Uint8Array): string {
    try {
      return new TextDecoder('utf-8').decode(data);
    } catch {
      // Fallback to ASCII
      return Array.from(data)
        .map((b) => String.fromCharCode(b))
        .join('');
    }
  }
}

/**
 * Parse MIDI data from a Uint8Array or ArrayBuffer
 */
export function parseMidi(data: Uint8Array | ArrayBuffer, options?: MidiParseOptions): MidiParseResult {
  const parser = new MidiParser(data, options);
  return parser.parse();
}

/**
 * Parse MIDI data from a base64 string
 */
export function parseMidiFromBase64(base64: string, options?: MidiParseOptions): MidiParseResult {
  try {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return parseMidi(bytes, options);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Invalid base64 data: ${message}`,
    };
  }
}
