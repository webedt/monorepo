import { GitHubClient } from './client.js';
export interface Branch {
    name: string;
    sha: string;
    protected: boolean;
}
export interface BranchManager {
    listBranches(): Promise<Branch[]>;
    getBranch(name: string): Promise<Branch | null>;
    createBranch(name: string, baseBranch: string): Promise<Branch>;
    deleteBranch(name: string): Promise<void>;
    branchExists(name: string): Promise<boolean>;
}
export declare function createBranchManager(client: GitHubClient): BranchManager;
//# sourceMappingURL=branches.d.ts.map