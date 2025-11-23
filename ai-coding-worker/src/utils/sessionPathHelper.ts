/**
 * Helper utilities for generating and parsing session paths
 * Session path format: {owner}/{repo}/{branch}
 */

/**
 * Parse GitHub repository URL to extract owner and repository name
 * Supports formats:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - git@github.com:owner/repo.git
 */
export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  // Remove .git suffix if present
  let cleanUrl = repoUrl.replace(/\.git$/, '');

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
 * Generate a session path from owner, repo, and branch
 * Format: {owner}/{repo}/{branch}
 * URL-encodes each component to handle special characters
 */
export function generateSessionPath(owner: string, repo: string, branch: string): string {
  // URL-encode each component (but preserve forward slashes in branch names)
  const encodedOwner = encodeURIComponent(owner);
  const encodedRepo = encodeURIComponent(repo);
  // For branch names, replace slashes with dashes to avoid path issues
  const safeBranch = branch.replace(/\//g, '-');
  const encodedBranch = encodeURIComponent(safeBranch);

  return `${encodedOwner}/${encodedRepo}/${encodedBranch}`;
}

/**
 * Parse a session path back into its components
 */
export function parseSessionPath(sessionPath: string): { owner: string; repo: string; branch: string } {
  const parts = sessionPath.split('/');

  if (parts.length !== 3) {
    throw new Error(`Invalid session path format: ${sessionPath}. Expected: owner/repo/branch`);
  }

  return {
    owner: decodeURIComponent(parts[0]),
    repo: decodeURIComponent(parts[1]),
    branch: decodeURIComponent(parts[2])
  };
}

/**
 * Convert session path to a filesystem-safe directory name
 * Replaces slashes with dashes and URL-decodes
 */
export function sessionPathToDir(sessionPath: string): string {
  // Replace slashes with dashes and decode
  return sessionPath.replace(/\//g, '-');
}
