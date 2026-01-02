/**
 * Codex/OpenAI authentication helpers
 * Consolidated from website/apps/server/src/lib/codexAuth.ts
 */

import { logger } from '../utils/logging/logger.js';
import { ATokenRefreshProvider } from './ATokenRefreshProvider.js';

// Define CodexAuth type locally (was previously in @webedt/shared)
export interface CodexAuth {
  apiKey?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Token refresh provider for Codex/OpenAI OAuth
 *
 * Note: OpenAI's OAuth2 token refresh endpoint is not publicly documented.
 * The Codex SDK may handle token refresh internally. If the token is expired,
 * the user will need to re-authenticate through the OAuth flow.
 *
 * This provider handles:
 * - API key authentication (never expires)
 * - OAuth tokens with expiration checking
 * - Graceful handling when refresh is not available
 */
export class CodexTokenRefreshProvider extends ATokenRefreshProvider<CodexAuth> {
  constructor() {
    super({ componentName: 'CodexAuth' });
  }

  /**
   * Override shouldRefresh to handle API key authentication
   * API keys never expire, so we return false for them
   */
  override shouldRefresh(auth: CodexAuth): boolean {
    // API key authentication never expires
    if (auth.apiKey) {
      return false;
    }

    // OAuth token - use base class logic
    if (auth.accessToken && auth.expiresAt !== undefined) {
      return super.shouldRefresh(auth);
    }

    // No valid auth found
    return false;
  }

  /**
   * Refresh is not supported for Codex OAuth (no public endpoint)
   * Returns the auth as-is, letting the SDK handle refresh internally
   */
  async refresh(auth: CodexAuth): Promise<CodexAuth> {
    // API key doesn't need refresh
    if (auth.apiKey) {
      logger.debug('Using API key authentication, no refresh needed', { component: 'CodexAuth' });
      return auth;
    }

    // Check if we have a refresh token
    if (!auth.refreshToken) {
      logger.warn('No refresh token available for Codex OAuth', { component: 'CodexAuth' });
      return auth;
    }

    // Check if token is actually expired (not just expiring soon)
    const now = Date.now();
    const isExpired = auth.expiresAt ? auth.expiresAt < now : false;

    if (isExpired) {
      logger.warn('Codex OAuth token has expired', {
        component: 'CodexAuth',
        expiredAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : 'unknown'
      });
      // Token is expired - user needs to re-authenticate
      // Returning the expired auth will let the SDK attempt refresh or fail gracefully
      return auth;
    }

    // Token is expiring soon but not yet expired
    // The Codex SDK should handle refresh internally when making API calls
    logger.info('Codex OAuth token expiring soon, SDK will handle refresh', {
      component: 'CodexAuth',
      expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : 'unknown'
    });

    // Note: If OpenAI provides a public OAuth token refresh endpoint in the future,
    // we would implement the refresh here using this.executeRefreshRequest()

    return auth;
  }

  /**
   * Override ensureValidToken to handle API key authentication
   */
  override async ensureValidToken(auth: CodexAuth): Promise<CodexAuth> {
    // API key authentication never expires
    if (auth.apiKey) {
      logger.info('Using API key authentication', { component: 'CodexAuth' });
      return auth;
    }

    // Use base class logic for OAuth tokens
    return super.ensureValidToken(auth);
  }
}

// Singleton provider instance
const codexRefreshProvider = new CodexTokenRefreshProvider();

/**
 * Check if a Codex access token needs to be refreshed
 * Returns true if token expires within the buffer time or is already expired
 *
 * Note: API key authentication doesn't expire, only OAuth tokens do
 */
export function shouldRefreshCodexToken(codexAuth: CodexAuth): boolean {
  return codexRefreshProvider.shouldRefresh(codexAuth);
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
  return codexRefreshProvider.refresh(codexAuth);
}

/**
 * Ensure Codex auth token is valid and refresh if needed
 * Returns the original auth object if still valid, or refreshed auth if it was expiring
 */
export async function ensureValidCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  return codexRefreshProvider.ensureValidToken(codexAuth);
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
