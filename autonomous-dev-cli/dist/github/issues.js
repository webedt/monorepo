import { logger } from '../utils/logger.js';
import { createGitHubErrorFromResponse, } from '../utils/errors.js';
export function createIssueManager(client) {
    const octokit = client.client;
    const { owner, repo } = client;
    /**
     * Helper function to map GitHub API issue response to Issue type
     */
    const mapIssue = (issue) => ({
        number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        state: issue.state,
        labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
        htmlUrl: issue.html_url,
        createdAt: issue.created_at,
        assignee: issue.assignee?.login || null,
    });
    /**
     * Wrap error with structured error handling
     */
    const handleError = (error, operation, context) => {
        const structuredError = createGitHubErrorFromResponse(error, operation, {
            owner,
            repo,
            ...context,
        });
        logger.error(`Failed to ${operation}`, { error: structuredError.message, ...context });
        throw structuredError;
    };
    return {
        getServiceHealth() {
            return client.getServiceHealth();
        },
        isAvailable() {
            return client.isAvailable();
        },
        async listOpenIssues(label) {
            const cacheKey = `list-open-${label ?? 'all'}`;
            return client.getCachedOrFetch('issue-list', cacheKey, async () => {
                const params = {
                    owner,
                    repo,
                    state: 'open',
                    per_page: 100,
                };
                if (label) {
                    params.labels = label;
                }
                try {
                    return await client.execute(async () => {
                        const { data } = await octokit.issues.listForRepo(params);
                        // Filter out pull requests (GitHub API returns PRs as issues)
                        const issues = data.filter((item) => !item.pull_request);
                        return issues.map(mapIssue);
                    }, `GET /repos/${owner}/${repo}/issues`, { operation: 'listOpenIssues', label });
                }
                catch (error) {
                    return handleError(error, 'list issues', { label });
                }
            });
        },
        async listOpenIssuesWithFallback(label, fallback = []) {
            const params = {
                owner,
                repo,
                state: 'open',
                per_page: 100,
            };
            if (label) {
                params.labels = label;
            }
            const result = await client.executeWithFallback(async () => {
                const { data } = await octokit.issues.listForRepo(params);
                const issues = data.filter((item) => !item.pull_request);
                return issues.map(mapIssue);
            }, fallback, `GET /repos/${owner}/${repo}/issues`, { operation: 'listOpenIssues', label });
            if (result.degraded) {
                logger.warn('Issue list fetch degraded - using fallback', {
                    label,
                    fallbackCount: fallback.length,
                });
            }
            return result;
        },
        async getIssue(number) {
            const cacheKey = `issue-${number}`;
            try {
                return await client.getCachedOrFetch('issue', cacheKey, async () => {
                    return await client.execute(async () => {
                        const { data } = await octokit.issues.get({
                            owner,
                            repo,
                            issue_number: number,
                        });
                        return mapIssue(data);
                    }, `GET /repos/${owner}/${repo}/issues/${number}`, { operation: 'getIssue', issueNumber: number });
                });
            }
            catch (error) {
                if (error.status === 404) {
                    return null;
                }
                return handleError(error, 'get issue', { issueNumber: number });
            }
        },
        async getIssuesBatch(numbers) {
            const results = new Map();
            const uncached = [];
            const cache = client.getCache();
            // Check cache first
            for (const num of numbers) {
                const cacheKey = cache.generateKey('issue', owner, repo, `issue-${num}`);
                const cached = cache.get(cacheKey, 'issue');
                if (cached !== undefined) {
                    results.set(num, cached);
                }
                else {
                    uncached.push(num);
                }
            }
            // Fetch uncached issues in parallel (batched)
            if (uncached.length > 0) {
                const batchSize = 10; // Process in batches of 10
                for (let i = 0; i < uncached.length; i += batchSize) {
                    const batch = uncached.slice(i, i + batchSize);
                    const batchResults = await Promise.all(batch.map(async (num) => {
                        try {
                            const issue = await this.getIssue(num);
                            return { num, issue };
                        }
                        catch (error) {
                            logger.warn(`Failed to fetch issue #${num}`, { error: error.message });
                            return { num, issue: null };
                        }
                    }));
                    for (const { num, issue } of batchResults) {
                        results.set(num, issue);
                    }
                }
            }
            logger.debug('Batch fetched issues', {
                requested: numbers.length,
                cached: numbers.length - uncached.length,
                fetched: uncached.length,
            });
            return results;
        },
        async createIssue(options) {
            try {
                return await client.execute(async () => {
                    const { data } = await octokit.issues.create({
                        owner,
                        repo,
                        title: options.title,
                        body: options.body,
                        labels: options.labels,
                    });
                    logger.info(`Created issue #${data.number}: ${data.title}`);
                    return mapIssue(data);
                }, `POST /repos/${owner}/${repo}/issues`, { operation: 'createIssue', title: options.title });
            }
            catch (error) {
                return handleError(error, 'create issue', { title: options.title });
            }
        },
        async addLabels(issueNumber, labels) {
            try {
                await client.execute(async () => {
                    await octokit.issues.addLabels({
                        owner,
                        repo,
                        issue_number: issueNumber,
                        labels,
                    });
                    logger.debug(`Added labels to issue #${issueNumber}`, { labels });
                }, `POST /repos/${owner}/${repo}/issues/${issueNumber}/labels`, { operation: 'addLabels', issueNumber, labels });
            }
            catch (error) {
                handleError(error, 'add labels', { issueNumber, labels });
            }
        },
        async addLabelsWithFallback(issueNumber, labels) {
            const result = await client.executeWithFallback(async () => {
                await octokit.issues.addLabels({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    labels,
                });
                logger.debug(`Added labels to issue #${issueNumber}`, { labels });
            }, undefined, `POST /repos/${owner}/${repo}/issues/${issueNumber}/labels`, { operation: 'addLabels', issueNumber, labels });
            if (result.degraded) {
                logger.warn('Add labels degraded - operation skipped', { issueNumber, labels });
            }
            return result;
        },
        async removeLabel(issueNumber, label) {
            try {
                await client.execute(async () => {
                    await octokit.issues.removeLabel({
                        owner,
                        repo,
                        issue_number: issueNumber,
                        name: label,
                    });
                    logger.debug(`Removed label '${label}' from issue #${issueNumber}`);
                }, `DELETE /repos/${owner}/${repo}/issues/${issueNumber}/labels/${label}`, { operation: 'removeLabel', issueNumber, label });
            }
            catch (error) {
                // Ignore if label doesn't exist
                if (error.status !== 404) {
                    handleError(error, 'remove label', { issueNumber, label });
                }
            }
        },
        async closeIssue(issueNumber, comment) {
            try {
                await client.execute(async () => {
                    if (comment) {
                        await octokit.issues.createComment({
                            owner,
                            repo,
                            issue_number: issueNumber,
                            body: comment,
                        });
                    }
                    await octokit.issues.update({
                        owner,
                        repo,
                        issue_number: issueNumber,
                        state: 'closed',
                    });
                    logger.info(`Closed issue #${issueNumber}`);
                }, `PATCH /repos/${owner}/${repo}/issues/${issueNumber}`, { operation: 'closeIssue', issueNumber });
            }
            catch (error) {
                handleError(error, 'close issue', { issueNumber });
            }
        },
        async addComment(issueNumber, body) {
            try {
                await client.execute(async () => {
                    await octokit.issues.createComment({
                        owner,
                        repo,
                        issue_number: issueNumber,
                        body,
                    });
                    logger.debug(`Added comment to issue #${issueNumber}`);
                }, `POST /repos/${owner}/${repo}/issues/${issueNumber}/comments`, { operation: 'addComment', issueNumber });
            }
            catch (error) {
                handleError(error, 'add comment', { issueNumber });
            }
        },
        async addCommentWithFallback(issueNumber, body) {
            const result = await client.executeWithFallback(async () => {
                await octokit.issues.createComment({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    body,
                });
                logger.debug(`Added comment to issue #${issueNumber}`);
            }, undefined, `POST /repos/${owner}/${repo}/issues/${issueNumber}/comments`, { operation: 'addComment', issueNumber });
            if (result.degraded) {
                logger.warn('Add comment degraded - operation skipped', { issueNumber });
            }
            return result;
        },
        invalidateCache() {
            client.invalidateCacheType('issue');
            client.invalidateCacheType('issue-list');
            logger.debug('Invalidated issue cache');
        },
        invalidateIssue(number) {
            const cache = client.getCache();
            const cacheKey = cache.generateKey('issue', owner, repo, `issue-${number}`);
            cache.invalidate(cacheKey);
            // Also invalidate the list cache since it may contain stale data
            client.invalidateCacheType('issue-list');
            logger.debug(`Invalidated cache for issue #${number}`);
        },
    };
}
//# sourceMappingURL=issues.js.map