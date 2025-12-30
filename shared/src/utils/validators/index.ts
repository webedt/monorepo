/**
 * Shared validation utilities for WebEDT
 * Centralized validators to ensure consistent validation across routes
 */

import { SNIPPET_LANGUAGES, SNIPPET_CATEGORIES } from '../../db/index.js';
import type { SnippetLanguage, SnippetCategory } from '../../db/index.js';

// Re-export path validation utilities
export * from './pathValidation.js';

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
