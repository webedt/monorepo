/**
 * Diff Routes
 * Provides diff visualization comparing current branch against base branch
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { requireAuth } from '../middleware/auth.js';
import { logger, parseDiff } from '@webedt/shared';
import type { AuthRequest } from '../middleware/auth.js';
import type { ParsedDiff } from '@webedt/shared';

const router = Router();

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

// Get diff comparison between head and base branch
router.get('/repos/:owner/:repo/compare/:base/:head', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, base, head } = req.params;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    logger.info(`Getting diff comparison for ${owner}/${repo}: ${base}...${head}`, {
      component: 'Diffs',
    });

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Get comparison between branches
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    // Build raw diff from patches
    let rawDiff = '';
    const files = comparison.files || [];

    for (const file of files) {
      if (file.patch) {
        rawDiff += `diff --git a/${file.filename} b/${file.filename}\n`;
        rawDiff += `--- a/${file.filename}\n`;
        rawDiff += `+++ b/${file.filename}\n`;
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
    logger.error('Failed to get diff comparison', error as Error, { component: 'Diffs' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Repository or branch not found' });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to get diff comparison' });
  }
});

// Get list of changed files between branches
router.get('/repos/:owner/:repo/changed-files/:base/:head', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, base, head } = req.params;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    const files: FileChange[] = (comparison.files || []).map(file => ({
      filename: file.filename,
      status: file.status as FileChange['status'],
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
    logger.error('Failed to get changed files', error as Error, { component: 'Diffs' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Repository or branch not found' });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to get changed files' });
  }
});

// Get diff for a specific file
router.get('/repos/:owner/:repo/file-diff/:base/:head/*', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, base, head } = req.params;
    const filePath = req.params[0];

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!filePath) {
      res.status(400).json({ success: false, error: 'File path is required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

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
      res.status(404).json({ success: false, error: 'File not found in diff' });
      return;
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
    const err = error as { status?: number; message?: string };
    logger.error('Failed to get file diff', error as Error, { component: 'Diffs' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Repository or branch not found' });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to get file diff' });
  }
});

// Get diff stats only (lightweight)
router.get('/repos/:owner/:repo/stats/:base/:head', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, base, head } = req.params;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

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
    logger.error('Failed to get diff stats', error as Error, { component: 'Diffs' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Repository or branch not found' });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to get diff stats' });
  }
});

export default router;
