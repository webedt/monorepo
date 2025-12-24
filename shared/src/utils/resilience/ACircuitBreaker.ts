/**
 * Abstract Circuit Breaker Service
 *
 * Base class for protection against cascading failures when external services fail.
 *
 * @see CircuitBreaker for the concrete implementation
 */
import { AService } from '../../services/abstracts/AService.js';

/**
 * Circuit breaker states.
 */
export type CircuitState = 'closed' | 'open' | 'half_open';

/**
 * Configuration options for circuit breaker.
 */
export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  resetTimeoutMs: number;
  halfOpenMaxAttempts: number;
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
 * Abstract circuit breaker service.
 */
export abstract class ACircuitBreaker extends AService {
  /**
   * Register a listener for state changes.
   */
  abstract onStateChange(listener: (state: CircuitState, prevState: CircuitState) => void): void;

  /**
   * Get the current circuit breaker statistics.
   */
  abstract getStats(): CircuitBreakerStats;

  /**
   * Check if requests can be made.
   */
  abstract canExecute(): boolean;

  /**
   * Execute an operation through the circuit breaker.
   */
  abstract execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>>;

  /**
   * Execute with fallback - returns fallback value if circuit is open or operation fails.
   */
  abstract executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T
  ): Promise<{ value: T; degraded: boolean }>;

  /**
   * Manually reset the circuit breaker to closed state.
   */
  abstract reset(): void;

  /**
   * Check if the circuit is open (rejecting requests).
   */
  abstract isOpen(): boolean;

  /**
   * Check if the circuit is closed (normal operation).
   */
  abstract isClosed(): boolean;

  /**
   * Get the current state.
   */
  abstract getState(): CircuitState;

  /**
   * Get the circuit breaker name.
   */
  abstract getName(): string;
}

/**
 * Abstract registry for managing multiple circuit breakers.
 */
export abstract class ACircuitBreakerRegistry extends AService {
  override readonly order: number = -40; // Initialize early

  /**
   * Get or create a circuit breaker by name.
   */
  abstract get(name: string, config?: Partial<CircuitBreakerConfig>): ACircuitBreaker;

  /**
   * Get all circuit breaker statistics.
   */
  abstract getAllStats(): Record<string, CircuitBreakerStats>;

  /**
   * Reset all circuit breakers.
   */
  abstract resetAll(): void;

  /**
   * Get the number of registered circuit breakers.
   */
  abstract size(): number;
}
