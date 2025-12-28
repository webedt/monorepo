/**
 * Animation Controller
 * Provides playback control for keyframe-based animations
 */

import type { KeyframeTrack, TransformProperties, InterpolationResult } from './keyframe.js';
import { interpolateTrack, getTrackDuration } from './keyframe.js';

export type AnimationState = 'idle' | 'playing' | 'paused' | 'finished';

export type PlaybackDirection = 'forward' | 'reverse' | 'alternate' | 'alternate-reverse';

export interface AnimationOptions {
  /** Duration in milliseconds (overrides track duration) */
  duration?: number;
  /** Number of times to repeat (Infinity for infinite loop) */
  iterations?: number;
  /** Delay before animation starts in milliseconds */
  delay?: number;
  /** Playback direction */
  direction?: PlaybackDirection;
  /** Fill mode: what state to show when animation is not running */
  fill?: 'none' | 'forwards' | 'backwards' | 'both';
  /** Playback rate multiplier (1 = normal, 2 = double speed, 0.5 = half speed) */
  playbackRate?: number;
}

export interface AnimationEvent {
  type: 'start' | 'end' | 'iteration' | 'pause' | 'resume' | 'cancel' | 'update';
  currentTime: number;
  iteration: number;
  progress: number;
  state: AnimationState;
}

export type AnimationEventHandler = (event: AnimationEvent) => void;

/**
 * Controller for a single animation track
 */
export class AnimationController {
  private track: KeyframeTrack<TransformProperties>;
  private options: Required<AnimationOptions>;
  private state: AnimationState = 'idle';
  private currentTime = 0;
  private startTime: number | null = null;
  private pausedAt: number | null = null;
  private currentIteration = 0;
  private rafId: number | null = null;
  private eventHandlers: Map<AnimationEvent['type'], Set<AnimationEventHandler>> = new Map();
  private lastUpdateTime = 0;

  constructor(track: KeyframeTrack<TransformProperties>, options: AnimationOptions = {}) {
    this.track = track;

    const trackDuration = getTrackDuration(track);

    this.options = {
      duration: options.duration ?? trackDuration,
      iterations: options.iterations ?? 1,
      delay: options.delay ?? 0,
      direction: options.direction ?? 'forward',
      fill: options.fill ?? 'forwards',
      playbackRate: options.playbackRate ?? 1,
    };
  }

  /**
   * Gets the current animation state
   */
  getState(): AnimationState {
    return this.state;
  }

  /**
   * Gets the current time position in milliseconds
   */
  getCurrentTime(): number {
    return this.currentTime;
  }

  /**
   * Gets the current iteration count
   */
  getCurrentIteration(): number {
    return this.currentIteration;
  }

  /**
   * Gets the total animation duration including iterations
   */
  getTotalDuration(): number {
    if (this.options.iterations === Infinity) return Infinity;
    return this.options.duration * this.options.iterations + this.options.delay;
  }

  /**
   * Gets the current progress (0-1) through the entire animation
   */
  getProgress(): number {
    const totalDuration = this.getTotalDuration();
    if (totalDuration === Infinity) {
      // For infinite animations, return progress within current iteration
      return this.options.duration > 0
        ? this.currentTime / this.options.duration
        : 1;
    }
    const elapsed = this.currentIteration * this.options.duration + this.currentTime;
    return totalDuration > 0 ? Math.min(elapsed / totalDuration, 1) : 1;
  }

  /**
   * Sets the playback rate
   */
  setPlaybackRate(rate: number): void {
    this.options.playbackRate = Math.max(0.1, rate);
  }

  /**
   * Gets the playback rate
   */
  getPlaybackRate(): number {
    return this.options.playbackRate;
  }

  /**
   * Starts or resumes playback
   */
  play(): void {
    if (this.state === 'playing') return;

    if (this.state === 'finished') {
      this.currentTime = 0;
      this.currentIteration = 0;
    }

    if (this.state === 'paused' && this.pausedAt !== null) {
      this.startTime = performance.now() - this.pausedAt;
      this.pausedAt = null;
      this.emit('resume');
    } else {
      this.startTime = performance.now();
      this.emit('start');
    }

    this.state = 'playing';
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
    this.cancel();
    this.currentTime = 0;
    this.currentIteration = 0;
  }

  /**
   * Cancels the animation
   */
  cancel(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.state = 'idle';
    this.startTime = null;
    this.pausedAt = null;
    this.emit('cancel');
  }

  /**
   * Seeks to a specific time position
   */
  seek(time: number): void {
    this.currentTime = Math.max(0, Math.min(time, this.options.duration));

    if (this.state === 'paused') {
      this.pausedAt = this.currentTime;
    } else if (this.state === 'playing') {
      this.startTime = performance.now() - this.currentTime;
    }

    this.emit('update');
  }

  /**
   * Seeks to a progress position (0-1)
   */
  seekProgress(progress: number): void {
    this.seek(progress * this.options.duration);
  }

  /**
   * Gets the interpolated value at the current time
   */
  getValue(): InterpolationResult<TransformProperties> {
    return this.getValueAtTime(this.currentTime);
  }

  /**
   * Gets the interpolated value at a specific time
   */
  getValueAtTime(time: number): InterpolationResult<TransformProperties> {
    let effectiveTime = time;

    // Apply direction
    const isOddIteration = this.currentIteration % 2 === 1;
    const shouldReverse =
      this.options.direction === 'reverse' ||
      (this.options.direction === 'alternate' && isOddIteration) ||
      (this.options.direction === 'alternate-reverse' && !isOddIteration);

    if (shouldReverse) {
      effectiveTime = this.options.duration - time;
    }

    return interpolateTrack(this.track, effectiveTime);
  }

  /**
   * Registers an event handler
   */
  on(event: AnimationEvent['type'], handler: AnimationEventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      this.eventHandlers.get(event)?.delete(handler);
    };
  }

  /**
   * Removes an event handler
   */
  off(event: AnimationEvent['type'], handler: AnimationEventHandler): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  /**
   * Emits an event to all registered handlers
   */
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

  /**
   * Schedules the next animation frame update
   */
  private scheduleUpdate(): void {
    this.rafId = requestAnimationFrame((timestamp) => this.update(timestamp));
  }

  /**
   * Updates the animation state each frame
   */
  private update(timestamp: number): void {
    if (this.state !== 'playing' || this.startTime === null) return;

    // Calculate elapsed time with playback rate
    const rawElapsed = timestamp - this.startTime;
    const elapsed = rawElapsed * this.options.playbackRate;

    // Handle delay
    if (elapsed < this.options.delay) {
      this.scheduleUpdate();
      return;
    }

    const timeAfterDelay = elapsed - this.options.delay;

    // Calculate current time within iteration
    const iterationDuration = this.options.duration;
    if (iterationDuration <= 0) {
      this.finish();
      return;
    }

    const totalIterationTime = Math.floor(timeAfterDelay / iterationDuration);
    this.currentIteration = Math.min(totalIterationTime, this.options.iterations - 1);
    this.currentTime = timeAfterDelay - this.currentIteration * iterationDuration;

    // Check if we've completed all iterations
    if (this.options.iterations !== Infinity && totalIterationTime >= this.options.iterations) {
      this.currentTime = iterationDuration;
      this.finish();
      return;
    }

    // Check for iteration boundary
    if (this.currentIteration > 0 && this.currentIteration !== Math.floor((this.lastUpdateTime - this.options.delay) / iterationDuration)) {
      this.emit('iteration');
    }

    this.lastUpdateTime = timeAfterDelay;
    this.emit('update');
    this.scheduleUpdate();
  }

  /**
   * Finishes the animation
   */
  private finish(): void {
    this.state = 'finished';

    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    this.emit('end');
  }

  /**
   * Cleans up resources
   */
  destroy(): void {
    this.cancel();
    this.eventHandlers.clear();
  }
}

/**
 * Manages multiple animation controllers
 */
export class AnimationTimeline {
  private controllers: Map<string, AnimationController> = new Map();
  private globalState: AnimationState = 'idle';

  /**
   * Adds a track to the timeline
   */
  addTrack(track: KeyframeTrack<TransformProperties>, options?: AnimationOptions): AnimationController {
    const controller = new AnimationController(track, options);
    this.controllers.set(track.id, controller);
    return controller;
  }

  /**
   * Removes a track from the timeline
   */
  removeTrack(id: string): void {
    const controller = this.controllers.get(id);
    if (controller) {
      controller.destroy();
      this.controllers.delete(id);
    }
  }

  /**
   * Gets a controller by track id
   */
  getController(id: string): AnimationController | undefined {
    return this.controllers.get(id);
  }

  /**
   * Plays all animations
   */
  playAll(): void {
    for (const controller of this.controllers.values()) {
      controller.play();
    }
    this.globalState = 'playing';
  }

  /**
   * Pauses all animations
   */
  pauseAll(): void {
    for (const controller of this.controllers.values()) {
      controller.pause();
    }
    this.globalState = 'paused';
  }

  /**
   * Stops all animations
   */
  stopAll(): void {
    for (const controller of this.controllers.values()) {
      controller.stop();
    }
    this.globalState = 'idle';
  }

  /**
   * Seeks all animations to a time
   */
  seekAll(time: number): void {
    for (const controller of this.controllers.values()) {
      controller.seek(time);
    }
  }

  /**
   * Seeks all animations to a progress position
   */
  seekAllProgress(progress: number): void {
    for (const controller of this.controllers.values()) {
      controller.seekProgress(progress);
    }
  }

  /**
   * Sets playback rate for all animations
   */
  setPlaybackRateAll(rate: number): void {
    for (const controller of this.controllers.values()) {
      controller.setPlaybackRate(rate);
    }
  }

  /**
   * Gets values from all controllers
   */
  getAllValues(): Map<string, InterpolationResult<TransformProperties>> {
    const results = new Map<string, InterpolationResult<TransformProperties>>();
    for (const [id, controller] of this.controllers) {
      results.set(id, controller.getValue());
    }
    return results;
  }

  /**
   * Gets the global timeline state
   */
  getState(): AnimationState {
    return this.globalState;
  }

  /**
   * Cleans up all controllers
   */
  destroy(): void {
    for (const controller of this.controllers.values()) {
      controller.destroy();
    }
    this.controllers.clear();
  }
}

/**
 * Creates a simple one-shot animation
 * Useful for quick animations without manual controller management
 */
export function animate(
  track: KeyframeTrack<TransformProperties>,
  onUpdate: (result: InterpolationResult<TransformProperties>) => void,
  options?: AnimationOptions & { onComplete?: () => void }
): () => void {
  const controller = new AnimationController(track, options);

  controller.on('update', () => {
    onUpdate(controller.getValue());
  });

  if (options?.onComplete) {
    controller.on('end', options.onComplete);
  }

  controller.play();

  // Return cancel function
  return () => controller.destroy();
}
