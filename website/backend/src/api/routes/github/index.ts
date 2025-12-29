/**
 * GitHub Routes Index
 *
 * Main router that combines all GitHub-related route modules:
 * - oauth.ts: OAuth flow (initiate, callback, disconnect)
 * - repos.ts: Repository listing
 * - branches.ts: Branch operations (list, create, delete, merge)
 * - pulls.ts: Pull request operations (list, create, merge, auto-pr)
 * - files.ts: File operations (tree, contents, update, delete, rename)
 * - commits.ts: Batch commit operations
 *
 * @openapi
 * tags:
 *   - name: GitHub
 *     description: GitHub OAuth and repository operations
 */

import { Router, Request, Response } from 'express';
import { logger } from '@webedt/shared';
import oauthRoutes from './oauth.js';
import reposRoutes from './repos.js';
import branchesRoutes from './branches.js';
import pullsRoutes from './pulls.js';
import filesRoutes from './files.js';
import commitsRoutes from './commits.js';

const router = Router();

// Mount sub-routers

// OAuth routes (includes /oauth, /oauth/callback, /disconnect)
router.use('/', oauthRoutes);

// Repository routes (mounted at /repos)
router.use('/repos', reposRoutes);

// Branch routes (mounted at /repos/:owner/:repo/branches)
router.use('/repos', branchesRoutes);

// Pull request routes (mounted at /repos/:owner/:repo/pulls and auto-pr)
router.use('/repos', pullsRoutes);

// File routes (mounted at /repos/:owner/:repo/tree, contents, etc.)
router.use('/repos', filesRoutes);

// Commit routes (mounted at /repos/:owner/:repo/commit)
router.use('/repos', commitsRoutes);

// Debug catch-all route - logs any request that doesn't match the above routes
// This helps diagnose 404 issues
router.all('*', (req: Request, res: Response) => {
  logger.warn('GitHub router catch-all: unmatched route', {
    component: 'GitHub',
    method: req.method,
    path: req.path,
    originalUrl: req.originalUrl,
    params: req.params
  });
  res.status(404).json({
    success: false,
    error: 'GitHub endpoint not found',
    debug: {
      method: req.method,
      path: req.path,
      originalUrl: req.originalUrl
    }
  });
});

export default router;
