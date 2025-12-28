/**
 * Code Reviewer Service
 *
 * AI-powered code review service for GitHub Pull Requests.
 * Fetches PR diff, analyzes code changes, and posts review comments.
 */

import { GitHubClient, type ServiceHealth } from './client.js';
import { logger } from '../utils/logger.js';
import {
  GitHubError,
  ErrorCode,
  createGitHubErrorFromResponse,
} from '../utils/errors.js';

/**
 * File change in a pull request
 */
export interface PRFileChange {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
  blobUrl: string;
  rawUrl: string;
  contentsUrl: string;
}

/**
 * Pull request diff information
 */
export interface PRDiff {
  prNumber: number;
  title: string;
  body: string | null;
  baseSha: string;
  headSha: string;
  files: PRFileChange[];
  totalAdditions: number;
  totalDeletions: number;
  totalChangedFiles: number;
  diffUrl: string;
  patchUrl: string;
}

/**
 * Review comment to post on a PR
 */
export interface ReviewComment {
  /** File path relative to repository root */
  path: string;
  /** Line number in the diff (position, not line number in file) */
  position?: number;
  /** Line number in the new version of the file */
  line?: number;
  /** The side of the diff: LEFT for deletions, RIGHT for additions */
  side?: 'LEFT' | 'RIGHT';
  /** Start line for multi-line comments */
  startLine?: number;
  /** Start side for multi-line comments */
  startSide?: 'LEFT' | 'RIGHT';
  /** The comment body */
  body: string;
}

/**
 * Review submission result
 */
export interface ReviewResult {
  reviewId: number;
  htmlUrl: string;
  state: 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED';
  body: string | null;
  submittedAt: string | null;
  commentCount: number;
}

/**
 * Code review finding from AI analysis
 */
export interface CodeReviewFinding {
  severity: 'error' | 'warning' | 'suggestion' | 'info';
  category: 'security' | 'bug' | 'performance' | 'style' | 'maintainability' | 'documentation';
  file: string;
  line?: number;
  endLine?: number;
  message: string;
  suggestion?: string;
}

/**
 * Complete code review result
 */
export interface CodeReviewResult {
  prNumber: number;
  summary: string;
  findings: CodeReviewFinding[];
  overallAssessment: 'approve' | 'request_changes' | 'comment';
  reviewResult?: ReviewResult;
  error?: string;
}

/**
 * Options for running a code review
 */
export interface CodeReviewOptions {
  /** Focus on specific file patterns (glob) */
  includePatterns?: string[];
  /** Exclude specific file patterns (glob) */
  excludePatterns?: string[];
  /** Maximum files to review (to control token usage) */
  maxFiles?: number;
  /** Maximum lines per file to review */
  maxLinesPerFile?: number;
  /** Whether to post the review to GitHub */
  postReview?: boolean;
  /** Review event type when posting */
  reviewEvent?: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  /** Custom review instructions for the AI */
  customInstructions?: string;
  /** Whether to include inline comments */
  includeInlineComments?: boolean;
}

/**
 * Result type for operations that support graceful degradation
 */
export interface DegradedResult<T> {
  value: T;
  degraded: boolean;
}

/**
 * Code reviewer manager interface
 */
export interface CodeReviewerManager {
  /** Get the diff and changed files for a PR */
  getPRDiff(prNumber: number): Promise<PRDiff>;
  /** Get PR diff with fallback for graceful degradation */
  getPRDiffWithFallback(prNumber: number): Promise<DegradedResult<PRDiff | null>>;
  /** Get the raw patch/diff content for a PR */
  getRawDiff(prNumber: number): Promise<string>;
  /** Post a review on a PR */
  submitReview(
    prNumber: number,
    body: string,
    event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
    comments?: ReviewComment[]
  ): Promise<ReviewResult>;
  /** Create a review comment on a specific line */
  createReviewComment(prNumber: number, comment: ReviewComment, commitId: string): Promise<void>;
  /** Run an AI-powered code review on a PR */
  reviewPR(prNumber: number, options?: CodeReviewOptions): Promise<CodeReviewResult>;
  /** Get service health status */
  getServiceHealth(): ServiceHealth;
  /** Check if the service is available */
  isAvailable(): boolean;
}

/**
 * Default exclude patterns for code review
 */
const DEFAULT_EXCLUDE_PATTERNS = [
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.min.js',
  '*.min.css',
  '*.map',
  'dist/**',
  'build/**',
  'node_modules/**',
  '.git/**',
];

/**
 * Create a code reviewer manager instance
 */
export function createCodeReviewerManager(client: GitHubClient): CodeReviewerManager {
  const octokit = client.client;
  const { owner, repo } = client;
  const log = logger.child('CodeReviewerManager');

  /**
   * Handle and transform errors
   */
  const handleError = (error: any, operation: string, context?: Record<string, unknown>): never => {
    const structuredError = createGitHubErrorFromResponse(error, operation, {
      owner,
      repo,
      ...context,
    });
    log.error(`Failed to ${operation}`, { error: structuredError.message, ...context });
    throw structuredError;
  };

  /**
   * Check if a filename matches any of the patterns
   */
  const matchesPattern = (filename: string, patterns: string[]): boolean => {
    return patterns.some(pattern => {
      // Simple glob matching
      if (pattern.includes('**')) {
        const parts = pattern.split('**');
        if (parts.length === 2) {
          const [prefix, suffix] = parts;
          if (prefix && !filename.startsWith(prefix.replace(/\/$/, ''))) return false;
          if (suffix && !filename.endsWith(suffix.replace(/^\//, ''))) return false;
          return true;
        }
      }
      if (pattern.includes('*')) {
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
        return regex.test(filename);
      }
      return filename === pattern || filename.endsWith('/' + pattern);
    });
  };

  /**
   * Generate a summary of code review findings
   */
  const generateReviewSummary = (findings: CodeReviewFinding[]): string => {
    const counts = {
      error: findings.filter(f => f.severity === 'error').length,
      warning: findings.filter(f => f.severity === 'warning').length,
      suggestion: findings.filter(f => f.severity === 'suggestion').length,
      info: findings.filter(f => f.severity === 'info').length,
    };

    const parts: string[] = ['## Code Review Summary\n'];

    if (findings.length === 0) {
      parts.push('No issues found. Code looks good! ');
    } else {
      parts.push(`Found ${findings.length} issue(s):\n`);
      if (counts.error > 0) parts.push(`- **Errors:** ${counts.error}`);
      if (counts.warning > 0) parts.push(`- **Warnings:** ${counts.warning}`);
      if (counts.suggestion > 0) parts.push(`- **Suggestions:** ${counts.suggestion}`);
      if (counts.info > 0) parts.push(`- **Info:** ${counts.info}`);
    }

    return parts.join('\n');
  };

  /**
   * Convert findings to review comments
   */
  const findingsToComments = (findings: CodeReviewFinding[]): ReviewComment[] => {
    return findings
      .filter(f => f.line !== undefined)
      .map(f => ({
        path: f.file,
        line: f.line,
        side: 'RIGHT' as const,
        startLine: f.endLine !== undefined && f.endLine !== f.line ? f.line : undefined,
        body: formatFindingComment(f),
      }));
  };

  /**
   * Format a finding as a comment
   */
  const formatFindingComment = (finding: CodeReviewFinding): string => {
    const severityEmoji = {
      error: '',
      warning: '⚠️',
      suggestion: '',
      info: 'ℹ️',
    };

    const categoryLabel = finding.category.charAt(0).toUpperCase() + finding.category.slice(1);

    let comment = `${severityEmoji[finding.severity]} **${categoryLabel}** (${finding.severity})\n\n${finding.message}`;

    if (finding.suggestion) {
      comment += `\n\n**Suggestion:**\n\`\`\`\n${finding.suggestion}\n\`\`\``;
    }

    return comment;
  };

  /**
   * Perform basic static analysis on the diff
   * This is a placeholder for AI integration - currently does pattern-based analysis
   */
  const analyzeCode = async (diff: PRDiff, options: CodeReviewOptions = {}): Promise<CodeReviewFinding[]> => {
    const findings: CodeReviewFinding[] = [];
    const excludePatterns = [...DEFAULT_EXCLUDE_PATTERNS, ...(options.excludePatterns || [])];
    const includePatterns = options.includePatterns || [];

    let filesProcessed = 0;
    const maxFiles = options.maxFiles || 50;

    for (const file of diff.files) {
      // Skip excluded files
      if (matchesPattern(file.filename, excludePatterns)) {
        continue;
      }

      // If include patterns specified, only include matching files
      if (includePatterns.length > 0 && !matchesPattern(file.filename, includePatterns)) {
        continue;
      }

      // Respect max files limit
      if (filesProcessed >= maxFiles) {
        log.debug('Reached max files limit for review', { maxFiles, totalFiles: diff.files.length });
        break;
      }
      filesProcessed++;

      // Analyze the patch if available
      if (file.patch) {
        const lines = file.patch.split('\n');
        let lineNumber = 0;

        for (const line of lines) {
          lineNumber++;
          const trimmedLine = line.slice(1).trim(); // Remove diff prefix (+/-)

          // Skip unchanged lines or diff headers
          if (!line.startsWith('+') || line.startsWith('+++')) continue;

          // Check for common issues (pattern-based analysis)

          // Console.log in production code
          if (trimmedLine.includes('console.log') || trimmedLine.includes('console.debug')) {
            findings.push({
              severity: 'warning',
              category: 'maintainability',
              file: file.filename,
              line: lineNumber,
              message: 'Debug logging statement detected. Consider removing before production.',
            });
          }

          // TODO comments
          if (trimmedLine.toUpperCase().includes('TODO') || trimmedLine.toUpperCase().includes('FIXME')) {
            findings.push({
              severity: 'info',
              category: 'documentation',
              file: file.filename,
              line: lineNumber,
              message: 'TODO/FIXME comment detected. Ensure this is tracked appropriately.',
            });
          }

          // Hardcoded credentials patterns
          const credentialPatterns = [
            /password\s*=\s*['"][^'"]+['"]/i,
            /api[_-]?key\s*=\s*['"][^'"]+['"]/i,
            /secret\s*=\s*['"][^'"]+['"]/i,
            /token\s*=\s*['"][a-zA-Z0-9]{20,}['"]/i,
          ];

          for (const pattern of credentialPatterns) {
            if (pattern.test(trimmedLine)) {
              findings.push({
                severity: 'error',
                category: 'security',
                file: file.filename,
                line: lineNumber,
                message: 'Potential hardcoded credential detected. Use environment variables instead.',
              });
              break;
            }
          }

          // SQL injection patterns (very basic)
          if (/\$\{.*\}.*(?:SELECT|INSERT|UPDATE|DELETE|DROP)/i.test(trimmedLine)) {
            findings.push({
              severity: 'error',
              category: 'security',
              file: file.filename,
              line: lineNumber,
              message: 'Potential SQL injection vulnerability. Use parameterized queries.',
            });
          }

          // Large magic numbers
          if (/(?<!\.)\b\d{4,}\b/.test(trimmedLine) && !/^\s*\/\//.test(trimmedLine)) {
            if (!/(?:port|year|timestamp|date|version)/i.test(trimmedLine)) {
              findings.push({
                severity: 'suggestion',
                category: 'maintainability',
                file: file.filename,
                line: lineNumber,
                message: 'Magic number detected. Consider extracting to a named constant.',
              });
            }
          }

          // Very long lines
          if (trimmedLine.length > 150) {
            findings.push({
              severity: 'suggestion',
              category: 'style',
              file: file.filename,
              line: lineNumber,
              message: 'Line exceeds 150 characters. Consider breaking it up for readability.',
            });
          }

          // Empty catch blocks
          if (/catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmedLine)) {
            findings.push({
              severity: 'warning',
              category: 'bug',
              file: file.filename,
              line: lineNumber,
              message: 'Empty catch block swallows errors. Consider logging or handling the error.',
            });
          }

          // @ts-ignore without explanation
          if (/@ts-ignore\s*$/.test(trimmedLine) || /@ts-nocheck/.test(trimmedLine)) {
            findings.push({
              severity: 'warning',
              category: 'maintainability',
              file: file.filename,
              line: lineNumber,
              message: 'TypeScript suppression without explanation. Add a comment explaining why.',
            });
          }
        }
      }

      // Check for large file additions
      if (file.status === 'added' && file.additions > 500) {
        findings.push({
          severity: 'suggestion',
          category: 'maintainability',
          file: file.filename,
          message: `Large file added (${file.additions} lines). Consider breaking into smaller modules.`,
        });
      }
    }

    // Sort findings by severity
    const severityOrder = { error: 0, warning: 1, suggestion: 2, info: 3 };
    findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

    return findings;
  };

  return {
    getServiceHealth(): ServiceHealth {
      return client.getServiceHealth();
    },

    isAvailable(): boolean {
      return client.isAvailable();
    },

    async getPRDiff(prNumber: number): Promise<PRDiff> {
      try {
        return await client.execute(
          async () => {
            // Get PR details
            const { data: pr } = await octokit.pulls.get({
              owner,
              repo,
              pull_number: prNumber,
            });

            // Get changed files
            const { data: files } = await octokit.pulls.listFiles({
              owner,
              repo,
              pull_number: prNumber,
              per_page: 300, // Get up to 300 files
            });

            const prFiles: PRFileChange[] = files.map(file => ({
              filename: file.filename,
              status: file.status as PRFileChange['status'],
              additions: file.additions,
              deletions: file.deletions,
              changes: file.changes,
              patch: file.patch,
              previousFilename: file.previous_filename,
              blobUrl: file.blob_url,
              rawUrl: file.raw_url,
              contentsUrl: file.contents_url,
            }));

            const totalAdditions = prFiles.reduce((sum, f) => sum + f.additions, 0);
            const totalDeletions = prFiles.reduce((sum, f) => sum + f.deletions, 0);

            log.debug(`Fetched PR #${prNumber} diff`, {
              files: prFiles.length,
              additions: totalAdditions,
              deletions: totalDeletions,
            });

            return {
              prNumber,
              title: pr.title,
              body: pr.body,
              baseSha: pr.base.sha,
              headSha: pr.head.sha,
              files: prFiles,
              totalAdditions,
              totalDeletions,
              totalChangedFiles: prFiles.length,
              diffUrl: pr.diff_url,
              patchUrl: pr.patch_url,
            };
          },
          `GET /repos/${owner}/${repo}/pulls/${prNumber}`,
          { operation: 'getPRDiff', prNumber }
        );
      } catch (error) {
        return handleError(error, 'get PR diff', { prNumber });
      }
    },

    async getPRDiffWithFallback(prNumber: number): Promise<DegradedResult<PRDiff | null>> {
      const result = await client.executeWithFallback(
        async () => this.getPRDiff(prNumber),
        null,
        `GET /repos/${owner}/${repo}/pulls/${prNumber}`,
        { operation: 'getPRDiff', prNumber }
      );

      if (result.degraded) {
        log.warn('PR diff fetch degraded - using fallback', { prNumber });
      }

      return result;
    },

    async getRawDiff(prNumber: number): Promise<string> {
      try {
        return await client.execute(
          async () => {
            const { data } = await octokit.pulls.get({
              owner,
              repo,
              pull_number: prNumber,
              mediaType: {
                format: 'diff',
              },
            });

            return data as unknown as string;
          },
          `GET /repos/${owner}/${repo}/pulls/${prNumber} (diff)`,
          { operation: 'getRawDiff', prNumber }
        );
      } catch (error) {
        return handleError(error, 'get raw diff', { prNumber });
      }
    },

    async submitReview(
      prNumber: number,
      body: string,
      event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT',
      comments: ReviewComment[] = []
    ): Promise<ReviewResult> {
      try {
        return await client.execute(
          async () => {
            // Convert comments to API format
            const apiComments = comments.map(c => ({
              path: c.path,
              position: c.position,
              line: c.line,
              side: c.side,
              start_line: c.startLine,
              start_side: c.startSide,
              body: c.body,
            }));

            const { data: review } = await octokit.pulls.createReview({
              owner,
              repo,
              pull_number: prNumber,
              body,
              event,
              comments: apiComments.length > 0 ? apiComments : undefined,
            });

            log.info(`Submitted review on PR #${prNumber}`, {
              event,
              reviewId: review.id,
              commentCount: comments.length,
            });

            return {
              reviewId: review.id,
              htmlUrl: review.html_url,
              state: review.state as ReviewResult['state'],
              body: review.body,
              submittedAt: review.submitted_at ?? null,
              commentCount: comments.length,
            };
          },
          `POST /repos/${owner}/${repo}/pulls/${prNumber}/reviews`,
          { operation: 'submitReview', prNumber, event }
        );
      } catch (error) {
        return handleError(error, 'submit review', { prNumber, event });
      }
    },

    async createReviewComment(prNumber: number, comment: ReviewComment, commitId: string): Promise<void> {
      try {
        await client.execute(
          async () => {
            await octokit.pulls.createReviewComment({
              owner,
              repo,
              pull_number: prNumber,
              body: comment.body,
              commit_id: commitId,
              path: comment.path,
              line: comment.line,
              side: comment.side,
              start_line: comment.startLine,
              start_side: comment.startSide,
            });

            log.debug(`Created review comment on PR #${prNumber}`, {
              file: comment.path,
              line: comment.line,
            });
          },
          `POST /repos/${owner}/${repo}/pulls/${prNumber}/comments`,
          { operation: 'createReviewComment', prNumber, path: comment.path }
        );
      } catch (error) {
        handleError(error, 'create review comment', { prNumber, path: comment.path });
      }
    },

    async reviewPR(prNumber: number, options: CodeReviewOptions = {}): Promise<CodeReviewResult> {
      log.info(`Starting code review for PR #${prNumber}`, {
        options: {
          includePatterns: options.includePatterns,
          excludePatterns: options.excludePatterns,
          maxFiles: options.maxFiles,
          postReview: options.postReview,
        },
      });

      try {
        // Fetch the PR diff
        const diff = await this.getPRDiff(prNumber);

        log.info(`Analyzing PR #${prNumber}`, {
          files: diff.totalChangedFiles,
          additions: diff.totalAdditions,
          deletions: diff.totalDeletions,
        });

        // Analyze the code
        const findings = await analyzeCode(diff, options);

        // Determine overall assessment
        let overallAssessment: CodeReviewResult['overallAssessment'] = 'comment';
        const hasErrors = findings.some(f => f.severity === 'error');
        const hasWarnings = findings.some(f => f.severity === 'warning');

        if (hasErrors) {
          overallAssessment = 'request_changes';
        } else if (!hasErrors && !hasWarnings && findings.length === 0) {
          overallAssessment = 'approve';
        }

        // Generate summary
        const summary = generateReviewSummary(findings);

        log.info(`Code review completed for PR #${prNumber}`, {
          findings: findings.length,
          assessment: overallAssessment,
          errors: findings.filter(f => f.severity === 'error').length,
          warnings: findings.filter(f => f.severity === 'warning').length,
        });

        const result: CodeReviewResult = {
          prNumber,
          summary,
          findings,
          overallAssessment,
        };

        // Post the review if requested
        if (options.postReview !== false) {
          try {
            const event = options.reviewEvent || (
              overallAssessment === 'approve' ? 'APPROVE' :
              overallAssessment === 'request_changes' ? 'REQUEST_CHANGES' :
              'COMMENT'
            );

            // Prepare inline comments if enabled
            const inlineComments = options.includeInlineComments !== false
              ? findingsToComments(findings)
              : [];

            // Build the review body
            let reviewBody = summary;
            if (options.customInstructions) {
              reviewBody += `\n\n---\n*${options.customInstructions}*`;
            }

            // Add findings details if not posting inline comments
            if (inlineComments.length === 0 && findings.length > 0) {
              reviewBody += '\n\n### Findings\n\n';
              for (const finding of findings) {
                reviewBody += `- **${finding.file}**`;
                if (finding.line) reviewBody += `:${finding.line}`;
                reviewBody += ` - ${formatFindingComment(finding)}\n`;
              }
            }

            reviewBody += '\n\n---\n*Automated code review by CodeReviewerService*';

            const reviewResult = await this.submitReview(
              prNumber,
              reviewBody,
              event,
              inlineComments
            );

            result.reviewResult = reviewResult;
            log.info(`Posted review on PR #${prNumber}`, {
              reviewId: reviewResult.reviewId,
              event,
              inlineComments: inlineComments.length,
            });
          } catch (reviewError) {
            log.error(`Failed to post review on PR #${prNumber}`, {
              error: (reviewError as Error).message,
            });
            result.error = `Failed to post review: ${(reviewError as Error).message}`;
          }
        }

        return result;
      } catch (error) {
        log.error(`Code review failed for PR #${prNumber}`, {
          error: (error as Error).message,
        });
        return {
          prNumber,
          summary: 'Code review failed',
          findings: [],
          overallAssessment: 'comment',
          error: (error as Error).message,
        };
      }
    },
  };
}
