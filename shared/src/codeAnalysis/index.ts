/**
 * Code Analysis Module
 *
 * Provides AI-powered code analysis using ClaudeWebClient.
 */

// Abstract class
export { ACodeAnalyzer } from './ACodeAnalyzer.js';

// Implementation
export { CodeAnalyzer } from './codeAnalyzer.js';

// Types
export type {
  AnalysisType,
  FindingSeverity,
  AnalysisFinding,
  AnalysisSummary,
  CodeAnalysisParams,
  CodeAnalysisResult,
  CodeAnalyzerConfig,
} from './types.js';
