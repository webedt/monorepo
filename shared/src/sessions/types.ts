/**
 * Session types
 */

import type { ClaudeAuth } from '../auth/claudeAuth.js';
import type { ContentBlock, ExecutionEvent } from '../execution/providers/types.js';

export type SessionStatus = 'pending' | 'running' | 'completed' | 'error';

export interface SessionExecuteParams {
  userId: string;
  prompt: string | ContentBlock[];
  gitUrl: string;
  claudeAuth: ClaudeAuth;
  environmentId: string;
  model?: string;
}

export interface SessionResumeParams {
  prompt: string | ContentBlock[];
  claudeAuth: ClaudeAuth;
  environmentId: string;
}

export interface SessionSyncParams {
  claudeAuth: ClaudeAuth;
  environmentId?: string;
}

export interface SessionResult {
  status: 'completed' | 'failed' | 'interrupted';
  branch?: string;
  totalCost?: number;
  durationMs?: number;
  remoteSessionId?: string;
  remoteWebUrl?: string;
}

export interface SessionInfo {
  id: string;
  userId: string;
  status: SessionStatus;
  userRequest?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  remoteSessionId?: string;
  remoteWebUrl?: string;
  totalCost?: string;
  createdAt?: Date;
  completedAt?: Date;
}

export type SessionEventCallback = (event: ExecutionEvent) => void | Promise<void>;
