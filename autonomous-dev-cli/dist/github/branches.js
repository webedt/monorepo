import { logger } from '../utils/logger.js';
export function createBranchManager(client) {
    const octokit = client.client;
    const { owner, repo } = client;
    return {
        async listBranches() {
            try {
                const { data } = await octokit.repos.listBranches({
                    owner,
                    repo,
                    per_page: 100,
                });
                return data.map((branch) => ({
                    name: branch.name,
                    sha: branch.commit.sha,
                    protected: branch.protected,
                }));
            }
            catch (error) {
                logger.error('Failed to list branches', { error });
                throw error;
            }
        },
        async getBranch(name) {
            try {
                const { data } = await octokit.repos.getBranch({
                    owner,
                    repo,
                    branch: name,
                });
                return {
                    name: data.name,
                    sha: data.commit.sha,
                    protected: data.protected,
                };
            }
            catch (error) {
                if (error.status === 404) {
                    return null;
                }
                throw error;
            }
        },
        async createBranch(name, baseBranch) {
            try {
                // Get the SHA of the base branch
                const { data: baseBranchData } = await octokit.repos.getBranch({
                    owner,
                    repo,
                    branch: baseBranch,
                });
                // Create the new branch
                await octokit.git.createRef({
                    owner,
                    repo,
                    ref: `refs/heads/${name}`,
                    sha: baseBranchData.commit.sha,
                });
                logger.info(`Created branch '${name}' from '${baseBranch}'`);
                return {
                    name,
                    sha: baseBranchData.commit.sha,
                    protected: false,
                };
            }
            catch (error) {
                // Check if branch already exists
                if (error.status === 422 && error.message?.includes('Reference already exists')) {
                    logger.warn(`Branch '${name}' already exists`);
                    const existing = await this.getBranch(name);
                    if (existing) {
                        return existing;
                    }
                }
                logger.error('Failed to create branch', { error, name, baseBranch });
                throw error;
            }
        },
        async deleteBranch(name) {
            try {
                await octokit.git.deleteRef({
                    owner,
                    repo,
                    ref: `heads/${name}`,
                });
                logger.info(`Deleted branch '${name}'`);
            }
            catch (error) {
                if (error.status === 404) {
                    logger.warn(`Branch '${name}' not found (may already be deleted)`);
                    return;
                }
                logger.error('Failed to delete branch', { error, name });
                throw error;
            }
        },
        async branchExists(name) {
            const branch = await this.getBranch(name);
            return branch !== null;
        },
    };
}
//# sourceMappingURL=branches.js.map