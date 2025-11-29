import { Lucia } from 'lucia';
import { NodePostgresAdapter } from '@lucia-auth/adapter-postgresql';
import { BetterSqlite3Adapter } from '@lucia-auth/adapter-sqlite';
import { pool, sqliteDb } from './db/index';

// Use PostgreSQL adapter if DATABASE_URL is set, otherwise SQLite
const usePostgres = !!process.env.DATABASE_URL;

const adapter = usePostgres
  ? new NodePostgresAdapter(pool!, {
      user: 'users',
      session: 'sessions',
    })
  : new BetterSqlite3Adapter(sqliteDb!, {
      user: 'users',
      session: 'sessions',
    });

export const lucia = new Lucia(adapter, {
  sessionCookie: {
    attributes: {
      secure: process.env.NODE_ENV === 'production',
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
