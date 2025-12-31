/**
 * BatchContext Middleware
 *
 * Creates request-scoped DataLoaders for batch loading entities.
 * This prevents N+1 query problems by coalescing multiple individual
 * lookups into single batch queries.
 *
 * Usage:
 * 1. Add batchContextMiddleware() to your Express app
 * 2. Access loaders via req.loaders in route handlers
 * 3. Loaders are automatically cleared after each request
 *
 * @example
 * // In app setup
 * app.use(batchContextMiddleware());
 *
 * // In route handler
 * router.get('/posts', async (req: BatchContextRequest, res) => {
 *   const posts = await getPosts();
 *   const authors = await Promise.all(
 *     posts.map(p => req.loaders.author.load(p.authorId))
 *   );
 * });
 */

import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  BatchContext,
  createUserLoader,
  createUserInfoLoader,
  createAuthorInfoLoader,
  createSessionLoader,
  createActiveSessionLoader,
  createSessionSummaryLoader,
} from '@webedt/shared';

import type { DataLoader, User, ChatSession, UserInfo, AuthorInfo, SessionSummary } from '@webedt/shared';

/**
 * Collection of request-scoped entity loaders
 */
export interface RequestLoaders {
  /** Batch load full user records by ID */
  user: DataLoader<string, User>;
  /** Batch load user info (safe for display) by ID */
  userInfo: DataLoader<string, UserInfo>;
  /** Batch load author info (id + displayName) by user ID */
  author: DataLoader<string, AuthorInfo>;
  /** Batch load chat sessions by ID */
  session: DataLoader<string, ChatSession>;
  /** Batch load active (non-deleted) sessions by ID */
  activeSession: DataLoader<string, ChatSession>;
  /** Batch load session summaries by ID */
  sessionSummary: DataLoader<string, SessionSummary>;
  /** The underlying BatchContext for custom loaders */
  context: BatchContext;
}

/**
 * Extended Express Request with loaders attached
 */
export interface BatchContextRequest extends Request {
  loaders: RequestLoaders;
}

/**
 * Type guard to check if request has loaders attached
 */
export function hasBatchContext(req: Request): req is BatchContextRequest {
  return 'loaders' in req && req.loaders !== undefined;
}

/**
 * Get loaders from request, throwing if not available
 */
export function getLoaders(req: Request): RequestLoaders {
  if (!hasBatchContext(req)) {
    throw new Error('BatchContext middleware not configured. Add batchContextMiddleware() to your Express app.');
  }
  return req.loaders;
}

/**
 * Create request-scoped loaders
 */
function createRequestLoaders(): RequestLoaders {
  const context = new BatchContext();

  return {
    user: createUserLoader(),
    userInfo: createUserInfoLoader(),
    author: createAuthorInfoLoader(),
    session: createSessionLoader(),
    activeSession: createActiveSessionLoader(),
    sessionSummary: createSessionSummaryLoader(),
    context,
  };
}

/**
 * Middleware that attaches request-scoped DataLoaders
 *
 * Creates fresh loaders for each request to ensure proper isolation.
 * Loaders are automatically cleared when the response finishes.
 *
 * @example
 * // Add to Express app
 * app.use(batchContextMiddleware());
 *
 * // Use in routes
 * router.get('/items', async (req: BatchContextRequest, res) => {
 *   const items = await getItems();
 *   const authors = await req.loaders.author.loadMany(
 *     items.map(i => i.authorId)
 *   );
 * });
 */
export function batchContextMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    // Create request-scoped loaders
    const loaders = createRequestLoaders();

    // Attach to request
    (req as BatchContextRequest).loaders = loaders;

    // Track cleanup state to prevent double-clearing
    let cleaned = false;
    const cleanup = () => {
      if (!cleaned) {
        cleaned = true;
        loaders.context.clear();
      }
    };

    // Clean up loaders when response finishes or client disconnects
    // 'close' fires in both cases: normal completion and client disconnect
    res.on('close', cleanup);

    next();
  };
}

/**
 * Helper to create custom loaders using the request's BatchContext
 *
 * @example
 * const commentLoader = createCustomLoader(req, 'comments', async (ids) => {
 *   const comments = await db.select().from(comments).where(inArray(comments.id, ids));
 *   return createResultMap(comments, 'id');
 * });
 */
export function createCustomLoader<K, V>(
  req: Request,
  name: string,
  batchFn: (keys: K[]) => Promise<Map<K, V | null>>
): DataLoader<K, V> {
  const loaders = getLoaders(req);
  return loaders.context.getLoader(name, batchFn);
}
