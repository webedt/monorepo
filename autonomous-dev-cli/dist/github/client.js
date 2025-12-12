import { Octokit } from '@octokit/rest';
export class GitHubClient {
    octokit;
    owner;
    repo;
    constructor(options) {
        this.octokit = new Octokit({ auth: options.token });
        this.owner = options.owner;
        this.repo = options.repo;
    }
    get client() {
        return this.octokit;
    }
    // Verify authentication works
    async verifyAuth() {
        const { data } = await this.octokit.users.getAuthenticated();
        return { login: data.login, name: data.name || data.login };
    }
    // Get repository info
    async getRepo() {
        const { data } = await this.octokit.repos.get({
            owner: this.owner,
            repo: this.repo,
        });
        return {
            defaultBranch: data.default_branch,
            fullName: data.full_name,
            private: data.private,
        };
    }
}
export function createGitHubClient(options) {
    return new GitHubClient(options);
}
//# sourceMappingURL=client.js.map