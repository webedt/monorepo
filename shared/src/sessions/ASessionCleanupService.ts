import { AService } from '../services/abstracts/AService.js';

import type { ClaudeAuth } from '../auth/claudeAuth.js';

export interface CleanupResult {
  success: boolean;
  message: string;
}

export abstract class ASessionCleanupService extends AService {
  readonly order = 10;

  abstract deleteGitHubBranch(
    githubAccessToken: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<CleanupResult>;

  abstract archiveClaudeRemoteSession(
    remoteSessionId: string,
    claudeAuth: ClaudeAuth,
    environmentId?: string
  ): Promise<CleanupResult>;

  abstract cleanupSession(params: {
    githubAccessToken?: string;
    owner?: string;
    repo?: string;
    branch?: string;
    remoteSessionId?: string;
    claudeAuth?: ClaudeAuth;
    environmentId?: string;
  }): Promise<{
    branchResult?: CleanupResult;
    archiveResult?: CleanupResult;
  }>;
}
