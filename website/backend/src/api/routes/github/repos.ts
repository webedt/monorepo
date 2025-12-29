/**
 * GitHub Repository Routes
 * Handles repository listing and information
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { logger, withGitHubResilience } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';

const router = Router();

/**
 * @openapi
 * /github/repos:
 *   get:
 *     tags:
 *       - GitHub
 *     summary: List user repositories
 *     description: Returns all repositories accessible by the authenticated user's GitHub account.
 *     responses:
 *       200:
 *         description: Repositories retrieved successfully
 *       400:
 *         description: GitHub not connected
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });
    const { data: repos } = await withGitHubResilience(
      () => octokit.repos.listForAuthenticatedUser({
        sort: 'updated',
        per_page: 100,
      }),
      'listForAuthenticatedUser'
    );

    const formattedRepos = repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      owner: { login: repo.owner.login },
      private: repo.private,
      description: repo.description,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      default_branch: repo.default_branch,
    }));

    res.json({ success: true, data: formattedRepos });
  } catch (error) {
    logger.error('GitHub repos error', error as Error, { component: 'GitHub' });
    const err = error as { message?: string };
    if (err.message?.includes('circuit breaker')) {
      res.status(503).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch repositories' });
  }
});

export default router;
