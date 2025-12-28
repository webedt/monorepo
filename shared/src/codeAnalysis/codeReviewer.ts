/**
 * Code Reviewer Service
 * Uses Claude Web to review pull requests
 */

import { Octokit } from '@octokit/rest';
import { logger } from '../utils/logging/logger.js';
import { ClaudeWebClient } from '../claudeWeb/claudeWebClient.js';

import type { ClaudeRemoteAuth } from '../claudeWeb/types.js';
import type { ReviewResult } from './types.js';
import type { ReviewOptions } from './types.js';
import type { ReviewIssue } from './types.js';

const REVIEW_PROMPT = `Review this pull request and provide feedback.

Check for:
1. **Correctness**: Logic errors, bugs, edge cases
2. **Security**: Vulnerabilities, unsafe practices
3. **Code Quality**: Style, naming, organization
4. **Performance**: Inefficiencies, unnecessary operations
5. **Testing**: Missing tests, test quality

For each issue found, provide:
- Severity: error (must fix) | warning (should fix) | info (suggestion)
- File and line number
- Description of the issue
- Suggested fix

Output as JSON:
{
  "approved": true/false,
  "summary": "Brief summary of review",
  "issues": [
    {"severity": "...", "file": "...", "line": N, "message": "...", "suggestion": "..."}
  ]
}

If no significant issues found, approve the PR.
Only return the JSON, no other text.`;

export class CodeReviewerService {
  private client: ClaudeWebClient;
  private octokit: Octokit;

  constructor(
    auth: ClaudeRemoteAuth,
    environmentId: string,
    githubToken: string
  ) {
    this.client = new ClaudeWebClient({
      accessToken: auth.accessToken,
      environmentId,
    });
    this.octokit = new Octokit({ auth: githubToken });
  }

  async reviewPR(
    owner: string,
    repo: string,
    prNumber: number,
    options?: ReviewOptions,
    sessionId?: string
  ): Promise<ReviewResult> {
    logger.info('Starting PR review', {
      component: 'CodeReviewerService',
      owner,
      repo,
      prNumber,
    });

    // Get PR details
    const { data: pr } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    // Get PR diff
    const { data: diff } = await this.octokit.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
      mediaType: { format: 'diff' },
    });

    const gitUrl = pr.head.repo?.clone_url || `https://github.com/${owner}/${repo}`;
    const branch = pr.head.ref;

    const focusAreas = options?.focusAreas?.join(', ') || 'all areas';
    const strictMode = options?.strict ? 'Be strict - flag any potential issues.' : '';

    const prompt = `${REVIEW_PROMPT}

PR Title: ${pr.title}
PR Description: ${pr.body || 'No description provided'}
Branch: ${branch}
Focus areas: ${focusAreas}
${strictMode}

Here's the diff to review:
\`\`\`diff
${diff}
\`\`\``;

    try {
      let reviewOutput = '';

      // If sessionId provided, try to resume the session instead of creating new one
      if (sessionId) {
        try {
          const session = await this.client.getSession(sessionId);

          if (!['archived', 'failed', 'completed'].includes(session.session_status)) {
            // Session can be resumed
            logger.info('Resuming session for review', {
              component: 'CodeReviewerService',
              sessionId,
              sessionStatus: session.session_status,
            });

            await this.client.resume(
              sessionId,
              prompt,
              (event) => {
                if (event.type === 'assistant' && event.message?.content) {
                  const content = event.message.content;
                  if (Array.isArray(content)) {
                    for (const block of content) {
                      if (block.type === 'text') {
                        reviewOutput += block.text;
                      }
                    }
                  }
                }
              }
            );
          } else {
            // Session cannot be resumed, fall back to creating new session
            logger.warn('Session cannot be resumed, creating new review session', {
              component: 'CodeReviewerService',
              sessionId,
              sessionStatus: session.session_status,
            });

            await this.client.execute(
              {
                prompt,
                gitUrl,
                branchPrefix: `review/${prNumber}`,
              },
              (event) => {
                if (event.type === 'assistant' && event.message?.content) {
                  const content = event.message.content;
                  if (Array.isArray(content)) {
                    for (const block of content) {
                      if (block.type === 'text') {
                        reviewOutput += block.text;
                      }
                    }
                  }
                }
              }
            );
          }
        } catch (error) {
          // Error checking session or resuming, fall back to new session
          logger.warn('Failed to resume session, creating new review session', {
            component: 'CodeReviewerService',
            sessionId,
            error: error instanceof Error ? error.message : String(error),
          });

          await this.client.execute(
            {
              prompt,
              gitUrl,
              branchPrefix: `review/${prNumber}`,
            },
            (event) => {
              if (event.type === 'assistant' && event.message?.content) {
                const content = event.message.content;
                if (Array.isArray(content)) {
                  for (const block of content) {
                    if (block.type === 'text') {
                      reviewOutput += block.text;
                    }
                  }
                }
              }
            }
          );
        }
      } else {
        // No sessionId provided, create new session (backward compatible)
        await this.client.execute(
          {
            prompt,
            gitUrl,
            branchPrefix: `review/${prNumber}`,
          },
          (event) => {
            if (event.type === 'assistant' && event.message?.content) {
              const content = event.message.content;
              if (Array.isArray(content)) {
                for (const block of content) {
                  if (block.type === 'text') {
                    reviewOutput += block.text;
                  }
                }
              }
            }
          }
        );
      }

      const result = this.parseReviewOutput(reviewOutput);

      // Apply auto-approve logic
      if (options?.autoApprove && result.issues.length === 0) {
        result.approved = true;
      }

      // In strict mode, any issue means not approved
      if (options?.strict && result.issues.length > 0) {
        result.approved = false;
      }

      logger.info('PR review complete', {
        component: 'CodeReviewerService',
        owner,
        repo,
        prNumber,
        approved: result.approved,
        issueCount: result.issues.length,
      });

      return result;
    } catch (error) {
      logger.error('PR review failed', error, {
        component: 'CodeReviewerService',
        owner,
        repo,
        prNumber,
      });
      throw error;
    }
  }

  async submitReview(
    owner: string,
    repo: string,
    prNumber: number,
    result: ReviewResult
  ): Promise<void> {
    logger.info('Submitting PR review', {
      component: 'CodeReviewerService',
      owner,
      repo,
      prNumber,
      approved: result.approved,
    });

    const event = result.approved ? 'APPROVE' : 'REQUEST_CHANGES';
    const body = this.formatReviewBody(result);

    try {
      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event,
        body,
      });
    } catch (error) {
      // Can't request changes or approve on own PR - post as comment instead
      if (error instanceof Error && error.message.includes('own pull request')) {
        logger.info('Cannot submit formal review on own PR, posting as comment', {
          component: 'CodeReviewerService',
          prNumber,
        });

        await this.octokit.issues.createComment({
          owner,
          repo,
          issue_number: prNumber,
          body: `## 🤖 Automated Code Review\n\n${body}`,
        });
        return;
      }
      throw error;
    }

    // Add inline comments for each issue with file/line info
    for (const issue of result.issues) {
      if (issue.file && issue.line) {
        try {
          await this.octokit.pulls.createReviewComment({
            owner,
            repo,
            pull_number: prNumber,
            body: `**${issue.severity.toUpperCase()}**: ${issue.message}${issue.suggestion ? `\n\n💡 ${issue.suggestion}` : ''}`,
            commit_id: (await this.octokit.pulls.get({ owner, repo, pull_number: prNumber })).data.head.sha,
            path: issue.file,
            line: issue.line,
          });
        } catch {
          // Inline comment might fail if line is not in diff
          logger.warn('Failed to add inline comment', {
            component: 'CodeReviewerService',
            file: issue.file,
            line: issue.line,
          });
        }
      }
    }
  }

  private parseReviewOutput(output: string): ReviewResult {
    try {
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        return {
          approved: false,
          issues: [],
          summary: 'Failed to parse review output',
        };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        approved: Boolean(parsed.approved),
        summary: parsed.summary || '',
        issues: (parsed.issues || []).map((issue: ReviewIssue) => ({
          severity: issue.severity || 'info',
          file: issue.file,
          line: issue.line,
          message: issue.message || '',
          suggestion: issue.suggestion,
        })),
      };
    } catch (error) {
      logger.warn('Failed to parse review output', {
        component: 'CodeReviewerService',
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        approved: false,
        issues: [],
        summary: 'Failed to parse review output',
      };
    }
  }

  private formatReviewBody(result: ReviewResult): string {
    const lines: string[] = [];

    lines.push(result.approved ? '## Review Approved' : '## Changes Requested');
    lines.push('');
    lines.push(result.summary);
    lines.push('');

    if (result.issues.length > 0) {
      lines.push('### Issues Found');
      lines.push('');

      const errors = result.issues.filter((i: ReviewIssue) => i.severity === 'error');
      const warnings = result.issues.filter((i: ReviewIssue) => i.severity === 'warning');
      const infos = result.issues.filter((i: ReviewIssue) => i.severity === 'info');

      if (errors.length > 0) {
        lines.push(`**Errors (${errors.length})**: Must be fixed before merge`);
        for (const issue of errors) {
          lines.push(`- ${issue.file ? `\`${issue.file}:${issue.line}\`: ` : ''}${issue.message}`);
        }
        lines.push('');
      }

      if (warnings.length > 0) {
        lines.push(`**Warnings (${warnings.length})**: Should be addressed`);
        for (const issue of warnings) {
          lines.push(`- ${issue.file ? `\`${issue.file}:${issue.line}\`: ` : ''}${issue.message}`);
        }
        lines.push('');
      }

      if (infos.length > 0) {
        lines.push(`**Suggestions (${infos.length})**: Nice to have`);
        for (const issue of infos) {
          lines.push(`- ${issue.file ? `\`${issue.file}:${issue.line}\`: ` : ''}${issue.message}`);
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('*Review generated by auto-task*');

    return lines.join('\n');
  }
}
