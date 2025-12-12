import { Octokit } from '@octokit/rest';
export interface GitHubClientOptions {
    token: string;
    owner: string;
    repo: string;
}
export declare class GitHubClient {
    private octokit;
    readonly owner: string;
    readonly repo: string;
    constructor(options: GitHubClientOptions);
    get client(): Octokit;
    verifyAuth(): Promise<{
        login: string;
        name: string;
    }>;
    getRepo(): Promise<{
        defaultBranch: string;
        fullName: string;
        private: boolean;
    }>;
}
export declare function createGitHubClient(options: GitHubClientOptions): GitHubClient;
//# sourceMappingURL=client.d.ts.map