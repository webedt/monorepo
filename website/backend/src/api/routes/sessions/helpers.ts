/**
 * Sessions Route Helpers
 * Shared utilities for session route handlers
 */

import { Response } from 'express';
import { ServiceProvider, ASessionCleanupService, AClaudeWebClient, ASseHelper } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';
import type { ClaudeWebClientConfig } from '@webedt/shared';

/**
 * Helper to write SSE data safely using the shared SSE helper service.
 */
export function sseWrite(res: Response, data: string): boolean {
  const sseHelper = ServiceProvider.get(ASseHelper);
  return sseHelper.write(res, data);
}

/**
 * Synchronous SSE write helper - same as sseWrite but named for clarity.
 */
export function sseWriteSync(res: Response, data: string): boolean {
  return sseWrite(res, data);
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
