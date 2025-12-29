/**
 * Execution Providers
 *
 * Factory and exports for AI execution providers.
 */

export { ClaudeRemoteProvider } from './claudeRemoteProvider.js';
export { SelfHostedWorkerProvider } from './selfHostedWorkerProvider.js';
export { GeminiProvider } from './geminiProvider.js';
export type {
  ExecutionProvider,
  ExecuteParams,
  ResumeParams,
  ExecutionResult,
  ExecutionEvent,
  ExecutionEventType,
  ExecutionEventCallback,
} from './types.js';
export type { SelfHostedWorkerConfig } from './selfHostedWorkerProvider.js';
export type { GeminiResumeParams } from './geminiProvider.js';

import { ClaudeRemoteProvider } from './claudeRemoteProvider.js';
import { SelfHostedWorkerProvider } from './selfHostedWorkerProvider.js';
import { GeminiProvider } from './geminiProvider.js';
import type { ExecutionProvider } from './types.js';
import { AI_WORKER_ENABLED, AI_WORKER_URL } from '../../config/env.js';
import { logger } from '../../utils/logging/logger.js';

/**
 * Provider type for explicit selection
 */
export type ProviderType = 'claude-remote' | 'self-hosted' | 'gemini' | 'auto';

/**
 * Get the execution provider based on configuration
 *
 * Provider selection logic:
 * 1. If explicitly specified, use that provider
 * 2. If AI_WORKER_ENABLED=true and AI_WORKER_URL is set, use SelfHostedWorkerProvider
 * 3. Otherwise, use ClaudeRemoteProvider (default)
 *
 * @param providerType - Explicit provider type to use (overrides env config)
 */
export function getExecutionProvider(providerType: ProviderType = 'auto'): ExecutionProvider {
  // Explicit provider selection
  if (providerType === 'self-hosted') {
    logger.info('Using SelfHostedWorkerProvider (explicit)', {
      component: 'ExecutionProviders',
    });
    return new SelfHostedWorkerProvider();
  }

  if (providerType === 'claude-remote') {
    logger.info('Using ClaudeRemoteProvider (explicit)', {
      component: 'ExecutionProviders',
    });
    return new ClaudeRemoteProvider();
  }

  if (providerType === 'gemini') {
    logger.info('Using GeminiProvider (explicit)', {
      component: 'ExecutionProviders',
    });
    return new GeminiProvider();
  }

  // Auto-select based on environment configuration
  if (AI_WORKER_ENABLED && AI_WORKER_URL) {
    logger.info('Using SelfHostedWorkerProvider (auto-detected from env)', {
      component: 'ExecutionProviders',
      workerUrl: AI_WORKER_URL,
    });
    return new SelfHostedWorkerProvider();
  }

  // Default to Claude Remote
  logger.debug('Using ClaudeRemoteProvider (default)', {
    component: 'ExecutionProviders',
  });
  return new ClaudeRemoteProvider();
}

/**
 * Check if the self-hosted worker is available
 */
export async function isSelfHostedWorkerAvailable(): Promise<boolean> {
  if (!AI_WORKER_ENABLED || !AI_WORKER_URL) {
    return false;
  }

  const provider = new SelfHostedWorkerProvider();
  return provider.isAvailable();
}
