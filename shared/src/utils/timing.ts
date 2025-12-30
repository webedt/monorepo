/**
 * Timing Utilities
 *
 * Centralized module for sleep, jitter, and exponential backoff calculations.
 * All retry-related timing logic should use these functions to ensure
 * consistent behavior across the codebase.
 */

import { RETRY } from '../config/constants.js';

/**
 * Jitter mode for backoff calculations.
 * - 'bidirectional': Jitter can increase or decrease delay (±factor)
 * - 'positive': Jitter only increases delay (0 to +factor)
 */
export type JitterMode = 'bidirectional' | 'positive';

/**
 * Configuration for backoff delay calculations.
 */
export interface BackoffConfig {
  /** Base delay in milliseconds */
  baseDelayMs: number;
  /** Maximum delay in milliseconds */
  maxDelayMs: number;
  /** Multiplier for exponential growth (default: 2) */
  backoffMultiplier: number;
  /** Whether to apply jitter (default: true) */
  useJitter: boolean;
  /** Jitter factor as a fraction of delay (default: 0.3 = 30%) */
  jitterFactor: number;
  /** Jitter mode: 'bidirectional' (±factor) or 'positive' (0 to +factor). Default: 'bidirectional' */
  jitterMode: JitterMode;
}

const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  baseDelayMs: RETRY.DEFAULT.BASE_DELAY_MS,
  maxDelayMs: RETRY.DEFAULT.MAX_DELAY_MS,
  backoffMultiplier: RETRY.DEFAULT.BACKOFF_MULTIPLIER,
  useJitter: true,
  jitterFactor: RETRY.DEFAULT.JITTER_FACTOR,
  jitterMode: 'bidirectional',
};

/**
 * Sleep for a specified number of milliseconds.
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the specified duration
 *
 * @example
 * ```typescript
 * await sleep(1000); // Wait 1 second
 * ```
 */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Add random jitter to a value.
 *
 * Applies bidirectional jitter: the result may be higher or lower than
 * the input value, within the range [value * (1 - factor), value * (1 + factor)].
 *
 * @param value - The base value to add jitter to
 * @param factor - Jitter factor as a fraction (default: 0.3 = ±30%)
 * @returns Value with jitter applied
 *
 * @example
 * ```typescript
 * const delay = addJitter(1000, 0.3); // Returns 700-1300ms
 * ```
 */
export function addJitter(value: number, factor: number = RETRY.DEFAULT.JITTER_FACTOR): number {
  const jitterAmount = Math.random() * factor * value;
  // Bidirectional jitter: randomly add or subtract
  return Math.random() > 0.5 ? value + jitterAmount : value - jitterAmount;
}

/**
 * Add positive jitter to a value.
 *
 * Unlike `addJitter`, this only increases the value, never decreases it.
 * The result is in the range [value, value * (1 + factor)].
 *
 * @param value - The base value to add jitter to
 * @param factor - Jitter factor as a fraction (default: 0.3 = +0-30%)
 * @returns Value with positive jitter applied
 *
 * @example
 * ```typescript
 * const delay = addPositiveJitter(1000, 0.3); // Returns 1000-1300ms
 * ```
 */
export function addPositiveJitter(value: number, factor: number = RETRY.DEFAULT.JITTER_FACTOR): number {
  return value + Math.random() * factor * value;
}

/**
 * Calculate exponential backoff delay for a given attempt.
 *
 * Uses the formula: min(baseDelay * multiplier^(attempt-1), maxDelay)
 * Optionally applies jitter to prevent thundering herd problems.
 *
 * @param attempt - Current attempt number (1-based)
 * @param config - Backoff configuration options
 * @returns Delay in milliseconds (floored to integer)
 *
 * @example
 * ```typescript
 * // With default config (base: 1000ms, multiplier: 2)
 * calculateBackoffDelay(1); // ~1000ms
 * calculateBackoffDelay(2); // ~2000ms
 * calculateBackoffDelay(3); // ~4000ms
 *
 * // With custom config
 * calculateBackoffDelay(1, { baseDelayMs: 500, backoffMultiplier: 1.5 });
 * ```
 */
export function calculateBackoffDelay(
  attempt: number,
  config: Partial<BackoffConfig> = {}
): number {
  const finalConfig = { ...DEFAULT_BACKOFF_CONFIG, ...config };

  // Calculate exponential delay
  const exponentialDelay = finalConfig.baseDelayMs * Math.pow(finalConfig.backoffMultiplier, attempt - 1);
  let delay = Math.min(exponentialDelay, finalConfig.maxDelayMs);

  // Apply jitter if enabled
  if (finalConfig.useJitter) {
    if (finalConfig.jitterMode === 'positive') {
      delay = addPositiveJitter(delay, finalConfig.jitterFactor);
    } else {
      delay = addJitter(delay, finalConfig.jitterFactor);
      // Ensure delay doesn't go below half of base delay (only for bidirectional)
      delay = Math.max(delay, finalConfig.baseDelayMs * 0.5);
    }
  }

  return Math.floor(delay);
}

/**
 * Sleep with positive jitter applied to the duration.
 *
 * Convenience function that combines sleep() and addPositiveJitter().
 * The actual sleep duration will be between ms and ms * (1 + jitterFactor).
 *
 * @param ms - Base duration to sleep in milliseconds
 * @param jitterFactor - Jitter factor (default: 0.3 = +0-30%)
 * @returns Promise that resolves after the jittered duration
 *
 * @example
 * ```typescript
 * await sleepWithJitter(1000); // Waits 1000-1300ms
 * ```
 */
export async function sleepWithJitter(
  ms: number,
  jitterFactor: number = RETRY.DEFAULT.JITTER_FACTOR
): Promise<void> {
  const jitteredMs = addPositiveJitter(ms, jitterFactor);
  return sleep(jitteredMs);
}

/**
 * Sleep with exponential backoff for a given attempt.
 *
 * Convenience function that calculates backoff delay and sleeps.
 *
 * @param attempt - Current attempt number (1-based)
 * @param config - Backoff configuration options
 * @returns Promise that resolves after the calculated delay
 *
 * @example
 * ```typescript
 * for (let attempt = 1; attempt <= maxRetries; attempt++) {
 *   try {
 *     return await operation();
 *   } catch (error) {
 *     if (attempt < maxRetries) {
 *       await sleepWithBackoff(attempt);
 *     }
 *   }
 * }
 * ```
 */
export async function sleepWithBackoff(
  attempt: number,
  config: Partial<BackoffConfig> = {}
): Promise<number> {
  const delay = calculateBackoffDelay(attempt, config);
  await sleep(delay);
  return delay;
}
