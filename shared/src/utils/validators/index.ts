/**
 * Shared validation utilities for WebEDT
 * Centralized validators to ensure consistent validation across routes
 */

import { randomBytes, createHash } from 'crypto';
import { SNIPPET_LANGUAGES, SNIPPET_CATEGORIES } from '../../db/index.js';
import type { SnippetLanguage, SnippetCategory } from '../../db/index.js';

// =============================================================================
// REGEX PATTERNS
// =============================================================================

/** Regex for validating hex colors in #RRGGBB format */
export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

// =============================================================================
// VALID VALUE SETS
// =============================================================================

/** Valid icon values for collections */
export const VALID_ICONS = ['folder', 'star', 'code', 'bookmark', 'archive'] as const;
export type ValidIcon = (typeof VALID_ICONS)[number];

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate hex color format (#RRGGBB)
 * @param value - The value to validate
 * @returns True if the value is a valid hex color string
 */
export function isValidHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX_COLOR_REGEX.test(value);
}

/**
 * Validate collection/folder icon value
 * @param value - The value to validate
 * @returns True if the value is a valid icon string
 */
export function isValidIcon(value: unknown): value is ValidIcon {
  return typeof value === 'string' && VALID_ICONS.includes(value as ValidIcon);
}

/**
 * Validate snippet language
 * @param value - The value to validate
 * @returns True if the value is a valid snippet language
 */
export function isValidLanguage(value: unknown): value is SnippetLanguage {
  return typeof value === 'string' && SNIPPET_LANGUAGES.includes(value as SnippetLanguage);
}

/**
 * Validate snippet category
 * @param value - The value to validate
 * @returns True if the value is a valid snippet category
 */
export function isValidCategory(value: unknown): value is SnippetCategory {
  return typeof value === 'string' && SNIPPET_CATEGORIES.includes(value as SnippetCategory);
}

// =============================================================================
// SHARE TOKEN SECURITY UTILITIES
// =============================================================================

/**
 * Share token configuration constants
 */
export const SHARE_TOKEN_CONFIG = {
  /** Minimum entropy in bytes for cryptographically secure tokens (256 bits) */
  MIN_ENTROPY_BYTES: 32,
  /** Default expiration in days for share tokens */
  DEFAULT_EXPIRATION_DAYS: 7,
  /** Maximum expiration in days */
  MAX_EXPIRATION_DAYS: 365,
  /** Minimum expiration in days */
  MIN_EXPIRATION_DAYS: 1,
  /** Token format: base64url for URL-safe tokens */
  TOKEN_FORMAT: 'base64url' as const,
} as const;

/**
 * Generate a cryptographically secure share token
 * Uses 256 bits of entropy encoded as base64url for URL safety
 *
 * UUID v4 provides ~122 bits of entropy, but this implementation
 * provides 256 bits, making enumeration attacks even more impractical.
 *
 * @returns A 43-character URL-safe base64 encoded token
 */
export function generateSecureShareToken(): string {
  const bytes = randomBytes(SHARE_TOKEN_CONFIG.MIN_ENTROPY_BYTES);
  // Use base64url encoding (URL-safe base64 without padding)
  return bytes.toString('base64url');
}

/**
 * Validate that a share token has sufficient entropy
 * Checks that the token appears to be cryptographically generated
 *
 * @param token - The share token to validate
 * @returns True if the token appears to have sufficient entropy
 */
export function isValidShareToken(token: unknown): token is string {
  if (typeof token !== 'string') {
    return false;
  }

  // Token must be non-empty
  if (token.length === 0) {
    return false;
  }

  // Accept both UUID format (legacy) and base64url format (new)
  // UUID format: 36 chars with hyphens (e.g., 550e8400-e29b-41d4-a716-446655440000)
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(token)) {
    return true;
  }

  // Base64url format: 43 chars for 256-bit tokens
  // Must only contain URL-safe characters: A-Za-z0-9_-
  const base64urlRegex = /^[A-Za-z0-9_-]+$/;
  if (base64urlRegex.test(token) && token.length >= 22) {
    // Minimum 22 chars = 128 bits (acceptable), our tokens are 43 chars = 256 bits
    return true;
  }

  return false;
}

/**
 * Check if a share token has weak entropy patterns
 * Detects common weak patterns like sequential, repeated, or predictable tokens
 *
 * @param token - The share token to check
 * @returns An object indicating if the token is weak and why
 */
export function checkShareTokenEntropy(token: string): { isWeak: boolean; reason?: string } {
  if (!isValidShareToken(token)) {
    return { isWeak: true, reason: 'Invalid token format' };
  }

  // Check for repeated characters (more than 50% same character)
  const charCounts = new Map<string, number>();
  for (const char of token) {
    charCounts.set(char, (charCounts.get(char) || 0) + 1);
  }
  const maxRepeat = Math.max(...charCounts.values());
  if (maxRepeat > token.length * 0.5) {
    return { isWeak: true, reason: 'Token has excessive character repetition' };
  }

  // Check for sequential patterns (e.g., "abcdefgh" or "12345678")
  let sequentialCount = 0;
  for (let i = 1; i < token.length; i++) {
    if (token.charCodeAt(i) === token.charCodeAt(i - 1) + 1) {
      sequentialCount++;
    }
  }
  if (sequentialCount > token.length * 0.4) {
    return { isWeak: true, reason: 'Token has sequential patterns' };
  }

  // Check character diversity (should have reasonable variety)
  const uniqueChars = charCounts.size;
  const minUniqueChars = Math.min(10, Math.floor(token.length * 0.3));
  if (uniqueChars < minUniqueChars) {
    return { isWeak: true, reason: 'Token lacks character diversity' };
  }

  return { isWeak: false };
}

/**
 * Calculate the expiration date for a share token
 *
 * @param expiresInDays - Number of days until expiration (default: 7)
 * @returns The expiration date
 */
export function calculateShareTokenExpiration(expiresInDays?: number): Date {
  const days = expiresInDays ?? SHARE_TOKEN_CONFIG.DEFAULT_EXPIRATION_DAYS;
  const clampedDays = Math.max(
    SHARE_TOKEN_CONFIG.MIN_EXPIRATION_DAYS,
    Math.min(days, SHARE_TOKEN_CONFIG.MAX_EXPIRATION_DAYS)
  );

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + clampedDays);
  return expiresAt;
}

/**
 * Hash an IP address for privacy-preserving logging
 * Uses SHA-256 to anonymize IPs while still allowing pattern detection
 *
 * @param ipAddress - The IP address to hash
 * @param salt - Optional salt for the hash (should be constant per deployment)
 * @returns A truncated hash of the IP address
 */
export function hashIpAddress(ipAddress: string, salt = 'webedt-share-audit'): string {
  const hash = createHash('sha256');
  hash.update(salt + ipAddress);
  // Return first 16 characters of hex hash (still unique enough for pattern detection)
  return hash.digest('hex').substring(0, 16);
}
