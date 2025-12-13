import { logger } from '../utils/logger.js';
import { GitHubError, ErrorCode, createGitHubErrorFromResponse, } from '../utils/errors.js';
export function createPRManager(client) {
    const octokit = client.client;
    const { owner, repo } = client;
    /**
     * Get error context for debugging
     */
    const getErrorContext = (operation, extra) => ({
        operation,
        component: 'PRManager',
        owner,
        repo,
        ...extra,
    });
    /**
     * Handle and convert errors to structured GitHubError
     */
    const handleError = (error, operation, extra) => {
        if (error instanceof GitHubError) {
            return error;
        }
        return createGitHubErrorFromResponse(error, `pulls.${operation}`, getErrorContext(operation, extra));
    };
    const mapPR = (data) => ({
        number: data.number,
        title: data.title,
        body: data.body,
        state: data.state,
        head: { ref: data.head.ref, sha: data.head.sha },
        base: { ref: data.base.ref, sha: data.base.sha },
        htmlUrl: data.html_url,
        mergeable: data.mergeable,
        merged: data.merged,
        draft: data.draft,
    });
    return {
        async listOpenPRs() {
            try {
                const { data } = await octokit.pulls.list({
                    owner,
                    repo,
                    state: 'open',
                    per_page: 100,
                });
                return data.map(mapPR);
            }
            catch (error) {
                const structuredError = handleError(error, 'listOpenPRs');
                logger.error('Failed to list PRs', {
                    code: structuredError.code,
                    message: structuredError.message,
                });
                throw structuredError;
            }
        },
        async getPR(number) {
            try {
                const { data } = await octokit.pulls.get({
                    owner,
                    repo,
                    pull_number: number,
                });
                return mapPR(data);
            }
            catch (error) {
                // Return null for 404 (PR not found)
                if (error.status === 404) {
                    logger.debug(`PR #${number} not found`, { prNumber: number });
                    return null;
                }
                const structuredError = handleError(error, 'getPR', { prNumber: number });
                logger.error('Failed to get PR', {
                    code: structuredError.code,
                    message: structuredError.message,
                    prNumber: number,
                });
                throw structuredError;
            }
        },
        async findPRForBranch(branchName, base) {
            try {
                const params = {
                    owner,
                    repo,
                    head: `${owner}:${branchName}`,
                    state: 'open',
                };
                if (base) {
                    params.base = base;
                }
                const { data } = await octokit.pulls.list(params);
                if (data.length === 0) {
                    return null;
                }
                return mapPR(data[0]);
            }
            catch (error) {
                const structuredError = handleError(error, 'findPRForBranch', { branchName, base });
                logger.error('Failed to find PR for branch', {
                    code: structuredError.code,
                    message: structuredError.message,
                    branchName,
                });
                throw structuredError;
            }
        },
        async createPR(options) {
            try {
                // Check if PR already exists
                const existing = await this.findPRForBranch(options.head, options.base);
                if (existing) {
                    logger.info(`PR already exists for branch '${options.head}': #${existing.number}`);
                    return existing;
                }
                const { data } = await octokit.pulls.create({
                    owner,
                    repo,
                    title: options.title,
                    body: options.body,
                    head: options.head,
                    base: options.base,
                    draft: options.draft,
                });
                logger.info(`Created PR #${data.number}: ${data.title}`);
                return mapPR(data);
            }
            catch (error) {
                // Handle case where PR already exists
                if (error.message?.includes('A pull request already exists')) {
                    const existing = await this.findPRForBranch(options.head, options.base);
                    if (existing) {
                        return existing;
                    }
                }
                const structuredError = handleError(error, 'createPR', {
                    head: options.head,
                    base: options.base,
                    title: options.title,
                });
                logger.error('Failed to create PR', {
                    code: structuredError.code,
                    message: structuredError.message,
                    head: options.head,
                });
                throw structuredError;
            }
        },
        async mergePR(number, method = 'squash') {
            try {
                const { data } = await octokit.pulls.merge({
                    owner,
                    repo,
                    pull_number: number,
                    merge_method: method,
                });
                logger.info(`Merged PR #${number} via ${method}`);
                return {
                    merged: data.merged,
                    sha: data.sha,
                    message: data.message,
                };
            }
            catch (error) {
                // Handle merge conflicts specifically
                if (error.status === 405 || error.status === 409) {
                    const structuredError = new GitHubError(ErrorCode.GITHUB_PR_CONFLICT, `Cannot merge PR #${number}: ${error.message || 'merge conflict or branch not mergeable'}`, {
                        statusCode: error.status,
                        endpoint: 'pulls.merge',
                        context: getErrorContext('mergePR', { prNumber: number, method }),
                        cause: error,
                    });
                    logger.warn('Merge failed due to conflict', {
                        code: structuredError.code,
                        prNumber: number,
                        method,
                    });
                    return {
                        merged: false,
                        sha: null,
                        message: structuredError.message,
                    };
                }
                const structuredError = handleError(error, 'mergePR', { prNumber: number, method });
                logger.error('Failed to merge PR', {
                    code: structuredError.code,
                    message: structuredError.message,
                    prNumber: number,
                    method,
                });
                return {
                    merged: false,
                    sha: null,
                    message: structuredError.message,
                };
            }
        },
        async closePR(number) {
            try {
                await octokit.pulls.update({
                    owner,
                    repo,
                    pull_number: number,
                    state: 'closed',
                });
                logger.info(`Closed PR #${number}`);
            }
            catch (error) {
                const structuredError = handleError(error, 'closePR', { prNumber: number });
                logger.error('Failed to close PR', {
                    code: structuredError.code,
                    message: structuredError.message,
                    prNumber: number,
                });
                throw structuredError;
            }
        },
        async updatePRFromBase(number) {
            try {
                const pr = await this.getPR(number);
                if (!pr) {
                    logger.warn('PR not found for update', { prNumber: number });
                    return false;
                }
                // Merge base branch into the PR branch
                await octokit.repos.merge({
                    owner,
                    repo,
                    base: pr.head.ref,
                    head: pr.base.ref,
                    commit_message: `Merge ${pr.base.ref} into ${pr.head.ref}`,
                });
                logger.info(`Updated PR #${number} with changes from ${pr.base.ref}`);
                return true;
            }
            catch (error) {
                if (error.status === 204) {
                    // Already up to date
                    logger.info(`PR #${number} is already up to date`);
                    return true;
                }
                if (error.status === 409) {
                    // Merge conflict - this is expected and not a true error
                    const conflictError = new GitHubError(ErrorCode.GITHUB_PR_CONFLICT, `PR #${number} has merge conflicts that require manual resolution`, {
                        statusCode: 409,
                        endpoint: 'repos.merge',
                        context: getErrorContext('updatePRFromBase', { prNumber: number }),
                        cause: error,
                    });
                    logger.warn('PR has merge conflicts', {
                        code: conflictError.code,
                        prNumber: number,
                    });
                    return false;
                }
                const structuredError = handleError(error, 'updatePRFromBase', { prNumber: number });
                logger.error('Failed to update PR from base', {
                    code: structuredError.code,
                    message: structuredError.message,
                    prNumber: number,
                });
                throw structuredError;
            }
        },
        async waitForMergeable(number, maxAttempts = 30) {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const pr = await this.getPR(number);
                if (!pr) {
                    logger.debug(`PR #${number} not found while waiting for mergeability`);
                    return false;
                }
                if (pr.mergeable === true) {
                    return true;
                }
                if (pr.mergeable === false) {
                    logger.warn(`PR #${number} has conflicts and is not mergeable`);
                    return false;
                }
                // mergeable is null - GitHub is still computing
                logger.debug(`Waiting for PR #${number} mergeability check... (${attempt + 1}/${maxAttempts})`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
            logger.warn(`Timed out waiting for PR #${number} mergeability after ${maxAttempts} attempts`);
            return false;
        },
        async getChecksStatus(ref) {
            try {
                const { data } = await octokit.repos.getCombinedStatusForRef({
                    owner,
                    repo,
                    ref,
                });
                return {
                    state: data.state,
                    statuses: data.statuses.map((s) => ({
                        context: s.context,
                        state: s.state,
                    })),
                };
            }
            catch (error) {
                const structuredError = handleError(error, 'getChecksStatus', { ref });
                logger.error('Failed to get checks status', {
                    code: structuredError.code,
                    message: structuredError.message,
                    ref,
                });
                throw structuredError;
            }
        },
    };
}
//# sourceMappingURL=pulls.js.map