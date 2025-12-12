import { GitHubClient } from './client.js';
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
export interface IssueManager {
    listOpenIssues(label?: string): Promise<Issue[]>;
    getIssue(number: number): Promise<Issue | null>;
    createIssue(options: CreateIssueOptions): Promise<Issue>;
    addLabels(issueNumber: number, labels: string[]): Promise<void>;
    removeLabel(issueNumber: number, label: string): Promise<void>;
    closeIssue(issueNumber: number, comment?: string): Promise<void>;
    addComment(issueNumber: number, body: string): Promise<void>;
}
export declare function createIssueManager(client: GitHubClient): IssueManager;
//# sourceMappingURL=issues.d.ts.map