/**
 * Tests for AudioSourceStore
 * Covers audio source settings, waveform types, presets,
 * envelope configuration, and playback controls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock TypedStorage
const mockStorage: Record<string, unknown> = {};

vi.mock('../../src/lib/typedStorage', () => ({
  TypedStorage: vi.fn().mockImplementation(({ defaultValue }) => ({
    get: () => mockStorage['audio-source'] ?? defaultValue,
    set: (value: unknown) => { mockStorage['audio-source'] = value; },
  })),
}));

vi.mock('../../src/lib/storageKeys', () => ({
  STORE_KEYS: { AUDIO_SOURCE: 'audio-source' },
}));

// Mock AudioSource class
const mockAudioSourceInstance = {
  init: vi.fn(),
  setWaveform: vi.fn(),
  setFrequency: vi.fn(),
  setVolume: vi.fn(),
  setDetune: vi.fn(),
  setEnvelope: vi.fn(),
  play: vi.fn(),
  playNote: vi.fn(),
  playNoteName: vi.fn(),
  stop: vi.fn(),
  stopImmediate: vi.fn(),
  getState: vi.fn().mockReturnValue({ isPlaying: false }),
  dispose: vi.fn(),
};

vi.mock('../../src/lib/audio', () => ({
  AudioSource: vi.fn().mockImplementation(() => mockAudioSourceInstance),
  AUDIO_PRESETS: [
    {
      name: 'Piano',
      waveform: 'sine',
      envelope: { attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.5 },
      detune: 0,
    },
    {
      name: 'Organ',
      waveform: 'square',
      envelope: { attack: 0.05, decay: 0.1, sustain: 0.8, release: 0.3 },
      detune: 0,
    },
  ],
}));

// Mock AudioContext
const mockAudioContext = {
  state: 'running',
  currentTime: 0,
};

vi.stubGlobal('AudioContext', vi.fn(() => mockAudioContext));
vi.stubGlobal('window', {
  AudioContext: vi.fn(() => mockAudioContext),
  webkitAudioContext: vi.fn(() => mockAudioContext),
});

// Import after mocks
import { audioSourceStore } from '../../src/stores/audioSourceStore';

describe('AudioSourceStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockStorage['audio-source'];
    audioSourceStore.reset();
  });

  afterEach(() => {
    audioSourceStore.dispose();
  });

  describe('Initial State', () => {
    it('should have correct default settings', () => {
      const settings = audioSourceStore.getSettings();

      expect(settings.waveform).toBe('sine');
      expect(settings.frequency).toBe(440);
      expect(settings.volume).toBe(0.5);
      expect(settings.detune).toBe(0);
      expect(settings.presetName).toBe('Default');
    });

    it('should have default envelope settings', () => {
      const envelope = audioSourceStore.getEnvelope();

      expect(envelope.attack).toBe(0.01);
      expect(envelope.decay).toBe(0.1);
      expect(envelope.sustain).toBe(0.7);
      expect(envelope.release).toBe(0.2);
    });

    it('should return null for audio source before init', () => {
      expect(audioSourceStore.getAudioSource()).toBeNull();
    });

    it('should return null for audio context before init', () => {
      expect(audioSourceStore.getAudioContext()).toBeNull();
    });
  });

  describe('Initialization', () => {
    it('should initialize audio source', () => {
      const source = audioSourceStore.init();

      expect(source).toBeDefined();
      expect(audioSourceStore.getAudioSource()).not.toBeNull();
      expect(audioSourceStore.getAudioContext()).not.toBeNull();
    });

    it('should accept external audio context', () => {
      const externalContext = { state: 'running' } as AudioContext;

      audioSourceStore.init(externalContext);

      expect(audioSourceStore.getAudioContext()).toBe(externalContext);
    });
  });

  describe('Waveform', () => {
    it('should get waveform', () => {
      expect(audioSourceStore.getWaveform()).toBe('sine');
    });

    it('should set waveform', () => {
      audioSourceStore.setWaveform('square');

      expect(audioSourceStore.getWaveform()).toBe('square');
    });

    it('should set preset to Custom when changing waveform', () => {
      audioSourceStore.setWaveform('sawtooth');

      expect(audioSourceStore.getPresetName()).toBe('Custom');
    });

    it('should update audio source when initialized', () => {
      audioSourceStore.init();

      audioSourceStore.setWaveform('triangle');

      expect(mockAudioSourceInstance.setWaveform).toHaveBeenCalledWith('triangle');
    });
  });

  describe('Frequency', () => {
    it('should get frequency', () => {
      expect(audioSourceStore.getFrequency()).toBe(440);
    });

    it('should set frequency within valid range', () => {
      audioSourceStore.setFrequency(880);

      expect(audioSourceStore.getFrequency()).toBe(880);
    });

    it('should not set frequency below minimum (20)', () => {
      audioSourceStore.setFrequency(10);

      expect(audioSourceStore.getFrequency()).toBe(440); // Unchanged
    });

    it('should not set frequency above maximum (20000)', () => {
      audioSourceStore.setFrequency(25000);

      expect(audioSourceStore.getFrequency()).toBe(440); // Unchanged
    });

    it('should update audio source when initialized', () => {
      audioSourceStore.init();

      audioSourceStore.setFrequency(660);

      expect(mockAudioSourceInstance.setFrequency).toHaveBeenCalledWith(660);
    });
  });

  describe('Volume', () => {
    it('should get volume', () => {
      expect(audioSourceStore.getVolume()).toBe(0.5);
    });

    it('should set volume', () => {
      audioSourceStore.setVolume(0.8);

      expect(audioSourceStore.getVolume()).toBe(0.8);
    });

    it('should clamp volume to valid range', () => {
      audioSourceStore.setVolume(-0.5);
      expect(audioSourceStore.getVolume()).toBe(0);

      audioSourceStore.setVolume(1.5);
      expect(audioSourceStore.getVolume()).toBe(1);
    });

    it('should update audio source when initialized', () => {
      audioSourceStore.init();

      audioSourceStore.setVolume(0.7);

      expect(mockAudioSourceInstance.setVolume).toHaveBeenCalledWith(0.7);
    });
  });

  describe('Detune', () => {
    it('should get detune', () => {
      expect(audioSourceStore.getDetune()).toBe(0);
    });

    it('should set detune within valid range', () => {
      audioSourceStore.setDetune(100);

      expect(audioSourceStore.getDetune()).toBe(100);
    });

    it('should not set detune below minimum (-1200)', () => {
      audioSourceStore.setDetune(-1500);

      expect(audioSourceStore.getDetune()).toBe(0); // Unchanged
    });

    it('should not set detune above maximum (1200)', () => {
      audioSourceStore.setDetune(1500);

      expect(audioSourceStore.getDetune()).toBe(0); // Unchanged
    });
  });

  describe('Envelope', () => {
    it('should get envelope', () => {
      const envelope = audioSourceStore.getEnvelope();

      expect(envelope).toEqual({
        attack: 0.01,
        decay: 0.1,
        sustain: 0.7,
        release: 0.2,
      });
    });

    it('should set envelope', () => {
      audioSourceStore.setEnvelope({ attack: 0.05 });

      expect(audioSourceStore.getEnvelope().attack).toBe(0.05);
    });

    it('should merge envelope settings', () => {
      audioSourceStore.setEnvelope({ attack: 0.05 });
      audioSourceStore.setEnvelope({ decay: 0.2 });

      const envelope = audioSourceStore.getEnvelope();
      expect(envelope.attack).toBe(0.05);
      expect(envelope.decay).toBe(0.2);
    });

    it('should set preset to Custom when changing envelope', () => {
      audioSourceStore.setEnvelope({ attack: 0.1 });

      expect(audioSourceStore.getPresetName()).toBe('Custom');
    });
  });

  describe('Presets', () => {
    it('should get preset name', () => {
      expect(audioSourceStore.getPresetName()).toBe('Default');
    });

    it('should get available presets', () => {
      const presets = audioSourceStore.getPresets();

      expect(presets.length).toBe(2);
      expect(presets[0].name).toBe('Piano');
      expect(presets[1].name).toBe('Organ');
    });

    it('should apply preset', () => {
      const preset = audioSourceStore.getPresets()[0]; // Piano

      audioSourceStore.applyPreset(preset);

      expect(audioSourceStore.getWaveform()).toBe('sine');
      expect(audioSourceStore.getPresetName()).toBe('Piano');
    });

    it('should apply preset by name', () => {
      audioSourceStore.applyPresetByName('Organ');

      expect(audioSourceStore.getWaveform()).toBe('square');
      expect(audioSourceStore.getPresetName()).toBe('Organ');
    });

    it('should do nothing for non-existent preset name', () => {
      audioSourceStore.applyPresetByName('NonExistent');

      expect(audioSourceStore.getPresetName()).toBe('Default');
    });
  });

  describe('Playback', () => {
    beforeEach(() => {
      audioSourceStore.init();
    });

    describe('play', () => {
      it('should play with default frequency', () => {
        audioSourceStore.play();

        expect(mockAudioSourceInstance.play).toHaveBeenCalledWith(440, undefined);
      });

      it('should play with custom frequency and duration', () => {
        audioSourceStore.play(880, 1);

        expect(mockAudioSourceInstance.play).toHaveBeenCalledWith(880, 1);
      });

      it('should warn if not initialized', () => {
        audioSourceStore.dispose();
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        audioSourceStore.play();

        expect(warnSpy).toHaveBeenCalled();
        warnSpy.mockRestore();
      });
    });

    describe('playNote', () => {
      it('should play MIDI note', () => {
        audioSourceStore.playNote(60, 0.5);

        expect(mockAudioSourceInstance.playNote).toHaveBeenCalledWith(60, 0.5);
      });
    });

    describe('playNoteName', () => {
      it('should play note by name', () => {
        audioSourceStore.playNoteName('C4', 0.5);

        expect(mockAudioSourceInstance.playNoteName).toHaveBeenCalledWith('C4', 0.5);
      });
    });

    describe('stop', () => {
      it('should stop with release', () => {
        audioSourceStore.stop();

        expect(mockAudioSourceInstance.stop).toHaveBeenCalled();
      });
    });

    describe('stopImmediate', () => {
      it('should stop immediately', () => {
        audioSourceStore.stopImmediate();

        expect(mockAudioSourceInstance.stopImmediate).toHaveBeenCalled();
      });
    });

    describe('isPlaying', () => {
      it('should return false when not playing', () => {
        expect(audioSourceStore.isPlaying()).toBe(false);
      });

      it('should return true when playing', () => {
        mockAudioSourceInstance.getState.mockReturnValue({ isPlaying: true });

        expect(audioSourceStore.isPlaying()).toBe(true);
      });
    });
  });

  describe('Batch Updates', () => {
    it('should update multiple settings at once', () => {
      audioSourceStore.updateSettings({
        waveform: 'sawtooth',
        frequency: 660,
        volume: 0.8,
      });

      expect(audioSourceStore.getWaveform()).toBe('sawtooth');
      expect(audioSourceStore.getFrequency()).toBe(660);
      expect(audioSourceStore.getVolume()).toBe(0.8);
    });

    it('should update audio source when initialized', () => {
      audioSourceStore.init();

      audioSourceStore.updateSettings({
        waveform: 'square',
        frequency: 880,
      });

      expect(mockAudioSourceInstance.setWaveform).toHaveBeenCalledWith('square');
      expect(mockAudioSourceInstance.setFrequency).toHaveBeenCalledWith(880);
    });
  });

  describe('Reset', () => {
    it('should reset to default settings', () => {
      audioSourceStore.setWaveform('square');
      audioSourceStore.setFrequency(880);
      audioSourceStore.setVolume(0.9);

      audioSourceStore.reset();

      expect(audioSourceStore.getWaveform()).toBe('sine');
      expect(audioSourceStore.getFrequency()).toBe(440);
      expect(audioSourceStore.getVolume()).toBe(0.5);
    });

    it('should update audio source when initialized', () => {
      audioSourceStore.init();

      audioSourceStore.reset();

      expect(mockAudioSourceInstance.setWaveform).toHaveBeenCalledWith('sine');
      expect(mockAudioSourceInstance.setFrequency).toHaveBeenCalledWith(440);
    });
  });

  describe('Dispose', () => {
    it('should dispose audio source', () => {
      audioSourceStore.init();

      audioSourceStore.dispose();

      expect(mockAudioSourceInstance.dispose).toHaveBeenCalled();
      expect(audioSourceStore.getAudioSource()).toBeNull();
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers immediately', () => {
      const subscriber = vi.fn();

      audioSourceStore.subscribe(subscriber);

      expect(subscriber).toHaveBeenCalledTimes(1);
      expect(subscriber).toHaveBeenCalledWith(audioSourceStore.getSettings());
    });

    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      audioSourceStore.subscribe(subscriber);

      audioSourceStore.setWaveform('square');

      expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = audioSourceStore.subscribe(subscriber);

      unsubscribe();
      subscriber.mockClear();

      audioSourceStore.setWaveform('square');

      expect(subscriber).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle boundary frequency values', () => {
      audioSourceStore.setFrequency(20);
      expect(audioSourceStore.getFrequency()).toBe(20);

      audioSourceStore.setFrequency(20000);
      expect(audioSourceStore.getFrequency()).toBe(20000);
    });

    it('should handle boundary detune values', () => {
      audioSourceStore.setDetune(-1200);
      expect(audioSourceStore.getDetune()).toBe(-1200);

      audioSourceStore.setDetune(1200);
      expect(audioSourceStore.getDetune()).toBe(1200);
    });
  });
});
