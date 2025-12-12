import { type PRManager, type PullRequest } from '../github/pulls.js';
import { type BranchManager } from '../github/branches.js';
export interface ConflictResolverOptions {
    prManager: PRManager;
    branchManager: BranchManager;
    maxRetries: number;
    strategy: 'rebase' | 'merge' | 'manual';
    mergeMethod: 'merge' | 'squash' | 'rebase';
    owner: string;
    repo: string;
    baseBranch: string;
}
export interface MergeAttemptResult {
    success: boolean;
    pr?: PullRequest;
    merged: boolean;
    sha?: string;
    error?: string;
    attempts: number;
}
export declare class ConflictResolver {
    private options;
    private log;
    constructor(options: ConflictResolverOptions);
    attemptMerge(branchName: string, prNumber?: number): Promise<MergeAttemptResult>;
    mergeSequentially(branches: Array<{
        branchName: string;
        prNumber?: number;
    }>): Promise<Map<string, MergeAttemptResult>>;
}
export declare function createConflictResolver(options: ConflictResolverOptions): ConflictResolver;
//# sourceMappingURL=resolver.d.ts.map