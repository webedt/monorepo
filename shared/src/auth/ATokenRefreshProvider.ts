/**
 * Abstract base class for OAuth token refresh providers
 *
 * Consolidates common token refresh patterns across auth providers:
 * - Buffer time calculation (10 minutes before expiration)
 * - Expiration checking logic
 * - Token refresh orchestration
 * - Consistent logging
 *
 * Provider-specific implementations extend this class and implement
 * the abstract methods for their specific OAuth endpoints and payloads.
 */

import { logger } from '../utils/logging/logger.js';

/**
 * Base interface for OAuth authentication credentials
 * All auth types must have at least these fields for refresh support.
 * accessToken is optional to support providers with API key authentication.
 */
export interface OAuthAuth {
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Configuration for a token refresh provider
 */
export interface TokenRefreshConfig {
  /** Component name for logging (e.g., 'ClaudeAuth', 'GeminiAuth') */
  componentName: string;
  /** Buffer time in ms before expiration to trigger refresh (default: 10 minutes) */
  bufferTimeMs?: number;
}

/**
 * Standard OAuth token refresh response fields
 */
export interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number; // Seconds until expiration
}

// Default buffer time: refresh 10 minutes before expiration
// This provides buffer for:
// - Network latency and retries
// - Long-running operations that need valid tokens throughout
// - Edge cases where refresh might fail and need retry
export const DEFAULT_TOKEN_BUFFER_TIME_MS = 10 * 60 * 1000;

/**
 * Abstract base class for OAuth token refresh providers
 *
 * @template T - The auth type (ClaudeAuth, GeminiAuth, CodexAuth, etc.)
 */
export abstract class ATokenRefreshProvider<T extends OAuthAuth> {
  protected readonly componentName: string;
  protected readonly bufferTimeMs: number;

  constructor(config: TokenRefreshConfig) {
    this.componentName = config.componentName;
    this.bufferTimeMs = config.bufferTimeMs ?? DEFAULT_TOKEN_BUFFER_TIME_MS;
  }

  /**
   * Check if the token needs to be refreshed
   *
   * Returns true if:
   * - Token expires within the buffer time
   * - Token is already expired
   *
   * Returns false if:
   * - expiresAt is not set (cannot determine expiration)
   * - Token is still valid outside the buffer window
   *
   * @param auth - The auth object to check
   * @returns true if token should be refreshed
   */
  shouldRefresh(auth: T): boolean {
    const expiresAt = auth.expiresAt;

    if (expiresAt === undefined) {
      return false;
    }

    const now = Date.now();
    const timeUntilExpiry = expiresAt - now;
    const needsRefresh = timeUntilExpiry <= this.bufferTimeMs;

    if (needsRefresh) {
      const isExpired = timeUntilExpiry <= 0;
      logger.info('Token refresh check', {
        component: this.componentName,
        needsRefresh: true,
        isExpired,
        timeUntilExpiryMs: timeUntilExpiry,
        timeUntilExpiryMinutes: Math.round(timeUntilExpiry / 60000),
        expiresAt: new Date(expiresAt).toISOString()
      });
    }

    return needsRefresh;
  }

  /**
   * Refresh the OAuth token
   *
   * Provider-specific implementation must handle:
   * - Making the HTTP request to the OAuth token endpoint
   * - Building the request payload with appropriate credentials
   * - Parsing the response and constructing the updated auth object
   *
   * @param auth - The current auth object with refresh token
   * @returns Promise resolving to the updated auth object with new tokens
   * @throws Error if refresh fails or no refresh token is available
   */
  abstract refresh(auth: T): Promise<T>;

  /**
   * Ensure the auth token is valid, refreshing if needed
   *
   * This is the main entry point for consumers. It checks if the token
   * needs to be refreshed and handles the refresh transparently.
   *
   * @param auth - The auth object to validate/refresh
   * @returns Promise resolving to valid auth (original or refreshed)
   */
  async ensureValidToken(auth: T): Promise<T> {
    if (this.shouldRefresh(auth)) {
      logger.info('Token expires soon, refreshing', { component: this.componentName });
      return await this.refresh(auth);
    }

    logger.info('Token still valid, no refresh needed', { component: this.componentName });
    return auth;
  }

  /**
   * Execute an HTTP token refresh request
   *
   * Helper method that handles the common HTTP refresh pattern:
   * - Makes POST request to the OAuth endpoint
   * - Handles error responses with logging
   * - Parses successful JSON response
   *
   * @param url - The OAuth token endpoint URL
   * @param headers - Request headers (Content-Type, etc.)
   * @param body - Request body (JSON string or form-urlencoded)
   * @returns Promise resolving to the parsed token response
   * @throws Error if the request fails
   */
  protected async executeRefreshRequest<R extends OAuthTokenResponse>(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<R> {
    try {
      logger.info('Refreshing OAuth token', { component: this.componentName });

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error('Token refresh failed', null, {
          component: this.componentName,
          status: response.status,
          error: errorText
        });
        throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
      }

      const data = (await response.json()) as R;
      return data;
    } catch (error) {
      logger.error('Error refreshing token', error, { component: this.componentName });
      throw error;
    }
  }

  /**
   * Calculate new expiration timestamp from expires_in value
   *
   * @param expiresInSeconds - Number of seconds until expiration
   * @returns Timestamp in milliseconds
   */
  protected calculateExpiresAt(expiresInSeconds: number): number {
    return Date.now() + expiresInSeconds * 1000;
  }

  /**
   * Log successful token refresh
   *
   * @param newExpiresAt - The new expiration timestamp
   */
  protected logRefreshSuccess(newExpiresAt: number): void {
    logger.info('Token refreshed successfully', {
      component: this.componentName,
      newExpiration: new Date(newExpiresAt).toISOString()
    });
  }
}
