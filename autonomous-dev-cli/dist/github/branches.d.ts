import { GitHubClient } from './client.js';
export interface Branch {
    name: string;
    sha: string;
    protected: boolean;
}
/**
 * Detailed branch protection configuration
 */
export interface BranchProtectionRules {
    /** Whether the branch has protection rules */
    enabled: boolean;
    /** Require pull request reviews before merging */
    requirePullRequestReviews: boolean;
    /** Number of required approving reviews */
    requiredApprovingReviewCount: number;
    /** Dismiss stale pull request approvals on new commits */
    dismissStaleReviews: boolean;
    /** Require review from code owners */
    requireCodeOwnerReviews: boolean;
    /** Require status checks to pass before merging */
    requireStatusChecks: boolean;
    /** Require branches to be up to date before merging */
    requireUpToDateBranch: boolean;
    /** List of required status check contexts */
    requiredStatusCheckContexts: string[];
    /** Require signed commits */
    requireSignedCommits: boolean;
    /** Require linear history (no merge commits) */
    requireLinearHistory: boolean;
    /** Allow force pushes */
    allowForcePushes: boolean;
    /** Allow deletions */
    allowDeletions: boolean;
    /** Block force pushes from everyone */
    blockCreations: boolean;
    /** Enforce all configured restrictions for administrators */
    enforceAdmins: boolean;
    /** Lock the branch (read-only) */
    lockBranch: boolean;
}
/**
 * Result of branch protection compliance check
 */
export interface BranchProtectionCompliance {
    /** Whether all protection requirements are met */
    compliant: boolean;
    /** List of compliance violations */
    violations: string[];
    /** List of warnings (non-blocking issues) */
    warnings: string[];
    /** The branch protection rules that were checked */
    rules: BranchProtectionRules;
}
/**
 * Options for checking merge readiness
 */
export interface MergeReadinessOptions {
    /** PR number to check */
    prNumber?: number;
    /** Head SHA to check status for */
    headSha?: string;
    /** Check if branch is up to date with base */
    checkUpToDate?: boolean;
}
/**
 * Result of merge readiness check
 */
export interface MergeReadiness {
    /** Whether the branch can be merged */
    ready: boolean;
    /** Reasons why the branch cannot be merged */
    blockers: string[];
    /** Warnings that don't block merge */
    warnings: string[];
    /** Current status check results */
    statusChecks: {
        context: string;
        state: 'success' | 'pending' | 'failure' | 'error';
        description?: string;
    }[];
}
export interface BranchManager {
    listBranches(): Promise<Branch[]>;
    getBranch(name: string): Promise<Branch | null>;
    /** Get multiple branches in a batch (reduces API calls) */
    getBranchesBatch(names: string[]): Promise<Map<string, Branch | null>>;
    createBranch(name: string, baseBranch: string): Promise<Branch>;
    deleteBranch(name: string): Promise<void>;
    branchExists(name: string): Promise<boolean>;
    /** Get detailed branch protection rules (cached) */
    getBranchProtectionRules(branch: string): Promise<BranchProtectionRules>;
    /** Check if a branch is protected */
    isBranchProtected(branch: string): Promise<boolean>;
    /** Check compliance with branch protection rules before attempting merge */
    checkProtectionCompliance(branch: string, options?: MergeReadinessOptions): Promise<BranchProtectionCompliance>;
    /** Check if a branch is ready to be merged (all checks pass, up to date, etc.) */
    checkMergeReadiness(headBranch: string, baseBranch: string, options?: MergeReadinessOptions): Promise<MergeReadiness>;
    /** Get the default branch for the repository (cached) */
    getDefaultBranch(): Promise<string>;
    /** Compare two branches and get the diff stats */
    compareBranches(base: string, head: string): Promise<{
        ahead: number;
        behind: number;
        files: string[];
        commits: number;
    }>;
    /** Invalidate branch cache */
    invalidateCache(): void;
    /** Invalidate a specific branch from cache */
    invalidateBranch(name: string): void;
}
export declare function createBranchManager(client: GitHubClient): BranchManager;
//# sourceMappingURL=branches.d.ts.map