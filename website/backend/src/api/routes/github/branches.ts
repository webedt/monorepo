/**
 * GitHub Branch Routes
 * Handles branch operations: list, create, delete, merge
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { logger, withGitHubResilience, ServiceProvider, ACacheService } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import type { CachedGitHubBranches } from '@webedt/shared';

const router = Router();

/**
 * @openapi
 * /github/repos/{owner}/{repo}/branches:
 *   get:
 *     tags:
 *       - GitHub
 *     summary: List repository branches
 *     description: Returns all branches for the specified repository.
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
 *     responses:
 *       200:
 *         description: Branches retrieved successfully
 *       400:
 *         description: GitHub not connected
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/:owner/:repo/branches', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const userId = authReq.user!.id;
    const { owner, repo } = req.params;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    // Try to get from cache first (with graceful degradation)
    let cacheService: ACacheService | null = null;
    try {
      cacheService = ServiceProvider.get(ACacheService);
      const cachedResult = await cacheService.getGitHubBranches(userId, owner, repo) as { hit: boolean; value?: CachedGitHubBranches };

      if (cachedResult.hit && cachedResult.value) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=300');
        res.json({ success: true, data: cachedResult.value.branches });
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
    const { data: branches } = await withGitHubResilience(
      () => octokit.repos.listBranches({
        owner,
        repo,
        per_page: 100,
      }),
      'listBranches'
    );

    const formattedBranches = branches.map((branch) => ({
      name: branch.name,
      protected: branch.protected,
      commit: {
        sha: branch.commit.sha,
        url: branch.commit.url,
      },
    }));

    // Non-blocking cache write with error handling
    if (cacheService) {
      cacheService.setGitHubBranches(userId, owner, repo, formattedBranches).catch(err => {
        logger.warn('Failed to cache GitHub branches', {
          component: 'GitHub',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    }

    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'private, max-age=300, stale-while-revalidate=300');
    res.json({ success: true, data: formattedBranches });
  } catch (error) {
    logger.error('GitHub branches error', error as Error, { component: 'GitHub' });
    const err = error as { message?: string };
    if (err.message?.includes('circuit breaker')) {
      res.status(503).json({ success: false, error: err.message });
      return;
    }
    res.status(500).json({ success: false, error: 'Failed to fetch branches' });
  }
});

/**
 * @openapi
 * /github/repos/{owner}/{repo}/branches:
 *   post:
 *     tags:
 *       - GitHub
 *     summary: Create a new branch
 *     description: Creates a new branch in the specified repository from a base branch.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - branchName
 *             properties:
 *               branchName:
 *                 type: string
 *                 description: Name of the new branch
 *               baseBranch:
 *                 type: string
 *                 description: Base branch to create from (default "main")
 *                 default: main
 *     responses:
 *       200:
 *         description: Branch created successfully
 *       400:
 *         description: Branch name is required or GitHub not connected
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       422:
 *         description: Branch already exists
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.post('/:owner/:repo/branches', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const { branchName, baseBranch } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!branchName) {
      res.status(400).json({ success: false, error: 'Branch name is required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const base = baseBranch || 'main';
    const { data: baseBranchData } = await withGitHubResilience(
      () => octokit.repos.getBranch({
        owner,
        repo,
        branch: base,
      }),
      'getBranch'
    );

    await withGitHubResilience(
      () => octokit.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branchName}`,
        sha: baseBranchData.commit.sha,
      }),
      'createRef'
    );

    logger.info(`Created branch ${branchName} from ${base} in ${owner}/${repo}`, { component: 'GitHub' });

    // Invalidate branch cache (non-blocking)
    try {
      const cacheService = ServiceProvider.get(ACacheService);
      cacheService.invalidateRepoBranches(authReq.user!.id, owner, repo).catch(err => {
        logger.warn('Failed to invalidate branch cache', {
          component: 'GitHub',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    } catch {
      // Cache service not available, skip invalidation
    }

    res.json({
      success: true,
      data: {
        branchName,
        baseBranch: base,
        sha: baseBranchData.commit.sha,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub create branch error', error as Error, { component: 'GitHub' });

    if (err.message?.includes('circuit breaker')) {
      res.status(503).json({ success: false, error: err.message });
      return;
    }
    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'Branch already exists' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to create branch' });
  }
});

/**
 * Delete a branch
 */
router.delete('/:owner/:repo/branches/*', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const branch = req.params[0];

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    await octokit.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });

    logger.info(`Deleted branch ${owner}/${repo}/${branch}`, { component: 'GitHub' });

    // Invalidate branch cache (non-blocking)
    try {
      const cacheService = ServiceProvider.get(ACacheService);
      cacheService.invalidateRepoBranches(authReq.user!.id, owner, repo).catch(err => {
        logger.warn('Failed to invalidate branch cache after delete', {
          component: 'GitHub',
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      });
    } catch {
      // Cache service not available, skip invalidation
    }

    res.json({ success: true, data: { message: 'Branch deleted' } });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (err.status === 422 || err.status === 404) {
      logger.info(`Branch ${req.params.owner}/${req.params.repo}/${req.params[0]} not found (already deleted)`, { component: 'GitHub' });

      // Also invalidate cache in case branch was deleted externally
      try {
        const authReq = req as AuthRequest;
        const cacheService = ServiceProvider.get(ACacheService);
        cacheService.invalidateRepoBranches(authReq.user!.id, req.params.owner, req.params.repo).catch(() => {});
      } catch {
        // Cache service not available
      }

      res.json({ success: true, data: { message: 'Branch already deleted or does not exist' } });
      return;
    }
    logger.error('GitHub delete branch error', error as Error, { component: 'GitHub' });
    res.status(500).json({ success: false, error: 'Failed to delete branch' });
  }
});

/**
 * Merge base branch into feature branch
 */
router.post('/:owner/:repo/branches/*/merge-base', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const branch = req.params[0];
    const { base } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!base) {
      res.status(400).json({ success: false, error: 'Base branch is required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: result } = await octokit.repos.merge({
      owner,
      repo,
      base: branch,
      head: base,
      commit_message: `Merge ${base} into ${branch}`,
    });

    logger.info(`Merged ${base} into ${branch} for ${owner}/${repo}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        sha: result.sha,
        message: `Successfully merged ${base} into ${branch}`,
        commit: {
          sha: result.sha,
          message: result.commit?.message,
        },
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub merge base error', error as Error, { component: 'GitHub' });

    if (err.status === 204) {
      res.json({ success: true, data: { message: 'Branch is already up to date', sha: null } });
      return;
    }
    if (err.status === 409) {
      res.status(409).json({ success: false, error: 'Merge conflict - manual resolution required' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to merge base branch' });
  }
});

export default router;
