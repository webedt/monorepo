/**
 * Helper utilities for generating and parsing session paths
 * Session path format: {owner}__{repo}__{branch} (no slashes allowed)
 *
 * IMPORTANT: Session paths must NOT contain "/" characters.
 * The storage service validates this and will reject paths with slashes.
 */

// Separator used between components (double underscore to avoid conflicts)
const SESSION_PATH_SEPARATOR = '__';

/**
 * Normalize a repository name by removing the .git suffix if present.
 * This ensures consistent storage and comparison of repository names.
 */
export function normalizeRepoName(repoName: string): string {
  return repoName.replace(/\.git$/, '');
}

/**
 * Normalize a GitHub repository URL by removing the .git suffix if present.
 * This ensures consistent storage and comparison of repository URLs.
 */
export function normalizeRepoUrl(repoUrl: string): string {
  return repoUrl.replace(/\.git$/, '');
}

/**
 * Parse GitHub repository URL to extract owner and repository name
 * Supports formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
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
 * Sanitize a component for use in session path
 * Replaces slashes and other problematic characters with dashes
 */
function sanitizeComponent(component: string): string {
  return component
    .replace(/\//g, '-')  // Replace slashes with dashes
    .replace(/__/g, '-')  // Replace double underscores (our separator) with dashes
    .replace(/[^a-zA-Z0-9._-]/g, '-'); // Replace other special chars with dashes
}

/**
 * Generate a session path from owner, repo, and branch
 * Format: {owner}__{repo}__{branch} (no slashes)
 *
 * All components are sanitized to remove slashes and special characters.
 */
export function generateSessionPath(owner: string, repo: string, branch: string): string {
  const safeOwner = sanitizeComponent(owner);
  const safeRepo = sanitizeComponent(repo);
  const safeBranch = sanitizeComponent(branch);

  return `${safeOwner}${SESSION_PATH_SEPARATOR}${safeRepo}${SESSION_PATH_SEPARATOR}${safeBranch}`;
}

/**
 * Parse a session path back into its components
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
 * Convert session path to a filesystem-safe directory name
 * Since session paths no longer contain slashes, this is now a passthrough
 */
export function sessionPathToDir(sessionPath: string): string {
  // Session path is already filesystem-safe (no slashes)
  return sessionPath;
}

/**
 * Validate that a session path does not contain slashes
 * Throws an error if the path is invalid
 */
export function validateSessionPath(sessionPath: string): void {
  if (sessionPath.includes('/')) {
    throw new Error(`Session path must not contain "/" characters: ${sessionPath}`);
  }
  if (!sessionPath || sessionPath.trim() === '') {
    throw new Error('Session path is required and cannot be empty');
  }
}
