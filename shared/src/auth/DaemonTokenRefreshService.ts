/**
 * Daemon Token Refresh Service
 *
 * A specialized token refresh service for daemon/CLI use that:
 * - Refreshes tokens when they're close to expiration
 * - Persists refreshed tokens back to their original source
 * - Does NOT require database or user context (unlike TokenRefreshService)
 */

import { logger } from '../utils/logging/logger.js';
import { shouldRefreshClaudeToken, refreshClaudeToken } from './claudeAuth.js';
import { persistRefreshedToken } from './tokenPersistence.js';

import type { ClaudeAuth } from './claudeAuth.js';

/**
 * Service for refreshing Claude tokens in daemon/CLI contexts.
 *
 * Unlike TokenRefreshService which requires a userId for database persistence,
 * this service works standalone and persists tokens based on their original source.
 */
export class DaemonTokenRefreshService {
  /**
   * Ensure the token is valid and refresh if needed.
   *
   * If refresh is needed:
   * 1. Calls the OAuth refresh endpoint
   * 2. Persists the new token to its original source
   * 3. Returns the refreshed auth object
   *
   * If refresh is not needed, returns the original auth object.
   *
   * @param auth - The ClaudeAuth object to check/refresh
   * @returns The (possibly refreshed) ClaudeAuth object
   * @throws Error if refresh is needed but fails (e.g., no refresh token)
   */
  async ensureValidToken(auth: ClaudeAuth): Promise<ClaudeAuth> {
    // Check if token needs refresh (expires within 10 minute buffer)
    if (!shouldRefreshClaudeToken(auth)) {
      logger.debug('Token still valid, no refresh needed', {
        component: 'DaemonTokenRefreshService',
        source: auth.source,
      });
      return auth;
    }

    // Token needs refresh - check if we have a refresh token
    if (!auth.refreshToken) {
      const errorMessage = `Cannot refresh token from source '${auth.source || 'unknown'}': no refresh token available`;
      logger.error(errorMessage, null, {
        component: 'DaemonTokenRefreshService',
        source: auth.source,
      });
      throw new Error(errorMessage);
    }

    logger.info('Token expiring soon, attempting refresh', {
      component: 'DaemonTokenRefreshService',
      source: auth.source,
      expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : 'unknown',
    });

    // Refresh the token
    const refreshedAuth = await refreshClaudeToken(auth);

    // Persist to original source
    const source = auth.source || 'credentials-file';
    const persistResult = await persistRefreshedToken(refreshedAuth, source);

    if (!persistResult.success) {
      logger.warn('Token refreshed but could not be persisted', {
        component: 'DaemonTokenRefreshService',
        source,
        message: persistResult.message,
      });
    } else {
      logger.info('Token refreshed and persisted successfully', {
        component: 'DaemonTokenRefreshService',
        source,
        newExpiry: refreshedAuth.expiresAt ? new Date(refreshedAuth.expiresAt).toISOString() : 'unknown',
      });
    }

    // Return refreshed auth (preserve the source)
    return {
      ...refreshedAuth,
      source: auth.source,
    };
  }

  /**
   * Check if the token needs refresh (utility method)
   */
  shouldRefresh(auth: ClaudeAuth): boolean {
    return shouldRefreshClaudeToken(auth);
  }
}
