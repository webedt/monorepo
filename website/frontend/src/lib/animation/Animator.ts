/**
 * Animator - Unified animation playback for frame and bone animations
 *
 * Provides a single interface for playing both frame-based (sprite/flipbook)
 * and bone-based (skeletal) animations with support for:
 * - Play, pause, stop, and seek controls
 * - Playback speed adjustment
 * - Looping and ping-pong modes
 * - Event callbacks for animation state changes
 * - Multiple animation clips
 */

import type {
  Animation,
  AnimationClip,
  AnimationFrame,
  BoneAnimation,
  BoneKeyframe,
  BoneTransform,
  FrameAnimation,
  Vector2,
} from '../../types/index.js';

export type AnimatorState = 'idle' | 'playing' | 'paused' | 'finished';

export interface AnimatorEvent {
  type: 'play' | 'pause' | 'stop' | 'finish' | 'loop' | 'frame' | 'update';
  currentTime: number;
  progress: number;
  state: AnimatorState;
  /** Current frame index (for frame animations) */
  frameIndex?: number;
  /** Current clip name */
  clipName?: string;
}

export type AnimatorEventHandler = (event: AnimatorEvent) => void;

export interface FrameResult {
  type: 'frame';
  frame: AnimationFrame;
  frameIndex: number;
  progress: number;
}

export interface BoneResult {
  type: 'bone';
  pose: Record<string, BoneTransform>;
  progress: number;
}

export type AnimatorResult = FrameResult | BoneResult | null;

/**
 * Animator class for playing frame and bone animations
 */
export class Animator {
  private clips: Map<string, AnimationClip> = new Map();
  private currentClipName: string | null = null;
  private state: AnimatorState = 'idle';
  private currentTime = 0;
  private playbackSpeed = 1;
  private startTime: number | null = null;
  private pausedAt: number | null = null;
  private rafId: number | null = null;
  private eventHandlers: Map<AnimatorEvent['type'], Set<AnimatorEventHandler>> = new Map();
  private lastFrameIndex = -1;
  private isReversing = false; // For ping-pong mode

  constructor() {}

  /**
   * Adds an animation clip to the animator
   */
  addClip(name: string, animation: Animation, options: { speed?: number; loop?: boolean } = {}): void {
    this.clips.set(name, {
      name,
      animation,
      speed: options.speed,
      loop: options.loop,
    });
  }

  /**
   * Removes an animation clip
   */
  removeClip(name: string): void {
    if (this.currentClipName === name) {
      this.stop();
    }
    this.clips.delete(name);
  }

  /**
   * Gets all clip names
   */
  getClipNames(): string[] {
    return Array.from(this.clips.keys());
  }

  /**
   * Gets a specific clip
   */
  getClip(name: string): AnimationClip | undefined {
    return this.clips.get(name);
  }

  /**
   * Gets the current clip
   */
  getCurrentClip(): AnimationClip | null {
    if (!this.currentClipName) return null;
    return this.clips.get(this.currentClipName) ?? null;
  }

  /**
   * Gets the current animator state
   */
  getState(): AnimatorState {
    return this.state;
  }

  /**
   * Gets the current playback time in seconds
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Gets the duration of the current clip in seconds
   */
  getDuration(): number {
    const clip = this.getCurrentClip();
    if (!clip) return 0;
    return this.getAnimationDuration(clip.animation);
  }

  /**
   * Gets the current progress (0-1) through the animation
   */
  getProgress(): number {
    const duration = this.getDuration();
    if (duration <= 0) return 0;
    return Math.min(this.currentTime / duration, 1);
  }

  /**
   * Sets the playback speed multiplier
   */
  setSpeed(speed: number): void {
    this.playbackSpeed = Math.max(0.1, speed);
  }

  /**
   * Gets the playback speed multiplier
   */
  getSpeed(): number {
    return this.playbackSpeed;
  }

  /**
   * Plays an animation clip by name
   */
  play(clipName?: string): void {
    if (clipName) {
      if (!this.clips.has(clipName)) {
        console.warn(`Animator: clip "${clipName}" not found`);
        return;
      }
      if (this.currentClipName !== clipName) {
        this.currentClipName = clipName;
        this.currentTime = 0;
        this.lastFrameIndex = -1;
        this.isReversing = false;
      }
    }

    if (!this.currentClipName) {
      // Auto-select first clip if none specified
      const firstClip = this.clips.keys().next().value;
      if (!firstClip) {
        console.warn('Animator: no clips available');
        return;
      }
      this.currentClipName = firstClip;
    }

    if (this.state === 'playing') return;

    if (this.state === 'finished') {
      this.currentTime = 0;
      this.lastFrameIndex = -1;
      this.isReversing = false;
    }

    if (this.state === 'paused' && this.pausedAt !== null) {
      this.startTime = performance.now() - this.pausedAt;
      this.pausedAt = null;
    } else {
      this.startTime = performance.now() - (this.currentTime * 1000 / this.getEffectiveSpeed());
    }

    this.state = 'playing';
    this.emit('play');
    this.scheduleUpdate();
  }

  /**
   * Pauses playback
   */
  pause(): void {
    if (this.state !== 'playing') return;

    this.pausedAt = performance.now() - (this.startTime ?? 0);
    this.state = 'paused';

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.emit('pause');
  }

  /**
   * Stops playback and resets to the beginning
   */
  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.state = 'idle';
    this.currentTime = 0;
    this.startTime = null;
    this.pausedAt = null;
    this.lastFrameIndex = -1;
    this.isReversing = false;

    this.emit('stop');
  }

  /**
   * Seeks to a specific time position in seconds
   */
  seek(time: number): void {
    const duration = this.getDuration();
    this.currentTime = Math.max(0, Math.min(time, duration));

    if (this.state === 'paused') {
      this.pausedAt = this.currentTime * 1000 / this.getEffectiveSpeed();
    } else if (this.state === 'playing') {
      this.startTime = performance.now() - (this.currentTime * 1000 / this.getEffectiveSpeed());
    }

    // Recalculate frame index for frame animations
    this.updateFrameIndex();
    this.emit('update');
  }

  /**
   * Seeks to a progress position (0-1)
   */
  seekProgress(progress: number): void {
    const duration = this.getDuration();
    this.seek(Math.max(0, Math.min(1, progress)) * duration);
  }

  /**
   * Steps forward by one frame (for frame animations) or a small time step (for bone)
   */
  stepForward(): void {
    const clip = this.getCurrentClip();
    if (!clip) return;

    if (clip.animation.type === 'frame') {
      const frameDuration = 1 / clip.animation.fps;
      this.seek(this.currentTime + frameDuration);
    } else {
      // For bone animations, step by 1/30th of a second
      this.seek(this.currentTime + 1 / 30);
    }
  }

  /**
   * Steps backward by one frame (for frame animations) or a small time step (for bone)
   */
  stepBackward(): void {
    const clip = this.getCurrentClip();
    if (!clip) return;

    if (clip.animation.type === 'frame') {
      const frameDuration = 1 / clip.animation.fps;
      this.seek(this.currentTime - frameDuration);
    } else {
      this.seek(this.currentTime - 1 / 30);
    }
  }

  /**
   * Gets the current animation result (frame or bone pose)
   */
  getValue(): AnimatorResult {
    const clip = this.getCurrentClip();
    if (!clip) return null;

    if (clip.animation.type === 'frame') {
      return this.getFrameValue(clip.animation);
    } else {
      return this.getBoneValue(clip.animation);
    }
  }

  /**
   * Gets the current frame index (for frame animations)
   */
  getCurrentFrameIndex(): number {
    const clip = this.getCurrentClip();
    if (!clip || clip.animation.type !== 'frame') return -1;

    return this.calculateFrameIndex(clip.animation);
  }

  /**
   * Registers an event handler
   */
  on(event: AnimatorEvent['type'], handler: AnimatorEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * Removes an event handler
   */
  off(event: AnimatorEvent['type'], handler: AnimatorEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Cleans up resources
   */
  destroy(): void {
    this.stop();
    this.eventHandlers.clear();
    this.clips.clear();
  }

  // Private methods

  private getEffectiveSpeed(): number {
    const clip = this.getCurrentClip();
    const clipSpeed = clip?.speed ?? 1;
    return this.playbackSpeed * clipSpeed;
  }

  private getAnimationDuration(animation: Animation): number {
    if (animation.type === 'frame') {
      return this.getFrameAnimationDuration(animation);
    } else {
      return animation.duration;
    }
  }

  private getFrameAnimationDuration(animation: FrameAnimation): number {
    const defaultFrameDuration = 1 / animation.fps;
    let duration = 0;

    for (const frame of animation.frames) {
      duration += frame.duration ?? defaultFrameDuration;
    }

    return duration;
  }

  private getFrameValue(animation: FrameAnimation): FrameResult {
    const frameIndex = this.calculateFrameIndex(animation);
    const frame = animation.frames[frameIndex] ?? animation.frames[0];

    return {
      type: 'frame',
      frame,
      frameIndex,
      progress: this.getProgress(),
    };
  }

  private calculateFrameIndex(animation: FrameAnimation): number {
    if (animation.frames.length === 0) return 0;

    const defaultFrameDuration = 1 / animation.fps;
    let time = this.currentTime;

    // Handle ping-pong
    if (animation.pingPong && this.isReversing) {
      const duration = this.getFrameAnimationDuration(animation);
      time = duration - time;
    }

    let accumulated = 0;
    for (let i = 0; i < animation.frames.length; i++) {
      const frameDuration = animation.frames[i].duration ?? defaultFrameDuration;
      accumulated += frameDuration;
      if (time < accumulated) {
        return i;
      }
    }

    return animation.frames.length - 1;
  }

  private getBoneValue(animation: BoneAnimation): BoneResult {
    const pose = this.interpolateBonePose(animation);

    return {
      type: 'bone',
      pose,
      progress: this.getProgress(),
    };
  }

  private interpolateBonePose(animation: BoneAnimation): Record<string, BoneTransform> {
    const pose: Record<string, BoneTransform> = {};
    const { keyframes, bones } = animation;

    if (keyframes.length === 0) {
      // Return default transforms
      for (const bone of bones) {
        pose[bone.name] = { ...bone.localTransform };
      }
      return pose;
    }

    // Find surrounding keyframes
    let prevKeyframe: BoneKeyframe | null = null;
    let nextKeyframe: BoneKeyframe | null = null;

    for (let i = 0; i < keyframes.length; i++) {
      if (keyframes[i].time <= this.currentTime) {
        prevKeyframe = keyframes[i];
      }
      if (keyframes[i].time >= this.currentTime && !nextKeyframe) {
        nextKeyframe = keyframes[i];
      }
    }

    // Handle edge cases
    if (!prevKeyframe && nextKeyframe) {
      prevKeyframe = nextKeyframe;
    }
    if (!nextKeyframe && prevKeyframe) {
      nextKeyframe = prevKeyframe;
    }
    if (!prevKeyframe || !nextKeyframe) {
      // No keyframes, return default transforms
      for (const bone of bones) {
        pose[bone.name] = { ...bone.localTransform };
      }
      return pose;
    }

    // Calculate interpolation factor
    let t = 0;
    if (prevKeyframe !== nextKeyframe) {
      const segmentDuration = nextKeyframe.time - prevKeyframe.time;
      t = segmentDuration > 0
        ? (this.currentTime - prevKeyframe.time) / segmentDuration
        : 0;
    }

    // Interpolate each bone
    for (const bone of bones) {
      const prevTransform = prevKeyframe.transforms[bone.name] ?? bone.localTransform;
      const nextTransform = nextKeyframe.transforms[bone.name] ?? bone.localTransform;
      pose[bone.name] = this.lerpTransform(prevTransform, nextTransform, t);
    }

    return pose;
  }

  private lerpTransform(a: BoneTransform, b: BoneTransform, t: number): BoneTransform {
    return {
      position: this.lerpVector2(a.position, b.position, t),
      rotation: this.lerpAngle(a.rotation, b.rotation, t),
      scale: this.lerpVector2(a.scale, b.scale, t),
    };
  }

  private lerpVector2(a: Vector2, b: Vector2, t: number): Vector2 {
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
    };
  }

  private lerpAngle(a: number, b: number, t: number): number {
    let diff = b - a;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    return a + diff * t;
  }

  private updateFrameIndex(): void {
    const clip = this.getCurrentClip();
    if (!clip || clip.animation.type !== 'frame') return;

    const newFrameIndex = this.calculateFrameIndex(clip.animation);
    if (newFrameIndex !== this.lastFrameIndex) {
      this.lastFrameIndex = newFrameIndex;
      this.emit('frame');
    }
  }

  private scheduleUpdate(): void {
    this.rafId = requestAnimationFrame((timestamp) => this.update(timestamp));
  }

  private update(timestamp: number): void {
    if (this.state !== 'playing' || this.startTime === null) return;

    const clip = this.getCurrentClip();
    if (!clip) {
      this.stop();
      return;
    }

    // Calculate elapsed time with speed
    const rawElapsed = timestamp - this.startTime;
    const elapsed = (rawElapsed * this.getEffectiveSpeed()) / 1000; // Convert to seconds
    const duration = this.getDuration();

    // Handle looping
    const shouldLoop = clip.loop ?? clip.animation.loop;

    if (elapsed >= duration) {
      if (shouldLoop) {
        // Handle ping-pong mode
        if (clip.animation.type === 'frame' && (clip.animation as FrameAnimation).pingPong) {
          this.isReversing = !this.isReversing;
        }

        // Reset for loop
        this.startTime = timestamp;
        this.currentTime = 0;
        this.emit('loop');
      } else {
        this.currentTime = duration;
        this.state = 'finished';

        if (this.rafId !== null) {
          cancelAnimationFrame(this.rafId);
          this.rafId = null;
        }

        this.emit('finish');
        return;
      }
    } else {
      this.currentTime = elapsed;
    }

    // Check for frame changes
    this.updateFrameIndex();

    this.emit('update');
    this.scheduleUpdate();
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

/**
 * Creates an Animator with pre-loaded clips
 */
export function createAnimator(
  clips: Array<{ name: string; animation: Animation; speed?: number; loop?: boolean }>
): Animator {
  const animator = new Animator();

  for (const clip of clips) {
    animator.addClip(clip.name, clip.animation, {
      speed: clip.speed,
      loop: clip.loop,
    });
  }

  return animator;
}
