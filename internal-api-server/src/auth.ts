/**
 * Lucia Authentication Configuration - PostgreSQL Only
 * Consolidated from website/apps/server/src/auth.ts
 *
 * Note: SQLite support was removed to simplify builds.
 * See src/db/SQLITE_REMOVED.md for instructions on reintroducing SQLite if needed.
 */

import { Lucia } from 'lucia';
import { NodePostgresAdapter } from '@lucia-auth/adapter-postgresql';
import { pool } from './db/index.js';
import type { ClaudeAuth } from './lib/claudeAuth.js';
import type { CodexAuth } from './lib/codexAuth.js';

export interface GeminiAuth {
  apiKey: string;
}

const adapter = new NodePostgresAdapter(pool, {
  user: 'users',
  session: 'sessions',
});

// Safely parse JSON auth data, returning null on error
function safeParseJsonAuth<T>(data: string | T | null | undefined): T | null {
  if (!data) return null;
  if (typeof data !== 'string') return data as T;

  try {
    return JSON.parse(data) as T;
  } catch (error) {
    console.error('[Auth] Failed to parse auth data:', error);
    return null;
  }
}

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    name: 'auth_session',
    attributes: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      // Domain is intentionally not set - allows cookie to work on the origin domain
      // The proxy (website server) rewrites cookies to work properly
    },
  },
  getUserAttributes: (attributes) => {
    return {
      email: attributes.email,
      githubId: attributes.github_id,
      githubAccessToken: attributes.github_access_token,
      claudeAuth: safeParseJsonAuth(attributes.claude_auth),
      codexAuth: safeParseJsonAuth(attributes.codex_auth),
      geminiAuth: safeParseJsonAuth(attributes.gemini_auth),
      preferredProvider: attributes.preferred_provider || 'claude',
      preferredModel: attributes.preferred_model,
      isAdmin: attributes.is_admin,
    };
  },
});

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: {
      email: string;
      github_id: string | null;
      github_access_token: string | null;
      // Raw database columns (could be JSON objects or strings depending on driver)
      claude_auth: ClaudeAuth | string | null;
      codex_auth: CodexAuth | string | null;
      gemini_auth: GeminiAuth | string | null;
      preferred_provider: string;
      preferred_model: string | null;
      is_admin: boolean;
    };
  }

  // Override the User interface to reflect transformed attributes
  interface User {
    id: string;
    email: string;
    githubId: string | null;
    githubAccessToken: string | null;
    claudeAuth: ClaudeAuth | null;
    codexAuth: CodexAuth | null;
    geminiAuth: GeminiAuth | null;
    preferredProvider: string;
    preferredModel: string | null;
    isAdmin: boolean;
  }
}
