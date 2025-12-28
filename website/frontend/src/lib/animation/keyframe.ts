/**
 * Keyframe Types and Interpolation Utilities
 * Provides types and functions for defining and interpolating between keyframes
 */

import type { EasingFunction } from './easing.js';
import { linear, getEasing } from './easing.js';

/**
 * Transform properties that can be animated
 */
export interface TransformProperties {
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  opacity?: number;
}

/**
 * A single keyframe definition
 */
export interface Keyframe<T = TransformProperties> {
  /** Time in milliseconds from animation start */
  time: number;
  /** Property values at this keyframe */
  value: T;
  /** Easing function to use when transitioning TO this keyframe */
  easing?: EasingFunction | string;
}

/**
 * Configuration for a keyframe track
 */
export interface KeyframeTrack<T = TransformProperties> {
  /** Unique identifier for this track */
  id: string;
  /** Target object or property path */
  target?: string;
  /** Array of keyframes sorted by time */
  keyframes: Keyframe<T>[];
  /** Default easing for all transitions in this track */
  defaultEasing?: EasingFunction | string;
}

/**
 * Result of interpolating between keyframes
 */
export interface InterpolationResult<T = TransformProperties> {
  /** Current interpolated values */
  value: T;
  /** Current keyframe index */
  currentKeyframeIndex: number;
  /** Whether the animation has completed */
  isComplete: boolean;
  /** Progress through the entire animation (0-1) */
  progress: number;
}

/**
 * Clamps a value between min and max
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Linearly interpolates between two numbers
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Normalizes an angle to the range [-180, 180] for shortest path rotation
 */
function normalizeAngle(angle: number): number {
  while (angle > 180) angle -= 360;
  while (angle < -180) angle += 360;
  return angle;
}

/**
 * Interpolates rotation values using shortest path
 */
export function lerpAngle(a: number, b: number, t: number): number {
  const diff = normalizeAngle(b - a);
  return a + diff * t;
}

/**
 * Resolves an easing parameter to an EasingFunction
 */
function resolveEasing(easing: EasingFunction | string | undefined, defaultEasing?: EasingFunction | string): EasingFunction {
  const easingToUse = easing ?? defaultEasing;

  if (typeof easingToUse === 'function') {
    return easingToUse;
  }

  if (typeof easingToUse === 'string') {
    return getEasing(easingToUse);
  }

  return linear;
}

/**
 * Interpolates between two transform property sets
 */
export function interpolateTransform(
  from: TransformProperties,
  to: TransformProperties,
  t: number,
  easing: EasingFunction = linear
): TransformProperties {
  const easedT = easing(clamp(t, 0, 1));
  const result: TransformProperties = {};

  // Interpolate each property if defined in both keyframes
  if (from.x !== undefined && to.x !== undefined) {
    result.x = lerp(from.x, to.x, easedT);
  } else if (to.x !== undefined) {
    result.x = to.x;
  } else if (from.x !== undefined) {
    result.x = from.x;
  }

  if (from.y !== undefined && to.y !== undefined) {
    result.y = lerp(from.y, to.y, easedT);
  } else if (to.y !== undefined) {
    result.y = to.y;
  } else if (from.y !== undefined) {
    result.y = from.y;
  }

  // Use shortest path for rotation
  if (from.rotation !== undefined && to.rotation !== undefined) {
    result.rotation = lerpAngle(from.rotation, to.rotation, easedT);
  } else if (to.rotation !== undefined) {
    result.rotation = to.rotation;
  } else if (from.rotation !== undefined) {
    result.rotation = from.rotation;
  }

  if (from.scaleX !== undefined && to.scaleX !== undefined) {
    result.scaleX = lerp(from.scaleX, to.scaleX, easedT);
  } else if (to.scaleX !== undefined) {
    result.scaleX = to.scaleX;
  } else if (from.scaleX !== undefined) {
    result.scaleX = from.scaleX;
  }

  if (from.scaleY !== undefined && to.scaleY !== undefined) {
    result.scaleY = lerp(from.scaleY, to.scaleY, easedT);
  } else if (to.scaleY !== undefined) {
    result.scaleY = to.scaleY;
  } else if (from.scaleY !== undefined) {
    result.scaleY = from.scaleY;
  }

  if (from.opacity !== undefined && to.opacity !== undefined) {
    result.opacity = lerp(from.opacity, to.opacity, easedT);
  } else if (to.opacity !== undefined) {
    result.opacity = to.opacity;
  } else if (from.opacity !== undefined) {
    result.opacity = from.opacity;
  }

  return result;
}

/**
 * Generic interpolation function for numeric properties
 */
export function interpolateProperties<T extends Record<string, number | undefined>>(
  from: T,
  to: T,
  t: number,
  easing: EasingFunction = linear,
  angleProperties: Set<string> = new Set(['rotation'])
): T {
  const easedT = easing(clamp(t, 0, 1));
  const result = {} as T;

  // Get all unique keys from both objects
  const allKeys = new Set([...Object.keys(from), ...Object.keys(to)]) as Set<keyof T>;

  for (const key of allKeys) {
    const fromVal = from[key];
    const toVal = to[key];

    if (fromVal !== undefined && toVal !== undefined) {
      if (angleProperties.has(key as string)) {
        result[key] = lerpAngle(fromVal as number, toVal as number, easedT) as T[keyof T];
      } else {
        result[key] = lerp(fromVal as number, toVal as number, easedT) as T[keyof T];
      }
    } else if (toVal !== undefined) {
      result[key] = toVal;
    } else if (fromVal !== undefined) {
      result[key] = fromVal;
    }
  }

  return result;
}

/**
 * Finds the keyframe pair that surrounds the given time
 */
export function findKeyframePair<T>(
  keyframes: Keyframe<T>[],
  time: number
): { from: Keyframe<T>; to: Keyframe<T>; index: number } | null {
  if (keyframes.length === 0) return null;

  // Sort keyframes by time (defensive)
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  // Before first keyframe
  if (time <= sorted[0].time) {
    return { from: sorted[0], to: sorted[0], index: 0 };
  }

  // After last keyframe
  if (time >= sorted[sorted.length - 1].time) {
    const lastIndex = sorted.length - 1;
    return { from: sorted[lastIndex], to: sorted[lastIndex], index: lastIndex };
  }

  // Find surrounding keyframes
  for (let i = 0; i < sorted.length - 1; i++) {
    if (time >= sorted[i].time && time < sorted[i + 1].time) {
      return { from: sorted[i], to: sorted[i + 1], index: i };
    }
  }

  return null;
}

/**
 * Calculates the total duration of a keyframe track
 */
export function getTrackDuration<T>(track: KeyframeTrack<T>): number {
  if (track.keyframes.length === 0) return 0;
  return Math.max(...track.keyframes.map(k => k.time));
}

/**
 * Interpolates a keyframe track at a given time
 */
export function interpolateTrack(
  track: KeyframeTrack<TransformProperties>,
  time: number
): InterpolationResult<TransformProperties> {
  const { keyframes, defaultEasing } = track;

  if (keyframes.length === 0) {
    return {
      value: {},
      currentKeyframeIndex: -1,
      isComplete: true,
      progress: 1,
    };
  }

  const duration = getTrackDuration(track);
  const progress = duration > 0 ? clamp(time / duration, 0, 1) : 1;

  const pair = findKeyframePair(keyframes, time);

  if (!pair) {
    return {
      value: keyframes[0].value,
      currentKeyframeIndex: 0,
      isComplete: false,
      progress,
    };
  }

  const { from, to, index } = pair;

  // Same keyframe (at or beyond endpoints)
  if (from === to) {
    return {
      value: { ...from.value },
      currentKeyframeIndex: index,
      isComplete: time >= duration,
      progress,
    };
  }

  // Calculate local progress between keyframes
  const segmentDuration = to.time - from.time;
  const segmentTime = time - from.time;
  const localProgress = segmentDuration > 0 ? segmentTime / segmentDuration : 1;

  // Get easing function (use 'to' keyframe's easing for the transition)
  const easing = resolveEasing(to.easing, defaultEasing);

  // Interpolate values
  const value = interpolateTransform(from.value, to.value, localProgress, easing);

  return {
    value,
    currentKeyframeIndex: index,
    isComplete: time >= duration,
    progress,
  };
}

/**
 * Creates a new keyframe track from an array of keyframes
 */
export function createTrack(
  id: string,
  keyframes: Keyframe<TransformProperties>[],
  options: { target?: string; defaultEasing?: EasingFunction | string } = {}
): KeyframeTrack<TransformProperties> {
  // Sort keyframes by time
  const sorted = [...keyframes].sort((a, b) => a.time - b.time);

  return {
    id,
    target: options.target,
    keyframes: sorted,
    defaultEasing: options.defaultEasing,
  };
}

/**
 * Creates keyframes from a simple path definition
 * Useful for creating basic movement animations
 */
export function createPathKeyframes(
  points: Array<{ x: number; y: number; time: number; easing?: EasingFunction | string }>
): Keyframe<TransformProperties>[] {
  return points.map(point => ({
    time: point.time,
    value: { x: point.x, y: point.y },
    easing: point.easing,
  }));
}

/**
 * Creates a uniform keyframe distribution for smooth animation
 * Useful for creating animations with evenly spaced keyframes
 */
export function createUniformKeyframes(
  values: TransformProperties[],
  duration: number,
  easing?: EasingFunction | string
): Keyframe<TransformProperties>[] {
  if (values.length === 0) return [];
  if (values.length === 1) {
    return [{ time: 0, value: values[0], easing }];
  }

  const interval = duration / (values.length - 1);

  return values.map((value, index) => ({
    time: index * interval,
    value,
    easing,
  }));
}

/**
 * Merges multiple keyframe tracks into a single interpolation result
 */
export function interpolateTracks(
  tracks: KeyframeTrack<TransformProperties>[],
  time: number
): Map<string, InterpolationResult<TransformProperties>> {
  const results = new Map<string, InterpolationResult<TransformProperties>>();

  for (const track of tracks) {
    results.set(track.id, interpolateTrack(track, time));
  }

  return results;
}

/**
 * Validates keyframe data and returns any errors found
 */
export function validateKeyframes(keyframes: Keyframe<TransformProperties>[]): string[] {
  const errors: string[] = [];

  if (keyframes.length === 0) {
    errors.push('Track has no keyframes');
    return errors;
  }

  for (let i = 0; i < keyframes.length; i++) {
    const keyframe = keyframes[i];

    if (typeof keyframe.time !== 'number' || isNaN(keyframe.time)) {
      errors.push(`Keyframe ${i}: invalid time value`);
    }

    if (keyframe.time < 0) {
      errors.push(`Keyframe ${i}: negative time value`);
    }

    if (!keyframe.value || typeof keyframe.value !== 'object') {
      errors.push(`Keyframe ${i}: missing or invalid value object`);
    }
  }

  // Check for duplicate times
  const times = keyframes.map(k => k.time);
  const uniqueTimes = new Set(times);
  if (times.length !== uniqueTimes.size) {
    errors.push('Track has keyframes with duplicate times');
  }

  return errors;
}
