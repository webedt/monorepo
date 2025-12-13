import { type Issue } from '../github/issues.js';
export interface WorkerOptions {
    workDir: string;
    repoUrl: string;
    baseBranch: string;
    githubToken: string;
    claudeAuth: {
        accessToken: string;
        refreshToken: string;
        expiresAt?: number;
    };
    timeoutMinutes: number;
    userId?: string;
    repoOwner?: string;
    repoName?: string;
    enableDatabaseLogging?: boolean;
    sparseCheckout?: {
        enabled: boolean;
        paths?: string[];
    };
    useShallowClone?: boolean;
}
export interface WorkerTask {
    issue: Issue;
    branchName: string;
}
export interface WorkerResult {
    success: boolean;
    issue: Issue;
    branchName: string;
    commitSha?: string;
    error?: string;
    duration: number;
    chatSessionId?: string;
}
export declare class Worker {
    private options;
    private workerId;
    private log;
    private repository;
    constructor(options: WorkerOptions, workerId: string);
    /**
     * Extract repository name from URL for metrics labeling
     */
    private extractRepoName;
    /**
     * Get error context for debugging
     */
    private getErrorContext;
    /**
     * Wrap an error with execution context
     */
    private wrapExecutionError;
    execute(task: WorkerTask): Promise<WorkerResult>;
    private setupWorkspace;
    private cleanupWorkspace;
    private cloneRepo;
    private createBranch;
    private writeClaudeCredentials;
    private executeWithClaude;
    private sanitizeToolInput;
    private buildPrompt;
    private hasChanges;
    private commitAndPush;
}
//# sourceMappingURL=worker.d.ts.map