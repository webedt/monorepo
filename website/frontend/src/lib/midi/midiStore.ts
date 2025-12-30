/**
 * MIDI Store
 * State management for MIDI player with localStorage persistence
 */

import { MidiPlayer } from './midiPlayer';

import type { MidiFileInfo } from './types';
import type { MidiPlayerState } from './types';

/**
 * MIDI store settings that are persisted
 */
interface MidiStoreSettings {
  volume: number;
  speed: number;
  loop: boolean;
  mutedTracks: number[];
  mutedChannels: number[];
}

/**
 * MIDI store state
 */
interface MidiStoreState extends MidiPlayerState {
  settings: MidiStoreSettings;
  fileInfo: MidiFileInfo | null;
}

type MidiStoreListener = (state: MidiStoreState) => void;

const STORAGE_KEY = 'webedt_midi_settings';
const SAVE_DEBOUNCE_MS = 500;

const DEFAULT_SETTINGS: MidiStoreSettings = {
  volume: 0.5,
  speed: 1.0,
  loop: false,
  mutedTracks: [],
  mutedChannels: [],
};

/**
 * Debounce timer for settings saves
 */
let saveTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Load settings from localStorage
 */
function loadSettings(): MidiStoreSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Ignore parsing errors
  }
  return { ...DEFAULT_SETTINGS };
}

/**
 * Save settings to localStorage (debounced to prevent frequent writes)
 */
function saveSettings(settings: MidiStoreSettings): void {
  // Cancel any pending save
  if (saveTimeoutId !== null) {
    clearTimeout(saveTimeoutId);
  }

  // Debounce the save operation
  saveTimeoutId = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
    saveTimeoutId = null;
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Create the MIDI store singleton
 */
function createMidiStore() {
  const settings = loadSettings();
  const player = new MidiPlayer({
    volume: settings.volume,
    speed: settings.speed,
    loop: settings.loop,
    mutedTracks: new Set(settings.mutedTracks),
    mutedChannels: new Set(settings.mutedChannels),
  });

  let state: MidiStoreState = {
    ...player.getState(),
    settings,
    fileInfo: null,
  };

  const listeners = new Set<MidiStoreListener>();

  // Subscribe to player events
  player.subscribe((_event) => {
    const playerState = player.getState();
    const fileInfo = player.getFileInfo();

    state = {
      ...state,
      ...playerState,
      fileInfo,
    };

    notify();
  });

  function notify() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function updateSettings(partial: Partial<MidiStoreSettings>) {
    state.settings = { ...state.settings, ...partial };
    saveSettings(state.settings);
    notify();
  }

  return {
    /**
     * Get the MIDI player instance
     */
    getPlayer(): MidiPlayer {
      return player;
    },

    /**
     * Get current state
     */
    getState(): MidiStoreState {
      return state;
    },

    /**
     * Subscribe to state changes
     */
    subscribe(listener: MidiStoreListener): () => void {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },

    /**
     * Initialize audio context (call after user interaction)
     */
    init(): void {
      player.init();
    },

    /**
     * Load MIDI from file
     */
    async loadFile(file: File): Promise<boolean> {
      const success = await player.loadFromFile(file);
      if (success) {
        state = {
          ...state,
          ...player.getState(),
          fileInfo: player.getFileInfo(),
        };
        notify();
      }
      return success;
    },

    /**
     * Load MIDI from base64 string
     */
    loadFromBase64(base64: string, fileName: string): boolean {
      const success = player.loadFromBase64(base64, fileName);
      if (success) {
        state = {
          ...state,
          ...player.getState(),
          fileInfo: player.getFileInfo(),
        };
        notify();
      }
      return success;
    },

    /**
     * Load MIDI from Uint8Array
     */
    loadFromData(data: Uint8Array, fileName: string): boolean {
      const success = player.loadFromData(data, fileName);
      if (success) {
        state = {
          ...state,
          ...player.getState(),
          fileInfo: player.getFileInfo(),
        };
        notify();
      }
      return success;
    },

    /**
     * Unload current file
     */
    unload(): void {
      player.unload();
      state = {
        ...state,
        ...player.getState(),
        fileInfo: null,
      };
      notify();
    },

    /**
     * Play
     */
    play(): void {
      player.play();
    },

    /**
     * Pause
     */
    pause(): void {
      player.pause();
    },

    /**
     * Stop
     */
    stop(): void {
      player.stop();
    },

    /**
     * Toggle play/pause
     */
    togglePlay(): void {
      if (state.isPlaying && !state.isPaused) {
        player.pause();
      } else {
        player.play();
      }
    },

    /**
     * Seek to time
     */
    seek(time: number): void {
      player.seek(time);
    },

    /**
     * Set volume (0-1)
     */
    setVolume(volume: number): void {
      player.setVolume(volume);
      updateSettings({ volume });
    },

    /**
     * Set playback speed
     */
    setSpeed(speed: number): void {
      player.setSpeed(speed);
      updateSettings({ speed });
    },

    /**
     * Toggle loop
     */
    toggleLoop(): void {
      const loop = !state.settings.loop;
      player.setLoop(loop);
      updateSettings({ loop });
    },

    /**
     * Toggle track mute
     */
    toggleTrackMute(trackIndex: number): void {
      player.toggleTrackMute(trackIndex);
      const mutedTracks = state.settings.mutedTracks.includes(trackIndex)
        ? state.settings.mutedTracks.filter((i) => i !== trackIndex)
        : [...state.settings.mutedTracks, trackIndex];
      updateSettings({ mutedTracks });
      state = { ...state, fileInfo: player.getFileInfo() };
      notify();
    },

    /**
     * Toggle channel mute
     */
    toggleChannelMute(channel: number): void {
      player.toggleChannelMute(channel);
      const mutedChannels = state.settings.mutedChannels.includes(channel)
        ? state.settings.mutedChannels.filter((c) => c !== channel)
        : [...state.settings.mutedChannels, channel];
      updateSettings({ mutedChannels });
      state = { ...state, fileInfo: player.getFileInfo() };
      notify();
    },

    /**
     * Dispose
     */
    dispose(): void {
      player.dispose();
      listeners.clear();
    },
  };
}

/**
 * Singleton MIDI store instance
 */
export const midiStore = createMidiStore();

export type { MidiStoreState, MidiStoreSettings };
