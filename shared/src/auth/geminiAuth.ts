/**
 * Gemini OAuth authentication helpers
 * Handles token refresh for Gemini CLI OAuth credentials
 */

import { ATokenRefreshProvider } from './ATokenRefreshProvider.js';

import type { GeminiAuth } from './lucia.js';
import type { OAuthTokenResponse } from './ATokenRefreshProvider.js';

// Google OAuth token endpoint
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Gemini CLI OAuth client ID (from Google's OAuth credentials for Gemini CLI)
// This is the public client ID used by the Gemini CLI
const GEMINI_CLI_CLIENT_ID = '1079117866411-v12ptt4r1h1m3cj0e7m0v3qd7l8c6h7q.apps.googleusercontent.com';

interface GoogleTokenResponse extends OAuthTokenResponse {
  token_type: string;
  scope?: string;
}

/**
 * Token refresh provider for Gemini OAuth
 *
 * Handles Gemini-specific token refresh:
 * - Form URL-encoded POST to Google's OAuth token endpoint
 * - Does NOT rotate refresh tokens (keeps original)
 * - Preserves tokenType and scope fields
 */
export class GeminiTokenRefreshProvider extends ATokenRefreshProvider<GeminiAuth> {
  constructor() {
    super({ componentName: 'GeminiAuth' });
  }

  async refresh(auth: GeminiAuth): Promise<GeminiAuth> {
    if (!auth.refreshToken) {
      throw new Error('Cannot refresh token: no refresh token available');
    }

    // Build form-urlencoded body (Google OAuth uses this format)
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: GEMINI_CLI_CLIENT_ID,
    });

    const data = await this.executeRefreshRequest<GoogleTokenResponse>(
      GOOGLE_OAUTH_TOKEN_URL,
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      params.toString()
    );

    const newExpiresAt = this.calculateExpiresAt(data.expires_in);
    this.logRefreshSuccess(newExpiresAt);

    return {
      accessToken: data.access_token,
      // Google doesn't rotate refresh tokens, keep the original
      refreshToken: data.refresh_token || auth.refreshToken,
      expiresAt: newExpiresAt,
      tokenType: data.token_type || auth.tokenType,
      scope: data.scope || auth.scope,
    };
  }
}

// Singleton provider instance
const geminiRefreshProvider = new GeminiTokenRefreshProvider();

/**
 * Check if a Gemini access token needs to be refreshed
 * Returns true if token expires within the buffer time or is already expired
 */
export function shouldRefreshGeminiToken(geminiAuth: GeminiAuth): boolean {
  return geminiRefreshProvider.shouldRefresh(geminiAuth);
}

/**
 * Refresh a Gemini OAuth access token using the refresh token
 * Returns updated GeminiAuth object with new tokens
 *
 * Note: Google OAuth refresh uses the same refresh_token - it doesn't rotate
 */
export async function refreshGeminiToken(geminiAuth: GeminiAuth): Promise<GeminiAuth> {
  return geminiRefreshProvider.refresh(geminiAuth);
}

/**
 * Ensure the Gemini token is valid, refreshing if needed
 * Returns the original auth if still valid, or a new auth object if refreshed
 */
export async function ensureValidGeminiToken(geminiAuth: GeminiAuth): Promise<GeminiAuth> {
  return geminiRefreshProvider.ensureValidToken(geminiAuth);
}

/**
 * Check if GeminiAuth object is valid (has required OAuth fields)
 */
export function isValidGeminiAuth(auth: unknown): auth is GeminiAuth {
  if (!auth || typeof auth !== 'object') return false;
  const a = auth as Record<string, unknown>;
  return (
    typeof a.accessToken === 'string' &&
    typeof a.refreshToken === 'string' &&
    typeof a.expiresAt === 'number'
  );
}
