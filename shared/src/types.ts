/**
 * Shared types for WebEDT monorepo
 */

/**
 * Session metadata for tracking execution state across services
 * Used by ai-coding-worker and internal-api-server for session orchestration
 */
export interface SessionMetadata {
  sessionId: string;
  sessionPath?: string;
  sessionTitle?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  branch?: string;
  providerSessionId?: string;
  provider?: string;
  createdAt: string;
  updatedAt?: string;
  lastModified?: string;
  github?: {
    repoUrl: string;
    baseBranch: string;
    clonedPath?: string;
  };
}

/**
 * Storage-level session info from MinIO
 * Used by storage services for file metadata
 */
export interface StorageSessionInfo {
  sessionPath: string;
  createdAt: string;
  lastModified: string;
  size?: number;
  [key: string]: unknown;
}

/**
 * AI Provider type
 */
export type AIProvider = 'claude' | 'codex';
