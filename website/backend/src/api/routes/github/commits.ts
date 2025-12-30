/**
 * GitHub Commit Routes
 * Handles commit operations for batch file updates
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { logger } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';

const router = Router();

/**
 * Commit files to GitHub - used by Code and Images editors
 * This creates a commit directly via the GitHub API (no local git repo needed)
 */
router.post('/:owner/:repo/commit', requireAuth, async (req: Request, res: Response) => {
  // Log that we received the request (for debugging 404 issues)
  logger.info('Commit endpoint hit', {
    component: 'GitHub',
    owner: req.params.owner,
    repo: req.params.repo,
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : []
  });

  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const {
      branch,
      files, // Array of { path, content, encoding? } for code files
      images, // Array of { path, content, beforeContent? } for images (base64)
      deletions, // Array of file paths to delete
      message // Optional custom message
    } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!branch) {
      res.status(400).json({ success: false, error: 'Branch is required' });
      return;
    }

    const hasFiles = files && Array.isArray(files) && files.length > 0;
    const hasImages = images && Array.isArray(images) && images.length > 0;
    const hasDeletions = deletions && Array.isArray(deletions) && deletions.length > 0;

    if (!hasFiles && !hasImages && !hasDeletions) {
      res.status(400).json({ success: false, error: 'No files, images, or deletions to commit' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    logger.info(`Starting commit for ${owner}/${repo}/${branch}`, {
      component: 'GitHub',
      fileCount: files?.length || 0,
      imageCount: images?.length || 0,
      deletionCount: deletions?.length || 0
    });

    // Get the latest commit SHA for the branch
    const { data: refData } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });
    const latestCommitSha = refData.object.sha;

    // Get the tree SHA for the latest commit
    const { data: commitData } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: latestCommitSha,
    });
    const baseTreeSha = commitData.tree.sha;

    // Prepare tree entries for all files
    // sha: null means delete the file, sha: string means create/update
    const treeEntries: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      sha: string | null;
      content?: string;
    }> = [];

    // Process code files
    if (hasFiles) {
      for (const file of files) {
        if (!file.path || file.content === undefined) continue;

        // Create blob for the file content
        const { data: blobData } = await octokit.git.createBlob({
          owner,
          repo,
          content: file.encoding === 'base64' ? file.content : Buffer.from(file.content, 'utf-8').toString('base64'),
          encoding: 'base64',
        });

        treeEntries.push({
          path: file.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }
    }

    // Process image files
    if (hasImages) {
      for (const image of images) {
        if (!image.path || !image.content) continue;

        // Extract base64 content (remove data URL prefix if present)
        let base64Content = image.content;
        if (base64Content.includes(',')) {
          base64Content = base64Content.split(',')[1];
        }

        // Create blob for the image
        const { data: blobData } = await octokit.git.createBlob({
          owner,
          repo,
          content: base64Content,
          encoding: 'base64',
        });

        treeEntries.push({
          path: image.path,
          mode: '100644',
          type: 'blob',
          sha: blobData.sha,
        });
      }
    }

    // Process file deletions
    if (hasDeletions) {
      for (const filePath of deletions) {
        if (!filePath || typeof filePath !== 'string') continue;

        // Setting sha to null tells GitHub to delete this file from the tree
        treeEntries.push({
          path: filePath,
          mode: '100644',
          type: 'blob',
          sha: null,
        });
      }
    }

    if (treeEntries.length === 0) {
      res.status(400).json({ success: false, error: 'No valid files to commit' });
      return;
    }

    // Create a new tree with the updated files
    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseTreeSha,
      tree: treeEntries,
    });

    // Generate commit message if not provided
    let commitMessage = message;
    if (!commitMessage) {
      const updatedCount = (files?.length || 0) + (images?.length || 0);
      const deletedCount = deletions?.length || 0;
      const parts: string[] = [];
      if (updatedCount > 0) {
        parts.push(`Update ${updatedCount} file(s)`);
      }
      if (deletedCount > 0) {
        parts.push(`Delete ${deletedCount} file(s)`);
      }
      commitMessage = parts.join(', ') || 'Update files';
    }

    // Create the commit
    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message: commitMessage,
      tree: newTree.sha,
      parents: [latestCommitSha],
    });

    // Update the branch reference to point to the new commit
    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    logger.info(`Commit created successfully: ${newCommit.sha}`, {
      component: 'GitHub',
      owner,
      repo,
      branch,
      commitSha: newCommit.sha,
      message: commitMessage,
      filesCommitted: treeEntries.length
    });

    res.json({
      success: true,
      data: {
        commitSha: newCommit.sha,
        message: commitMessage,
        branch,
        filesCommitted: treeEntries.length,
        htmlUrl: `https://github.com/${owner}/${repo}/commit/${newCommit.sha}`
      }
    });

  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub commit error', error as Error, {
      component: 'GitHub',
      owner: req.params.owner,
      repo: req.params.repo
    });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Repository or branch not found' });
      return;
    }
    if (err.status === 409) {
      res.status(409).json({ success: false, error: 'Conflict - branch may have been modified. Please refresh and try again.' });
      return;
    }
    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'Invalid file content or path' });
      return;
    }

    res.status(500).json({ success: false, error: err.message || 'Failed to create commit' });
  }
});

export default router;
