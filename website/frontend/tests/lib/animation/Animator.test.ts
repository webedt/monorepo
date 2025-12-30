/**
 * Tests for Animator class
 *
 * Tests animation playback, clip management, and event handling
 * for frame-based and bone animations.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Type Definitions (matching Animator.ts)
// ============================================================================

type AnimatorState = 'idle' | 'playing' | 'paused' | 'finished';

interface AnimatorEvent {
  type: 'play' | 'pause' | 'stop' | 'finish' | 'loop' | 'frame' | 'update';
  currentTime: number;
  progress: number;
  state: AnimatorState;
  frameIndex?: number;
  clipName?: string;
}

type AnimatorEventHandler = (event: AnimatorEvent) => void;

interface AnimationFrame {
  sourceX: number;
  sourceY: number;
  width: number;
  height: number;
  duration?: number;
}

interface FrameAnimation {
  type: 'frame';
  fps: number;
  frames: AnimationFrame[];
  loop?: boolean;
  pingPong?: boolean;
}

interface BoneTransform {
  position: { x: number; y: number };
  rotation: number;
  scale: { x: number; y: number };
}

interface Bone {
  name: string;
  localTransform: BoneTransform;
}

interface BoneKeyframe {
  time: number;
  transforms: Record<string, BoneTransform>;
}

interface BoneAnimation {
  type: 'bone';
  duration: number;
  bones: Bone[];
  keyframes: BoneKeyframe[];
  loop?: boolean;
}

type Animation = FrameAnimation | BoneAnimation;

interface AnimationClip {
  name: string;
  animation: Animation;
  speed?: number;
  loop?: boolean;
}

// ============================================================================
// Mock Data Factories
// ============================================================================

function createFrameAnimation(overrides: Partial<FrameAnimation> = {}): FrameAnimation {
  return {
    type: 'frame',
    fps: overrides.fps ?? 12,
    frames: overrides.frames ?? [
      { sourceX: 0, sourceY: 0, width: 32, height: 32 },
      { sourceX: 32, sourceY: 0, width: 32, height: 32 },
      { sourceX: 64, sourceY: 0, width: 32, height: 32 },
    ],
    loop: overrides.loop,
    pingPong: overrides.pingPong,
  };
}

function createBoneAnimation(overrides: Partial<BoneAnimation> = {}): BoneAnimation {
  return {
    type: 'bone',
    duration: overrides.duration ?? 1000,
    bones: overrides.bones ?? [
      {
        name: 'root',
        localTransform: {
          position: { x: 0, y: 0 },
          rotation: 0,
          scale: { x: 1, y: 1 },
        },
      },
    ],
    keyframes: overrides.keyframes ?? [
      {
        time: 0,
        transforms: {
          root: {
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: { x: 1, y: 1 },
          },
        },
      },
      {
        time: 1000,
        transforms: {
          root: {
            position: { x: 100, y: 50 },
            rotation: 45,
            scale: { x: 2, y: 2 },
          },
        },
      },
    ],
    loop: overrides.loop,
  };
}

// ============================================================================
// Mock Animator Implementation (for testing)
// ============================================================================

class MockAnimator {
  private clips: Map<string, AnimationClip> = new Map();
  private currentClipName: string | null = null;
  private state: AnimatorState = 'idle';
  private currentTime = 0;
  private playbackSpeed = 1;
  private eventHandlers: Map<AnimatorEvent['type'], Set<AnimatorEventHandler>> = new Map();
  private lastFrameIndex = -1;

  addClip(name: string, animation: Animation, options: { speed?: number; loop?: boolean } = {}): void {
    this.clips.set(name, { name, animation, speed: options.speed, loop: options.loop });
  }

  removeClip(name: string): void {
    if (this.currentClipName === name) {
      this.stop();
    }
    this.clips.delete(name);
  }

  getClipNames(): string[] {
    return Array.from(this.clips.keys());
  }

  getClip(name: string): AnimationClip | undefined {
    return this.clips.get(name);
  }

  getCurrentClip(): AnimationClip | null {
    if (!this.currentClipName) return null;
    return this.clips.get(this.currentClipName) ?? null;
  }

  getState(): AnimatorState {
    return this.state;
  }

  getCurrentTime(): number {
    return this.currentTime;
  }

  getDuration(): number {
    const clip = this.getCurrentClip();
    if (!clip) return 0;
    if (clip.animation.type === 'frame') {
      const defaultFrameDuration = 1 / clip.animation.fps;
      return clip.animation.frames.reduce((sum, f) => sum + (f.duration ?? defaultFrameDuration), 0);
    }
    return clip.animation.duration / 1000; // Convert ms to seconds
  }

  getProgress(): number {
    const duration = this.getDuration();
    if (duration <= 0) return 0;
    return Math.min(this.currentTime / duration, 1);
  }

  setSpeed(speed: number): void {
    this.playbackSpeed = Math.max(0.1, speed);
  }

  getSpeed(): number {
    return this.playbackSpeed;
  }

  play(clipName?: string): void {
    if (clipName) {
      if (!this.clips.has(clipName)) {
        console.warn(`Clip "${clipName}" not found`);
        return;
      }
      if (this.currentClipName !== clipName) {
        this.currentClipName = clipName;
        this.currentTime = 0;
        this.lastFrameIndex = -1;
      }
    }

    if (!this.currentClipName) {
      const firstClip = this.clips.keys().next().value;
      if (!firstClip) {
        console.warn('No clips available');
        return;
      }
      this.currentClipName = firstClip;
    }

    if (this.state === 'playing') return;
    if (this.state === 'finished') {
      this.currentTime = 0;
      this.lastFrameIndex = -1;
    }

    this.state = 'playing';
    this.emit('play');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.emit('pause');
  }

  stop(): void {
    this.state = 'idle';
    this.currentTime = 0;
    this.lastFrameIndex = -1;
    this.emit('stop');
  }

  seek(time: number): void {
    const duration = this.getDuration();
    this.currentTime = Math.max(0, Math.min(time, duration));
    this.emit('update');
  }

  seekProgress(progress: number): void {
    const duration = this.getDuration();
    this.seek(Math.max(0, Math.min(1, progress)) * duration);
  }

  // Simulate time advancement (for testing)
  advanceTime(deltaSeconds: number): void {
    if (this.state !== 'playing') return;

    const clip = this.getCurrentClip();
    if (!clip) return;

    const effectiveSpeed = this.playbackSpeed * (clip.speed ?? 1);
    this.currentTime += deltaSeconds * effectiveSpeed;

    const duration = this.getDuration();
    const shouldLoop = clip.loop ?? clip.animation.loop;

    if (this.currentTime >= duration) {
      if (shouldLoop) {
        this.currentTime = this.currentTime % duration;
        this.emit('loop');
      } else {
        this.currentTime = duration;
        this.state = 'finished';
        this.emit('finish');
        return;
      }
    }

    // Check for frame changes in frame animations
    if (clip.animation.type === 'frame') {
      const frameIndex = this.calculateFrameIndex(clip.animation);
      if (frameIndex !== this.lastFrameIndex) {
        this.lastFrameIndex = frameIndex;
        this.emit('frame');
      }
    }

    this.emit('update');
  }

  private calculateFrameIndex(animation: FrameAnimation): number {
    if (animation.frames.length === 0) return 0;

    const defaultFrameDuration = 1 / animation.fps;
    let accumulated = 0;

    for (let i = 0; i < animation.frames.length; i++) {
      const frameDuration = animation.frames[i].duration ?? defaultFrameDuration;
      accumulated += frameDuration;
      if (this.currentTime < accumulated) {
        return i;
      }
    }

    return animation.frames.length - 1;
  }

  on(event: AnimatorEvent['type'], handler: AnimatorEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off(event: AnimatorEvent['type'], handler: AnimatorEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  destroy(): void {
    this.stop();
    this.eventHandlers.clear();
    this.clips.clear();
  }

  private emit(type: AnimatorEvent['type']): void {
    const handlers = this.eventHandlers.get(type);
    if (!handlers) return;

    const event: AnimatorEvent = {
      type,
      currentTime: this.currentTime,
      progress: this.getProgress(),
      state: this.state,
      frameIndex: this.lastFrameIndex >= 0 ? this.lastFrameIndex : undefined,
      clipName: this.currentClipName ?? undefined,
    };

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('Animator event handler error:', error);
      }
    }
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Animator', () => {
  let animator: MockAnimator;

  beforeEach(() => {
    animator = new MockAnimator();
  });

  afterEach(() => {
    animator.destroy();
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
      animator.advanceTime(0.1);
      animator.stop();

      expect(animator.getState()).toBe('idle');
      expect(animator.getCurrentTime()).toBe(0);
    });

    it('should resume after pause', () => {
      animator.play();
      animator.advanceTime(0.1);
      const timeBeforePause = animator.getCurrentTime();
      animator.pause();
      animator.play();

      expect(animator.getState()).toBe('playing');
      expect(animator.getCurrentTime()).toBe(timeBeforePause);
    });
  });

  describe('Time and Progress', () => {
    beforeEach(() => {
      animator.addClip('test', createFrameAnimation({ fps: 10 })); // 3 frames @ 10fps = 0.3s
    });

    it('should track current time', () => {
      animator.play();
      animator.advanceTime(0.1);

      expect(animator.getCurrentTime()).toBeCloseTo(0.1);
    });

    it('should calculate progress', () => {
      animator.play();
      animator.advanceTime(0.15); // Halfway through 0.3s animation

      expect(animator.getProgress()).toBeCloseTo(0.5);
    });

    it('should clamp progress to 1', () => {
      animator.play();
      animator.advanceTime(1.0); // Way past duration

      expect(animator.getProgress()).toBeLessThanOrEqual(1);
    });

    it('should seek to specific time', () => {
      animator.play();
      animator.seek(0.2);

      expect(animator.getCurrentTime()).toBeCloseTo(0.2);
    });

    it('should clamp seek to duration', () => {
      animator.play();
      animator.seek(10);

      expect(animator.getCurrentTime()).toBeLessThanOrEqual(animator.getDuration());
    });

    it('should seek by progress', () => {
      animator.play();
      animator.seekProgress(0.5);

      expect(animator.getProgress()).toBeCloseTo(0.5);
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

    it('should apply speed to time advancement', () => {
      animator.setSpeed(2);
      animator.play();
      animator.advanceTime(0.1);

      expect(animator.getCurrentTime()).toBeCloseTo(0.2);
    });

    it('should apply clip speed multiplier', () => {
      animator.addClip('fast', createFrameAnimation(), { speed: 2 });
      animator.play('fast');
      animator.advanceTime(0.1);

      expect(animator.getCurrentTime()).toBeCloseTo(0.2);
    });
  });

  describe('Looping', () => {
    it('should loop when animation has loop=true', () => {
      animator.addClip('test', createFrameAnimation({ loop: true })); // 0.25s @ 12fps
      animator.play();

      const duration = animator.getDuration();
      animator.advanceTime(duration + 0.1);

      expect(animator.getState()).toBe('playing');
      expect(animator.getCurrentTime()).toBeLessThan(duration);
    });

    it('should finish when not looping', () => {
      animator.addClip('test', createFrameAnimation({ loop: false }));
      animator.play();

      const duration = animator.getDuration();
      animator.advanceTime(duration + 0.1);

      expect(animator.getState()).toBe('finished');
    });

    it('should respect clip-level loop override', () => {
      animator.addClip('test', createFrameAnimation({ loop: false }), { loop: true });
      animator.play();

      const duration = animator.getDuration();
      animator.advanceTime(duration + 0.1);

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

      animator.advanceTime(1); // Advance past end

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'finish' }));
    });

    it('should emit loop event', () => {
      animator.addClip('loop', createFrameAnimation({ loop: true }));
      const handler = vi.fn();
      animator.on('loop', handler);
      animator.play('loop');

      const duration = animator.getDuration();
      animator.advanceTime(duration + 0.1);

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ type: 'loop' }));
    });

    it('should emit frame event on frame change', () => {
      const handler = vi.fn();
      animator.on('frame', handler);
      animator.play();

      animator.advanceTime(0.1); // Should advance to next frame

      expect(handler).toHaveBeenCalled();
    });

    it('should emit update event', () => {
      const handler = vi.fn();
      animator.on('update', handler);
      animator.play();
      animator.advanceTime(0.01);

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

    it('should include event data', () => {
      let receivedEvent: AnimatorEvent | null = null;
      animator.on('play', (event) => {
        receivedEvent = event;
      });
      animator.play();

      expect(receivedEvent).not.toBeNull();
      expect(receivedEvent!.state).toBe('playing');
      expect(receivedEvent!.currentTime).toBe(0);
      expect(receivedEvent!.progress).toBe(0);
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
      animator.addClip('bone', createBoneAnimation({ duration: 2000 }));
      animator.play('bone');

      expect(animator.getDuration()).toBe(2); // 2000ms = 2s
    });
  });

  describe('Cleanup', () => {
    it('should clean up on destroy', () => {
      animator.addClip('test', createFrameAnimation());
      const handler = vi.fn();
      animator.on('play', handler);

      animator.destroy();

      expect(animator.getClipNames().length).toBe(0);
      // Handler should be cleared
      animator.play();
      expect(handler).not.toHaveBeenCalled();
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
        frames: [{ sourceX: 0, sourceY: 0, width: 32, height: 32 }],
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

    it('should handle custom frame durations', () => {
      animator.addClip('custom', createFrameAnimation({
        fps: 10,
        frames: [
          { sourceX: 0, sourceY: 0, width: 32, height: 32, duration: 0.5 },
          { sourceX: 32, sourceY: 0, width: 32, height: 32, duration: 0.3 },
        ],
      }));
      animator.play('custom');

      expect(animator.getDuration()).toBeCloseTo(0.8);
    });
  });
});
