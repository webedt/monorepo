export {
  GitHubClient,
  createGitHubClient,
  type GitHubClientOptions,
  type CircuitBreakerConfig,
  type CircuitState,
  type ServiceHealth,
  type RateLimitConfig,
  type RateLimitState,
} from './client.js';
export { createIssueManager, type IssueManager, type Issue, type CreateIssueOptions } from './issues.js';
export {
  createBranchManager,
  type BranchManager,
  type Branch,
  type BranchProtectionRules,
  type BranchProtectionCompliance,
  type MergeReadinessOptions,
  type MergeReadiness,
} from './branches.js';
export {
  createPRManager,
  type PRManager,
  type PullRequest,
  type CreatePROptions,
  type EnhancedPROptions,
  type MergeResult,
  type TaskCategory,
  type PriorityLevel,
  type CodeOwnerEntry,
  type BranchProtectionStatus,
  type PRDescriptionOptions,
} from './pulls.js';
export {
  createChecksManager,
  type ChecksManager,
  type StatusCheck,
  type CombinedStatus,
  type CheckRun,
  type CheckSuite,
  type ChecksWaitResult,
  type WaitForChecksOptions,
  type CreateStatusOptions,
} from './checks.js';
export {
  createCodeReviewerManager,
  type CodeReviewerManager,
  type PRFileChange,
  type PRDiff,
  type ReviewComment,
  type ReviewResult,
  type CodeReviewFinding,
  type CodeReviewResult,
  type CodeReviewOptions,
} from './codeReviewer.js';
export {
  GitHubManager,
  createGitHubManager,
  OperationPriority,
  type GitHubManagerConfig,
  type RequestStats,
  type ManagerHealth,
} from './manager.js';

import { GitHubClient, createGitHubClient, type GitHubClientOptions } from './client.js';
import { createIssueManager, type IssueManager } from './issues.js';
import { createBranchManager, type BranchManager } from './branches.js';
import { createPRManager, type PRManager } from './pulls.js';
import { createChecksManager, type ChecksManager } from './checks.js';
import { createCodeReviewerManager, type CodeReviewerManager } from './codeReviewer.js';

export interface GitHub {
  client: GitHubClient;
  issues: IssueManager;
  branches: BranchManager;
  pulls: PRManager;
  checks: ChecksManager;
  codeReviewer: CodeReviewerManager;
}

export function createGitHub(options: GitHubClientOptions): GitHub {
  const client = createGitHubClient(options);

  return {
    client,
    issues: createIssueManager(client),
    branches: createBranchManager(client),
    pulls: createPRManager(client),
    checks: createChecksManager(client),
    codeReviewer: createCodeReviewerManager(client),
  };
}
