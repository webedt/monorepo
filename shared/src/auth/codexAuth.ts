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
 * Error thrown when Codex OAuth token has expired and cannot be refreshed.
 *
 * OpenAI's OAuth2 token refresh endpoint is not publicly documented,
 * so users must re-authenticate through the OAuth flow when tokens expire.
 */
export class CodexTokenExpiredError extends Error {
  /** Timestamp when the token expired */
  readonly expiredAt: Date;

  /** Whether API key authentication is available as a fallback */
  readonly hasApiKeyFallback: boolean;

  /** User-friendly message explaining the limitation */
  readonly userMessage: string;

  constructor(expiredAt: Date, hasApiKeyFallback: boolean = false) {
    const userMessage = hasApiKeyFallback
      ? 'Your Codex OAuth session has expired. You can continue using API key authentication, or re-authenticate through the OAuth flow for OAuth access.'
      : 'Your Codex OAuth session has expired. Please re-authenticate through the Codex OAuth flow to continue. Note: OpenAI does not provide a public token refresh endpoint, so re-authentication is required when tokens expire.';

    super(`Codex OAuth token expired at ${expiredAt.toISOString()}. ${userMessage}`);

    // Required for proper instanceof checks when transpiled to ES5
    Object.setPrototypeOf(this, CodexTokenExpiredError.prototype);

    this.name = 'CodexTokenExpiredError';
    this.expiredAt = expiredAt;
    this.hasApiKeyFallback = hasApiKeyFallback;
    this.userMessage = userMessage;
  }
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
   * Throws CodexTokenExpiredError when tokens are expired.
   *
   * @throws {CodexTokenExpiredError} When the OAuth token has expired and cannot be refreshed
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
      // Without a refresh token, we cannot refresh - but we don't throw since
      // the token might still be valid
      return auth;
    }

    // Check if token is actually expired (not just expiring soon)
    const now = Date.now();
    const isExpired = auth.expiresAt ? auth.expiresAt < now : false;

    if (isExpired) {
      const expiredAt = new Date(auth.expiresAt || now);

      logger.error('Codex OAuth token has expired and cannot be refreshed', {
        component: 'CodexAuth',
        expiredAt: expiredAt.toISOString(),
        message: 'OpenAI does not provide a public OAuth token refresh endpoint'
      });

      // Throw explicit error instead of silently returning stale auth
      throw new CodexTokenExpiredError(expiredAt, false);
    }

    // Token is expiring soon but not yet expired
    // Log a warning about the limitation
    logger.warn('Codex OAuth token expiring soon - refresh not possible', {
      component: 'CodexAuth',
      expiresAt: auth.expiresAt ? new Date(auth.expiresAt).toISOString() : 'unknown',
      limitation: 'OpenAI does not provide a public OAuth token refresh endpoint. User will need to re-authenticate when token expires.'
    });

    // Return current auth since token is still valid
    // Note: OpenAI SDK may handle refresh internally if they support it
    return auth;
  }

  /**
   * Override ensureValidToken to handle API key authentication
   * @throws {CodexTokenExpiredError} When the OAuth token has expired
   */
  override async ensureValidToken(auth: CodexAuth): Promise<CodexAuth> {
    // API key authentication never expires
    if (auth.apiKey) {
      logger.debug('Using API key authentication', { component: 'CodexAuth' });
      return auth;
    }

    // Check if OAuth token is already expired
    if (isCodexAuthExpired(auth)) {
      const expiredAt = new Date(auth.expiresAt || Date.now());
      logger.error('Codex OAuth token has expired', {
        component: 'CodexAuth',
        expiredAt: expiredAt.toISOString(),
        limitation: 'OpenAI does not provide a public OAuth token refresh endpoint'
      });
      throw new CodexTokenExpiredError(expiredAt, false);
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
 *
 * IMPORTANT: OpenAI's OAuth2 token refresh endpoint is not publicly documented.
 * This function will throw CodexTokenExpiredError when tokens are expired,
 * requiring the user to re-authenticate through the OAuth flow.
 *
 * @throws {CodexTokenExpiredError} When the OAuth token has expired and cannot be refreshed
 */
export async function refreshCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  return codexRefreshProvider.refresh(codexAuth);
}

/**
 * Ensure Codex auth token is valid and attempt refresh if needed.
 *
 * IMPORTANT: OpenAI does not provide a public OAuth token refresh endpoint.
 * If the token has expired, this function will throw CodexTokenExpiredError,
 * requiring the user to re-authenticate through the OAuth flow.
 *
 * For tokens that are expiring soon (within 10 minutes) but not yet expired,
 * the function will return the current auth and log a warning about the
 * upcoming expiration.
 *
 * @throws {CodexTokenExpiredError} When the OAuth token has expired
 */
export async function ensureValidCodexToken(codexAuth: CodexAuth): Promise<CodexAuth> {
  return codexRefreshProvider.ensureValidToken(codexAuth);
}

/**
 * Check if a Codex OAuth token has expired.
 *
 * This is useful for proactively detecting expired tokens before attempting
 * operations that would fail. When expired, users must re-authenticate
 * since OpenAI doesn't provide a public token refresh endpoint.
 *
 * @returns true if OAuth token is expired, false if valid or using API key
 */
export function isCodexAuthExpired(codexAuth: CodexAuth | null | undefined): boolean {
  if (!codexAuth) {
    return false;
  }

  // API key authentication never expires
  if (codexAuth.apiKey && codexAuth.apiKey.length > 0) {
    return false;
  }

  // Check OAuth token expiration
  if (codexAuth.accessToken && codexAuth.expiresAt) {
    const now = Date.now();
    return codexAuth.expiresAt < now;
  }

  // No expiration info available, assume not expired
  return false;
}

/**
 * Check if CodexAuth has any credentials present (API key or OAuth tokens).
 *
 * Unlike isValidCodexAuth(), this function only checks for the presence of
 * credentials without validating expiration. Use this when you need to know
 * if any credentials exist, regardless of their validity.
 *
 * @returns true if auth has either API key or OAuth access token present
 */
export function hasCodexCredentials(codexAuth: CodexAuth | null | undefined): boolean {
  if (!codexAuth) {
    return false;
  }

  // Check for API key
  if (codexAuth.apiKey && codexAuth.apiKey.length > 0) {
    return true;
  }

  // Check for OAuth access token (regardless of expiration)
  if (codexAuth.accessToken && codexAuth.accessToken.length > 0) {
    return true;
  }

  return false;
}

/**
 * Validate that CodexAuth has valid, non-expired credentials.
 *
 * Returns true if auth has either:
 * - A valid API key (never expires), OR
 * - A valid OAuth access token that has NOT expired
 *
 * Note: OAuth tokens that have expired will return false, requiring
 * the user to re-authenticate since OpenAI doesn't provide a public
 * token refresh endpoint.
 *
 * @see hasCodexCredentials - Use this if you only need to check for presence
 *   of credentials without validating expiration.
 */
export function isValidCodexAuth(codexAuth: CodexAuth | null | undefined): boolean {
  if (!codexAuth) {
    return false;
  }

  // Check for API key - always valid if present
  if (codexAuth.apiKey && codexAuth.apiKey.length > 0) {
    return true;
  }

  // Check for OAuth tokens - must not be expired
  if (codexAuth.accessToken && codexAuth.accessToken.length > 0) {
    // If we have expiration info, verify token is not expired
    if (codexAuth.expiresAt) {
      const now = Date.now();
      if (codexAuth.expiresAt < now) {
        logger.debug('Codex OAuth token is expired', {
          component: 'CodexAuth',
          expiredAt: new Date(codexAuth.expiresAt).toISOString(),
        });
        return false;
      }
    }
    return true;
  }

  return false;
}
