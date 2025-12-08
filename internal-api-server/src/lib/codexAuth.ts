/**
 * Codex/OpenAI authentication helpers
 * Consolidated from website/apps/server/src/lib/codexAuth.ts
 */

import { logger } from '../utils/logger.js';

// Define CodexAuth type locally (was previously in @webedt/shared)
export interface CodexAuth {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

// Refresh 10 minutes before expiration to provide buffer for:
// - Network latency and retries
// - Long-running operations that need valid tokens throughout
// - Edge cases where refresh might fail and need retry
const TOKEN_BUFFER_TIME = 10 * 60 * 1000;

/**
 * Check if a Codex access token needs to be refreshed
 * Returns true if token expires within the buffer time or is already expired
 *
 * Note: API key authentication doesn't expire, only OAuth tokens do
 */
export function shouldRefreshToken(codexAuth: CodexAuth): boolean {
  // API key authentication never expires
  if (codexAuth.apiKey) {
    return false;
  }

  // OAuth token - check expiration
  if (codexAuth.accessToken && codexAuth.expiresAt) {
    const now = Date.now();
    const timeUntilExpiry = codexAuth.expiresAt - now;
    const needsRefresh = timeUntilExpiry <= TOKEN_BUFFER_TIME;

    if (needsRefresh) {
      const isExpired = timeUntilExpiry <= 0;
      logger.info('Codex token refresh check', {
        component: 'CodexAuth',
        needsRefresh: true,
        isExpired,
        timeUntilExpiryMs: timeUntilExpiry,
        timeUntilExpiryMinutes: Math.round(timeUntilExpiry / 60000),
        expiresAt: new Date(codexAuth.expiresAt).toISOString()
      });
    }

    return needsRefresh;
  }

  // No valid auth found
  return false;
}

/**
 * Refresh a Codex OAuth access token using the refresh token
 * Returns updated CodexAuth object with new tokens
 *
 * Note: OpenAI's OAuth flow may differ - this is a placeholder for when
 * ChatGPT subscription OAuth is fully supported
 */
export async function refreshCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  // API key doesn't need refresh
  if (codexAuth.apiKey) {
    logger.info('Using API key authentication, no refresh needed', { component: 'CodexAuth' });
    return codexAuth;
  }

  // For ChatGPT subscription OAuth, refresh would be handled here
  // Currently, the Codex SDK may handle token refresh internally
  // This is a placeholder for explicit token refresh if needed
  if (codexAuth.refreshToken) {
    logger.info('OAuth token refresh not yet implemented', { component: 'CodexAuth' });
    logger.info('The Codex SDK may handle refresh internally', { component: 'CodexAuth' });

    // TODO: Implement OpenAI OAuth token refresh when endpoint is available
    // For now, return existing auth and let SDK handle refresh
    return codexAuth;
  }

  logger.info('No refresh token available', { component: 'CodexAuth' });
  return codexAuth;
}

/**
 * Ensure Codex auth token is valid and refresh if needed
 * Returns the original auth object if still valid, or refreshed auth if it was expiring
 */
export async function ensureValidCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  // API key authentication never expires
  if (codexAuth.apiKey) {
    logger.info('Using API key authentication', { component: 'CodexAuth' });
    return codexAuth;
  }

  // Check if OAuth token needs refresh
  if (shouldRefreshToken(codexAuth)) {
    logger.info('Token expires soon, refreshing', { component: 'CodexAuth' });
    return await refreshCodexToken(codexAuth);
  }

  logger.info('Token still valid, no refresh needed', { component: 'CodexAuth' });
  return codexAuth;
}

/**
 * Validate that CodexAuth has valid credentials
 * Returns true if auth has either API key or valid OAuth tokens
 */
export function isValidCodexAuth(codexAuth: CodexAuth | null | undefined): boolean {
  if (!codexAuth) {
    return false;
  }

  // Check for API key
  if (codexAuth.apiKey && codexAuth.apiKey.length > 0) {
    return true;
  }

  // Check for OAuth tokens
  if (codexAuth.accessToken && codexAuth.accessToken.length > 0) {
    return true;
  }

  return false;
}
