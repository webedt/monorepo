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

const adapter = new NodePostgresAdapter(pool, {
  user: 'users',
  session: 'sessions',
});

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
    },
  },
  getUserAttributes: (attributes) => {
    return {
      email: attributes.email,
      githubId: attributes.github_id,
      githubAccessToken: attributes.github_access_token,
      claudeAuth: attributes.claude_auth ? (typeof attributes.claude_auth === 'string' ? JSON.parse(attributes.claude_auth) : attributes.claude_auth) : null,
      codexAuth: attributes.codex_auth ? (typeof attributes.codex_auth === 'string' ? JSON.parse(attributes.codex_auth) : attributes.codex_auth) : null,
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
      claude_auth: string | null;
      codex_auth: string | null;
      preferred_provider: string;
      preferred_model: string | null;
      is_admin: boolean;
    };
  }
}
