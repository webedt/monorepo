/**
 * Auto-Task State Types
 */

export interface TaskState {
  id: string;
  issueNumber: number;
  issueNodeId: string;
  projectItemId?: string;
  title: string;
  status: 'backlog' | 'ready' | 'in_progress' | 'in_review' | 'done';
  priority: number;
  source: 'todo' | 'spec' | 'analysis';
  createdAt: string;
  updatedAt: string;
  sessionId?: string;
  prNumber?: number;
  errorCount: number;
  lastError?: string;
}

export interface ProjectCache {
  projectId: string;
  statusFieldId: string;
  statusOptions: Record<string, string>;
  cachedAt: string;
}

export interface AutoTaskState {
  version: number;
  tasks: TaskState[];
  projectCache?: ProjectCache;
  lastDiscoveryRun?: string;
  lastDaemonRun?: string;
  config: {
    owner: string;
    repo: string;
    projectNumber: number;
    maxBacklog: number;
    maxReady: number;
    maxInProgress: number;
  };
}

export const DEFAULT_STATE: AutoTaskState = {
  version: 1,
  tasks: [],
  config: {
    owner: '',
    repo: '',
    projectNumber: 1,
    maxBacklog: 10,
    maxReady: 3,
    maxInProgress: 3,
  },
};
