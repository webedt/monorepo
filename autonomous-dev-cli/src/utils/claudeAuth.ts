/**
 * Claude OAuth authentication helpers for autonomous-dev-cli
 * Handles token refresh and validation
 */

import { logger } from './logger.js';

const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';

export interface ClaudeAuth {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // Seconds
}

/**
 * Refresh a Claude OAuth access token using the refresh token.
 * Returns updated ClaudeAuth object with new tokens.
 */
export async function refreshClaudeToken(refreshToken: string): Promise<ClaudeAuth> {
  logger.info('Refreshing Claude OAuth token');

  const response = await fetch(CLAUDE_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: CLAUDE_OAUTH_CLIENT_ID,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    logger.error('Claude token refresh failed', {
      status: response.status,
      error: errorText,
    });
    throw new Error(`Failed to refresh Claude token: ${response.status} ${errorText}`);
  }

  const data = (await response.json()) as RefreshTokenResponse;
  const newExpiresAt = Date.now() + data.expires_in * 1000;

  logger.info('Claude token refreshed successfully', {
    expiresAt: new Date(newExpiresAt).toISOString(),
  });

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: newExpiresAt,
  };
}

/**
 * Check if a Claude token needs to be refreshed.
 * Returns true if token expires within 10 minutes.
 */
export function shouldRefreshToken(expiresAt: number): boolean {
  const TOKEN_BUFFER_MS = 10 * 60 * 1000; // 10 minutes
  return Date.now() + TOKEN_BUFFER_MS >= expiresAt;
}
