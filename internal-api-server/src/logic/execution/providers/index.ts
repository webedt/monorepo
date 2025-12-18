/**
 * Execution Providers
 *
 * Factory and exports for AI execution providers.
 */

export { ClaudeRemoteProvider } from './claudeRemoteProvider.js';
export type {
  ExecutionProvider,
  ExecuteParams,
  ResumeParams,
  ExecutionResult,
  ExecutionEvent,
  ExecutionEventType,
  ExecutionEventCallback,
} from './types.js';

import { ClaudeRemoteProvider } from './claudeRemoteProvider.js';
import type { ExecutionProvider } from './types.js';

/**
 * Get the default execution provider
 * Currently always returns ClaudeRemoteProvider
 * Future: Could read from config or env to select provider
 */
export function getExecutionProvider(): ExecutionProvider {
  return new ClaudeRemoteProvider();
}
