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

    let fileSha = sha;
    if (!fileSha) {
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });
        if (!Array.isArray(data) && data.type === 'file') {
          fileSha = data.sha;
        }
      } catch (error: unknown) {
        const err = error as { status?: number };
        if (err.status !== 404) {
          throw error;
        }
      }
    }

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

    let fileSha = sha;
    if (!fileSha) {
      try {
        const { data } = await octokit.repos.getContent({
          owner,
          repo,
          path,
          ref: branch,
        });
        if (!Array.isArray(data) && data.type === 'file') {
          fileSha = data.sha;
        }
      } catch (error: unknown) {
        const err = error as { status?: number };
        if (err.status === 404) {
          res.status(404).json({ success: false, error: 'File not found' });
          return;
        }
        throw error;
      }
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

    // Delete each file in the folder
    for (const file of filesToDelete) {
      if (!file.path || !file.sha) continue;

      await octokit.repos.deleteFile({
        owner,
        repo,
        path: file.path,
        message: message || `Delete folder ${folderPath}`,
        sha: file.sha,
        branch,
      });
    }

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

    // Move each file to new location
    for (const file of filesToMove) {
      if (!file.path || !file.sha) continue;

      // Get file content
      const { data: fileContent } = await octokit.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref: branch,
      });

      if (Array.isArray(fileContent) || fileContent.type !== 'file') continue;

      // Calculate new path
      const relativePath = file.path.substring(oldFolderPath.length + 1);
      const newPath = `${newFolderPath}/${relativePath}`;

      // Create file at new path
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: newPath,
        message: message || `Rename folder ${oldFolderPath} to ${newFolderPath}`,
        content: fileContent.content || '',
        branch,
      });

      // Delete old file
      await octokit.repos.deleteFile({
        owner,
        repo,
        path: file.path,
        message: message || `Rename folder ${oldFolderPath} to ${newFolderPath}`,
        sha: file.sha,
        branch,
      });
    }

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
