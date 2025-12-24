import { AService } from '../../services/abstracts/AService.js';
import type { ICircuitBreaker } from './circuitBreaker.doc.js';
import type { ICircuitBreakerRegistry } from './circuitBreaker.doc.js';
import type { CircuitState } from './circuitBreaker.doc.js';
import type { CircuitBreakerConfig } from './circuitBreaker.doc.js';
import type { CircuitBreakerStats } from './circuitBreaker.doc.js';
import type { CircuitBreakerResult } from './circuitBreaker.doc.js';

export type { CircuitState, CircuitBreakerConfig, CircuitBreakerStats, CircuitBreakerResult } from './circuitBreaker.doc.js';

export abstract class ACircuitBreaker extends AService implements ICircuitBreaker {
  abstract onStateChange(listener: (state: CircuitState, prevState: CircuitState) => void): void;

  abstract getStats(): CircuitBreakerStats;

  abstract canExecute(): boolean;

  abstract execute<T>(operation: () => Promise<T>): Promise<CircuitBreakerResult<T>>;

  abstract executeWithFallback<T>(
    operation: () => Promise<T>,
    fallback: T
  ): Promise<{ value: T; degraded: boolean }>;

  abstract reset(): void;

  abstract isOpen(): boolean;

  abstract isClosed(): boolean;

  abstract getState(): CircuitState;

  abstract getName(): string;
}

export abstract class ACircuitBreakerRegistry extends AService implements ICircuitBreakerRegistry {
  override readonly order: number = -40;

  abstract get(name: string, config?: Partial<CircuitBreakerConfig>): ACircuitBreaker;

  abstract getAllStats(): Record<string, CircuitBreakerStats>;

  abstract resetAll(): void;

  abstract size(): number;
}
