/**
 * Claude OAuth authentication helpers
 * Consolidated from website/apps/server/src/lib/claudeAuth.ts
 */

import { logger } from '../utils/logger.js';

// Define ClaudeAuth type locally (was previously in @webedt/shared)
// Must match the schema in db/schema.ts
export interface ClaudeAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const TOKEN_BUFFER_TIME = 5 * 60 * 1000; // Refresh 5 minutes before expiration

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // Seconds
}

/**
 * Check if a Claude access token needs to be refreshed
 * Returns true if token expires within the buffer time
 */
export function shouldRefreshToken(claudeAuth: ClaudeAuth): boolean {
  const now = Date.now();
  const expiresAt = claudeAuth.expiresAt;

  // Refresh if token expires within the buffer time
  return expiresAt - now <= TOKEN_BUFFER_TIME;
}

/**
 * Refresh a Claude OAuth access token using the refresh token
 * Returns updated ClaudeAuth object with new tokens
 */
export async function refreshClaudeToken(claudeAuth: ClaudeAuth): Promise<ClaudeAuth> {
  try {
    logger.info('Refreshing OAuth token', { component: 'ClaudeAuth' });

    const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: claudeAuth.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Token refresh failed', null, {
        component: 'ClaudeAuth',
        status: response.status,
        error: errorText
      });
      throw new Error(`Failed to refresh token: ${response.status} ${errorText}`);
    }

    const data = (await response.json()) as RefreshTokenResponse;

    const newExpiresAt = Date.now() + data.expires_in * 1000;

    logger.info('Token refreshed successfully', {
      component: 'ClaudeAuth',
      newExpiration: new Date(newExpiresAt).toISOString()
    });

    return {
      ...claudeAuth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: newExpiresAt,
    };
  } catch (error) {
    logger.error('Error refreshing token', error, { component: 'ClaudeAuth' });
    throw error;
  }
}

/**
 * Ensure Claude auth token is valid and refresh if needed
 * Returns the original auth object if still valid, or refreshed auth if it was expiring
 */
export async function ensureValidToken(claudeAuth: ClaudeAuth): Promise<ClaudeAuth> {
  if (shouldRefreshToken(claudeAuth)) {
    logger.info('Token expires soon, refreshing', { component: 'ClaudeAuth' });
    return await refreshClaudeToken(claudeAuth);
  }

  logger.info('Token still valid, no refresh needed', { component: 'ClaudeAuth' });
  return claudeAuth;
}
