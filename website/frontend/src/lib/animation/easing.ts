/**
 * Easing Functions Library
 * Provides standard easing functions for smooth interpolation between keyframes
 *
 * All easing functions take a normalized time value t (0-1) and return a normalized progress value (0-1)
 */

export type EasingFunction = (t: number) => number;

/**
 * Linear easing - no acceleration, constant speed
 */
export const linear: EasingFunction = (t) => t;

// Quadratic easing functions
export const easeInQuad: EasingFunction = (t) => t * t;
export const easeOutQuad: EasingFunction = (t) => t * (2 - t);
export const easeInOutQuad: EasingFunction = (t) =>
  t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;

// Cubic easing functions
export const easeInCubic: EasingFunction = (t) => t * t * t;
export const easeOutCubic: EasingFunction = (t) => (--t) * t * t + 1;
export const easeInOutCubic: EasingFunction = (t) =>
  t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;

// Quartic easing functions
export const easeInQuart: EasingFunction = (t) => t * t * t * t;
export const easeOutQuart: EasingFunction = (t) => 1 - (--t) * t * t * t;
export const easeInOutQuart: EasingFunction = (t) =>
  t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t;

// Quintic easing functions
export const easeInQuint: EasingFunction = (t) => t * t * t * t * t;
export const easeOutQuint: EasingFunction = (t) => 1 + (--t) * t * t * t * t;
export const easeInOutQuint: EasingFunction = (t) =>
  t < 0.5 ? 16 * t * t * t * t * t : 1 + 16 * (--t) * t * t * t * t;

// Sinusoidal easing functions
export const easeInSine: EasingFunction = (t) =>
  1 - Math.cos((t * Math.PI) / 2);
export const easeOutSine: EasingFunction = (t) =>
  Math.sin((t * Math.PI) / 2);
export const easeInOutSine: EasingFunction = (t) =>
  -(Math.cos(Math.PI * t) - 1) / 2;

// Exponential easing functions
export const easeInExpo: EasingFunction = (t) =>
  t === 0 ? 0 : Math.pow(2, 10 * (t - 1));
export const easeOutExpo: EasingFunction = (t) =>
  t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
export const easeInOutExpo: EasingFunction = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  if (t < 0.5) return Math.pow(2, 20 * t - 10) / 2;
  return (2 - Math.pow(2, -20 * t + 10)) / 2;
};

// Circular easing functions
export const easeInCirc: EasingFunction = (t) =>
  1 - Math.sqrt(1 - t * t);
export const easeOutCirc: EasingFunction = (t) =>
  Math.sqrt(1 - (--t) * t);
export const easeInOutCirc: EasingFunction = (t) =>
  t < 0.5
    ? (1 - Math.sqrt(1 - 4 * t * t)) / 2
    : (Math.sqrt(1 - Math.pow(-2 * t + 2, 2)) + 1) / 2;

// Back easing functions (overshoot)
const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;

export const easeInBack: EasingFunction = (t) =>
  c3 * t * t * t - c1 * t * t;
export const easeOutBack: EasingFunction = (t) =>
  1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
export const easeInOutBack: EasingFunction = (t) =>
  t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;

// Elastic easing functions
const c4 = (2 * Math.PI) / 3;
const c5 = (2 * Math.PI) / 4.5;

export const easeInElastic: EasingFunction = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return -Math.pow(2, 10 * t - 10) * Math.sin((t * 10 - 10.75) * c4);
};
export const easeOutElastic: EasingFunction = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
export const easeInOutElastic: EasingFunction = (t) => {
  if (t === 0) return 0;
  if (t === 1) return 1;
  if (t < 0.5)
    return -(Math.pow(2, 20 * t - 10) * Math.sin((20 * t - 11.125) * c5)) / 2;
  return (Math.pow(2, -20 * t + 10) * Math.sin((20 * t - 11.125) * c5)) / 2 + 1;
};

// Bounce easing functions
const bounceOut: EasingFunction = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;

  if (t < 1 / d1) {
    return n1 * t * t;
  } else if (t < 2 / d1) {
    return n1 * (t -= 1.5 / d1) * t + 0.75;
  } else if (t < 2.5 / d1) {
    return n1 * (t -= 2.25 / d1) * t + 0.9375;
  } else {
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  }
};

export const easeInBounce: EasingFunction = (t) =>
  1 - bounceOut(1 - t);
export const easeOutBounce: EasingFunction = bounceOut;
export const easeInOutBounce: EasingFunction = (t) =>
  t < 0.5
    ? (1 - bounceOut(1 - 2 * t)) / 2
    : (1 + bounceOut(2 * t - 1)) / 2;

/**
 * Creates a custom cubic bezier easing function
 * Similar to CSS cubic-bezier(x1, y1, x2, y2)
 */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
  // Newton-Raphson iteration to solve for t given x
  const sampleCurveX = (t: number) =>
    ((1 - 3 * x2 + 3 * x1) * t + (3 * x2 - 6 * x1)) * t + (3 * x1) * t;
  const sampleCurveY = (t: number) =>
    ((1 - 3 * y2 + 3 * y1) * t + (3 * y2 - 6 * y1)) * t + (3 * y1) * t;
  const sampleCurveDerivativeX = (t: number) =>
    (3 * (1 - 3 * x2 + 3 * x1) * t + 2 * (3 * x2 - 6 * x1)) * t + 3 * x1;

  const solveCurveX = (x: number, epsilon: number = 1e-6): number => {
    let t0 = 0;
    let t1 = 1;
    let t2 = x;

    // First try a few iterations of Newton's method -- fast and accurate
    for (let i = 0; i < 8; i++) {
      const x2 = sampleCurveX(t2) - x;
      if (Math.abs(x2) < epsilon) return t2;
      const d2 = sampleCurveDerivativeX(t2);
      if (Math.abs(d2) < 1e-6) break;
      t2 -= x2 / d2;
    }

    // Fall back to bisection method for reliability
    while (t0 < t1) {
      const x2 = sampleCurveX(t2);
      if (Math.abs(x2 - x) < epsilon) return t2;
      if (x > x2) t0 = t2;
      else t1 = t2;
      t2 = (t1 - t0) * 0.5 + t0;
    }

    return t2;
  };

  return (t: number): number => {
    if (t === 0 || t === 1) return t;
    return sampleCurveY(solveCurveX(t));
  };
}

/**
 * Creates a steps easing function for frame-by-frame animation
 */
export function steps(numSteps: number, jumpTerm: 'start' | 'end' | 'both' | 'none' = 'end'): EasingFunction {
  return (t: number): number => {
    const progress = Math.min(Math.max(t, 0), 1);

    switch (jumpTerm) {
      case 'start':
        return Math.ceil(progress * numSteps) / numSteps;
      case 'end':
        return Math.floor(progress * numSteps) / numSteps;
      case 'both':
        return Math.round(progress * (numSteps + 1)) / (numSteps + 1);
      case 'none':
        if (progress === 0) return 0;
        if (progress === 1) return 1;
        return Math.floor(progress * (numSteps - 1) + 1) / numSteps;
      default:
        return Math.floor(progress * numSteps) / numSteps;
    }
  };
}

/**
 * Standard CSS easing presets
 */
export const cssEase = cubicBezier(0.25, 0.1, 0.25, 1);
export const cssEaseIn = cubicBezier(0.42, 0, 1, 1);
export const cssEaseOut = cubicBezier(0, 0, 0.58, 1);
export const cssEaseInOut = cubicBezier(0.42, 0, 0.58, 1);

/**
 * Named easing presets map for runtime lookup
 */
export const easingPresets: Record<string, EasingFunction> = {
  linear,

  // Quadratic
  'ease-in-quad': easeInQuad,
  'ease-out-quad': easeOutQuad,
  'ease-in-out-quad': easeInOutQuad,

  // Cubic
  'ease-in-cubic': easeInCubic,
  'ease-out-cubic': easeOutCubic,
  'ease-in-out-cubic': easeInOutCubic,

  // Quartic
  'ease-in-quart': easeInQuart,
  'ease-out-quart': easeOutQuart,
  'ease-in-out-quart': easeInOutQuart,

  // Quintic
  'ease-in-quint': easeInQuint,
  'ease-out-quint': easeOutQuint,
  'ease-in-out-quint': easeInOutQuint,

  // Sinusoidal
  'ease-in-sine': easeInSine,
  'ease-out-sine': easeOutSine,
  'ease-in-out-sine': easeInOutSine,

  // Exponential
  'ease-in-expo': easeInExpo,
  'ease-out-expo': easeOutExpo,
  'ease-in-out-expo': easeInOutExpo,

  // Circular
  'ease-in-circ': easeInCirc,
  'ease-out-circ': easeOutCirc,
  'ease-in-out-circ': easeInOutCirc,

  // Back
  'ease-in-back': easeInBack,
  'ease-out-back': easeOutBack,
  'ease-in-out-back': easeInOutBack,

  // Elastic
  'ease-in-elastic': easeInElastic,
  'ease-out-elastic': easeOutElastic,
  'ease-in-out-elastic': easeInOutElastic,

  // Bounce
  'ease-in-bounce': easeInBounce,
  'ease-out-bounce': easeOutBounce,
  'ease-in-out-bounce': easeInOutBounce,

  // CSS standard
  'ease': cssEase,
  'ease-in': cssEaseIn,
  'ease-out': cssEaseOut,
  'ease-in-out': cssEaseInOut,
};

/**
 * Get an easing function by name
 */
export function getEasing(name: string): EasingFunction {
  return easingPresets[name] ?? linear;
}
