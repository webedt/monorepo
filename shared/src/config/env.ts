/**
 * Environment configuration for website backend
 * Centralizes all environment variable access with type safety and defaults
 */

import * as os from 'os';

// Server configuration
export const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3000', 10);
export const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '3001', 10);
// Legacy: PORT maps to BACKEND_PORT for backward compatibility
export const PORT = BACKEND_PORT;
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

// Verbose/Debug mode configuration
// VERBOSE_MODE enables maximum detail output for debugging
// Levels: 'off' (default), 'on' (verbose logging), 'debug' (verbose + debug logs)
export const VERBOSE_MODE = process.env.VERBOSE_MODE || 'off';
export const LOG_LEVEL = process.env.LOG_LEVEL || (VERBOSE_MODE === 'debug' ? 'debug' : 'info');
export const VERBOSE_HTTP = process.env.VERBOSE_HTTP === 'true' || VERBOSE_MODE !== 'off';
export const VERBOSE_TIMING = process.env.VERBOSE_TIMING === 'true' || VERBOSE_MODE !== 'off';

/**
 * Check if verbose mode is enabled
 */
export function isVerbose(): boolean {
  return VERBOSE_MODE !== 'off';
}

/**
 * Check if debug level logging is enabled
 */
export function isDebugLevel(): boolean {
  return VERBOSE_MODE === 'debug' || LOG_LEVEL === 'debug';
}

// Claude Remote Sessions configuration
export const CLAUDE_ENVIRONMENT_ID = process.env.CLAUDE_ENVIRONMENT_ID || '';
export const CLAUDE_API_BASE_URL = process.env.CLAUDE_API_BASE_URL || 'https://api.anthropic.com';
export const CLAUDE_DEFAULT_MODEL = process.env.CLAUDE_DEFAULT_MODEL || 'claude-opus-4-5-20251101';
export const CLAUDE_ORG_UUID = process.env.CLAUDE_ORG_UUID || '';  // For title generation endpoint
export const CLAUDE_COOKIES = process.env.CLAUDE_COOKIES || '';  // Browser cookies for fast title generation
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';  // OpenRouter API key for title generation

// LLM fallback configuration
// Empty repo URL for Claude Web fallback (used when OpenRouter is unavailable)
export const LLM_FALLBACK_REPO_URL = process.env.LLM_FALLBACK_REPO_URL || 'https://github.com/anthropics/anthropic-quickstarts';

// Codex/OpenAI configuration
export const CODEX_API_BASE_URL = process.env.CODEX_API_BASE_URL || 'https://api.openai.com/v1';
export const CODEX_DEFAULT_MODEL = process.env.CODEX_DEFAULT_MODEL || 'gpt-4o';
export const CODEX_ORGANIZATION_ID = process.env.CODEX_ORGANIZATION_ID || '';  // OpenAI Organization ID
export const CODEX_PROJECT_ID = process.env.CODEX_PROJECT_ID || '';  // OpenAI Project ID
export const CODEX_ENABLED = process.env.CODEX_ENABLED === 'true';  // Explicitly enable Codex provider

// AI Worker configuration (self-hosted worker for LLM execution)
// When configured, enables the SelfHostedWorkerProvider as an alternative to Claude Remote Sessions
export const AI_WORKER_URL = process.env.AI_WORKER_URL || '';  // e.g., http://localhost:8080
export const AI_WORKER_SECRET = process.env.AI_WORKER_SECRET || '';  // Authentication secret for worker
export const AI_WORKER_ENABLED = process.env.AI_WORKER_ENABLED === 'true';  // Explicitly enable worker provider

// Gemini AI configuration
// Gemini uses OAuth tokens from ~/.gemini/oauth_creds.json (users authenticate with `gemini auth login`)
export const GEMINI_API_BASE_URL = process.env.GEMINI_API_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = process.env.GEMINI_DEFAULT_MODEL || 'gemini-2.0-flash-exp';

// Background sync configuration
// Automatically syncs Claude Remote sessions from Anthropic API
export const CLAUDE_SYNC_ENABLED = process.env.CLAUDE_SYNC_ENABLED !== 'false';  // Enabled by default
export const CLAUDE_SYNC_INTERVAL_MS = parseInt(process.env.CLAUDE_SYNC_INTERVAL_MS || '300000', 10);  // 5 minutes
export const CLAUDE_SYNC_INITIAL_DELAY_MS = parseInt(process.env.CLAUDE_SYNC_INITIAL_DELAY_MS || '5000', 10);  // 5 seconds after startup
export const CLAUDE_SYNC_LIMIT = parseInt(process.env.CLAUDE_SYNC_LIMIT || '50', 10);  // Max sessions to fetch per sync

// Trash cleanup configuration
// Sessions never auto-expire - only deleted (trashed) sessions are cleaned up
// Active sessions persist indefinitely until explicitly deleted by the user
export const TRASH_CLEANUP_ENABLED = process.env.TRASH_CLEANUP_ENABLED !== 'false';  // Enabled by default
export const TRASH_CLEANUP_INTERVAL_MS = parseInt(process.env.TRASH_CLEANUP_INTERVAL_MS || '3600000', 10);  // 1 hour
export const TRASH_CLEANUP_INITIAL_DELAY_MS = parseInt(process.env.TRASH_CLEANUP_INITIAL_DELAY_MS || '60000', 10);  // 1 minute after startup
export const TRASH_RETENTION_DAYS = parseInt(process.env.TRASH_RETENTION_DAYS || '30', 10);  // Keep trashed sessions for 30 days

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
  console.log(`  FRONTEND_PORT=${FRONTEND_PORT}`);
  console.log(`  BACKEND_PORT=${BACKEND_PORT}`);
  console.log(`  NODE_ENV=${NODE_ENV}`);
  console.log(`  CONTAINER_ID=${CONTAINER_ID}`);
  console.log(`  TMP_DIR=${TMP_DIR}`);
  console.log(`  WORKSPACE_DIR=${WORKSPACE_DIR}`);
  console.log(`  SESSION_SECRET=${redact(SESSION_SECRET)}`);
  console.log(`  USE_NEW_ARCHITECTURE=${USE_NEW_ARCHITECTURE}`);
  console.log(`  VERBOSE_MODE=${VERBOSE_MODE}`);
  console.log(`  LOG_LEVEL=${LOG_LEVEL}`);
  console.log(`  VERBOSE_HTTP=${VERBOSE_HTTP}`);
  console.log(`  VERBOSE_TIMING=${VERBOSE_TIMING}`);
  console.log(`  CLAUDE_ENVIRONMENT_ID=${CLAUDE_ENVIRONMENT_ID || 'not set'}`);
  console.log(`  CLAUDE_API_BASE_URL=${CLAUDE_API_BASE_URL}`);
  console.log(`  CLAUDE_DEFAULT_MODEL=${CLAUDE_DEFAULT_MODEL}`);
  console.log(`  AI_WORKER_ENABLED=${AI_WORKER_ENABLED}`);
  console.log(`  AI_WORKER_URL=${AI_WORKER_URL || 'not set'}`);
  console.log(`  CODEX_ENABLED=${CODEX_ENABLED}`);
  console.log(`  CODEX_API_BASE_URL=${CODEX_API_BASE_URL}`);
  console.log(`  CODEX_DEFAULT_MODEL=${CODEX_DEFAULT_MODEL}`);
}
