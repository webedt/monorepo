/**
 * CSRF Protection Middleware
 *
 * Implements the double-submit cookie pattern for CSRF protection:
 * 1. Server generates a secure random token and sets it in a cookie
 * 2. Frontend reads the cookie and sends the token in a header (X-CSRF-Token)
 * 3. Server validates that the header matches the cookie
 *
 * This is secure because:
 * - Attackers from other origins can't read cookies from our domain (same-origin policy)
 * - The token must be sent both as a cookie AND as a header
 * - Cookie SameSite=Lax provides additional protection
 */

import { Request, Response, NextFunction } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
import { logger } from '@webedt/shared';

// Cookie options interface (subset of cookie package's CookieSerializeOptions)
interface CookieSerializeOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'strict' | 'lax' | 'none';
  path?: string;
  maxAge?: number;
}

// CSRF token configuration
const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_TOKEN_LENGTH = 32; // 256 bits of entropy
const CSRF_TOKEN_EXPIRY_HOURS = 24;

// Methods that require CSRF protection (state-changing operations)
const PROTECTED_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// Paths to exempt from CSRF protection
// These are either:
// - SSE streaming endpoints (use EventSource which doesn't support custom headers)
// - Webhook callbacks from external services
// - Health check endpoints
// - Auth endpoints for initial login/register (no session to protect, rate-limited)
const EXEMPT_PATH_PATTERNS: RegExp[] = [
  // SSE streaming endpoints
  /^\/api\/execute-remote$/,
  /^\/api\/resume\/.+$/,
  /^\/api\/sessions\/.+\/events\/stream$/,
  /^\/api\/orchestrator\/.+\/stream$/,
  /^\/api\/live-chat\/.+\/execute$/,
  /^\/api\/workspace\/events\/.+\/stream$/,
  /^\/api\/workspace\/presence\/.+\/stream$/,

  // Auth endpoints - exempt because:
  // 1. No authenticated session exists yet to protect
  // 2. These have strict rate limiting (5 req/min)
  // 3. Double-submit cookie pattern doesn't add value for unauthenticated requests
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/register$/,

  // Webhook callbacks (external services calling our API)
  /^\/api\/github\/callback$/,
  /^\/api\/payments\/webhook$/,
  /^\/api\/payments\/webhook\/.+$/,

  // Health check and infrastructure endpoints
  /^\/health/,
  /^\/ready$/,
  /^\/live$/,
  /^\/metrics$/,

  // Public API documentation
  /^\/api\/docs/,
  /^\/api\/openapi\.json$/,
];

/**
 * Generate a cryptographically secure random CSRF token
 */
function generateCsrfToken(): string {
  return randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
}

/**
 * Get cookie options for the CSRF token
 */
function getCsrfCookieOptions(secure: boolean): CookieSerializeOptions {
  return {
    httpOnly: false, // Must be readable by JavaScript to send in header
    secure, // HTTPS only in production
    sameSite: 'lax', // Provides CSRF protection for most cases
    path: '/',
    maxAge: CSRF_TOKEN_EXPIRY_HOURS * 60 * 60, // In seconds
  };
}

/**
 * Serialize a cookie for Set-Cookie header
 */
function serializeCookie(name: string, value: string, options: CookieSerializeOptions): string {
  let cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}`;

  if (options.maxAge !== undefined) {
    cookie += `; Max-Age=${options.maxAge}`;
  }
  if (options.path) {
    cookie += `; Path=${options.path}`;
  }
  if (options.secure) {
    cookie += '; Secure';
  }
  if (options.httpOnly) {
    cookie += '; HttpOnly';
  }
  if (options.sameSite) {
    cookie += `; SameSite=${options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1)}`;
  }

  return cookie;
}

/**
 * Parse cookies from Cookie header
 */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  cookieHeader.split(';').forEach(cookie => {
    const parts = cookie.split('=');
    if (parts.length >= 2) {
      const key = parts[0].trim();
      const value = parts.slice(1).join('=').trim();
      try {
        cookies[key] = decodeURIComponent(value);
      } catch {
        cookies[key] = value;
      }
    }
  });

  return cookies;
}

/**
 * Check if a path is exempt from CSRF protection
 */
function isExemptPath(path: string): boolean {
  return EXEMPT_PATH_PATTERNS.some(pattern => pattern.test(path));
}

/**
 * CSRF token generation middleware
 *
 * This middleware ensures a CSRF token exists in the response.
 * It should be applied to all routes to ensure the token is available.
 */
export function csrfTokenMiddleware(req: Request, res: Response, next: NextFunction): void {
  const cookies = parseCookies(req.headers.cookie);
  const existingToken = cookies[CSRF_COOKIE_NAME];
  const isSecure = process.env.NODE_ENV === 'production';

  // Only generate a new token if one doesn't exist
  if (!existingToken) {
    const token = generateCsrfToken();
    const cookieOptions = getCsrfCookieOptions(isSecure);
    res.appendHeader('Set-Cookie', serializeCookie(CSRF_COOKIE_NAME, token, cookieOptions));
  }

  next();
}

/**
 * CSRF validation middleware
 *
 * Validates that the CSRF token in the header matches the one in the cookie.
 * Only validates on state-changing HTTP methods (POST, PUT, DELETE, PATCH).
 *
 * Exempt paths are skipped (SSE endpoints, webhooks, etc.)
 */
export function csrfValidationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip non-protected methods
  if (!PROTECTED_METHODS.has(req.method)) {
    next();
    return;
  }

  // Skip exempt paths
  if (isExemptPath(req.path)) {
    next();
    return;
  }

  // Get tokens
  const cookies = parseCookies(req.headers.cookie);
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;

  // Validate tokens exist and match
  if (!cookieToken || !headerToken) {
    logger.warn('CSRF token missing', {
      component: 'CSRF',
      path: req.path,
      method: req.method,
      hasCookieToken: !!cookieToken,
      hasHeaderToken: !!headerToken,
    });
    res.status(403).json({
      success: false,
      error: 'CSRF token missing',
      code: 'CSRF_TOKEN_MISSING',
    });
    return;
  }

  // Constant-time comparison to prevent timing attacks using Node.js crypto module
  if (!safeCompare(cookieToken, headerToken)) {
    logger.warn('CSRF token mismatch', {
      component: 'CSRF',
      path: req.path,
      method: req.method,
    });
    res.status(403).json({
      success: false,
      error: 'CSRF token invalid',
      code: 'CSRF_TOKEN_INVALID',
    });
    return;
  }

  next();
}

/**
 * Constant-time string comparison using Node.js crypto.timingSafeEqual
 * Prevents timing attacks by ensuring comparison takes constant time
 */
function safeCompare(a: string, b: string): boolean {
  // timingSafeEqual requires buffers of equal length
  // If lengths differ, we still need to do a comparison to avoid timing leaks
  if (a.length !== b.length) {
    // Compare against itself to maintain constant time, then return false
    const bufA = Buffer.from(a);
    timingSafeEqual(bufA, bufA);
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return timingSafeEqual(bufA, bufB);
}

/**
 * Get CSRF token for the current request
 * Reads from cookie or generates a new one
 */
export function getCsrfToken(req: Request, res: Response): string {
  const cookies = parseCookies(req.headers.cookie);
  let token = cookies[CSRF_COOKIE_NAME];

  if (!token) {
    token = generateCsrfToken();
    const isSecure = process.env.NODE_ENV === 'production';
    const cookieOptions = getCsrfCookieOptions(isSecure);
    res.appendHeader('Set-Cookie', serializeCookie(CSRF_COOKIE_NAME, token, cookieOptions));
  }

  return token;
}

/**
 * Middleware factory that combines token generation and validation
 * Use this for convenience when you want both in one middleware
 */
export function csrfProtection(): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    // First ensure token exists
    csrfTokenMiddleware(req, res, () => {
      // Then validate on protected methods
      csrfValidationMiddleware(req, res, next);
    });
  };
}

// Export constants for use in frontend
export const CSRF_CONSTANTS = {
  COOKIE_NAME: CSRF_COOKIE_NAME,
  HEADER_NAME: CSRF_HEADER_NAME,
};
