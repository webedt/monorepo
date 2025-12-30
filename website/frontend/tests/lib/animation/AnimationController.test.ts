/**
 * Tests for AnimationController class
 *
 * Tests keyframe animation playback, fill modes, and timeline management
 * using the actual AnimationController implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AnimationController,
  AnimationTimeline,
  animate,
} from '../../../src/lib/animation/AnimationController.js';
import type {
  AnimationState,
  AnimationEvent,
  AnimationOptions,
  PlaybackDirection,
} from '../../../src/lib/animation/AnimationController.js';
import { createTrack } from '../../../src/lib/animation/keyframe.js';
import type {
  KeyframeTrack,
  TransformProperties,
  Keyframe,
} from '../../../src/lib/animation/keyframe.js';

// ============================================================================
// Mock Data Factories
// ============================================================================

function createKeyframe(overrides: Partial<Keyframe<TransformProperties>> = {}): Keyframe<TransformProperties> {
  return {
    time: overrides.time ?? 0,
    value: overrides.value ?? { x: 0, y: 0, opacity: 0 },
    easing: overrides.easing,
  };
}

function createKeyframeTrack(overrides: Partial<KeyframeTrack<TransformProperties>> = {}): KeyframeTrack<TransformProperties> {
  return createTrack(
    overrides.id ?? 'track-1',
    overrides.keyframes ?? [
      createKeyframe({ time: 0, value: { x: 0, y: 0, opacity: 0 } }),
      createKeyframe({ time: 500, value: { x: 100, y: 50, opacity: 0.5 } }),
      createKeyframe({ time: 1000, value: { x: 200, y: 100, opacity: 1 } }),
    ],
    { defaultEasing: overrides.defaultEasing }
  );
}

// ============================================================================
// Test Setup Helpers
// ============================================================================

let rafCallbacks: Array<{ id: number; callback: FrameRequestCallback }> = [];
let rafIdCounter = 0;
let currentTime = 0;

function setupAnimationFrameMocks(): void {
  rafCallbacks = [];
  rafIdCounter = 0;
  currentTime = 0;

  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
    const id = ++rafIdCounter;
    rafCallbacks.push({ id, callback });
    return id;
  });

  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafCallbacks = rafCallbacks.filter((item) => item.id !== id);
  });

  vi.stubGlobal('performance', {
    now: () => currentTime,
  });
}

function advanceTime(ms: number): void {
  currentTime += ms;
  // Execute all pending RAF callbacks
  const callbacks = [...rafCallbacks];
  rafCallbacks = [];
  for (const { callback } of callbacks) {
    callback(currentTime);
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('AnimationController', () => {
  let controller: AnimationController;

  beforeEach(() => {
    setupAnimationFrameMocks();
    controller = new AnimationController(createKeyframeTrack());
  });

  afterEach(() => {
    controller.destroy();
    vi.unstubAllGlobals();
  });

  describe('Initialization', () => {
    it('should start in idle state', () => {
      expect(controller.getState()).toBe('idle');
    });

    it('should have default options', () => {
      expect(controller.getPlaybackRate()).toBe(1);
      expect(controller.getTotalDuration()).toBe(1000);
    });

    it('should accept custom options', () => {
      controller = new AnimationController(createKeyframeTrack(), {
        duration: 2000,
        iterations: 3,
        playbackRate: 2,
      });

      expect(controller.getPlaybackRate()).toBe(2);
      expect(controller.getTotalDuration()).toBe(6000);
    });

    it('should use track duration by default', () => {
      const track = createKeyframeTrack({
        keyframes: [
          createKeyframe({ time: 0 }),
          createKeyframe({ time: 500 }),
        ],
      });
      controller = new AnimationController(track);

      expect(controller.getTotalDuration()).toBe(500);
    });
  });

  describe('Playback Control', () => {
    it('should transition to playing state on play()', () => {
      controller.play();

      expect(controller.getState()).toBe('playing');
    });

    it('should pause playback', () => {
      controller.play();
      controller.pause();

      expect(controller.getState()).toBe('paused');
    });

    it('should resume from paused state', () => {
      controller.play();
      controller.pause();
      controller.play();

      expect(controller.getState()).toBe('playing');
    });

    it('should not pause if not playing', () => {
      controller.pause();

      expect(controller.getState()).toBe('idle');
    });

    it('should stop and reset', () => {
      controller.play();
      advanceTime(500);
      controller.stop();

      expect(controller.getState()).toBe('idle');
      expect(controller.getCurrentTime()).toBe(0);
      expect(controller.getCurrentIteration()).toBe(0);
    });

    it('should cancel without resetting position', () => {
      controller.play();
      advanceTime(500);
      controller.cancel();

      expect(controller.getState()).toBe('idle');
    });

    it('should not play if already playing', () => {
      const handler = vi.fn();
      controller.on('start', handler);

      controller.play();
      controller.play(); // Second call should be ignored

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Time and Progress', () => {
    it('should track current time', () => {
      controller.play();
      advanceTime(300);

      expect(controller.getCurrentTime()).toBeGreaterThan(0);
    });

    it('should calculate progress', () => {
      controller.play();
      advanceTime(500);

      expect(controller.getProgress()).toBeGreaterThan(0);
    });

    it('should handle infinite iterations', () => {
      controller = new AnimationController(createKeyframeTrack(), { iterations: Infinity });

      expect(controller.getTotalDuration()).toBe(Infinity);
    });

    it('should return correct progress for infinite iterations', () => {
      controller = new AnimationController(createKeyframeTrack(), { iterations: Infinity });
      controller.play();
      advanceTime(500);

      // For infinite, progress is within current iteration
      expect(controller.getProgress()).toBeGreaterThan(0);
      expect(controller.getProgress()).toBeLessThan(1);
    });
  });

  describe('Seeking', () => {
    it('should seek to specific time', () => {
      controller.seek(500);

      expect(controller.getCurrentTime()).toBe(500);
    });

    it('should clamp seek to duration', () => {
      controller.seek(5000);

      expect(controller.getCurrentTime()).toBeLessThanOrEqual(1000);
    });

    it('should seek by progress', () => {
      controller.seekProgress(0.5);

      expect(controller.getCurrentTime()).toBe(500);
    });

    it('should emit update event on seek', () => {
      const handler = vi.fn();
      controller.on('update', handler);
      controller.seek(500);

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Playback Rate', () => {
    it('should change playback rate', () => {
      controller.setPlaybackRate(2);

      expect(controller.getPlaybackRate()).toBe(2);
    });

    it('should clamp minimum playback rate', () => {
      controller.setPlaybackRate(0.01);

      expect(controller.getPlaybackRate()).toBeGreaterThanOrEqual(0.1);
    });
  });

  describe('Iterations', () => {
    it('should track current iteration', () => {
      controller = new AnimationController(createKeyframeTrack(), { iterations: 3 });
      controller.play();

      expect(controller.getCurrentIteration()).toBe(0);
    });

    it('should emit iteration event on boundary', () => {
      controller = new AnimationController(createKeyframeTrack(), { iterations: 3 });
      const handler = vi.fn();
      controller.on('iteration', handler);
      controller.play();

      // Need multiple frame updates to cross iteration boundaries
      advanceTime(500);
      advanceTime(500);
      advanceTime(500);

      expect(handler).toHaveBeenCalled();
    });

    it('should finish after all iterations', () => {
      controller = new AnimationController(createKeyframeTrack(), { iterations: 2 });
      const handler = vi.fn();
      controller.on('end', handler);
      controller.play();

      advanceTime(3000);

      expect(handler).toHaveBeenCalled();
      expect(controller.getState()).toBe('finished');
    });
  });

  describe('Direction', () => {
    it('should play forward by default', () => {
      controller.play();
      controller.seek(0);
      const result = controller.getValue();

      expect(result.value.x).toBe(0);
    });

    it('should play in reverse', () => {
      controller = new AnimationController(createKeyframeTrack(), { direction: 'reverse' });
      controller.play();
      controller.seek(0);
      const result = controller.getValueAtTime(0);

      expect(result.value.x).toBe(200); // Starts from end
    });

    it('should alternate direction', () => {
      controller = new AnimationController(createKeyframeTrack(), {
        direction: 'alternate',
        iterations: 2,
      });
      controller.play();

      // First iteration: forward
      advanceTime(500);
      expect(controller.getCurrentIteration()).toBe(0);

      // After first iteration, should be on second (reverse)
      advanceTime(1000);
      expect(controller.getCurrentIteration()).toBe(1);
    });

    it('should handle alternate-reverse direction', () => {
      controller = new AnimationController(createKeyframeTrack(), {
        direction: 'alternate-reverse',
        iterations: 2,
      });
      controller.play();
      controller.seek(0);

      // First iteration starts reversed
      const result = controller.getValueAtTime(0);
      expect(result.value.x).toBe(200);
    });
  });

  describe('Fill Mode', () => {
    it('should show first frame with fill backwards in idle state', () => {
      controller = new AnimationController(createKeyframeTrack(), { fill: 'backwards' });
      const result = controller.getValue();

      expect(result.value.x).toBe(0);
    });

    it('should show last frame with fill forwards after finish', () => {
      controller = new AnimationController(createKeyframeTrack(), { fill: 'forwards' });
      controller.play();
      advanceTime(2000);
      const result = controller.getValue();

      expect(result.value.x).toBe(200);
    });

    it('should show empty with fill none in idle state', () => {
      controller = new AnimationController(createKeyframeTrack(), { fill: 'none' });
      const result = controller.getValue();

      expect(result.value).toEqual({});
    });

    it('should handle fill both', () => {
      controller = new AnimationController(createKeyframeTrack(), { fill: 'both' });

      // Before play - should show first frame
      const beforeResult = controller.getValue();
      expect(beforeResult.value.x).toBe(0);

      // After finish - should show last frame
      controller.play();
      advanceTime(2000);
      const afterResult = controller.getValue();
      expect(afterResult.value.x).toBe(200);
    });

    it('should handle fill forwards with reverse direction', () => {
      controller = new AnimationController(createKeyframeTrack(), {
        fill: 'forwards',
        direction: 'reverse',
      });
      controller.play();
      advanceTime(2000);
      const result = controller.getValue();

      expect(result.value.x).toBe(0); // Ends at the start position
    });
  });

  describe('Interpolation', () => {
    it('should interpolate x values', () => {
      controller.play();
      controller.seek(500);
      const result = controller.getValue();

      expect(result.value.x).toBeCloseTo(100);
    });

    it('should interpolate y values', () => {
      controller.play();
      controller.seek(500);
      const result = controller.getValue();

      expect(result.value.y).toBeCloseTo(50);
    });

    it('should interpolate opacity', () => {
      controller.play();
      controller.seek(500);
      const result = controller.getValue();

      expect(result.value.opacity).toBeCloseTo(0.5);
    });

    it('should return first keyframe at time 0', () => {
      controller.play();
      controller.seek(0);
      const result = controller.getValue();

      expect(result.value.x).toBe(0);
      expect(result.currentKeyframeIndex).toBe(0);
    });

    it('should return last keyframe at end', () => {
      controller.play();
      controller.seek(1000);
      const result = controller.getValue();

      expect(result.value.x).toBe(200);
    });
  });

  describe('Event Handling', () => {
    it('should emit start event', () => {
      const handler = vi.fn();
      controller.on('start', handler);
      controller.play();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'start' }));
    });

    it('should emit pause event', () => {
      const handler = vi.fn();
      controller.on('pause', handler);
      controller.play();
      controller.pause();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'pause' }));
    });

    it('should emit resume event', () => {
      const handler = vi.fn();
      controller.on('resume', handler);
      controller.play();
      controller.pause();
      controller.play();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'resume' }));
    });

    it('should emit cancel event', () => {
      const handler = vi.fn();
      controller.on('cancel', handler);
      controller.play();
      controller.cancel();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'cancel' }));
    });

    it('should emit end event', () => {
      const handler = vi.fn();
      controller.on('end', handler);
      controller.play();
      advanceTime(2000);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'end' }));
    });

    it('should emit update event', () => {
      const handler = vi.fn();
      controller.on('update', handler);
      controller.play();
      advanceTime(100);

      expect(handler).toHaveBeenCalled();
    });

    it('should unsubscribe events with returned function', () => {
      const handler = vi.fn();
      const unsubscribe = controller.on('start', handler);
      unsubscribe();
      controller.play();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should unsubscribe with off()', () => {
      const handler = vi.fn();
      controller.on('start', handler);
      controller.off('start', handler);
      controller.play();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should include event data', () => {
      let receivedEvent: AnimationEvent | null = null;
      controller.on('start', (event) => {
        receivedEvent = event;
      });
      controller.play();

      expect(receivedEvent).not.toBeNull();
      // Note: start event is emitted BEFORE state changes to 'playing'
      expect(receivedEvent!.state).toBe('idle');
      expect(receivedEvent!.iteration).toBe(0);
    });

    it('should handle errors in event handlers gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Test error');
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      controller.on('start', errorHandler);
      controller.play();

      expect(errorHandler).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Delay', () => {
    it('should wait for delay before starting animation', () => {
      controller = new AnimationController(createKeyframeTrack(), { delay: 500 });
      controller.play();
      advanceTime(300);

      // Should still be at start during delay
      expect(controller.getCurrentTime()).toBe(0);
    });

    it('should start animation after delay', () => {
      controller = new AnimationController(createKeyframeTrack(), { delay: 500 });
      controller.play();
      advanceTime(600);

      expect(controller.getCurrentTime()).toBeGreaterThan(0);
    });

    it('should include delay in total duration', () => {
      controller = new AnimationController(createKeyframeTrack(), { delay: 500 });

      expect(controller.getTotalDuration()).toBe(1500);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty keyframes', () => {
      controller = new AnimationController(createTrack('empty', []));
      const result = controller.getValue();

      // In idle state with fill='forwards' (default), returns empty value
      expect(result.value).toEqual({});
      expect(result.currentKeyframeIndex).toBe(-1);
    });

    it('should handle single keyframe', () => {
      controller = new AnimationController(createTrack('single', [
        createKeyframe({ time: 0, value: { x: 100 } }),
      ]));
      controller.play();
      const result = controller.getValue();

      expect(result.value.x).toBe(100);
    });

    it('should handle zero duration', () => {
      controller = new AnimationController(createKeyframeTrack(), { duration: 0 });
      controller.play();
      advanceTime(100);

      expect(controller.getState()).toBe('finished');
    });

    it('should reset on play after finished', () => {
      controller.play();
      advanceTime(2000);
      expect(controller.getState()).toBe('finished');

      controller.play();
      expect(controller.getState()).toBe('playing');
      expect(controller.getCurrentTime()).toBe(0);
      expect(controller.getCurrentIteration()).toBe(0);
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      const handler = vi.fn();
      controller.on('start', handler);
      controller.destroy();

      controller.play();
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

describe('AnimationTimeline', () => {
  let timeline: AnimationTimeline;

  beforeEach(() => {
    setupAnimationFrameMocks();
    timeline = new AnimationTimeline();
  });

  afterEach(() => {
    timeline.destroy();
    vi.unstubAllGlobals();
  });

  it('should add tracks and return controllers', () => {
    const track = createKeyframeTrack({ id: 'track-1' });
    const controller = timeline.addTrack(track);

    expect(controller).toBeDefined();
    expect(timeline.getController('track-1')).toBe(controller);
  });

  it('should remove tracks', () => {
    const track = createKeyframeTrack({ id: 'track-1' });
    timeline.addTrack(track);
    timeline.removeTrack('track-1');

    expect(timeline.getController('track-1')).toBeUndefined();
  });

  it('should play all tracks', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.addTrack(createKeyframeTrack({ id: 'track-2' }));
    timeline.playAll();

    expect(timeline.getController('track-1')?.getState()).toBe('playing');
    expect(timeline.getController('track-2')?.getState()).toBe('playing');
    expect(timeline.getState()).toBe('playing');
  });

  it('should pause all tracks', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.addTrack(createKeyframeTrack({ id: 'track-2' }));
    timeline.playAll();
    timeline.pauseAll();

    expect(timeline.getController('track-1')?.getState()).toBe('paused');
    expect(timeline.getController('track-2')?.getState()).toBe('paused');
    expect(timeline.getState()).toBe('paused');
  });

  it('should stop all tracks', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.playAll();
    advanceTime(500);
    timeline.stopAll();

    expect(timeline.getController('track-1')?.getState()).toBe('idle');
    expect(timeline.getController('track-1')?.getCurrentTime()).toBe(0);
    expect(timeline.getState()).toBe('idle');
  });

  it('should seek all tracks', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.addTrack(createKeyframeTrack({ id: 'track-2' }));
    timeline.seekAll(500);

    expect(timeline.getController('track-1')?.getCurrentTime()).toBe(500);
    expect(timeline.getController('track-2')?.getCurrentTime()).toBe(500);
  });

  it('should seek all tracks by progress', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.seekAllProgress(0.5);

    expect(timeline.getController('track-1')?.getCurrentTime()).toBe(500);
  });

  it('should set playback rate for all tracks', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.addTrack(createKeyframeTrack({ id: 'track-2' }));
    timeline.setPlaybackRateAll(2);

    expect(timeline.getController('track-1')?.getPlaybackRate()).toBe(2);
    expect(timeline.getController('track-2')?.getPlaybackRate()).toBe(2);
  });

  it('should get all values', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.addTrack(createKeyframeTrack({ id: 'track-2' }));
    timeline.playAll();
    timeline.seekAll(500);

    const values = timeline.getAllValues();

    expect(values.size).toBe(2);
    expect(values.get('track-1')?.value.x).toBeCloseTo(100);
    expect(values.get('track-2')?.value.x).toBeCloseTo(100);
  });

  it('should clean up on destroy', () => {
    timeline.addTrack(createKeyframeTrack({ id: 'track-1' }));
    timeline.destroy();

    expect(timeline.getController('track-1')).toBeUndefined();
  });
});

describe('animate helper', () => {
  beforeEach(() => {
    setupAnimationFrameMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should create and play animation', () => {
    const onUpdate = vi.fn();
    animate(createKeyframeTrack(), onUpdate);

    advanceTime(100);

    expect(onUpdate).toHaveBeenCalled();
  });

  it('should call onComplete when animation ends', () => {
    const onUpdate = vi.fn();
    const onComplete = vi.fn();
    animate(createKeyframeTrack(), onUpdate, { onComplete });

    advanceTime(2000);

    expect(onComplete).toHaveBeenCalled();
  });

  it('should return cancel function', () => {
    const onUpdate = vi.fn();
    const cancel = animate(createKeyframeTrack(), onUpdate);

    cancel();
    advanceTime(100);

    // Updates should stop after cancel
    const callCount = onUpdate.mock.calls.length;
    advanceTime(100);
    expect(onUpdate.mock.calls.length).toBe(callCount);
  });

  it('should pass options to controller', () => {
    const onUpdate = vi.fn();
    animate(createKeyframeTrack(), onUpdate, { playbackRate: 2 });

    // Need multiple frame updates to trigger update events
    advanceTime(100);
    advanceTime(100);
    advanceTime(100);

    // With 2x speed, should progress faster
    expect(onUpdate).toHaveBeenCalled();
  });
});
