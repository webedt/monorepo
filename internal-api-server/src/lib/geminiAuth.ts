/**
 * Gemini OAuth authentication helpers
 * Handles token refresh for Gemini CLI OAuth credentials
 */

import { logger } from '@webedt/shared';
import type { GeminiAuth } from '../auth.js';

// Google OAuth token endpoint
const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Gemini CLI OAuth client ID (from Google's OAuth credentials for Gemini CLI)
// This is the public client ID used by the Gemini CLI
const GEMINI_CLI_CLIENT_ID = '1079117866411-v12ptt4r1h1m3cj0e7m0v3qd7l8c6h7q.apps.googleusercontent.com';
const GEMINI_CLI_CLIENT_SECRET = 'GOCSPX-xxx'; // Gemini CLI uses public client, may not need secret

// Refresh 10 minutes before expiration to provide buffer
const TOKEN_BUFFER_TIME = 10 * 60 * 1000;

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string; // May not be returned on refresh
  expires_in: number; // Seconds
  token_type: string;
  scope?: string;
}

/**
 * Check if a Gemini access token needs to be refreshed
 * Returns true if token expires within the buffer time or is already expired
 */
export function shouldRefreshGeminiToken(geminiAuth: GeminiAuth): boolean {
  const now = Date.now();
  const expiresAt = geminiAuth.expiresAt;
  const timeUntilExpiry = expiresAt - now;
  const needsRefresh = timeUntilExpiry <= TOKEN_BUFFER_TIME;

  if (needsRefresh) {
    const isExpired = timeUntilExpiry <= 0;
    logger.info('Gemini token refresh check', {
      component: 'GeminiAuth',
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
 * Refresh a Gemini OAuth access token using the refresh token
 * Returns updated GeminiAuth object with new tokens
 *
 * Note: Google OAuth refresh uses the same refresh_token - it doesn't rotate
 */
export async function refreshGeminiToken(geminiAuth: GeminiAuth): Promise<GeminiAuth> {
  try {
    logger.info('Refreshing Gemini OAuth token', { component: 'GeminiAuth' });

    // Google OAuth uses form-urlencoded for token refresh
    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: geminiAuth.refreshToken,
      client_id: GEMINI_CLI_CLIENT_ID,
    });

    const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Gemini token refresh failed', null, {
        component: 'GeminiAuth',
        status: response.status,
        error: errorText
      });
      throw new Error(`Failed to refresh Gemini token: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as GoogleTokenResponse;

    const now = Date.now();
    const newAuth: GeminiAuth = {
      accessToken: data.access_token,
      // Google doesn't rotate refresh tokens, keep the original
      refreshToken: data.refresh_token || geminiAuth.refreshToken,
      expiresAt: now + (data.expires_in * 1000),
      tokenType: data.token_type || geminiAuth.tokenType,
      scope: data.scope || geminiAuth.scope,
    };

    logger.info('Gemini token refreshed successfully', {
      component: 'GeminiAuth',
      newExpiresAt: new Date(newAuth.expiresAt).toISOString(),
      expiresInMinutes: Math.round(data.expires_in / 60)
    });

    return newAuth;
  } catch (error) {
    logger.error('Gemini token refresh error', error as Error, { component: 'GeminiAuth' });
    throw error;
  }
}

/**
 * Ensure the Gemini token is valid, refreshing if needed
 * Returns the original auth if still valid, or a new auth object if refreshed
 */
export async function ensureValidGeminiToken(geminiAuth: GeminiAuth): Promise<GeminiAuth> {
  if (shouldRefreshGeminiToken(geminiAuth)) {
    return refreshGeminiToken(geminiAuth);
  }
  return geminiAuth;
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
