/**
 * Audio Source Library
 * Provides audio generation and playback using Web Audio API
 */

import type { AudioSourceConfig, AudioSourceState, WaveformType, EnvelopeConfig, AudioSourceEvent } from './types';

export type { AudioSourceConfig, AudioSourceState, WaveformType, EnvelopeConfig, AudioSourceEvent };

const DEFAULT_ENVELOPE: EnvelopeConfig = {
  attack: 0.01,
  decay: 0.1,
  sustain: 0.7,
  release: 0.2,
};

/**
 * AudioSource - Generates and plays audio using Web Audio API
 * Supports oscillators with various waveforms and ADSR envelope
 */
export class AudioSource {
  private audioContext: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gainNode: GainNode | null = null;
  private masterGain: GainNode | null = null;
  private config: AudioSourceConfig;
  private state: AudioSourceState;
  private listeners: Set<(event: AudioSourceEvent) => void> = new Set();
  private releaseTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<AudioSourceConfig> = {}) {
    this.config = {
      waveform: config.waveform ?? 'sine',
      frequency: config.frequency ?? 440,
      volume: config.volume ?? 0.5,
      detune: config.detune ?? 0,
      envelope: { ...DEFAULT_ENVELOPE, ...config.envelope },
    };

    this.state = {
      isPlaying: false,
      currentFrequency: this.config.frequency,
      currentVolume: this.config.volume,
    };
  }

  /**
   * Initialize the audio context (must be called after user interaction)
   */
  init(context?: AudioContext): void {
    if (context) {
      this.audioContext = context;
    } else if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }

    // Create master gain
    this.masterGain = this.audioContext.createGain();
    this.masterGain.connect(this.audioContext.destination);
    this.masterGain.gain.value = this.config.volume;

    this.emit({ type: 'init' });
  }

  /**
   * Get the audio context
   */
  getContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Get the master gain node for external connections
   */
  getMasterGain(): GainNode | null {
    return this.masterGain;
  }

  /**
   * Play a sound with the current configuration
   */
  play(frequency?: number, duration?: number): void {
    if (!this.audioContext || !this.masterGain) {
      console.warn('AudioSource not initialized. Call init() first.');
      return;
    }

    // Resume context if suspended
    if (this.audioContext.state === 'suspended') {
      this.audioContext.resume();
    }

    // Stop any current sound
    this.stopImmediate();

    const freq = frequency ?? this.config.frequency;
    const now = this.audioContext.currentTime;
    const { attack, decay, sustain, release } = this.config.envelope;

    // Create oscillator
    this.oscillator = this.audioContext.createOscillator();
    this.oscillator.type = this.config.waveform;
    this.oscillator.frequency.value = freq;
    this.oscillator.detune.value = this.config.detune;

    // Create envelope gain
    this.gainNode = this.audioContext.createGain();
    this.gainNode.gain.value = 0;

    // Connect nodes
    this.oscillator.connect(this.gainNode);
    this.gainNode.connect(this.masterGain);

    // Apply ADSR envelope
    this.gainNode.gain.setValueAtTime(0, now);
    this.gainNode.gain.linearRampToValueAtTime(1, now + attack);
    this.gainNode.gain.linearRampToValueAtTime(sustain, now + attack + decay);

    // Start oscillator
    this.oscillator.start(now);

    // Update state
    this.state.isPlaying = true;
    this.state.currentFrequency = freq;

    this.emit({ type: 'play', frequency: freq });

    // If duration specified, stop after duration
    if (duration !== undefined && duration > 0) {
      const stopTime = attack + decay + duration;
      this.scheduleRelease(now, stopTime, release);
    }
  }

  /**
   * Play a note by MIDI note number
   */
  playNote(midiNote: number, duration?: number): void {
    const frequency = this.midiToFrequency(midiNote);
    this.play(frequency, duration);
  }

  /**
   * Play a note by name (e.g., 'C4', 'A#3', 'Db5')
   */
  playNoteName(noteName: string, duration?: number): void {
    const midiNote = this.noteNameToMidi(noteName);
    if (midiNote !== null) {
      this.playNote(midiNote, duration);
    }
  }

  /**
   * Stop the current sound with release envelope
   */
  stop(): void {
    if (!this.audioContext || !this.gainNode || !this.oscillator || !this.state.isPlaying) {
      return;
    }

    const now = this.audioContext.currentTime;
    const { release } = this.config.envelope;

    // Apply release envelope
    this.gainNode.gain.cancelScheduledValues(now);
    this.gainNode.gain.setValueAtTime(this.gainNode.gain.value, now);
    this.gainNode.gain.linearRampToValueAtTime(0, now + release);

    // Schedule stop
    this.oscillator.stop(now + release);

    // Clear previous timeout
    if (this.releaseTimeout) {
      clearTimeout(this.releaseTimeout);
    }

    // Cleanup after release
    this.releaseTimeout = setTimeout(() => {
      this.cleanup();
    }, release * 1000 + 50);
  }

  /**
   * Stop immediately without release envelope
   */
  stopImmediate(): void {
    if (this.releaseTimeout) {
      clearTimeout(this.releaseTimeout);
      this.releaseTimeout = null;
    }

    if (this.oscillator) {
      try {
        this.oscillator.stop();
      } catch {
        // Oscillator may already be stopped
      }
    }

    this.cleanup();
  }

  /**
   * Set the waveform type
   */
  setWaveform(waveform: WaveformType): void {
    this.config.waveform = waveform;
    if (this.oscillator) {
      this.oscillator.type = waveform;
    }
    this.emit({ type: 'waveformChange', waveform });
  }

  /**
   * Set the frequency
   */
  setFrequency(frequency: number): void {
    this.config.frequency = frequency;
    if (this.oscillator && this.audioContext) {
      this.oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime);
    }
    this.state.currentFrequency = frequency;
    this.emit({ type: 'frequencyChange', frequency });
  }

  /**
   * Set the volume (0-1)
   */
  setVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.config.volume = clampedVolume;
    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(clampedVolume, this.audioContext.currentTime);
    }
    this.state.currentVolume = clampedVolume;
    this.emit({ type: 'volumeChange', volume: clampedVolume });
  }

  /**
   * Set the detune in cents
   */
  setDetune(detune: number): void {
    this.config.detune = detune;
    if (this.oscillator && this.audioContext) {
      this.oscillator.detune.setValueAtTime(detune, this.audioContext.currentTime);
    }
  }

  /**
   * Set the envelope configuration
   */
  setEnvelope(envelope: Partial<EnvelopeConfig>): void {
    this.config.envelope = { ...this.config.envelope, ...envelope };
  }

  /**
   * Get the current configuration
   */
  getConfig(): AudioSourceConfig {
    return { ...this.config };
  }

  /**
   * Get the current state
   */
  getState(): AudioSourceState {
    return { ...this.state };
  }

  /**
   * Subscribe to audio source events
   */
  subscribe(listener: (event: AudioSourceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Dispose of all resources
   */
  dispose(): void {
    this.stopImmediate();
    if (this.masterGain) {
      this.masterGain.disconnect();
      this.masterGain = null;
    }
    this.audioContext = null;
    this.listeners.clear();
    this.emit({ type: 'dispose' });
  }

  /**
   * Convert MIDI note number to frequency
   */
  private midiToFrequency(midiNote: number): number {
    return 440 * Math.pow(2, (midiNote - 69) / 12);
  }

  /**
   * Convert note name to MIDI note number
   */
  private noteNameToMidi(noteName: string): number | null {
    const match = noteName.match(/^([A-Ga-g])([#b]?)(\d+)$/);
    if (!match) return null;

    const [, note, accidental, octaveStr] = match;
    const octave = parseInt(octaveStr, 10);

    const noteMap: Record<string, number> = {
      'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11,
      'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11,
    };

    let midiNote = noteMap[note];
    if (midiNote === undefined) return null;

    if (accidental === '#') midiNote += 1;
    else if (accidental === 'b') midiNote -= 1;

    return midiNote + (octave + 1) * 12;
  }

  private scheduleRelease(now: number, delay: number, release: number): void {
    if (!this.oscillator || !this.gainNode) return;

    // Schedule release envelope
    this.gainNode.gain.setValueAtTime(this.config.envelope.sustain, now + delay);
    this.gainNode.gain.linearRampToValueAtTime(0, now + delay + release);
    this.oscillator.stop(now + delay + release);

    // Cleanup after total duration
    if (this.releaseTimeout) {
      clearTimeout(this.releaseTimeout);
    }
    this.releaseTimeout = setTimeout(() => {
      this.cleanup();
    }, (delay + release) * 1000 + 50);
  }

  private cleanup(): void {
    if (this.oscillator) {
      this.oscillator.disconnect();
      this.oscillator = null;
    }
    if (this.gainNode) {
      this.gainNode.disconnect();
      this.gainNode = null;
    }
    this.state.isPlaying = false;
    this.emit({ type: 'stop' });
  }

  private emit(event: AudioSourceEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
