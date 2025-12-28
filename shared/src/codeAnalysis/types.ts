/**
 * Code Analysis Types
 *
 * Type definitions for the code analysis service that uses ClaudeWebClient.
 */

/**
 * Analysis type determines what kind of analysis is performed.
 */
export type AnalysisType =
  | 'quality'      // Code quality, maintainability, best practices
  | 'security'     // Security vulnerabilities, OWASP issues
  | 'performance'  // Performance bottlenecks, optimization opportunities
  | 'patterns'     // Design patterns, anti-patterns, architecture
  | 'complexity'   // Cyclomatic complexity, cognitive complexity
  | 'refactor'     // Refactoring suggestions, code smell detection
  | 'general';     // General code review and suggestions

/**
 * Severity level for analysis findings.
 */
export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/**
 * A single finding from the code analysis.
 */
export interface AnalysisFinding {
  severity: FindingSeverity;
  category: string;
  title: string;
  description: string;
  file?: string;
  line?: number;
  endLine?: number;
  suggestion?: string;
  codeSnippet?: string;
}

/**
 * Summary statistics for the analysis.
 */
export interface AnalysisSummary {
  totalFindings: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  infoCount: number;
  overallScore?: number; // 0-100 score if applicable
}

/**
 * Parameters for analyzing code.
 */
export interface CodeAnalysisParams {
  /**
   * The code content to analyze.
   * Either `code` or `gitUrl` must be provided.
   */
  code?: string;

  /**
   * Git repository URL to analyze.
   * Either `code` or `gitUrl` must be provided.
   */
  gitUrl?: string;

  /**
   * File path(s) within the repo to analyze.
   * If not provided, analyzes the entire codebase.
   */
  filePaths?: string[];

  /**
   * Type of analysis to perform.
   * @default 'general'
   */
  analysisType?: AnalysisType;

  /**
   * Programming language hint for better analysis.
   * Auto-detected if not provided.
   */
  language?: string;

  /**
   * Additional context about the codebase (e.g., framework used, purpose).
   */
  context?: string;

  /**
   * Maximum number of findings to return.
   * @default 20
   */
  maxFindings?: number;

  /**
   * Custom prompt to append to the analysis request.
   */
  customPrompt?: string;
}

/**
 * Result of the code analysis.
 */
export interface CodeAnalysisResult {
  /**
   * Whether the analysis completed successfully.
   */
  success: boolean;

  /**
   * List of findings from the analysis.
   */
  findings: AnalysisFinding[];

  /**
   * Summary statistics.
   */
  summary: AnalysisSummary;

  /**
   * Overall assessment and recommendations.
   */
  assessment: string;

  /**
   * Provider used for the analysis.
   */
  provider: 'claude-web';

  /**
   * Session ID from the Claude Web session.
   */
  sessionId?: string;

  /**
   * Duration of the analysis in milliseconds.
   */
  durationMs: number;

  /**
   * Cost of the analysis in USD (if available).
   */
  cost?: number;

  /**
   * Error message if the analysis failed.
   */
  error?: string;
}

/**
 * Configuration for the CodeAnalyzer service.
 */
export interface CodeAnalyzerConfig {
  /**
   * Claude access token for authentication.
   * If not provided, will attempt to use stored credentials.
   */
  accessToken?: string;

  /**
   * Claude environment ID.
   * If not provided, uses CLAUDE_ENVIRONMENT_ID env var.
   */
  environmentId?: string;

  /**
   * Fallback repository URL for code-only analysis.
   * @default LLM_FALLBACK_REPO_URL
   */
  fallbackRepoUrl?: string;

  /**
   * Default timeout for analysis in milliseconds.
   * @default 120000 (2 minutes)
   */
  timeoutMs?: number;

  /**
   * Polling interval in milliseconds for checking analysis completion.
   * @default 2000 (2 seconds)
   */
  pollIntervalMs?: number;

  /**
   * Maximum code size in bytes to analyze.
   * Prevents memory issues with very large code strings.
   * @default 1048576 (1MB)
   */
  maxCodeSizeBytes?: number;
}

/**
 * Issue severity for code review findings.
 */
export type ReviewIssueSeverity = 'error' | 'warning' | 'info';

/**
 * A single issue found during code review.
 */
export interface ReviewIssue {
  severity: ReviewIssueSeverity;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

/**
 * Options for code review.
 */
export interface ReviewOptions {
  focusAreas?: string[];
  strict?: boolean;
  autoApprove?: boolean;
}

/**
 * Result of a code review.
 */
export interface ReviewResult {
  approved: boolean;
  issues: ReviewIssue[];
  summary: string;
}
