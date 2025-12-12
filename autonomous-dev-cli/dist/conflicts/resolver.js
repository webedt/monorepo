import { logger } from '../utils/logger.js';
export class ConflictResolver {
    options;
    log = logger.child('ConflictResolver');
    constructor(options) {
        this.options = options;
    }
    async attemptMerge(branchName, prNumber) {
        const { prManager, maxRetries, strategy, mergeMethod } = this.options;
        let attempts = 0;
        this.log.info(`Attempting to merge branch: ${branchName}`);
        // Get or create PR
        let pr = null;
        if (prNumber) {
            pr = await prManager.getPR(prNumber);
        }
        else {
            pr = await prManager.findPRForBranch(branchName, this.options.baseBranch);
        }
        if (!pr) {
            this.log.error(`No PR found for branch ${branchName}`);
            return {
                success: false,
                merged: false,
                error: 'No PR found',
                attempts: 0,
            };
        }
        while (attempts < maxRetries) {
            attempts++;
            this.log.info(`Merge attempt ${attempts}/${maxRetries}`);
            // Wait for GitHub to calculate mergeability
            const isMergeable = await prManager.waitForMergeable(pr.number, 30);
            if (isMergeable) {
                // Try to merge
                const mergeResult = await prManager.mergePR(pr.number, mergeMethod);
                if (mergeResult.merged) {
                    this.log.success(`PR #${pr.number} merged successfully`);
                    // Delete the branch
                    try {
                        await this.options.branchManager.deleteBranch(branchName);
                    }
                    catch (e) {
                        this.log.warn(`Failed to delete branch ${branchName} (may already be deleted)`);
                    }
                    return {
                        success: true,
                        pr,
                        merged: true,
                        sha: mergeResult.sha || undefined,
                        attempts,
                    };
                }
                else {
                    this.log.warn(`Merge failed: ${mergeResult.message}`);
                }
            }
            // PR is not mergeable - try to resolve conflicts
            if (strategy === 'manual') {
                this.log.warn('Conflicts detected, manual resolution required');
                return {
                    success: false,
                    pr,
                    merged: false,
                    error: 'Conflicts require manual resolution',
                    attempts,
                };
            }
            // Try to update the branch from base
            this.log.info(`Updating branch from ${this.options.baseBranch}...`);
            const updated = await prManager.updatePRFromBase(pr.number);
            if (!updated) {
                this.log.warn('Failed to update branch - conflicts may exist');
                if (strategy === 'rebase') {
                    this.log.warn('Rebase strategy failed, would need local git operations');
                    // For now, we'll just try again as the conflict might be resolvable
                }
            }
            // Wait before next attempt
            await sleep(2000);
            // Refresh PR data
            pr = await prManager.getPR(pr.number);
            if (!pr) {
                return {
                    success: false,
                    merged: false,
                    error: 'PR was closed or deleted',
                    attempts,
                };
            }
        }
        this.log.error(`Failed to merge after ${maxRetries} attempts`);
        return {
            success: false,
            pr,
            merged: false,
            error: `Failed to merge after ${maxRetries} attempts`,
            attempts,
        };
    }
    // Merge multiple PRs sequentially, handling conflicts
    async mergeSequentially(branches) {
        const results = new Map();
        for (const { branchName, prNumber } of branches) {
            this.log.info(`Processing: ${branchName}`);
            const result = await this.attemptMerge(branchName, prNumber);
            results.set(branchName, result);
            if (result.merged) {
                this.log.success(`✓ ${branchName} merged`);
                // Small delay after successful merge to let GitHub update
                await sleep(3000);
            }
            else {
                this.log.failure(`✗ ${branchName} failed: ${result.error}`);
            }
        }
        return results;
    }
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export function createConflictResolver(options) {
    return new ConflictResolver(options);
}
//# sourceMappingURL=resolver.js.map