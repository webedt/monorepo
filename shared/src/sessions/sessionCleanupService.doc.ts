/**
 * Session Cleanup Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Session Cleanup Service.
 * Implementation classes should implement this interface to inherit documentation.
 *
 * @see ASessionCleanupService for the abstract base class
 * @see SessionCleanupService for the concrete implementation
 */

import type { ClaudeAuth } from '../auth/claudeAuth.js';
import type { CleanupResult } from './ASessionCleanupService.js';

export type { CleanupResult } from './ASessionCleanupService.js';

/**
 * Interface for Session Cleanup Service with full documentation.
 *
 * Provides methods for cleaning up session resources when sessions are
 * deleted or archived. This includes removing GitHub branches and archiving
 * remote Claude sessions.
 *
 * ## Features
 *
 * - Delete GitHub branches created by Claude sessions
 * - Archive Claude Remote sessions to hide them from listings
 * - Combined cleanup for both GitHub and Claude resources
 *
 * ## When to Use
 *
 * Session cleanup should be triggered when:
 * - User permanently deletes a session
 * - Session is moved to trash (optional, configurable)
 * - Automated cleanup of abandoned sessions
 *
 * ## Error Handling
 *
 * Cleanup operations are designed to be resilient:
 * - Individual failures don't prevent other cleanup operations
 * - Results include success/failure status and messages
 * - Partial cleanup is supported (e.g., branch deleted but archive failed)
 *
 * ## Usage
 *
 * ```typescript
 * const cleanupService = serviceProvider.get(ASessionCleanupService);
 *
 * const results = await cleanupService.cleanupSession({
 *   githubAccessToken: user.githubToken,
 *   owner: 'org',
 *   repo: 'repo',
 *   branch: 'claude/feature-xyz',
 *   remoteSessionId: 'session_abc123',
 *   claudeAuth: userClaudeAuth,
 * });
 *
 * if (results.branchResult?.success) {
 *   console.log('Branch deleted');
 * }
 * if (results.archiveResult?.success) {
 *   console.log('Session archived');
 * }
 * ```
 */
export interface ISessionCleanupServiceDocumentation {
  /**
   * Delete a GitHub branch.
   *
   * Removes a branch from a GitHub repository. This is typically called to
   * clean up branches created by Claude sessions that are no longer needed.
   *
   * The operation is idempotent - deleting a non-existent branch returns success.
   *
   * @param githubAccessToken - GitHub OAuth access token with repo permissions
   * @param owner - Repository owner (user or organization)
   * @param repo - Repository name
   * @param branch - Branch name to delete
   * @returns Result with success status and message
   *
   * @example
   * ```typescript
   * const result = await cleanupService.deleteGitHubBranch(
   *   githubToken,
   *   'my-org',
   *   'my-repo',
   *   'claude/add-dark-mode-abc123'
   * );
   *
   * if (result.success) {
   *   console.log('Branch deleted successfully');
   * } else {
   *   console.error(`Failed to delete branch: ${result.message}`);
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Branch doesn't exist - still returns success
   * const result = await cleanupService.deleteGitHubBranch(
   *   githubToken,
   *   'my-org',
   *   'my-repo',
   *   'nonexistent-branch'
   * );
   * // result.success === true
   * ```
   */
  deleteGitHubBranch(
    githubAccessToken: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<CleanupResult>;

  /**
   * Archive a Claude Remote session.
   *
   * Archives a session in the Anthropic Remote Sessions API. Archived sessions
   * are hidden from default listings but can still be accessed directly.
   *
   * Requires valid Claude OAuth credentials to authenticate the request.
   *
   * @param remoteSessionId - The Claude Remote session ID to archive
   * @param claudeAuth - Claude OAuth credentials (access token, etc.)
   * @param environmentId - Optional environment ID override
   * @returns Result with success status and message
   *
   * @example
   * ```typescript
   * const result = await cleanupService.archiveClaudeRemoteSession(
   *   'session_abc123',
   *   {
   *     accessToken: 'oauth-access-token',
   *     refreshToken: 'oauth-refresh-token',
   *     expiresAt: new Date(Date.now() + 3600000),
   *   }
   * );
   *
   * if (result.success) {
   *   console.log('Session archived');
   * } else {
   *   console.error(`Archive failed: ${result.message}`);
   * }
   * ```
   */
  archiveClaudeRemoteSession(
    remoteSessionId: string,
    claudeAuth: ClaudeAuth,
    environmentId?: string
  ): Promise<CleanupResult>;

  /**
   * Clean up all resources associated with a session.
   *
   * Performs comprehensive cleanup of session resources, including both
   * GitHub branches and Claude Remote session archival. All parameters are
   * optional - only provided resources will be cleaned up.
   *
   * This is the recommended method for session deletion as it handles
   * all cleanup in a single call and provides detailed results.
   *
   * @param params - Cleanup parameters (all optional)
   * @param params.githubAccessToken - GitHub token for branch deletion
   * @param params.owner - Repository owner
   * @param params.repo - Repository name
   * @param params.branch - Branch name to delete
   * @param params.remoteSessionId - Claude session ID to archive
   * @param params.claudeAuth - Claude auth credentials
   * @param params.environmentId - Optional environment ID
   * @returns Object with results for each cleanup operation attempted
   *
   * @example
   * ```typescript
   * // Full cleanup - both GitHub and Claude
   * const results = await cleanupService.cleanupSession({
   *   githubAccessToken: user.githubToken,
   *   owner: 'my-org',
   *   repo: 'my-repo',
   *   branch: 'claude/feature-xyz',
   *   remoteSessionId: 'session_abc123',
   *   claudeAuth: user.claudeAuth,
   * });
   *
   * console.log('Branch cleanup:', results.branchResult);
   * console.log('Archive cleanup:', results.archiveResult);
   * ```
   *
   * @example
   * ```typescript
   * // GitHub-only cleanup (no Claude session)
   * const results = await cleanupService.cleanupSession({
   *   githubAccessToken: user.githubToken,
   *   owner: 'my-org',
   *   repo: 'my-repo',
   *   branch: 'claude/feature-xyz',
   * });
   *
   * // results.branchResult is populated
   * // results.archiveResult is undefined
   * ```
   *
   * @example
   * ```typescript
   * // Claude-only cleanup (branch already deleted)
   * const results = await cleanupService.cleanupSession({
   *   remoteSessionId: 'session_abc123',
   *   claudeAuth: user.claudeAuth,
   * });
   *
   * // results.branchResult is undefined
   * // results.archiveResult is populated
   * ```
   */
  cleanupSession(params: {
    githubAccessToken?: string;
    owner?: string;
    repo?: string;
    branch?: string;
    remoteSessionId?: string;
    claudeAuth?: ClaudeAuth;
    environmentId?: string;
  }): Promise<{
    branchResult?: CleanupResult;
    archiveResult?: CleanupResult;
  }>;
}
