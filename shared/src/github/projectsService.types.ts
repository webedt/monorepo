/**
 * GitHub Projects v2 Service Types
 */

export interface Project {
  id: string;
  number: number;
  title: string;
  url: string;
  fields: ProjectField[];
}

export interface ProjectField {
  id: string;
  name: string;
  dataType: 'SINGLE_SELECT' | 'TEXT' | 'NUMBER' | 'DATE' | 'ITERATION';
  options?: ProjectFieldOption[];
}

export interface ProjectFieldOption {
  id: string;
  name: string;
}

export interface StatusField {
  fieldId: string;
  options: ProjectFieldOption[];
}

export interface ProjectItem {
  id: string;
  contentId: string;
  contentType: 'Issue' | 'PullRequest' | 'DraftIssue';
  title: string;
  status?: string;
  statusOptionId?: string;
  /** Issue/PR number (for Issues and PRs) */
  number?: number;
  /** Issue/PR state (OPEN, CLOSED, MERGED) */
  state?: string;
  /** Issue/PR body */
  body?: string;
  /** Labels on the issue/PR */
  labels?: string[];
}

export interface AddItemResult {
  itemId: string;
}
