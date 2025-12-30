/**
 * GitHub Pull Request Routes
 * Handles pull request operations: list, create, merge, generate content, auto-pr
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { db, chatSessions, eq, and, isNull, logger, withGitHubResilience, GitHubOperations, sessionSoftDeleteService } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { archiveClaudeRemoteSession } from './helpers.js';

const router = Router();

// Initialize services for Auto PR
const githubOperations = new GitHubOperations();

/**
 * @openapi
 * /github/repos/{owner}/{repo}/pulls:
 *   get:
 *     tags:
 *       - GitHub
 *     summary: List pull requests
 *     description: Returns pull requests for the specified repository with optional filtering.
 *     parameters:
 *       - name: owner
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: repo
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: head
 *         in: query
 *         description: Filter by head branch
 *         schema:
 *           type: string
 *       - name: base
 *         in: query
 *         description: Filter by base branch
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Pull requests retrieved successfully
 *       400:
 *         description: GitHub not connected
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:owner/:repo/pulls', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const { head, base } = req.query;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: pulls } = await withGitHubResilience(
      () => octokit.pulls.list({
        owner,
        repo,
        head: head ? `${owner}:${head}` : undefined,
        base: base as string | undefined,
        state: 'all',
        per_page: 10,
      }),
      'listPulls'
    );

    const formattedPulls = pulls.map((pr) => ({
      number: pr.number,
      title: pr.title,
      state: pr.state,
      htmlUrl: pr.html_url,
      head: {
        ref: pr.head.ref,
        sha: pr.head.sha,
      },
      base: {
        ref: pr.base.ref,
        sha: pr.base.sha,
      },
      mergeable: (pr as Record<string, unknown>).mergeable ?? null,
      merged: (pr as Record<string, unknown>).merged ?? false,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    }));

    res.json({ success: true, data: formattedPulls });
  } catch (error) {
    logger.error('GitHub get pulls error', error as Error, { component: 'GitHub' });
    const err = error as { message?: string };
    if (err.message?.includes('circuit breaker')) {
      res.status(503).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch pull requests' });
  }
});

/**
 * Generate PR title and description
 */
router.post('/:owner/:repo/generate-pr-content', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const { head, base, userRequest } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!head || !base) {
      res.status(400).json({ success: false, error: 'Head and base branches are required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    let title = userRequest || `Merge ${head} into ${base}`;

    if (title.length > 72) {
      title = title.substring(0, 69) + '...';
    }

    const commits = comparison.commits || [];
    const files = comparison.files || [];

    let body = '';

    if (userRequest) {
      body += `## Summary\n\n${userRequest}\n\n`;
    }

    if (commits.length > 0) {
      body += `## Commits (${commits.length})\n\n`;
      commits.forEach(commit => {
        const message = commit.commit.message.split('\n')[0];
        const sha = commit.sha.substring(0, 7);
        const author = commit.commit.author?.name || 'Unknown';
        body += `- \`${sha}\` ${message} - ${author}\n`;
      });
      body += '\n';
    }

    if (files.length > 0) {
      const additions = files.reduce((sum, file) => sum + (file.additions || 0), 0);
      const deletions = files.reduce((sum, file) => sum + (file.deletions || 0), 0);

      body += `## Changes\n\n`;
      body += `**${files.length}** files changed, **${additions}** insertions(+), **${deletions}** deletions(-)\n\n`;

      const added = files.filter(f => f.status === 'added');
      const modified = files.filter(f => f.status === 'modified');
      const removed = files.filter(f => f.status === 'removed');
      const renamed = files.filter(f => f.status === 'renamed');

      if (added.length > 0) {
        body += `### Added (${added.length})\n`;
        added.forEach(f => body += `- ${f.filename}\n`);
        body += '\n';
      }

      if (modified.length > 0) {
        body += `### Modified (${modified.length})\n`;
        modified.forEach(f => body += `- ${f.filename}\n`);
        body += '\n';
      }

      if (renamed.length > 0) {
        body += `### Renamed (${renamed.length})\n`;
        renamed.forEach(f => body += `- ${f.previous_filename} → ${f.filename}\n`);
        body += '\n';
      }

      if (removed.length > 0) {
        body += `### Removed (${removed.length})\n`;
        removed.forEach(f => body += `- ${f.filename}\n`);
        body += '\n';
      }
    }

    body += `---\n\n*This pull request was generated automatically*`;

    logger.info(`Generated PR content for ${owner}/${repo}: ${head} -> ${base}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        title,
        body,
        stats: {
          commits: commits.length,
          files: files.length,
          additions: files.reduce((sum, file) => sum + (file.additions || 0), 0),
          deletions: files.reduce((sum, file) => sum + (file.deletions || 0), 0),
        },
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub generate PR content error', error as Error, { component: 'GitHub' });

    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Failed to generate PR content'
    });
  }
});

/**
 * Create a pull request
 */
router.post('/:owner/:repo/pulls', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const { title, head, base, body } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!head || !base) {
      res.status(400).json({ success: false, error: 'Head and base branches are required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: title || `Merge ${head} into ${base}`,
      head,
      base,
      body: body || '',
    });

    logger.info(`Created PR #${pr.number} for ${owner}/${repo}: ${head} -> ${base}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        number: pr.number,
        title: pr.title,
        htmlUrl: pr.html_url,
        state: pr.state,
        head: { ref: pr.head.ref, sha: pr.head.sha },
        base: { ref: pr.base.ref, sha: pr.base.sha },
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub create PR error', error as Error, { component: 'GitHub' });

    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'Pull request already exists or validation failed' });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to create pull request' });
  }
});

/**
 * Merge a pull request
 */
router.post('/:owner/:repo/pulls/:pull_number/merge', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, pull_number } = req.params;
    const { merge_method, commit_title, commit_message } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: result } = await octokit.pulls.merge({
      owner,
      repo,
      pull_number: parseInt(pull_number, 10),
      merge_method: merge_method || 'merge',
      commit_title,
      commit_message,
    });

    logger.info(`Merged PR #${pull_number} for ${owner}/${repo}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        merged: result.merged,
        message: result.message,
        sha: result.sha,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub merge PR error', error as Error, { component: 'GitHub' });

    if (err.status === 405) {
      res.status(405).json({ success: false, error: 'Pull request cannot be merged' });
      return;
    }
    if (err.status === 409) {
      res.status(409).json({ success: false, error: 'Merge conflict' });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to merge pull request' });
  }
});

/**
 * Auto PR - Automatically create/update PR, merge base, and merge PR
 */
router.post('/:owner/:repo/branches/*/auto-pr', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const branch = req.params[0];
    const { base, title, body, sessionId } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!base) {
      res.status(400).json({ success: false, error: 'Base branch is required' });
      return;
    }

    logger.info(`Starting Auto PR for ${owner}/${repo}: ${branch} -> ${base}`, {
      component: 'GitHub',
      sessionId
    });

    // Execute auto PR workflow using GitHubOperations
    const result = await githubOperations.autoPullRequest(
      {
        owner,
        repo,
        branch,
        base,
        title,
        body,
        githubAccessToken: authReq.user.githubAccessToken
      },
      (event) => {
        // Log progress events
        logger.info(`Auto PR progress: ${event.stage} - ${event.message}`, {
          component: 'GitHub',
          owner,
          repo,
          stage: event.stage
        });
      }
    );

    // If sessionId provided, archive remote session (if applicable) and soft-delete
    if (sessionId) {
      try {
        logger.info('Auto PR session cleanup starting', {
          component: 'GitHub',
          sessionId,
          userId: authReq.user!.id,
          hasClaudeAuth: !!authReq.user?.claudeAuth
        });

        // Fetch session details to check if it has a remote session to archive
        const [session] = await db
          .select()
          .from(chatSessions)
          .where(
            and(
              eq(chatSessions.id, sessionId),
              eq(chatSessions.userId, authReq.user!.id),
              isNull(chatSessions.deletedAt)
            )
          );

        if (session) {
          logger.info('Session found for cleanup', {
            component: 'GitHub',
            sessionId,
            provider: session.provider ?? undefined,
            remoteSessionId: session.remoteSessionId ?? 'none',
            hasClaudeAuth: !!authReq.user?.claudeAuth
          });

          // Archive Claude Remote session if applicable
          if (session.remoteSessionId && authReq.user?.claudeAuth) {
            const archiveResult = await archiveClaudeRemoteSession(
              session.remoteSessionId,
              authReq.user!.id,
              authReq.user.claudeAuth as ClaudeAuth
            );
            logger.info(`Archive remote session result: ${archiveResult.message}`, {
              component: 'GitHub',
              sessionId,
              remoteSessionId: session.remoteSessionId ?? undefined,
              success: archiveResult.success
            });
          } else {
            // Log why archiving was skipped
            logger.info('Skipping remote session archive - conditions not met', {
              component: 'GitHub',
              sessionId,
              provider: session.provider ?? undefined,
              hasRemoteSessionId: !!session.remoteSessionId,
              hasClaudeAuth: !!authReq.user?.claudeAuth
            });
          }

          // Soft-delete the session (move to trash) with cascading to messages and events
          const softDeleteResult = await sessionSoftDeleteService.softDeleteSession(sessionId);

          if (softDeleteResult.success) {
            logger.info(`Session ${sessionId} moved to trash after successful Auto PR`, {
              component: 'GitHub',
              messagesDeleted: softDeleteResult.messagesDeleted,
              eventsDeleted: softDeleteResult.eventsDeleted,
            });
          } else {
            logger.warn(`Failed to soft-delete session ${sessionId} after Auto PR`, {
              component: 'GitHub',
              error: softDeleteResult.error,
            });
          }
        } else {
          logger.warn('Session not found for cleanup - may have wrong userId or already deleted', {
            component: 'GitHub',
            sessionId,
            userId: authReq.user!.id
          });
        }
      } catch (sessionError) {
        logger.warn(`Failed to cleanup session ${sessionId} after Auto PR`, {
          component: 'GitHub',
          error: sessionError instanceof Error ? sessionError.message : String(sessionError)
        });
      }
    } else {
      logger.info('No sessionId provided for Auto PR cleanup', {
        component: 'GitHub'
      });
    }

    logger.info(`Auto PR completed for ${owner}/${repo}: ${branch} -> ${base}`, {
      component: 'GitHub',
      prNumber: result.pr?.number
    });

    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('Auto PR error', error as Error, {
      component: 'GitHub',
      owner: req.params.owner,
      repo: req.params.repo
    });

    // Handle specific error cases
    if (err.message?.includes('conflict')) {
      res.status(409).json({ success: false, error: err.message });
      return;
    }

    if (err.message?.includes('Timeout')) {
      res.status(408).json({ success: false, error: err.message });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to execute Auto PR' });
  }
});

export default router;
