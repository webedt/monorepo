/**
 * GitHub Issues Service Types
 */

export interface Issue {
  number: number;
  id: number;
  nodeId: string;
  htmlUrl: string;
  title: string;
  body?: string;
  state: 'open' | 'closed';
  labels: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateIssueOptions {
  title: string;
  body?: string;
  labels?: string[];
  assignees?: string[];
}

export interface CreateIssueResult {
  number: number;
  id: number;
  nodeId: string;
  htmlUrl: string;
  title: string;
  state: 'open' | 'closed';
}

export interface ListIssuesOptions {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  perPage?: number;
}

export interface UpdateIssueOptions {
  state?: 'open' | 'closed';
  labels?: string[];
  title?: string;
  body?: string;
}

export interface IssueComment {
  id: number;
  body: string;
  createdAt: string;
  updatedAt: string;
  user?: {
    login: string;
  };
}

/**
 * Parsed information from auto-task comments on issues
 */
export interface AutoTaskCommentInfo {
  sessionId?: string;
  sessionUrl?: string;
  branchName?: string;
  prNumber?: number;
  type: 'started' | 'rework' | 'complete' | 'failed' | 'review' | 'conflict' | 'unknown';
  createdAt: string;
  /** Count of failure/retry comments on this issue */
  failureCount: number;
  /** Total number of session start attempts */
  attemptCount: number;
}
