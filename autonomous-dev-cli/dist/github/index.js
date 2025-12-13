export { GitHubClient, createGitHubClient, } from './client.js';
export { createIssueManager } from './issues.js';
export { createBranchManager, } from './branches.js';
export { createPRManager, } from './pulls.js';
import { createGitHubClient } from './client.js';
import { createIssueManager } from './issues.js';
import { createBranchManager } from './branches.js';
import { createPRManager } from './pulls.js';
export function createGitHub(options) {
    const client = createGitHubClient(options);
    return {
        client,
        issues: createIssueManager(client),
        branches: createBranchManager(client),
        pulls: createPRManager(client),
    };
}
//# sourceMappingURL=index.js.map