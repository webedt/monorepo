/**
 * GitHub Repository Routes
 * Handles repository listing and information
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { logger, withGitHubResilience, ServiceProvider, ACacheService } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import type { CachedGitHubRepos } from '@webedt/shared';

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
    const userId = authReq.user!.id;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    // Try to get from cache first (with graceful degradation)
    let cacheService: ACacheService | null = null;
    try {
      cacheService = ServiceProvider.get(ACacheService);
      const cachedResult = await cacheService.getGitHubRepos(userId) as { hit: boolean; value?: CachedGitHubRepos };

      if (cachedResult.hit && cachedResult.value) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=300');
        res.json({ success: true, data: cachedResult.value.repos });
        return;
      }
    } catch (cacheError) {
      // Cache read failed, fall back to GitHub API
      logger.warn('Cache read failed, falling back to GitHub API', {
        component: 'GitHub',
        error: cacheError instanceof Error ? cacheError.message : 'Unknown error',
      });
    }

    // Cache miss or cache error - fetch from GitHub API
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

    // Non-blocking cache write with error handling
    if (cacheService) {
      cacheService.setGitHubRepos(userId, formattedRepos).catch(err => {
        logger.warn('Failed to cache GitHub repos', {
          component: 'GitHub',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=300');
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
