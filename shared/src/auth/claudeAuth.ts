/**
 * Claude OAuth authentication helpers
 * Consolidated from website/apps/server/src/lib/claudeAuth.ts
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir, platform, userInfo } from 'os';
import { join } from 'path';
import { desc } from 'drizzle-orm';
import { CLAUDE_ACCESS_TOKEN } from '../config/env.js';
import { safeJsonParse } from '../utils/api/safeJson.js';
import { ATokenRefreshProvider } from './ATokenRefreshProvider.js';

import type { OAuthTokenResponse } from './ATokenRefreshProvider.js';

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

interface ClaudeTokenResponse extends OAuthTokenResponse {
  refresh_token: string; // Claude always returns a new refresh token
}

/**
 * Token refresh provider for Claude OAuth
 *
 * Handles Claude-specific token refresh:
 * - JSON POST to Anthropic's OAuth token endpoint
 * - Rotates refresh tokens (new refresh token with each refresh)
 */
export class ClaudeTokenRefreshProvider extends ATokenRefreshProvider<ClaudeAuth> {
  constructor() {
    super({ componentName: 'ClaudeAuth' });
  }

  async refresh(auth: ClaudeAuth): Promise<ClaudeAuth> {
    if (!auth.refreshToken) {
      throw new Error('Cannot refresh token: no refresh token available');
    }

    const data = await this.executeRefreshRequest<ClaudeTokenResponse>(
      CLAUDE_OAUTH_TOKEN_URL,
      { 'Content-Type': 'application/json' },
      JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: auth.refreshToken,
        client_id: CLAUDE_OAUTH_CLIENT_ID,
      })
    );

    const newExpiresAt = this.calculateExpiresAt(data.expires_in);
    this.logRefreshSuccess(newExpiresAt);

    return {
      ...auth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: newExpiresAt,
    };
  }
}

// Singleton provider instance
const claudeRefreshProvider = new ClaudeTokenRefreshProvider();

/**
 * Check if a Claude access token needs to be refreshed
 * Returns true if token expires within the buffer time or is already expired
 * Returns false if expiresAt is not set (cannot determine expiration)
 */
export function shouldRefreshClaudeToken(claudeAuth: ClaudeAuth): boolean {
  return claudeRefreshProvider.shouldRefresh(claudeAuth);
}

/**
 * Refresh a Claude OAuth access token using the refresh token
 * Returns updated ClaudeAuth object with new tokens
 * Throws if refreshToken is not available
 */
export async function refreshClaudeToken(claudeAuth: ClaudeAuth): Promise<ClaudeAuth> {
  return claudeRefreshProvider.refresh(claudeAuth);
}

/**
 * Ensure Claude auth token is valid and refresh if needed
 * Returns the original auth object if still valid, or refreshed auth if it was expiring
 */
export async function ensureValidToken(claudeAuth: ClaudeAuth): Promise<ClaudeAuth> {
  return claudeRefreshProvider.ensureValidToken(claudeAuth);
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
      const parseResult = safeJsonParse<{ claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number } }>(
        result,
        { component: 'ClaudeAuth', logErrors: true, logLevel: 'debug' }
      );
      if (parseResult.success && parseResult.data.claudeAiOauth?.accessToken) {
        return {
          accessToken: parseResult.data.claudeAiOauth.accessToken,
          refreshToken: parseResult.data.claudeAiOauth.refreshToken,
          expiresAt: parseResult.data.claudeAiOauth.expiresAt,
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
  if (existsSync(CLAUDE_CREDENTIALS_PATH)) {
    const credentialsContent = readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8');
    const parseResult = safeJsonParse<{ claudeAiOauth?: { accessToken?: string; refreshToken?: string; expiresAt?: number } }>(
      credentialsContent,
      { component: 'ClaudeAuth', logErrors: true, logLevel: 'debug', context: { path: CLAUDE_CREDENTIALS_PATH } }
    );

    if (parseResult.success && parseResult.data.claudeAiOauth?.accessToken) {
      return {
        accessToken: parseResult.data.claudeAiOauth.accessToken,
        refreshToken: parseResult.data.claudeAiOauth.refreshToken,
        expiresAt: parseResult.data.claudeAiOauth.expiresAt,
        source: 'credentials-file',
      };
    }
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
