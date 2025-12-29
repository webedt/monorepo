/**
 * Token Persistence Service
 * Handles persisting refreshed Claude tokens back to their original source.
 */

import { execSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir, platform, userInfo } from 'os';
import { join } from 'path';
import { logger } from '../utils/logging/logger.js';

import type { ClaudeAuth, ClaudeAuthSource } from './claudeAuth.js';

import { CLAUDE_CREDENTIALS_PATH } from './claudeAuth.js';

/**
 * Result of a token persistence operation
 */
export interface TokenPersistenceResult {
  success: boolean;
  message: string;
}

// Keychain service name for Claude Code (macOS only)
const CLAUDE_KEYCHAIN_SERVICE = 'Claude Code-credentials';

/**
 * Persist refreshed token to the credentials file (~/.claude/.credentials.json)
 */
function persistToCredentialsFile(auth: ClaudeAuth): TokenPersistenceResult {
  try {
    const claudeDir = join(homedir(), '.claude');

    // Ensure directory exists
    if (!existsSync(claudeDir)) {
      mkdirSync(claudeDir, { recursive: true });
    }

    // Read existing credentials to preserve other fields
    let existingCredentials: Record<string, unknown> = {};
    if (existsSync(CLAUDE_CREDENTIALS_PATH)) {
      try {
        existingCredentials = JSON.parse(readFileSync(CLAUDE_CREDENTIALS_PATH, 'utf-8'));
      } catch {
        // File exists but is invalid, will overwrite
      }
    }

    // Update only the claudeAiOauth section
    const credentials = {
      ...existingCredentials,
      claudeAiOauth: {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: auth.expiresAt,
        scopes: auth.scopes || ['user:inference', 'user:profile'],
        subscriptionType: auth.subscriptionType || 'max',
        rateLimitTier: auth.rateLimitTier,
      },
    };

    writeFileSync(CLAUDE_CREDENTIALS_PATH, JSON.stringify(credentials, null, 2), { mode: 0o600 });

    logger.info('Token persisted to credentials file', {
      component: 'TokenPersistence',
      path: CLAUDE_CREDENTIALS_PATH,
    });

    return {
      success: true,
      message: `Token persisted to ${CLAUDE_CREDENTIALS_PATH}`,
    };
  } catch (error) {
    const message = `Failed to persist to credentials file: ${error instanceof Error ? error.message : String(error)}`;
    logger.error('Token persistence failed', error, { component: 'TokenPersistence' });
    return {
      success: false,
      message,
    };
  }
}

/**
 * Persist refreshed token to macOS Keychain
 * Falls back to credentials file on non-macOS platforms
 */
function persistToKeychain(auth: ClaudeAuth): TokenPersistenceResult {
  // Only use keychain on macOS, fall back to credentials file otherwise
  if (platform() !== 'darwin') {
    logger.info('Non-macOS platform, falling back to credentials file', {
      component: 'TokenPersistence',
    });
    return persistToCredentialsFile(auth);
  }

  try {
    const credentials = {
      claudeAiOauth: {
        accessToken: auth.accessToken,
        refreshToken: auth.refreshToken,
        expiresAt: auth.expiresAt,
        scopes: auth.scopes || ['user:inference', 'user:profile'],
        subscriptionType: auth.subscriptionType || 'max',
        rateLimitTier: auth.rateLimitTier,
      },
    };

    const username = userInfo().username;
    const credentialsJson = JSON.stringify(credentials);

    // Use -U flag to update existing entry or create if not exists
    execSync(
      `security add-generic-password -U -s "${CLAUDE_KEYCHAIN_SERVICE}" -a "${username}" -w '${credentialsJson}'`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    logger.info('Token persisted to macOS Keychain', {
      component: 'TokenPersistence',
      service: CLAUDE_KEYCHAIN_SERVICE,
    });

    return {
      success: true,
      message: `Token persisted to macOS Keychain (${CLAUDE_KEYCHAIN_SERVICE})`,
    };
  } catch (error) {
    const message = `Failed to persist to Keychain: ${error instanceof Error ? error.message : String(error)}`;
    logger.warn('Keychain persistence failed, falling back to credentials file', {
      component: 'TokenPersistence',
      error: message,
    });

    // Fall back to credentials file
    return persistToCredentialsFile(auth);
  }
}

/**
 * Persist refreshed token back to its original source
 *
 * @param auth - The refreshed ClaudeAuth object to persist
 * @param source - The original source of the token
 * @returns Result indicating success/failure and a message
 */
export async function persistRefreshedToken(
  auth: ClaudeAuth,
  source: ClaudeAuthSource
): Promise<TokenPersistenceResult> {
  logger.info('Persisting refreshed token', {
    component: 'TokenPersistence',
    source,
  });

  switch (source) {
    case 'cli-option':
      return {
        success: false,
        message: 'Tokens from CLI options cannot be persisted. Restart with a fresh --token value when needed.',
      };

    case 'environment':
      return {
        success: false,
        message: 'Tokens from environment variables cannot be persisted. Update CLAUDE_ACCESS_TOKEN and restart.',
      };

    case 'credentials-file':
      return persistToCredentialsFile(auth);

    case 'keychain':
      return persistToKeychain(auth);

    case 'database':
      // For database source, we need a userId which isn't available in standalone daemon context.
      // Fall back to credentials file persistence so the token is at least saved somewhere.
      logger.info('Database source without userId context, falling back to credentials file', {
        component: 'TokenPersistence',
      });
      return persistToCredentialsFile(auth);

    default:
      // Unknown source, default to credentials file
      logger.warn('Unknown token source, defaulting to credentials file', {
        component: 'TokenPersistence',
        source,
      });
      return persistToCredentialsFile(auth);
  }
}
