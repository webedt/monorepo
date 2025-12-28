/**
 * Code Analysis Module
 *
 * Provides AI-powered code analysis using ClaudeWebClient.
 */

// Abstract class
export { ACodeAnalyzer } from './ACodeAnalyzer.js';

// Implementation
export { CodeAnalyzer } from './codeAnalyzer.js';

// Code Reviewer
export { CodeReviewerService } from './codeReviewer.js';

// Types
export type {
  AnalysisType,
  FindingSeverity,
  AnalysisFinding,
  AnalysisSummary,
  CodeAnalysisParams,
  CodeAnalysisResult,
  CodeAnalyzerConfig,
  ReviewIssue,
  ReviewIssueSeverity,
  ReviewOptions,
  ReviewResult,
} from './types.js';
