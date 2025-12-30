/**
 * MIDI Player Types
 * Type definitions for the frontend MIDI player
 */

import type { MidiFile } from '@webedt/shared';
import type { MidiNoteEvent } from '@webedt/shared';
import type { MidiTrack } from '@webedt/shared';

/**
 * MIDI player state
 */
export interface MidiPlayerState {
  /** Whether playback is active */
  isPlaying: boolean;
  /** Whether playback is paused */
  isPaused: boolean;
  /** Current playback position in seconds */
  currentTime: number;
  /** Total duration in seconds */
  duration: number;
  /** Current tempo in BPM */
  currentTempo: number;
  /** Playback progress (0-1) */
  progress: number;
  /** Whether a file is loaded */
  isLoaded: boolean;
  /** Currently loaded file name */
  fileName: string | null;
}

/**
 * MIDI player events
 */
export type MidiPlayerEvent =
  | { type: 'load'; file: MidiFile; fileName: string }
  | { type: 'unload' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'stop' }
  | { type: 'seek'; time: number }
  | { type: 'timeUpdate'; time: number; progress: number }
  | { type: 'tempoChange'; bpm: number }
  | { type: 'noteOn'; note: MidiNoteEvent; track: number }
  | { type: 'noteOff'; note: MidiNoteEvent; track: number }
  | { type: 'end' }
  | { type: 'loop' };

/**
 * MIDI player listener
 */
export type MidiPlayerListener = (event: MidiPlayerEvent) => void;

/**
 * MIDI player options
 */
export interface MidiPlayerOptions {
  /** Playback speed multiplier (default: 1.0) */
  speed?: number;
  /** Whether to loop playback (default: false) */
  loop?: boolean;
  /** Volume level 0-1 (default: 0.5) */
  volume?: number;
  /** Channels to mute (0-15) */
  mutedChannels?: Set<number>;
  /** Tracks to mute */
  mutedTracks?: Set<number>;
}

/**
 * Track info for display
 */
export interface MidiTrackInfo {
  /** Track index */
  index: number;
  /** Track name */
  name: string;
  /** Number of notes */
  noteCount: number;
  /** Channels used */
  channels: number[];
  /** Whether track is muted */
  isMuted: boolean;
}

/**
 * Channel info for display
 */
export interface MidiChannelInfo {
  /** Channel number (0-15) */
  channel: number;
  /** Total notes on this channel */
  noteCount: number;
  /** Whether channel is muted */
  isMuted: boolean;
  /** Program number (instrument) */
  program: number;
}

/**
 * MIDI file info for display
 */
export interface MidiFileInfo {
  /** File name */
  fileName: string;
  /** MIDI format (0, 1, or 2) */
  format: number;
  /** Number of tracks */
  trackCount: number;
  /** Total duration in seconds */
  duration: number;
  /** Duration formatted as MM:SS */
  durationFormatted: string;
  /** Initial tempo in BPM */
  tempo: number;
  /** Total note count */
  noteCount: number;
  /** Track info */
  tracks: MidiTrackInfo[];
  /** Channel info */
  channels: MidiChannelInfo[];
}

/**
 * Re-export types from shared for convenience
 */
export type { MidiFile, MidiTrack, MidiNoteEvent };
