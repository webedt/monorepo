/**
 * Request/Response types for GitHub Worker API
 */

// ============================================================================
// Clone Repository
// ============================================================================

export interface CloneRepositoryRequest {
  sessionId: string;
  repoUrl: string;
  branch?: string;
  directory?: string;
  accessToken: string;
}

export interface CloneRepositoryResult {
  clonedPath: string;
  branch: string;
  wasCloned: boolean;
}

// ============================================================================
// Create Branch
// ============================================================================

export interface CreateBranchRequest {
  sessionId: string;
  userRequest: string;
  baseBranch: string;
  repoUrl: string;
  claudeCredentials: string;
  githubAccessToken: string;
}

export interface CreateBranchResult {
  branchName: string;
  sessionTitle: string;
  sessionPath: string;
}

// ============================================================================
// Commit and Push
// ============================================================================

export interface CommitAndPushRequest {
  sessionId: string;
  claudeCredentials: string;
  githubAccessToken: string;
  userId?: string;
}

export interface CommitAndPushResult {
  commitHash: string;
  commitMessage: string;
  branch: string;
  pushed: boolean;
}

// ============================================================================
// SSE Events
// ============================================================================

export type SSEEventType = 'progress' | 'completed' | 'error';

export interface ProgressEvent {
  type: 'progress';
  stage: string;
  message: string;
  timestamp: string;
}

export interface CompletedEvent<T = any> {
  type: 'completed';
  data: T;
  timestamp: string;
}

export interface ErrorEvent {
  type: 'error';
  error: string;
  code: string;
  timestamp: string;
}

export type SSEEvent = ProgressEvent | CompletedEvent | ErrorEvent;

// ============================================================================
// Session Metadata
// ============================================================================

export interface SessionMetadata {
  sessionId: string;
  sessionPath?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  sessionTitle?: string;
  createdAt: string;
  lastModified: string;
  github?: {
    repoUrl: string;
    baseBranch: string;
    clonedPath: string;
  };
}

// ============================================================================
// Helper types
// ============================================================================

export interface ParsedRepoInfo {
  owner: string;
  repo: string;
}

/**
 * Parse owner and repo from a GitHub URL
 */
export function parseRepoUrl(repoUrl: string): ParsedRepoInfo {
  // Handle formats:
  // https://github.com/owner/repo
  // https://github.com/owner/repo.git
  // git@github.com:owner/repo.git

  let match = repoUrl.match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(\.git)?$/);
  if (!match) {
    throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  }

  return {
    owner: match[1],
    repo: match[2]
  };
}

/**
 * Generate session path from owner, repo, and branch
 * Format: owner__repo__branch (with slashes in branch replaced with dashes)
 */
export function generateSessionPath(owner: string, repo: string, branch: string): string {
  const sanitizedBranch = branch.replace(/\//g, '-');
  return `${owner}__${repo}__${sanitizedBranch}`;
}
