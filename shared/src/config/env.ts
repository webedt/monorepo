/**
 * Centralized Environment Configuration
 *
 * This module is the SINGLE SOURCE OF TRUTH for all environment variables.
 * All environment variable access MUST go through this module.
 *
 * Features:
 * - Zod schema validation with type safety
 * - Default values with environment-specific overrides
 * - Fail-fast validation on startup
 * - Clear error messages for missing/invalid config
 *
 * Usage:
 *   import { config, DATABASE_URL, NODE_ENV } from '@webedt/shared';
 *
 * DO NOT use process.env directly elsewhere in the codebase.
 */

import * as os from 'os';
import { z } from 'zod';

// =============================================================================
// SCHEMA DEFINITIONS
// =============================================================================

/**
 * Helper to parse boolean env vars
 */
const booleanSchema = z
  .enum(['true', 'false', ''])
  .optional()
  .transform((val) => val === 'true');

/**
 * Helper to parse optional boolean env vars with default
 */
const optionalBoolean = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', ''])
    .optional()
    .transform((val) => (val === undefined || val === '' ? defaultValue : val === 'true'));

/**
 * Helper to parse integer env vars with default
 */
const integerWithDefault = (defaultValue: number) =>
  z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : defaultValue))
    .refine((val) => !isNaN(val), { message: 'Must be a valid integer' });

/**
 * Helper for optional string with default
 */
const optionalString = (defaultValue: string) =>
  z
    .string()
    .optional()
    .transform((val) => val || defaultValue);

/**
 * Main environment configuration schema
 */
const envSchema = z.object({
  // -------------------------------------------------------------------------
  // Node Environment
  // -------------------------------------------------------------------------
  NODE_ENV: optionalString('development'),

  // -------------------------------------------------------------------------
  // Server Configuration
  // -------------------------------------------------------------------------
  FRONTEND_PORT: integerWithDefault(3000),
  BACKEND_PORT: integerWithDefault(3001),

  // -------------------------------------------------------------------------
  // Build Information (set at Docker build time)
  // -------------------------------------------------------------------------
  BUILD_COMMIT_SHA: optionalString('unknown'),
  BUILD_TIMESTAMP: optionalString('unknown'),
  BUILD_IMAGE_TAG: optionalString('unknown'),

  // -------------------------------------------------------------------------
  // CORS Configuration
  // -------------------------------------------------------------------------
  ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((val) => {
      if (val) return val.split(',').map((s) => s.trim());
      // Default origins based on NODE_ENV (handled after parsing)
      return undefined;
    }),

  // -------------------------------------------------------------------------
  // Session Storage Paths
  // -------------------------------------------------------------------------
  TMP_DIR: optionalString('/tmp'),
  WORKSPACE_DIR: optionalString('/workspace'),

  // -------------------------------------------------------------------------
  // Session/Auth Configuration
  // -------------------------------------------------------------------------
  SESSION_SECRET: optionalString('development-secret-change-in-production'),

  // -------------------------------------------------------------------------
  // Database Configuration
  // -------------------------------------------------------------------------
  DATABASE_URL: z.string().optional(),
  QUIET_DB: booleanSchema,
  DEBUG_SQL: booleanSchema,
  SKIP_MIGRATIONS: booleanSchema,
  BACKUP_DIR: optionalString('/tmp/db-backups'),

  // -------------------------------------------------------------------------
  // Orphan Session Cleanup
  // -------------------------------------------------------------------------
  ORPHAN_SESSION_TIMEOUT_MINUTES: integerWithDefault(30),
  ORPHAN_CLEANUP_INTERVAL_MINUTES: integerWithDefault(5),

  // -------------------------------------------------------------------------
  // Graceful Shutdown
  // -------------------------------------------------------------------------
  SHUTDOWN_TIMEOUT_MS: integerWithDefault(30000),
  LB_DRAIN_DELAY_MS: integerWithDefault(2000),

  // -------------------------------------------------------------------------
  // GitHub Configuration
  // -------------------------------------------------------------------------
  GITHUB_CLIENT_ID: optionalString(''),
  GITHUB_CLIENT_SECRET: optionalString(''),
  GITHUB_TOKEN: z.string().optional(),

  // -------------------------------------------------------------------------
  // Feature Flags
  // -------------------------------------------------------------------------
  USE_NEW_ARCHITECTURE: booleanSchema,

  // -------------------------------------------------------------------------
  // Verbose/Debug Mode Configuration
  // -------------------------------------------------------------------------
  VERBOSE_MODE: optionalString('off'),
  LOG_LEVEL: z.string().optional(), // Computed below if not set
  VERBOSE_HTTP: booleanSchema,
  VERBOSE_TIMING: booleanSchema,

  // -------------------------------------------------------------------------
  // Claude Remote Sessions Configuration
  // -------------------------------------------------------------------------
  CLAUDE_ENVIRONMENT_ID: optionalString(''),
  CLAUDE_API_BASE_URL: optionalString('https://api.anthropic.com'),
  CLAUDE_DEFAULT_MODEL: optionalString('claude-opus-4-5-20251101'),
  CLAUDE_ORG_UUID: optionalString(''),
  CLAUDE_COOKIES: optionalString(''),
  CLAUDE_ACCESS_TOKEN: z.string().optional(),

  // -------------------------------------------------------------------------
  // OpenRouter Configuration (for title generation)
  // -------------------------------------------------------------------------
  OPENROUTER_API_KEY: optionalString(''),

  // -------------------------------------------------------------------------
  // LLM Fallback Configuration
  // -------------------------------------------------------------------------
  LLM_FALLBACK_REPO_URL: optionalString('https://github.com/anthropics/anthropic-quickstarts'),

  // -------------------------------------------------------------------------
  // Codex/OpenAI Configuration
  // -------------------------------------------------------------------------
  CODEX_API_BASE_URL: optionalString('https://api.openai.com/v1'),
  CODEX_DEFAULT_MODEL: optionalString('gpt-4o'),
  CODEX_ORGANIZATION_ID: optionalString(''),
  CODEX_PROJECT_ID: optionalString(''),
  CODEX_ENABLED: booleanSchema,
  OPENAI_API_KEY: z.string().optional(),

  // -------------------------------------------------------------------------
  // AI Worker Configuration (self-hosted worker for LLM execution)
  // -------------------------------------------------------------------------
  AI_WORKER_URL: optionalString(''),
  AI_WORKER_SECRET: optionalString(''),
  AI_WORKER_ENABLED: booleanSchema,

  // -------------------------------------------------------------------------
  // Gemini AI Configuration
  // -------------------------------------------------------------------------
  GEMINI_API_BASE_URL: optionalString('https://generativelanguage.googleapis.com/v1beta'),
  GEMINI_DEFAULT_MODEL: optionalString('gemini-2.0-flash-exp'),

  // -------------------------------------------------------------------------
  // Background Sync Configuration
  // -------------------------------------------------------------------------
  CLAUDE_SYNC_ENABLED: optionalBoolean(true),
  CLAUDE_SYNC_INTERVAL_MS: integerWithDefault(300000), // 5 minutes
  CLAUDE_SYNC_INITIAL_DELAY_MS: integerWithDefault(5000), // 5 seconds
  CLAUDE_SYNC_LIMIT: integerWithDefault(50),

  // -------------------------------------------------------------------------
  // Trash Cleanup Configuration
  // -------------------------------------------------------------------------
  TRASH_CLEANUP_ENABLED: optionalBoolean(true),
  TRASH_CLEANUP_INTERVAL_MS: integerWithDefault(3600000), // 1 hour
  TRASH_CLEANUP_INITIAL_DELAY_MS: integerWithDefault(60000), // 1 minute
  TRASH_RETENTION_DAYS: integerWithDefault(30),

  // -------------------------------------------------------------------------
  // Invitation Cleanup Configuration
  // -------------------------------------------------------------------------
  INVITATION_CLEANUP_ENABLED: optionalBoolean(true),
  INVITATION_CLEANUP_INTERVAL_MS: integerWithDefault(86400000), // 24 hours
  INVITATION_CLEANUP_INITIAL_DELAY_MS: integerWithDefault(120000), // 2 minutes
  INVITATION_RETENTION_DAYS_AFTER_EXPIRY: integerWithDefault(7),

  // -------------------------------------------------------------------------
  // Encryption Configuration
  // -------------------------------------------------------------------------
  ENCRYPTION_KEY: z.string().optional(),
  ENCRYPTION_SALT: z.string().optional(),

  // -------------------------------------------------------------------------
  // Stripe Payment Configuration
  // -------------------------------------------------------------------------
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  // -------------------------------------------------------------------------
  // PayPal Payment Configuration
  // -------------------------------------------------------------------------
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_SANDBOX: booleanSchema,

  // -------------------------------------------------------------------------
  // Rate Limiting Configuration
  // -------------------------------------------------------------------------
  RATE_LIMIT_WINDOW_MS: integerWithDefault(60000), // 1 minute
  RATE_LIMIT_MAX_REQUESTS: integerWithDefault(100),
  AUTH_RATE_LIMIT_WINDOW_MS: integerWithDefault(900000), // 15 minutes
  AUTH_RATE_LIMIT_MAX_REQUESTS: integerWithDefault(10),
  // Auth endpoints rate limiting
  RATE_LIMIT_AUTH_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_AUTH_MAX: integerWithDefault(5),
  // Public endpoints rate limiting
  RATE_LIMIT_PUBLIC_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_PUBLIC_MAX: integerWithDefault(30),
  // Standard endpoints rate limiting
  RATE_LIMIT_STANDARD_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_STANDARD_MAX: integerWithDefault(100),
  // AI endpoints rate limiting
  RATE_LIMIT_AI_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_AI_MAX: integerWithDefault(10),
  // Sync endpoints rate limiting
  RATE_LIMIT_SYNC_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_SYNC_MAX: integerWithDefault(5),
  // Search endpoints rate limiting
  RATE_LIMIT_SEARCH_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_SEARCH_MAX: integerWithDefault(30),
  // Collaboration endpoints rate limiting
  RATE_LIMIT_COLLABORATION_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_COLLABORATION_MAX: integerWithDefault(60),
  // SSE endpoints rate limiting
  RATE_LIMIT_SSE_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_SSE_MAX: integerWithDefault(10),
  // File endpoints rate limiting
  RATE_LIMIT_FILE_WINDOW_MS: integerWithDefault(60000),
  RATE_LIMIT_FILE_MAX: integerWithDefault(100),
  // Rate limiting options
  SKIP_RATE_LIMITING: booleanSchema,
  RATE_LIMIT_SKIP_ADMINS: optionalBoolean(true),
  RATE_LIMIT_CB_DEGRADATION: z.string().optional().transform((val) => val ? parseFloat(val) : 0.5),

  // -------------------------------------------------------------------------
  // CSRF Configuration
  // -------------------------------------------------------------------------
  CSRF_SECRET: z.string().optional(),

  // -------------------------------------------------------------------------
  // Worker Configuration
  // -------------------------------------------------------------------------
  WORKER_CALLBACK_SECRET: z.string().optional(),

  // -------------------------------------------------------------------------
  // Frontend URL Configuration
  // -------------------------------------------------------------------------
  FRONTEND_URL: z.string().optional(),
});

// =============================================================================
// PARSE AND VALIDATE
// =============================================================================

// Parse environment variables - this will throw on validation errors
const parseResult = envSchema.safeParse(process.env);

if (!parseResult.success) {
  console.error('Environment validation failed:');
  for (const error of parseResult.error.errors) {
    console.error(`  ${error.path.join('.')}: ${error.message}`);
  }
  // Don't exit immediately - allow the app to start with warnings in development
  if (process.env.NODE_ENV === 'production') {
    console.error('Exiting due to invalid environment configuration');
    process.exit(1);
  }
}

// Use parsed config or fallback to raw env with defaults
const parsedEnv = parseResult.success ? parseResult.data : ({} as z.infer<typeof envSchema>);

// =============================================================================
// COMPUTED VALUES
// =============================================================================

// Container ID from hostname
export const CONTAINER_ID = os.hostname();

// PORT alias for backward compatibility
export const PORT = parsedEnv.BACKEND_PORT ?? 3001;

// Compute ALLOWED_ORIGINS with environment-specific defaults
const NODE_ENV_VALUE = parsedEnv.NODE_ENV ?? 'development';
const DEFAULT_ORIGINS =
  NODE_ENV_VALUE === 'production'
    ? ['https://webedt.etdofresh.com']
    : ['http://localhost:5173', 'http://localhost:3000'];
const ALLOWED_ORIGINS_VALUE = parsedEnv.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS;

// Compute LOG_LEVEL based on VERBOSE_MODE if not explicitly set
const VERBOSE_MODE_VALUE = parsedEnv.VERBOSE_MODE ?? 'off';
const LOG_LEVEL_VALUE =
  parsedEnv.LOG_LEVEL ?? (VERBOSE_MODE_VALUE === 'debug' ? 'debug' : 'info');

// Compute VERBOSE_HTTP and VERBOSE_TIMING with VERBOSE_MODE fallback
const VERBOSE_HTTP_VALUE = parsedEnv.VERBOSE_HTTP || VERBOSE_MODE_VALUE !== 'off';
const VERBOSE_TIMING_VALUE = parsedEnv.VERBOSE_TIMING || VERBOSE_MODE_VALUE !== 'off';

// =============================================================================
// EXPORTED CONFIGURATION VALUES
// =============================================================================

// Node Environment
export const NODE_ENV = NODE_ENV_VALUE;

// Server Configuration
export const FRONTEND_PORT = parsedEnv.FRONTEND_PORT ?? 3000;
export const BACKEND_PORT = parsedEnv.BACKEND_PORT ?? 3001;

// Build Information
export const BUILD_COMMIT_SHA = parsedEnv.BUILD_COMMIT_SHA ?? 'unknown';
export const BUILD_TIMESTAMP = parsedEnv.BUILD_TIMESTAMP ?? 'unknown';
export const BUILD_IMAGE_TAG = parsedEnv.BUILD_IMAGE_TAG ?? 'unknown';

// CORS Configuration
export const ALLOWED_ORIGINS = ALLOWED_ORIGINS_VALUE;

// Session Storage Paths
export const TMP_DIR = parsedEnv.TMP_DIR ?? '/tmp';
export const WORKSPACE_DIR = parsedEnv.WORKSPACE_DIR ?? '/workspace';

// Session/Auth Configuration
export const SESSION_SECRET = parsedEnv.SESSION_SECRET ?? 'development-secret-change-in-production';

// Database Configuration
export const DATABASE_URL = parsedEnv.DATABASE_URL;
export const QUIET_DB = parsedEnv.QUIET_DB ?? false;
export const DEBUG_SQL = parsedEnv.DEBUG_SQL ?? false;
export const SKIP_MIGRATIONS = parsedEnv.SKIP_MIGRATIONS ?? false;
export const BACKUP_DIR = parsedEnv.BACKUP_DIR ?? '/tmp/db-backups';

// Orphan Session Cleanup
export const ORPHAN_SESSION_TIMEOUT_MINUTES = parsedEnv.ORPHAN_SESSION_TIMEOUT_MINUTES ?? 30;
export const ORPHAN_CLEANUP_INTERVAL_MINUTES = parsedEnv.ORPHAN_CLEANUP_INTERVAL_MINUTES ?? 5;

// Graceful Shutdown
export const SHUTDOWN_TIMEOUT_MS = parsedEnv.SHUTDOWN_TIMEOUT_MS ?? 30000;
export const LB_DRAIN_DELAY_MS = parsedEnv.LB_DRAIN_DELAY_MS ?? 2000;

// GitHub Configuration
export const GITHUB_CLIENT_ID = parsedEnv.GITHUB_CLIENT_ID ?? '';
export const GITHUB_CLIENT_SECRET = parsedEnv.GITHUB_CLIENT_SECRET ?? '';
export const GITHUB_TOKEN = parsedEnv.GITHUB_TOKEN;

// Feature Flags
export const USE_NEW_ARCHITECTURE = parsedEnv.USE_NEW_ARCHITECTURE ?? false;

// Verbose/Debug Mode Configuration
export const VERBOSE_MODE = VERBOSE_MODE_VALUE;
export const LOG_LEVEL = LOG_LEVEL_VALUE;
export const VERBOSE_HTTP = VERBOSE_HTTP_VALUE;
export const VERBOSE_TIMING = VERBOSE_TIMING_VALUE;

// Claude Remote Sessions Configuration
export const CLAUDE_ENVIRONMENT_ID = parsedEnv.CLAUDE_ENVIRONMENT_ID ?? '';
export const CLAUDE_API_BASE_URL = parsedEnv.CLAUDE_API_BASE_URL ?? 'https://api.anthropic.com';
export const CLAUDE_DEFAULT_MODEL = parsedEnv.CLAUDE_DEFAULT_MODEL ?? 'claude-opus-4-5-20251101';
export const CLAUDE_ORG_UUID = parsedEnv.CLAUDE_ORG_UUID ?? '';
export const CLAUDE_COOKIES = parsedEnv.CLAUDE_COOKIES ?? '';
export const CLAUDE_ACCESS_TOKEN = parsedEnv.CLAUDE_ACCESS_TOKEN;

// OpenRouter Configuration
export const OPENROUTER_API_KEY = parsedEnv.OPENROUTER_API_KEY ?? '';

// LLM Fallback Configuration
export const LLM_FALLBACK_REPO_URL =
  parsedEnv.LLM_FALLBACK_REPO_URL ?? 'https://github.com/anthropics/anthropic-quickstarts';

// Codex/OpenAI Configuration
export const CODEX_API_BASE_URL = parsedEnv.CODEX_API_BASE_URL ?? 'https://api.openai.com/v1';
export const CODEX_DEFAULT_MODEL = parsedEnv.CODEX_DEFAULT_MODEL ?? 'gpt-4o';
export const CODEX_ORGANIZATION_ID = parsedEnv.CODEX_ORGANIZATION_ID ?? '';
export const CODEX_PROJECT_ID = parsedEnv.CODEX_PROJECT_ID ?? '';
export const CODEX_ENABLED = parsedEnv.CODEX_ENABLED ?? false;
export const OPENAI_API_KEY = parsedEnv.OPENAI_API_KEY;

// AI Worker Configuration
export const AI_WORKER_URL = parsedEnv.AI_WORKER_URL ?? '';
export const AI_WORKER_SECRET = parsedEnv.AI_WORKER_SECRET ?? '';
export const AI_WORKER_ENABLED = parsedEnv.AI_WORKER_ENABLED ?? false;

// Gemini AI Configuration
export const GEMINI_API_BASE_URL =
  parsedEnv.GEMINI_API_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta';
export const GEMINI_DEFAULT_MODEL = parsedEnv.GEMINI_DEFAULT_MODEL ?? 'gemini-2.0-flash-exp';

// Background Sync Configuration
export const CLAUDE_SYNC_ENABLED = parsedEnv.CLAUDE_SYNC_ENABLED ?? true;
export const CLAUDE_SYNC_INTERVAL_MS = parsedEnv.CLAUDE_SYNC_INTERVAL_MS ?? 300000;
export const CLAUDE_SYNC_INITIAL_DELAY_MS = parsedEnv.CLAUDE_SYNC_INITIAL_DELAY_MS ?? 5000;
export const CLAUDE_SYNC_LIMIT = parsedEnv.CLAUDE_SYNC_LIMIT ?? 50;

// Trash Cleanup Configuration
export const TRASH_CLEANUP_ENABLED = parsedEnv.TRASH_CLEANUP_ENABLED ?? true;
export const TRASH_CLEANUP_INTERVAL_MS = parsedEnv.TRASH_CLEANUP_INTERVAL_MS ?? 3600000;
export const TRASH_CLEANUP_INITIAL_DELAY_MS = parsedEnv.TRASH_CLEANUP_INITIAL_DELAY_MS ?? 60000;
export const TRASH_RETENTION_DAYS = parsedEnv.TRASH_RETENTION_DAYS ?? 30;

// Invitation Cleanup Configuration
export const INVITATION_CLEANUP_ENABLED = parsedEnv.INVITATION_CLEANUP_ENABLED ?? true;
export const INVITATION_CLEANUP_INTERVAL_MS = parsedEnv.INVITATION_CLEANUP_INTERVAL_MS ?? 86400000;
export const INVITATION_CLEANUP_INITIAL_DELAY_MS = parsedEnv.INVITATION_CLEANUP_INITIAL_DELAY_MS ?? 120000;
export const INVITATION_RETENTION_DAYS_AFTER_EXPIRY = parsedEnv.INVITATION_RETENTION_DAYS_AFTER_EXPIRY ?? 7;

// Encryption Configuration
export const ENCRYPTION_KEY = parsedEnv.ENCRYPTION_KEY;
export const ENCRYPTION_SALT = parsedEnv.ENCRYPTION_SALT;

// Stripe Payment Configuration
export const STRIPE_SECRET_KEY = parsedEnv.STRIPE_SECRET_KEY;
export const STRIPE_WEBHOOK_SECRET = parsedEnv.STRIPE_WEBHOOK_SECRET;

// PayPal Payment Configuration
export const PAYPAL_CLIENT_ID = parsedEnv.PAYPAL_CLIENT_ID;
export const PAYPAL_CLIENT_SECRET = parsedEnv.PAYPAL_CLIENT_SECRET;
export const PAYPAL_WEBHOOK_ID = parsedEnv.PAYPAL_WEBHOOK_ID;
export const PAYPAL_SANDBOX = parsedEnv.PAYPAL_SANDBOX ?? false;

// Rate Limiting Configuration
export const RATE_LIMIT_WINDOW_MS = parsedEnv.RATE_LIMIT_WINDOW_MS ?? 60000;
export const RATE_LIMIT_MAX_REQUESTS = parsedEnv.RATE_LIMIT_MAX_REQUESTS ?? 100;
export const AUTH_RATE_LIMIT_WINDOW_MS = parsedEnv.AUTH_RATE_LIMIT_WINDOW_MS ?? 900000;
export const AUTH_RATE_LIMIT_MAX_REQUESTS = parsedEnv.AUTH_RATE_LIMIT_MAX_REQUESTS ?? 10;
export const RATE_LIMIT_AUTH_WINDOW_MS = parsedEnv.RATE_LIMIT_AUTH_WINDOW_MS ?? 60000;
export const RATE_LIMIT_AUTH_MAX = parsedEnv.RATE_LIMIT_AUTH_MAX ?? 5;
export const RATE_LIMIT_PUBLIC_WINDOW_MS = parsedEnv.RATE_LIMIT_PUBLIC_WINDOW_MS ?? 60000;
export const RATE_LIMIT_PUBLIC_MAX = parsedEnv.RATE_LIMIT_PUBLIC_MAX ?? 30;
export const RATE_LIMIT_STANDARD_WINDOW_MS = parsedEnv.RATE_LIMIT_STANDARD_WINDOW_MS ?? 60000;
export const RATE_LIMIT_STANDARD_MAX = parsedEnv.RATE_LIMIT_STANDARD_MAX ?? 100;
export const RATE_LIMIT_AI_WINDOW_MS = parsedEnv.RATE_LIMIT_AI_WINDOW_MS ?? 60000;
export const RATE_LIMIT_AI_MAX = parsedEnv.RATE_LIMIT_AI_MAX ?? 10;
export const RATE_LIMIT_SYNC_WINDOW_MS = parsedEnv.RATE_LIMIT_SYNC_WINDOW_MS ?? 60000;
export const RATE_LIMIT_SYNC_MAX = parsedEnv.RATE_LIMIT_SYNC_MAX ?? 5;
export const RATE_LIMIT_SEARCH_WINDOW_MS = parsedEnv.RATE_LIMIT_SEARCH_WINDOW_MS ?? 60000;
export const RATE_LIMIT_SEARCH_MAX = parsedEnv.RATE_LIMIT_SEARCH_MAX ?? 30;
export const RATE_LIMIT_COLLABORATION_WINDOW_MS = parsedEnv.RATE_LIMIT_COLLABORATION_WINDOW_MS ?? 60000;
export const RATE_LIMIT_COLLABORATION_MAX = parsedEnv.RATE_LIMIT_COLLABORATION_MAX ?? 60;
export const RATE_LIMIT_SSE_WINDOW_MS = parsedEnv.RATE_LIMIT_SSE_WINDOW_MS ?? 60000;
export const RATE_LIMIT_SSE_MAX = parsedEnv.RATE_LIMIT_SSE_MAX ?? 10;
export const RATE_LIMIT_FILE_WINDOW_MS = parsedEnv.RATE_LIMIT_FILE_WINDOW_MS ?? 60000;
export const RATE_LIMIT_FILE_MAX = parsedEnv.RATE_LIMIT_FILE_MAX ?? 100;
export const SKIP_RATE_LIMITING = parsedEnv.SKIP_RATE_LIMITING ?? false;
export const RATE_LIMIT_SKIP_ADMINS = parsedEnv.RATE_LIMIT_SKIP_ADMINS ?? true;
export const RATE_LIMIT_CB_DEGRADATION = parsedEnv.RATE_LIMIT_CB_DEGRADATION ?? 0.5;

// CSRF Configuration
export const CSRF_SECRET = parsedEnv.CSRF_SECRET;

// Worker Configuration
export const WORKER_CALLBACK_SECRET = parsedEnv.WORKER_CALLBACK_SECRET;

// Frontend URL Configuration
export const FRONTEND_URL = parsedEnv.FRONTEND_URL;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

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

/**
 * Check if running in production
 */
export function isProduction(): boolean {
  return NODE_ENV === 'production';
}

/**
 * Check if running in development
 */
export function isDevelopment(): boolean {
  return NODE_ENV === 'development';
}

/**
 * Check if running in test mode
 */
export function isTest(): boolean {
  return NODE_ENV === 'test';
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

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
 * Returns validation result with errors and warnings
 */
export function validateEnv(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Production-specific validations
  if (NODE_ENV === 'production') {
    if (SESSION_SECRET === 'development-secret-change-in-production') {
      errors.push('SESSION_SECRET must be changed in production');
    }
  }

  // Claude Remote Sessions validation
  if (!CLAUDE_ENVIRONMENT_ID) {
    warnings.push('CLAUDE_ENVIRONMENT_ID not set - Claude Remote Sessions will not work');
  }

  // Database validation (optional - some CLI commands don't need DB)
  if (!DATABASE_URL) {
    warnings.push('DATABASE_URL not set - database features will not work');
  }

  // Encryption validation
  if (ENCRYPTION_KEY && !ENCRYPTION_SALT) {
    errors.push('ENCRYPTION_SALT must be set when ENCRYPTION_KEY is configured');
  }

  if (ENCRYPTION_SALT && !/^[0-9a-fA-F]{32,}$/.test(ENCRYPTION_SALT)) {
    errors.push('ENCRYPTION_SALT must be a valid hex string of at least 32 characters');
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

  // Timeout values validation - ensure all timeouts are positive
  if (HTTP_REQUEST_TIMEOUT_MS <= 0) {
    errors.push('HTTP_REQUEST_TIMEOUT_MS must be a positive number');
  }
  if (HTTP_HEAD_TIMEOUT_MS <= 0) {
    errors.push('HTTP_HEAD_TIMEOUT_MS must be a positive number');
  }
  if (HTTP_HEALTH_CHECK_TIMEOUT_MS <= 0) {
    errors.push('HTTP_HEALTH_CHECK_TIMEOUT_MS must be a positive number');
  }
  if (SSE_STALE_TIMEOUT_MS <= 0) {
    errors.push('SSE_STALE_TIMEOUT_MS must be a positive number');
  }
  if (DB_CONNECTION_TIMEOUT_MS <= 0) {
    errors.push('DB_CONNECTION_TIMEOUT_MS must be a positive number');
  }
  if (DB_IDLE_TIMEOUT_MS <= 0) {
    errors.push('DB_IDLE_TIMEOUT_MS must be a positive number');
  }
  if (DB_STATEMENT_TIMEOUT_MS <= 0) {
    errors.push('DB_STATEMENT_TIMEOUT_MS must be a positive number');
  }
  if (CIRCUIT_BREAKER_RESET_TIMEOUT_MS <= 0) {
    errors.push('CIRCUIT_BREAKER_RESET_TIMEOUT_MS must be a positive number');
  }
  if (WORKER_EXECUTION_TIMEOUT_MS <= 0) {
    errors.push('WORKER_EXECUTION_TIMEOUT_MS must be a positive number');
  }
  if (WORKER_HEALTH_CHECK_TIMEOUT_MS <= 0) {
    errors.push('WORKER_HEALTH_CHECK_TIMEOUT_MS must be a positive number');
  }

  // Interval values validation - ensure all intervals are positive
  if (SSE_HEARTBEAT_INTERVAL_MS <= 0) {
    errors.push('SSE_HEARTBEAT_INTERVAL_MS must be a positive number');
  }
  if (SSE_CLEANUP_INTERVAL_MS <= 0) {
    errors.push('SSE_CLEANUP_INTERVAL_MS must be a positive number');
  }
  if (HEALTH_CHECK_INTERVAL_MS <= 0) {
    errors.push('HEALTH_CHECK_INTERVAL_MS must be a positive number');
  }
  if (DB_HEALTH_CHECK_INTERVAL_MS <= 0) {
    errors.push('DB_HEALTH_CHECK_INTERVAL_MS must be a positive number');
  }
  if (CRDT_SYNC_INTERVAL_MS <= 0) {
    errors.push('CRDT_SYNC_INTERVAL_MS must be a positive number');
  }

  // Retry configuration validation
  if (RETRY_MAX_ATTEMPTS <= 0) {
    errors.push('RETRY_MAX_ATTEMPTS must be a positive number');
  }
  if (RETRY_BASE_DELAY_MS <= 0) {
    errors.push('RETRY_BASE_DELAY_MS must be a positive number');
  }
  if (RETRY_MAX_DELAY_MS <= 0) {
    errors.push('RETRY_MAX_DELAY_MS must be a positive number');
  }
  if (RETRY_BASE_DELAY_MS > RETRY_MAX_DELAY_MS) {
    warnings.push(`RETRY_BASE_DELAY_MS (${RETRY_BASE_DELAY_MS}) should not exceed RETRY_MAX_DELAY_MS (${RETRY_MAX_DELAY_MS})`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate environment and fail fast on critical errors
 * Call this at application startup
 */
export function validateEnvOrExit(): void {
  const result = validateEnv();

  if (result.warnings.length > 0) {
    console.warn('Environment warnings:');
    for (const warning of result.warnings) {
      console.warn(`  - ${warning}`);
    }
  }

  if (!result.valid) {
    console.error('Environment validation failed:');
    for (const error of result.errors) {
      console.error(`  - ${error}`);
    }
    if (NODE_ENV === 'production') {
      process.exit(1);
    }
  }
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
  console.log(`  DATABASE_URL=${DATABASE_URL ? 'configured' : 'not set'}`);
  console.log(`  ENCRYPTION_KEY=${ENCRYPTION_KEY ? 'configured' : 'not set'}`);
}

// =============================================================================
// AGGREGATED CONFIG OBJECT (for dependency injection)
// =============================================================================

/**
 * Complete configuration object for dependency injection.
 * Prefer using individual exports for tree-shaking.
 *
 * NOTE: isProduction, isDevelopment, isTest are STATIC boolean values computed
 * at module load time. If you need dynamic environment checks (e.g., in tests
 * that modify NODE_ENV), use the exported functions isProduction(), isDevelopment(),
 * or isTest() instead.
 */
export const config = {
  // Environment (isProduction/isDevelopment/isTest are static - see note above)
  NODE_ENV,
  isProduction: isProduction(),
  isDevelopment: isDevelopment(),
  isTest: isTest(),

  // Server
  FRONTEND_PORT,
  BACKEND_PORT,
  PORT,
  CONTAINER_ID,

  // Build
  BUILD_COMMIT_SHA,
  BUILD_TIMESTAMP,
  BUILD_IMAGE_TAG,

  // CORS
  ALLOWED_ORIGINS,

  // Paths
  TMP_DIR,
  WORKSPACE_DIR,

  // Auth
  SESSION_SECRET,

  // Database
  DATABASE_URL,
  QUIET_DB,
  DEBUG_SQL,
  SKIP_MIGRATIONS,
  BACKUP_DIR,

  // Cleanup
  ORPHAN_SESSION_TIMEOUT_MINUTES,
  ORPHAN_CLEANUP_INTERVAL_MINUTES,
  SHUTDOWN_TIMEOUT_MS,
  LB_DRAIN_DELAY_MS,

  // GitHub
  GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET,
  GITHUB_TOKEN,

  // Features
  USE_NEW_ARCHITECTURE,

  // Logging
  VERBOSE_MODE,
  LOG_LEVEL,
  VERBOSE_HTTP,
  VERBOSE_TIMING,

  // Claude
  CLAUDE_ENVIRONMENT_ID,
  CLAUDE_API_BASE_URL,
  CLAUDE_DEFAULT_MODEL,
  CLAUDE_ORG_UUID,
  CLAUDE_COOKIES,
  CLAUDE_ACCESS_TOKEN,
  OPENROUTER_API_KEY,
  LLM_FALLBACK_REPO_URL,

  // Codex/OpenAI
  CODEX_API_BASE_URL,
  CODEX_DEFAULT_MODEL,
  CODEX_ORGANIZATION_ID,
  CODEX_PROJECT_ID,
  CODEX_ENABLED,
  OPENAI_API_KEY,

  // AI Worker
  AI_WORKER_URL,
  AI_WORKER_SECRET,
  AI_WORKER_ENABLED,

  // Gemini
  GEMINI_API_BASE_URL,
  GEMINI_DEFAULT_MODEL,

  // Background Sync
  CLAUDE_SYNC_ENABLED,
  CLAUDE_SYNC_INTERVAL_MS,
  CLAUDE_SYNC_INITIAL_DELAY_MS,
  CLAUDE_SYNC_LIMIT,

  // Trash Cleanup
  TRASH_CLEANUP_ENABLED,
  TRASH_CLEANUP_INTERVAL_MS,
  TRASH_CLEANUP_INITIAL_DELAY_MS,
  TRASH_RETENTION_DAYS,

  // Invitation Cleanup
  INVITATION_CLEANUP_ENABLED,
  INVITATION_CLEANUP_INTERVAL_MS,
  INVITATION_CLEANUP_INITIAL_DELAY_MS,
  INVITATION_RETENTION_DAYS_AFTER_EXPIRY,

  // Encryption
  ENCRYPTION_KEY,
  ENCRYPTION_SALT,

  // Payment - Stripe
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,

  // Payment - PayPal
  PAYPAL_CLIENT_ID,
  PAYPAL_CLIENT_SECRET,
  PAYPAL_WEBHOOK_ID,
  PAYPAL_SANDBOX,

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX_REQUESTS,
  AUTH_RATE_LIMIT_WINDOW_MS,
  AUTH_RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_AUTH_WINDOW_MS,
  RATE_LIMIT_AUTH_MAX,
  RATE_LIMIT_PUBLIC_WINDOW_MS,
  RATE_LIMIT_PUBLIC_MAX,
  RATE_LIMIT_STANDARD_WINDOW_MS,
  RATE_LIMIT_STANDARD_MAX,
  RATE_LIMIT_AI_WINDOW_MS,
  RATE_LIMIT_AI_MAX,
  RATE_LIMIT_SYNC_WINDOW_MS,
  RATE_LIMIT_SYNC_MAX,
  RATE_LIMIT_SEARCH_WINDOW_MS,
  RATE_LIMIT_SEARCH_MAX,
  RATE_LIMIT_COLLABORATION_WINDOW_MS,
  RATE_LIMIT_COLLABORATION_MAX,
  RATE_LIMIT_SSE_WINDOW_MS,
  RATE_LIMIT_SSE_MAX,
  RATE_LIMIT_FILE_WINDOW_MS,
  RATE_LIMIT_FILE_MAX,
  SKIP_RATE_LIMITING,
  RATE_LIMIT_SKIP_ADMINS,
  RATE_LIMIT_CB_DEGRADATION,

  // CSRF
  CSRF_SECRET,

  // Worker
  WORKER_CALLBACK_SECRET,

  // Frontend
  FRONTEND_URL,
} as const;

export type Config = typeof config;
