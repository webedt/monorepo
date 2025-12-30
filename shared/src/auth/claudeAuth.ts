/**
 * Claude OAuth authentication helpers
 * Consolidated from website/apps/server/src/lib/claudeAuth.ts
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir, platform, userInfo } from 'os';
import { join } from 'path';
import { desc } from 'drizzle-orm';
import { logger } from '../utils/logging/logger.js';
import { CLAUDE_ACCESS_TOKEN } from '../config/env.js';

/**
 * Source of Claude authentication credentials
 */
export type ClaudeAuthSource = 'cli-option' | 'environment' | 'credentials-file' | 'keychain' | 'database';

/**
 * Claude authentication credentials for runtime use.
 * Some fields are optional as not all sources provide full OAuth credentials.
 */
export interface ClaudeAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
  source?: ClaudeAuthSource;
}

/**
 * Claude authentication credentials for database storage.
 * Requires refreshToken and expiresAt for OAuth token management.
 * Must match the schema in db/schema.ts.
 */
export interface ClaudeAuthDb {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

/**
 * Type guard to check if ClaudeAuth has required fields for database storage
 */
export function isClaudeAuthDb(auth: ClaudeAuth): auth is ClaudeAuthDb {
  return auth.refreshToken !== undefined && auth.expiresAt !== undefined;
}

const CLAUDE_OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const CLAUDE_OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
// Refresh 10 minutes before expiration to provide buffer for:
// - Network latency and retries
// - Long-running operations that need valid tokens throughout
// - Edge cases where refresh might fail and need retry
const TOKEN_BUFFER_TIME = 10 * 60 * 1000;

interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // Seconds
}

/**
 * Check if a Claude access token needs to be refreshed
 * Returns true if token expires within the buffer time or is already expired
 * Returns false if expiresAt is not set (cannot determine expiration)
 */
export function shouldRefreshClaudeToken(claudeAuth: ClaudeAuth): boolean {
  if (claudeAuth.expiresAt === undefined) {
    return false;
  }

  const now = Date.now();
  const expiresAt = claudeAuth.expiresAt;
  const timeUntilExpiry = expiresAt - now;
  const needsRefresh = timeUntilExpiry <= TOKEN_BUFFER_TIME;

  if (needsRefresh) {
    const isExpired = timeUntilExpiry <= 0;
    logger.info('Token refresh check', {
      component: 'ClaudeAuth',
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
 * Refresh a Claude OAuth access token using the refresh token
 * Returns updated ClaudeAuth object with new tokens
 * Throws if refreshToken is not available
 */
export async function refreshClaudeToken(claudeAuth: ClaudeAuth): Promise<ClaudeAuth> {
  if (!claudeAuth.refreshToken) {
    throw new Error('Cannot refresh token: no refresh token available');
  }

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
  if (shouldRefreshClaudeToken(claudeAuth)) {
    logger.info('Token expires soon, refreshing', { component: 'ClaudeAuth' });
    return await refreshClaudeToken(claudeAuth);
  }

  logger.info('Token still valid, no refresh needed', { component: 'ClaudeAuth' });
  return claudeAuth;
}

// Credentials file path for Claude CLI
export const CLAUDE_CREDENTIALS_PATH = join(homedir(), '.claude', '.credentials.json');

// Keychain service name for Claude Code (macOS only)
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';

/**
 * Get credentials from macOS keychain
 * Returns null if not on macOS or credentials not found
 */
function getCredentialsFromKeychain(): { accessToken: string; refreshToken?: string; expiresAt?: number } | null {
  // Only works on macOS
  if (platform() !== 'darwin') {
    return null;
  }

  try {
    const username = userInfo().username;
    const result = execSync(
      `security find-generic-password -s "${CLAUDE_KEYCHAIN_SERVICE}" -a "${username}" -w`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials = JSON.parse(result);
      if (credentials.claudeAiOauth?.accessToken) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
        };
      }
    }
  } catch (error) {
    // Keychain access failed or item not found - this is expected on non-macOS
    // or when credentials haven't been stored yet
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.debug('getCredentialsFromKeychain: Keychain access failed:', message);
  }

  return null;
}

/**
 * Options for getClaudeCredentials
 */
export interface GetClaudeCredentialsOptions {
  /** Access token passed directly (e.g., from CLI --token option) */
  accessToken?: string;
  /** Whether to check the database for user credentials */
  checkDatabase?: boolean;
}

/**
 * Get Claude credentials using a fallback chain:
 * 1. Direct accessToken option (e.g., from CLI --token flag)
 * 2. CLAUDE_ACCESS_TOKEN environment variable
 * 3. ~/.claude/.credentials.json file (Claude CLI credentials)
 * 4. macOS Keychain (Claude Code stores credentials here)
 * 5. Database (if checkDatabase is true)
 *
 * Returns null if no credentials are found.
 */
export async function getClaudeCredentials(
  options: GetClaudeCredentialsOptions = {}
): Promise<ClaudeAuth | null> {
  const { accessToken, checkDatabase = false } = options;

  // 1. Direct accessToken option
  if (accessToken) {
    return {
      accessToken,
      source: 'cli-option',
    };
  }

  // 2. Environment variable
  if (CLAUDE_ACCESS_TOKEN) {
    return {
      accessToken: CLAUDE_ACCESS_TOKEN,
      source: 'environment',
    };
  }

  // 3. Credentials file (~/.claude/.credentials.json)
  try {
    if (existsSync(CLAUDE_CREDENTIALS_PATH)) {
      const credentialsContent = readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8');
      const credentials = JSON.parse(credentialsContent);

      if (credentials.claudeAiOauth?.accessToken) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          source: 'credentials-file',
        };
      }
    }
  } catch (error) {
    // File doesn't exist or is invalid - log for debugging, continue to next source
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.debug('getClaudeCredentials: Failed to read credentials file:', message);
  }

  // 4. macOS Keychain (Claude Code stores credentials here)
  const keychainCredentials = getCredentialsFromKeychain();
  if (keychainCredentials) {
    return {
      ...keychainCredentials,
      source: 'keychain',
    };
  }

  // 5. Database (optional)
  if (checkDatabase) {
    try {
      // Dynamic import to avoid circular dependencies and allow CLI to work without DB
      const { db, users } = await import('../db/index.js');

      const usersWithAuth = await db
        .select({
          id: users.id,
          claudeAuth: users.claudeAuth,
        })
        .from(users)
        .orderBy(desc(users.createdAt))
        .limit(10);

      for (const user of usersWithAuth) {
        if (user.claudeAuth?.accessToken) {
          return {
            ...user.claudeAuth,
            source: 'database',
          };
        }
      }
    } catch {
      // Database not available, return null
    }
  }

  return null;
}
