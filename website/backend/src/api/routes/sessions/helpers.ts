/**
 * Sessions Route Helpers
 * Shared utilities for session route handlers
 *
 * Uses constructor injection pattern for better testability.
 * Services can be injected via factory functions instead of ServiceProvider.get().
 */

import { Response } from 'express';
import { createLazyServiceContainer } from '@webedt/shared';

import type { ClaudeAuth } from '@webedt/shared';
import type { ClaudeWebClientConfig, SessionHelperServices } from '@webedt/shared';
import type { AClaudeWebClient } from '@webedt/shared';

// =============================================================================
// Factory Functions (Recommended Pattern)
// =============================================================================

/**
 * Create session helper functions with injected services.
 *
 * This factory function enables proper unit testing by accepting
 * services as parameters instead of using ServiceProvider.get().
 *
 * @param services - Session helper services container
 * @returns Object with helper functions
 *
 * @example
 * ```typescript
 * // In production
 * const container = createServiceContainer();
 * const helpers = createSessionHelpers(container);
 * helpers.sseWrite(res, data);
 *
 * // In tests
 * const mockContainer = createMockServiceContainer({
 *   sseHelper: mockSseHelper,
 *   sessionCleanupService: mockCleanupService,
 *   claudeWebClient: mockClaudeClient,
 * });
 * const helpers = createSessionHelpers(mockContainer);
 * ```
 */
export function createSessionHelpers(services: SessionHelperServices) {
  const { sseHelper, sessionCleanupService, claudeWebClient } = services;

  return {
    /**
     * Helper to write SSE data safely using the shared SSE helper service.
     */
    sseWrite(res: Response, data: string): boolean {
      return sseHelper.write(res, data);
    },

    /**
     * Synchronous SSE write helper - same as sseWrite but named for clarity.
     */
    sseWriteSync(res: Response, data: string): boolean {
      return sseHelper.write(res, data);
    },

    /**
     * Helper function to delete a GitHub branch using SessionCleanupService
     */
    async deleteGitHubBranch(
      githubAccessToken: string,
      owner: string,
      repo: string,
      branch: string
    ): Promise<{ success: boolean; message: string }> {
      return sessionCleanupService.deleteGitHubBranch(githubAccessToken, owner, repo, branch);
    },

    /**
     * Get and configure the Claude Web Client with the given credentials.
     */
    getClaudeClient(config: ClaudeWebClientConfig): AClaudeWebClient {
      claudeWebClient.configure(config);
      return claudeWebClient;
    },

    /**
     * Helper function to archive Claude Remote session using SessionCleanupService
     */
    async archiveClaudeRemoteSession(
      remoteSessionId: string,
      claudeAuth: ClaudeAuth,
      environmentId?: string
    ): Promise<{ success: boolean; message: string }> {
      return sessionCleanupService.archiveClaudeRemoteSession(remoteSessionId, claudeAuth, environmentId);
    },
  };
}

// =============================================================================
// Default Helpers (Backward Compatibility)
// =============================================================================

/**
 * Lazy container for backward-compatible helper functions.
 */
const lazyContainer = createLazyServiceContainer();

/**
 * Helper to write SSE data safely using the shared SSE helper service.
 *
 * @deprecated Use createSessionHelpers() for new code
 */
export function sseWrite(res: Response, data: string): boolean {
  const sseHelper = lazyContainer.sseHelper;
  return sseHelper.write(res, data);
}

/**
 * Synchronous SSE write helper - same as sseWrite but named for clarity.
 *
 * @deprecated Use createSessionHelpers() for new code
 */
export function sseWriteSync(res: Response, data: string): boolean {
  return sseWrite(res, data);
}

/**
 * Helper function to delete a GitHub branch using SessionCleanupService
 *
 * @deprecated Use createSessionHelpers() for new code
 */
export async function deleteGitHubBranch(
  githubAccessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ success: boolean; message: string }> {
  const cleanupService = lazyContainer.sessionCleanupService;
  return cleanupService.deleteGitHubBranch(githubAccessToken, owner, repo, branch);
}

/**
 * Get and configure the Claude Web Client with the given credentials.
 *
 * @deprecated Use createSessionHelpers() for new code
 */
export function getClaudeClient(config: ClaudeWebClientConfig): AClaudeWebClient {
  const client = lazyContainer.claudeWebClient;
  client.configure(config);
  return client;
}

/**
 * Helper function to archive Claude Remote session using SessionCleanupService
 *
 * @deprecated Use createSessionHelpers() for new code
 */
export async function archiveClaudeRemoteSession(
  remoteSessionId: string,
  claudeAuth: ClaudeAuth,
  environmentId?: string
): Promise<{ success: boolean; message: string }> {
  const cleanupService = lazyContainer.sessionCleanupService;
  return cleanupService.archiveClaudeRemoteSession(remoteSessionId, claudeAuth, environmentId);
}
