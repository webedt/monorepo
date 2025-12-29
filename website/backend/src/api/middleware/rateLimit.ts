/**
 * Rate Limiting Middleware
 *
 * Provides defense-in-depth API rate limiting with configurable limits
 * based on endpoint sensitivity. This supplements infrastructure-level
 * rate limiting (nginx, Traefik, etc.) for additional security.
 *
 * Rate limit tiers:
 * - Strict: Auth endpoints (login/register) - prevents brute-force attacks
 * - Moderate: Public share endpoints - prevents enumeration attacks
 * - Standard: Authenticated API endpoints - general DoS protection
 * - AI Operations: Expensive AI endpoints (execute, imageGen, transcribe) - prevents abuse
 * - Sync Operations: Session sync with Claude Remote API - prevents excessive API calls
 * - Search Operations: Database-heavy search queries - prevents resource exhaustion
 * - Collaboration: Real-time workspace features - prevents spam
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { logger, metrics } from '@webedt/shared';

import type { AuthRequest } from './auth.js';

/**
 * Rate limit tier types for metrics tracking
 */
export type RateLimitTier = 'auth' | 'public' | 'standard' | 'ai' | 'sync' | 'search' | 'collaboration';

/**
 * Rate limit configuration from environment variables
 */
const config = {
  // Strict limits for auth endpoints (default: 5 requests per minute)
  authWindowMs: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS || '60000', 10),
  authMaxRequests: parseInt(process.env.RATE_LIMIT_AUTH_MAX || '5', 10),

  // Moderate limits for public share endpoints (default: 30 requests per minute)
  publicWindowMs: parseInt(process.env.RATE_LIMIT_PUBLIC_WINDOW_MS || '60000', 10),
  publicMaxRequests: parseInt(process.env.RATE_LIMIT_PUBLIC_MAX || '30', 10),

  // Standard limits for authenticated endpoints (default: 100 requests per minute)
  standardWindowMs: parseInt(process.env.RATE_LIMIT_STANDARD_WINDOW_MS || '60000', 10),
  standardMaxRequests: parseInt(process.env.RATE_LIMIT_STANDARD_MAX || '100', 10),

  // AI operation limits (default: 10 requests per minute)
  // Applies to: execute-remote, imageGen, transcribe
  aiWindowMs: parseInt(process.env.RATE_LIMIT_AI_WINDOW_MS || '60000', 10),
  aiMaxRequests: parseInt(process.env.RATE_LIMIT_AI_MAX || '10', 10),

  // Sync operation limits (default: 5 requests per minute)
  // Applies to: sessions/sync, sessions/:id/sync-events
  syncWindowMs: parseInt(process.env.RATE_LIMIT_SYNC_WINDOW_MS || '60000', 10),
  syncMaxRequests: parseInt(process.env.RATE_LIMIT_SYNC_MAX || '5', 10),

  // Search operation limits (default: 30 requests per minute)
  // Applies to: universal search, autocomplete
  searchWindowMs: parseInt(process.env.RATE_LIMIT_SEARCH_WINDOW_MS || '60000', 10),
  searchMaxRequests: parseInt(process.env.RATE_LIMIT_SEARCH_MAX || '30', 10),

  // Collaboration limits (default: 60 requests per minute)
  // Applies to: workspace presence, events
  collaborationWindowMs: parseInt(process.env.RATE_LIMIT_COLLABORATION_WINDOW_MS || '60000', 10),
  collaborationMaxRequests: parseInt(process.env.RATE_LIMIT_COLLABORATION_MAX || '60', 10),

  // Whether to skip rate limiting (for testing/development)
  skipRateLimiting: process.env.SKIP_RATE_LIMITING === 'true',
};

/**
 * Metrics tracking for rate limit hits
 */
interface RateLimitMetrics {
  totalHits: number;
  hitsByTier: Record<RateLimitTier, number>;
  hitsByPath: Record<string, number>;
  hitsByUser: Record<string, number>;
  lastReset: Date;
}

const rateLimitMetrics: RateLimitMetrics = {
  totalHits: 0,
  hitsByTier: {
    auth: 0,
    public: 0,
    standard: 0,
    ai: 0,
    sync: 0,
    search: 0,
    collaboration: 0,
  },
  hitsByPath: {},
  hitsByUser: {},
  lastReset: new Date(),
};

/**
 * Get current rate limit metrics
 */
export function getRateLimitMetrics(): RateLimitMetrics {
  return { ...rateLimitMetrics };
}

/**
 * Reset rate limit metrics (for testing)
 */
export function resetRateLimitMetrics(): void {
  rateLimitMetrics.totalHits = 0;
  rateLimitMetrics.hitsByTier = {
    auth: 0,
    public: 0,
    standard: 0,
    ai: 0,
    sync: 0,
    search: 0,
    collaboration: 0,
  };
  rateLimitMetrics.hitsByPath = {};
  rateLimitMetrics.hitsByUser = {};
  rateLimitMetrics.lastReset = new Date();
}

/**
 * Record a rate limit hit
 */
function recordRateLimitHit(tier: RateLimitTier, path: string, ip: string, userId?: string): void {
  // Update local metrics
  rateLimitMetrics.totalHits++;
  rateLimitMetrics.hitsByTier[tier]++;
  rateLimitMetrics.hitsByPath[path] = (rateLimitMetrics.hitsByPath[path] || 0) + 1;

  // Track per-user hits for authenticated tiers
  if (userId) {
    rateLimitMetrics.hitsByUser[userId] = (rateLimitMetrics.hitsByUser[userId] || 0) + 1;
  }

  // Record to shared metrics for centralized monitoring
  metrics.recordRateLimitHit(tier, path);

  logger.warn('Rate limit exceeded', {
    component: 'RateLimit',
    tier,
    path,
    ip,
    userId: userId || 'anonymous',
    totalHits: rateLimitMetrics.totalHits,
  });
}

/**
 * Standard rate limit response handler
 * Returns proper 429 response with Retry-After header
 */
function createRateLimitHandler(tier: RateLimitTier) {
  return (req: Request, res: Response, _next: NextFunction, options: { windowMs: number }): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    recordRateLimitHit(tier, req.path, ip, userId);

    // Calculate retry-after in seconds
    const retryAfterSeconds = Math.ceil(options.windowMs / 1000);

    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.',
      retryAfter: retryAfterSeconds,
      tier,
    });
  };
}

/**
 * Key generator that uses IP address
 * For authenticated endpoints, could optionally use user ID for per-user limits
 */
function keyGenerator(req: Request): string {
  // Use IP address as the primary key
  // X-Forwarded-For header handling for proxied requests
  const forwardedFor = req.headers['x-forwarded-for'];
  if (forwardedFor) {
    const ips = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor).split(',');
    return ips[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Key generator that combines IP and user ID for authenticated requests
 * This allows authenticated users to have their own rate limit buckets
 */
function authenticatedKeyGenerator(req: Request): string {
  const authReq = req as AuthRequest;
  const ip = keyGenerator(req);

  // If user is authenticated, use combination of IP and user ID
  if (authReq.user?.id) {
    return `${ip}:user:${authReq.user.id}`;
  }

  return ip;
}

/**
 * Skip function to disable rate limiting when configured
 */
function skipRateLimiting(): boolean {
  return config.skipRateLimiting;
}

/**
 * Strict rate limiter for authentication endpoints
 *
 * Applies to:
 * - POST /api/auth/login
 * - POST /api/auth/register
 *
 * Default: 5 requests per minute
 */
export const authRateLimiter = rateLimit({
  windowMs: config.authWindowMs,
  max: config.authMaxRequests,
  standardHeaders: true, // Return rate limit info in headers
  legacyHeaders: false, // Disable X-RateLimit-* headers
  keyGenerator,
  skip: skipRateLimiting,
  handler: createRateLimitHandler('auth'),
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again later.',
  },
});

/**
 * Moderate rate limiter for public share endpoints
 *
 * Applies to:
 * - GET /api/sessions/shared/:token
 * - GET /api/sessions/shared/:token/events
 * - GET /api/sessions/shared/:token/events/stream
 *
 * Default: 30 requests per minute
 */
export const publicShareRateLimiter = rateLimit({
  windowMs: config.publicWindowMs,
  max: config.publicMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  skip: skipRateLimiting,
  handler: createRateLimitHandler('public'),
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
});

/**
 * Standard rate limiter for authenticated API endpoints
 *
 * Applies to:
 * - Most /api/* endpoints
 *
 * Default: 100 requests per minute
 */
export const standardRateLimiter = rateLimit({
  windowMs: config.standardWindowMs,
  max: config.standardMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedKeyGenerator,
  skip: skipRateLimiting,
  handler: createRateLimitHandler('standard'),
  message: {
    success: false,
    error: 'Too many requests. Please try again later.',
  },
});

/**
 * AI operations rate limiter for expensive AI endpoints
 *
 * Applies to:
 * - POST /api/execute-remote (AI execution - heavy compute)
 * - POST /api/image-gen/generate (AI image generation - very expensive)
 * - POST /api/transcribe (Audio processing via OpenAI Whisper)
 *
 * Default: 10 requests per minute per user
 * Uses authenticated key generator for per-user tracking
 */
export const aiOperationRateLimiter = rateLimit({
  windowMs: config.aiWindowMs,
  max: config.aiMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedKeyGenerator,
  skip: skipRateLimiting,
  handler: createRateLimitHandler('ai'),
  message: {
    success: false,
    error: 'Too many AI requests. Please wait before submitting another request.',
  },
});

/**
 * Sync operations rate limiter for Claude Remote API sync
 *
 * Applies to:
 * - POST /api/sessions/sync (Full sync with Claude Remote API)
 * - POST /api/sessions/:id/sync-events (Event sync for specific session)
 *
 * Default: 5 requests per minute per user
 * Uses authenticated key generator for per-user tracking
 */
export const syncOperationRateLimiter = rateLimit({
  windowMs: config.syncWindowMs,
  max: config.syncMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedKeyGenerator,
  skip: skipRateLimiting,
  handler: createRateLimitHandler('sync'),
  message: {
    success: false,
    error: 'Too many sync requests. Please wait before syncing again.',
  },
});

/**
 * Search operations rate limiter for database-heavy searches
 *
 * Applies to:
 * - GET /api/search (Universal search across all fields)
 * - GET /api/search/suggestions (Search suggestions)
 * - GET /api/autocomplete (AI-powered code completion)
 *
 * Default: 30 requests per minute per user
 * Uses authenticated key generator for per-user tracking
 */
export const searchRateLimiter = rateLimit({
  windowMs: config.searchWindowMs,
  max: config.searchMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedKeyGenerator,
  skip: skipRateLimiting,
  handler: createRateLimitHandler('search'),
  message: {
    success: false,
    error: 'Too many search requests. Please slow down.',
  },
});

/**
 * Collaboration rate limiter for real-time workspace features
 *
 * Applies to:
 * - PUT /api/workspace/presence (Presence updates)
 * - POST /api/workspace/events (Workspace event logging)
 *
 * Default: 60 requests per minute per user
 * Higher limit to allow real-time updates
 * Uses authenticated key generator for per-user tracking
 */
export const collaborationRateLimiter = rateLimit({
  windowMs: config.collaborationWindowMs,
  max: config.collaborationMaxRequests,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: authenticatedKeyGenerator,
  skip: skipRateLimiting,
  handler: createRateLimitHandler('collaboration'),
  message: {
    success: false,
    error: 'Too many collaboration requests. Please slow down.',
  },
});

/**
 * Create a custom rate limiter with specific settings
 *
 * @param windowMs - Time window in milliseconds
 * @param max - Maximum requests per window
 * @param tier - Tier name for metrics tracking
 * @returns Express rate limiter middleware
 */
export function createRateLimiter(
  windowMs: number,
  max: number,
  tier: RateLimitTier = 'standard'
) {
  // Use authenticated key generator for user-specific tiers
  const useAuthenticatedKey = ['standard', 'ai', 'sync', 'search', 'collaboration'].includes(tier);

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: useAuthenticatedKey ? authenticatedKeyGenerator : keyGenerator,
    skip: skipRateLimiting,
    handler: createRateLimitHandler(tier),
    message: {
      success: false,
      error: 'Too many requests. Please try again later.',
    },
  });
}

/**
 * Log rate limit configuration on startup
 */
export function logRateLimitConfig(): void {
  if (config.skipRateLimiting) {
    logger.warn('Rate limiting is DISABLED (SKIP_RATE_LIMITING=true)', {
      component: 'RateLimit',
    });
    return;
  }

  logger.info('Rate limiting enabled', {
    component: 'RateLimit',
    auth: {
      windowMs: config.authWindowMs,
      maxRequests: config.authMaxRequests,
    },
    public: {
      windowMs: config.publicWindowMs,
      maxRequests: config.publicMaxRequests,
    },
    standard: {
      windowMs: config.standardWindowMs,
      maxRequests: config.standardMaxRequests,
    },
    ai: {
      windowMs: config.aiWindowMs,
      maxRequests: config.aiMaxRequests,
      description: 'AI execution, image gen, transcribe',
    },
    sync: {
      windowMs: config.syncWindowMs,
      maxRequests: config.syncMaxRequests,
      description: 'Session sync with Claude Remote API',
    },
    search: {
      windowMs: config.searchWindowMs,
      maxRequests: config.searchMaxRequests,
      description: 'Universal search, autocomplete',
    },
    collaboration: {
      windowMs: config.collaborationWindowMs,
      maxRequests: config.collaborationMaxRequests,
      description: 'Workspace presence, events',
    },
  });
}
