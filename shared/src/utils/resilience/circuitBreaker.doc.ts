/**
 * Circuit Breaker Documentation Interface
 *
 * This file contains the fully-documented interface for the Circuit Breaker service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see ACircuitBreaker for the abstract base class
 * @see CircuitBreaker for the concrete implementation
 */

/**
 * Circuit breaker states.
 *
 * - **closed** - Normal operation, requests pass through
 * - **open** - Service is failing, requests are rejected immediately
 * - **half_open** - Testing if service has recovered
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Configuration options for circuit breaker.
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Number of successes in half-open state to close the circuit */
  successThreshold: number;
  /** Time in ms before attempting to close an open circuit */
  resetTimeoutMs: number;
  /** Maximum attempts allowed in half-open state */
  halfOpenMaxAttempts: number;
  /** Name identifier for this circuit breaker */
  name: string;
}

/**
 * Statistics about circuit breaker state and history.
 */
export interface CircuitBreakerStats {
  /** Current state of the circuit */
  state: CircuitState;
  /** Number of consecutive failures */
  consecutiveFailures: number;
  /** Number of consecutive successes */
  consecutiveSuccesses: number;
  /** Total successful operations */
  totalSuccesses: number;
  /** Total failed operations */
  totalFailures: number;
  /** Timestamp of last failure */
  lastFailureTime: Date | null;
  /** Timestamp of last success */
  lastSuccessTime: Date | null;
  /** Error message from last failure */
  lastError: string | null;
  /** Number of attempts in current half-open state */
  halfOpenAttempts: number;
}

/**
 * Result from executing an operation through the circuit breaker.
 */
export interface CircuitBreakerResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** Result data if successful */
  data?: T;
  /** Error if operation failed */
  error?: Error;
  /** Whether the request was rejected by the circuit breaker */
  wasRejected: boolean;
}

/**
 * Interface for Circuit Breaker with full documentation.
 *
 * Provides protection against cascading failures when external services fail.
 * The circuit breaker monitors operation success/failure rates and automatically
 * rejects requests when a service is unhealthy.
 *
 * ## States
 *
 * - **CLOSED** - Normal operation, requests pass through and are monitored
 * - **OPEN** - Service is failing, requests are rejected immediately
 * - **HALF_OPEN** - Testing if service has recovered with limited requests
 *
 * ## Usage
 *
 * ```typescript
 * import { createCircuitBreaker } from '@webedt/shared';
 *
 * const breaker = createCircuitBreaker({
 *   name: 'api',
 *   failureThreshold: 5,
 *   resetTimeoutMs: 30000,
 * });
 *
 * // Execute through circuit breaker
 * const result = await breaker.execute(async () => {
 *   return await fetch('https://api.example.com/data');
 * });
 *
 * if (result.success) {
 *   console.log(result.data);
 * } else if (result.wasRejected) {
 *   console.log('Circuit is open, request rejected');
 * } else {
 *   console.log('Operation failed:', result.error);
 * }
 *
 * // With fallback value
 * const { value, degraded } = await breaker.executeWithFallback(
 *   () => fetchFromAPI(),
 *   cachedValue
 * );
 * ```
 */
export interface ICircuitBreakerDocumentation {
  /**
   * Register a listener for state changes.
   *
   * @param listener - Callback invoked when state changes
   *
   * @example
   * ```typescript
   * breaker.onStateChange((newState, prevState) => {
   *   console.log(`Circuit ${prevState} -> ${newState}`);
   * });
   * ```
   */
  onStateChange(listener: (state: CircuitState, prevState: CircuitState) => void): void;

  /**
   * Get the current circuit breaker statistics.
   *
   * @returns Current statistics including state and counters
   *
   * @example
   * ```typescript
   * const stats = breaker.getStats();
   * console.log(`State: ${stats.state}, Failures: ${stats.consecutiveFailures}`);
   * ```
   */
  getStats(): CircuitBreakerStats;

  /**
   * Check if requests can be made.
   *
   * Returns true if circuit is closed, or if enough time has passed
   * to transition to half-open state.
   *
   * @returns Whether operations can be attempted
   */
  canExecute(): boolean;

  /**
   * Execute an operation through the circuit breaker.
   *
   * Records success/failure and manages state transitions automatically.
   *
   * @param operation - Async operation to execute
   * @returns Result with success status, data, and rejection info
   *
   * @example
   * ```typescript
   * const result = await breaker.execute(async () => {
   *   return await apiClient.getData();
   * });
   *
   * if (result.success) {
   *   processData(result.data);
   * }
   * ```
   */
  execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>>;

  /**
   * Execute with fallback - returns fallback value if circuit is open or operation fails.
   *
   * @param operation - Async operation to execute
   * @param fallback - Value to return if operation fails
   * @returns Object with value and degraded flag
   *
   * @example
   * ```typescript
   * const { value, degraded } = await breaker.executeWithFallback(
   *   () => fetchLiveData(),
   *   cachedData
   * );
   *
   * if (degraded) {
   *   console.log('Using cached data');
   * }
   * ```
   */
  executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T
  ): Promise<{ value: T; degraded: boolean }>;

  /**
   * Manually reset the circuit breaker to closed state.
   *
   * Clears all failure/success counters and returns to normal operation.
   *
   * @example
   * ```typescript
   * breaker.reset();
   * ```
   */
  reset(): void;

  /**
   * Check if the circuit is open (rejecting requests).
   *
   * @returns True if circuit is in open state
   */
  isOpen(): boolean;

  /**
   * Check if the circuit is closed (normal operation).
   *
   * @returns True if circuit is in closed state
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
   * @returns Circuit breaker identifier
   */
  getName(): string;
}

/**
 * Interface for Circuit Breaker Registry with full documentation.
 *
 * Manages multiple named circuit breakers with automatic creation.
 *
 * ## Usage
 *
 * ```typescript
 * import { circuitBreakerRegistry } from '@webedt/shared';
 *
 * // Get or create a circuit breaker
 * const apiBreaker = circuitBreakerRegistry.get('api');
 * const dbBreaker = circuitBreakerRegistry.get('database', {
 *   failureThreshold: 3,
 * });
 *
 * // Get all stats for monitoring
 * const stats = circuitBreakerRegistry.getAllStats();
 *
 * // Reset all breakers
 * circuitBreakerRegistry.resetAll();
 * ```
 */
export interface ICircuitBreakerRegistryDocumentation {
  /**
   * Get or create a circuit breaker by name.
   *
   * Creates a new circuit breaker if one doesn't exist with the given name.
   *
   * @param name - Unique identifier for the circuit breaker
   * @param config - Optional configuration for new circuit breakers
   * @returns The circuit breaker instance
   *
   * @example
   * ```typescript
   * const breaker = registry.get('external-api', {
   *   failureThreshold: 5,
   *   resetTimeoutMs: 60000,
   * });
   * ```
   */
  get(name: string, config?: Partial<CircuitBreakerConfig>): ICircuitBreakerDocumentation;

  /**
   * Get all circuit breaker statistics.
   *
   * @returns Map of breaker names to their statistics
   *
   * @example
   * ```typescript
   * const allStats = registry.getAllStats();
   * for (const [name, stats] of Object.entries(allStats)) {
   *   console.log(`${name}: ${stats.state}`);
   * }
   * ```
   */
  getAllStats(): Record<string, CircuitBreakerStats>;

  /**
   * Reset all circuit breakers.
   *
   * @example
   * ```typescript
   * registry.resetAll();
   * ```
   */
  resetAll(): void;

  /**
   * Get the number of registered circuit breakers.
   *
   * @returns Count of circuit breakers
   */
  size(): number;
}
