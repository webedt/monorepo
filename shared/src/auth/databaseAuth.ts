/**
 * Database connection string helpers
 * Provides a fallback chain for DATABASE_URL resolution
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Source of database connection string
 */
export type DatabaseAuthSource = 'cli-option' | 'environment' | 'env-file';

/**
 * Database connection info
 */
export interface DatabaseAuth {
  connectionString: string;
  source: DatabaseAuthSource;
}

/**
 * Options for getDatabaseCredentials
 */
export interface GetDatabaseCredentialsOptions {
  /** Connection string passed directly (e.g., from CLI option) */
  connectionString?: string;
  /** Path to .env file to check (defaults to process.cwd()/.env) */
  envFilePath?: string;
}

/**
 * Parse a .env file and return key-value pairs
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const result: Record<string, string> = {};

  try {
    if (!existsSync(filePath)) {
      return result;
    }

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse KEY=value
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex).trim();
        let value = trimmed.substring(eqIndex + 1).trim();

        // Remove surrounding quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }

        result[key] = value;
      }
    }
  } catch {
    // File read error, return empty
  }

  return result;
}

/**
 * Get database connection string using a fallback chain (fastest first):
 * 1. Direct connectionString option (e.g., from CLI option)
 * 2. DATABASE_URL environment variable
 * 3. .env file in current directory or specified path
 *
 * Returns null if no connection string is found.
 */
export function getDatabaseCredentials(
  options: GetDatabaseCredentialsOptions = {}
): DatabaseAuth | null {
  const { connectionString, envFilePath } = options;

  // 1. Direct option (fastest - already in memory)
  if (connectionString) {
    return {
      connectionString,
      source: 'cli-option',
    };
  }

  // 2. Environment variable (fast - just env lookup)
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      source: 'environment',
    };
  }

  // 3. .env file (slower - file read)
  const envPath = envFilePath || join(process.cwd(), '.env');
  const envVars = parseEnvFile(envPath);

  if (envVars.DATABASE_URL) {
    return {
      connectionString: envVars.DATABASE_URL,
      source: 'env-file',
    };
  }

  // Also check parent directory .env (for monorepo structure)
  const parentEnvPath = join(process.cwd(), '..', '.env');
  const parentEnvVars = parseEnvFile(parentEnvPath);

  if (parentEnvVars.DATABASE_URL) {
    return {
      connectionString: parentEnvVars.DATABASE_URL,
      source: 'env-file',
    };
  }

  return null;
}

/**
 * Check if a database connection string is reachable
 * Returns host and port info for debugging
 */
export function parseDatabaseUrl(connectionString: string): {
  host: string;
  port: number;
  database: string;
  user: string;
} | null {
  try {
    // Parse postgresql://user:pass@host:port/database
    const url = new URL(connectionString);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10) || 5432,
      database: url.pathname.slice(1), // Remove leading /
      user: url.username,
    };
  } catch {
    return null;
  }
}
