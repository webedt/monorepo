/**
 * GitHub Rate Limiter
 *
 * Implements rate limiting for GitHub API calls following their guidelines:
 * - Primary: 5,000 requests/hour for authenticated users
 * - Secondary: 80 content-creation/min, 500/hour
 * - Mutations should have 1+ second between them
 * - Max 100 concurrent requests
 *
 * @see https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 */

import { logger } from '../utils/logging/logger.js';

export interface RateLimitState {
  /** Primary rate limit - remaining requests */
  remaining: number;
  /** Primary rate limit - max requests per hour */
  limit: number;
  /** Time when rate limit resets (Unix timestamp in seconds) */
  resetAt: number;
  /** Number of content-creation requests in current minute */
  mutationsThisMinute: number;
  /** Number of content-creation requests in current hour */
  mutationsThisHour: number;
  /** Timestamp of the minute window start */
  minuteWindowStart: number;
  /** Timestamp of the hour window start */
  hourWindowStart: number;
  /** Last mutation timestamp */
  lastMutationAt: number;
  /** Whether we're currently rate limited */
  isLimited: boolean;
  /** If limited, when we can retry */
  retryAfter: number | null;
}

export interface RateLimiterConfig {
  /** Minimum delay between mutations in ms (default: 1000) */
  mutationDelayMs?: number;
  /** Max mutations per minute (default: 60 - being conservative below GitHub's 80) */
  maxMutationsPerMinute?: number;
  /** Max mutations per hour (default: 400 - being conservative below GitHub's 500) */
  maxMutationsPerHour?: number;
  /** Buffer to keep before hitting primary limit (default: 100) */
  primaryLimitBuffer?: number;
}

const DEFAULT_CONFIG: Required<RateLimiterConfig> = {
  mutationDelayMs: 1000,
  maxMutationsPerMinute: 60,
  maxMutationsPerHour: 400,
  primaryLimitBuffer: 100,
};

export class GitHubRateLimiter {
  private state: RateLimitState;
  private config: Required<RateLimiterConfig>;
  private requestQueue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    isMutation: boolean;
  }> = [];
  private processing = false;

  constructor(config: RateLimiterConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    const now = Date.now();
    this.state = {
      remaining: 5000,
      limit: 5000,
      resetAt: Math.floor(now / 1000) + 3600,
      mutationsThisMinute: 0,
      mutationsThisHour: 0,
      minuteWindowStart: now,
      hourWindowStart: now,
      lastMutationAt: 0,
      isLimited: false,
      retryAfter: null,
    };
  }

  /**
   * Update rate limit state from response headers
   */
  updateFromHeaders(headers: Record<string, string | number | undefined>): void {
    const remaining = headers['x-ratelimit-remaining'];
    const limit = headers['x-ratelimit-limit'];
    const reset = headers['x-ratelimit-reset'];
    const retryAfter = headers['retry-after'];

    if (remaining !== undefined) {
      this.state.remaining = Number(remaining);
    }
    if (limit !== undefined) {
      this.state.limit = Number(limit);
    }
    if (reset !== undefined) {
      this.state.resetAt = Number(reset);
    }
    if (retryAfter !== undefined) {
      this.state.retryAfter = Date.now() + Number(retryAfter) * 1000;
      this.state.isLimited = true;
    }

    logger.debug('Rate limit state updated', {
      component: 'GitHubRateLimiter',
      remaining: this.state.remaining,
      limit: this.state.limit,
      resetAt: new Date(this.state.resetAt * 1000).toISOString(),
    });
  }

  /**
   * Handle a rate limit error (403/429)
   */
  handleRateLimitError(status: number, headers: Record<string, string | number | undefined>): void {
    this.state.isLimited = true;

    const retryAfter = headers['retry-after'];
    if (retryAfter) {
      this.state.retryAfter = Date.now() + Number(retryAfter) * 1000;
    } else if (this.state.remaining === 0) {
      // Primary rate limit - wait until reset
      this.state.retryAfter = this.state.resetAt * 1000;
    } else {
      // Secondary rate limit - wait at least 1 minute
      this.state.retryAfter = Date.now() + 60000;
    }

    logger.warn('Rate limit hit', {
      component: 'GitHubRateLimiter',
      status,
      retryAfter: this.state.retryAfter ? new Date(this.state.retryAfter).toISOString() : null,
      remaining: this.state.remaining,
    });
  }

  /**
   * Check if we can make a request right now
   */
  canRequest(isMutation: boolean): { allowed: boolean; waitMs: number; reason?: string } {
    const now = Date.now();

    // Check if we're rate limited
    if (this.state.isLimited && this.state.retryAfter) {
      if (now < this.state.retryAfter) {
        return {
          allowed: false,
          waitMs: this.state.retryAfter - now,
          reason: 'Currently rate limited',
        };
      } else {
        // Rate limit period has passed
        this.state.isLimited = false;
        this.state.retryAfter = null;
      }
    }

    // Check primary rate limit
    if (this.state.remaining <= this.config.primaryLimitBuffer) {
      const resetTime = this.state.resetAt * 1000;
      if (now < resetTime) {
        return {
          allowed: false,
          waitMs: resetTime - now,
          reason: `Primary rate limit low (${this.state.remaining} remaining)`,
        };
      }
    }

    if (isMutation) {
      // Reset minute window if needed
      if (now - this.state.minuteWindowStart > 60000) {
        this.state.mutationsThisMinute = 0;
        this.state.minuteWindowStart = now;
      }

      // Reset hour window if needed
      if (now - this.state.hourWindowStart > 3600000) {
        this.state.mutationsThisHour = 0;
        this.state.hourWindowStart = now;
      }

      // Check per-minute limit
      if (this.state.mutationsThisMinute >= this.config.maxMutationsPerMinute) {
        const waitMs = 60000 - (now - this.state.minuteWindowStart);
        return {
          allowed: false,
          waitMs,
          reason: `Per-minute mutation limit (${this.state.mutationsThisMinute}/${this.config.maxMutationsPerMinute})`,
        };
      }

      // Check per-hour limit
      if (this.state.mutationsThisHour >= this.config.maxMutationsPerHour) {
        const waitMs = 3600000 - (now - this.state.hourWindowStart);
        return {
          allowed: false,
          waitMs,
          reason: `Per-hour mutation limit (${this.state.mutationsThisHour}/${this.config.maxMutationsPerHour})`,
        };
      }

      // Check minimum delay between mutations
      const timeSinceLastMutation = now - this.state.lastMutationAt;
      if (timeSinceLastMutation < this.config.mutationDelayMs) {
        return {
          allowed: false,
          waitMs: this.config.mutationDelayMs - timeSinceLastMutation,
          reason: 'Minimum delay between mutations',
        };
      }
    }

    return { allowed: true, waitMs: 0 };
  }

  /**
   * Record that a request was made
   */
  recordRequest(isMutation: boolean): void {
    this.state.remaining = Math.max(0, this.state.remaining - 1);

    if (isMutation) {
      this.state.mutationsThisMinute++;
      this.state.mutationsThisHour++;
      this.state.lastMutationAt = Date.now();
    }
  }

  /**
   * Wait for rate limit to allow a request
   */
  async waitForSlot(isMutation: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ resolve, reject, isMutation });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.requestQueue.length === 0) {
      return;
    }

    this.processing = true;

    while (this.requestQueue.length > 0) {
      const next = this.requestQueue[0];
      const check = this.canRequest(next.isMutation);

      if (check.allowed) {
        this.requestQueue.shift();
        this.recordRequest(next.isMutation);
        next.resolve();
      } else {
        logger.debug('Rate limiter waiting', {
          component: 'GitHubRateLimiter',
          waitMs: check.waitMs,
          reason: check.reason,
          queueLength: this.requestQueue.length,
        });
        await this.sleep(Math.min(check.waitMs, 5000)); // Check every 5s max
      }
    }

    this.processing = false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current rate limit state for logging/debugging
   */
  getState(): Readonly<RateLimitState> {
    return { ...this.state };
  }

  /**
   * Get a summary string for logging
   */
  getSummary(): string {
    const state = this.state;
    const parts = [
      `primary: ${state.remaining}/${state.limit}`,
      `mutations: ${state.mutationsThisMinute}/min, ${state.mutationsThisHour}/hr`,
    ];
    if (state.isLimited && state.retryAfter) {
      const waitSec = Math.ceil((state.retryAfter - Date.now()) / 1000);
      parts.push(`LIMITED (retry in ${waitSec}s)`);
    }
    return parts.join(' | ');
  }
}

/**
 * Create a rate-limited wrapper for GitHub API calls
 */
export function withRateLimiting<T extends (...args: unknown[]) => Promise<unknown>>(
  rateLimiter: GitHubRateLimiter,
  fn: T,
  isMutation: boolean
): T {
  return (async (...args: Parameters<T>) => {
    await rateLimiter.waitForSlot(isMutation);
    try {
      const result = await fn(...args);
      // If the result has headers, update rate limit state
      if (result && typeof result === 'object' && 'headers' in result) {
        rateLimiter.updateFromHeaders((result as { headers: Record<string, string> }).headers);
      }
      return result;
    } catch (error) {
      // Check for rate limit errors
      if (error && typeof error === 'object' && 'status' in error) {
        const status = (error as { status: number }).status;
        if (status === 403 || status === 429) {
          const headers = 'headers' in error
            ? (error as { headers: Record<string, string> }).headers
            : {};
          rateLimiter.handleRateLimitError(status, headers);
        }
      }
      throw error;
    }
  }) as T;
}
