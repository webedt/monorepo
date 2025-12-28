/**
 * Animation Library
 * Provides easing functions and keyframe interpolation for transform properties
 *
 * @example
 * ```typescript
 * import {
 *   createTrack,
 *   AnimationController,
 *   easeOutCubic
 * } from './lib/animation';
 *
 * // Create a keyframe track
 * const track = createTrack('move-object', [
 *   { time: 0, value: { x: 0, y: 0, rotation: 0 } },
 *   { time: 500, value: { x: 100, y: 50, rotation: 45 }, easing: 'ease-out-cubic' },
 *   { time: 1000, value: { x: 200, y: 0, rotation: 0 }, easing: easeOutCubic }
 * ]);
 *
 * // Create an animation controller
 * const controller = new AnimationController(track, {
 *   iterations: Infinity,
 *   direction: 'alternate'
 * });
 *
 * // Subscribe to updates
 * controller.on('update', () => {
 *   const { value } = controller.getValue();
 *   object.transform = {
 *     x: value.x ?? 0,
 *     y: value.y ?? 0,
 *     rotation: value.rotation ?? 0,
 *     scaleX: value.scaleX ?? 1,
 *     scaleY: value.scaleY ?? 1
 *   };
 *   render();
 * });
 *
 * // Start animation
 * controller.play();
 * ```
 */

// Easing functions
export {
  // Types
  type EasingFunction,

  // Linear
  linear,

  // Quadratic
  easeInQuad,
  easeOutQuad,
  easeInOutQuad,

  // Cubic
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,

  // Quartic
  easeInQuart,
  easeOutQuart,
  easeInOutQuart,

  // Quintic
  easeInQuint,
  easeOutQuint,
  easeInOutQuint,

  // Sinusoidal
  easeInSine,
  easeOutSine,
  easeInOutSine,

  // Exponential
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,

  // Circular
  easeInCirc,
  easeOutCirc,
  easeInOutCirc,

  // Back (overshoot)
  easeInBack,
  easeOutBack,
  easeInOutBack,

  // Elastic
  easeInElastic,
  easeOutElastic,
  easeInOutElastic,

  // Bounce
  easeInBounce,
  easeOutBounce,
  easeInOutBounce,

  // CSS presets
  cssEase,
  cssEaseIn,
  cssEaseOut,
  cssEaseInOut,

  // Factories
  cubicBezier,
  steps,

  // Lookup
  easingPresets,
  getEasing,
} from './easing.js';

// Keyframe types and interpolation
export {
  // Types
  type TransformProperties,
  type Keyframe,
  type KeyframeTrack,
  type InterpolationResult,

  // Interpolation functions
  lerp,
  lerpAngle,
  interpolateTransform,
  interpolateProperties,
  interpolateTrack,
  interpolateTracks,

  // Track utilities
  createTrack,
  createPathKeyframes,
  createUniformKeyframes,
  findKeyframePair,
  getTrackDuration,
  validateKeyframes,
} from './keyframe.js';

// Animation controller
export {
  // Types
  type AnimationState,
  type PlaybackDirection,
  type AnimationOptions,
  type AnimationEvent,
  type AnimationEventHandler,

  // Classes
  AnimationController,
  AnimationTimeline,

  // Utility
  animate,
} from './AnimationController.js';

// Animator (unified frame and bone animation playback)
export {
  // Types
  type AnimatorState,
  type AnimatorEvent,
  type AnimatorEventHandler,
  type FrameResult,
  type BoneResult,
  type AnimatorResult,

  // Class
  Animator,

  // Utility
  createAnimator,
} from './Animator.js';
