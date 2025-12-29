/**
 * External API Resilience
 *
 * Provides pre-configured circuit breakers and retry wrappers for external API calls.
 * This module integrates circuit breaker and retry patterns specifically for:
 * - GitHub API calls (Octokit)
 * - Claude Remote API calls
 *
 * Usage:
 * ```typescript
 * import { withGitHubResilience, withClaudeRemoteResilience } from './externalApiResilience.js';
 *
 * // Wrap GitHub API call
 * const repos = await withGitHubResilience(
 *   () => octokit.repos.listForAuthenticatedUser(),
 *   'listRepos'
 * );
 *
 * // Wrap Claude Remote API call
 * const session = await withClaudeRemoteResilience(
 *   () => client.createSession(params),
 *   'createSession'
 * );
 * ```
 */

import { circuitBreakerRegistry } from './circuitBreaker.js';
import { withRetry, RETRY_CONFIGS } from './retry.js';
import type { CircuitBreakerConfig } from './ACircuitBreaker.js';
import type { RetryConfig } from './retry.js';
import { logger } from '../logging/logger.js';

// =============================================================================
// Circuit Breaker Configurations
// =============================================================================

/**
 * GitHub API circuit breaker configuration.
 * - 5 consecutive failures to open (GitHub is generally stable)
 * - 30 second reset timeout
 * - 3 successes in half-open to close
 */
export const GITHUB_CIRCUIT_BREAKER_CONFIG: Partial<CircuitBreakerConfig> = {
  name: 'github',
  failureThreshold: 5,
  successThreshold: 3,
  resetTimeoutMs: 30000,
  halfOpenMaxAttempts: 3,
};

/**
 * Claude Remote API circuit breaker configuration.
 * - 3 consecutive failures to open (more sensitive due to importance)
 * - 60 second reset timeout (longer to allow rate limits to clear)
 * - 2 successes in half-open to close
 */
export const CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG: Partial<CircuitBreakerConfig> = {
  name: 'claude-remote',
  failureThreshold: 3,
  successThreshold: 2,
  resetTimeoutMs: 60000,
  halfOpenMaxAttempts: 2,
};

// =============================================================================
// Retry Configurations
// =============================================================================

/**
 * GitHub API retry configuration.
 * Based on RETRY_CONFIGS.rateLimitAware with GitHub-specific adjustments.
 */
export const GITHUB_RETRY_CONFIG: Partial<RetryConfig> = {
  ...RETRY_CONFIGS.rateLimitAware,
  operationName: 'github-api',
  isRetryable: (error: Error) => {
    const statusCode = (error as any).status || (error as any).statusCode;

    // Don't retry client errors (except rate limits)
    if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return false;
    }

    // Retry rate limits, server errors, and network issues
    if (statusCode === 429 || statusCode >= 500) {
      return true;
    }

    // Retry network errors
    const code = (error as any).code;
    if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
        code === 'ECONNRESET' || code === 'ECONNREFUSED') {
      return true;
    }

    const message = error.message.toLowerCase();
    return message.includes('network') ||
           message.includes('timeout') ||
           message.includes('connection');
  },
};

/**
 * Claude Remote API retry configuration.
 * More conservative with longer delays due to rate limiting.
 */
export const CLAUDE_REMOTE_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 2000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  useJitter: true,
  jitterFactor: 0.3,
  operationName: 'claude-remote-api',
  isRetryable: (error: Error) => {
    const statusCode = (error as any).status || (error as any).statusCode;

    // Don't retry auth errors
    if (statusCode === 401 || statusCode === 403) {
      return false;
    }

    // Don't retry validation errors
    if (statusCode === 400 || statusCode === 422) {
      return false;
    }

    // Retry rate limits and server errors
    if (statusCode === 429 || statusCode >= 500) {
      return true;
    }

    // Retry network errors
    const code = (error as any).code;
    if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
        code === 'ECONNRESET' || code === 'ECONNREFUSED') {
      return true;
    }

    const message = error.message.toLowerCase();
    return message.includes('network') ||
           message.includes('timeout') ||
           message.includes('connection') ||
           message.includes('temporarily unavailable');
  },
};

// =============================================================================
// Circuit Breaker Initialization
// =============================================================================

let initialized = false;

/**
 * Initialize external API circuit breakers and register state change listeners.
 * Call this during application startup.
 */
export function initializeExternalApiResilience(): void {
  if (initialized) {
    return;
  }

  // Get or create GitHub circuit breaker
  const githubBreaker = circuitBreakerRegistry.get('github', GITHUB_CIRCUIT_BREAKER_CONFIG);

  // Get or create Claude Remote circuit breaker
  const claudeRemoteBreaker = circuitBreakerRegistry.get('claude-remote', CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG);

  // Register state change listeners for logging/observability
  githubBreaker.onStateChange((newState, prevState) => {
    logger.warn(`Circuit breaker [github] state changed: ${prevState} -> ${newState}`, {
      component: 'ExternalApiResilience',
      circuitName: 'github',
      prevState,
      newState,
    });
  });

  claudeRemoteBreaker.onStateChange((newState, prevState) => {
    logger.warn(`Circuit breaker [claude-remote] state changed: ${prevState} -> ${newState}`, {
      component: 'ExternalApiResilience',
      circuitName: 'claude-remote',
      prevState,
      newState,
    });
  });

  initialized = true;
  logger.info('External API resilience initialized', {
    component: 'ExternalApiResilience',
    circuitBreakers: ['github', 'claude-remote'],
  });
}

// =============================================================================
// Resilience Wrappers
// =============================================================================

/**
 * Wrap a GitHub API call with retry and circuit breaker patterns.
 *
 * @param operation - The GitHub API operation to execute
 * @param operationName - Name of the operation for logging
 * @returns The result of the operation
 * @throws Error if all retries fail and circuit breaker rejects
 */
export async function withGitHubResilience<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const breaker = circuitBreakerRegistry.get('github', GITHUB_CIRCUIT_BREAKER_CONFIG);

  const result = await breaker.execute(async () => {
    return withRetry(operation, {
      ...GITHUB_RETRY_CONFIG,
      operationName: `github:${operationName}`,
    });
  });

  if (result.success && result.data !== undefined) {
    return result.data;
  }

  if (result.wasRejected) {
    logger.error(`GitHub API call rejected by circuit breaker: ${operationName}`, {
      component: 'ExternalApiResilience',
      operationName,
      circuitState: breaker.getState(),
    });
    throw new Error(`GitHub API temporarily unavailable (circuit breaker open). Please try again later.`);
  }

  throw result.error || new Error(`GitHub API call failed: ${operationName}`);
}

/**
 * Wrap a Claude Remote API call with retry and circuit breaker patterns.
 *
 * @param operation - The Claude Remote API operation to execute
 * @param operationName - Name of the operation for logging
 * @returns The result of the operation
 * @throws Error if all retries fail and circuit breaker rejects
 */
export async function withClaudeRemoteResilience<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const breaker = circuitBreakerRegistry.get('claude-remote', CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG);

  const result = await breaker.execute(async () => {
    return withRetry(operation, {
      ...CLAUDE_REMOTE_RETRY_CONFIG,
      operationName: `claude-remote:${operationName}`,
    });
  });

  if (result.success && result.data !== undefined) {
    return result.data;
  }

  if (result.wasRejected) {
    logger.error(`Claude Remote API call rejected by circuit breaker: ${operationName}`, {
      component: 'ExternalApiResilience',
      operationName,
      circuitState: breaker.getState(),
    });
    throw new Error(`Claude Remote API temporarily unavailable (circuit breaker open). Please try again later.`);
  }

  throw result.error || new Error(`Claude Remote API call failed: ${operationName}`);
}

/**
 * Execute an operation with only circuit breaker protection (no retry).
 * Use for operations that should fail fast without retrying.
 *
 * @param circuitName - Name of the circuit breaker to use
 * @param operation - The operation to execute
 * @param operationName - Name of the operation for logging
 */
export async function withCircuitBreakerOnly<T>(
  circuitName: 'github' | 'claude-remote',
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const config = circuitName === 'github'
    ? GITHUB_CIRCUIT_BREAKER_CONFIG
    : CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG;

  const breaker = circuitBreakerRegistry.get(circuitName, config);
  const result = await breaker.execute(operation);

  if (result.success && result.data !== undefined) {
    return result.data;
  }

  if (result.wasRejected) {
    throw new Error(`${circuitName} API temporarily unavailable (circuit breaker open). Please try again later.`);
  }

  throw result.error || new Error(`${circuitName} API call failed: ${operationName}`);
}

/**
 * Execute an operation with only retry protection (no circuit breaker).
 * Use for operations where you want retry but not circuit breaking.
 *
 * @param serviceName - 'github' or 'claude-remote' to select retry config
 * @param operation - The operation to execute
 * @param operationName - Name of the operation for logging
 */
export async function withRetryOnly<T>(
  serviceName: 'github' | 'claude-remote',
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const config = serviceName === 'github'
    ? GITHUB_RETRY_CONFIG
    : CLAUDE_REMOTE_RETRY_CONFIG;

  return withRetry(operation, {
    ...config,
    operationName: `${serviceName}:${operationName}`,
  });
}

// =============================================================================
// Health Check Helpers
// =============================================================================

/**
 * Get the current status of all external API circuit breakers.
 * Useful for health check endpoints.
 */
export function getExternalApiCircuitBreakerStatus(): {
  github: { state: string; stats: ReturnType<typeof circuitBreakerRegistry.getAllStats>[string] };
  claudeRemote: { state: string; stats: ReturnType<typeof circuitBreakerRegistry.getAllStats>[string] };
} {
  const githubBreaker = circuitBreakerRegistry.get('github', GITHUB_CIRCUIT_BREAKER_CONFIG);
  const claudeRemoteBreaker = circuitBreakerRegistry.get('claude-remote', CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG);

  return {
    github: {
      state: githubBreaker.getState(),
      stats: githubBreaker.getStats(),
    },
    claudeRemote: {
      state: claudeRemoteBreaker.getState(),
      stats: claudeRemoteBreaker.getStats(),
    },
  };
}

/**
 * Check if external APIs are available (circuit breakers not open).
 */
export function areExternalApisAvailable(): { github: boolean; claudeRemote: boolean } {
  const githubBreaker = circuitBreakerRegistry.get('github', GITHUB_CIRCUIT_BREAKER_CONFIG);
  const claudeRemoteBreaker = circuitBreakerRegistry.get('claude-remote', CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG);

  return {
    github: !githubBreaker.isOpen(),
    claudeRemote: !claudeRemoteBreaker.isOpen(),
  };
}

/**
 * Reset a specific circuit breaker (use with caution, mainly for testing).
 */
export function resetCircuitBreaker(name: 'github' | 'claude-remote'): void {
  const config = name === 'github'
    ? GITHUB_CIRCUIT_BREAKER_CONFIG
    : CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG;

  const breaker = circuitBreakerRegistry.get(name, config);
  breaker.reset();

  logger.info(`Circuit breaker [${name}] manually reset`, {
    component: 'ExternalApiResilience',
    circuitName: name,
  });
}
