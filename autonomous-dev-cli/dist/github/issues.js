import { logger } from '../utils/logger.js';
import { GitHubError, createGitHubErrorFromResponse, } from '../utils/errors.js';
export function createIssueManager(client) {
    const octokit = client.client;
    const { owner, repo } = client;
    /**
     * Get error context for debugging
     */
    const getErrorContext = (operation, extra) => ({
        operation,
        component: 'IssueManager',
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
        return createGitHubErrorFromResponse(error, `issues.${operation}`, getErrorContext(operation, extra));
    };
    return {
        async listOpenIssues(label) {
            try {
                const params = {
                    owner,
                    repo,
                    state: 'open',
                    per_page: 100,
                };
                if (label) {
                    params.labels = label;
                }
                const { data } = await octokit.issues.listForRepo(params);
                // Filter out pull requests (GitHub API returns PRs as issues)
                const issues = data.filter((item) => !item.pull_request);
                return issues.map((issue) => ({
                    number: issue.number,
                    title: issue.title,
                    body: issue.body ?? null,
                    state: issue.state,
                    labels: issue.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
                    htmlUrl: issue.html_url,
                    createdAt: issue.created_at,
                    assignee: issue.assignee?.login || null,
                }));
            }
            catch (error) {
                const structuredError = handleError(error, 'listOpenIssues', { label });
                logger.error('Failed to list issues', {
                    code: structuredError.code,
                    message: structuredError.message,
                    label,
                });
                throw structuredError;
            }
        },
        async getIssue(number) {
            try {
                const { data } = await octokit.issues.get({
                    owner,
                    repo,
                    issue_number: number,
                });
                return {
                    number: data.number,
                    title: data.title,
                    body: data.body ?? null,
                    state: data.state,
                    labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
                    htmlUrl: data.html_url,
                    createdAt: data.created_at,
                    assignee: data.assignee?.login || null,
                };
            }
            catch (error) {
                // Return null for 404 (issue not found)
                if (error.status === 404) {
                    logger.debug(`Issue #${number} not found`, { issueNumber: number });
                    return null;
                }
                const structuredError = handleError(error, 'getIssue', { issueNumber: number });
                logger.error('Failed to get issue', {
                    code: structuredError.code,
                    message: structuredError.message,
                    issueNumber: number,
                });
                throw structuredError;
            }
        },
        async createIssue(options) {
            try {
                const { data } = await octokit.issues.create({
                    owner,
                    repo,
                    title: options.title,
                    body: options.body,
                    labels: options.labels,
                });
                logger.info(`Created issue #${data.number}: ${data.title}`);
                return {
                    number: data.number,
                    title: data.title,
                    body: data.body ?? null,
                    state: data.state,
                    labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name || '')),
                    htmlUrl: data.html_url,
                    createdAt: data.created_at,
                    assignee: data.assignee?.login || null,
                };
            }
            catch (error) {
                const structuredError = handleError(error, 'createIssue', {
                    title: options.title,
                    labelsCount: options.labels?.length ?? 0,
                });
                logger.error('Failed to create issue', {
                    code: structuredError.code,
                    message: structuredError.message,
                    title: options.title,
                });
                throw structuredError;
            }
        },
        async addLabels(issueNumber, labels) {
            try {
                await octokit.issues.addLabels({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    labels,
                });
                logger.debug(`Added labels to issue #${issueNumber}`, { labels });
            }
            catch (error) {
                const structuredError = handleError(error, 'addLabels', { issueNumber, labels });
                logger.error('Failed to add labels', {
                    code: structuredError.code,
                    message: structuredError.message,
                    issueNumber,
                    labels,
                });
                throw structuredError;
            }
        },
        async removeLabel(issueNumber, label) {
            try {
                await octokit.issues.removeLabel({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    name: label,
                });
                logger.debug(`Removed label '${label}' from issue #${issueNumber}`);
            }
            catch (error) {
                // Ignore if label doesn't exist (404)
                if (error.status === 404) {
                    logger.debug(`Label '${label}' not found on issue #${issueNumber}`);
                    return;
                }
                const structuredError = handleError(error, 'removeLabel', { issueNumber, label });
                logger.error('Failed to remove label', {
                    code: structuredError.code,
                    message: structuredError.message,
                    issueNumber,
                    label,
                });
                throw structuredError;
            }
        },
        async closeIssue(issueNumber, comment) {
            try {
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
            }
            catch (error) {
                const structuredError = handleError(error, 'closeIssue', { issueNumber, hasComment: !!comment });
                logger.error('Failed to close issue', {
                    code: structuredError.code,
                    message: structuredError.message,
                    issueNumber,
                });
                throw structuredError;
            }
        },
        async addComment(issueNumber, body) {
            try {
                await octokit.issues.createComment({
                    owner,
                    repo,
                    issue_number: issueNumber,
                    body,
                });
                logger.debug(`Added comment to issue #${issueNumber}`);
            }
            catch (error) {
                const structuredError = handleError(error, 'addComment', {
                    issueNumber,
                    bodyLength: body.length,
                });
                logger.error('Failed to add comment', {
                    code: structuredError.code,
                    message: structuredError.message,
                    issueNumber,
                });
                throw structuredError;
            }
        },
    };
}
//# sourceMappingURL=issues.js.map