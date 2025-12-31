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
import { getStatusCode, getErrorCode } from '../errorTypes.js';

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

/**
 * Image generation provider types for per-provider circuit breakers.
 */
export type ImageGenProvider = 'openrouter' | 'cometapi' | 'google';

/**
 * Image generation circuit breaker configuration.
 * Per-provider circuit breakers since providers fail independently.
 * - 3 consecutive failures to open (balanced sensitivity)
 * - 45 second reset timeout (allow rate limits to clear)
 * - 2 successes in half-open to close
 */
export function getImageGenCircuitBreakerConfig(provider: ImageGenProvider): Partial<CircuitBreakerConfig> {
  return {
    name: `image-gen:${provider}`,
    failureThreshold: 3,
    successThreshold: 2,
    resetTimeoutMs: 45000,
    halfOpenMaxAttempts: 2,
  };
}

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
    const statusCode = getStatusCode(error);

    // Don't retry client errors (except rate limits)
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
      return false;
    }

    // Retry rate limits, server errors, and network issues
    if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
      return true;
    }

    // Retry network errors
    const code = getErrorCode(error);
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
    const statusCode = getStatusCode(error);

    // Don't retry auth errors
    if (statusCode === 401 || statusCode === 403) {
      return false;
    }

    // Don't retry validation errors
    if (statusCode === 400 || statusCode === 422) {
      return false;
    }

    // Retry rate limits and server errors
    if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
      return true;
    }

    // Retry network errors
    const code = getErrorCode(error);
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

/**
 * Image generation API retry configuration.
 * Moderate retries with exponential backoff, aware of rate limits.
 */
export const IMAGE_GEN_RETRY_CONFIG: Partial<RetryConfig> = {
  maxRetries: 3,
  baseDelayMs: 1500,
  maxDelayMs: 20000,
  backoffMultiplier: 2,
  useJitter: true,
  jitterFactor: 0.3,
  operationName: 'image-gen-api',
  isRetryable: (error: Error) => {
    const statusCode = getStatusCode(error);

    // Don't retry auth errors
    if (statusCode === 401 || statusCode === 403) {
      return false;
    }

    // Don't retry validation/bad request errors
    if (statusCode === 400 || statusCode === 422) {
      return false;
    }

    // Don't retry content policy violations (often 451 or similar)
    if (statusCode === 451) {
      return false;
    }

    // Retry rate limits and server errors
    if (statusCode === 429 || (statusCode !== undefined && statusCode >= 500)) {
      return true;
    }

    // Retry network errors
    const code = getErrorCode(error);
    if (code === 'ENOTFOUND' || code === 'ETIMEDOUT' ||
        code === 'ECONNRESET' || code === 'ECONNREFUSED') {
      return true;
    }

    const message = error.message.toLowerCase();
    return message.includes('network') ||
           message.includes('timeout') ||
           message.includes('connection') ||
           message.includes('temporarily unavailable') ||
           message.includes('service unavailable');
  },
};

// =============================================================================
// Circuit Breaker Initialization
// =============================================================================

let initialized = false;

/**
 * Image generation providers to initialize circuit breakers for.
 */
const IMAGE_GEN_PROVIDERS: ImageGenProvider[] = ['openrouter', 'cometapi', 'google'];

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

  // Get or create image generation circuit breakers (per-provider)
  const imageGenBreakers = IMAGE_GEN_PROVIDERS.map(provider => ({
    provider,
    breaker: circuitBreakerRegistry.get(`image-gen:${provider}`, getImageGenCircuitBreakerConfig(provider)),
  }));

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

  // Register state change listeners for image generation providers
  for (const { provider, breaker } of imageGenBreakers) {
    breaker.onStateChange((newState, prevState) => {
      logger.warn(`Circuit breaker [image-gen:${provider}] state changed: ${prevState} -> ${newState}`, {
        component: 'ExternalApiResilience',
        circuitName: `image-gen:${provider}`,
        provider,
        prevState,
        newState,
      });
    });
  }

  initialized = true;
  logger.info('External API resilience initialized', {
    component: 'ExternalApiResilience',
    circuitBreakers: [
      'github',
      'claude-remote',
      ...IMAGE_GEN_PROVIDERS.map(p => `image-gen:${p}`),
    ],
  });
}

/**
 * Reset the initialization state. Use for testing only.
 * This allows re-initialization in test scenarios.
 */
export function resetExternalApiResilienceForTesting(): void {
  initialized = false;
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
 * Wrap an image generation API call with retry and circuit breaker patterns.
 * Uses per-provider circuit breakers since different providers fail independently.
 *
 * @param provider - The image generation provider (openrouter, cometapi, google)
 * @param operation - The image generation API operation to execute
 * @param operationName - Name of the operation for logging
 * @returns The result of the operation
 * @throws Error if all retries fail and circuit breaker rejects
 */
export async function withImageGenResilience<T>(
  provider: ImageGenProvider,
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const config = getImageGenCircuitBreakerConfig(provider);
  const breaker = circuitBreakerRegistry.get(`image-gen:${provider}`, config);

  const result = await breaker.execute(async () => {
    return withRetry(operation, {
      ...IMAGE_GEN_RETRY_CONFIG,
      operationName: `image-gen:${provider}:${operationName}`,
    });
  });

  if (result.success && result.data !== undefined) {
    return result.data;
  }

  if (result.wasRejected) {
    logger.error(`Image generation API call rejected by circuit breaker: ${provider}/${operationName}`, {
      component: 'ExternalApiResilience',
      operationName,
      provider,
      circuitState: breaker.getState(),
    });
    throw new Error(`Image generation provider ${provider} temporarily unavailable (circuit breaker open). Please try again later.`);
  }

  throw result.error || new Error(`Image generation API call failed: ${provider}/${operationName}`);
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

type CircuitBreakerStats = ReturnType<typeof circuitBreakerRegistry.getAllStats>[string];

/**
 * Get the current status of all external API circuit breakers.
 * Useful for health check endpoints.
 */
export function getExternalApiCircuitBreakerStatus(): {
  github: { state: string; stats: CircuitBreakerStats };
  claudeRemote: { state: string; stats: CircuitBreakerStats };
  imageGen: Record<ImageGenProvider, { state: string; stats: CircuitBreakerStats }>;
} {
  const githubBreaker = circuitBreakerRegistry.get('github', GITHUB_CIRCUIT_BREAKER_CONFIG);
  const claudeRemoteBreaker = circuitBreakerRegistry.get('claude-remote', CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG);

  const imageGenStatus = {} as Record<ImageGenProvider, { state: string; stats: CircuitBreakerStats }>;
  for (const provider of IMAGE_GEN_PROVIDERS) {
    const breaker = circuitBreakerRegistry.get(`image-gen:${provider}`, getImageGenCircuitBreakerConfig(provider));
    imageGenStatus[provider] = {
      state: breaker.getState(),
      stats: breaker.getStats(),
    };
  }

  return {
    github: {
      state: githubBreaker.getState(),
      stats: githubBreaker.getStats(),
    },
    claudeRemote: {
      state: claudeRemoteBreaker.getState(),
      stats: claudeRemoteBreaker.getStats(),
    },
    imageGen: imageGenStatus,
  };
}

/**
 * Check if external APIs are available (circuit breakers not open).
 */
export function areExternalApisAvailable(): {
  github: boolean;
  claudeRemote: boolean;
  imageGen: Record<ImageGenProvider, boolean>;
} {
  const githubBreaker = circuitBreakerRegistry.get('github', GITHUB_CIRCUIT_BREAKER_CONFIG);
  const claudeRemoteBreaker = circuitBreakerRegistry.get('claude-remote', CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG);

  const imageGenAvailable = {} as Record<ImageGenProvider, boolean>;
  for (const provider of IMAGE_GEN_PROVIDERS) {
    const breaker = circuitBreakerRegistry.get(`image-gen:${provider}`, getImageGenCircuitBreakerConfig(provider));
    imageGenAvailable[provider] = !breaker.isOpen();
  }

  return {
    github: !githubBreaker.isOpen(),
    claudeRemote: !claudeRemoteBreaker.isOpen(),
    imageGen: imageGenAvailable,
  };
}

/**
 * Check if a specific image generation provider is available.
 */
export function isImageGenProviderAvailable(provider: ImageGenProvider): boolean {
  const breaker = circuitBreakerRegistry.get(`image-gen:${provider}`, getImageGenCircuitBreakerConfig(provider));
  return !breaker.isOpen();
}

/**
 * Reset a specific circuit breaker (use with caution, mainly for testing).
 */
export function resetCircuitBreaker(name: 'github' | 'claude-remote' | `image-gen:${ImageGenProvider}`): void {
  let config: Partial<CircuitBreakerConfig>;

  if (name === 'github') {
    config = GITHUB_CIRCUIT_BREAKER_CONFIG;
  } else if (name === 'claude-remote') {
    config = CLAUDE_REMOTE_CIRCUIT_BREAKER_CONFIG;
  } else if (name.startsWith('image-gen:')) {
    const provider = name.replace('image-gen:', '') as ImageGenProvider;
    config = getImageGenCircuitBreakerConfig(provider);
  } else {
    throw new Error(`Unknown circuit breaker: ${name}`);
  }

  const breaker = circuitBreakerRegistry.get(name, config);
  breaker.reset();

  logger.info(`Circuit breaker [${name}] manually reset`, {
    component: 'ExternalApiResilience',
    circuitName: name,
  });
}
