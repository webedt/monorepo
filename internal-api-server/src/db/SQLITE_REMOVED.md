# SQLite Support Removed

SQLite support was removed from main-server to simplify builds and avoid native compilation issues (better-sqlite3 requires native binaries that need Visual Studio build tools on Windows and platform-specific compilation).

## Current Setup

The main-server now requires PostgreSQL. Set the `DATABASE_URL` environment variable:

```bash
DATABASE_URL=postgresql://user:password@localhost:5432/database
```

## Reintroducing SQLite Support

If you need SQLite support (e.g., for local development without PostgreSQL), follow these steps:

### 1. Add Dependencies

```bash
npm install better-sqlite3 @lucia-auth/adapter-sqlite connect-sqlite3
npm install -D @types/better-sqlite3
```

### 2. Create schema-sqlite.ts

Create `src/db/schema-sqlite.ts` with SQLite-specific schema using Drizzle's SQLite core:

```typescript
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  passwordHash: text('password_hash').notNull(),
  githubId: text('github_id').unique(),
  githubAccessToken: text('github_access_token'),
  claudeAuth: text('claude_auth', { mode: 'json' }).$type<{
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }>(),
  codexAuth: text('codex_auth', { mode: 'json' }).$type<{
    apiKey?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
  }>(),
  preferredProvider: text('preferred_provider').default('claude').notNull(),
  isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// ... add sessions, chatSessions, messages, events tables similarly
// Note: Use integer for booleans, timestamps; text for JSON fields
```

### 3. Update db/index.ts

Modify to conditionally use PostgreSQL or SQLite:

```typescript
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import Database from 'better-sqlite3';
import * as schemaPg from './schema.js';
import * as schemaSqlite from './schema-sqlite.js';

const usePostgres = !!process.env.DATABASE_URL;

export let pool: pg.Pool | null;
export let sqliteDb: Database.Database | null;
export let db: any;

if (usePostgres) {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  db = drizzlePg(pool, { schema: schemaPg });
  sqliteDb = null;
} else {
  const sqlite = new Database('./dev.db');
  sqlite.pragma('foreign_keys = ON');
  db = drizzleSqlite(sqlite, { schema: schemaSqlite });
  sqliteDb = sqlite;
  pool = null;
}
```

### 4. Update auth.ts

Modify to use the appropriate Lucia adapter:

```typescript
import { NodePostgresAdapter } from '@lucia-auth/adapter-postgresql';
import { BetterSqlite3Adapter } from '@lucia-auth/adapter-sqlite';
import { pool, sqliteDb } from './db/index.js';

const usePostgres = !!process.env.DATABASE_URL;

const adapter = usePostgres
  ? new NodePostgresAdapter(pool!, { user: 'users', session: 'sessions' })
  : new BetterSqlite3Adapter(sqliteDb!, { user: 'users', session: 'sessions' });
```

### Key Differences Between PostgreSQL and SQLite

| Feature | PostgreSQL | SQLite |
|---------|------------|--------|
| Booleans | `boolean` type | `integer` (0/1) |
| Timestamps | `timestamp` type | `integer` (unix epoch) |
| JSON | `jsonb` type | `text` with `mode: 'json'` |
| Auto-increment | `serial` | `integer().primaryKey({ autoIncrement: true })` |

### Notes

- SQLite is suitable for development but not recommended for production
- The `better-sqlite3` package requires native compilation
- On Windows, you need Visual Studio Build Tools installed
- Docker builds work fine on Linux/ARM64
