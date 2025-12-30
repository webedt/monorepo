/**
 * GitHub authentication helpers
 * Provides a fallback chain for GitHub token resolution similar to claudeAuth.ts
 */

import { execSync } from 'child_process';
import { platform } from 'os';
import { GITHUB_TOKEN } from '../config/env.js';

/**
 * Source of GitHub authentication token
 */
export type GitHubAuthSource = 'cli-option' | 'environment' | 'gh-cli' | 'keychain';

/**
 * GitHub authentication credentials
 */
export interface GitHubAuth {
  token: string;
  source: GitHubAuthSource;
}

/**
 * Options for getGitHubCredentials
 */
export interface GetGitHubCredentialsOptions {
  /** Token passed directly (e.g., from CLI --token option) */
  token?: string;
}

/**
 * Get token from gh CLI (fastest - just runs `gh auth token`)
 */
function getTokenFromGhCli(): string | null {
  try {
    const token = execSync('gh auth token', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (token && token.startsWith('gho_')) {
      return token;
    }
  } catch {
    // gh CLI not installed or not authenticated
  }

  return null;
}

/**
 * Get token from macOS Keychain (gh CLI stores tokens here)
 * This is a fallback if gh CLI command fails but keychain has the token
 */
function getTokenFromKeychain(): string | null {
  // Only works on macOS
  if (platform() !== 'darwin') {
    return null;
  }

  try {
    // gh CLI stores tokens in keychain with service "gh:github.com"
    const result = execSync(
      'security find-generic-password -s "gh:github.com" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      // gh stores base64-encoded token with prefix
      if (result.startsWith('go-keyring-base64:')) {
        const encoded = result.substring('go-keyring-base64:'.length);
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        if (decoded.startsWith('gho_')) {
          return decoded;
        }
      }
      // Direct token
      if (result.startsWith('gho_')) {
        return result;
      }
    }
  } catch {
    // Keychain access failed
  }

  return null;
}

/**
 * Get GitHub credentials using a fallback chain (fastest first):
 * 1. Direct token option (e.g., from CLI --token flag)
 * 2. GITHUB_TOKEN environment variable
 * 3. gh CLI (`gh auth token` command)
 * 4. macOS Keychain (where gh CLI stores tokens)
 *
 * Returns null if no credentials are found.
 */
export function getGitHubCredentials(
  options: GetGitHubCredentialsOptions = {}
): GitHubAuth | null {
  const { token } = options;

  // 1. Direct token option (fastest - already in memory)
  if (token) {
    return {
      token,
      source: 'cli-option',
    };
  }

  // 2. Environment variable (fast - just env lookup)
  if (GITHUB_TOKEN) {
    return {
      token: GITHUB_TOKEN,
      source: 'environment',
    };
  }

  // 3. gh CLI command (medium - spawns process but reliable)
  const ghToken = getTokenFromGhCli();
  if (ghToken) {
    return {
      token: ghToken,
      source: 'gh-cli',
    };
  }

  // 4. macOS Keychain (slower - security command, but works if gh CLI is broken)
  const keychainToken = getTokenFromKeychain();
  if (keychainToken) {
    return {
      token: keychainToken,
      source: 'keychain',
    };
  }

  return null;
}
