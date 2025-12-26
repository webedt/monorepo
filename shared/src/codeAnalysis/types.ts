/**
 * Code Analysis Service Types
 */

export type AnalysisCategory = 'bug' | 'improvement' | 'tech-debt' | 'security';
export type AnalysisSeverity = 'critical' | 'high' | 'medium' | 'low';
export type AnalysisFocus = 'bugs' | 'improvements' | 'tech-debt' | 'security' | 'all';

export interface AnalysisResult {
  category: AnalysisCategory;
  severity: AnalysisSeverity;
  file?: string;
  line?: number;
  description: string;
  suggestedFix?: string;
}

export interface AnalysisOptions {
  focus?: AnalysisFocus;
  maxItems?: number;
  includePatterns?: string[];
  excludePatterns?: string[];
}

export interface ReviewIssue {
  severity: 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

export interface ReviewResult {
  approved: boolean;
  issues: ReviewIssue[];
  summary: string;
}

export interface ReviewOptions {
  strict?: boolean;
  autoApprove?: boolean;
  focusAreas?: string[];
}
