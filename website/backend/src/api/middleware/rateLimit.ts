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
 */

import rateLimit from 'express-rate-limit';
import type { Request, Response, NextFunction } from 'express';
import { logger, metrics } from '@webedt/shared';

import type { AuthRequest } from './auth.js';

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

  // Whether to skip rate limiting (for testing/development)
  skipRateLimiting: process.env.SKIP_RATE_LIMITING === 'true',
};

/**
 * Metrics tracking for rate limit hits
 */
interface RateLimitMetrics {
  totalHits: number;
  hitsByTier: {
    auth: number;
    public: number;
    standard: number;
  };
  hitsByPath: Record<string, number>;
  lastReset: Date;
}

const rateLimitMetrics: RateLimitMetrics = {
  totalHits: 0,
  hitsByTier: {
    auth: 0,
    public: 0,
    standard: 0,
  },
  hitsByPath: {},
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
  rateLimitMetrics.hitsByTier = { auth: 0, public: 0, standard: 0 };
  rateLimitMetrics.hitsByPath = {};
  rateLimitMetrics.lastReset = new Date();
}

/**
 * Record a rate limit hit
 */
function recordRateLimitHit(tier: 'auth' | 'public' | 'standard', path: string, ip: string): void {
  // Update local metrics
  rateLimitMetrics.totalHits++;
  rateLimitMetrics.hitsByTier[tier]++;
  rateLimitMetrics.hitsByPath[path] = (rateLimitMetrics.hitsByPath[path] || 0) + 1;

  // Record to shared metrics for centralized monitoring
  metrics.recordRateLimitHit(tier, path);

  logger.warn('Rate limit exceeded', {
    component: 'RateLimit',
    tier,
    path,
    ip,
    totalHits: rateLimitMetrics.totalHits,
  });
}

/**
 * Standard rate limit response handler
 * Returns proper 429 response with Retry-After header
 */
function createRateLimitHandler(tier: 'auth' | 'public' | 'standard') {
  return (req: Request, res: Response, _next: NextFunction, options: { windowMs: number }): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    recordRateLimitHit(tier, req.path, ip);

    // Calculate retry-after in seconds
    const retryAfterSeconds = Math.ceil(options.windowMs / 1000);

    res.setHeader('Retry-After', retryAfterSeconds.toString());
    res.status(429).json({
      success: false,
      error: 'Too many requests. Please try again later.',
      retryAfter: retryAfterSeconds,
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
  tier: 'auth' | 'public' | 'standard' = 'standard'
) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: tier === 'standard' ? authenticatedKeyGenerator : keyGenerator,
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
  });
}
