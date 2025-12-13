export {
  GitHubClient,
  createGitHubClient,
  type GitHubClientOptions,
  type CircuitBreakerConfig,
  type CircuitState,
  type ServiceHealth,
} from './client.js';
export { createIssueManager, type IssueManager, type Issue, type CreateIssueOptions } from './issues.js';
export { createBranchManager, type BranchManager, type Branch } from './branches.js';
export { createPRManager, type PRManager, type PullRequest, type CreatePROptions, type MergeResult } from './pulls.js';

import { GitHubClient, createGitHubClient, type GitHubClientOptions } from './client.js';
import { createIssueManager, type IssueManager } from './issues.js';
import { createBranchManager, type BranchManager } from './branches.js';
import { createPRManager, type PRManager } from './pulls.js';

export interface GitHub {
  client: GitHubClient;
  issues: IssueManager;
  branches: BranchManager;
  pulls: PRManager;
}

export function createGitHub(options: GitHubClientOptions): GitHub {
  const client = createGitHubClient(options);

  return {
    client,
    issues: createIssueManager(client),
    branches: createBranchManager(client),
    pulls: createPRManager(client),
  };
}
