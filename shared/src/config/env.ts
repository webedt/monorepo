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

// =============================================================================
// TIMEOUTS - All timeout values in milliseconds
// =============================================================================

/**
 * HTTP request timeouts
 * - HTTP_REQUEST_TIMEOUT_MS: Default timeout for HTTP requests (30s)
 * - HTTP_HEAD_TIMEOUT_MS: Timeout for HEAD validation requests (10s)
 * - HTTP_HEALTH_CHECK_TIMEOUT_MS: Timeout for health check endpoints (5s)
 */
export const HTTP_REQUEST_TIMEOUT_MS = parseInt(process.env.HTTP_REQUEST_TIMEOUT_MS || '30000', 10);
export const HTTP_HEAD_TIMEOUT_MS = parseInt(process.env.HTTP_HEAD_TIMEOUT_MS || '10000', 10);
export const HTTP_HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.HTTP_HEALTH_CHECK_TIMEOUT_MS || '5000', 10);

/**
 * SSE/WebSocket timeouts
 * - SSE_STALE_TIMEOUT_MS: Time before subscriber is considered stale (30s)
 */
export const SSE_STALE_TIMEOUT_MS = parseInt(process.env.SSE_STALE_TIMEOUT_MS || '30000', 10);

/**
 * Database timeouts
 * - DB_CONNECTION_TIMEOUT_MS: Timeout for new connections (5s)
 * - DB_IDLE_TIMEOUT_MS: Time before idle connections are closed (30s)
 * - DB_STATEMENT_TIMEOUT_MS: Maximum query execution time (30s)
 */
export const DB_CONNECTION_TIMEOUT_MS = parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10);
export const DB_IDLE_TIMEOUT_MS = parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10);
export const DB_STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '30000', 10);

/**
 * Circuit breaker timeouts
 * - CIRCUIT_BREAKER_RESET_TIMEOUT_MS: Time before circuit breaker resets (30s)
 */
export const CIRCUIT_BREAKER_RESET_TIMEOUT_MS = parseInt(process.env.CIRCUIT_BREAKER_RESET_TIMEOUT_MS || '30000', 10);

/**
 * Execution timeouts
 * - WORKER_EXECUTION_TIMEOUT_MS: Maximum time for worker execution (30 min)
 * - WORKER_HEALTH_CHECK_TIMEOUT_MS: Timeout for worker health checks (5s)
 */
export const WORKER_EXECUTION_TIMEOUT_MS = parseInt(process.env.WORKER_EXECUTION_TIMEOUT_MS || '1800000', 10);
export const WORKER_HEALTH_CHECK_TIMEOUT_MS = parseInt(process.env.WORKER_HEALTH_CHECK_TIMEOUT_MS || '5000', 10);

// =============================================================================
// INTERVALS - All interval values in milliseconds
// =============================================================================

/**
 * SSE intervals
 * - SSE_HEARTBEAT_INTERVAL_MS: Frequency of SSE heartbeats (15s)
 * - SSE_CLEANUP_INTERVAL_MS: Frequency of stale subscriber cleanup (10s)
 */
export const SSE_HEARTBEAT_INTERVAL_MS = parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS || '15000', 10);
export const SSE_CLEANUP_INTERVAL_MS = parseInt(process.env.SSE_CLEANUP_INTERVAL_MS || '10000', 10);

/**
 * Health check intervals
 * - HEALTH_CHECK_INTERVAL_MS: Frequency of periodic health checks (30s)
 * - DB_HEALTH_CHECK_INTERVAL_MS: Frequency of database health checks (30s)
 */
export const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.HEALTH_CHECK_INTERVAL_MS || '30000', 10);
export const DB_HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.DB_HEALTH_CHECK_INTERVAL_MS || '30000', 10);

/**
 * Sync intervals
 * - CRDT_SYNC_INTERVAL_MS: Frequency of CRDT sync operations (1s)
 */
export const CRDT_SYNC_INTERVAL_MS = parseInt(process.env.CRDT_SYNC_INTERVAL_MS || '1000', 10);

// =============================================================================
// LIMITS - Capacity and resource limits
// =============================================================================

/**
 * SSE subscriber limits
 * - SSE_MAX_LISTENERS: Maximum total SSE listeners across all sessions (1000)
 * - SSE_MAX_SUBSCRIBERS_PER_SESSION: Maximum subscribers per session (50)
 * - SSE_MAX_SUBSCRIBERS_PER_USER: Maximum subscribers per user (10)
 * - SSE_WARN_SUBSCRIBER_COUNT: Subscriber count that triggers warning (500)
 * - SSE_ERROR_SUBSCRIBER_COUNT: Subscriber count that triggers error/eviction (900)
 */
export const SSE_MAX_LISTENERS = parseInt(process.env.SSE_MAX_LISTENERS || '1000', 10);
export const SSE_MAX_SUBSCRIBERS_PER_SESSION = parseInt(process.env.SSE_MAX_SUBSCRIBERS_PER_SESSION || '50', 10);
export const SSE_MAX_SUBSCRIBERS_PER_USER = parseInt(process.env.SSE_MAX_SUBSCRIBERS_PER_USER || '10', 10);
export const SSE_WARN_SUBSCRIBER_COUNT = parseInt(process.env.SSE_WARN_SUBSCRIBER_COUNT || '500', 10);
export const SSE_ERROR_SUBSCRIBER_COUNT = parseInt(process.env.SSE_ERROR_SUBSCRIBER_COUNT || '900', 10);

/**
 * Database pool limits
 * - DB_MAX_CONNECTIONS: Maximum connections in pool (20)
 * - DB_MIN_CONNECTIONS: Minimum connections to maintain (2)
 */
export const DB_MAX_CONNECTIONS = parseInt(process.env.DB_MAX_CONNECTIONS || '20', 10);
export const DB_MIN_CONNECTIONS = parseInt(process.env.DB_MIN_CONNECTIONS || '2', 10);

/**
 * Import/fetch limits
 * - IMPORT_MAX_FILE_SIZE_BYTES: Maximum file size for URL imports (10MB)
 */
export const IMPORT_MAX_FILE_SIZE_BYTES = parseInt(process.env.IMPORT_MAX_FILE_SIZE_BYTES || '10485760', 10);

/**
 * Batch processing limits
 * - CRDT_MAX_BATCH_SIZE: Maximum operations per CRDT sync batch (50)
 * - MAX_CONCURRENT_API_CALLS: Maximum parallel API calls for sync (5)
 */
export const CRDT_MAX_BATCH_SIZE = parseInt(process.env.CRDT_MAX_BATCH_SIZE || '50', 10);
export const MAX_CONCURRENT_API_CALLS = parseInt(process.env.MAX_CONCURRENT_API_CALLS || '5', 10);

/**
 * LRU eviction rate
 * - LRU_EVICTION_RATE: Percentage of LRU entries to evict (0.2 = 20%)
 *   Valid range: 0.1-0.5 (10%-50%)
 */
const rawLruEvictionRate = parseFloat(process.env.LRU_EVICTION_RATE || '0.2');
export const LRU_EVICTION_RATE = Math.max(0.1, Math.min(0.5, rawLruEvictionRate));

// =============================================================================
// RETRY CONFIGURATION - Retry and backoff settings
// =============================================================================

/**
 * Default retry configuration
 * - RETRY_MAX_ATTEMPTS: Maximum retry attempts (3)
 * - RETRY_BASE_DELAY_MS: Base delay between retries (1000ms)
 * - RETRY_MAX_DELAY_MS: Maximum delay between retries (30000ms)
 * - RETRY_BACKOFF_MULTIPLIER: Exponential backoff multiplier (2)
 * - RETRY_JITTER_FACTOR: Jitter factor for delay randomization (0.3 = 30%)
 */
export const RETRY_MAX_ATTEMPTS = parseInt(process.env.RETRY_MAX_ATTEMPTS || '3', 10);
export const RETRY_BASE_DELAY_MS = parseInt(process.env.RETRY_BASE_DELAY_MS || '1000', 10);
export const RETRY_MAX_DELAY_MS = parseInt(process.env.RETRY_MAX_DELAY_MS || '30000', 10);
export const RETRY_BACKOFF_MULTIPLIER = parseFloat(process.env.RETRY_BACKOFF_MULTIPLIER || '2');
export const RETRY_JITTER_FACTOR = parseFloat(process.env.RETRY_JITTER_FACTOR || '0.3');

/**
 * Circuit breaker configuration
 * - CIRCUIT_BREAKER_FAILURE_THRESHOLD: Failures before opening circuit (5)
 * - CIRCUIT_BREAKER_SUCCESS_THRESHOLD: Successes in half-open to close (3)
 * - CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS: Max attempts in half-open state (3)
 */
export const CIRCUIT_BREAKER_FAILURE_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_FAILURE_THRESHOLD || '5', 10);
export const CIRCUIT_BREAKER_SUCCESS_THRESHOLD = parseInt(process.env.CIRCUIT_BREAKER_SUCCESS_THRESHOLD || '3', 10);
export const CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS = parseInt(process.env.CIRCUIT_BREAKER_HALF_OPEN_MAX_ATTEMPTS || '3', 10);

/**
 * Context-specific retry configuration
 * These allow fine-tuning retry behavior for specific subsystems
 * - CRDT_RETRY_MAX_DELAY_MS: Max delay for CRDT sync retries (10s, shorter for real-time sync)
 * - DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS: Max delay for DB health check retries (10s)
 * - DB_CONNECTION_MAX_RETRIES: Max retries for database connections (5, more than standard)
 */
export const CRDT_RETRY_MAX_DELAY_MS = parseInt(process.env.CRDT_RETRY_MAX_DELAY_MS || '10000', 10);
export const DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS = parseInt(process.env.DB_HEALTH_CHECK_MAX_RETRY_DELAY_MS || '10000', 10);
export const DB_CONNECTION_MAX_RETRIES = parseInt(process.env.DB_CONNECTION_MAX_RETRIES || '5', 10);

// =============================================================================
// RECOVERY DELAYS - Suggested wait times for different error types
// =============================================================================

/**
 * Recovery delay configuration for error-specific retry strategies
 * - RECOVERY_DELAY_RATE_LIMIT_MS: Delay for rate limit errors (60s)
 * - RECOVERY_DELAY_NETWORK_MS: Delay for network errors (2s)
 * - RECOVERY_DELAY_SERVER_MS: Delay for server errors (5s)
 * - RECOVERY_DELAY_CONFLICT_MS: Delay for conflict errors (10s)
 * - RECOVERY_DELAY_UNKNOWN_MS: Delay for unknown errors (1s)
 */
export const RECOVERY_DELAY_RATE_LIMIT_MS = parseInt(process.env.RECOVERY_DELAY_RATE_LIMIT_MS || '60000', 10);
export const RECOVERY_DELAY_NETWORK_MS = parseInt(process.env.RECOVERY_DELAY_NETWORK_MS || '2000', 10);
export const RECOVERY_DELAY_SERVER_MS = parseInt(process.env.RECOVERY_DELAY_SERVER_MS || '5000', 10);
export const RECOVERY_DELAY_CONFLICT_MS = parseInt(process.env.RECOVERY_DELAY_CONFLICT_MS || '10000', 10);
export const RECOVERY_DELAY_UNKNOWN_MS = parseInt(process.env.RECOVERY_DELAY_UNKNOWN_MS || '1000', 10);

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

  // SSE limits validation - ensure thresholds are in proper relationship
  if (SSE_WARN_SUBSCRIBER_COUNT >= SSE_ERROR_SUBSCRIBER_COUNT) {
    warnings.push(`SSE_WARN_SUBSCRIBER_COUNT (${SSE_WARN_SUBSCRIBER_COUNT}) should be less than SSE_ERROR_SUBSCRIBER_COUNT (${SSE_ERROR_SUBSCRIBER_COUNT})`);
  }
  if (SSE_ERROR_SUBSCRIBER_COUNT >= SSE_MAX_LISTENERS) {
    warnings.push(`SSE_ERROR_SUBSCRIBER_COUNT (${SSE_ERROR_SUBSCRIBER_COUNT}) should be less than SSE_MAX_LISTENERS (${SSE_MAX_LISTENERS})`);
  }
  if (SSE_MAX_LISTENERS <= 0) {
    errors.push('SSE_MAX_LISTENERS must be a positive number');
  }
  if (SSE_MAX_SUBSCRIBERS_PER_SESSION <= 0) {
    errors.push('SSE_MAX_SUBSCRIBERS_PER_SESSION must be a positive number');
  }
  if (SSE_MAX_SUBSCRIBERS_PER_USER <= 0) {
    errors.push('SSE_MAX_SUBSCRIBERS_PER_USER must be a positive number');
  }

  // Database limits validation
  if (DB_MAX_CONNECTIONS <= 0) {
    errors.push('DB_MAX_CONNECTIONS must be a positive number');
  }
  if (DB_MIN_CONNECTIONS < 0) {
    errors.push('DB_MIN_CONNECTIONS must be non-negative');
  }
  if (DB_MIN_CONNECTIONS > DB_MAX_CONNECTIONS) {
    warnings.push(`DB_MIN_CONNECTIONS (${DB_MIN_CONNECTIONS}) should not exceed DB_MAX_CONNECTIONS (${DB_MAX_CONNECTIONS})`);
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
