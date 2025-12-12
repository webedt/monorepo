import { GitHubClient } from './client.js';
export interface PullRequest {
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    head: {
        ref: string;
        sha: string;
    };
    base: {
        ref: string;
        sha: string;
    };
    htmlUrl: string;
    mergeable: boolean | null;
    merged: boolean;
    draft: boolean;
}
export interface CreatePROptions {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
}
export interface MergeResult {
    merged: boolean;
    sha: string | null;
    message: string;
}
export interface PRManager {
    listOpenPRs(): Promise<PullRequest[]>;
    getPR(number: number): Promise<PullRequest | null>;
    findPRForBranch(branchName: string, base?: string): Promise<PullRequest | null>;
    createPR(options: CreatePROptions): Promise<PullRequest>;
    mergePR(number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<MergeResult>;
    closePR(number: number): Promise<void>;
    updatePRFromBase(number: number): Promise<boolean>;
    waitForMergeable(number: number, maxAttempts?: number): Promise<boolean>;
    getChecksStatus(ref: string): Promise<{
        state: string;
        statuses: Array<{
            context: string;
            state: string;
        }>;
    }>;
}
export declare function createPRManager(client: GitHubClient): PRManager;
//# sourceMappingURL=pulls.d.ts.map