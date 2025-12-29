/**
 * Execution Providers
 *
 * Factory and exports for AI execution providers.
 */

export { ClaudeRemoteProvider } from './claudeRemoteProvider.js';
export { SelfHostedWorkerProvider } from './selfHostedWorkerProvider.js';
export { CodexRemoteProvider } from './codexRemoteProvider.js';
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
export type { CodexExecuteParams, CodexResumeParams } from './codexRemoteProvider.js';

import { ClaudeRemoteProvider } from './claudeRemoteProvider.js';
import { SelfHostedWorkerProvider } from './selfHostedWorkerProvider.js';
import { CodexRemoteProvider } from './codexRemoteProvider.js';
import type { ExecutionProvider } from './types.js';
import { AI_WORKER_ENABLED, AI_WORKER_URL, CODEX_ENABLED } from '../../config/env.js';
import { logger } from '../../utils/logging/logger.js';

/**
 * Provider type for explicit selection
 */
export type ProviderType = 'claude-remote' | 'self-hosted' | 'codex' | 'auto';

/**
 * Get the execution provider based on configuration
 *
 * Provider selection logic:
 * 1. If explicit provider type is specified, use that provider
 * 2. If AI_WORKER_ENABLED=true and AI_WORKER_URL is set, use SelfHostedWorkerProvider
 * 3. If CODEX_ENABLED=true, use CodexRemoteProvider
 * 4. Otherwise, use ClaudeRemoteProvider (default)
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

  if (providerType === 'codex') {
    logger.info('Using CodexRemoteProvider (explicit)', {
      component: 'ExecutionProviders',
    });
    return new CodexRemoteProvider();
  }

  // Auto-select based on environment configuration
  if (AI_WORKER_ENABLED && AI_WORKER_URL) {
    logger.info('Using SelfHostedWorkerProvider (auto-detected from env)', {
      component: 'ExecutionProviders',
      workerUrl: AI_WORKER_URL,
    });
    return new SelfHostedWorkerProvider();
  }

  if (CODEX_ENABLED) {
    logger.info('Using CodexRemoteProvider (auto-detected from env)', {
      component: 'ExecutionProviders',
    });
    return new CodexRemoteProvider();
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
