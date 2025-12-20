/**
 * Session Path Helper
 *
 * Utilities for generating and parsing session paths used throughout the WebEDT platform.
 * Session paths uniquely identify a workspace by combining owner, repo, and branch.
 *
 * ## Path Format
 * ```
 * {owner}__{repo}__{branch}
 * ```
 *
 * Uses double underscore (`__`) as separator to avoid conflicts with single underscores
 * in repository or branch names.
 *
 * ## Important Constraints
 * - Session paths must NOT contain `/` characters
 * - Slashes in branch names are converted to hyphens (e.g., `feature/login` → `feature-login`)
 * - The storage service validates paths and rejects any containing slashes
 *
 * ## Example Usage
 * ```typescript
 * import { generateSessionPath, parseSessionPath, parseRepoUrl } from '@webedt/shared';
 *
 * // Generate a session path
 * const path = generateSessionPath('webedt', 'monorepo', 'feature/new-ui');
 * // Result: 'webedt__monorepo__feature-new-ui'
 *
 * // Parse a session path back to components
 * const { owner, repo, branch } = parseSessionPath('webedt__monorepo__main');
 * // Result: { owner: 'webedt', repo: 'monorepo', branch: 'main' }
 *
 * // Parse owner/repo from a GitHub URL
 * const { owner, repo } = parseRepoUrl('https://github.com/webedt/monorepo');
 * // Result: { owner: 'webedt', repo: 'monorepo' }
 * ```
 *
 * @module sessionPathHelper
 */

// Separator used between components (double underscore to avoid conflicts)
const SESSION_PATH_SEPARATOR = '__';

/**
 * Normalize a repository name by removing the `.git` suffix if present.
 *
 * This ensures consistent storage and comparison of repository names,
 * regardless of whether the URL included `.git`.
 *
 * @param repoName - The repository name, potentially with `.git` suffix
 * @returns The normalized repository name without `.git`
 *
 * @example
 * ```typescript
 * normalizeRepoName('monorepo.git');  // 'monorepo'
 * normalizeRepoName('monorepo');      // 'monorepo'
 * ```
 */
export function normalizeRepoName(repoName: string): string {
  return repoName.replace(/\.git$/, '');
}

/**
 * Normalize a GitHub repository URL by removing the `.git` suffix if present.
 *
 * This ensures consistent storage and comparison of repository URLs,
 * regardless of whether the URL included `.git`.
 *
 * @param repoUrl - The repository URL, potentially with `.git` suffix
 * @returns The normalized repository URL without `.git`
 *
 * @example
 * ```typescript
 * normalizeRepoUrl('https://github.com/webedt/monorepo.git');
 * // 'https://github.com/webedt/monorepo'
 *
 * normalizeRepoUrl('https://github.com/webedt/monorepo');
 * // 'https://github.com/webedt/monorepo'
 * ```
 */
export function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.replace(/\.git$/, '');
}

/**
 * Parse a GitHub repository URL to extract owner and repository name.
 *
 * Supports multiple URL formats:
 * - HTTPS: `https://github.com/owner/repo`
 * - HTTPS with .git: `https://github.com/owner/repo.git`
 * - SSH: `git@github.com:owner/repo.git`
 *
 * @param repoUrl - The GitHub repository URL in any supported format
 * @returns Object containing `owner` and `repo` strings
 * @throws Error if the URL format is not recognized
 *
 * @example
 * ```typescript
 * // HTTPS URL
 * parseRepoUrl('https://github.com/webedt/monorepo');
 * // { owner: 'webedt', repo: 'monorepo' }
 *
 * // HTTPS with .git suffix
 * parseRepoUrl('https://github.com/webedt/monorepo.git');
 * // { owner: 'webedt', repo: 'monorepo' }
 *
 * // SSH URL
 * parseRepoUrl('git@github.com:webedt/monorepo.git');
 * // { owner: 'webedt', repo: 'monorepo' }
 * ```
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  // Remove .git suffix if present
  const cleanUrl = repoUrl.replace(/\.git$/, '');

  // Handle SSH format: git@github.com:owner/repo
  if (cleanUrl.includes('@')) {
    const match = cleanUrl.match(/@[\w.-]+:([\w-]+)\/([\w.-]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
  }

  // Handle HTTPS format: https://github.com/owner/repo
  const match = cleanUrl.match(/github\.com\/([\w-]+)\/([\w.-]+)/);
  if (match) {
    return { owner: match[1], repo: match[2] };
  }

  throw new Error(`Invalid GitHub repository URL: ${repoUrl}`);
}

/**
 * Sanitize a component for use in session path.
 *
 * Replaces problematic characters with dashes:
 * - `/` → `-` (slashes not allowed in paths)
 * - `__` → `-` (reserved as separator)
 * - Special characters → `-`
 *
 * @internal
 */
function sanitizeComponent(component: string): string {
  return component
    .replace(/\//g, '-')  // Replace slashes with dashes
    .replace(/__/g, '-')  // Replace double underscores (our separator) with dashes
    .replace(/[^a-zA-Z0-9._-]/g, '-'); // Replace other special chars with dashes
}

/**
 * Generate a session path from owner, repo, and branch.
 *
 * Creates a unique identifier for a workspace in the format:
 * `{owner}__{repo}__{branch}`
 *
 * All components are sanitized:
 * - Slashes become hyphens (`feature/login` → `feature-login`)
 * - Double underscores become hyphens (reserved as separator)
 * - Special characters become hyphens
 *
 * @param owner - The repository owner (GitHub username or org)
 * @param repo - The repository name
 * @param branch - The branch name (slashes will be converted to hyphens)
 * @returns The generated session path
 *
 * @example
 * ```typescript
 * generateSessionPath('webedt', 'monorepo', 'main');
 * // 'webedt__monorepo__main'
 *
 * generateSessionPath('webedt', 'monorepo', 'feature/new-ui');
 * // 'webedt__monorepo__feature-new-ui'
 *
 * generateSessionPath('webedt', 'monorepo', 'claude/fix-bug-123');
 * // 'webedt__monorepo__claude-fix-bug-123'
 * ```
 */
export function generateSessionPath(owner: string, repo: string, branch: string): string {
  const safeOwner = sanitizeComponent(owner);
  const safeRepo = sanitizeComponent(repo);
  const safeBranch = sanitizeComponent(branch);

  return `${safeOwner}${SESSION_PATH_SEPARATOR}${safeRepo}${SESSION_PATH_SEPARATOR}${safeBranch}`;
}

/**
 * Parse a session path back into its components.
 *
 * Splits a session path on the `__` separator to extract owner, repo, and branch.
 *
 * **Note:** The branch name returned may differ from the original if it contained
 * slashes, since those are converted to hyphens during path generation.
 *
 * @param sessionPath - The session path to parse (format: `owner__repo__branch`)
 * @returns Object containing `owner`, `repo`, and `branch` strings
 * @throws Error if the path doesn't contain exactly 3 components
 *
 * @example
 * ```typescript
 * parseSessionPath('webedt__monorepo__main');
 * // { owner: 'webedt', repo: 'monorepo', branch: 'main' }
 *
 * parseSessionPath('webedt__monorepo__feature-new-ui');
 * // { owner: 'webedt', repo: 'monorepo', branch: 'feature-new-ui' }
 * ```
 */
export function parseSessionPath(sessionPath: string): { owner: string; repo: string; branch: string } {
  const parts = sessionPath.split(SESSION_PATH_SEPARATOR);

  if (parts.length !== 3) {
    throw new Error(`Invalid session path format: ${sessionPath}. Expected: owner__repo__branch`);
  }

  return {
    owner: parts[0],
    repo: parts[1],
    branch: parts[2]
  };
}

/**
 * Convert session path to a filesystem-safe directory name.
 *
 * Since session paths already avoid slashes and special characters,
 * this is effectively a passthrough. Kept for API compatibility.
 *
 * @param sessionPath - The session path to convert
 * @returns The same path (already filesystem-safe)
 *
 * @example
 * ```typescript
 * sessionPathToDir('webedt__monorepo__main');
 * // 'webedt__monorepo__main'
 * ```
 */
export function sessionPathToDir(sessionPath: string): string {
  // Session path is already filesystem-safe (no slashes)
  return sessionPath;
}

/**
 * Validate that a session path is properly formatted.
 *
 * Checks that:
 * - Path is not empty
 * - Path does not contain `/` characters
 *
 * @param sessionPath - The session path to validate
 * @throws Error if the path contains slashes or is empty
 *
 * @example
 * ```typescript
 * // Valid paths pass silently
 * validateSessionPath('webedt__monorepo__main');  // OK
 *
 * // Invalid paths throw
 * validateSessionPath('webedt/monorepo/main');
 * // Error: Session path must not contain "/" characters
 *
 * validateSessionPath('');
 * // Error: Session path is required and cannot be empty
 * ```
 */
export function validateSessionPath(sessionPath: string): void {
  if (sessionPath.includes('/')) {
    throw new Error(`Session path must not contain "/" characters: ${sessionPath}`);
  }
  if (!sessionPath || sessionPath.trim() === '') {
    throw new Error('Session path is required and cannot be empty');
  }
}
