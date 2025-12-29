/**
 * Audio Source Store
 * Manages audio source settings and provides a reactive interface for sound generation
 */

import { AudioSource, AUDIO_PRESETS } from '../lib/audio';
import type { WaveformType, EnvelopeConfig, AudioSourcePreset } from '../lib/audio';

export interface AudioSourceSettings {
  waveform: WaveformType;
  frequency: number;
  volume: number;
  detune: number;
  envelope: EnvelopeConfig;
  presetName: string;
}

type AudioSourceListener = (settings: AudioSourceSettings) => void;

const STORAGE_KEY = 'webedt_audio_source_settings';

const DEFAULT_SETTINGS: AudioSourceSettings = {
  waveform: 'sine',
  frequency: 440,
  volume: 0.5,
  detune: 0,
  envelope: {
    attack: 0.01,
    decay: 0.1,
    sustain: 0.7,
    release: 0.2,
  },
  presetName: 'Default',
};

class AudioSourceStore {
  private settings: AudioSourceSettings;
  private listeners: Set<AudioSourceListener> = new Set();
  private audioSource: AudioSource | null = null;
  private audioContext: AudioContext | null = null;

  constructor() {
    this.settings = this.loadFromStorage();
  }

  private loadFromStorage(): AudioSourceSettings {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        return { ...DEFAULT_SETTINGS, ...parsed };
      }
    } catch (error) {
      console.error('Failed to load audio source settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private saveToStorage(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save audio source settings:', error);
    }
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }

  /**
   * Initialize the audio source with a shared audio context
   */
  init(audioContext?: AudioContext): AudioSource {
    if (audioContext) {
      this.audioContext = audioContext;
    } else if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }

    this.audioSource = new AudioSource({
      waveform: this.settings.waveform,
      frequency: this.settings.frequency,
      volume: this.settings.volume,
      detune: this.settings.detune,
      envelope: this.settings.envelope,
    });

    this.audioSource.init(this.audioContext);
    return this.audioSource;
  }

  /**
   * Get the audio source instance
   */
  getAudioSource(): AudioSource | null {
    return this.audioSource;
  }

  /**
   * Get the audio context
   */
  getAudioContext(): AudioContext | null {
    return this.audioContext;
  }

  /**
   * Get current settings
   */
  getSettings(): AudioSourceSettings {
    return { ...this.settings };
  }

  /**
   * Get waveform type
   */
  getWaveform(): WaveformType {
    return this.settings.waveform;
  }

  /**
   * Set waveform type
   */
  setWaveform(waveform: WaveformType): void {
    this.settings.waveform = waveform;
    this.settings.presetName = 'Custom';
    if (this.audioSource) {
      this.audioSource.setWaveform(waveform);
    }
    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Get frequency
   */
  getFrequency(): number {
    return this.settings.frequency;
  }

  /**
   * Set frequency
   */
  setFrequency(frequency: number): void {
    if (frequency >= 20 && frequency <= 20000) {
      this.settings.frequency = frequency;
      if (this.audioSource) {
        this.audioSource.setFrequency(frequency);
      }
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  /**
   * Get volume
   */
  getVolume(): number {
    return this.settings.volume;
  }

  /**
   * Set volume (0-1)
   */
  setVolume(volume: number): void {
    const clampedVolume = Math.max(0, Math.min(1, volume));
    this.settings.volume = clampedVolume;
    if (this.audioSource) {
      this.audioSource.setVolume(clampedVolume);
    }
    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Get detune
   */
  getDetune(): number {
    return this.settings.detune;
  }

  /**
   * Set detune in cents
   */
  setDetune(detune: number): void {
    if (detune >= -1200 && detune <= 1200) {
      this.settings.detune = detune;
      if (this.audioSource) {
        this.audioSource.setDetune(detune);
      }
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  /**
   * Get envelope settings
   */
  getEnvelope(): EnvelopeConfig {
    return { ...this.settings.envelope };
  }

  /**
   * Set envelope settings
   */
  setEnvelope(envelope: Partial<EnvelopeConfig>): void {
    this.settings.envelope = { ...this.settings.envelope, ...envelope };
    this.settings.presetName = 'Custom';
    if (this.audioSource) {
      this.audioSource.setEnvelope(this.settings.envelope);
    }
    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Get current preset name
   */
  getPresetName(): string {
    return this.settings.presetName;
  }

  /**
   * Apply a preset
   */
  applyPreset(preset: AudioSourcePreset): void {
    this.settings.waveform = preset.waveform;
    this.settings.envelope = { ...preset.envelope };
    this.settings.detune = preset.detune ?? 0;
    this.settings.presetName = preset.name;

    if (this.audioSource) {
      this.audioSource.setWaveform(preset.waveform);
      this.audioSource.setEnvelope(preset.envelope);
      this.audioSource.setDetune(preset.detune ?? 0);
    }

    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Apply preset by name
   */
  applyPresetByName(name: string): void {
    const preset = AUDIO_PRESETS.find(p => p.name === name);
    if (preset) {
      this.applyPreset(preset);
    }
  }

  /**
   * Get available presets
   */
  getPresets(): AudioSourcePreset[] {
    return [...AUDIO_PRESETS];
  }

  /**
   * Play a sound with current settings
   */
  play(frequency?: number, duration?: number): void {
    if (!this.audioSource) {
      console.warn('Audio source not initialized. Call init() first.');
      return;
    }
    this.audioSource.play(frequency ?? this.settings.frequency, duration);
  }

  /**
   * Play a note by MIDI number
   */
  playNote(midiNote: number, duration?: number): void {
    if (!this.audioSource) {
      console.warn('Audio source not initialized. Call init() first.');
      return;
    }
    this.audioSource.playNote(midiNote, duration);
  }

  /**
   * Play a note by name
   */
  playNoteName(noteName: string, duration?: number): void {
    if (!this.audioSource) {
      console.warn('Audio source not initialized. Call init() first.');
      return;
    }
    this.audioSource.playNoteName(noteName, duration);
  }

  /**
   * Stop current sound with release
   */
  stop(): void {
    if (this.audioSource) {
      this.audioSource.stop();
    }
  }

  /**
   * Stop current sound immediately
   */
  stopImmediate(): void {
    if (this.audioSource) {
      this.audioSource.stopImmediate();
    }
  }

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return this.audioSource?.getState().isPlaying ?? false;
  }

  /**
   * Subscribe to settings changes
   */
  subscribe(listener: AudioSourceListener): () => void {
    this.listeners.add(listener);
    listener(this.settings);
    return () => this.listeners.delete(listener);
  }

  /**
   * Update multiple settings at once
   */
  updateSettings(updates: Partial<AudioSourceSettings>): void {
    this.settings = { ...this.settings, ...updates };

    if (this.audioSource) {
      if (updates.waveform !== undefined) this.audioSource.setWaveform(updates.waveform);
      if (updates.frequency !== undefined) this.audioSource.setFrequency(updates.frequency);
      if (updates.volume !== undefined) this.audioSource.setVolume(updates.volume);
      if (updates.detune !== undefined) this.audioSource.setDetune(updates.detune);
      if (updates.envelope !== undefined) this.audioSource.setEnvelope(updates.envelope);
    }

    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Reset to default settings
   */
  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };

    if (this.audioSource) {
      this.audioSource.setWaveform(DEFAULT_SETTINGS.waveform);
      this.audioSource.setFrequency(DEFAULT_SETTINGS.frequency);
      this.audioSource.setVolume(DEFAULT_SETTINGS.volume);
      this.audioSource.setDetune(DEFAULT_SETTINGS.detune);
      this.audioSource.setEnvelope(DEFAULT_SETTINGS.envelope);
    }

    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Dispose of resources
   */
  dispose(): void {
    if (this.audioSource) {
      this.audioSource.dispose();
      this.audioSource = null;
    }
    this.listeners.clear();
  }
}

export const audioSourceStore = new AudioSourceStore();
