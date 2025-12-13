import { logger } from '../utils/logger.js';
import { createGitHubErrorFromResponse, } from '../utils/errors.js';
export function createPRManager(client) {
    const octokit = client.client;
    const { owner, repo } = client;
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
        labels: data.labels?.map((l) => (typeof l === 'string' ? l : l.name || '')) ?? [],
        reviewers: data.requested_reviewers?.map((r) => r.login) ?? [],
    });
    /**
     * Parse CODEOWNERS file content into structured entries
     */
    const parseCodeOwners = (content) => {
        const entries = [];
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            // Skip empty lines and comments
            if (!trimmed || trimmed.startsWith('#')) {
                continue;
            }
            // Parse pattern and owners (format: pattern @owner1 @owner2)
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 2) {
                const pattern = parts[0];
                const owners = parts.slice(1)
                    .filter(p => p.startsWith('@'))
                    .map(p => p.replace('@', ''));
                if (owners.length > 0) {
                    entries.push({ pattern, owners });
                }
            }
        }
        return entries;
    };
    /**
     * Match a file path against a CODEOWNERS pattern
     */
    const matchCodeOwnersPattern = (filePath, pattern) => {
        // Normalize paths
        const normalizedFile = filePath.startsWith('/') ? filePath : `/${filePath}`;
        const normalizedPattern = pattern.startsWith('/') ? pattern : `/${pattern}`;
        // Handle glob patterns
        if (normalizedPattern.includes('*')) {
            // Convert glob to regex
            const regexPattern = normalizedPattern
                .replace(/\*\*/g, '{{DOUBLE_STAR}}')
                .replace(/\*/g, '[^/]*')
                .replace(/{{DOUBLE_STAR}}/g, '.*')
                .replace(/\//g, '\\/');
            const regex = new RegExp(`^${regexPattern}`);
            return regex.test(normalizedFile);
        }
        // Exact match or directory match
        if (normalizedPattern.endsWith('/')) {
            return normalizedFile.startsWith(normalizedPattern);
        }
        return normalizedFile === normalizedPattern || normalizedFile.startsWith(`${normalizedPattern}/`);
    };
    /**
     * Get category label prefix based on task type
     */
    const getCategoryLabelPrefix = (category) => {
        const prefixes = {
            feature: 'type: feature',
            bugfix: 'type: bug',
            refactor: 'type: refactor',
            docs: 'type: docs',
            test: 'type: test',
            chore: 'type: chore',
            security: 'type: security',
            performance: 'type: performance',
        };
        return prefixes[category];
    };
    /**
     * Get priority label based on level
     */
    const getPriorityLabel = (priority) => {
        const labels = {
            critical: 'priority: critical',
            high: 'priority: high',
            medium: 'priority: medium',
            low: 'priority: low',
        };
        return labels[priority];
    };
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
                handleError(error, 'list PRs');
            }
        },
        async listOpenPRsWithFallback(fallback = []) {
            const result = await client.executeWithFallback(async () => {
                const { data } = await octokit.pulls.list({
                    owner,
                    repo,
                    state: 'open',
                    per_page: 100,
                });
                return data.map(mapPR);
            }, fallback, `GET /repos/${owner}/${repo}/pulls`, { operation: 'listOpenPRs' });
            if (result.degraded) {
                logger.warn('PR list fetch degraded - using fallback', {
                    fallbackCount: fallback.length,
                });
            }
            return result;
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
                if (error.status === 404) {
                    return null;
                }
                handleError(error, 'get PR', { prNumber: number });
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
                handleError(error, 'find PR for branch', { branchName, base });
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
                handleError(error, 'create PR', { head: options.head, base: options.base });
            }
        },
        async createPRWithFallback(options) {
            const result = await client.executeWithFallback(async () => {
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
            }, null, `POST /repos/${owner}/${repo}/pulls`, { operation: 'createPR', head: options.head });
            if (result.degraded) {
                logger.warn('PR creation degraded - operation skipped', {
                    head: options.head,
                    base: options.base,
                });
            }
            return result;
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
                logger.error('Failed to merge PR', { error: error.message, number, method });
                return {
                    merged: false,
                    sha: null,
                    message: error.message || 'Merge failed',
                };
            }
        },
        async mergePRWithFallback(number, method = 'squash') {
            const failedResult = {
                merged: false,
                sha: null,
                message: 'Merge skipped due to service degradation',
            };
            const result = await client.executeWithFallback(async () => {
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
            }, failedResult, `PUT /repos/${owner}/${repo}/pulls/${number}/merge`, { operation: 'mergePR', prNumber: number, method });
            if (result.degraded) {
                logger.warn('PR merge degraded - operation skipped', {
                    prNumber: number,
                    method,
                });
            }
            return result;
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
                handleError(error, 'close PR', { prNumber: number });
            }
        },
        async updatePRFromBase(number) {
            try {
                const pr = await this.getPR(number);
                if (!pr) {
                    logger.error('PR not found', { number });
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
                    // Merge conflict
                    logger.warn(`PR #${number} has merge conflicts`);
                    return false;
                }
                handleError(error, 'update PR from base', { prNumber: number });
            }
        },
        async waitForMergeable(number, maxAttempts = 30) {
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const pr = await this.getPR(number);
                if (!pr) {
                    return false;
                }
                if (pr.mergeable === true) {
                    return true;
                }
                if (pr.mergeable === false) {
                    logger.warn(`PR #${number} has conflicts`);
                    return false;
                }
                // mergeable is null - GitHub is still computing
                logger.debug(`Waiting for PR #${number} mergeability check... (${attempt + 1}/${maxAttempts})`);
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
            logger.warn(`Timed out waiting for PR #${number} mergeability`);
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
                handleError(error, 'get checks status', { ref });
            }
        },
        async createEnhancedPR(options) {
            // Build labels from category and priority
            const labels = [...(options.labels || [])];
            if (options.category) {
                labels.push(getCategoryLabelPrefix(options.category));
            }
            if (options.priority) {
                labels.push(getPriorityLabel(options.priority));
            }
            // Get reviewers from CODEOWNERS if auto-assign is enabled
            let reviewers = options.reviewers || [];
            if (options.autoAssignReviewers && options.changedFiles?.length) {
                try {
                    const codeOwnersReviewers = await this.findReviewersForFiles(options.changedFiles);
                    reviewers = [...new Set([...reviewers, ...codeOwnersReviewers])];
                    logger.debug('Auto-assigned reviewers from CODEOWNERS', { reviewers, changedFiles: options.changedFiles });
                }
                catch (error) {
                    logger.warn('Failed to get reviewers from CODEOWNERS', { error: error.message });
                }
            }
            // Load and apply PR template if requested
            let body = options.body;
            if (options.useTemplate) {
                try {
                    const template = await this.getPRTemplate();
                    if (template) {
                        body = this.generatePRDescription({
                            issueNumber: options.issueNumber,
                            issueTitle: options.title,
                            changedFiles: options.changedFiles,
                            category: options.category,
                            summary: options.implementationSummary || options.body,
                        });
                        logger.debug('Applied PR template', { hasTemplate: true });
                    }
                }
                catch (error) {
                    logger.warn('Failed to load PR template', { error: error.message });
                }
            }
            else if (options.generateDescription) {
                // Generate description without template
                body = this.generatePRDescription({
                    issueNumber: options.issueNumber,
                    issueTitle: options.title,
                    changedFiles: options.changedFiles,
                    category: options.category,
                    summary: options.implementationSummary || options.body,
                });
            }
            // Create the PR (start as draft if specified)
            const pr = await this.createPR({
                ...options,
                body,
                draft: options.draft ?? false,
            });
            // Add labels if any
            if (labels.length > 0) {
                try {
                    await this.addLabels(pr.number, labels);
                    logger.debug(`Added labels to PR #${pr.number}`, { labels });
                }
                catch (error) {
                    logger.warn(`Failed to add labels to PR #${pr.number}`, { error: error.message });
                }
            }
            // Request reviewers if any
            if (reviewers.length > 0) {
                try {
                    await this.requestReviewers(pr.number, reviewers);
                    logger.debug(`Requested reviewers for PR #${pr.number}`, { reviewers });
                }
                catch (error) {
                    logger.warn(`Failed to request reviewers for PR #${pr.number}`, { error: error.message });
                }
            }
            // Fetch updated PR with labels and reviewers
            const updatedPR = await this.getPR(pr.number);
            return updatedPR || pr;
        },
        async convertDraftToReady(number) {
            try {
                // Get the PR node ID for GraphQL mutation
                const { data: prData } = await octokit.pulls.get({
                    owner,
                    repo,
                    pull_number: number,
                });
                const nodeId = prData.node_id;
                // Use GraphQL mutation to convert draft to ready
                // Note: REST API doesn't support this directly
                await octokit.graphql(`
          mutation($pullRequestId: ID!) {
            markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
              pullRequest {
                id
                isDraft
              }
            }
          }
        `, {
                    pullRequestId: nodeId,
                });
                logger.info(`Converted PR #${number} from draft to ready for review`);
                return true;
            }
            catch (error) {
                if (error.message?.includes('not a draft')) {
                    logger.debug(`PR #${number} is already ready for review`);
                    return true;
                }
                logger.error(`Failed to convert PR #${number} to ready`, { error: error.message });
                return false;
            }
        },
        async updatePR(number, updates) {
            try {
                const updateParams = {
                    owner,
                    repo,
                    pull_number: number,
                };
                if (updates.title !== undefined) {
                    updateParams.title = updates.title;
                }
                if (updates.body !== undefined) {
                    updateParams.body = updates.body;
                }
                const { data } = await octokit.pulls.update(updateParams);
                // Handle labels separately via issues API
                if (updates.labels !== undefined) {
                    await octokit.issues.setLabels({
                        owner,
                        repo,
                        issue_number: number,
                        labels: updates.labels,
                    });
                }
                logger.info(`Updated PR #${number}`);
                return mapPR(data);
            }
            catch (error) {
                handleError(error, 'update PR', { prNumber: number, updates });
            }
        },
        async addLabels(number, labels) {
            try {
                await octokit.issues.addLabels({
                    owner,
                    repo,
                    issue_number: number,
                    labels,
                });
                logger.debug(`Added labels to PR #${number}`, { labels });
            }
            catch (error) {
                handleError(error, 'add labels to PR', { prNumber: number, labels });
            }
        },
        async requestReviewers(number, reviewers) {
            if (reviewers.length === 0)
                return;
            try {
                await octokit.pulls.requestReviewers({
                    owner,
                    repo,
                    pull_number: number,
                    reviewers,
                });
                logger.debug(`Requested reviewers for PR #${number}`, { reviewers });
            }
            catch (error) {
                // Some reviewers might be invalid (not collaborators), log but don't fail
                if (error.status === 422) {
                    logger.warn(`Some reviewers could not be assigned to PR #${number}`, {
                        reviewers,
                        error: error.message,
                    });
                    return;
                }
                handleError(error, 'request reviewers', { prNumber: number, reviewers });
            }
        },
        async getCodeOwners() {
            // Try multiple possible locations for CODEOWNERS
            const locations = [
                'CODEOWNERS',
                '.github/CODEOWNERS',
                'docs/CODEOWNERS',
            ];
            for (const path of locations) {
                try {
                    const { data } = await octokit.repos.getContent({
                        owner,
                        repo,
                        path,
                    });
                    if ('content' in data && data.content) {
                        const content = Buffer.from(data.content, 'base64').toString('utf-8');
                        const entries = parseCodeOwners(content);
                        logger.debug(`Loaded CODEOWNERS from ${path}`, { entryCount: entries.length });
                        return entries;
                    }
                }
                catch (error) {
                    if (error.status !== 404) {
                        logger.debug(`Error checking ${path} for CODEOWNERS`, { error: error.message });
                    }
                }
            }
            logger.debug('No CODEOWNERS file found in repository');
            return [];
        },
        async findReviewersForFiles(files) {
            const codeOwners = await this.getCodeOwners();
            if (codeOwners.length === 0) {
                return [];
            }
            const reviewerSet = new Set();
            for (const file of files) {
                // Find the most specific matching pattern (last match wins in CODEOWNERS)
                let matchedOwners = [];
                for (const entry of codeOwners) {
                    if (matchCodeOwnersPattern(file, entry.pattern)) {
                        matchedOwners = entry.owners;
                    }
                }
                for (const owner of matchedOwners) {
                    // Skip team entries (contain /)
                    if (!owner.includes('/')) {
                        reviewerSet.add(owner);
                    }
                }
            }
            return Array.from(reviewerSet);
        },
        async getPRTemplate() {
            // Try multiple possible locations for PR template
            const locations = [
                '.github/pull_request_template.md',
                '.github/PULL_REQUEST_TEMPLATE.md',
                'pull_request_template.md',
                'PULL_REQUEST_TEMPLATE.md',
                '.github/PULL_REQUEST_TEMPLATE/default.md',
            ];
            for (const path of locations) {
                try {
                    const { data } = await octokit.repos.getContent({
                        owner,
                        repo,
                        path,
                    });
                    if ('content' in data && data.content) {
                        const content = Buffer.from(data.content, 'base64').toString('utf-8');
                        logger.debug(`Loaded PR template from ${path}`);
                        return content;
                    }
                }
                catch (error) {
                    if (error.status !== 404) {
                        logger.debug(`Error checking ${path} for PR template`, { error: error.message });
                    }
                }
            }
            logger.debug('No PR template found in repository');
            return null;
        },
        async getBranchProtection(branch) {
            const status = {
                isProtected: false,
                requiresReviews: false,
                requiredReviewCount: 0,
                requiresStatusChecks: false,
                requiredStatusChecks: [],
                requiresSignedCommits: false,
                allowsForcePush: false,
                allowsDeletion: false,
                errors: [],
            };
            try {
                const { data } = await octokit.repos.getBranchProtection({
                    owner,
                    repo,
                    branch,
                });
                status.isProtected = true;
                // Check required reviews
                if (data.required_pull_request_reviews) {
                    status.requiresReviews = true;
                    status.requiredReviewCount = data.required_pull_request_reviews.required_approving_review_count || 1;
                }
                // Check required status checks
                if (data.required_status_checks) {
                    status.requiresStatusChecks = true;
                    status.requiredStatusChecks = data.required_status_checks.contexts || [];
                }
                // Check signed commits requirement
                if (data.required_signatures) {
                    status.requiresSignedCommits = true;
                }
                // Check force push and deletion rules
                status.allowsForcePush = data.allow_force_pushes?.enabled ?? false;
                status.allowsDeletion = data.allow_deletions?.enabled ?? false;
                logger.debug(`Retrieved branch protection for ${branch}`, status);
            }
            catch (error) {
                if (error.status === 404) {
                    // Branch is not protected or doesn't have protection rules
                    logger.debug(`No branch protection found for ${branch}`);
                }
                else {
                    status.errors.push(`Failed to get branch protection: ${error.message}`);
                    logger.warn(`Error getting branch protection for ${branch}`, { error: error.message });
                }
            }
            return status;
        },
        async canMerge(number) {
            const reasons = [];
            try {
                const pr = await this.getPR(number);
                if (!pr) {
                    return { allowed: false, reasons: ['PR not found'] };
                }
                // Check if PR is a draft
                if (pr.draft) {
                    reasons.push('PR is still in draft status');
                }
                // Check mergeability
                if (pr.mergeable === false) {
                    reasons.push('PR has merge conflicts');
                }
                else if (pr.mergeable === null) {
                    reasons.push('Mergeability is still being computed');
                }
                // Get branch protection rules
                const protection = await this.getBranchProtection(pr.base.ref);
                if (protection.isProtected) {
                    // Check status checks
                    if (protection.requiresStatusChecks && protection.requiredStatusChecks.length > 0) {
                        const checksStatus = await this.getChecksStatus(pr.head.sha);
                        if (checksStatus.state !== 'success') {
                            const pendingChecks = protection.requiredStatusChecks.filter(check => !checksStatus.statuses.some(s => s.context === check && s.state === 'success'));
                            if (pendingChecks.length > 0) {
                                reasons.push(`Required status checks not passed: ${pendingChecks.join(', ')}`);
                            }
                        }
                    }
                    // Check required reviews (we can't easily check this via API without more calls)
                    if (protection.requiresReviews) {
                        reasons.push(`Requires ${protection.requiredReviewCount} approving review(s)`);
                    }
                }
                // Add protection errors if any
                reasons.push(...protection.errors);
                return {
                    allowed: reasons.length === 0,
                    reasons,
                };
            }
            catch (error) {
                return {
                    allowed: false,
                    reasons: [`Error checking merge status: ${error.message}`],
                };
            }
        },
        generatePRDescription(options) {
            const sections = [];
            // Summary section
            sections.push('## Summary');
            if (options.summary) {
                sections.push(options.summary);
            }
            else if (options.issueTitle) {
                sections.push(`This PR implements: ${options.issueTitle}`);
            }
            else {
                sections.push('<!-- Add a brief description of the changes -->');
            }
            sections.push('');
            // Linked issue
            if (options.issueNumber) {
                sections.push('## Related Issue');
                sections.push(`Closes #${options.issueNumber}`);
                sections.push('');
            }
            // Category badge
            if (options.category) {
                sections.push('## Type of Change');
                const categoryLabels = {
                    feature: '✨ New Feature',
                    bugfix: '🐛 Bug Fix',
                    refactor: '♻️ Refactor',
                    docs: '📚 Documentation',
                    test: '🧪 Tests',
                    chore: '🔧 Chore',
                    security: '🔒 Security',
                    performance: '⚡ Performance',
                };
                sections.push(`- ${categoryLabels[options.category]}`);
                sections.push('');
            }
            // Changed files summary
            if (options.changedFiles && options.changedFiles.length > 0) {
                sections.push('## Changed Files');
                const maxFilesToShow = 10;
                const filesToShow = options.changedFiles.slice(0, maxFilesToShow);
                for (const file of filesToShow) {
                    sections.push(`- \`${file}\``);
                }
                if (options.changedFiles.length > maxFilesToShow) {
                    sections.push(`- ... and ${options.changedFiles.length - maxFilesToShow} more files`);
                }
                sections.push('');
            }
            // Test plan section
            sections.push('## Test Plan');
            sections.push('- [ ] Tests pass locally');
            sections.push('- [ ] Build succeeds');
            sections.push('- [ ] Code has been reviewed');
            sections.push('');
            // Footer
            sections.push('---');
            sections.push('🤖 Generated by [Autonomous Dev CLI](https://github.com/autonomous-dev/cli)');
            return sections.join('\n');
        },
        getCategoryLabels(category, priority) {
            const labels = [];
            if (category) {
                labels.push(getCategoryLabelPrefix(category));
            }
            if (priority) {
                labels.push(getPriorityLabel(priority));
            }
            return labels;
        },
    };
}
//# sourceMappingURL=pulls.js.map