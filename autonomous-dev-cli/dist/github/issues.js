import { logger } from '../utils/logger.js';
export function createIssueManager(client) {
    const octokit = client.client;
    const { owner, repo } = client;
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
                logger.error('Failed to list issues', { error });
                throw error;
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
                if (error.status === 404) {
                    return null;
                }
                throw error;
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
                logger.error('Failed to create issue', { error, title: options.title });
                throw error;
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
                logger.error('Failed to add labels', { error, issueNumber, labels });
                throw error;
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
                // Ignore if label doesn't exist
                if (error.status !== 404) {
                    throw error;
                }
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
                logger.error('Failed to close issue', { error, issueNumber });
                throw error;
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
                logger.error('Failed to add comment', { error, issueNumber });
                throw error;
            }
        },
    };
}
//# sourceMappingURL=issues.js.map