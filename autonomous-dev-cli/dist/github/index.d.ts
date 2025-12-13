export { GitHubClient, createGitHubClient, type GitHubClientOptions, type CircuitBreakerConfig, type CircuitState, type ServiceHealth, type RateLimitConfig, type RateLimitState, } from './client.js';
export { createIssueManager, type IssueManager, type Issue, type CreateIssueOptions } from './issues.js';
export { createBranchManager, type BranchManager, type Branch, type BranchProtectionRules, type BranchProtectionCompliance, type MergeReadinessOptions, type MergeReadiness, } from './branches.js';
export { createPRManager, type PRManager, type PullRequest, type CreatePROptions, type EnhancedPROptions, type MergeResult, type TaskCategory, type PriorityLevel, type CodeOwnerEntry, type BranchProtectionStatus, type PRDescriptionOptions, } from './pulls.js';
import { GitHubClient, type GitHubClientOptions } from './client.js';
import { type IssueManager } from './issues.js';
import { type BranchManager } from './branches.js';
import { type PRManager } from './pulls.js';
export interface GitHub {
    client: GitHubClient;
    issues: IssueManager;
    branches: BranchManager;
    pulls: PRManager;
}
export declare function createGitHub(options: GitHubClientOptions): GitHub;
//# sourceMappingURL=index.d.ts.map