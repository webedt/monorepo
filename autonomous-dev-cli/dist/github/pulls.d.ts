import { GitHubClient, type ServiceHealth } from './client.js';
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
    labels: string[];
    reviewers: string[];
}
/**
 * Task category for PR labeling
 */
export type TaskCategory = 'feature' | 'bugfix' | 'refactor' | 'docs' | 'test' | 'chore' | 'security' | 'performance';
/**
 * Priority level for PR labeling
 */
export type PriorityLevel = 'critical' | 'high' | 'medium' | 'low';
/**
 * CODEOWNERS entry representing a path pattern and its owners
 */
export interface CodeOwnerEntry {
    pattern: string;
    owners: string[];
}
/**
 * Branch protection rule status
 */
export interface BranchProtectionStatus {
    isProtected: boolean;
    requiresReviews: boolean;
    requiredReviewCount: number;
    requiresStatusChecks: boolean;
    requiredStatusChecks: string[];
    requiresSignedCommits: boolean;
    allowsForcePush: boolean;
    allowsDeletion: boolean;
    errors: string[];
}
/**
 * PR description generation options
 */
export interface PRDescriptionOptions {
    issueNumber?: number;
    issueTitle?: string;
    issueBody?: string;
    changedFiles?: string[];
    category?: TaskCategory;
    summary?: string;
}
export interface CreatePROptions {
    title: string;
    body: string;
    head: string;
    base: string;
    draft?: boolean;
    labels?: string[];
    reviewers?: string[];
    category?: TaskCategory;
    priority?: PriorityLevel;
    issueNumber?: number;
}
/**
 * Enhanced PR options for autonomous workflows
 */
export interface EnhancedPROptions extends CreatePROptions {
    /** Automatically assign reviewers from CODEOWNERS */
    autoAssignReviewers?: boolean;
    /** Changed file paths for reviewer matching */
    changedFiles?: string[];
    /** Use PR template from repository */
    useTemplate?: boolean;
    /** Generate AI description summary */
    generateDescription?: boolean;
    /** Implementation summary for description generation */
    implementationSummary?: string;
}
export interface MergeResult {
    merged: boolean;
    sha: string | null;
    message: string;
}
/**
 * Result type for operations that support graceful degradation
 */
export interface DegradedResult<T> {
    value: T;
    degraded: boolean;
}
export interface PRManager {
    listOpenPRs(): Promise<PullRequest[]>;
    listOpenPRsWithFallback(fallback?: PullRequest[]): Promise<DegradedResult<PullRequest[]>>;
    getPR(number: number): Promise<PullRequest | null>;
    findPRForBranch(branchName: string, base?: string): Promise<PullRequest | null>;
    createPR(options: CreatePROptions): Promise<PullRequest>;
    createPRWithFallback(options: CreatePROptions): Promise<DegradedResult<PullRequest | null>>;
    /** Create a PR with enhanced options for autonomous workflows */
    createEnhancedPR(options: EnhancedPROptions): Promise<PullRequest>;
    mergePR(number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<MergeResult>;
    mergePRWithFallback(number: number, method?: 'merge' | 'squash' | 'rebase'): Promise<DegradedResult<MergeResult>>;
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
    getServiceHealth(): ServiceHealth;
    isAvailable(): boolean;
    /** Convert a draft PR to ready for review */
    convertDraftToReady(number: number): Promise<boolean>;
    /** Update PR with new title, body, or labels */
    updatePR(number: number, updates: {
        title?: string;
        body?: string;
        labels?: string[];
    }): Promise<PullRequest>;
    /** Add labels to a PR */
    addLabels(number: number, labels: string[]): Promise<void>;
    /** Request reviewers for a PR */
    requestReviewers(number: number, reviewers: string[]): Promise<void>;
    /** Get CODEOWNERS file content and parse it */
    getCodeOwners(): Promise<CodeOwnerEntry[]>;
    /** Find reviewers for given file paths based on CODEOWNERS */
    findReviewersForFiles(files: string[]): Promise<string[]>;
    /** Get PR template from repository */
    getPRTemplate(): Promise<string | null>;
    /** Get branch protection rules */
    getBranchProtection(branch: string): Promise<BranchProtectionStatus>;
    /** Check if merge is allowed based on branch protection rules */
    canMerge(number: number): Promise<{
        allowed: boolean;
        reasons: string[];
    }>;
    /** Generate PR description from issue and changes */
    generatePRDescription(options: PRDescriptionOptions): string;
    /** Get labels for a task category and priority */
    getCategoryLabels(category?: TaskCategory, priority?: PriorityLevel): string[];
}
export declare function createPRManager(client: GitHubClient): PRManager;
//# sourceMappingURL=pulls.d.ts.map