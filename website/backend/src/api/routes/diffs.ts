/**
 * @openapi
 * tags:
 *   - name: Diffs
 *     description: File diff operations and comparison between Git branches
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { requireAuth } from '../middleware/auth.js';
import { validatePathParam } from '../middleware/pathValidation.js';
import { standardRateLimiter } from '../middleware/rateLimit.js';
import {
  logger,
  parseDiff,
  BadRequestError,
  NotFoundError,
  InternalServerError,
  isDomainError,
} from '@webedt/shared';
import { asyncHandler } from '../middleware/domainErrorHandler.js';
import type { AuthRequest } from '../middleware/auth.js';
import type { ParsedDiff } from '@webedt/shared';

const router = Router();

// Apply rate limiting to all diff routes
// Rate limit: 100 requests/minute (standardRateLimiter)
router.use(standardRateLimiter);

interface CompareResult {
  diff: ParsedDiff;
  rawDiff: string;
  baseBranch: string;
  headBranch: string;
  aheadBy: number;
  behindBy: number;
  mergeBaseCommit: string;
}

interface FileChange {
  filename: string;
  status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged';
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  previousFilename?: string;
}

// Valid statuses from GitHub API that we support
const VALID_FILE_STATUSES = new Set(['added', 'removed', 'modified', 'renamed', 'copied', 'changed', 'unchanged']);

/**
 * Safely map GitHub API file status to our FileChange status
 * Falls back to 'modified' for unknown statuses
 */
function normalizeFileStatus(status: string): FileChange['status'] {
  if (VALID_FILE_STATUSES.has(status)) {
    return status as FileChange['status'];
  }
  return 'modified';
}

/**
 * @openapi
 * /api/diffs/repos/{owner}/{repo}/compare/{base}/{head}:
 *   get:
 *     tags:
 *       - Diffs
 *     summary: Get diff comparison between branches
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
 *       - name: base
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: head
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Diff comparison with parsed and raw diff data
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/repos/:owner/:repo/compare/:base/:head', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { owner, repo, base, head } = req.params;

  if (!authReq.user?.githubAccessToken) {
    throw BadRequestError.missingConfiguration('GitHub');
  }

  logger.info(`Getting diff comparison for ${owner}/${repo}: ${base}...${head}`, {
    component: 'Diffs',
  });

  const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

  try {
    // Get comparison between branches
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    // Build raw diff from patches with proper handling for different file statuses
    let rawDiff = '';
    const files = comparison.files || [];

    for (const file of files) {
      if (file.patch) {
        const oldPath = file.previous_filename || file.filename;
        const newPath = file.filename;

        rawDiff += `diff --git a/${oldPath} b/${newPath}\n`;

        // Handle file status correctly
        if (file.status === 'added') {
          rawDiff += `--- /dev/null\n`;
          rawDiff += `+++ b/${newPath}\n`;
        } else if (file.status === 'removed') {
          rawDiff += `--- a/${oldPath}\n`;
          rawDiff += `+++ /dev/null\n`;
        } else if (file.status === 'renamed') {
          rawDiff += `rename from ${oldPath}\n`;
          rawDiff += `rename to ${newPath}\n`;
          rawDiff += `--- a/${oldPath}\n`;
          rawDiff += `+++ b/${newPath}\n`;
        } else {
          rawDiff += `--- a/${oldPath}\n`;
          rawDiff += `+++ b/${newPath}\n`;
        }
        rawDiff += file.patch + '\n';
      }
    }

    // Parse the diff
    const parsedDiff = parseDiff(rawDiff);

    const result: CompareResult = {
      diff: parsedDiff,
      rawDiff,
      baseBranch: base,
      headBranch: head,
      aheadBy: comparison.ahead_by,
      behindBy: comparison.behind_by,
      mergeBaseCommit: comparison.merge_base_commit?.sha || '',
    };

    logger.info(`Diff comparison complete: ${parsedDiff.totalFilesChanged} files, +${parsedDiff.totalAdditions}, -${parsedDiff.totalDeletions}`, {
      component: 'Diffs',
      owner,
      repo,
      base,
      head,
    });

    res.json({ success: true, data: result });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // Log full error details server-side, but don't expose to client
    logger.error('Failed to get diff comparison', error as Error, {
      component: 'Diffs',
      errorMessage: err.message,
    });

    if (err.status === 404) {
      throw NotFoundError.forResource('Repository or branch');
    }

    throw InternalServerError.operationFailed('get diff comparison');
  }
}));

/**
 * @openapi
 * /api/diffs/repos/{owner}/{repo}/changed-files/{base}/{head}:
 *   get:
 *     tags:
 *       - Diffs
 *     summary: Get list of changed files between branches
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
 *       - name: base
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: head
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of changed files with status and statistics
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/repos/:owner/:repo/changed-files/:base/:head', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { owner, repo, base, head } = req.params;

  if (!authReq.user?.githubAccessToken) {
    throw BadRequestError.missingConfiguration('GitHub');
  }

  const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

  try {
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    const files: FileChange[] = (comparison.files || []).map(file => ({
      filename: file.filename,
      status: normalizeFileStatus(file.status),
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
      previousFilename: file.previous_filename,
    }));

    res.json({
      success: true,
      data: {
        files,
        totalFiles: files.length,
        totalAdditions: files.reduce((sum, f) => sum + f.additions, 0),
        totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0),
        aheadBy: comparison.ahead_by,
        behindBy: comparison.behind_by,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // Log full error details server-side, but don't expose to client
    logger.error('Failed to get changed files', error as Error, {
      component: 'Diffs',
      errorMessage: err.message,
    });

    if (err.status === 404) {
      throw NotFoundError.forResource('Repository or branch');
    }

    throw InternalServerError.operationFailed('get changed files');
  }
}));

/**
 * @openapi
 * /api/diffs/repos/{owner}/{repo}/file-diff/{base}/{head}/{filePath}:
 *   get:
 *     tags:
 *       - Diffs
 *     summary: Get diff for a specific file
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
 *       - name: base
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: head
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: filePath
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: File diff with patch and statistics
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/repos/:owner/:repo/file-diff/:base/:head/*', requireAuth, validatePathParam(), asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { owner, repo, base, head } = req.params;
  const filePath = req.params[0];

  if (!authReq.user?.githubAccessToken) {
    throw BadRequestError.missingConfiguration('GitHub');
  }

  if (!filePath) {
    throw new BadRequestError('File path is required');
  }

  const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

  try {
    // Get comparison between branches
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    // Find the specific file
    const file = comparison.files?.find(f => f.filename === filePath);

    if (!file) {
      throw new NotFoundError('File not found in diff', 'file', { filePath });
    }

    // Build raw diff for this file
    let rawDiff = '';
    if (file.patch) {
      rawDiff = `diff --git a/${file.filename} b/${file.filename}\n`;
      rawDiff += `--- a/${file.filename}\n`;
      rawDiff += `+++ b/${file.filename}\n`;
      rawDiff += file.patch;
    }

    const parsedDiff = parseDiff(rawDiff);

    res.json({
      success: true,
      data: {
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch,
        rawDiff,
        parsedDiff: parsedDiff.files[0] || null,
        previousFilename: file.previous_filename,
      },
    });
  } catch (error: unknown) {
    // Re-throw any domain errors (NotFoundError, BadRequestError, etc.)
    if (isDomainError(error)) {
      throw error;
    }

    const err = error as { status?: number; message?: string };
    // Log full error details server-side, but don't expose to client
    logger.error('Failed to get file diff', error as Error, {
      component: 'Diffs',
      errorMessage: err.message,
    });

    if (err.status === 404) {
      throw NotFoundError.forResource('Repository or branch');
    }

    throw InternalServerError.operationFailed('get file diff');
  }
}));

/**
 * @openapi
 * /api/diffs/repos/{owner}/{repo}/stats/{base}/{head}:
 *   get:
 *     tags:
 *       - Diffs
 *     summary: Get diff statistics (lightweight)
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
 *       - name: base
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *       - name: head
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Diff statistics without patches
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/InternalError'
 */
router.get('/repos/:owner/:repo/stats/:base/:head', requireAuth, asyncHandler(async (req: Request, res: Response) => {
  const authReq = req as AuthRequest;
  const { owner, repo, base, head } = req.params;

  if (!authReq.user?.githubAccessToken) {
    throw BadRequestError.missingConfiguration('GitHub');
  }

  const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

  try {
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    const files = comparison.files || [];
    const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
    const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

    res.json({
      success: true,
      data: {
        filesChanged: files.length,
        additions: totalAdditions,
        deletions: totalDeletions,
        totalChanges: totalAdditions + totalDeletions,
        commits: comparison.commits?.length || 0,
        aheadBy: comparison.ahead_by,
        behindBy: comparison.behind_by,
        status: comparison.status,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // Log full error details server-side, but don't expose to client
    logger.error('Failed to get diff stats', error as Error, {
      component: 'Diffs',
      errorMessage: err.message,
    });

    if (err.status === 404) {
      throw NotFoundError.forResource('Repository or branch');
    }

    throw InternalServerError.operationFailed('get diff stats');
  }
}));

export default router;
