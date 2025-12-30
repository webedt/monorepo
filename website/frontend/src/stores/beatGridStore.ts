/**
 * Beat Grid Store
 * Manages BPM, beat positions, and snap-to-grid settings for audio editing
 */

import { z } from 'zod';

import { STORE_KEYS } from '../lib/storageKeys';
import { TypedStorage } from '../lib/typedStorage';

export interface BeatGridSettings {
  bpm: number;
  beatOffset: number; // Offset in seconds for first beat
  beatsPerMeasure: number;
  snapEnabled: boolean;
  gridVisible: boolean;
  subdivisions: number; // 1 = quarter notes, 2 = eighth notes, 4 = sixteenth notes
}

export interface BeatPosition {
  time: number;
  beatNumber: number;
  measureNumber: number;
  isDownbeat: boolean;
  isMainBeat: boolean; // true when position falls on a quarter note (not a subdivision)
}

type BeatGridListener = (settings: BeatGridSettings) => void;

const BeatGridSettingsSchema = z.object({
  bpm: z.number().min(20).max(300).default(120),
  beatOffset: z.number().min(0).default(0),
  beatsPerMeasure: z.number().min(1).max(16).default(4),
  snapEnabled: z.boolean().default(true),
  gridVisible: z.boolean().default(true),
  subdivisions: z.union([z.literal(1), z.literal(2), z.literal(4)]).default(1),
});

const DEFAULT_SETTINGS: BeatGridSettings = {
  bpm: 120,
  beatOffset: 0,
  beatsPerMeasure: 4,
  snapEnabled: true,
  gridVisible: true,
  subdivisions: 1,
};

const beatGridStorage = new TypedStorage({
  key: STORE_KEYS.BEAT_GRID,
  schema: BeatGridSettingsSchema,
  defaultValue: DEFAULT_SETTINGS,
  version: 1,
});

class BeatGridStore {
  private settings: BeatGridSettings;
  private listeners: Set<BeatGridListener> = new Set();

  constructor() {
    this.settings = beatGridStorage.get();
  }

  private saveToStorage(): void {
    beatGridStorage.set(this.settings);
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      listener(this.settings);
    }
  }

  getSettings(): BeatGridSettings {
    return { ...this.settings };
  }

  getBpm(): number {
    return this.settings.bpm;
  }

  setBpm(value: number): void {
    if (value >= 20 && value <= 300) {
      this.settings.bpm = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  getBeatOffset(): number {
    return this.settings.beatOffset;
  }

  setBeatOffset(value: number): void {
    if (value >= 0) {
      this.settings.beatOffset = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  getBeatsPerMeasure(): number {
    return this.settings.beatsPerMeasure;
  }

  setBeatsPerMeasure(value: number): void {
    if (value >= 1 && value <= 16) {
      this.settings.beatsPerMeasure = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  isSnapEnabled(): boolean {
    return this.settings.snapEnabled;
  }

  setSnapEnabled(value: boolean): void {
    this.settings.snapEnabled = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  toggleSnap(): void {
    this.setSnapEnabled(!this.settings.snapEnabled);
  }

  isGridVisible(): boolean {
    return this.settings.gridVisible;
  }

  setGridVisible(value: boolean): void {
    this.settings.gridVisible = value;
    this.saveToStorage();
    this.notifyListeners();
  }

  toggleGridVisibility(): void {
    this.setGridVisible(!this.settings.gridVisible);
  }

  getSubdivisions(): number {
    return this.settings.subdivisions;
  }

  setSubdivisions(value: number): void {
    if ([1, 2, 4].includes(value)) {
      this.settings.subdivisions = value;
      this.saveToStorage();
      this.notifyListeners();
    }
  }

  updateSettings(updates: Partial<BeatGridSettings>): void {
    this.settings = { ...this.settings, ...updates };
    this.saveToStorage();
    this.notifyListeners();
  }

  subscribe(listener: BeatGridListener): () => void {
    this.listeners.add(listener);
    listener(this.settings);
    return () => {
      this.listeners.delete(listener);
    };
  }

  reset(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    this.saveToStorage();
    this.notifyListeners();
  }

  /**
   * Calculate the time interval between beats in seconds
   */
  getBeatInterval(): number {
    return 60 / this.settings.bpm;
  }

  /**
   * Calculate the time interval for the current subdivision
   */
  getSubdivisionInterval(): number {
    return this.getBeatInterval() / this.settings.subdivisions;
  }

  /**
   * Get all beat positions within a time range
   */
  getBeatPositions(startTime: number, endTime: number): BeatPosition[] {
    const positions: BeatPosition[] = [];
    const subdivisionInterval = this.getSubdivisionInterval();
    const { beatOffset, beatsPerMeasure, subdivisions } = this.settings;

    // Calculate the first subdivision index at or before startTime
    const firstSubdivisionIndex = Math.floor((startTime - beatOffset) / subdivisionInterval);
    const firstBeatTime = beatOffset + firstSubdivisionIndex * subdivisionInterval;

    // Use index-based iteration to avoid floating-point accumulation errors
    for (let i = 0; ; i++) {
      const time = firstBeatTime + i * subdivisionInterval;
      if (time > endTime) break;
      if (time < startTime) continue;

      // Calculate beat information using integer arithmetic on subdivision index
      const totalSubdivisions = firstSubdivisionIndex + i;
      const isMainBeat = totalSubdivisions % subdivisions === 0;
      const beatNumber = Math.floor(totalSubdivisions / subdivisions);
      const measureNumber = Math.floor(beatNumber / beatsPerMeasure);
      const beatInMeasure = beatNumber % beatsPerMeasure;
      const isDownbeat = beatInMeasure === 0 && isMainBeat;

      positions.push({
        time,
        beatNumber,
        measureNumber,
        isDownbeat,
        isMainBeat,
      });
    }

    return positions;
  }

  /**
   * Snap a time value to the nearest beat or subdivision
   */
  snapToGrid(time: number): number {
    if (!this.settings.snapEnabled) {
      return time;
    }

    const interval = this.getSubdivisionInterval();
    const { beatOffset } = this.settings;

    // Find the nearest grid position
    const adjustedTime = time - beatOffset;
    const nearestGridIndex = Math.round(adjustedTime / interval);
    return beatOffset + nearestGridIndex * interval;
  }

  /**
   * Snap a time value to the nearest beat (ignoring subdivisions)
   */
  snapToBeat(time: number): number {
    if (!this.settings.snapEnabled) {
      return time;
    }

    const interval = this.getBeatInterval();
    const { beatOffset } = this.settings;

    const adjustedTime = time - beatOffset;
    const nearestBeatIndex = Math.round(adjustedTime / interval);
    return beatOffset + nearestBeatIndex * interval;
  }

  /**
   * Get the previous beat/grid position before a given time
   */
  getPreviousGridPosition(time: number): number {
    const interval = this.getSubdivisionInterval();
    const { beatOffset } = this.settings;

    const adjustedTime = time - beatOffset;
    const previousGridIndex = Math.floor(adjustedTime / interval);
    return Math.max(0, beatOffset + previousGridIndex * interval);
  }

  /**
   * Get the next beat/grid position after a given time
   */
  getNextGridPosition(time: number): number {
    const interval = this.getSubdivisionInterval();
    const { beatOffset } = this.settings;

    const adjustedTime = time - beatOffset;
    const nextGridIndex = Math.ceil(adjustedTime / interval);
    return beatOffset + nextGridIndex * interval;
  }

  /**
   * Detect BPM from audio buffer using onset detection
   */
  detectBpm(audioBuffer: AudioBuffer): number | null {
    try {
      const channelData = audioBuffer.getChannelData(0);
      const sampleRate = audioBuffer.sampleRate;

      // Window size for energy calculation (around 10ms)
      const windowSize = Math.floor(sampleRate * 0.01);
      const hopSize = Math.floor(windowSize / 2);

      // Calculate energy at each window
      const energies: number[] = [];
      for (let i = 0; i < channelData.length - windowSize; i += hopSize) {
        let energy = 0;
        for (let j = 0; j < windowSize; j++) {
          energy += channelData[i + j] * channelData[i + j];
        }
        energies.push(energy / windowSize);
      }

      // Find peaks in energy (onsets)
      const threshold = 1.5;
      const onsets: number[] = [];
      let localMean = 0;
      const meanWindow = 10;

      for (let i = meanWindow; i < energies.length - meanWindow; i++) {
        localMean = 0;
        for (let j = i - meanWindow; j < i + meanWindow; j++) {
          localMean += energies[j];
        }
        localMean /= (meanWindow * 2);

        if (energies[i] > localMean * threshold && energies[i] > energies[i - 1] && energies[i] > energies[i + 1]) {
          const onsetTime = (i * hopSize) / sampleRate;
          if (onsets.length === 0 || onsetTime - onsets[onsets.length - 1] > 0.1) {
            onsets.push(onsetTime);
          }
        }
      }

      if (onsets.length < 4) {
        return null;
      }

      // Calculate inter-onset intervals
      const intervals: number[] = [];
      for (let i = 1; i < onsets.length; i++) {
        intervals.push(onsets[i] - onsets[i - 1]);
      }

      // Cluster intervals to find the most common beat interval
      // Use same BPM range as store validation (20-300)
      const MIN_BPM = 20;
      const MAX_BPM = 300;
      const bpmCounts: Map<number, number> = new Map();

      for (const interval of intervals) {
        // Convert to BPM and round to nearest integer
        const bpm = Math.round(60 / interval);

        // Only consider BPM within valid range
        if (bpm >= MIN_BPM && bpm <= MAX_BPM) {
          const count = bpmCounts.get(bpm) || 0;
          bpmCounts.set(bpm, count + 1);

          // Also count double and half time for better detection
          const doubleBpm = bpm * 2;
          const halfBpm = Math.round(bpm / 2);

          if (doubleBpm <= MAX_BPM) {
            bpmCounts.set(doubleBpm, (bpmCounts.get(doubleBpm) || 0) + 0.5);
          }
          if (halfBpm >= MIN_BPM) {
            bpmCounts.set(halfBpm, (bpmCounts.get(halfBpm) || 0) + 0.5);
          }
        }
      }

      // Find the BPM with the highest count
      let maxCount = 0;
      let detectedBpm = 120;

      for (const [bpm, count] of bpmCounts) {
        if (count > maxCount) {
          maxCount = count;
          detectedBpm = bpm;
        }
      }

      return detectedBpm;
    } catch (error) {
      console.error('BPM detection failed:', error);
      return null;
    }
  }
}

export const beatGridStore = new BeatGridStore();
