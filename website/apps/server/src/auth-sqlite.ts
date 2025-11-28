import { Lucia } from 'lucia';
import { BetterSqlite3Adapter } from '@lucia-auth/adapter-sqlite';
import { sqliteDb } from './db/index-sqlite';

const adapter = new BetterSqlite3Adapter(sqliteDb, {
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
      claudeAuth: attributes.claude_auth ? JSON.parse(attributes.claude_auth as string) : null,
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
      preferred_model: string | null;
      is_admin: boolean;
    };
  }
}
