/**
 * Environment configuration for internal-api-server
 * Centralizes all environment variable access with type safety and defaults
 */

import * as os from 'os';

// Server configuration
// API_PORT takes precedence over PORT for clarity in monorepo setup
export const PORT = parseInt(process.env.API_PORT || process.env.PORT || '3001', 10);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const CONTAINER_ID = os.hostname();

// Build information (set at build time via Docker build args)
export const BUILD_COMMIT_SHA = process.env.BUILD_COMMIT_SHA || 'unknown';
export const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || 'unknown';
export const BUILD_IMAGE_TAG = process.env.BUILD_IMAGE_TAG || 'unknown';

// CORS configuration
// Default includes production domains if ALLOWED_ORIGINS not explicitly set
const DEFAULT_ORIGINS = NODE_ENV === 'production'
  ? ['https://webedt.etdofresh.com']
  : ['http://localhost:5173', 'http://localhost:3000'];
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || DEFAULT_ORIGINS;

// Session storage paths (ephemeral - no persistent storage)
export const TMP_DIR = process.env.TMP_DIR || '/tmp';
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

// Orphan session cleanup configuration
export const ORPHAN_SESSION_TIMEOUT_MINUTES = parseInt(process.env.ORPHAN_SESSION_TIMEOUT_MINUTES || '30', 10);
export const ORPHAN_CLEANUP_INTERVAL_MINUTES = parseInt(process.env.ORPHAN_CLEANUP_INTERVAL_MINUTES || '5', 10);

// GitHub configuration
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';

// Session/auth configuration
export const SESSION_SECRET = process.env.SESSION_SECRET || 'development-secret-change-in-production';

// Feature flags
export const USE_NEW_ARCHITECTURE = process.env.USE_NEW_ARCHITECTURE === 'true';

// Claude Remote Sessions configuration
export const CLAUDE_ENVIRONMENT_ID = process.env.CLAUDE_ENVIRONMENT_ID || '';
export const CLAUDE_API_BASE_URL = process.env.CLAUDE_API_BASE_URL || 'https://api.anthropic.com';
export const CLAUDE_DEFAULT_MODEL = process.env.CLAUDE_DEFAULT_MODEL || 'claude-opus-4-5-20251101';
export const CLAUDE_ORG_UUID = process.env.CLAUDE_ORG_UUID || '';  // For title generation endpoint
export const CLAUDE_COOKIES = process.env.CLAUDE_COOKIES || '';  // Browser cookies for fast title generation
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';  // OpenRouter API key for title generation

// Background sync configuration
// Automatically syncs Claude Remote sessions from Anthropic API
export const CLAUDE_SYNC_ENABLED = process.env.CLAUDE_SYNC_ENABLED !== 'false';  // Enabled by default
export const CLAUDE_SYNC_INTERVAL_MS = parseInt(process.env.CLAUDE_SYNC_INTERVAL_MS || '300000', 10);  // 5 minutes
export const CLAUDE_SYNC_INITIAL_DELAY_MS = parseInt(process.env.CLAUDE_SYNC_INITIAL_DELAY_MS || '5000', 10);  // 5 seconds after startup
export const CLAUDE_SYNC_LIMIT = parseInt(process.env.CLAUDE_SYNC_LIMIT || '50', 10);  // Max sessions to fetch per sync

/**
 * Validate required environment variables
 */
export function validateEnv(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (NODE_ENV === 'production') {
    if (SESSION_SECRET === 'development-secret-change-in-production') {
      errors.push('SESSION_SECRET must be changed in production');
    }
  }

  // Claude Remote Sessions validation
  if (!CLAUDE_ENVIRONMENT_ID) {
    warnings.push('CLAUDE_ENVIRONMENT_ID not set - Claude Remote Sessions will not work');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Log environment configuration (with sensitive values redacted)
 */
export function logEnvConfig(): void {
  const redact = (value: string | undefined) =>
    value ? `${value.substring(0, 4)}...${value.substring(value.length - 4)}` : 'not set';

  console.log('Environment Configuration:');
  console.log(`  PORT=${PORT}`);
  console.log(`  NODE_ENV=${NODE_ENV}`);
  console.log(`  CONTAINER_ID=${CONTAINER_ID}`);
  console.log(`  TMP_DIR=${TMP_DIR}`);
  console.log(`  WORKSPACE_DIR=${WORKSPACE_DIR}`);
  console.log(`  SESSION_SECRET=${redact(SESSION_SECRET)}`);
  console.log(`  USE_NEW_ARCHITECTURE=${USE_NEW_ARCHITECTURE}`);
  console.log(`  CLAUDE_ENVIRONMENT_ID=${CLAUDE_ENVIRONMENT_ID || 'not set'}`);
  console.log(`  CLAUDE_API_BASE_URL=${CLAUDE_API_BASE_URL}`);
  console.log(`  CLAUDE_DEFAULT_MODEL=${CLAUDE_DEFAULT_MODEL}`);
}
