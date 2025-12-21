/**
 * Interface for Circuit Breaker Pattern Implementation
 *
 * Defines the contract for protection against cascading failures
 * when external services fail.
 *
 * @see CircuitBreaker for the implementation
 * @module interfaces/ICircuitBreaker
 */

/**
 * Circuit breaker states.
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Service is failing, requests are rejected immediately
 * - HALF_OPEN: Testing if service has recovered
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Configuration options for circuit breaker.
 */
export interface CircuitBreakerConfig {
  /** Number of consecutive failures before opening the circuit */
  failureThreshold: number;
  /** Number of consecutive successes needed to close the circuit from half-open */
  successThreshold: number;
  /** Time in ms to wait before transitioning from open to half-open */
  resetTimeoutMs: number;
  /** Maximum attempts allowed in half-open state */
  halfOpenMaxAttempts: number;
  /** Name for logging and metrics */
  name: string;
}

/**
 * Statistics about circuit breaker state and history.
 */
export interface CircuitBreakerStats {
  state: CircuitState;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalSuccesses: number;
  totalFailures: number;
  lastFailureTime: Date | null;
  lastSuccessTime: Date | null;
  lastError: string | null;
  halfOpenAttempts: number;
}

/**
 * Result from executing an operation through the circuit breaker.
 */
export interface CircuitBreakerResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  wasRejected: boolean;
}

/**
 * Circuit breaker interface for protecting against cascading failures.
 *
 * @example
 * ```typescript
 * const breaker: ICircuitBreaker = createCircuitBreaker({ name: 'api' });
 *
 * const result = await breaker.execute(async () => {
 *   return await fetch('/api/data');
 * });
 *
 * if (result.success) {
 *   console.log(result.data);
 * }
 * ```
 */
export interface ICircuitBreaker {
  /**
   * Register a listener for state changes.
   *
   * @param listener - Callback invoked when circuit state changes
   */
  onStateChange(listener: (state: CircuitState, prevState: CircuitState) => void): void;

  /**
   * Get the current circuit breaker statistics.
   *
   * @returns Current stats including state, failure counts, timestamps
   */
  getStats(): CircuitBreakerStats;

  /**
   * Check if requests can be made.
   *
   * @returns `true` if circuit allows requests
   */
  canExecute(): boolean;

  /**
   * Execute an operation through the circuit breaker.
   *
   * @param operation - Async function to execute
   * @returns Result with success status and data or error
   */
  execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>>;

  /**
   * Execute with fallback - returns fallback value if circuit is open
   * or operation fails.
   *
   * @param operation - Async function to execute
   * @param fallback - Value to return if operation fails
   * @returns Object with value and degraded flag
   */
  executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T
  ): Promise<{ value: T; degraded: boolean }>;

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset(): void;

  /**
   * Check if the circuit is open (rejecting requests).
   *
   * @returns `true` if circuit is open
   */
  isOpen(): boolean;

  /**
   * Check if the circuit is closed (normal operation).
   *
   * @returns `true` if circuit is closed
   */
  isClosed(): boolean;

  /**
   * Get the current state.
   *
   * @returns Current circuit state
   */
  getState(): CircuitState;

  /**
   * Get the circuit breaker name.
   *
   * @returns Circuit breaker name
   */
  getName(): string;
}

/**
 * Registry interface for managing multiple circuit breakers.
 */
export interface ICircuitBreakerRegistry {
  /**
   * Get or create a circuit breaker by name.
   *
   * @param name - Circuit breaker name
   * @param config - Optional configuration
   * @returns Circuit breaker instance
   */
  get(name: string, config?: Partial<CircuitBreakerConfig>): ICircuitBreaker;

  /**
   * Get all circuit breaker statistics.
   *
   * @returns Map of circuit name to stats
   */
  getAllStats(): Record<string, CircuitBreakerStats>;

  /**
   * Reset all circuit breakers.
   */
  resetAll(): void;

  /**
   * Get the number of registered circuit breakers.
   *
   * @returns Count of circuit breakers
   */
  size(): number;
}
