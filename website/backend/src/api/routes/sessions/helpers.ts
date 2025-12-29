/**
 * Sessions Route Helpers
 * Shared utilities for session route handlers
 */

import { Response } from 'express';
import { ServiceProvider, ASessionCleanupService, AClaudeWebClient, ASseHelper, SSEWriter } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';
import type { ClaudeWebClientConfig } from '@webedt/shared';

/**
 * Create an SSEWriter for a response with automatic heartbeat management.
 */
export function createSSEWriter(res: Response): SSEWriter {
  const sseHelper = ServiceProvider.get(ASseHelper);
  return SSEWriter.create(res, sseHelper);
}

/**
 * Helper function to delete a GitHub branch using SessionCleanupService
 */
export async function deleteGitHubBranch(
  githubAccessToken: string,
  owner: string,
  repo: string,
  branch: string
): Promise<{ success: boolean; message: string }> {
  const cleanupService = ServiceProvider.get(ASessionCleanupService);
  return cleanupService.deleteGitHubBranch(githubAccessToken, owner, repo, branch);
}

/**
 * Get and configure the Claude Web Client with the given credentials.
 */
export function getClaudeClient(config: ClaudeWebClientConfig): AClaudeWebClient {
  const client = ServiceProvider.get(AClaudeWebClient);
  client.configure(config);
  return client;
}

/**
 * Helper function to archive Claude Remote session using SessionCleanupService
 */
export async function archiveClaudeRemoteSession(
  remoteSessionId: string,
  claudeAuth: ClaudeAuth,
  environmentId?: string
): Promise<{ success: boolean; message: string }> {
  const cleanupService = ServiceProvider.get(ASessionCleanupService);
  return cleanupService.archiveClaudeRemoteSession(remoteSessionId, claudeAuth, environmentId);
}
