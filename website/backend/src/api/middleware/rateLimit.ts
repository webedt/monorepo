/**
 * Rate Limiting Middleware
 *
 * Provides defense-in-depth API rate limiting with configurable limits
 * based on endpoint sensitivity. Uses sliding window algorithm for smoother
 * rate limiting compared to fixed windows.
 *
 * Features:
 * - Sliding window algorithm for accurate rate limiting
 * - Per-user and per-IP rate limiting
 * - Admin override capability
 * - Circuit breaker integration
 * - Comprehensive metrics and monitoring
 * - In-memory storage with Redis-ready architecture
 *
 * Rate limit tiers:
 * - Strict: Auth endpoints (login/register) - prevents brute-force attacks
 * - Moderate: Public share endpoints - prevents enumeration attacks
 * - Standard: Authenticated API endpoints - general DoS protection
 * - AI Operations: Expensive AI endpoints (execute, imageGen, transcribe) - prevents abuse
 * - Sync Operations: Session sync with Claude Remote API - prevents excessive API calls
 * - Search Operations: Database-heavy search queries - prevents resource exhaustion
 * - Collaboration: Real-time workspace features - prevents spam
 * - File Operations: File read/write operations - prevents abuse
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import {
  logger,
  metrics,
  createSlidingWindowStore,
  circuitBreakerRegistry,
} from '@webedt/shared';
import type { SlidingWindowStore } from '@webedt/shared';

import type { AuthRequest } from './auth.js';

/**
 * Rate limit tier types for metrics tracking
 */
export type RateLimitTier =
  | 'auth'
  | 'public'
  | 'standard'
  | 'ai'
  | 'sync'
  | 'search'
  | 'collaboration'
  | 'sse'
  | 'file'
  | 'shareToken';

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

  // SSE reconnection limits (default: 10 reconnects per minute per session)
  // Applies to: SSE streaming endpoints to prevent aggressive reconnection patterns
  sseWindowMs: parseInt(process.env.RATE_LIMIT_SSE_WINDOW_MS || '60000', 10),
  sseMaxRequests: parseInt(process.env.RATE_LIMIT_SSE_MAX || '10', 10),

  // File operation limits (default: 100 requests per minute)
  // Applies to: file read/write operations
  fileWindowMs: parseInt(process.env.RATE_LIMIT_FILE_WINDOW_MS || '60000', 10),
  fileMaxRequests: parseInt(process.env.RATE_LIMIT_FILE_MAX || '100', 10),

  // Share token validation limits (default: 10 requests per minute - stricter to prevent enumeration)
  // Applies to: share token validation endpoints
  shareTokenWindowMs: parseInt(process.env.RATE_LIMIT_SHARE_TOKEN_WINDOW_MS || '60000', 10),
  shareTokenMaxRequests: parseInt(process.env.RATE_LIMIT_SHARE_TOKEN_MAX || '10', 10),

  // Whether to skip rate limiting (for testing/development)
  skipRateLimiting: process.env.SKIP_RATE_LIMITING === 'true',

  // Whether to skip rate limiting for admins (default: true)
  skipForAdmins: process.env.RATE_LIMIT_SKIP_ADMINS !== 'false',

  // Circuit breaker degradation multiplier (reduce limits when circuit is open)
  circuitBreakerDegradationFactor: parseFloat(process.env.RATE_LIMIT_CB_DEGRADATION || '0.5'),
};

/**
 * Metrics tracking for rate limit hits
 */
interface RateLimitMetrics {
  totalRequests: number;
  totalBlocked: number;
  hitsByTier: Record<RateLimitTier, number>;
  hitsByPath: Record<string, number>;
  hitsByUser: Record<string, number>;
  adminBypass: number;
  circuitBreakerDegraded: number;
  lastReset: Date;
}

const rateLimitMetrics: RateLimitMetrics = {
  totalRequests: 0,
  totalBlocked: 0,
  hitsByTier: {
    auth: 0,
    public: 0,
    standard: 0,
    ai: 0,
    sync: 0,
    search: 0,
    collaboration: 0,
    sse: 0,
    file: 0,
    shareToken: 0,
  },
  hitsByPath: {},
  hitsByUser: {},
  adminBypass: 0,
  circuitBreakerDegraded: 0,
  lastReset: new Date(),
};

/**
 * Sliding window stores for each tier
 */
const stores: Record<RateLimitTier, SlidingWindowStore> = {
  auth: createSlidingWindowStore(config.authWindowMs),
  public: createSlidingWindowStore(config.publicWindowMs),
  standard: createSlidingWindowStore(config.standardWindowMs),
  ai: createSlidingWindowStore(config.aiWindowMs),
  sync: createSlidingWindowStore(config.syncWindowMs),
  search: createSlidingWindowStore(config.searchWindowMs),
  collaboration: createSlidingWindowStore(config.collaborationWindowMs),
  sse: createSlidingWindowStore(config.sseWindowMs),
  file: createSlidingWindowStore(config.fileWindowMs),
  shareToken: createSlidingWindowStore(config.shareTokenWindowMs),
};

/**
 * Get current rate limit metrics
 */
export function getRateLimitMetrics(): RateLimitMetrics {
  return { ...rateLimitMetrics };
}

/**
 * Get detailed rate limit dashboard data
 */
export function getRateLimitDashboard(): {
  metrics: RateLimitMetrics;
  config: Record<string, { windowMs: number; maxRequests: number }>;
  storeStats: Record<RateLimitTier, { keys: number; hits: number; blocked: number }>;
  circuitBreakers: Record<string, { state: string; failures: number }>;
} {
  const storeStats: Record<RateLimitTier, { keys: number; hits: number; blocked: number }> = {} as any;

  for (const [tier, store] of Object.entries(stores)) {
    storeStats[tier as RateLimitTier] = store.getStats();
  }

  const circuitBreakers: Record<string, { state: string; failures: number }> = {};
  const allStats = circuitBreakerRegistry.getAllStats();
  for (const [name, stats] of Object.entries(allStats)) {
    circuitBreakers[name] = {
      state: stats.state,
      failures: stats.consecutiveFailures,
    };
  }

  return {
    metrics: getRateLimitMetrics(),
    config: {
      auth: { windowMs: config.authWindowMs, maxRequests: config.authMaxRequests },
      public: { windowMs: config.publicWindowMs, maxRequests: config.publicMaxRequests },
      standard: { windowMs: config.standardWindowMs, maxRequests: config.standardMaxRequests },
      ai: { windowMs: config.aiWindowMs, maxRequests: config.aiMaxRequests },
      sync: { windowMs: config.syncWindowMs, maxRequests: config.syncMaxRequests },
      search: { windowMs: config.searchWindowMs, maxRequests: config.searchMaxRequests },
      collaboration: { windowMs: config.collaborationWindowMs, maxRequests: config.collaborationMaxRequests },
      sse: { windowMs: config.sseWindowMs, maxRequests: config.sseMaxRequests },
      file: { windowMs: config.fileWindowMs, maxRequests: config.fileMaxRequests },
    },
    storeStats,
    circuitBreakers,
  };
}

/**
 * Reset rate limit metrics (for testing)
 */
export function resetRateLimitMetrics(): void {
  rateLimitMetrics.totalRequests = 0;
  rateLimitMetrics.totalBlocked = 0;
  rateLimitMetrics.hitsByTier = {
    auth: 0,
    public: 0,
    standard: 0,
    ai: 0,
    sync: 0,
    search: 0,
    collaboration: 0,
    sse: 0,
    file: 0,
    shareToken: 0,
  };
  rateLimitMetrics.hitsByPath = {};
  rateLimitMetrics.hitsByUser = {};
  rateLimitMetrics.adminBypass = 0;
  rateLimitMetrics.circuitBreakerDegraded = 0;
  rateLimitMetrics.lastReset = new Date();
}

/**
 * Record a rate limit hit
 */
function recordRateLimitHit(tier: RateLimitTier, path: string, ip: string, userId?: string): void {
  // Update local metrics
  rateLimitMetrics.totalBlocked++;
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
    totalBlocked: rateLimitMetrics.totalBlocked,
  });
}

/**
 * Record a request (for metrics)
 */
function recordRequest(tier: RateLimitTier): void {
  rateLimitMetrics.totalRequests++;
}

/**
 * Check if circuit breaker is degraded for a specific tier
 */
function isCircuitBreakerDegraded(tier: RateLimitTier): boolean {
  // Map tiers to relevant circuit breakers
  const tierToBreaker: Partial<Record<RateLimitTier, string>> = {
    ai: 'claude-remote',
    sync: 'claude-remote',
  };

  const breakerName = tierToBreaker[tier];
  if (!breakerName) return false;

  try {
    const stats = circuitBreakerRegistry.getAllStats();
    const breakerStats = stats[breakerName];
    if (breakerStats && (breakerStats.state === 'open' || breakerStats.state === 'half_open')) {
      rateLimitMetrics.circuitBreakerDegraded++;
      return true;
    }
  } catch {
    // Circuit breaker not initialized yet
  }

  return false;
}

/**
 * Get effective max requests considering circuit breaker state
 */
function getEffectiveMaxRequests(tier: RateLimitTier, baseMax: number): number {
  if (isCircuitBreakerDegraded(tier)) {
    return Math.floor(baseMax * config.circuitBreakerDegradationFactor);
  }
  return baseMax;
}

/**
 * Standard rate limit response handler
 * Returns proper 429 response with Retry-After header
 */
function createRateLimitHandler(tier: RateLimitTier, store: SlidingWindowStore) {
  return (req: Request, res: Response, _next: NextFunction, options: { windowMs: number }): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const authReq = req as AuthRequest;
    const userId = authReq.user?.id;

    recordRateLimitHit(tier, req.path, ip, userId);
    store.recordBlocked();

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
 * Skip function that checks for admin users and global skip
 */
function createSkipFunction(tier: RateLimitTier) {
  return (req: Request): boolean => {
    // Global skip for testing/development
    if (config.skipRateLimiting) {
      return true;
    }

    // Skip for admin users if enabled
    if (config.skipForAdmins) {
      const authReq = req as AuthRequest;
      if (authReq.user?.isAdmin) {
        rateLimitMetrics.adminBypass++;
        logger.debug('Rate limit bypassed for admin', {
          component: 'RateLimit',
          tier,
          userId: authReq.user.id,
          path: req.path,
        });
        return true;
      }
    }

    // Record the request
    recordRequest(tier);

    return false;
  };
}

/**
 * Create a rate limiter with sliding window store and admin override
 */
function createEnhancedRateLimiter(
  tier: RateLimitTier,
  windowMs: number,
  maxRequests: number,
  keyGen: (req: Request) => string = authenticatedKeyGenerator
): RequestHandler {
  const store = stores[tier];

  return rateLimit({
    windowMs,
    max: (req: Request) => getEffectiveMaxRequests(tier, maxRequests),
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false, // Disable X-RateLimit-* headers
    keyGenerator: keyGen,
    skip: createSkipFunction(tier),
    handler: createRateLimitHandler(tier, store),
    store: store as any, // express-rate-limit store interface
    message: {
      success: false,
      error: 'Too many requests. Please try again later.',
    },
  });
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
export const authRateLimiter = createEnhancedRateLimiter(
  'auth',
  config.authWindowMs,
  config.authMaxRequests,
  keyGenerator // IP-based only for auth
);

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
export const publicShareRateLimiter = createEnhancedRateLimiter(
  'public',
  config.publicWindowMs,
  config.publicMaxRequests,
  keyGenerator // IP-based only for public
);

/**
 * Standard rate limiter for authenticated API endpoints
 *
 * Applies to:
 * - Most /api/* endpoints
 *
 * Default: 100 requests per minute
 */
export const standardRateLimiter = createEnhancedRateLimiter(
  'standard',
  config.standardWindowMs,
  config.standardMaxRequests
);

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
 * Integrates with circuit breaker for degraded mode
 */
export const aiOperationRateLimiter = createEnhancedRateLimiter(
  'ai',
  config.aiWindowMs,
  config.aiMaxRequests
);

/**
 * Sync operations rate limiter for Claude Remote API sync
 *
 * Applies to:
 * - POST /api/sessions/sync (Full sync with Claude Remote API)
 * - POST /api/sessions/:id/sync-events (Event sync for specific session)
 *
 * Default: 5 requests per minute per user
 * Uses authenticated key generator for per-user tracking
 * Integrates with circuit breaker for degraded mode
 */
export const syncOperationRateLimiter = createEnhancedRateLimiter(
  'sync',
  config.syncWindowMs,
  config.syncMaxRequests
);

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
export const searchRateLimiter = createEnhancedRateLimiter(
  'search',
  config.searchWindowMs,
  config.searchMaxRequests
);

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
export const collaborationRateLimiter = createEnhancedRateLimiter(
  'collaboration',
  config.collaborationWindowMs,
  config.collaborationMaxRequests
);

/**
 * File operations rate limiter for file operations
 *
 * Applies to:
 * - File read/write operations
 * - Workspace file operations
 *
 * Default: 100 requests per minute per user
 */
export const fileOperationRateLimiter = createEnhancedRateLimiter(
  'file',
  config.fileWindowMs,
  config.fileMaxRequests
);

/**
 * SSE rate limiter for streaming endpoints
 *
 * Applies to:
 * - GET /api/sessions/:id/events/stream (Session event streaming)
 * - GET /api/resume/:sessionId (Resume session streaming)
 * - Other SSE endpoints
 *
 * Default: 10 reconnects per minute per session
 * Uses session-based key generator that combines user ID and session ID
 * to prevent aggressive reconnection patterns per session
 */

/**
 * Key generator for SSE endpoints that includes session ID
 * This allows rate limiting per-session to prevent reconnection flooding
 */
function sseKeyGenerator(req: Request): string {
  const authReq = req as AuthRequest;
  const ip = keyGenerator(req);
  const userId = authReq.user?.id || 'anonymous';

  // Extract session ID from URL parameters or path
  const sessionId = req.params.sessionId || req.params.id || 'unknown';

  // Rate limit per user per session to prevent aggressive reconnection on specific sessions
  return `sse:${userId}:${sessionId}:${ip}`;
}

export const sseRateLimiter = createEnhancedRateLimiter(
  'sse',
  config.sseWindowMs,
  config.sseMaxRequests,
  sseKeyGenerator
);

/**
 * Share token validation rate limiter
 *
 * Applies to:
 * - GET /api/sessions/shared/:token (View shared session)
 * - GET /api/sessions/shared/:token/events (Get shared session events)
 * - GET /api/sessions/shared/:token/events/stream (Stream shared session events)
 *
 * Default: 10 requests per minute per IP
 * Stricter limits to prevent token enumeration attacks.
 * Uses IP-based key generator (no authentication) since these are public endpoints.
 */
export const shareTokenValidationRateLimiter = createEnhancedRateLimiter(
  'shareToken',
  config.shareTokenWindowMs,
  config.shareTokenMaxRequests,
  keyGenerator // IP-based only for public share token endpoints
);

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
): RequestHandler {
  // Use authenticated key generator for user-specific tiers
  const useAuthenticatedKey = ['standard', 'ai', 'sync', 'search', 'collaboration', 'sse', 'file'].includes(tier);

  return createEnhancedRateLimiter(
    tier,
    windowMs,
    max,
    useAuthenticatedKey ? authenticatedKeyGenerator : keyGenerator
  );
}

/**
 * Middleware to check if user is admin and bypass rate limiting
 * Can be used as a pre-check before rate limiting middleware
 */
export function adminRateLimitBypass(req: Request, res: Response, next: NextFunction): void {
  const authReq = req as AuthRequest;

  if (authReq.user?.isAdmin && config.skipForAdmins) {
    // Skip to the next non-rate-limiting middleware
    // This is handled by the skip function in createEnhancedRateLimiter
  }

  next();
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

  logger.info('Rate limiting enabled with sliding window algorithm', {
    component: 'RateLimit',
    skipForAdmins: config.skipForAdmins,
    circuitBreakerDegradation: config.circuitBreakerDegradationFactor,
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
    file: {
      windowMs: config.fileWindowMs,
      maxRequests: config.fileMaxRequests,
      description: 'File read/write operations',
    },
    sse: {
      windowMs: config.sseWindowMs,
      maxRequests: config.sseMaxRequests,
      description: 'SSE streaming endpoints - per session',
    },
    shareToken: {
      windowMs: config.shareTokenWindowMs,
      maxRequests: config.shareTokenMaxRequests,
      description: 'Share token validation - anti-enumeration',
    },
  });
}

/**
 * Cleanup function for graceful shutdown
 */
export function cleanupRateLimitStores(): void {
  for (const store of Object.values(stores)) {
    store.destroy();
  }
  logger.info('Rate limit stores cleaned up', { component: 'RateLimit' });
}
