/**
 * Tests for Animator class
 *
 * Tests animation playback, clip management, and event handling
 * for frame-based and bone animations using the actual Animator implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Animator, createAnimator } from '../../../src/lib/animation/Animator.js';
import type { AnimatorEvent, AnimatorState } from '../../../src/lib/animation/Animator.js';
import type {
  Animation,
  FrameAnimation,
  BoneAnimation,
  AnimationFrame,
  Bone,
  BoneKeyframe,
  BoneTransform,
  Vector2,
} from '../../../src/types/index.js';

// ============================================================================
// Mock Data Factories
// ============================================================================

function createBoneTransform(overrides: Partial<BoneTransform> = {}): BoneTransform {
  return {
    position: overrides.position ?? { x: 0, y: 0 },
    rotation: overrides.rotation ?? 0,
    scale: overrides.scale ?? { x: 1, y: 1 },
  };
}

function createBone(overrides: Partial<Bone> = {}): Bone {
  return {
    name: overrides.name ?? 'root',
    parent: overrides.parent ?? null,
    length: overrides.length ?? 50,
    localTransform: overrides.localTransform ?? createBoneTransform(),
  };
}

function createAnimationFrame(overrides: Partial<AnimationFrame> = {}): AnimationFrame {
  return {
    source: overrides.source ?? 'frame1.png',
    duration: overrides.duration,
    offset: overrides.offset,
    pivot: overrides.pivot,
  };
}

function createFrameAnimation(overrides: Partial<FrameAnimation> = {}): FrameAnimation {
  return {
    name: overrides.name ?? 'walk',
    type: 'frame',
    fps: overrides.fps ?? 12,
    frames: overrides.frames ?? [
      createAnimationFrame({ source: 'frame1.png' }),
      createAnimationFrame({ source: 'frame2.png' }),
      createAnimationFrame({ source: 'frame3.png' }),
    ],
    loop: overrides.loop ?? false,
    pingPong: overrides.pingPong,
  };
}

function createBoneAnimation(overrides: Partial<BoneAnimation> = {}): BoneAnimation {
  const bones = overrides.bones ?? [createBone({ name: 'root' })];
  return {
    name: overrides.name ?? 'idle',
    type: 'bone',
    fps: overrides.fps ?? 30,
    duration: overrides.duration ?? 1, // 1 second
    bones,
    keyframes: overrides.keyframes ?? [
      {
        time: 0,
        transforms: {
          root: createBoneTransform({ position: { x: 0, y: 0 } }),
        },
      },
      {
        time: 1,
        transforms: {
          root: createBoneTransform({ position: { x: 100, y: 50 }, rotation: 45 }),
        },
      },
    ],
    loop: overrides.loop ?? false,
  };
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

describe('Animator', () => {
  let animator: Animator;

  beforeEach(() => {
    setupAnimationFrameMocks();
    animator = new Animator();
  });

  afterEach(() => {
    animator.destroy();
    vi.unstubAllGlobals();
  });

  describe('Clip Management', () => {
    it('should add clips', () => {
      animator.addClip('walk', createFrameAnimation());

      expect(animator.getClipNames()).toContain('walk');
      expect(animator.getClip('walk')).toBeDefined();
    });

    it('should add multiple clips', () => {
      animator.addClip('walk', createFrameAnimation());
      animator.addClip('run', createFrameAnimation({ fps: 24 }));
      animator.addClip('idle', createBoneAnimation());

      expect(animator.getClipNames().length).toBe(3);
    });

    it('should remove clips', () => {
      animator.addClip('walk', createFrameAnimation());
      animator.addClip('run', createFrameAnimation());

      animator.removeClip('walk');

      expect(animator.getClipNames()).not.toContain('walk');
      expect(animator.getClipNames()).toContain('run');
    });

    it('should stop when removing current clip', () => {
      animator.addClip('walk', createFrameAnimation());
      animator.play('walk');

      animator.removeClip('walk');

      expect(animator.getState()).toBe('idle');
    });

    it('should return undefined for non-existent clip', () => {
      expect(animator.getClip('nonexistent')).toBeUndefined();
    });
  });

  describe('Playback Control', () => {
    beforeEach(() => {
      animator.addClip('test', createFrameAnimation());
    });

    it('should start in idle state', () => {
      expect(animator.getState()).toBe('idle');
    });

    it('should transition to playing state on play()', () => {
      animator.play();

      expect(animator.getState()).toBe('playing');
    });

    it('should play specific clip by name', () => {
      animator.addClip('other', createFrameAnimation({ fps: 24 }));
      animator.play('other');

      expect(animator.getCurrentClip()?.name).toBe('other');
    });

    it('should auto-select first clip if none specified', () => {
      animator.play();

      expect(animator.getCurrentClip()).not.toBeNull();
    });

    it('should pause playback', () => {
      animator.play();
      animator.pause();

      expect(animator.getState()).toBe('paused');
    });

    it('should not pause if not playing', () => {
      animator.pause();

      expect(animator.getState()).toBe('idle');
    });

    it('should stop and reset', () => {
      animator.play();
      advanceTime(100);
      animator.stop();

      expect(animator.getState()).toBe('idle');
      expect(animator.getCurrentTime()).toBe(0);
    });

    it('should resume after pause', () => {
      animator.play();
      advanceTime(50);
      animator.pause();
      animator.play();

      expect(animator.getState()).toBe('playing');
    });

    it('should not play if already playing', () => {
      const handler = vi.fn();
      animator.on('play', handler);

      animator.play();
      animator.play(); // Second call should be ignored

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('Time and Progress', () => {
    beforeEach(() => {
      // 3 frames @ 10fps = 0.3s duration
      animator.addClip('test', createFrameAnimation({ fps: 10 }));
    });

    it('should track current time', () => {
      animator.play();
      advanceTime(100);

      expect(animator.getCurrentTime()).toBeGreaterThan(0);
    });

    it('should seek to specific time', () => {
      animator.play();
      animator.seek(0.2);

      expect(animator.getCurrentTime()).toBeCloseTo(0.2, 2);
    });

    it('should clamp seek to duration', () => {
      animator.play();
      animator.seek(10);

      expect(animator.getCurrentTime()).toBeLessThanOrEqual(animator.getDuration());
    });

    it('should seek by progress', () => {
      animator.play();
      animator.seekProgress(0.5);

      expect(animator.getProgress()).toBeCloseTo(0.5, 1);
    });
  });

  describe('Speed Control', () => {
    beforeEach(() => {
      animator.addClip('test', createFrameAnimation());
    });

    it('should default to speed 1', () => {
      expect(animator.getSpeed()).toBe(1);
    });

    it('should change speed', () => {
      animator.setSpeed(2);

      expect(animator.getSpeed()).toBe(2);
    });

    it('should clamp minimum speed', () => {
      animator.setSpeed(0.01);

      expect(animator.getSpeed()).toBeGreaterThanOrEqual(0.1);
    });

    it('should apply clip speed multiplier', () => {
      animator.addClip('fast', createFrameAnimation(), { speed: 2 });
      animator.play('fast');
      advanceTime(100);

      expect(animator.getCurrentTime()).toBeGreaterThan(0);
    });
  });

  describe('Looping', () => {
    it('should loop when animation has loop=true', () => {
      animator.addClip('test', createFrameAnimation({ loop: true }));
      animator.play();

      const duration = animator.getDuration();
      advanceTime((duration + 0.1) * 1000);

      expect(animator.getState()).toBe('playing');
      expect(animator.getCurrentTime()).toBeLessThan(duration);
    });

    it('should finish when not looping', () => {
      animator.addClip('test', createFrameAnimation({ loop: false }));
      animator.play();

      const duration = animator.getDuration();
      advanceTime((duration + 0.5) * 1000);

      expect(animator.getState()).toBe('finished');
    });

    it('should respect clip-level loop override', () => {
      animator.addClip('test', createFrameAnimation({ loop: false }), { loop: true });
      animator.play();

      const duration = animator.getDuration();
      advanceTime((duration + 0.1) * 1000);

      expect(animator.getState()).toBe('playing');
    });
  });

  describe('Event Handling', () => {
    beforeEach(() => {
      animator.addClip('test', createFrameAnimation());
    });

    it('should emit play event', () => {
      const handler = vi.fn();
      animator.on('play', handler);
      animator.play();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'play' }));
    });

    it('should emit pause event', () => {
      const handler = vi.fn();
      animator.on('pause', handler);
      animator.play();
      animator.pause();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'pause' }));
    });

    it('should emit stop event', () => {
      const handler = vi.fn();
      animator.on('stop', handler);
      animator.play();
      animator.stop();

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'stop' }));
    });

    it('should emit finish event', () => {
      animator.addClip('short', createFrameAnimation({ loop: false }));
      const handler = vi.fn();
      animator.on('finish', handler);
      animator.play('short');

      advanceTime(1000);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'finish' }));
    });

    it('should emit loop event', () => {
      animator.addClip('loop', createFrameAnimation({ loop: true }));
      const handler = vi.fn();
      animator.on('loop', handler);
      animator.play('loop');

      const duration = animator.getDuration();
      advanceTime((duration + 0.1) * 1000);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'loop' }));
    });

    it('should emit update event', () => {
      const handler = vi.fn();
      animator.on('update', handler);
      animator.play();
      advanceTime(16);

      expect(handler).toHaveBeenCalled();
    });

    it('should unsubscribe with returned function', () => {
      const handler = vi.fn();
      const unsubscribe = animator.on('play', handler);
      unsubscribe();
      animator.play();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should unsubscribe with off()', () => {
      const handler = vi.fn();
      animator.on('play', handler);
      animator.off('play', handler);
      animator.play();

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle errors in event handlers gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Test error');
      });
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

      animator.on('play', errorHandler);
      animator.play();

      expect(errorHandler).toHaveBeenCalled();
      expect(consoleError).toHaveBeenCalled();
      consoleError.mockRestore();
    });
  });

  describe('Frame Animation', () => {
    it('should get current frame value', () => {
      animator.addClip('test', createFrameAnimation());
      animator.play();

      const result = animator.getValue();

      expect(result).not.toBeNull();
      expect(result?.type).toBe('frame');
      if (result?.type === 'frame') {
        expect(result.frame).toBeDefined();
        expect(result.frameIndex).toBeGreaterThanOrEqual(0);
      }
    });

    it('should get current frame index', () => {
      animator.addClip('test', createFrameAnimation());
      animator.play();

      const frameIndex = animator.getCurrentFrameIndex();

      expect(frameIndex).toBeGreaterThanOrEqual(0);
    });

    it('should step forward', () => {
      animator.addClip('test', createFrameAnimation({ fps: 10 }));
      animator.play();

      const timeBefore = animator.getCurrentTime();
      animator.stepForward();

      expect(animator.getCurrentTime()).toBeGreaterThan(timeBefore);
    });

    it('should step backward', () => {
      animator.addClip('test', createFrameAnimation({ fps: 10 }));
      animator.play();
      animator.seek(0.2);

      const timeBefore = animator.getCurrentTime();
      animator.stepBackward();

      expect(animator.getCurrentTime()).toBeLessThan(timeBefore);
    });

    it('should return null for getValue when no clip selected', () => {
      const result = animator.getValue();

      expect(result).toBeNull();
    });
  });

  describe('Bone Animation', () => {
    it('should handle bone animations', () => {
      animator.addClip('bone', createBoneAnimation());
      animator.play('bone');

      expect(animator.getState()).toBe('playing');
      expect(animator.getCurrentClip()?.animation.type).toBe('bone');
    });

    it('should calculate bone animation duration', () => {
      animator.addClip('bone', createBoneAnimation({ duration: 2 }));
      animator.play('bone');

      expect(animator.getDuration()).toBe(2);
    });

    it('should get bone pose value', () => {
      animator.addClip('bone', createBoneAnimation());
      animator.play('bone');

      const result = animator.getValue();

      expect(result).not.toBeNull();
      expect(result?.type).toBe('bone');
      if (result?.type === 'bone') {
        expect(result.pose).toBeDefined();
        expect(result.pose.root).toBeDefined();
      }
    });

    it('should interpolate bone transforms', () => {
      animator.addClip('bone', createBoneAnimation({
        duration: 1,
        keyframes: [
          { time: 0, transforms: { root: createBoneTransform({ position: { x: 0, y: 0 } }) } },
          { time: 1, transforms: { root: createBoneTransform({ position: { x: 100, y: 0 } }) } },
        ],
      }));
      animator.play('bone');
      animator.seek(0.5);

      const result = animator.getValue();
      if (result?.type === 'bone') {
        expect(result.pose.root.position.x).toBeCloseTo(50, 0);
      }
    });

    it('should return -1 for frame index on bone animation', () => {
      animator.addClip('bone', createBoneAnimation());
      animator.play('bone');

      expect(animator.getCurrentFrameIndex()).toBe(-1);
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      animator.addClip('test', createFrameAnimation());

      animator.destroy();

      expect(animator.getClipNames().length).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty animation', () => {
      animator.addClip('empty', createFrameAnimation({ frames: [] }));
      animator.play('empty');

      expect(animator.getDuration()).toBe(0);
    });

    it('should handle single frame animation', () => {
      animator.addClip('single', createFrameAnimation({
        frames: [createAnimationFrame({ source: 'single.png' })],
      }));
      animator.play('single');

      expect(animator.getDuration()).toBeGreaterThan(0);
    });

    it('should warn when playing non-existent clip', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      animator.play('nonexistent');

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should warn when no clips available', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      animator.play();

      expect(warnSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });

    it('should handle custom frame durations', () => {
      animator.addClip('custom', createFrameAnimation({
        fps: 10,
        frames: [
          createAnimationFrame({ source: 'frame1.png', duration: 0.5 }),
          createAnimationFrame({ source: 'frame2.png', duration: 0.3 }),
        ],
      }));
      animator.play('custom');

      expect(animator.getDuration()).toBeCloseTo(0.8);
    });

    it('should return 0 duration when no clip selected', () => {
      expect(animator.getDuration()).toBe(0);
    });

    it('should return 0 progress when no clip selected', () => {
      expect(animator.getProgress()).toBe(0);
    });

    it('should handle bone animation with no keyframes', () => {
      animator.addClip('empty', createBoneAnimation({ keyframes: [] }));
      animator.play('empty');

      const result = animator.getValue();
      expect(result).not.toBeNull();
    });
  });

  describe('createAnimator helper', () => {
    it('should create animator with clips', () => {
      const anim = createAnimator([
        { name: 'walk', animation: createFrameAnimation() },
        { name: 'run', animation: createFrameAnimation({ fps: 24 }) },
      ]);

      expect(anim.getClipNames()).toHaveLength(2);
      expect(anim.getClipNames()).toContain('walk');
      expect(anim.getClipNames()).toContain('run');

      anim.destroy();
    });

    it('should apply clip options', () => {
      const anim = createAnimator([
        { name: 'test', animation: createFrameAnimation(), speed: 2, loop: true },
      ]);

      const clip = anim.getClip('test');
      expect(clip?.speed).toBe(2);
      expect(clip?.loop).toBe(true);

      anim.destroy();
    });
  });

  describe('Ping-Pong Animation', () => {
    it('should handle ping-pong mode', () => {
      animator.addClip('pingpong', createFrameAnimation({
        pingPong: true,
        loop: true,
      }));
      animator.play('pingpong');

      advanceTime(500);
      expect(animator.getState()).toBe('playing');
    });
  });

  describe('Reset on Finished', () => {
    it('should reset to beginning when playing after finished', () => {
      animator.addClip('test', createFrameAnimation({ loop: false }));
      animator.play();

      advanceTime(1000);
      expect(animator.getState()).toBe('finished');

      animator.play();
      expect(animator.getState()).toBe('playing');
      expect(animator.getCurrentTime()).toBe(0);
    });
  });
});
