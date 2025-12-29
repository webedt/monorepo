/**
 * Cache Headers Middleware
 *
 * Adds HTTP cache headers to responses based on route configuration.
 * Supports Cache-Control, ETag, and conditional request handling.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import { createHash } from 'crypto';

/**
 * Cache control directives
 */
export interface CacheControlOptions {
  /** Cache duration in seconds */
  maxAge?: number;
  /** Shared cache duration in seconds (for CDNs/proxies) */
  sMaxAge?: number;
  /** Allow public caching */
  public?: boolean;
  /** Require revalidation before serving stale content */
  mustRevalidate?: boolean;
  /** Don't cache at all */
  noCache?: boolean;
  /** Don't store anything */
  noStore?: boolean;
  /** Allow serving stale content while revalidating */
  staleWhileRevalidate?: number;
  /** Allow serving stale content on error */
  staleIfError?: number;
}

/**
 * Build Cache-Control header value from options
 */
function buildCacheControl(options: CacheControlOptions): string {
  const directives: string[] = [];

  if (options.noStore) {
    return 'no-store';
  }

  if (options.noCache) {
    directives.push('no-cache');
  }

  if (options.public) {
    directives.push('public');
  } else {
    directives.push('private');
  }

  if (options.maxAge !== undefined) {
    directives.push(`max-age=${options.maxAge}`);
  }

  if (options.sMaxAge !== undefined) {
    directives.push(`s-maxage=${options.sMaxAge}`);
  }

  if (options.mustRevalidate) {
    directives.push('must-revalidate');
  }

  if (options.staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }

  if (options.staleIfError !== undefined) {
    directives.push(`stale-if-error=${options.staleIfError}`);
  }

  return directives.join(', ');
}

/**
 * Generate ETag from response body
 */
function generateETag(body: string | Buffer | object): string {
  const content = typeof body === 'object' && !Buffer.isBuffer(body)
    ? JSON.stringify(body)
    : body.toString();
  const hash = createHash('md5').update(content).digest('hex');
  return `"${hash}"`;
}

/**
 * Cache headers middleware factory
 */
export function cacheHeaders(options: CacheControlOptions): RequestHandler {
  const cacheControl = buildCacheControl(options);

  return (req: Request, res: Response, next: NextFunction): void => {
    // Set Cache-Control header
    res.setHeader('Cache-Control', cacheControl);

    // Add Vary header for user-specific caching
    res.setHeader('Vary', 'Accept, Accept-Encoding, Authorization');

    next();
  };
}

/**
 * No cache middleware - prevents caching entirely
 */
export const noCache: RequestHandler = cacheHeaders({
  noStore: true,
});

/**
 * Short cache middleware - cache for 1 minute, revalidate
 */
export const shortCache: RequestHandler = cacheHeaders({
  maxAge: 60,
  mustRevalidate: true,
  staleWhileRevalidate: 30,
});

/**
 * Medium cache middleware - cache for 5 minutes
 */
export const mediumCache: RequestHandler = cacheHeaders({
  maxAge: 300,
  staleWhileRevalidate: 60,
  staleIfError: 300,
});

/**
 * Long cache middleware - cache for 1 hour
 */
export const longCache: RequestHandler = cacheHeaders({
  maxAge: 3600,
  staleWhileRevalidate: 300,
  staleIfError: 3600,
});

/**
 * Static cache middleware - cache for 1 day
 */
export const staticCache: RequestHandler = cacheHeaders({
  public: true,
  maxAge: 86400,
  sMaxAge: 86400,
});

/**
 * ETag middleware - adds ETag header and handles conditional requests
 */
export function etagMiddleware(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Store original json method
    const originalJson = res.json.bind(res);

    // Override json method to add ETag
    res.json = function(body: unknown): Response {
      // Generate ETag
      const etag = generateETag(body as object);
      res.setHeader('ETag', etag);

      // Check If-None-Match header for conditional request
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        res.status(304).end();
        return res;
      }

      return originalJson(body);
    };

    next();
  };
}

/**
 * Conditional request handler - returns 304 if content unchanged
 */
export function conditionalGet(
  getETag: (req: Request) => string | Promise<string>
): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const etag = await getETag(req);

      // Set ETag header
      res.setHeader('ETag', `"${etag}"`);

      // Check If-None-Match header
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === `"${etag}"`) {
        res.status(304).end();
        return;
      }

      next();
    } catch {
      // If ETag generation fails, just continue
      next();
    }
  };
}

/**
 * Cache-Control presets for different route types
 */
export const CACHE_PRESETS = {
  /** User-specific data that changes frequently */
  userDynamic: { maxAge: 0, noCache: true, mustRevalidate: true },
  /** Session list - updates on mutations */
  sessionList: { maxAge: 30, staleWhileRevalidate: 60, mustRevalidate: true },
  /** Session detail - moderately dynamic */
  sessionDetail: { maxAge: 60, staleWhileRevalidate: 120 },
  /** GitHub repos - changes less frequently */
  githubRepos: { maxAge: 300, staleWhileRevalidate: 300, staleIfError: 600 },
  /** GitHub branches - changes with commits */
  githubBranches: { maxAge: 180, staleWhileRevalidate: 180 },
  /** Static assets */
  staticAssets: { public: true, maxAge: 86400, sMaxAge: 604800 },
  /** Health endpoints */
  health: { maxAge: 5, mustRevalidate: true },
} as const;
