/**
 * MIDI Module
 * Provides MIDI file parsing and utilities
 */

export { MidiParser, parseMidi, parseMidiFromBase64 } from './parser.js';

export type { MidiChannelAftertouchEvent } from './types.js';
export type { MidiControlChangeEvent } from './types.js';
export type { MidiEvent } from './types.js';
export type { MidiEventBase } from './types.js';
export type { MidiEventType } from './types.js';
export type { MidiFile } from './types.js';
export type { MidiFormat } from './types.js';
export type { MidiHeader } from './types.js';
export type { MidiMetaEvent } from './types.js';
export type { MidiMetaEventSubtype } from './types.js';
export type { MidiNoteAftertouchEvent } from './types.js';
export type { MidiParsedNote } from './types.js';
export type { MidiNoteOffEvent } from './types.js';
export type { MidiNoteOnEvent } from './types.js';
export type { MidiParseOptions } from './types.js';
export type { MidiParseResult } from './types.js';
export type { MidiPitchBendEvent } from './types.js';
export type { MidiPlaybackOptions } from './types.js';
export type { MidiPlaybackState } from './types.js';
export type { MidiProgramChangeEvent } from './types.js';
export type { MidiSysexEvent } from './types.js';
export type { MidiTempoChange } from './types.js';
export type { MidiTimeSignature } from './types.js';
export type { MidiTrack } from './types.js';
