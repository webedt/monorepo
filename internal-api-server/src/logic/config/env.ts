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

// AI Worker configuration
export const AI_WORKER_TIMEOUT_MS = parseInt(process.env.AI_WORKER_TIMEOUT_MS || '600000', 10); // 10 minutes
export const AI_WORKER_PORT = parseInt(process.env.AI_WORKER_PORT || '5000', 10);

// Worker Coordinator configuration (replaces DNSRR with direct routing)
export const USE_WORKER_COORDINATOR = process.env.USE_WORKER_COORDINATOR !== 'false';
export const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
export const WORKER_SWARM_SERVICE_NAME = process.env.WORKER_SWARM_SERVICE_NAME || 'webedt-app-ai-coding-workers-gy4wew_ai-coding-worker';
export const WORKER_COORDINATOR_REFRESH_INTERVAL_MS = parseInt(
  process.env.WORKER_COORDINATOR_REFRESH_INTERVAL_MS || '5000', 10
); // How often to refresh worker list (5 seconds)
export const WORKER_STALE_BUSY_TIMEOUT_MS = parseInt(
  process.env.WORKER_STALE_BUSY_TIMEOUT_MS || '600000', 10
); // When to consider a busy worker stale (10 minutes)
export const WORKER_NO_CAPACITY_RETRY_MS = parseInt(
  process.env.WORKER_NO_CAPACITY_RETRY_MS || '1000', 10
); // Wait between retries when no capacity (1 second)
export const WORKER_NO_CAPACITY_MAX_RETRIES = parseInt(
  process.env.WORKER_NO_CAPACITY_MAX_RETRIES || '10', 10
); // Max retries when no workers available

// Local worker pool configuration (for single-image deployment)
// When WORKER_POOL_MODE='local', use local workers instead of Docker Swarm
export const WORKER_POOL_MODE = process.env.WORKER_POOL_MODE || 'swarm'; // 'swarm' | 'local'
export const WORKER_BASE_PORT = parseInt(process.env.WORKER_BASE_PORT || '5001', 10);
export const WORKER_POOL_SIZE = parseInt(process.env.WORKER_POOL_SIZE || '2', 10);

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
  console.log(`  AI_WORKER_PORT=${AI_WORKER_PORT}`);
  console.log(`  USE_WORKER_COORDINATOR=${USE_WORKER_COORDINATOR}`);
  console.log(`  WORKER_POOL_MODE=${WORKER_POOL_MODE}`);
  console.log(`  WORKER_SWARM_SERVICE_NAME=${WORKER_SWARM_SERVICE_NAME}`);
  console.log(`  DOCKER_SOCKET_PATH=${DOCKER_SOCKET_PATH}`);
  console.log(`  WORKER_BASE_PORT=${WORKER_BASE_PORT}`);
  console.log(`  WORKER_POOL_SIZE=${WORKER_POOL_SIZE}`);
  console.log(`  SESSION_SECRET=${redact(SESSION_SECRET)}`);
  console.log(`  USE_NEW_ARCHITECTURE=${USE_NEW_ARCHITECTURE}`);
  console.log(`  CLAUDE_ENVIRONMENT_ID=${CLAUDE_ENVIRONMENT_ID || 'not set'}`);
  console.log(`  CLAUDE_API_BASE_URL=${CLAUDE_API_BASE_URL}`);
  console.log(`  CLAUDE_DEFAULT_MODEL=${CLAUDE_DEFAULT_MODEL}`);
}
