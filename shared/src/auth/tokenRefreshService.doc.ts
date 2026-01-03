/**
 * Token Refresh Service Documentation Interface
 *
 * This file contains the fully-documented interface for the Token Refresh Service.
 * The service manages OAuth token refresh for Claude and Gemini authentication,
 * ensuring tokens are valid before API calls.
 *
 * @see ATokenRefreshService for the abstract base class
 * @see TokenRefreshService for the implementation
 * @see DaemonTokenRefreshService for background refresh
 */

import type { ClaudeAuth } from './claudeAuth.js';
import type { GeminiAuth } from './lucia.js';

export type { ClaudeAuth } from './claudeAuth.js';
export type { GeminiAuth } from './lucia.js';

/**
 * Interface for Token Refresh Service with full documentation.
 *
 * The Token Refresh Service handles OAuth token lifecycle management for
 * Claude and Gemini API integrations. It checks token expiry, refreshes
 * tokens when needed, and persists updated tokens to the user record.
 *
 * ## Features
 *
 * - **Automatic Refresh**: Check and refresh tokens before they expire
 * - **Multi-Provider**: Support for Claude and Gemini OAuth tokens
 * - **Persistence**: Updates stored tokens after refresh
 * - **Expiry Buffer**: Refresh tokens before actual expiration
 *
 * ## Token Lifecycle
 *
 * 1. User authenticates via OAuth flow
 * 2. Access and refresh tokens stored (encrypted)
 * 3. Before API call, check if token needs refresh
 * 4. If expired/expiring, use refresh token to get new access token
 * 5. Update stored tokens with new values
 * 6. Use valid access token for API call
 *
 * ## Refresh Buffer
 *
 * Tokens are refreshed before actual expiration to prevent API failures:
 * - Default buffer: 5 minutes before expiry
 * - Ensures seamless API calls without interruption
 *
 * ## Usage
 *
 * ```typescript
 * const refreshService = getTokenRefreshService();
 *
 * // Before making Claude API call
 * const validAuth = await refreshService.ensureValidTokenForUser(
 *   userId,
 *   user.claudeAuth
 * );
 *
 * // Use the (possibly refreshed) token
 * await callClaudeAPI(validAuth.accessToken);
 * ```
 */
export interface ITokenRefreshServiceDocumentation {
  /**
   * Ensure user has a valid Claude token.
   *
   * Checks token validity and refreshes if needed. Updates the user's
   * stored auth if refresh occurs.
   *
   * @param userId - The user ID (for persisting refreshed token)
   * @param claudeAuth - Current Claude authentication data
   * @returns Valid Claude auth (original or refreshed)
   * @throws Error if refresh fails or refresh token is invalid
   *
   * @example
   * ```typescript
   * const user = await getUser(userId);
   *
   * const validAuth = await refreshService.ensureValidTokenForUser(
   *   userId,
   *   user.claudeAuth
   * );
   *
   * // Token is guaranteed valid for at least the buffer period
   * const response = await claudeClient.execute({
   *   auth: validAuth,
   *   prompt: 'Hello',
   * });
   * ```
   *
   * @example
   * ```typescript
   * // Handle refresh failure
   * try {
   *   const auth = await refreshService.ensureValidTokenForUser(userId, claudeAuth);
   *   await executeWithClaude(auth);
   * } catch (error) {
   *   if (error.message.includes('refresh token')) {
   *     // Token is invalid, need re-authentication
   *     redirectToClaudeOAuth();
   *   }
   * }
   * ```
   */
  ensureValidTokenForUser(
    userId: string,
    claudeAuth: ClaudeAuth
  ): Promise<ClaudeAuth>;

  /**
   * Ensure user has a valid Gemini token.
   *
   * Checks token validity and refreshes if needed. Updates the user's
   * stored auth if refresh occurs.
   *
   * @param userId - The user ID (for persisting refreshed token)
   * @param geminiAuth - Current Gemini authentication data
   * @returns Valid Gemini auth (original or refreshed)
   * @throws Error if refresh fails or refresh token is invalid
   *
   * @example
   * ```typescript
   * const user = await getUser(userId);
   *
   * const validAuth = await refreshService.ensureValidGeminiTokenForUser(
   *   userId,
   *   user.geminiAuth
   * );
   *
   * const geminiClient = new GeminiClient(validAuth.accessToken);
   * ```
   */
  ensureValidGeminiTokenForUser(
    userId: string,
    geminiAuth: GeminiAuth
  ): Promise<GeminiAuth>;

  /**
   * Refresh a Claude token if needed.
   *
   * Checks expiry and refreshes if within the buffer period.
   * Does NOT persist the refreshed token - caller must handle storage.
   *
   * @param claudeAuth - Current Claude authentication data
   * @returns Valid auth (original if still valid, refreshed otherwise)
   * @throws Error if refresh fails
   *
   * @example
   * ```typescript
   * // For one-off API calls where you don't want to update stored token
   * const auth = await refreshService.refreshTokenIfNeeded(claudeAuth);
   *
   * // Use immediately
   * await callAPI(auth.accessToken);
   * ```
   *
   * @example
   * ```typescript
   * // Manual refresh with custom storage
   * const refreshed = await refreshService.refreshTokenIfNeeded(auth);
   *
   * if (refreshed !== auth) {
   *   // Token was refreshed, update custom storage
   *   await customStorage.updateClaudeAuth(userId, refreshed);
   * }
   * ```
   */
  refreshTokenIfNeeded(claudeAuth: ClaudeAuth): Promise<ClaudeAuth>;

  /**
   * Refresh a Gemini token if needed.
   *
   * Checks expiry and refreshes if within the buffer period.
   * Does NOT persist the refreshed token.
   *
   * @param geminiAuth - Current Gemini authentication data
   * @returns Valid auth (original or refreshed)
   * @throws Error if refresh fails
   *
   * @example
   * ```typescript
   * const auth = await refreshService.refreshGeminiTokenIfNeeded(geminiAuth);
   * const response = await geminiAPI.generate(auth.accessToken, prompt);
   * ```
   */
  refreshGeminiTokenIfNeeded(geminiAuth: GeminiAuth): Promise<GeminiAuth>;

  /**
   * Check if a Claude token needs refresh.
   *
   * Returns true if the token is expired or within the buffer period
   * of expiration.
   *
   * @param claudeAuth - Claude authentication data to check
   * @returns True if token should be refreshed
   *
   * @example
   * ```typescript
   * if (refreshService.shouldRefresh(claudeAuth)) {
   *   console.log('Token needs refresh');
   *   // Show "refreshing..." indicator to user
   * }
   * ```
   *
   * @example
   * ```typescript
   * // Check before making multiple API calls
   * if (refreshService.shouldRefresh(auth)) {
   *   auth = await refreshService.refreshTokenIfNeeded(auth);
   * }
   *
   * for (const task of tasks) {
   *   await executeTask(auth, task);
   * }
   * ```
   */
  shouldRefresh(claudeAuth: ClaudeAuth): boolean;

  /**
   * Check if a Gemini token needs refresh.
   *
   * @param geminiAuth - Gemini authentication data to check
   * @returns True if token should be refreshed
   *
   * @example
   * ```typescript
   * const needsRefresh = refreshService.shouldRefreshGemini(geminiAuth);
   * if (needsRefresh) {
   *   showRefreshingIndicator();
   * }
   * ```
   */
  shouldRefreshGemini(geminiAuth: GeminiAuth): boolean;
}

/**
 * Token Refresh Provider Documentation
 *
 * The Token Refresh Provider is the low-level interface for implementing
 * token refresh logic for different OAuth providers.
 *
 * ## Provider Implementations
 *
 * - **ClaudeTokenRefreshProvider**: Refresh Claude OAuth tokens
 * - **GeminiTokenRefreshProvider**: Refresh Google OAuth tokens
 *
 * ## Usage
 *
 * Providers are typically used internally by TokenRefreshService.
 * Direct usage is for custom refresh logic or testing.
 *
 * @see ATokenRefreshProvider for the abstract base class
 */
export interface ITokenRefreshProviderDocumentation {
  /**
   * Perform token refresh.
   *
   * @param refreshToken - The refresh token
   * @returns New access token and optional new refresh token
   * @throws Error if refresh fails
   */
  refresh(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken?: string;
    expiresAt: number;
  }>;

  /**
   * Check if a token is expired.
   *
   * @param expiresAt - Token expiration timestamp
   * @returns True if expired or within buffer
   */
  isExpired(expiresAt: number): boolean;
}
