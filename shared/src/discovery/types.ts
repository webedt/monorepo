/**
 * Discovery Service Types
 */

export type TaskPriority = 'critical' | 'high' | 'medium' | 'low';

export type DiscoveredTaskType = 'todo' | 'fixme' | 'hack' | 'spec' | 'analysis';

export interface DiscoveredTask {
  type: DiscoveredTaskType;
  file: string;
  line: number;
  text: string;
  priority?: TaskPriority;
  category?: 'bug' | 'feature' | 'improvement' | 'tech-debt' | 'security';
}

export interface TodoScanOptions {
  include?: string[];
  exclude?: string[];
  patterns?: string[];
}

export interface SpecTask {
  feature: string;
  description: string;
  section: string;
  implemented: boolean;
}

export interface SpecParseResult {
  tasks: SpecTask[];
  sections: string[];
}
