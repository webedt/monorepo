/**
 * Circuit Breaker pattern implementation for Claude Agent SDK calls.
 * Provides resilience against API failures, rate limiting, and service unavailability.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests are rejected immediately
 * - HALF_OPEN: Testing if service has recovered, allows limited test requests
 */

import { logger } from './logger.js';
import { metrics } from './metrics.js';
import { ClaudeError, ErrorCode, type ErrorContext } from './errors.js';
import { getIsRetryable, getHttpStatusCode } from './typeGuards.js';

/**
 * Circuit breaker states
 */
export type CircuitBreakerState = 'closed' | 'open' | 'half_open';

/**
 * Circuit breaker configuration
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening circuit (default: 5) */
  failureThreshold: number;
  /** Time in milliseconds to keep circuit open before testing (default: 60000 = 60s) */
  resetTimeoutMs: number;
  /** Base delay for exponential backoff in milliseconds (default: 100) */
  baseDelayMs: number;
  /** Maximum delay for exponential backoff in milliseconds (default: 30000 = 30s) */
  maxDelayMs: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier: number;
  /** Jitter factor as percentage (0-1, default: 0.1 for ±10%) */
  jitterFactor: number;
  /** Number of successful requests in half-open to close circuit (default: 1) */
  successThreshold: number;
  /** Name for logging and metrics (default: 'claude') */
  name: string;
}

/**
 * Circuit breaker health information
 */
export interface CircuitBreakerHealth {
  state: CircuitBreakerState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  lastFailure?: Date;
  lastSuccess?: Date;
  lastError?: string;
  totalFailures: number;
  totalSuccesses: number;
  stateChanges: number;
  timeInCurrentState: number;
}

/**
 * Default circuit breaker configuration aligned with issue requirements
 * Exponential backoff: 100ms, 200ms, 400ms, 800ms... max 30s
 * Circuit opens after 5 consecutive failures
 * Stays open for 60s before half-open test
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60000,
  baseDelayMs: 100,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitterFactor: 0.1,
  successThreshold: 1,
  name: 'claude',
};

/**
 * Circuit Breaker implementation for Claude API calls
 */
export class CircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitBreakerState = 'closed';
  private consecutiveFailures: number = 0;
  private consecutiveSuccesses: number = 0;
  private lastFailureTime?: Date;
  private lastSuccessTime?: Date;
  private lastErrorMessage?: string;
  private lastStateChangeTime: Date;
  private totalFailures: number = 0;
  private totalSuccesses: number = 0;
  private stateChangeCount: number = 0;
  private log: ReturnType<typeof logger.child>;

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
    this.lastStateChangeTime = new Date();
    this.log = logger.child(`CircuitBreaker-${this.config.name}`);

    this.log.debug('Circuit breaker initialized', {
      config: this.config,
    });
  }

  /**
   * Get the current circuit breaker state
   */
  getState(): CircuitBreakerState {
    return this.state;
  }

  /**
   * Get circuit breaker health status
   */
  getHealth(): CircuitBreakerHealth {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastFailure: this.lastFailureTime,
      lastSuccess: this.lastSuccessTime,
      lastError: this.lastErrorMessage,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      stateChanges: this.stateChangeCount,
      timeInCurrentState: Date.now() - this.lastStateChangeTime.getTime(),
    };
  }

  /**
   * Check if the circuit allows requests
   */
  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      const timeSinceFailure = this.lastFailureTime
        ? Date.now() - this.lastFailureTime.getTime()
        : Infinity;

      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.transitionTo('half_open');
        return true;
      }

      return false;
    }

    // Half-open: allow single test request
    return true;
  }

  /**
   * Calculate exponential backoff delay with jitter
   */
  calculateBackoffDelay(attempt: number): number {
    // Calculate base delay: 100ms * 2^attempt = 100, 200, 400, 800, 1600...
    const baseDelay = this.config.baseDelayMs * Math.pow(this.config.backoffMultiplier, attempt);

    // Add jitter (±jitterFactor%)
    const jitter = baseDelay * this.config.jitterFactor * (Math.random() * 2 - 1);
    const delay = baseDelay + jitter;

    // Clamp to max delay
    return Math.min(Math.max(0, delay), this.config.maxDelayMs);
  }

  /**
   * Record a successful request
   */
  recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.lastSuccessTime = new Date();
    this.totalSuccesses++;

    if (this.state === 'half_open') {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }

    // Record metrics
    metrics.recordCircuitBreakerSuccess(this.config.name);
  }

  /**
   * Record a failed request
   */
  recordFailure(error: Error): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    this.lastFailureTime = new Date();
    this.lastErrorMessage = error.message;
    this.totalFailures++;

    // Record metrics
    metrics.recordCircuitBreakerFailure(this.config.name, error.message);

    if (this.state === 'half_open') {
      // Single failure in half-open trips the circuit again
      this.transitionTo('open');
    } else if (this.state === 'closed' && this.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitBreakerState): void {
    const previousState = this.state;
    this.state = newState;
    this.lastStateChangeTime = new Date();
    this.stateChangeCount++;

    // Reset counters on state change
    if (newState === 'half_open') {
      this.consecutiveSuccesses = 0;
    }

    // Log state transition
    this.log.info(`Circuit breaker state transition: ${previousState} -> ${newState}`, {
      previousState,
      newState,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      lastError: this.lastErrorMessage,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
    });

    // Record state change metric
    metrics.recordCircuitBreakerStateChange(this.config.name, previousState, newState);
  }

  /**
   * Create a circuit breaker error
   */
  createCircuitOpenError(context?: ErrorContext): ClaudeError {
    const timeUntilRetry = this.lastFailureTime
      ? Math.max(0, this.config.resetTimeoutMs - (Date.now() - this.lastFailureTime.getTime()))
      : this.config.resetTimeoutMs;

    return new ClaudeError(
      ErrorCode.CIRCUIT_BREAKER_OPEN,
      `Claude API circuit breaker is open. Service unavailable. Will retry in ${Math.ceil(timeUntilRetry / 1000)}s`,
      {
        context: {
          ...context,
          circuitState: this.state,
          consecutiveFailures: this.consecutiveFailures,
          lastFailure: this.lastFailureTime?.toISOString(),
          lastError: this.lastErrorMessage,
          timeUntilRetryMs: timeUntilRetry,
        },
      }
    );
  }

  /**
   * Reset the circuit breaker (for testing or manual recovery)
   */
  reset(): void {
    const previousState = this.state;
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.lastStateChangeTime = new Date();

    this.log.info('Circuit breaker manually reset', {
      previousState,
      newState: 'closed',
    });
  }

  /**
   * Execute an operation with circuit breaker protection
   */
  async execute<T>(
    operation: () => Promise<T>,
    options: {
      operationName?: string;
      context?: ErrorContext;
    } = {}
  ): Promise<T> {
    const operationName = options.operationName ?? 'operation';

    // Check if circuit allows execution
    if (!this.canExecute()) {
      const error = this.createCircuitOpenError(options.context);
      this.log.warn(`${operationName}: Request blocked by circuit breaker`, {
        circuitState: this.state,
        lastFailure: this.lastFailureTime?.toISOString(),
        consecutiveFailures: this.consecutiveFailures,
      });
      throw error;
    }

    try {
      const result = await operation();
      this.recordSuccess();
      return result;
    } catch (error) {
      this.recordFailure(error as Error);
      throw error;
    }
  }

  /**
   * Execute an operation with circuit breaker and exponential backoff retry
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    options: {
      maxRetries?: number;
      operationName?: string;
      context?: ErrorContext;
      shouldRetry?: (error: Error) => boolean;
      onRetry?: (error: Error, attempt: number, delay: number) => void;
    } = {}
  ): Promise<T> {
    const maxRetries = options.maxRetries ?? 5;
    const operationName = options.operationName ?? 'operation';
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      // Check if circuit allows execution
      if (!this.canExecute()) {
        const error = this.createCircuitOpenError(options.context);
        this.log.warn(`${operationName}: Request blocked by circuit breaker (attempt ${attempt + 1})`, {
          circuitState: this.state,
          consecutiveFailures: this.consecutiveFailures,
        });
        throw error;
      }

      try {
        const result = await operation();
        this.recordSuccess();
        return result;
      } catch (error) {
        lastError = error as Error;
        this.recordFailure(lastError);

        // Check if we should retry
        const shouldRetry = options.shouldRetry?.(lastError) ?? this.isRetryableError(lastError);

        if (!shouldRetry || attempt >= maxRetries) {
          this.log.debug(`${operationName}: Not retrying`, {
            attempt: attempt + 1,
            maxRetries,
            isRetryable: shouldRetry,
            circuitState: this.state,
          });
          throw lastError;
        }

        // Check if circuit is now open
        if (!this.canExecute()) {
          this.log.warn(`${operationName}: Circuit opened during retry`, {
            attempt: attempt + 1,
            consecutiveFailures: this.consecutiveFailures,
          });
          throw this.createCircuitOpenError(options.context);
        }

        // Calculate and wait for backoff delay
        const delay = this.calculateBackoffDelay(attempt);

        this.log.warn(`${operationName}: Retry attempt ${attempt + 1}/${maxRetries}`, {
          error: lastError.message,
          delayMs: Math.round(delay),
          circuitState: this.state,
          consecutiveFailures: this.consecutiveFailures,
        });

        options.onRetry?.(lastError, attempt + 1, delay);

        await this.sleep(delay);
      }
    }

    // Should not reach here, but TypeScript needs it
    throw lastError;
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: Error): boolean {
    // Check for explicit retryable flag
    const isRetryable = getIsRetryable(error);
    if (typeof isRetryable === 'boolean') {
      return isRetryable;
    }

    // Check error message for common retryable patterns
    const message = error.message.toLowerCase();
    if (
      message.includes('rate limit') ||
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('connection') ||
      message.includes('overloaded') ||
      message.includes('temporarily unavailable') ||
      message.includes('503') ||
      message.includes('502') ||
      message.includes('504') ||
      message.includes('429')
    ) {
      return true;
    }

    // Check for HTTP status codes
    const status = getHttpStatusCode(error);
    if (status !== undefined) {
      if (status === 429 || status === 502 || status === 503 || status === 504 || status >= 500) {
        return true;
      }
    }

    return false;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Singleton circuit breaker instance for Claude API calls
 */
let claudeCircuitBreaker: CircuitBreaker | undefined;

/**
 * Get or create the Claude API circuit breaker instance
 */
export function getClaudeCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!claudeCircuitBreaker) {
    claudeCircuitBreaker = new CircuitBreaker({
      ...config,
      name: 'claude-api',
    });
  }
  return claudeCircuitBreaker;
}

/**
 * Singleton circuit breaker instance for Claude Agent SDK calls
 */
let claudeSDKCircuitBreaker: CircuitBreaker | undefined;

/**
 * Get or create the Claude Agent SDK circuit breaker instance
 */
export function getClaudeSDKCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker {
  if (!claudeSDKCircuitBreaker) {
    claudeSDKCircuitBreaker = new CircuitBreaker({
      ...config,
      name: 'claude-sdk',
    });
  }
  return claudeSDKCircuitBreaker;
}

/**
 * Reset all circuit breaker instances (for testing)
 */
export function resetAllCircuitBreakers(): void {
  claudeCircuitBreaker?.reset();
  claudeSDKCircuitBreaker?.reset();
}

/**
 * Get health of all circuit breakers
 */
export function getAllCircuitBreakerHealth(): Record<string, CircuitBreakerHealth> {
  const health: Record<string, CircuitBreakerHealth> = {};

  if (claudeCircuitBreaker) {
    health['claude-api'] = claudeCircuitBreaker.getHealth();
  }
  if (claudeSDKCircuitBreaker) {
    health['claude-sdk'] = claudeSDKCircuitBreaker.getHealth();
  }

  return health;
}
