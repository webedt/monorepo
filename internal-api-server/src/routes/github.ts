/**
 * GitHub Routes
 * Handles GitHub OAuth and repository operations
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { db, users, chatSessions, events } from '../db/index.js';
import { eq, and, isNull } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth.js';
import { requireAuth } from '../middleware/auth.js';
import { logger } from '@webedt/shared';
import { GitHubOperations } from '../services/github/operations.js';
import { StorageService } from '../services/storage/storageService.js';
import { AIWorkerClient } from '../services/aiWorker/aiWorkerClient.js';

const router = Router();

// Initialize services for Auto PR
const storageService = new StorageService();
const githubOperations = new GitHubOperations(storageService);

// Helper function to get the frontend URL for redirects
function getFrontendUrl(path: string, storedOrigin?: string): string {
  if (storedOrigin) {
    return `${storedOrigin}${path}`;
  }
  const origin = process.env.ALLOWED_ORIGINS?.split(',')[0];
  if (origin) {
    return `${origin}${path}`;
  }
  return path;
}

// Helper to extract origin from request
function getRequestOrigin(req: Request): string {
  const protocol = req.protocol || 'https';
  const host = req.get('host') || req.get('x-forwarded-host') || '';
  return `${protocol}://${host}`;
}

// Initiate GitHub OAuth
router.get('/oauth', requireAuth, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;

  const referer = req.get('referer') || req.get('origin');
  let returnOrigin = getRequestOrigin(req);

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      returnOrigin = refererUrl.origin;
    } catch {
      // Fall back to request origin
    }
  }

  const state = Buffer.from(JSON.stringify({
    sessionId: authReq.authSession!.id,
    userId: authReq.user!.id,
    timestamp: Date.now(),
    returnOrigin,
  })).toString('base64');

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_OAUTH_CLIENT_ID!,
    redirect_uri: process.env.GITHUB_OAUTH_REDIRECT_URL!,
    scope: 'repo workflow user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

// GitHub OAuth callback
router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      res.redirect(getFrontendUrl('/login?error=missing_params'));
      return;
    }

    let stateData: {
      sessionId: string;
      userId: string;
      timestamp: number;
      returnOrigin?: string;
    };
    try {
      stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    } catch {
      res.redirect(getFrontendUrl('/login?error=invalid_state'));
      return;
    }

    // Check if state is not too old (10 minute timeout)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      res.redirect(getFrontendUrl('/login?error=state_expired', stateData.returnOrigin));
      return;
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenData.error) {
      res.redirect(getFrontendUrl(`/settings?error=${tokenData.error}`, stateData.returnOrigin));
      return;
    }

    const accessToken = tokenData.access_token;

    // Get GitHub user info
    const octokit = new Octokit({ auth: accessToken });
    const { data: githubUser } = await octokit.users.getAuthenticated();

    // Update user with GitHub info
    await db
      .update(users)
      .set({
        githubId: String(githubUser.id),
        githubAccessToken: accessToken,
      })
      .where(eq(users.id, stateData.userId));

    res.redirect(getFrontendUrl('/settings?success=github_connected', stateData.returnOrigin));
  } catch (error) {
    logger.error('GitHub OAuth error', error as Error, { component: 'GitHub' });
    res.redirect(getFrontendUrl('/settings?error=oauth_failed'));
  }
});

// Get user's repositories
router.get('/repos', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });
    const { data: repos } = await octokit.repos.listForAuthenticatedUser({
      sort: 'updated',
      per_page: 100,
    });

    const formattedRepos = repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      description: repo.description,
      htmlUrl: repo.html_url,
      cloneUrl: repo.clone_url,
      defaultBranch: repo.default_branch,
    }));

    res.json({ success: true, data: formattedRepos });
  } catch (error) {
    logger.error('GitHub repos error', error as Error, { component: 'GitHub' });
    res.status(500).json({ success: false, error: 'Failed to fetch repositories' });
  }
});

// Get repository branches
router.get('/repos/:owner/:repo/branches', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });
    const { data: branches } = await octokit.repos.listBranches({
      owner,
      repo,
      per_page: 100,
    });

    const formattedBranches = branches.map((branch) => ({
      name: branch.name,
      protected: branch.protected,
      commit: {
        sha: branch.commit.sha,
        url: branch.commit.url,
      },
    }));

    res.json({ success: true, data: formattedBranches });
  } catch (error) {
    logger.error('GitHub branches error', error as Error, { component: 'GitHub' });
    res.status(500).json({ success: false, error: 'Failed to fetch branches' });
  }
});

// Create a new branch
router.post('/repos/:owner/:repo/branches', requireAuth, async (req: Request, res: Response) => {
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
    const { data: baseBranchData } = await octokit.repos.getBranch({
      owner,
      repo,
      branch: base,
    });

    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseBranchData.commit.sha,
    });

    logger.info(`Created branch ${branchName} from ${base} in ${owner}/${repo}`, { component: 'GitHub' });

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

    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'Branch already exists' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to create branch' });
  }
});

// Get repository file tree
router.get('/repos/:owner/:repo/tree/*', requireAuth, async (req: Request, res: Response) => {
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

// Get file contents
router.get('/repos/:owner/:repo/contents/*', requireAuth, async (req: Request, res: Response) => {
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

// Delete a branch
router.delete('/repos/:owner/:repo/branches/*', requireAuth, async (req: Request, res: Response) => {
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
    res.json({ success: true, data: { message: 'Branch deleted' } });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    if (err.status === 422 || err.status === 404) {
      logger.info(`Branch ${req.params.owner}/${req.params.repo}/${req.params[0]} not found (already deleted)`, { component: 'GitHub' });
      res.json({ success: true, data: { message: 'Branch already deleted or does not exist' } });
      return;
    }
    logger.error('GitHub delete branch error', error as Error, { component: 'GitHub' });
    res.status(500).json({ success: false, error: 'Failed to delete branch' });
  }
});

// Get pull requests
router.get('/repos/:owner/:repo/pulls', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const { head, base } = req.query;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: pulls } = await octokit.pulls.list({
      owner,
      repo,
      head: head ? `${owner}:${head}` : undefined,
      base: base as string | undefined,
      state: 'all',
      per_page: 10,
    });

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
    res.status(500).json({ success: false, error: 'Failed to fetch pull requests' });
  }
});

// Generate PR title and description
router.post('/repos/:owner/:repo/generate-pr-content', requireAuth, async (req: Request, res: Response) => {
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

// Create a pull request
router.post('/repos/:owner/:repo/pulls', requireAuth, async (req: Request, res: Response) => {
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

// Merge a pull request
router.post('/repos/:owner/:repo/pulls/:pull_number/merge', requireAuth, async (req: Request, res: Response) => {
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

// Merge base branch into feature branch
router.post('/repos/:owner/:repo/branches/*/merge-base', requireAuth, async (req: Request, res: Response) => {
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

// Auto PR - Automatically create/update PR, merge base, and merge PR
router.post('/repos/:owner/:repo/branches/*/auto-pr', requireAuth, async (req: Request, res: Response) => {
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

    // If sessionId provided, soft-delete the session (move to trash)
    if (sessionId) {
      try {
        await db
          .update(chatSessions)
          .set({ deletedAt: new Date() })
          .where(
            and(
              eq(chatSessions.id, sessionId),
              eq(chatSessions.userId, authReq.user!.id),
              isNull(chatSessions.deletedAt)
            )
          );
        logger.info(`Session ${sessionId} moved to trash after successful Auto PR`, {
          component: 'GitHub'
        });
      } catch (sessionError) {
        logger.warn(`Failed to soft-delete session ${sessionId} after Auto PR`, {
          component: 'GitHub',
          error: sessionError instanceof Error ? sessionError.message : String(sessionError)
        });
      }
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

// Update/Create a file
router.put('/repos/:owner/:repo/contents/*', requireAuth, async (req: Request, res: Response) => {
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

// Rename a file (copy to new path, delete old)
router.post('/repos/:owner/:repo/rename/*', requireAuth, async (req: Request, res: Response) => {
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

// Delete a folder (delete all files in folder)
router.delete('/repos/:owner/:repo/folder/*', requireAuth, async (req: Request, res: Response) => {
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

// Rename a folder (copy all files to new path, delete old)
router.post('/repos/:owner/:repo/rename-folder/*', requireAuth, async (req: Request, res: Response) => {
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

// Delete a file
router.delete('/repos/:owner/:repo/contents/*', requireAuth, async (req: Request, res: Response) => {
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

// Commit files to GitHub - used by Code and Images editors
// This creates a commit directly via the GitHub API (no local git repo needed)
router.post('/repos/:owner/:repo/commit', requireAuth, async (req: Request, res: Response) => {
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

    if (!hasFiles && !hasImages) {
      res.status(400).json({ success: false, error: 'No files or images to commit' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    logger.info(`Starting commit for ${owner}/${repo}/${branch}`, {
      component: 'GitHub',
      fileCount: files?.length || 0,
      imageCount: images?.length || 0
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
    const treeEntries: Array<{
      path: string;
      mode: '100644';
      type: 'blob';
      sha?: string;
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
      const allPaths = [
        ...(files?.map((f: { path: string }) => f.path) || []),
        ...(images?.map((i: { path: string }) => i.path) || [])
      ];

      // Try to generate a commit message using AI
      try {
        // Get user's preferred provider and auth from database
        const userRecord = await db
          .select()
          .from(users)
          .where(eq(users.id, authReq.user!.id))
          .limit(1);

        const user = userRecord[0];
        const provider = user?.preferredProvider;
        let authentication: string | null = null;

        if (provider === 'claude' && user?.claudeAuth) {
          authentication = typeof user.claudeAuth === 'string' ? user.claudeAuth : JSON.stringify(user.claudeAuth);
        } else if (provider === 'codex' && user?.codexAuth) {
          authentication = typeof user.codexAuth === 'string' ? user.codexAuth : JSON.stringify(user.codexAuth);
        } else if (provider === 'gemini' && user?.geminiAuth) {
          authentication = typeof user.geminiAuth === 'string' ? user.geminiAuth : JSON.stringify(user.geminiAuth);
        }

        if (provider && authentication) {
          const aiWorkerClient = new AIWorkerClient();

          if (hasImages && !hasFiles) {
            // Image-only commit
            const imageChanges = images.map((img: { path: string; beforeContent?: string }) => ({
              path: img.path,
              beforeBase64: img.beforeContent,
              afterBase64: img.content
            }));
            commitMessage = await aiWorkerClient.generateImageCommitMessage(imageChanges, provider, authentication);
          } else {
            // Code files or mixed
            commitMessage = await aiWorkerClient.generateCommitMessageFromChanges(allPaths, provider, authentication);
          }
        }
      } catch (aiError) {
        logger.warn('Failed to generate AI commit message, using fallback', {
          component: 'GitHub',
          error: aiError instanceof Error ? aiError.message : String(aiError)
        });
      }

      // Fallback message
      if (!commitMessage) {
        const totalFiles = (files?.length || 0) + (images?.length || 0);
        commitMessage = `Update ${totalFiles} file(s)`;
      }
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

// Disconnect GitHub
router.post('/disconnect', requireAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthRequest;

    await db
      .update(users)
      .set({
        githubId: null,
        githubAccessToken: null,
      })
      .where(eq(users.id, authReq.user!.id));

    res.json({ success: true, data: { message: 'GitHub disconnected' } });
  } catch (error) {
    logger.error('GitHub disconnect error', error as Error, { component: 'GitHub' });
    res.status(500).json({ success: false, error: 'Failed to disconnect GitHub' });
  }
});

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
