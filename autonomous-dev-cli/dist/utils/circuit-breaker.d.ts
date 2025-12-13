/**
 * Circuit Breaker pattern implementation for Claude Agent SDK calls.
 * Provides resilience against API failures, rate limiting, and service unavailability.
 *
 * States:
 * - CLOSED: Normal operation, requests pass through
 * - OPEN: Circuit is tripped, requests are rejected immediately
 * - HALF_OPEN: Testing if service has recovered, allows limited test requests
 */
import { ClaudeError, type ErrorContext } from './errors.js';
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
export declare const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig;
/**
 * Circuit Breaker implementation for Claude API calls
 */
export declare class CircuitBreaker {
    private config;
    private state;
    private consecutiveFailures;
    private consecutiveSuccesses;
    private lastFailureTime?;
    private lastSuccessTime?;
    private lastErrorMessage?;
    private lastStateChangeTime;
    private totalFailures;
    private totalSuccesses;
    private stateChangeCount;
    private log;
    constructor(config?: Partial<CircuitBreakerConfig>);
    /**
     * Get the current circuit breaker state
     */
    getState(): CircuitBreakerState;
    /**
     * Get circuit breaker health status
     */
    getHealth(): CircuitBreakerHealth;
    /**
     * Check if the circuit allows requests
     */
    canExecute(): boolean;
    /**
     * Calculate exponential backoff delay with jitter
     */
    calculateBackoffDelay(attempt: number): number;
    /**
     * Record a successful request
     */
    recordSuccess(): void;
    /**
     * Record a failed request
     */
    recordFailure(error: Error): void;
    /**
     * Transition to a new state
     */
    private transitionTo;
    /**
     * Create a circuit breaker error
     */
    createCircuitOpenError(context?: ErrorContext): ClaudeError;
    /**
     * Reset the circuit breaker (for testing or manual recovery)
     */
    reset(): void;
    /**
     * Execute an operation with circuit breaker protection
     */
    execute<T>(operation: () => Promise<T>, options?: {
        operationName?: string;
        context?: ErrorContext;
    }): Promise<T>;
    /**
     * Execute an operation with circuit breaker and exponential backoff retry
     */
    executeWithRetry<T>(operation: () => Promise<T>, options?: {
        maxRetries?: number;
        operationName?: string;
        context?: ErrorContext;
        shouldRetry?: (error: Error) => boolean;
        onRetry?: (error: Error, attempt: number, delay: number) => void;
    }): Promise<T>;
    /**
     * Check if an error is retryable
     */
    private isRetryableError;
    /**
     * Sleep utility
     */
    private sleep;
}
/**
 * Get or create the Claude API circuit breaker instance
 */
export declare function getClaudeCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
/**
 * Get or create the Claude Agent SDK circuit breaker instance
 */
export declare function getClaudeSDKCircuitBreaker(config?: Partial<CircuitBreakerConfig>): CircuitBreaker;
/**
 * Reset all circuit breaker instances (for testing)
 */
export declare function resetAllCircuitBreakers(): void;
/**
 * Get health of all circuit breakers
 */
export declare function getAllCircuitBreakerHealth(): Record<string, CircuitBreakerHealth>;
//# sourceMappingURL=circuit-breaker.d.ts.map