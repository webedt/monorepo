/**
 * Codex/OpenAI authentication helpers
 * Consolidated from website/apps/server/src/lib/codexAuth.ts
 */

import { logger } from '../logger.js';

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
export function shouldRefreshCodexToken(codexAuth: CodexAuth): boolean {
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
 * Note: OpenAI's OAuth2 token refresh endpoint is not publicly documented.
 * The Codex SDK may handle token refresh internally. If the token is expired,
 * the user will need to re-authenticate through the OAuth flow.
 */
export async function refreshCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  // API key doesn't need refresh
  if (codexAuth.apiKey) {
    logger.debug('Using API key authentication, no refresh needed', { component: 'CodexAuth' });
    return codexAuth;
  }

  // Check if we have a refresh token
  if (!codexAuth.refreshToken) {
    logger.warn('No refresh token available for Codex OAuth', { component: 'CodexAuth' });
    return codexAuth;
  }

  // Check if token is actually expired (not just expiring soon)
  const now = Date.now();
  const isExpired = codexAuth.expiresAt ? codexAuth.expiresAt < now : false;

  if (isExpired) {
    logger.warn('Codex OAuth token has expired', {
      component: 'CodexAuth',
      expiredAt: codexAuth.expiresAt ? new Date(codexAuth.expiresAt).toISOString() : 'unknown'
    });
    // Token is expired - user needs to re-authenticate
    // Returning the expired auth will let the SDK attempt refresh or fail gracefully
    return codexAuth;
  }

  // Token is expiring soon but not yet expired
  // The Codex SDK should handle refresh internally when making API calls
  logger.info('Codex OAuth token expiring soon, SDK will handle refresh', {
    component: 'CodexAuth',
    expiresAt: codexAuth.expiresAt ? new Date(codexAuth.expiresAt).toISOString() : 'unknown'
  });

  // Note: If OpenAI provides a public OAuth token refresh endpoint in the future,
  // we would implement the refresh here:
  //
  // const response = await fetch('https://api.openai.com/oauth/token', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  //   body: new URLSearchParams({
  //     grant_type: 'refresh_token',
  //     refresh_token: codexAuth.refreshToken,
  //     client_id: process.env.OPENAI_OAUTH_CLIENT_ID || '',
  //   }),
  // });
  //
  // const data = await response.json();
  // return {
  //   accessToken: data.access_token,
  //   refreshToken: data.refresh_token || codexAuth.refreshToken,
  //   expiresAt: Date.now() + (data.expires_in * 1000),
  // };

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
  if (shouldRefreshCodexToken(codexAuth)) {
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
