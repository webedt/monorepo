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
}
export declare class Worker {
    private options;
    private workerId;
    private log;
    constructor(options: WorkerOptions, workerId: string);
    execute(task: WorkerTask): Promise<WorkerResult>;
    private setupWorkspace;
    private cleanupWorkspace;
    private cloneRepo;
    private createBranch;
    private writeClaudeCredentials;
    private executeWithClaude;
    private buildPrompt;
    private hasChanges;
    private commitAndPush;
}
//# sourceMappingURL=worker.d.ts.map