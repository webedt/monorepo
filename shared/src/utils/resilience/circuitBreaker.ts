/**
 * Circuit Breaker Pattern Implementation
 *
 * Provides protection against cascading failures when external services fail.
 * The circuit breaker has three states:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if service has recovered
 */

import type {
  ICircuitBreaker,
  ICircuitBreakerRegistry,
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitBreakerResult,
} from './ICircuitBreaker.js';
import { logger } from '../logging/logger.js';

// Re-export types from interface for backwards compatibility
export type {
  CircuitState,
  CircuitBreakerConfig,
  CircuitBreakerStats,
  CircuitBreakerResult,
} from './ICircuitBreaker.js';

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
  name: 'default',
};

export class CircuitBreaker implements ICircuitBreaker {
  private config: CircuitBreakerConfig;
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalSuccesses = 0;
  private totalFailures = 0;
  private lastFailureTime: Date | null = null;
  private lastSuccessTime: Date | null = null;
  private lastError: string | null = null;
  private halfOpenAttempts = 0;
  private stateChangeListeners: ((state: CircuitState, prevState: CircuitState) => void)[] = [];

  constructor(config: Partial<CircuitBreakerConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register a listener for state changes
   */
  onStateChange(listener: (state: CircuitState, prevState: CircuitState) => void): void {
    this.stateChangeListeners.push(listener);
  }

  /**
   * Get the current circuit breaker statistics
   */
  getStats(): CircuitBreakerStats {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalSuccesses: this.totalSuccesses,
      totalFailures: this.totalFailures,
      lastFailureTime: this.lastFailureTime,
      lastSuccessTime: this.lastSuccessTime,
      lastError: this.lastError,
      halfOpenAttempts: this.halfOpenAttempts,
    };
  }

  /**
   * Check if requests can be made
   */
  canExecute(): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open') {
      // Check if enough time has passed to try half-open
      const timeSinceFailure = this.lastFailureTime
        ? Date.now() - this.lastFailureTime.getTime()
        : Infinity;

      if (timeSinceFailure >= this.config.resetTimeoutMs) {
        this.transitionTo('half_open');
        return true;
      }
      return false;
    }

    // Half-open state: allow limited attempts
    return this.halfOpenAttempts < this.config.halfOpenMaxAttempts;
  }

  /**
   * Execute an operation through the circuit breaker
   */
  async execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>> {
    if (!this.canExecute()) {
      logger.warn(`Circuit breaker [${this.config.name}] rejected request - circuit is open`, {
        component: 'CircuitBreaker',
        circuitName: this.config.name,
        state: this.state,
        lastFailureTime: this.lastFailureTime?.toISOString(),
      });

      return {
        success: false,
        wasRejected: true,
        error: new Error(`Circuit breaker [${this.config.name}] is open - request rejected`),
      };
    }

    if (this.state === 'half_open') {
      this.halfOpenAttempts++;
    }

    try {
      const data = await operation();
      this.recordSuccess();
      return { success: true, data, wasRejected: false };
    } catch (error) {
      this.recordFailure(error as Error);
      return { success: false, error: error as Error, wasRejected: false };
    }
  }

  /**
   * Execute with fallback - returns fallback value if circuit is open or operation fails
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T
  ): Promise<{ value: T; degraded: boolean }> {
    const result = await this.execute(operation);

    if (result.success && result.data !== undefined) {
      return { value: result.data, degraded: false };
    }

    logger.warn(`Circuit breaker [${this.config.name}] using fallback value`, {
      component: 'CircuitBreaker',
      circuitName: this.config.name,
      state: this.state,
      wasRejected: result.wasRejected,
      error: result.error?.message,
    });

    return { value: fallback, degraded: true };
  }

  /**
   * Record a successful operation
   */
  private recordSuccess(): void {
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses++;
    this.totalSuccesses++;
    this.lastSuccessTime = new Date();

    if (this.state === 'half_open') {
      if (this.consecutiveSuccesses >= this.config.successThreshold) {
        this.transitionTo('closed');
      }
    }

    logger.debug(`Circuit breaker [${this.config.name}] recorded success`, {
      component: 'CircuitBreaker',
      circuitName: this.config.name,
      state: this.state,
      consecutiveSuccesses: this.consecutiveSuccesses,
    });
  }

  /**
   * Record a failed operation
   */
  private recordFailure(error: Error): void {
    this.consecutiveSuccesses = 0;
    this.consecutiveFailures++;
    this.totalFailures++;
    this.lastFailureTime = new Date();
    this.lastError = error.message;

    logger.warn(`Circuit breaker [${this.config.name}] recorded failure`, {
      component: 'CircuitBreaker',
      circuitName: this.config.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      error: error.message,
    });

    if (this.state === 'half_open') {
      if (this.halfOpenAttempts >= this.config.halfOpenMaxAttempts) {
        this.transitionTo('open');
      }
    } else if (this.consecutiveFailures >= this.config.failureThreshold) {
      this.transitionTo('open');
    }
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: CircuitState): void {
    const prevState = this.state;
    if (prevState === newState) return;

    this.state = newState;

    if (newState === 'half_open') {
      this.halfOpenAttempts = 0;
    } else if (newState === 'closed') {
      this.consecutiveFailures = 0;
      this.halfOpenAttempts = 0;
    }

    logger.info(`Circuit breaker [${this.config.name}] state transition: ${prevState} -> ${newState}`, {
      component: 'CircuitBreaker',
      circuitName: this.config.name,
      prevState,
      newState,
    });

    // Notify listeners
    for (const listener of this.stateChangeListeners) {
      try {
        listener(newState, prevState);
      } catch (e) {
        // Ignore listener errors
      }
    }
  }

  /**
   * Manually reset the circuit breaker to closed state
   */
  reset(): void {
    const prevState = this.state;
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this.halfOpenAttempts = 0;

    logger.info(`Circuit breaker [${this.config.name}] manually reset`, {
      component: 'CircuitBreaker',
      circuitName: this.config.name,
      prevState,
    });
  }

  /**
   * Check if the circuit is open (rejecting requests)
   */
  isOpen(): boolean {
    return this.state === 'open';
  }

  /**
   * Check if the circuit is closed (normal operation)
   */
  isClosed(): boolean {
    return this.state === 'closed';
  }

  /**
   * Get the current state
   */
  getState(): CircuitState {
    return this.state;
  }

  /**
   * Get the circuit breaker name
   */
  getName(): string {
    return this.config.name;
  }
}

/**
 * Create a circuit breaker instance
 */
export function createCircuitBreaker(config: Partial<CircuitBreakerConfig> = {}): ICircuitBreaker {
  return new CircuitBreaker(config);
}

/**
 * Circuit breaker registry for managing multiple breakers
 */
class CircuitBreakerRegistry implements ICircuitBreakerRegistry {
  private breakers: Map<string, ICircuitBreaker> = new Map();

  /**
   * Get or create a circuit breaker by name
   */
  get(name: string, config?: Partial<CircuitBreakerConfig>): ICircuitBreaker {
    let breaker = this.breakers.get(name);
    if (!breaker) {
      breaker = createCircuitBreaker({ ...config, name });
      this.breakers.set(name, breaker);
    }
    return breaker;
  }

  /**
   * Get all circuit breaker statistics
   */
  getAllStats(): Record<string, CircuitBreakerStats> {
    const stats: Record<string, CircuitBreakerStats> = {};
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    return stats;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get the number of registered circuit breakers
   */
  size(): number {
    return this.breakers.size;
  }
}

// Global registry instance
export const circuitBreakerRegistry: ICircuitBreakerRegistry = new CircuitBreakerRegistry();
