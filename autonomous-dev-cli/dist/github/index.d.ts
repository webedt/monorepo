export { GitHubClient, createGitHubClient, type GitHubClientOptions } from './client.js';
export { createIssueManager, type IssueManager, type Issue, type CreateIssueOptions } from './issues.js';
export { createBranchManager, type BranchManager, type Branch } from './branches.js';
export { createPRManager, type PRManager, type PullRequest, type CreatePROptions, type MergeResult } from './pulls.js';
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