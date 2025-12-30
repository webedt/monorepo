/**
 * GitHub File Routes
 * Handles file and folder operations: tree, contents, update, delete, rename
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { logger } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import { validatePathParam, validateBodyPath } from '../../middleware/pathValidation.js';
import type { AuthRequest } from '../../middleware/auth.js';

const router = Router();

/**
 * Maximum concurrent GitHub API requests to avoid rate limiting
 */
const MAX_CONCURRENT_REQUESTS = 10;

/**
 * Execute async tasks with concurrency limiting
 */
async function withConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const executing: Promise<void>[] = [];

  for (const item of items) {
    const promise = fn(item).then((result) => {
      results.push(result);
    });

    executing.push(promise as unknown as Promise<void>);

    if (executing.length >= limit) {
      await Promise.race(executing);
      // Remove completed promises
      const completed = executing.filter((p) => {
        let resolved = false;
        p.then(() => { resolved = true; }).catch(() => { resolved = true; });
        return !resolved;
      });
      executing.length = 0;
      executing.push(...completed);
    }
  }

  await Promise.all(executing);
  return results;
}

/**
 * Resolve file SHA from GitHub. Returns undefined if file doesn't exist.
 * Caches resolved SHAs in the provided cache map.
 */
async function resolveSha(
  octokit: Octokit,
  owner: string,
  repo: string,
  path: string,
  branch: string,
  shaCache?: Map<string, string>
): Promise<string | undefined> {
  const cacheKey = `${owner}/${repo}/${branch}/${path}`;

  if (shaCache?.has(cacheKey)) {
    return shaCache.get(cacheKey);
  }

  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: branch,
    });

    if (!Array.isArray(data) && data.type === 'file') {
      shaCache?.set(cacheKey, data.sha);
      return data.sha;
    }
    return undefined;
  } catch (error: unknown) {
    const err = error as { status?: number };
    if (err.status === 404) {
      return undefined;
    }
    throw error;
  }
}

/**
 * Create a new tree with file changes and commit it atomically.
 * This uses the Git Trees API for efficient batch operations.
 */
async function commitTreeChanges(
  octokit: Octokit,
  owner: string,
  repo: string,
  branch: string,
  message: string,
  treeChanges: Array<{
    path: string;
    mode: '100644' | '100755' | '040000' | '160000' | '120000';
    type: 'blob' | 'tree' | 'commit';
    sha: string | null; // null to delete
    content?: string; // for new/updated files
  }>
): Promise<{ commitSha: string; treeSha: string }> {
  // Get current branch ref
  const { data: refData } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branch}`,
  });
  const latestCommitSha = refData.object.sha;

  // Get current commit to find base tree
  const { data: commitData } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: latestCommitSha,
  });
  const baseTreeSha = commitData.tree.sha;

  // Create new tree with changes
  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: treeChanges.map((change) => {
      if (change.content !== undefined) {
        // New or updated file with content
        return {
          path: change.path,
          mode: change.mode,
          type: change.type,
          content: change.content,
        };
      } else if (change.sha === null) {
        // Delete file by setting sha to null (omitting from tree)
        // GitHub API requires omitting the sha field entirely for deletes
        return {
          path: change.path,
          mode: change.mode,
          type: change.type,
          sha: null as unknown as string,
        };
      } else {
        // Keep existing blob (e.g., for renames)
        return {
          path: change.path,
          mode: change.mode,
          type: change.type,
          sha: change.sha,
        };
      }
    }),
  });

  // Create commit
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message,
    tree: newTree.sha,
    parents: [latestCommitSha],
  });

  // Update branch ref
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branch}`,
    sha: newCommit.sha,
  });

  return { commitSha: newCommit.sha, treeSha: newTree.sha };
}

/**
 * Get repository file tree
 */
router.get('/:owner/:repo/tree/*', requireAuth, validatePathParam({ isBranchName: true }), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const branch = req.params[0];
    const { recursive } = req.query;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: branchData } = await octokit.repos.getBranch({
      owner,
      repo,
      branch,
    });
    const treeSha = branchData.commit.commit.tree.sha;

    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: recursive === 'true' ? 'true' : undefined,
    });

    logger.info(`Fetched tree for ${owner}/${repo}/${branch} (${tree.tree.length} items)`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        sha: tree.sha,
        tree: tree.tree.map((item) => ({
          path: item.path,
          type: item.type,
          sha: item.sha,
          size: item.size,
        })),
        truncated: tree.truncated,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub get tree error', error as Error, { component: 'GitHub' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Branch or repository not found' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to fetch file tree' });
  }
});

/**
 * Get file contents
 */
router.get('/:owner/:repo/contents/*', requireAuth, validatePathParam(), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const path = req.params[0];
    const { ref } = req.query;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref: ref as string,
    });

    if (!Array.isArray(data) && data.type === 'file') {
      const ext = data.name.split('.').pop()?.toLowerCase() || '';
      const binaryExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'pdf', 'zip', 'tar', 'gz', 'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'wav', 'ogg', 'webm'];
      const isBinary = binaryExtensions.includes(ext);

      if (isBinary && data.encoding === 'base64' && data.content) {
        const cleanContent = data.content.replace(/\s/g, '');

        res.json({
          success: true,
          data: {
            name: data.name,
            path: data.path,
            sha: data.sha,
            size: data.size,
            type: data.type,
            content: cleanContent,
            encoding: 'base64',
            download_url: data.download_url,
          },
        });
      } else {
        const content = data.encoding === 'base64' && data.content
          ? Buffer.from(data.content, 'base64').toString('utf-8')
          : data.content;

        res.json({
          success: true,
          data: {
            name: data.name,
            path: data.path,
            sha: data.sha,
            size: data.size,
            type: data.type,
            content,
            encoding: 'utf-8',
          },
        });
      }
    } else if (Array.isArray(data)) {
      res.json({
        success: true,
        data: {
          type: 'dir',
          items: data.map((item) => ({
            name: item.name,
            path: item.path,
            sha: item.sha,
            size: item.size,
            type: item.type,
          })),
        },
      });
    } else {
      res.json({ success: true, data });
    }
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub get contents error', error as Error, { component: 'GitHub' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'File or path not found' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to fetch file contents' });
  }
});

/**
 * Update/Create a file
 */
router.put('/:owner/:repo/contents/*', requireAuth, validatePathParam(), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const path = req.params[0];
    const { content, branch, sha, message } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!branch) {
      res.status(400).json({ success: false, error: 'Branch is required' });
      return;
    }

    if (content === undefined) {
      res.status(400).json({ success: false, error: 'Content is required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');

    const fileSha = sha || await resolveSha(octokit, owner, repo, path, branch);

    const result = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: message || `Update ${path}`,
      content: contentBase64,
      branch,
      sha: fileSha,
    });

    logger.info(`Updated file ${path} in ${owner}/${repo}/${branch}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        message: fileSha ? 'File updated successfully' : 'File created successfully',
        sha: result.data.content?.sha,
        path,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub update file error', error as Error, { component: 'GitHub' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Repository or branch not found' });
      return;
    }
    if (err.status === 409) {
      res.status(409).json({ success: false, error: 'Conflict - file may have been modified. Please refresh and try again.' });
      return;
    }
    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'Invalid file content or path' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to update file' });
  }
});

/**
 * Delete a file
 */
router.delete('/:owner/:repo/contents/*', requireAuth, validatePathParam(), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const path = req.params[0];
    const { branch, sha, message } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!branch) {
      res.status(400).json({ success: false, error: 'Branch is required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const fileSha = sha || await resolveSha(octokit, owner, repo, path, branch);
    if (!fileSha) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }

    await octokit.repos.deleteFile({
      owner,
      repo,
      path,
      message: message || `Delete ${path}`,
      sha: fileSha!,
      branch,
    });

    logger.info(`Deleted file ${path} in ${owner}/${repo}/${branch}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: { message: 'File deleted successfully' },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub delete file error', error as Error, { component: 'GitHub' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'File or repository not found' });
      return;
    }
    if (err.status === 409) {
      res.status(409).json({ success: false, error: 'Conflict - file may have been modified' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to delete file' });
  }
});

/**
 * Rename a file (copy to new path, delete old)
 */
router.post('/:owner/:repo/rename/*', requireAuth, validatePathParam(), validateBodyPath('newPath'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const oldPath = req.params[0];
    const { newPath, branch, message } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!branch) {
      res.status(400).json({ success: false, error: 'Branch is required' });
      return;
    }

    if (!newPath) {
      res.status(400).json({ success: false, error: 'New path is required' });
      return;
    }

    if (oldPath === newPath) {
      res.status(400).json({ success: false, error: 'New path must be different from old path' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Get the file content from old path
    const { data: oldFile } = await octokit.repos.getContent({
      owner,
      repo,
      path: oldPath,
      ref: branch,
    });

    if (Array.isArray(oldFile) || oldFile.type !== 'file') {
      res.status(400).json({ success: false, error: 'Path is not a file. Use rename-folder for directories.' });
      return;
    }

    // Create file at new path
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: newPath,
      message: message || `Rename ${oldPath} to ${newPath}`,
      content: oldFile.content || '',
      branch,
    });

    // Delete old file
    await octokit.repos.deleteFile({
      owner,
      repo,
      path: oldPath,
      message: message || `Rename ${oldPath} to ${newPath}`,
      sha: oldFile.sha,
      branch,
    });

    logger.info(`Renamed file ${oldPath} to ${newPath} in ${owner}/${repo}/${branch}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        message: 'File renamed successfully',
        oldPath,
        newPath,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub rename file error', error as Error, { component: 'GitHub' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'File already exists at new path' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to rename file' });
  }
});

/**
 * Delete a folder (delete all files in folder)
 */
router.delete('/:owner/:repo/folder/*', requireAuth, validatePathParam(), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const folderPath = req.params[0];
    const { branch, message } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!branch) {
      res.status(400).json({ success: false, error: 'Branch is required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Get all files in the folder
    const { data: branchData } = await octokit.repos.getBranch({
      owner,
      repo,
      branch,
    });

    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: branchData.commit.commit.tree.sha,
      recursive: 'true',
    });

    // Filter files that are in the folder
    const filesToDelete = tree.tree.filter(
      (item) => item.type === 'blob' && item.path?.startsWith(folderPath + '/')
    );

    if (filesToDelete.length === 0) {
      res.status(404).json({ success: false, error: 'Folder is empty or not found' });
      return;
    }

    // Use Git Trees API for atomic batch deletion
    const treeChanges = filesToDelete
      .filter((file) => file.path && file.sha)
      .map((file) => ({
        path: file.path!,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: null, // null indicates deletion
      }));

    await commitTreeChanges(
      octokit,
      owner,
      repo,
      branch,
      message || `Delete folder ${folderPath}`,
      treeChanges
    );

    logger.info(`Deleted folder ${folderPath} (${filesToDelete.length} files) in ${owner}/${repo}/${branch}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        message: 'Folder deleted successfully',
        path: folderPath,
        filesDeleted: filesToDelete.length,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub delete folder error', error as Error, { component: 'GitHub' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Folder or branch not found' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to delete folder' });
  }
});

/**
 * Rename a folder (copy all files to new path, delete old)
 */
router.post('/:owner/:repo/rename-folder/*', requireAuth, validatePathParam(), validateBodyPath('newFolderPath'), async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const oldFolderPath = req.params[0];
    const { newFolderPath, branch, message } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!branch) {
      res.status(400).json({ success: false, error: 'Branch is required' });
      return;
    }

    if (!newFolderPath) {
      res.status(400).json({ success: false, error: 'New folder path is required' });
      return;
    }

    if (oldFolderPath === newFolderPath) {
      res.status(400).json({ success: false, error: 'New path must be different from old path' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Get all files in the folder
    const { data: branchData } = await octokit.repos.getBranch({
      owner,
      repo,
      branch,
    });

    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: branchData.commit.commit.tree.sha,
      recursive: 'true',
    });

    // Filter files that are in the folder
    const filesToMove = tree.tree.filter(
      (item) => item.type === 'blob' && item.path?.startsWith(oldFolderPath + '/')
    );

    if (filesToMove.length === 0) {
      res.status(404).json({ success: false, error: 'Folder is empty or not found' });
      return;
    }

    // Check if any files already exist at the new paths
    const existingAtNewPath = tree.tree.filter(
      (item) => item.type === 'blob' && item.path?.startsWith(newFolderPath + '/')
    );

    if (existingAtNewPath.length > 0) {
      res.status(422).json({ success: false, error: 'Files already exist at new path' });
      return;
    }

    // Use Git Trees API for atomic batch rename
    // Build tree changes: add files at new paths, delete files at old paths
    const treeChanges: Array<{
      path: string;
      mode: '100644' | '100755' | '040000' | '160000' | '120000';
      type: 'blob' | 'tree' | 'commit';
      sha: string | null;
    }> = [];

    for (const file of filesToMove) {
      if (!file.path || !file.sha) continue;

      // Calculate new path
      const relativePath = file.path.substring(oldFolderPath.length + 1);
      const newPath = `${newFolderPath}/${relativePath}`;

      // Determine file mode (preserve executable flag if present)
      const fileMode: '100644' | '100755' = file.mode === '100755' ? '100755' : '100644';

      // Add file at new path (reuse existing blob SHA - no need to fetch content)
      treeChanges.push({
        path: newPath,
        mode: fileMode,
        type: 'blob',
        sha: file.sha,
      });

      // Delete file at old path
      treeChanges.push({
        path: file.path,
        mode: fileMode,
        type: 'blob',
        sha: null,
      });
    }

    await commitTreeChanges(
      octokit,
      owner,
      repo,
      branch,
      message || `Rename folder ${oldFolderPath} to ${newFolderPath}`,
      treeChanges
    );

    logger.info(`Renamed folder ${oldFolderPath} to ${newFolderPath} (${filesToMove.length} files) in ${owner}/${repo}/${branch}`, { component: 'GitHub' });

    res.json({
      success: true,
      data: {
        message: 'Folder renamed successfully',
        oldPath: oldFolderPath,
        newPath: newFolderPath,
        filesMoved: filesToMove.length,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    logger.error('GitHub rename folder error', error as Error, { component: 'GitHub' });

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Folder or branch not found' });
      return;
    }
    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'Files already exist at new path' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to rename folder' });
  }
});

export default router;
