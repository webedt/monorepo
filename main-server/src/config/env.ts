/**
 * Environment configuration for main-server
 * Centralizes all environment variable access with type safety and defaults
 */

import * as os from 'os';

// Server configuration
export const PORT = parseInt(process.env.PORT || '3000', 10);
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const CONTAINER_ID = os.hostname();

// Build information (set at build time via Docker build args)
export const BUILD_COMMIT_SHA = process.env.BUILD_COMMIT_SHA || 'unknown';
export const BUILD_TIMESTAMP = process.env.BUILD_TIMESTAMP || 'unknown';
export const BUILD_IMAGE_TAG = process.env.BUILD_IMAGE_TAG || 'unknown';

// CORS configuration
// Default includes production domains if ALLOWED_ORIGINS not explicitly set
const DEFAULT_ORIGINS = NODE_ENV === 'production'
  ? ['https://webedt.etdofresh.com', 'https://github.etdofresh.com']
  : ['http://localhost:5173', 'http://localhost:3000'];
export const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',') || DEFAULT_ORIGINS;

// Session storage paths
export const TMP_DIR = process.env.TMP_DIR || '/tmp';
export const WORKSPACE_DIR = process.env.WORKSPACE_DIR || '/workspace';

// MinIO configuration
export const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || 'localhost';
export const MINIO_PORT = parseInt(process.env.MINIO_PORT || '9000', 10);
export const MINIO_USE_SSL = process.env.MINIO_USE_SSL === 'true';
export const MINIO_ROOT_USER = process.env.MINIO_ROOT_USER || '';
export const MINIO_ROOT_PASSWORD = process.env.MINIO_ROOT_PASSWORD || '';
export const MINIO_BUCKET = process.env.MINIO_BUCKET || 'sessions';

// AI Worker configuration
export const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://localhost:5001';
export const AI_WORKER_TIMEOUT_MS = parseInt(process.env.AI_WORKER_TIMEOUT_MS || '600000', 10); // 10 minutes

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

/**
 * Validate required environment variables
 */
export function validateEnv(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (NODE_ENV === 'production') {
    if (!MINIO_ROOT_USER) errors.push('MINIO_ROOT_USER is required in production');
    if (!MINIO_ROOT_PASSWORD) errors.push('MINIO_ROOT_PASSWORD is required in production');
    if (SESSION_SECRET === 'development-secret-change-in-production') {
      errors.push('SESSION_SECRET must be changed in production');
    }
  }

  return {
    valid: errors.length === 0,
    errors
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
  console.log(`  MINIO_ENDPOINT=${MINIO_ENDPOINT}`);
  console.log(`  MINIO_PORT=${MINIO_PORT}`);
  console.log(`  MINIO_BUCKET=${MINIO_BUCKET}`);
  console.log(`  AI_WORKER_URL=${AI_WORKER_URL}`);
  console.log(`  MINIO_ROOT_USER=${redact(MINIO_ROOT_USER)}`);
  console.log(`  MINIO_ROOT_PASSWORD=${redact(MINIO_ROOT_PASSWORD)}`);
  console.log(`  SESSION_SECRET=${redact(SESSION_SECRET)}`);
  console.log(`  USE_NEW_ARCHITECTURE=${USE_NEW_ARCHITECTURE}`);
}
