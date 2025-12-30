/**
 * MIDI Player
 * Plays MIDI files using Web Audio API with the AudioSource synthesizer
 */

import { parseMidi, parseMidiFromBase64 } from '@webedt/shared';

import type { MidiFile } from '@webedt/shared';
import type { MidiFileInfo } from './types';
import type { MidiNoteEvent } from '@webedt/shared';
import type { MidiPlayerEvent } from './types';
import type { MidiPlayerListener } from './types';
import type { MidiPlayerOptions } from './types';
import type { MidiPlayerState } from './types';
import type { MidiTempoChange } from '@webedt/shared';
import type { MidiTrack } from '@webedt/shared';
import type { MidiTrackInfo } from './types';

/**
 * Active oscillator for cleanup
 */
interface ActiveOscillator {
  oscillator: OscillatorNode;
  gainNode: GainNode;
  endTime: number;
}

/**
 * MIDI Player class for playing parsed MIDI files
 */
export class MidiPlayer {
  private audioContext: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private midiFile: MidiFile | null = null;
  private fileName: string | null = null;
  private state: MidiPlayerState;
  private options: Required<MidiPlayerOptions>;
  private listeners: Set<MidiPlayerListener> = new Set();
  private activeOscillators: ActiveOscillator[] = [];
  private playbackStartTime: number = 0;
  private pauseTime: number = 0;
  private animationFrameId: number | null = null;

  constructor(options: MidiPlayerOptions = {}) {
    this.options = {
      speed: options.speed ?? 1.0,
      loop: options.loop ?? false,
      volume: options.volume ?? 0.5,
      mutedChannels: options.mutedChannels ?? new Set(),
      mutedTracks: options.mutedTracks ?? new Set(),
    };

    this.state = {
      isPlaying: false,
      isPaused: false,
      currentTime: 0,
      duration: 0,
      currentTempo: 120,
      progress: 0,
      isLoaded: false,
      fileName: null,
    };
  }

  /**
   * Initialize the audio context (must be called after user interaction)
   */
  init(): void {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      this.masterGain = this.audioContext.createGain();
      this.masterGain.connect(this.audioContext.destination);
      this.masterGain.gain.value = this.options.volume;
    }
  }

  /**
   * Load a MIDI file from Uint8Array
   */
  loadFromData(data: Uint8Array, fileName: string = 'untitled.mid'): boolean {
    const result = parseMidi(data);
    if (!result.success || !result.file) {
      console.error('Failed to parse MIDI:', result.error);
      return false;
    }

    this.midiFile = result.file;
    this.fileName = fileName;
    this.calculateNoteTimes();
    this.updateState({
      isLoaded: true,
      duration: result.file.durationSeconds,
      currentTempo: result.file.initialTempo,
      fileName,
    });

    this.emit({ type: 'load', file: result.file, fileName });
    return true;
  }

  /**
   * Load a MIDI file from base64 string
   */
  loadFromBase64(base64: string, fileName: string = 'untitled.mid'): boolean {
    const result = parseMidiFromBase64(base64);
    if (!result.success || !result.file) {
      console.error('Failed to parse MIDI:', result.error);
      return false;
    }

    this.midiFile = result.file;
    this.fileName = fileName;
    this.calculateNoteTimes();
    this.updateState({
      isLoaded: true,
      duration: result.file.durationSeconds,
      currentTempo: result.file.initialTempo,
      fileName,
    });

    this.emit({ type: 'load', file: result.file, fileName });
    return true;
  }

  /**
   * Load a MIDI file from File object
   */
  async loadFromFile(file: File): Promise<boolean> {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          const success = this.loadFromData(new Uint8Array(reader.result), file.name);
          resolve(success);
        } else {
          resolve(false);
        }
      };
      reader.onerror = () => resolve(false);
      reader.readAsArrayBuffer(file);
    });
  }

  /**
   * Unload the current MIDI file
   */
  unload(): void {
    this.stop();
    this.midiFile = null;
    this.fileName = null;
    this.updateState({
      isLoaded: false,
      duration: 0,
      currentTime: 0,
      progress: 0,
      fileName: null,
    });
    this.emit({ type: 'unload' });
  }

  /**
   * Start or resume playback
   */
  play(): void {
    if (!this.midiFile || !this.audioContext || !this.masterGain) {
      this.init();
      if (!this.audioContext || !this.masterGain) {
        console.warn('Audio context not available');
        return;
      }
    }

    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    } else if (this.audioContext.state === 'closed') {
      // Audio context was closed, need to reinitialize
      this.audioContext = null;
      this.masterGain = null;
      this.init();
      if (!this.audioContext || !this.masterGain) {
        console.warn('Failed to reinitialize audio context');
        return;
      }
    }

    if (this.state.isPlaying && !this.state.isPaused) return;

    const startOffset = this.state.isPaused ? this.pauseTime : this.state.currentTime;
    this.playbackStartTime = this.audioContext.currentTime - startOffset / this.options.speed;

    this.scheduleNotes(startOffset);
    this.updateState({ isPlaying: true, isPaused: false });
    this.startTimeUpdate();
    this.emit({ type: 'play' });
  }

  /**
   * Pause playback
   */
  pause(): void {
    if (!this.state.isPlaying || this.state.isPaused) return;

    this.pauseTime = this.state.currentTime;
    this.stopAllNotes();
    this.stopTimeUpdate();
    this.updateState({ isPaused: true });
    this.emit({ type: 'pause' });
  }

  /**
   * Stop playback
   */
  stop(): void {
    this.stopAllNotes();
    this.stopTimeUpdate();
    this.pauseTime = 0;
    this.updateState({
      isPlaying: false,
      isPaused: false,
      currentTime: 0,
      progress: 0,
    });
    this.emit({ type: 'stop' });
  }

  /**
   * Seek to a specific time
   */
  seek(time: number): void {
    const clampedTime = Math.max(0, Math.min(time, this.state.duration));

    if (this.state.isPlaying && !this.state.isPaused) {
      this.stopAllNotes();
      this.playbackStartTime = this.audioContext!.currentTime - clampedTime / this.options.speed;
      this.scheduleNotes(clampedTime);
    } else {
      this.pauseTime = clampedTime;
    }

    this.updateState({
      currentTime: clampedTime,
      progress: this.state.duration > 0 ? clampedTime / this.state.duration : 0,
    });
    this.emit({ type: 'seek', time: clampedTime });
  }

  /**
   * Set playback volume (0-1)
   */
  setVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.options.volume = clampedVolume;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(clampedVolume, this.audioContext.currentTime);
    }
  }

  /**
   * Set playback speed
   */
  setSpeed(speed: number): void {
    const clampedSpeed = Math.max(0.25, Math.min(4, speed));
    if (this.state.isPlaying && !this.state.isPaused) {
      const currentTime = this.state.currentTime;
      this.options.speed = clampedSpeed;
      this.stopAllNotes();
      this.playbackStartTime = this.audioContext!.currentTime - currentTime / this.options.speed;
      this.scheduleNotes(currentTime);
    } else {
      this.options.speed = clampedSpeed;
    }
  }

  /**
   * Set loop mode
   */
  setLoop(loop: boolean): void {
    this.options.loop = loop;
  }

  /**
   * Toggle track mute
   */
  toggleTrackMute(trackIndex: number): void {
    if (this.options.mutedTracks.has(trackIndex)) {
      this.options.mutedTracks.delete(trackIndex);
    } else {
      this.options.mutedTracks.add(trackIndex);
    }
  }

  /**
   * Toggle channel mute
   */
  toggleChannelMute(channel: number): void {
    if (this.options.mutedChannels.has(channel)) {
      this.options.mutedChannels.delete(channel);
    } else {
      this.options.mutedChannels.add(channel);
    }
  }

  /**
   * Get current state
   */
  getState(): MidiPlayerState {
    return { ...this.state };
  }

  /**
   * Get the parsed MIDI file (for visualization components)
   */
  getMidiFile(): MidiFile | null {
    return this.midiFile;
  }

  /**
   * Get loaded file info
   */
  getFileInfo(): MidiFileInfo | null {
    if (!this.midiFile || !this.fileName) return null;

    const tracks: MidiTrackInfo[] = this.midiFile.tracks.map((track: MidiTrack, index: number) => {
      const channels = new Set<number>();
      for (const note of track.notes) {
        channels.add(note.channel);
      }
      return {
        index,
        name: track.name || `Track ${index + 1}`,
        noteCount: track.notes.length,
        channels: Array.from(channels).sort((a, b) => a - b),
        isMuted: this.options.mutedTracks.has(index),
      };
    });

    const channelNotes = new Map<number, number>();
    for (const track of this.midiFile.tracks) {
      for (const note of track.notes) {
        channelNotes.set(note.channel, (channelNotes.get(note.channel) || 0) + 1);
      }
    }

    const channels = Array.from(channelNotes.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([channel, noteCount]) => ({
        channel,
        noteCount,
        isMuted: this.options.mutedChannels.has(channel),
        program: 0, // Would need to track program changes
      }));

    const totalNotes = tracks.reduce((sum, t) => sum + t.noteCount, 0);
    const minutes = Math.floor(this.midiFile.durationSeconds / 60);
    const seconds = Math.floor(this.midiFile.durationSeconds % 60);

    return {
      fileName: this.fileName,
      format: this.midiFile.header.format,
      trackCount: this.midiFile.tracks.length,
      duration: this.midiFile.durationSeconds,
      durationFormatted: `${minutes}:${seconds.toString().padStart(2, '0')}`,
      tempo: this.midiFile.initialTempo,
      noteCount: totalNotes,
      tracks,
      channels,
    };
  }

  /**
   * Subscribe to player events
   */
  subscribe(listener: MidiPlayerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.stop();
    this.unload();
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    this.audioContext = null;
    this.listeners.clear();
  }

  /**
   * Calculate note times in seconds based on tempo changes
   */
  private calculateNoteTimes(): void {
    if (!this.midiFile) return;

    const { tempoChanges, header } = this.midiFile;
    const ticksPerQuarterNote = header.ticksPerQuarterNote;

    for (const track of this.midiFile.tracks) {
      for (const note of track.notes) {
        note.startTimeSeconds = this.ticksToSeconds(
          note.startTime,
          tempoChanges,
          ticksPerQuarterNote
        );
        note.durationSeconds = this.ticksToSeconds(
          note.startTime + note.duration,
          tempoChanges,
          ticksPerQuarterNote
        ) - note.startTimeSeconds;
      }
    }
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

    if (ticks > lastTick) {
      seconds += ((ticks - lastTick) * lastTempo) / (ticksPerQuarterNote * 1000000);
    }

    return seconds;
  }

  /**
   * Schedule notes for playback from a given start time
   */
  private scheduleNotes(startTime: number): void {
    if (!this.midiFile || !this.audioContext || !this.masterGain) return;

    const now = this.audioContext.currentTime;

    for (let trackIndex = 0; trackIndex < this.midiFile.tracks.length; trackIndex++) {
      if (this.options.mutedTracks.has(trackIndex)) continue;

      const track = this.midiFile.tracks[trackIndex];
      for (const note of track.notes) {
        if (this.options.mutedChannels.has(note.channel)) continue;
        if (note.startTimeSeconds < startTime) continue;

        const noteStartTime = (note.startTimeSeconds - startTime) / this.options.speed;
        const noteDuration = note.durationSeconds / this.options.speed;

        // Schedule all notes - Web Audio API handles far-future scheduling
        this.scheduleNote(note, trackIndex, now + noteStartTime, noteDuration);
      }
    }
  }

  /**
   * Schedule a single note
   */
  private scheduleNote(
    note: MidiNoteEvent,
    _trackIndex: number,
    startTime: number,
    duration: number
  ): void {
    if (!this.audioContext || !this.masterGain) return;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.type = 'triangle';
    oscillator.frequency.value = this.midiToFrequency(note.note);

    const velocity = note.velocity / 127;
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(velocity * 0.3, startTime + 0.02);
    gainNode.gain.linearRampToValueAtTime(velocity * 0.2, startTime + duration * 0.8);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration);

    oscillator.connect(gainNode);
    gainNode.connect(this.masterGain);

    oscillator.start(startTime);
    oscillator.stop(startTime + duration + 0.01);

    // Track active oscillator for cleanup
    const endTime = startTime + duration + 0.01;
    this.activeOscillators.push({ oscillator, gainNode, endTime });

    // Auto-cleanup when oscillator ends
    oscillator.onended = () => {
      const index = this.activeOscillators.findIndex((o) => o.oscillator === oscillator);
      if (index !== -1) {
        this.activeOscillators.splice(index, 1);
      }
    };
  }

  /**
   * Stop all currently playing notes
   */
  private stopAllNotes(): void {
    if (!this.audioContext) return;

    const now = this.audioContext.currentTime;

    // Stop all active oscillators
    for (const active of this.activeOscillators) {
      try {
        active.gainNode.gain.cancelScheduledValues(now);
        active.gainNode.gain.setValueAtTime(0, now);
        active.oscillator.stop(now + 0.01);
      } catch {
        // Oscillator may already be stopped
      }
    }
    this.activeOscillators = [];
  }

  /**
   * Convert MIDI note number to frequency
   */
  private midiToFrequency(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  /**
   * Start the time update animation loop
   */
  private startTimeUpdate(): void {
    const update = () => {
      if (!this.state.isPlaying || this.state.isPaused || !this.audioContext) {
        return;
      }

      const elapsed = (this.audioContext.currentTime - this.playbackStartTime) * this.options.speed;
      const currentTime = Math.min(elapsed, this.state.duration);
      const progress = this.state.duration > 0 ? currentTime / this.state.duration : 0;

      this.updateState({ currentTime, progress });
      this.emit({ type: 'timeUpdate', time: currentTime, progress });

      // Check for end of playback
      if (currentTime >= this.state.duration) {
        if (this.options.loop) {
          // Seamless loop: reset playback without stopping
          this.stopAllNotes();
          this.playbackStartTime = this.audioContext!.currentTime;
          this.scheduleNotes(0);
          this.updateState({ currentTime: 0, progress: 0 });
          this.emit({ type: 'loop' });
        } else {
          this.stop();
          this.emit({ type: 'end' });
        }
        return;
      }

      this.animationFrameId = requestAnimationFrame(update);
    };

    this.animationFrameId = requestAnimationFrame(update);
  }

  /**
   * Stop the time update animation loop
   */
  private stopTimeUpdate(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Update state
   */
  private updateState(partial: Partial<MidiPlayerState>): void {
    this.state = { ...this.state, ...partial };
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: MidiPlayerEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
