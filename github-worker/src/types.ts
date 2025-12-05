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
// Init Session (Clone + Create Branch combined)
// ============================================================================

export interface InitSessionRequest {
  sessionId: string;
  repoUrl: string;
  branch?: string;         // Base branch to clone
  directory?: string;      // Custom directory name
  userRequest: string;     // User's message for LLM naming
  claudeCredentials: string;
  githubAccessToken: string;
}

export interface InitSessionResult {
  // From clone
  clonedPath: string;
  branch: string;          // Base branch that was cloned
  wasCloned: boolean;
  // From branch creation
  branchName: string;      // New branch name
  sessionTitle: string;
  sessionPath: string;
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
// Pull Request Operations
// ============================================================================

export interface CreatePullRequestRequest {
  owner: string;
  repo: string;
  title?: string;
  head: string;
  base: string;
  body?: string;
  githubAccessToken: string;
}

export interface CreatePullRequestResult {
  number: number;
  title: string;
  state: string;
  htmlUrl: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
    sha: string;
  };
  mergeable: boolean | null;
  merged: boolean;
}

export interface MergePullRequestRequest {
  owner: string;
  repo: string;
  pullNumber: number;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitTitle?: string;
  commitMessage?: string;
  githubAccessToken: string;
}

export interface MergePullRequestResult {
  merged: boolean;
  sha: string;
  message: string;
}

export interface AutoPullRequestRequest {
  owner: string;
  repo: string;
  branch: string;
  base: string;
  title?: string;
  body?: string;
  githubAccessToken: string;
}

export type AutoPRStep =
  | 'started'
  | 'checking_pr'
  | 'creating_pr'
  | 'pr_created'
  | 'merging_base'
  | 'base_merged'
  | 'waiting_mergeable'
  | 'merging_pr'
  | 'pr_merged'
  | 'deleting_branch'
  | 'completed';

export interface AutoPullRequestResult {
  step: AutoPRStep;
  progress?: string;
  pr?: {
    number: number;
    htmlUrl: string;
  };
  mergeBase?: {
    sha: string | null;
    message: string;
  };
  mergePr?: {
    merged: boolean;
    sha: string;
  };
}

// ============================================================================
// SSE Events
// ============================================================================

export type SSEEventType = 'progress' | 'completed' | 'error';
export type EventSource = 'ai-coding-worker' | 'github-worker' | 'storage-worker' | 'claude-agent-sdk' | 'codex-sdk';

export interface ProgressEvent {
  type: 'progress';
  stage: string;
  message: string;
  source: EventSource;
  timestamp: string;
}

export interface CompletedEvent<T = any> {
  type: 'completed';
  data: T;
  source: EventSource;
  timestamp: string;
}

export interface ErrorEvent {
  type: 'error';
  error: string;
  code: string;
  source: EventSource;
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
