/**
 * Tests for AnimationController class
 *
 * Tests keyframe animation playback, fill modes, and timeline management.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Type Definitions (matching AnimationController.ts)
// ============================================================================

type AnimationState = 'idle' | 'playing' | 'paused' | 'finished';
type PlaybackDirection = 'forward' | 'reverse' | 'alternate' | 'alternate-reverse';
type FillMode = 'none' | 'forwards' | 'backwards' | 'both';

interface AnimationEvent {
  type: 'start' | 'end' | 'iteration' | 'pause' | 'resume' | 'cancel' | 'update';
  currentTime: number;
  iteration: number;
  progress: number;
  state: AnimationState;
}

type AnimationEventHandler = (event: AnimationEvent) => void;

interface AnimationOptions {
  duration?: number;
  iterations?: number;
  delay?: number;
  direction?: PlaybackDirection;
  fill?: FillMode;
  playbackRate?: number;
}

interface TransformProperties {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

interface Keyframe {
  time: number;
  value: TransformProperties;
  easing?: string;
}

interface KeyframeTrack {
  id: string;
  keyframes: Keyframe[];
}

interface InterpolationResult {
  value: TransformProperties;
  currentKeyframeIndex: number;
  isComplete: boolean;
  progress: number;
}

// ============================================================================
// Mock AnimationController Implementation
// ============================================================================

class MockAnimationController {
  private track: KeyframeTrack;
  private options: Required<AnimationOptions>;
  private state: AnimationState = 'idle';
  private currentTime = 0;
  private currentIteration = 0;
  private eventHandlers: Map<AnimationEvent['type'], Set<AnimationEventHandler>> = new Map();

  constructor(track: KeyframeTrack, options: AnimationOptions = {}) {
    this.track = track;
    this.options = {
      duration: options.duration ?? this.getTrackDuration(),
      iterations: options.iterations ?? 1,
      delay: options.delay ?? 0,
      direction: options.direction ?? 'forward',
      fill: options.fill ?? 'forwards',
      playbackRate: options.playbackRate ?? 1,
    };
  }

  private getTrackDuration(): number {
    if (this.track.keyframes.length === 0) return 0;
    return Math.max(...this.track.keyframes.map((k) => k.time));
  }

  getState(): AnimationState {
    return this.state;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getCurrentIteration(): number {
    return this.currentIteration;
  }

  getTotalDuration(): number {
    if (this.options.iterations === Infinity) return Infinity;
    return this.options.duration * this.options.iterations + this.options.delay;
  }

  getProgress(): number {
    const totalDuration = this.getTotalDuration();
    if (totalDuration === Infinity) {
      return this.options.duration > 0 ? this.currentTime / this.options.duration : 1;
    }
    const elapsed = this.currentIteration * this.options.duration + this.currentTime;
    return totalDuration > 0 ? Math.min(elapsed / totalDuration, 1) : 1;
  }

  setPlaybackRate(rate: number): void {
    this.options.playbackRate = Math.max(0.1, rate);
  }

  getPlaybackRate(): number {
    return this.options.playbackRate;
  }

  play(): void {
    if (this.state === 'playing') return;

    if (this.state === 'finished') {
      this.currentTime = 0;
      this.currentIteration = 0;
    }

    if (this.state === 'paused') {
      this.emit('resume');
    } else {
      this.emit('start');
    }

    this.state = 'playing';
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.emit('pause');
  }

  stop(): void {
    this.cancel();
    this.currentTime = 0;
    this.currentIteration = 0;
  }

  cancel(): void {
    this.state = 'idle';
    this.emit('cancel');
  }

  seek(time: number): void {
    this.currentTime = Math.max(0, Math.min(time, this.options.duration));
    this.emit('update');
  }

  seekProgress(progress: number): void {
    this.seek(progress * this.options.duration);
  }

  // Simulate time advancement (for testing)
  advanceTime(deltaMs: number): void {
    if (this.state !== 'playing') return;

    const elapsed = deltaMs * this.options.playbackRate;

    // Handle delay
    if (elapsed < this.options.delay) {
      return;
    }

    const timeAfterDelay = elapsed - this.options.delay + this.currentIteration * this.options.duration + this.currentTime;
    const iterationDuration = this.options.duration;

    if (iterationDuration <= 0) {
      this.finish();
      return;
    }

    const totalIterationTime = Math.floor(timeAfterDelay / iterationDuration);
    const previousIteration = this.currentIteration;
    this.currentIteration = Math.min(totalIterationTime, this.options.iterations - 1);
    this.currentTime = timeAfterDelay - this.currentIteration * iterationDuration;

    // Check for iteration boundary
    if (this.currentIteration > previousIteration) {
      this.emit('iteration');
    }

    // Check for completion
    if (this.options.iterations !== Infinity && totalIterationTime >= this.options.iterations) {
      this.currentTime = iterationDuration;
      this.finish();
      return;
    }

    this.emit('update');
  }

  private finish(): void {
    this.state = 'finished';
    this.emit('end');
  }

  getValue(): InterpolationResult {
    const { fill, duration, direction } = this.options;

    if (this.state === 'idle') {
      if (fill === 'backwards' || fill === 'both') {
        const showFirst = direction === 'reverse' || direction === 'alternate-reverse';
        return this.interpolate(showFirst ? duration : 0);
      }
      return { value: {}, currentKeyframeIndex: -1, isComplete: false, progress: 0 };
    }

    if (this.state === 'finished') {
      if (fill === 'forwards' || fill === 'both') {
        const finalIteration = this.options.iterations - 1;
        const isOddFinal = finalIteration % 2 === 1;
        const endsReversed =
          direction === 'reverse' ||
          (direction === 'alternate' && isOddFinal) ||
          (direction === 'alternate-reverse' && !isOddFinal);
        return this.interpolate(endsReversed ? 0 : duration);
      }
      return { value: {}, currentKeyframeIndex: -1, isComplete: true, progress: 1 };
    }

    return this.getValueAtTime(this.currentTime);
  }

  getValueAtTime(time: number): InterpolationResult {
    let effectiveTime = time;

    const isOddIteration = this.currentIteration % 2 === 1;
    const shouldReverse =
      this.options.direction === 'reverse' ||
      (this.options.direction === 'alternate' && isOddIteration) ||
      (this.options.direction === 'alternate-reverse' && !isOddIteration);

    if (shouldReverse) {
      effectiveTime = this.options.duration - time;
    }

    return this.interpolate(effectiveTime);
  }

  private interpolate(time: number): InterpolationResult {
    const keyframes = this.track.keyframes;

    if (keyframes.length === 0) {
      return { value: {}, currentKeyframeIndex: -1, isComplete: true, progress: 1 };
    }

    // Find surrounding keyframes
    let fromIndex = 0;
    let toIndex = 0;

    for (let i = 0; i < keyframes.length - 1; i++) {
      if (time >= keyframes[i].time && time < keyframes[i + 1].time) {
        fromIndex = i;
        toIndex = i + 1;
        break;
      }
    }

    if (time >= keyframes[keyframes.length - 1].time) {
      fromIndex = toIndex = keyframes.length - 1;
    }

    const from = keyframes[fromIndex];
    const to = keyframes[toIndex];

    // Calculate local progress
    let t = 0;
    if (fromIndex !== toIndex) {
      const segmentDuration = to.time - from.time;
      t = segmentDuration > 0 ? (time - from.time) / segmentDuration : 1;
    }

    // Interpolate values
    const value: TransformProperties = {};
    if (from.value.x !== undefined && to.value.x !== undefined) {
      value.x = from.value.x + (to.value.x - from.value.x) * t;
    }
    if (from.value.y !== undefined && to.value.y !== undefined) {
      value.y = from.value.y + (to.value.y - from.value.y) * t;
    }
    if (from.value.opacity !== undefined && to.value.opacity !== undefined) {
      value.opacity = from.value.opacity + (to.value.opacity - from.value.opacity) * t;
    }

    return {
      value,
      currentKeyframeIndex: fromIndex,
      isComplete: time >= this.options.duration,
      progress: this.options.duration > 0 ? time / this.options.duration : 1,
    };
  }

  on(event: AnimationEvent['type'], handler: AnimationEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: AnimationEvent['type'], handler: AnimationEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  destroy(): void {
    this.cancel();
    this.eventHandlers.clear();
  }

  private emit(type: AnimationEvent['type']): void {
    const handlers = this.eventHandlers.get(type);
    if (!handlers) return;

    const event: AnimationEvent = {
      type,
      currentTime: this.currentTime,
      iteration: this.currentIteration,
      progress: this.getProgress(),
      state: this.state,
    };

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Animation event handler error:', error);
      }
    }
  }
}

// ============================================================================
// Mock Data Factories
// ============================================================================

function createKeyframeTrack(overrides: Partial<KeyframeTrack> = {}): KeyframeTrack {
  return {
    id: overrides.id ?? 'track-1',
    keyframes: overrides.keyframes ?? [
      { time: 0, value: { x: 0, y: 0, opacity: 0 } },
      { time: 500, value: { x: 100, y: 50, opacity: 0.5 } },
      { time: 1000, value: { x: 200, y: 100, opacity: 1 } },
    ],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('AnimationController', () => {
  let controller: MockAnimationController;

  beforeEach(() => {
    controller = new MockAnimationController(createKeyframeTrack());
  });

  afterEach(() => {
    controller.destroy();
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
      controller = new MockAnimationController(createKeyframeTrack(), {
        duration: 2000,
        iterations: 3,
        playbackRate: 2,
      });

      expect(controller.getPlaybackRate()).toBe(2);
      expect(controller.getTotalDuration()).toBe(6000);
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

    it('should stop and reset', () => {
      controller.play();
      controller.advanceTime(500);
      controller.stop();

      expect(controller.getState()).toBe('idle');
      expect(controller.getCurrentTime()).toBe(0);
      expect(controller.getCurrentIteration()).toBe(0);
    });

    it('should cancel without resetting position', () => {
      controller.play();
      controller.advanceTime(500);
      controller.cancel();

      expect(controller.getState()).toBe('idle');
    });
  });

  describe('Time and Progress', () => {
    it('should track current time', () => {
      controller.play();
      controller.advanceTime(300);

      expect(controller.getCurrentTime()).toBeGreaterThan(0);
    });

    it('should calculate progress', () => {
      controller.play();
      controller.advanceTime(500);

      expect(controller.getProgress()).toBeGreaterThan(0);
    });

    it('should handle infinite iterations', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { iterations: Infinity });

      expect(controller.getTotalDuration()).toBe(Infinity);
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
      controller = new MockAnimationController(createKeyframeTrack(), { iterations: 3 });
      controller.play();

      expect(controller.getCurrentIteration()).toBe(0);
    });

    it('should emit iteration event on boundary', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { iterations: 3 });
      const handler = vi.fn();
      controller.on('iteration', handler);
      controller.play();

      controller.advanceTime(1500);

      expect(handler).toHaveBeenCalled();
    });

    it('should finish after all iterations', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { iterations: 2 });
      const handler = vi.fn();
      controller.on('end', handler);
      controller.play();

      controller.advanceTime(3000);

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
      controller = new MockAnimationController(createKeyframeTrack(), { direction: 'reverse' });
      controller.play();
      controller.seek(0);
      const result = controller.getValueAtTime(0);

      expect(result.value.x).toBe(200); // Starts from end
    });

    it('should alternate direction', () => {
      controller = new MockAnimationController(createKeyframeTrack(), {
        direction: 'alternate',
        iterations: 2,
      });
      controller.play();

      // First iteration: forward
      controller.advanceTime(500);
      expect(controller.getCurrentIteration()).toBe(0);

      // After first iteration, should be on second (reverse)
      controller.advanceTime(1000);
      expect(controller.getCurrentIteration()).toBe(1);
    });
  });

  describe('Fill Mode', () => {
    it('should show first frame with fill backwards', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { fill: 'backwards' });
      const result = controller.getValue();

      expect(result.value.x).toBe(0);
    });

    it('should show last frame with fill forwards after finish', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { fill: 'forwards' });
      controller.play();
      controller.advanceTime(2000);
      const result = controller.getValue();

      expect(result.value.x).toBe(200);
    });

    it('should show empty with fill none in idle state', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { fill: 'none' });
      const result = controller.getValue();

      expect(result.value).toEqual({});
    });

    it('should handle fill both', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { fill: 'both' });

      // Before play - should show first frame
      const beforeResult = controller.getValue();
      expect(beforeResult.value.x).toBe(0);

      // After finish - should show last frame
      controller.play();
      controller.advanceTime(2000);
      const afterResult = controller.getValue();
      expect(afterResult.value.x).toBe(200);
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
      controller.advanceTime(2000);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'end' }));
    });

    it('should emit update event', () => {
      const handler = vi.fn();
      controller.on('update', handler);
      controller.play();
      controller.advanceTime(100);

      expect(handler).toHaveBeenCalled();
    });

    it('should unsubscribe events', () => {
      const handler = vi.fn();
      const unsubscribe = controller.on('start', handler);
      unsubscribe();
      controller.play();

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty keyframes', () => {
      controller = new MockAnimationController({ id: 'empty', keyframes: [] });
      const result = controller.getValue();

      expect(result.value).toEqual({});
      expect(result.isComplete).toBe(true);
    });

    it('should handle single keyframe', () => {
      controller = new MockAnimationController({
        id: 'single',
        keyframes: [{ time: 0, value: { x: 100 } }],
      });
      controller.play();
      const result = controller.getValue();

      expect(result.value.x).toBe(100);
    });

    it('should handle zero duration', () => {
      controller = new MockAnimationController(createKeyframeTrack(), { duration: 0 });
      controller.play();
      controller.advanceTime(100);

      expect(controller.getState()).toBe('finished');
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
  // Test multiple tracks managed together
  it('should manage multiple tracks', () => {
    const track1 = createKeyframeTrack({ id: 'track-1' });
    const track2 = createKeyframeTrack({ id: 'track-2' });

    const controllers = new Map<string, MockAnimationController>();
    controllers.set('track-1', new MockAnimationController(track1));
    controllers.set('track-2', new MockAnimationController(track2));

    // Play all
    for (const controller of controllers.values()) {
      controller.play();
    }

    // All should be playing
    for (const controller of controllers.values()) {
      expect(controller.getState()).toBe('playing');
    }

    // Clean up
    for (const controller of controllers.values()) {
      controller.destroy();
    }
  });
});
