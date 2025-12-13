import { GitHubClient, type ServiceHealth } from './client.js';
export interface Issue {
    number: number;
    title: string;
    body: string | null;
    state: 'open' | 'closed';
    labels: string[];
    htmlUrl: string;
    createdAt: string;
    assignee: string | null;
}
export interface CreateIssueOptions {
    title: string;
    body: string;
    labels?: string[];
}
/**
 * Result type for operations that support graceful degradation
 */
export interface DegradedResult<T> {
    value: T;
    degraded: boolean;
}
export interface IssueManager {
    listOpenIssues(label?: string): Promise<Issue[]>;
    listOpenIssuesWithFallback(label?: string, fallback?: Issue[]): Promise<DegradedResult<Issue[]>>;
    getIssue(number: number): Promise<Issue | null>;
    /** Get multiple issues in a batch (reduces API calls) */
    getIssuesBatch(numbers: number[]): Promise<Map<number, Issue | null>>;
    createIssue(options: CreateIssueOptions): Promise<Issue>;
    addLabels(issueNumber: number, labels: string[]): Promise<void>;
    addLabelsWithFallback(issueNumber: number, labels: string[]): Promise<DegradedResult<void>>;
    removeLabel(issueNumber: number, label: string): Promise<void>;
    closeIssue(issueNumber: number, comment?: string): Promise<void>;
    addComment(issueNumber: number, body: string): Promise<void>;
    addCommentWithFallback(issueNumber: number, body: string): Promise<DegradedResult<void>>;
    getServiceHealth(): ServiceHealth;
    isAvailable(): boolean;
    /** Invalidate cached issue data */
    invalidateCache(): void;
    /** Invalidate a specific issue from cache */
    invalidateIssue(number: number): void;
}
export declare function createIssueManager(client: GitHubClient): IssueManager;
//# sourceMappingURL=issues.d.ts.map