import { Octokit } from '@octokit/rest';

import { logger } from '../utils/logging/logger.js';
import { ensureValidToken } from '../auth/claudeAuth.js';
import { ServiceProvider } from '../services/registry.js';
import { AClaudeWebClient } from '../claudeWeb/AClaudeWebClient.js';
import { CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL } from '../config/index.js';
import { withGitHubResilience, withClaudeRemoteResilience } from '../utils/resilience/externalApiResilience.js';

import { ASessionCleanupService } from './ASessionCleanupService.js';

import type { CleanupResult } from './ASessionCleanupService.js';
import type { ClaudeAuth } from '../auth/claudeAuth.js';

export class SessionCleanupService extends ASessionCleanupService {
  async deleteGitHubBranch(
    githubAccessToken: string,
    owner: string,
    repo: string,
    branch: string
  ): Promise<CleanupResult> {
    try {
      const octokit = new Octokit({ auth: githubAccessToken });
      await withGitHubResilience(
        () => octokit.git.deleteRef({
          owner,
          repo,
          ref: `heads/${branch}`,
        }),
        'deleteRef'
      );
      logger.info(`Deleted GitHub branch ${owner}/${repo}/${branch}`, {
        component: 'SessionCleanupService',
      });
      return { success: true, message: 'Branch deleted' };
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      if (err.status === 422 || err.status === 404) {
        logger.info(`GitHub branch ${owner}/${repo}/${branch} not found (already deleted)`, {
          component: 'SessionCleanupService',
        });
        return { success: true, message: 'Branch already deleted or does not exist' };
      }
      if (err.message?.includes('circuit breaker')) {
        logger.warn(`GitHub API unavailable for deleting branch ${owner}/${repo}/${branch}`, {
          component: 'SessionCleanupService',
        });
        return { success: false, message: 'GitHub API temporarily unavailable' };
      }
      logger.error(`Failed to delete GitHub branch ${owner}/${repo}/${branch}`, error as Error, {
        component: 'SessionCleanupService',
      });
      return { success: false, message: 'Failed to delete branch' };
    }
  }

  async archiveClaudeRemoteSession(
    remoteSessionId: string,
    claudeAuth: ClaudeAuth,
    environmentId?: string
  ): Promise<CleanupResult> {
    logger.info('Archiving Claude Remote session', {
      component: 'SessionCleanupService',
      remoteSessionId,
      hasAccessToken: !!claudeAuth.accessToken,
      hasRefreshToken: !!claudeAuth.refreshToken,
      environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
    });

    try {
      const refreshedAuth = await ensureValidToken(claudeAuth);

      const client = ServiceProvider.get(AClaudeWebClient);
      client.configure({
        accessToken: refreshedAuth.accessToken,
        environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
        baseUrl: CLAUDE_API_BASE_URL,
      });

      await withClaudeRemoteResilience(
        () => client.archiveSession(remoteSessionId),
        'archiveSession'
      );
      logger.info(`Successfully archived Claude Remote session ${remoteSessionId}`, {
        component: 'SessionCleanupService',
      });
      return { success: true, message: 'Remote session archived' };
    } catch (error: unknown) {
      const err = error as { status?: number; message?: string };
      logger.error('archiveClaudeRemoteSession error', error as Error, {
        component: 'SessionCleanupService',
        remoteSessionId,
        errorStatus: err.status,
        errorMessage: err.message,
      });
      if (err.status === 404) {
        logger.info(`Claude Remote session ${remoteSessionId} not found (already archived)`, {
          component: 'SessionCleanupService',
        });
        return { success: true, message: 'Remote session already archived or does not exist' };
      }
      if (err.message?.includes('circuit breaker')) {
        logger.warn(`Claude Remote API unavailable for archiving session ${remoteSessionId}`, {
          component: 'SessionCleanupService',
        });
        return { success: false, message: 'Claude Remote API temporarily unavailable' };
      }
      return { success: false, message: `Failed to archive remote session: ${err.message || 'Unknown error'}` };
    }
  }

  async cleanupSession(params: {
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
  }> {
    const results: {
      branchResult?: CleanupResult;
      archiveResult?: CleanupResult;
    } = {};

    if (params.githubAccessToken && params.owner && params.repo && params.branch) {
      results.branchResult = await this.deleteGitHubBranch(
        params.githubAccessToken,
        params.owner,
        params.repo,
        params.branch
      );
    }

    if (params.remoteSessionId && params.claudeAuth) {
      results.archiveResult = await this.archiveClaudeRemoteSession(
        params.remoteSessionId,
        params.claudeAuth,
        params.environmentId
      );
    }

    return results;
  }
}

export const sessionCleanupService = new SessionCleanupService();
