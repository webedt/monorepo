# Coding Style Guide

This document defines the coding conventions used throughout this codebase.

## TypeScript Conventions

### Imports

**Value imports** can be grouped on a single line:
```typescript
import { randomUUID } from 'crypto';
import WebSocket from 'ws';
import { AClaudeWebClient } from './AClaudeWebClient.js';
import { ClaudeRemoteError } from './types.js';
```

**Type imports** use `import type` with one import per line:
```typescript
import type { ClaudeWebClientConfig } from './types.js';
import type { CreateSessionParams } from './types.js';
import type { CreateSessionResult } from './types.js';
import type { Session } from './types.js';
```

**Import order:**
1. Node.js built-ins (`crypto`, `fs`, `path`)
2. External packages (`ws`, `express`)
3. Internal value imports (classes, functions, constants)
4. Internal type imports (one per line)

**File extensions:** Always use `.js` extension for relative imports (TypeScript ESM).

### Abstract Class Pattern

For modules with abstract base classes, documentation interfaces, and implementations:

| File | JSDoc | Purpose |
|------|-------|---------|
| `AClassName.ts` | None | Abstract method signatures only, no documentation |
| `className.doc.ts` | Full | Interface with complete documentation |
| `className.ts` | None | Implementation, no documentation |

### Method Signatures (Abstract Classes)

Parameters on separate lines with two-space indentation, return type on closing line:

```typescript
abstract methodName(
  param1: Type1,
  param2: Type2
): ReturnType;
```

### Spacing

- Single blank line between methods
- Single blank line between import groups
- File ends with single newline
- No trailing whitespace

### Type Definitions

- Use `interface` for object shapes that may be extended
- Use `type` for unions, intersections, and aliases
- Export types from a dedicated `types.ts` file

### Naming Conventions

- **Classes:** PascalCase (`ClaudeWebClient`)
- **Abstract classes:** Prefix with `A` (`AClaudeWebClient`)
- **Documentation interfaces:** Prefix with `I` and suffix with `Documentation` (`IClaudeWebClientDocumentation`)
- **Types:** PascalCase (`SessionResult`, `EventCallback`)
- **Functions/methods:** camelCase (`createSession`, `pollSession`)
- **Constants:** SCREAMING_SNAKE_CASE (`DEFAULT_BASE_URL`)
- **Private methods:** camelCase with no prefix (`buildHeaders`, `extractBranchName`)

### Error Handling

#### Custom Error Classes

Create custom error classes extending `Error` with relevant context:

```typescript
export class ClaudeRemoteError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseText?: string
  ) {
    super(message);
    this.name = 'ClaudeRemoteError';
  }
}
```

#### Catch Block Patterns

**NEVER** use empty catch blocks or swallow errors silently. Every catch block must do ONE of the following:

##### Pattern 1: Re-throw (for critical errors)
Use when the caller needs to handle the error:
```typescript
try {
  await criticalOperation();
} catch (error) {
  // Add context and re-throw
  throw new AppError(`Failed to perform critical operation: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
}
```

##### Pattern 2: Wrap and Throw (for API boundaries)
Use at API boundaries to provide consistent error responses:
```typescript
try {
  const data = await fetchData();
  return data;
} catch (error) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  logger.error('Data fetch failed', error, { component: 'DataService' });
  throw new ServiceError(`Data fetch failed: ${message}`, { statusCode: 500, cause: error });
}
```

##### Pattern 3: Recover with Fallback (for non-critical operations)
Use when a sensible fallback exists AND the caller doesn't need to know about the failure:
```typescript
try {
  const cached = await cache.get(key);
  return cached;
} catch (error) {
  // Log the failure for debugging, then use fallback
  logger.warn('Cache read failed, using fallback', { key, error: error instanceof Error ? error.message : 'Unknown' });
  return defaultValue;
}
```

##### Pattern 4: User Notification (for frontend)
Use in UI code when the user should be informed:
```typescript
try {
  await saveDocument();
  toast.success('Document saved');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Failed to save document';
  logger.error('Document save failed', error);
  toast.error(message);
  // Optionally re-throw if parent component needs to handle
}
```

##### Pattern 5: Fire-and-Forget with Logging (for telemetry/analytics)
Use ONLY for truly optional background operations:
```typescript
try {
  await analytics.track('page_view', { page: 'home' });
} catch (error) {
  // Log but don't propagate - analytics failure shouldn't break the app
  logger.warn('Analytics tracking failed', { error: error instanceof Error ? error.message : 'Unknown' });
}
```

#### Anti-Patterns to AVOID

```typescript
// ❌ NEVER: Empty catch block
try { await operation(); } catch { }

// ❌ NEVER: Silent catch with comment
try { await operation(); } catch { /* ignore */ }

// ❌ NEVER: Return null without logging
try { return await fetchData(); } catch { return null; }

// ❌ NEVER: console.log only (use logger)
try { await operation(); } catch (e) { console.log(e); }

// ❌ NEVER: Catch without error type check
try { await operation(); } catch (e) {
  // What if e is not an Error? Always check!
  throw new Error(e.message); // Could crash if e is not an Error
}
```

#### Error Type Guards

Always check error types before accessing properties:

```typescript
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return 'Unknown error occurred';
}

// Usage
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', { error: getErrorMessage(error) });
  throw new AppError(`Operation failed: ${getErrorMessage(error)}`, { cause: error });
}
```

#### When to Use Each Pattern

| Scenario | Pattern | Example |
|----------|---------|---------|
| Database operations | Re-throw | Query failures should propagate |
| API calls | Wrap and Throw | Add HTTP status context |
| Cache reads | Recover with Fallback | Missing cache isn't critical |
| User actions | User Notification | Show toast/alert |
| Background sync | Fire-and-Forget | Log only, don't block UI |
| Authentication | Re-throw | Auth errors must propagate |
| File parsing | Wrap and Throw | Add file path context |
| Optional features | Recover with Fallback | Feature flag checks |

## DataLoader Patterns

DataLoaders prevent N+1 query problems by batching multiple individual lookups into single bulk queries. Use DataLoaders when fetching related entities in loops.

### Available Loaders

Loaders are available via `req.loaders` in Express routes (requires `batchContextMiddleware()`):

| Category | Loader | Description |
|----------|--------|-------------|
| **User** | `user` | Full user records by ID |
| | `userInfo` | User info (safe for display) by ID |
| | `author` | Author info (id + displayName) by ID |
| **Session** | `session` | Chat sessions by ID |
| | `activeSession` | Active (non-deleted) sessions by ID |
| | `sessionSummary` | Session summaries by ID |
| **Game/Store** | `game` | Games by ID |
| | `publishedGame` | Published games only by ID |
| | `gameSummary` | Lightweight game summaries by ID |
| **Organization** | `organization` | Organizations by ID |
| | `organizationBySlug` | Organizations by slug |
| | `organizationMembers` | Members with user info by org ID |
| | `organizationRepos` | Repositories by org ID |
| | `organizationMemberCount` | Member counts by org ID |
| **Collection** | `collection` | Collections by ID |
| | `collectionSessionCount` | Session counts by collection ID |
| | `sessionCollections` | Collections a session belongs to |
| **Event** | `eventSummary` | Event summaries by session ID |
| | `eventCount` | Event counts by session ID |

### Usage Pattern

```typescript
// Setup: Add middleware to Express app
app.use(batchContextMiddleware());

// Usage in routes
router.get('/posts', async (req: BatchContextRequest, res) => {
  const posts = await getPosts();

  // Bad: N+1 queries (one per author)
  for (const post of posts) {
    post.author = await db.select().from(users).where(eq(users.id, post.authorId));
  }

  // Good: Batched into single query
  const authors = await Promise.all(
    posts.map(p => req.loaders.author.load(p.authorId))
  );
  posts.forEach((post, i) => post.author = authors[i]);
});
```

### Creating Custom Loaders

Use `createCustomLoader` for one-off batch loading needs:

```typescript
import { createCustomLoader } from '../middleware/batchContext.js';
import { createResultMap } from '@webedt/shared';

router.get('/items', async (req, res) => {
  const commentLoader = createCustomLoader(req, 'comments', async (ids) => {
    const comments = await db.select().from(comments).where(inArray(comments.id, ids));
    return createResultMap(comments, 'id');
  });

  const comments = await commentLoader.loadMany(commentIds);
});
```

### Creating New Entity Loaders

Add new loaders to `shared/src/db/loaders/`:

```typescript
// shared/src/db/loaders/myEntityLoader.ts
import { DataLoader, createResultMap } from '../dataLoader.js';
import { db, myTable } from '../index.js';
import type { DataLoaderOptions } from '../dataLoader.js';

export function createMyEntityLoader(options?: DataLoaderOptions): DataLoader<string, MyEntity> {
  return new DataLoader<string, MyEntity>(
    async (ids: string[]) => {
      const results = await db
        .select()
        .from(myTable)
        .where(inArray(myTable.id, ids));
      return createResultMap(results, 'id');
    },
    options
  );
}
```

Then export from `loaders/index.ts` and add to `batchContext.ts`.

### Best Practices

1. **Request-scoped loaders**: Create loaders per request, not globally
2. **Use for related entities**: Best for loading related data in loops (authors, tags, etc.)
3. **Prefer JOINs for single queries**: If you only need data once, use a JOIN
4. **Loader caching**: Loaders cache within a request - same ID returns same instance
5. **Error handling**: Individual load failures don't fail the batch

### Reference Examples

See `shared/src/db/loaders/` for canonical examples:
- [userLoader.ts](shared/src/db/loaders/userLoader.ts) - User entity loaders
- [sessionLoader.ts](shared/src/db/loaders/sessionLoader.ts) - Session loaders
- [gameLoader.ts](shared/src/db/loaders/gameLoader.ts) - Game/store loaders
- [organizationLoader.ts](shared/src/db/loaders/organizationLoader.ts) - Organization loaders
- [collectionLoader.ts](shared/src/db/loaders/collectionLoader.ts) - Collection loaders
- [eventLoader.ts](shared/src/db/loaders/eventLoader.ts) - Event loaders

## Reference Examples

See `shared/src/claudeWeb/` for canonical examples:
- [AClaudeWebClient.ts](shared/src/claudeWeb/AClaudeWebClient.ts) - Abstract class pattern
- [claudeWebClient.doc.ts](shared/src/claudeWeb/claudeWebClient.doc.ts) - Documentation interface
- [claudeWebClient.ts](shared/src/claudeWeb/claudeWebClient.ts) - Implementation
- [types.ts](shared/src/claudeWeb/types.ts) - Type definitions
