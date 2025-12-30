/**
 * MIDI Types
 * Type definitions for MIDI file parsing and playback
 */

/**
 * MIDI file format types
 */
export type MidiFormat = 0 | 1 | 2;

/**
 * MIDI file header information
 */
export interface MidiHeader {
  /** MIDI format type (0, 1, or 2) */
  format: MidiFormat;
  /** Number of tracks in the file */
  numTracks: number;
  /** Time division (ticks per quarter note or SMPTE) */
  ticksPerQuarterNote: number;
}

/**
 * MIDI event types
 */
export type MidiEventType =
  | 'noteOn'
  | 'noteOff'
  | 'noteAftertouch'
  | 'controlChange'
  | 'programChange'
  | 'channelAftertouch'
  | 'pitchBend'
  | 'meta'
  | 'sysex';

/**
 * Base MIDI event
 */
export interface MidiEventBase {
  /** Event type */
  type: MidiEventType;
  /** Delta time in ticks from previous event */
  deltaTime: number;
  /** Absolute time in ticks from start */
  absoluteTime: number;
  /** MIDI channel (0-15) */
  channel?: number;
}

/**
 * Note On event
 */
export interface MidiNoteOnEvent extends MidiEventBase {
  type: 'noteOn';
  /** MIDI note number (0-127) */
  note: number;
  /** Velocity (0-127) */
  velocity: number;
  channel: number;
}

/**
 * Note Off event
 */
export interface MidiNoteOffEvent extends MidiEventBase {
  type: 'noteOff';
  /** MIDI note number (0-127) */
  note: number;
  /** Velocity (0-127) */
  velocity: number;
  channel: number;
}

/**
 * Note Aftertouch event
 */
export interface MidiNoteAftertouchEvent extends MidiEventBase {
  type: 'noteAftertouch';
  /** MIDI note number (0-127) */
  note: number;
  /** Pressure value (0-127) */
  pressure: number;
  channel: number;
}

/**
 * Control Change event
 */
export interface MidiControlChangeEvent extends MidiEventBase {
  type: 'controlChange';
  /** Controller number (0-127) */
  controller: number;
  /** Controller value (0-127) */
  value: number;
  channel: number;
}

/**
 * Program Change event
 */
export interface MidiProgramChangeEvent extends MidiEventBase {
  type: 'programChange';
  /** Program number (0-127) */
  program: number;
  channel: number;
}

/**
 * Channel Aftertouch event
 */
export interface MidiChannelAftertouchEvent extends MidiEventBase {
  type: 'channelAftertouch';
  /** Pressure value (0-127) */
  pressure: number;
  channel: number;
}

/**
 * Pitch Bend event
 */
export interface MidiPitchBendEvent extends MidiEventBase {
  type: 'pitchBend';
  /** Pitch bend value (-8192 to 8191) */
  value: number;
  channel: number;
}

/**
 * Meta event types
 */
export type MidiMetaEventSubtype =
  | 'sequenceNumber'
  | 'text'
  | 'copyright'
  | 'trackName'
  | 'instrumentName'
  | 'lyrics'
  | 'marker'
  | 'cuePoint'
  | 'channelPrefix'
  | 'endOfTrack'
  | 'setTempo'
  | 'smpteOffset'
  | 'timeSignature'
  | 'keySignature'
  | 'sequencerSpecific'
  | 'unknown';

/**
 * Meta event
 */
export interface MidiMetaEvent extends MidiEventBase {
  type: 'meta';
  /** Meta event subtype */
  subtype: MidiMetaEventSubtype;
  /** Raw data bytes */
  data?: Uint8Array;
  /** Tempo in microseconds per quarter note */
  tempo?: number;
  /** Text content for text-based meta events */
  text?: string;
  /** Time signature numerator */
  numerator?: number;
  /** Time signature denominator (as power of 2) */
  denominator?: number;
  /** MIDI clocks per metronome click */
  metronome?: number;
  /** 32nd notes per quarter note */
  thirtyseconds?: number;
  /** Key signature (-7 to 7, negative = flats, positive = sharps) */
  key?: number;
  /** Scale (0 = major, 1 = minor) */
  scale?: number;
}

/**
 * System Exclusive event
 */
export interface MidiSysexEvent extends MidiEventBase {
  type: 'sysex';
  /** Raw sysex data */
  data: Uint8Array;
}

/**
 * Union type for all MIDI events
 */
export type MidiEvent =
  | MidiNoteOnEvent
  | MidiNoteOffEvent
  | MidiNoteAftertouchEvent
  | MidiControlChangeEvent
  | MidiProgramChangeEvent
  | MidiChannelAftertouchEvent
  | MidiPitchBendEvent
  | MidiMetaEvent
  | MidiSysexEvent;

/**
 * MIDI track
 */
export interface MidiTrack {
  /** Track index */
  index: number;
  /** Track name (from meta event) */
  name?: string;
  /** All events in the track */
  events: MidiEvent[];
  /** Note events only (filtered) */
  notes: MidiNoteEvent[];
}

/**
 * Combined note event with duration
 */
export interface MidiNoteEvent {
  /** MIDI note number (0-127) */
  note: number;
  /** Note name (e.g., 'C4', 'A#3') */
  noteName: string;
  /** Velocity (0-127) */
  velocity: number;
  /** MIDI channel (0-15) */
  channel: number;
  /** Start time in ticks */
  startTime: number;
  /** Duration in ticks */
  duration: number;
  /** Start time in seconds */
  startTimeSeconds: number;
  /** Duration in seconds */
  durationSeconds: number;
}

/**
 * Tempo change event
 */
export interface MidiTempoChange {
  /** Absolute time in ticks */
  time: number;
  /** Tempo in BPM */
  bpm: number;
  /** Microseconds per quarter note */
  microsecondsPerQuarterNote: number;
}

/**
 * Time signature
 */
export interface MidiTimeSignature {
  /** Absolute time in ticks */
  time: number;
  /** Numerator (e.g., 4 for 4/4) */
  numerator: number;
  /** Denominator (e.g., 4 for 4/4) */
  denominator: number;
}

/**
 * Parsed MIDI file
 */
export interface MidiFile {
  /** File header information */
  header: MidiHeader;
  /** All tracks */
  tracks: MidiTrack[];
  /** Tempo changes throughout the file */
  tempoChanges: MidiTempoChange[];
  /** Time signature changes */
  timeSignatures: MidiTimeSignature[];
  /** Total duration in ticks */
  durationTicks: number;
  /** Total duration in seconds */
  durationSeconds: number;
  /** Initial tempo in BPM */
  initialTempo: number;
}

/**
 * MIDI parsing options
 */
export interface MidiParseOptions {
  /** Include meta events in output */
  includeMeta?: boolean;
  /** Include sysex events in output */
  includeSysex?: boolean;
}

/**
 * MIDI parsing result
 */
export interface MidiParseResult {
  /** Whether parsing succeeded */
  success: boolean;
  /** Parsed MIDI file (if successful) */
  file?: MidiFile;
  /** Error message (if failed) */
  error?: string;
}

/**
 * MIDI playback state
 */
export interface MidiPlaybackState {
  /** Whether playback is active */
  isPlaying: boolean;
  /** Whether playback is paused */
  isPaused: boolean;
  /** Current position in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** Current tempo in BPM */
  currentTempo: number;
  /** Current position as 0-1 progress */
  progress: number;
}

/**
 * MIDI playback options
 */
export interface MidiPlaybackOptions {
  /** Start time in seconds */
  startTime?: number;
  /** Playback speed multiplier (1.0 = normal) */
  speed?: number;
  /** Whether to loop playback */
  loop?: boolean;
  /** Channels to mute (0-15) */
  mutedChannels?: number[];
  /** Channels to solo (0-15) */
  soloChannels?: number[];
}
