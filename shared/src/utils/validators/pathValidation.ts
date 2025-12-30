/**
 * Path Validation Utilities
 * Prevents directory traversal attacks in file path parameters
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum allowed path length */
export const MAX_PATH_LENGTH = 1000;

/** Safe character set for file paths: alphanumeric, dot, underscore, hyphen, forward slash */
export const SAFE_PATH_REGEX = /^[a-zA-Z0-9._\-\/]+$/;

/** Pattern to detect directory traversal attempts */
export const TRAVERSAL_PATTERN = /(?:^|\/|\\)\.\.(?:\/|\\|$)/;

/** Pattern to detect current directory references (./ or /./), which could be used in path manipulation */
export const CURRENT_DIR_PATTERN = /(?:^\.\/|\/\.\/|\/\.$)/;

// =============================================================================
// TYPES
// =============================================================================

export interface PathValidationResult {
  valid: boolean;
  error?: string;
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validate a file path against directory traversal attacks
 *
 * Checks for:
 * - Null bytes (can be used to truncate paths)
 * - Directory traversal patterns (../)
 * - Current directory references (./)
 * - Excessive length (>1000 characters)
 * - Invalid characters (only allows [a-zA-Z0-9._\-\/])
 * - Empty paths
 * - Leading slashes (absolute paths)
 *
 * @param path - The file path to validate
 * @returns Validation result with error message if invalid
 *
 * @example
 * ```typescript
 * const result = validatePath('src/components/Button.tsx');
 * // { valid: true }
 *
 * const result2 = validatePath('../../../etc/passwd');
 * // { valid: false, error: 'Path contains directory traversal patterns' }
 *
 * const result3 = validatePath('./config');
 * // { valid: false, error: 'Path contains current directory references' }
 * ```
 */
export function validatePath(path: string): PathValidationResult {
  // Check for empty or undefined path
  if (!path || path.length === 0) {
    return { valid: false, error: 'Path is required' };
  }

  // Check for null bytes (can be used to truncate paths in some systems)
  if (path.includes('\0')) {
    return { valid: false, error: 'Path contains null bytes' };
  }

  // Check for excessive length
  if (path.length > MAX_PATH_LENGTH) {
    return { valid: false, error: `Path exceeds maximum length of ${MAX_PATH_LENGTH} characters` };
  }

  // Check for directory traversal patterns
  // Matches: ../  ..\  /.. at start, middle, or end of path
  if (TRAVERSAL_PATTERN.test(path)) {
    return { valid: false, error: 'Path contains directory traversal patterns' };
  }

  // Check for current directory references (./ or /./)
  // These could be used in path manipulation attacks
  if (CURRENT_DIR_PATTERN.test(path) || path === '.') {
    return { valid: false, error: 'Path contains current directory references' };
  }

  // Check for invalid characters
  // Only allow: alphanumeric, dot, underscore, hyphen, forward slash
  if (!SAFE_PATH_REGEX.test(path)) {
    return { valid: false, error: 'Path contains invalid characters' };
  }

  // Check for leading/trailing slashes (often indicates absolute path or path issues)
  if (path.startsWith('/')) {
    return { valid: false, error: 'Path cannot start with a slash' };
  }

  return { valid: true };
}

/**
 * Validate a path and throw an error if invalid
 *
 * @param path - The file path to validate
 * @throws Error if the path is invalid
 *
 * @example
 * ```typescript
 * assertValidPath('src/index.ts'); // passes
 * assertValidPath('../etc/passwd'); // throws Error
 * ```
 */
export function assertValidPath(path: string): void {
  const result = validatePath(path);
  if (!result.valid) {
    throw new Error(result.error);
  }
}

/**
 * Check if a path is valid (simple boolean check)
 *
 * @param path - The file path to validate
 * @returns True if the path is valid, false otherwise
 *
 * @example
 * ```typescript
 * if (isValidPath(userInput)) {
 *   // safe to use path
 * }
 * ```
 */
export function isValidPath(path: string): boolean {
  return validatePath(path).valid;
}

/**
 * Validate a branch name for path safety (returns result object)
 *
 * Note: For comprehensive branch name validation (including git-specific patterns),
 * use `validateBranchName` from `helpers/gitUrlHelper.ts` which throws on invalid input.
 * This function is for middleware use where we need a result object.
 *
 * Branch names can contain: alphanumeric, dot, underscore, hyphen, forward slash
 *
 * @param branch - The branch name to validate
 * @returns Validation result with error message if invalid
 */
export function validateBranchPath(branch: string): PathValidationResult {
  // Check for empty or undefined
  if (!branch || branch.length === 0) {
    return { valid: false, error: 'Branch name is required' };
  }

  // Check for null bytes
  if (branch.includes('\0')) {
    return { valid: false, error: 'Branch name contains null bytes' };
  }

  // Check for excessive length
  if (branch.length > MAX_PATH_LENGTH) {
    return { valid: false, error: `Branch name exceeds maximum length of ${MAX_PATH_LENGTH} characters` };
  }

  // Check for directory traversal patterns
  if (TRAVERSAL_PATTERN.test(branch)) {
    return { valid: false, error: 'Branch name contains directory traversal patterns' };
  }

  // Check for current directory references
  if (CURRENT_DIR_PATTERN.test(branch) || branch === '.') {
    return { valid: false, error: 'Branch name contains current directory references' };
  }

  // Check for invalid characters
  if (!SAFE_PATH_REGEX.test(branch)) {
    return { valid: false, error: 'Branch name contains invalid characters' };
  }

  // Check for leading slashes (invalid in Git branch names)
  if (branch.startsWith('/')) {
    return { valid: false, error: 'Branch name cannot start with a slash' };
  }

  return { valid: true };
}

/**
 * Check if a branch name is valid for path safety
 *
 * @param branch - The branch name to validate
 * @returns True if the branch name is valid, false otherwise
 */
export function isValidBranchPath(branch: string): boolean {
  return validateBranchPath(branch).valid;
}
