/**
 * Tests for BeatGridStore
 * Covers BPM, beat positions, snap-to-grid, and audio beat detection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock TypedStorage
const mockStorage: Record<string, unknown> = {};

vi.mock('../../src/lib/typedStorage', () => ({
  TypedStorage: vi.fn().mockImplementation(({ defaultValue }) => ({
    get: () => mockStorage['beat-grid'] ?? defaultValue,
    set: (value: unknown) => { mockStorage['beat-grid'] = value; },
  })),
}));

vi.mock('../../src/lib/storageKeys', () => ({
  STORE_KEYS: { BEAT_GRID: 'beat-grid' },
}));

// Import after mocks
import { beatGridStore } from '../../src/stores/beatGridStore';

import type { BeatGridSettings, BeatPosition } from '../../src/stores/beatGridStore';

describe('BeatGridStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete mockStorage['beat-grid'];
    beatGridStore.reset();
  });

  describe('Initial State', () => {
    it('should have correct default settings', () => {
      const settings = beatGridStore.getSettings();

      expect(settings.bpm).toBe(120);
      expect(settings.beatOffset).toBe(0);
      expect(settings.beatsPerMeasure).toBe(4);
      expect(settings.snapEnabled).toBe(true);
      expect(settings.gridVisible).toBe(true);
      expect(settings.subdivisions).toBe(1);
    });
  });

  describe('BPM Settings', () => {
    it('should get BPM', () => {
      expect(beatGridStore.getBpm()).toBe(120);
    });

    it('should set BPM within valid range', () => {
      beatGridStore.setBpm(140);
      expect(beatGridStore.getBpm()).toBe(140);
    });

    it('should not set BPM below minimum (20)', () => {
      beatGridStore.setBpm(10);
      expect(beatGridStore.getBpm()).toBe(120); // Unchanged
    });

    it('should not set BPM above maximum (300)', () => {
      beatGridStore.setBpm(350);
      expect(beatGridStore.getBpm()).toBe(120); // Unchanged
    });

    it('should accept boundary values', () => {
      beatGridStore.setBpm(20);
      expect(beatGridStore.getBpm()).toBe(20);

      beatGridStore.setBpm(300);
      expect(beatGridStore.getBpm()).toBe(300);
    });
  });

  describe('Beat Offset', () => {
    it('should get beat offset', () => {
      expect(beatGridStore.getBeatOffset()).toBe(0);
    });

    it('should set beat offset', () => {
      beatGridStore.setBeatOffset(0.5);
      expect(beatGridStore.getBeatOffset()).toBe(0.5);
    });

    it('should not set negative beat offset', () => {
      beatGridStore.setBeatOffset(-1);
      expect(beatGridStore.getBeatOffset()).toBe(0); // Unchanged
    });
  });

  describe('Beats Per Measure', () => {
    it('should get beats per measure', () => {
      expect(beatGridStore.getBeatsPerMeasure()).toBe(4);
    });

    it('should set beats per measure within valid range', () => {
      beatGridStore.setBeatsPerMeasure(3);
      expect(beatGridStore.getBeatsPerMeasure()).toBe(3);
    });

    it('should not set beats per measure below minimum (1)', () => {
      beatGridStore.setBeatsPerMeasure(0);
      expect(beatGridStore.getBeatsPerMeasure()).toBe(4); // Unchanged
    });

    it('should not set beats per measure above maximum (16)', () => {
      beatGridStore.setBeatsPerMeasure(20);
      expect(beatGridStore.getBeatsPerMeasure()).toBe(4); // Unchanged
    });
  });

  describe('Snap Settings', () => {
    it('should get snap enabled state', () => {
      expect(beatGridStore.isSnapEnabled()).toBe(true);
    });

    it('should set snap enabled', () => {
      beatGridStore.setSnapEnabled(false);
      expect(beatGridStore.isSnapEnabled()).toBe(false);
    });

    it('should toggle snap', () => {
      beatGridStore.toggleSnap();
      expect(beatGridStore.isSnapEnabled()).toBe(false);

      beatGridStore.toggleSnap();
      expect(beatGridStore.isSnapEnabled()).toBe(true);
    });
  });

  describe('Grid Visibility', () => {
    it('should get grid visibility', () => {
      expect(beatGridStore.isGridVisible()).toBe(true);
    });

    it('should set grid visibility', () => {
      beatGridStore.setGridVisible(false);
      expect(beatGridStore.isGridVisible()).toBe(false);
    });

    it('should toggle grid visibility', () => {
      beatGridStore.toggleGridVisibility();
      expect(beatGridStore.isGridVisible()).toBe(false);

      beatGridStore.toggleGridVisibility();
      expect(beatGridStore.isGridVisible()).toBe(true);
    });
  });

  describe('Subdivisions', () => {
    it('should get subdivisions', () => {
      expect(beatGridStore.getSubdivisions()).toBe(1);
    });

    it('should set valid subdivisions', () => {
      beatGridStore.setSubdivisions(2);
      expect(beatGridStore.getSubdivisions()).toBe(2);

      beatGridStore.setSubdivisions(4);
      expect(beatGridStore.getSubdivisions()).toBe(4);
    });

    it('should not set invalid subdivisions', () => {
      beatGridStore.setSubdivisions(3);
      expect(beatGridStore.getSubdivisions()).toBe(1); // Unchanged from reset

      beatGridStore.setSubdivisions(8);
      expect(beatGridStore.getSubdivisions()).toBe(1); // Unchanged
    });
  });

  describe('Batch Updates', () => {
    it('should update multiple settings at once', () => {
      beatGridStore.updateSettings({
        bpm: 140,
        beatsPerMeasure: 3,
        subdivisions: 2,
      });

      expect(beatGridStore.getBpm()).toBe(140);
      expect(beatGridStore.getBeatsPerMeasure()).toBe(3);
      expect(beatGridStore.getSubdivisions()).toBe(2);
    });
  });

  describe('Beat Interval Calculations', () => {
    it('should calculate beat interval', () => {
      beatGridStore.setBpm(120);
      expect(beatGridStore.getBeatInterval()).toBe(0.5); // 60/120 = 0.5 seconds

      beatGridStore.setBpm(60);
      expect(beatGridStore.getBeatInterval()).toBe(1); // 60/60 = 1 second
    });

    it('should calculate subdivision interval', () => {
      beatGridStore.setBpm(120);

      beatGridStore.setSubdivisions(1);
      expect(beatGridStore.getSubdivisionInterval()).toBe(0.5);

      beatGridStore.setSubdivisions(2);
      expect(beatGridStore.getSubdivisionInterval()).toBe(0.25);

      beatGridStore.setSubdivisions(4);
      expect(beatGridStore.getSubdivisionInterval()).toBe(0.125);
    });
  });

  describe('Beat Positions', () => {
    beforeEach(() => {
      beatGridStore.setBpm(120); // 0.5s per beat
      beatGridStore.setBeatOffset(0);
      beatGridStore.setBeatsPerMeasure(4);
      beatGridStore.setSubdivisions(1);
    });

    it('should get beat positions within a range', () => {
      const positions = beatGridStore.getBeatPositions(0, 2);

      expect(positions.length).toBe(5); // 0, 0.5, 1, 1.5, 2
      expect(positions[0].time).toBe(0);
      expect(positions[0].beatNumber).toBe(0);
      expect(positions[0].isDownbeat).toBe(true);
    });

    it('should correctly identify downbeats', () => {
      const positions = beatGridStore.getBeatPositions(0, 4);

      const downbeats = positions.filter(p => p.isDownbeat);
      // At 120 BPM with 4 beats per measure, downbeats at 0, 2, 4 seconds
      expect(downbeats.length).toBe(3);
    });

    it('should respect beat offset', () => {
      beatGridStore.setBeatOffset(0.25);

      const positions = beatGridStore.getBeatPositions(0, 1);

      expect(positions[0].time).toBeCloseTo(0.25, 5);
    });

    it('should handle subdivisions', () => {
      beatGridStore.setSubdivisions(2);

      const positions = beatGridStore.getBeatPositions(0, 1);

      // With subdivisions of 2, interval is 0.25s: 0, 0.25, 0.5, 0.75, 1
      expect(positions.length).toBe(5);
      expect(positions[1].time).toBeCloseTo(0.25, 5);
    });
  });

  describe('Snap to Grid', () => {
    beforeEach(() => {
      beatGridStore.setBpm(120); // 0.5s per beat
      beatGridStore.setBeatOffset(0);
      beatGridStore.setSubdivisions(1);
      beatGridStore.setSnapEnabled(true);
    });

    it('should snap to nearest grid position', () => {
      expect(beatGridStore.snapToGrid(0.3)).toBe(0.5);
      expect(beatGridStore.snapToGrid(0.2)).toBe(0);
      expect(beatGridStore.snapToGrid(0.25)).toBe(0.5); // Rounds up
    });

    it('should return original value when snap disabled', () => {
      beatGridStore.setSnapEnabled(false);

      expect(beatGridStore.snapToGrid(0.3)).toBe(0.3);
    });

    it('should snap to beat ignoring subdivisions', () => {
      beatGridStore.setSubdivisions(4);

      expect(beatGridStore.snapToBeat(0.3)).toBe(0.5);
      expect(beatGridStore.snapToBeat(0.1)).toBe(0);
    });

    it('should return original when snap disabled for snapToBeat', () => {
      beatGridStore.setSnapEnabled(false);

      expect(beatGridStore.snapToBeat(0.3)).toBe(0.3);
    });
  });

  describe('Grid Navigation', () => {
    beforeEach(() => {
      beatGridStore.setBpm(120); // 0.5s per beat
      beatGridStore.setBeatOffset(0);
      beatGridStore.setSubdivisions(1);
    });

    it('should get previous grid position', () => {
      expect(beatGridStore.getPreviousGridPosition(0.6)).toBe(0.5);
      expect(beatGridStore.getPreviousGridPosition(0.5)).toBe(0.5);
      expect(beatGridStore.getPreviousGridPosition(1.1)).toBe(1);
    });

    it('should not return negative values for previous position', () => {
      expect(beatGridStore.getPreviousGridPosition(0.1)).toBe(0);
    });

    it('should get next grid position', () => {
      expect(beatGridStore.getNextGridPosition(0.1)).toBe(0.5);
      expect(beatGridStore.getNextGridPosition(0.5)).toBe(0.5);
      expect(beatGridStore.getNextGridPosition(0.6)).toBe(1);
    });
  });

  describe('BPM Detection', () => {
    it('should return null for insufficient data', () => {
      const mockBuffer = {
        getChannelData: () => new Float32Array(100),
        sampleRate: 44100,
      } as unknown as AudioBuffer;

      const result = beatGridStore.detectBpm(mockBuffer);

      expect(result).toBeNull();
    });

    it('should detect BPM from audio buffer', () => {
      // Create a mock audio buffer with clear beat patterns
      const sampleRate = 44100;
      const duration = 10; // 10 seconds
      const samples = sampleRate * duration;
      const channelData = new Float32Array(samples);

      // Simulate 120 BPM (0.5s per beat)
      const samplesPerBeat = sampleRate * 0.5;
      for (let i = 0; i < samples; i++) {
        const beatPosition = i % samplesPerBeat;
        // Create a spike at beat positions
        if (beatPosition < sampleRate * 0.01) {
          channelData[i] = 0.8 + Math.random() * 0.2;
        } else {
          channelData[i] = Math.random() * 0.1;
        }
      }

      const mockBuffer = {
        getChannelData: () => channelData,
        sampleRate,
      } as unknown as AudioBuffer;

      const result = beatGridStore.detectBpm(mockBuffer);

      // Should detect around 120 BPM (allow for algorithm variation)
      expect(result).not.toBeNull();
      if (result !== null) {
        expect(result).toBeGreaterThanOrEqual(60);
        expect(result).toBeLessThanOrEqual(240);
      }
    });
  });

  describe('Subscriptions', () => {
    it('should notify subscribers on state changes', () => {
      const subscriber = vi.fn();
      beatGridStore.subscribe(subscriber);

      // Called immediately with current settings
      expect(subscriber).toHaveBeenCalledTimes(1);

      beatGridStore.setBpm(140);

      expect(subscriber).toHaveBeenCalledTimes(2);
    });

    it('should unsubscribe correctly', () => {
      const subscriber = vi.fn();
      const unsubscribe = beatGridStore.subscribe(subscriber);

      expect(subscriber).toHaveBeenCalledTimes(1);

      unsubscribe();
      beatGridStore.setBpm(140);

      expect(subscriber).toHaveBeenCalledTimes(1); // No additional calls
    });

    it('should support multiple subscribers', () => {
      const subscriber1 = vi.fn();
      const subscriber2 = vi.fn();

      beatGridStore.subscribe(subscriber1);
      beatGridStore.subscribe(subscriber2);

      beatGridStore.setBpm(140);

      expect(subscriber1).toHaveBeenCalledTimes(2);
      expect(subscriber2).toHaveBeenCalledTimes(2);
    });
  });

  describe('Reset', () => {
    it('should reset all settings to defaults', () => {
      beatGridStore.setBpm(180);
      beatGridStore.setSnapEnabled(false);
      beatGridStore.setSubdivisions(4);

      beatGridStore.reset();

      const settings = beatGridStore.getSettings();
      expect(settings.bpm).toBe(120);
      expect(settings.snapEnabled).toBe(true);
      expect(settings.subdivisions).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle high precision beat calculations', () => {
      beatGridStore.setBpm(120);
      beatGridStore.setSubdivisions(4);

      const interval = beatGridStore.getSubdivisionInterval();
      expect(interval).toBe(0.125);

      const positions = beatGridStore.getBeatPositions(0, 0.5);
      // Should have positions at 0, 0.125, 0.25, 0.375, 0.5
      expect(positions.length).toBe(5);
    });

    it('should handle very fast BPM', () => {
      beatGridStore.setBpm(300);

      expect(beatGridStore.getBeatInterval()).toBe(0.2);
    });

    it('should handle very slow BPM', () => {
      beatGridStore.setBpm(20);

      expect(beatGridStore.getBeatInterval()).toBe(3);
    });
  });
});
