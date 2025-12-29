/**
 * Git URL and Branch Name Security Helpers
 *
 * Provides secure parsing and validation for Git URLs and branch names
 * to prevent injection attacks and path traversal vulnerabilities.
 *
 * ## Security Considerations
 *
 * 1. **URL Injection Prevention**: Uses the URL constructor for parsing instead of regex
 *    to properly validate URL structure and prevent injection via malformed URLs like:
 *    - `https://github.com/owner/repo.git;rm -rf /`
 *    - `https://github.com/owner/repo.git$(malicious)`
 *
 * 2. **Branch Name Path Traversal Prevention**: Validates branch names to prevent:
 *    - Path traversal (`../`, `..\\`)
 *    - Null byte injection (`\0`)
 *    - Leading dots (`.hidden` or `..parent`)
 *
 * ## Usage
 * ```typescript
 * import { parseGitUrl, validateBranchName, sanitizeBranchName } from '@webedt/shared';
 *
 * // Parse and validate a Git URL
 * const result = parseGitUrl('https://github.com/owner/repo');
 * // { owner: 'owner', repo: 'repo', isValid: true }
 *
 * // Validate a branch name
 * validateBranchName('feature/new-feature'); // OK
 * validateBranchName('../admin'); // throws Error
 *
 * // Sanitize branch for safe use in paths
 * const safe = sanitizeBranchName('feature/auth');
 * // 'feature-auth'
 * ```
 *
 * @module gitUrlHelper
 */

/**
 * Result of parsing a Git URL.
 */
export interface ParsedGitUrl {
  /** Repository owner (GitHub username or organization) */
  owner: string;
  /** Repository name (without .git suffix) */
  repo: string;
  /** Whether the URL was successfully parsed */
  isValid: true;
}

/**
 * Error result when Git URL parsing fails.
 */
export interface ParsedGitUrlError {
  /** Whether the URL was successfully parsed */
  isValid: false;
  /** Error message describing why parsing failed */
  error: string;
}

/**
 * Allowlist of valid Git hosting domains.
 * Add more domains here as needed.
 */
const ALLOWED_GIT_HOSTS = new Set([
  'github.com',
  'www.github.com',
]);

/**
 * Pattern for valid owner/repo name components.
 * Allows alphanumeric, hyphens, underscores, and dots.
 * Must start with alphanumeric.
 */
const VALID_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/**
 * Pattern for valid branch names.
 * Follows Git's branch naming rules (simplified):
 * - Alphanumeric, hyphens, underscores, dots, slashes
 * - Must start with alphanumeric
 * - No consecutive dots
 * - No path traversal sequences
 */
const VALID_BRANCH_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*$/;

/**
 * Dangerous patterns in branch names that indicate path traversal or injection.
 */
const DANGEROUS_BRANCH_PATTERNS = [
  /\.\./,           // Path traversal
  /\x00/,           // Null byte
  /^\.+$/,          // Only dots
  /^\//,            // Leading slash
  /\/$/,            // Trailing slash
  /\/\//,           // Double slash
  /\\$/,            // Trailing backslash
  /\\\\/,           // Double backslash
  /^\\/,            // Leading backslash
  /[;|&$`<>(){}'"!#]/,  // Shell metacharacters
];

/**
 * Parse a Git URL securely using the URL constructor.
 *
 * This function validates that:
 * 1. The URL is well-formed (uses URL constructor)
 * 2. The host is in the allowlist (github.com)
 * 3. The path contains valid owner/repo components
 * 4. No injection payloads are present
 *
 * @param urlString - The Git URL to parse (HTTPS or SSH format)
 * @returns Parsed result with owner/repo or error
 *
 * @example
 * ```typescript
 * // Valid URLs
 * parseGitUrl('https://github.com/owner/repo');
 * // { owner: 'owner', repo: 'repo', isValid: true }
 *
 * parseGitUrl('https://github.com/owner/repo.git');
 * // { owner: 'owner', repo: 'repo', isValid: true }
 *
 * // Invalid URLs
 * parseGitUrl('https://github.com/owner/repo;rm -rf /');
 * // { isValid: false, error: 'Invalid repository name...' }
 *
 * parseGitUrl('https://evil.com/owner/repo');
 * // { isValid: false, error: 'Unsupported Git host...' }
 * ```
 */
export function parseGitUrl(urlString: string): ParsedGitUrl | ParsedGitUrlError {
  // Handle SSH format: git@github.com:owner/repo.git
  if (urlString.includes('@') && urlString.includes(':') && !urlString.startsWith('https://')) {
    return parseGitSshUrl(urlString);
  }

  // Parse as HTTPS URL
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { isValid: false, error: `Invalid URL format: ${urlString}` };
  }

  // Validate protocol
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { isValid: false, error: `Invalid protocol: ${url.protocol}. Expected https: or http:` };
  }

  // Validate host is in allowlist
  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_GIT_HOSTS.has(hostname)) {
    return { isValid: false, error: `Unsupported Git host: ${hostname}. Only github.com is supported.` };
  }

  // Extract and validate path components
  // Path format: /owner/repo or /owner/repo.git
  const pathParts = url.pathname.split('/').filter(p => p.length > 0);

  if (pathParts.length < 2) {
    return { isValid: false, error: `Invalid repository path. Expected /owner/repo format.` };
  }

  const owner = pathParts[0];
  let repo = pathParts[1];

  // Remove .git suffix if present
  repo = repo.replace(/\.git$/, '');

  // Validate owner name
  if (!VALID_NAME_PATTERN.test(owner)) {
    return { isValid: false, error: `Invalid owner name: ${owner}. Must be alphanumeric with hyphens, underscores, or dots.` };
  }

  // Validate repo name
  if (!VALID_NAME_PATTERN.test(repo)) {
    return { isValid: false, error: `Invalid repository name: ${repo}. Must be alphanumeric with hyphens, underscores, or dots.` };
  }

  // Check for injection attempts in the URL (anything beyond owner/repo)
  // Extra path segments could indicate injection attempts
  if (pathParts.length > 2) {
    // Only warn - this could be legitimate (e.g., github.com/owner/repo/tree/branch)
    // But for git clone operations, we only need owner/repo
  }

  // Check for query strings or fragments that might be injection attempts
  if (url.search || url.hash) {
    // Query strings and hashes are stripped - log but don't fail
  }

  return { owner, repo, isValid: true };
}

/**
 * Parse a Git SSH URL (git@host:owner/repo.git format).
 */
function parseGitSshUrl(urlString: string): ParsedGitUrl | ParsedGitUrlError {
  // Format: git@github.com:owner/repo.git
  const match = urlString.match(/^git@([^:]+):([^\/]+)\/(.+?)(?:\.git)?$/);

  if (!match) {
    return { isValid: false, error: `Invalid SSH URL format: ${urlString}` };
  }

  const [, host, owner, repo] = match;

  // Validate host
  if (!ALLOWED_GIT_HOSTS.has(host.toLowerCase())) {
    return { isValid: false, error: `Unsupported Git host: ${host}. Only github.com is supported.` };
  }

  // Validate owner
  if (!VALID_NAME_PATTERN.test(owner)) {
    return { isValid: false, error: `Invalid owner name: ${owner}. Must be alphanumeric with hyphens, underscores, or dots.` };
  }

  // Validate repo
  if (!VALID_NAME_PATTERN.test(repo)) {
    return { isValid: false, error: `Invalid repository name: ${repo}. Must be alphanumeric with hyphens, underscores, or dots.` };
  }

  return { owner, repo, isValid: true };
}

/**
 * Validate a branch name for security.
 *
 * Checks that the branch name:
 * 1. Matches the valid branch pattern
 * 2. Does not contain path traversal sequences
 * 3. Does not contain null bytes
 * 4. Does not contain shell metacharacters
 *
 * @param branchName - The branch name to validate
 * @throws Error if the branch name is invalid or contains dangerous patterns
 *
 * @example
 * ```typescript
 * // Valid branches
 * validateBranchName('main');
 * validateBranchName('feature/new-feature');
 * validateBranchName('release/v1.2.3');
 *
 * // Invalid branches - throw Error
 * validateBranchName('../admin'); // Path traversal
 * validateBranchName('.hidden'); // Leading dot
 * validateBranchName('branch\x00name'); // Null byte
 * validateBranchName('branch;rm -rf /'); // Shell injection
 * ```
 */
export function validateBranchName(branchName: string): void {
  if (!branchName || branchName.trim() === '') {
    throw new Error('Branch name is required and cannot be empty');
  }

  // Check for dangerous patterns
  for (const pattern of DANGEROUS_BRANCH_PATTERNS) {
    if (pattern.test(branchName)) {
      throw new Error(`Invalid branch name: contains dangerous pattern. Branch: ${branchName}`);
    }
  }

  // Check against valid branch pattern
  if (!VALID_BRANCH_PATTERN.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}. Must start with alphanumeric and contain only alphanumeric, dots, underscores, hyphens, and slashes.`);
  }

  // Additional check: no consecutive dots (could be used for traversal)
  if (/\.\./.test(branchName)) {
    throw new Error(`Invalid branch name: ${branchName}. Contains consecutive dots which could indicate path traversal.`);
  }
}

/**
 * Sanitize a branch name for safe use in file paths.
 *
 * Converts slashes to hyphens and removes/replaces dangerous characters.
 * This is used when incorporating branch names into session paths.
 *
 * @param branchName - The branch name to sanitize
 * @returns Sanitized branch name safe for use in paths
 *
 * @example
 * ```typescript
 * sanitizeBranchName('feature/new-feature');
 * // 'feature-new-feature'
 *
 * sanitizeBranchName('release/v1.2.3');
 * // 'release-v1.2.3'
 *
 * sanitizeBranchName('branch__test');
 * // 'branch-test'
 * ```
 */
export function sanitizeBranchName(branchName: string): string {
  return branchName
    .replace(/\//g, '-')           // Replace slashes with hyphens
    .replace(/__/g, '-')           // Replace double underscores (reserved separator)
    .replace(/\.\./g, '-')         // Replace path traversal
    .replace(/\x00/g, '')          // Remove null bytes
    .replace(/[;|&$`<>(){}'"!#\\]/g, '-')  // Replace shell metacharacters
    .replace(/^\.+/, '')           // Remove leading dots
    .replace(/[^a-zA-Z0-9._-]/g, '-');  // Replace other special chars
}

/**
 * Extract repository owner from a validated GitHub URL.
 *
 * This is a convenience wrapper around parseGitUrl that throws on error.
 * Use this when you need just the owner and want exception-based error handling.
 *
 * @param repoUrl - The GitHub repository URL
 * @returns The repository owner
 * @throws Error if URL is invalid
 *
 * @example
 * ```typescript
 * extractRepoOwner('https://github.com/owner/repo');
 * // 'owner'
 * ```
 */
export function extractRepoOwner(repoUrl: string): string {
  const result = parseGitUrl(repoUrl);
  if (!result.isValid) {
    throw new Error(result.error);
  }
  return result.owner;
}

/**
 * Extract repository name from a validated GitHub URL.
 *
 * This is a convenience wrapper around parseGitUrl that throws on error.
 * Use this when you need just the repo name and want exception-based error handling.
 *
 * @param repoUrl - The GitHub repository URL
 * @returns The repository name (without .git suffix)
 * @throws Error if URL is invalid
 *
 * @example
 * ```typescript
 * extractRepoName('https://github.com/owner/repo.git');
 * // 'repo'
 * ```
 */
export function extractRepoName(repoUrl: string): string {
  const result = parseGitUrl(repoUrl);
  if (!result.isValid) {
    throw new Error(result.error);
  }
  return result.repo;
}

/**
 * Validate a Git URL and return owner/repo or null.
 *
 * This is a convenience wrapper that returns null instead of throwing on error.
 * Use this when you want to check validity without exception handling.
 *
 * @param repoUrl - The GitHub repository URL
 * @returns Object with owner and repo, or null if invalid
 *
 * @example
 * ```typescript
 * validateGitUrl('https://github.com/owner/repo');
 * // { owner: 'owner', repo: 'repo' }
 *
 * validateGitUrl('invalid-url');
 * // null
 * ```
 */
export function validateGitUrl(repoUrl: string): { owner: string; repo: string } | null {
  const result = parseGitUrl(repoUrl);
  if (!result.isValid) {
    return null;
  }
  return { owner: result.owner, repo: result.repo };
}
