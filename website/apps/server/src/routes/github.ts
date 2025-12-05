import { Router } from 'express';
import type express from 'express';
import { Octokit } from '@octokit/rest';
import { db } from '../db/index';
import { users, chatSessions, events } from '../db/index';
import { eq, and, isNull } from 'drizzle-orm';
import type { AuthRequest } from '../middleware/auth';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Helper function to get the frontend URL for redirects
// Supports: ALLOWED_ORIGINS config, stored origin from state, or relative URLs
function getFrontendUrl(path: string, storedOrigin?: string): string {
  // Priority 1: Use origin from OAuth state (supports preview environments)
  if (storedOrigin) {
    return `${storedOrigin}${path}`;
  }
  // Priority 2: Use ALLOWED_ORIGINS from env config
  const origin = process.env.ALLOWED_ORIGINS?.split(',')[0];
  if (origin) {
    return `${origin}${path}`;
  }
  // Priority 3: Fallback to relative URL if nothing is configured
  return path;
}

// Helper to extract origin from request (protocol + host)
function getRequestOrigin(req: express.Request): string {
  const protocol = req.protocol || 'https';
  const host = req.get('host') || req.get('x-forwarded-host') || '';
  return `${protocol}://${host}`;
}

// Initiate GitHub OAuth
router.get('/oauth', requireAuth, (req, res) => {
  const authReq = req as AuthRequest;

  // Get the origin from Referer header or request origin
  // This supports preview environments like /preview1, /preview2, etc.
  const referer = req.get('referer') || req.get('origin');
  let returnOrigin = getRequestOrigin(req);

  // If we have a referer, extract its origin (protocol + host)
  if (referer) {
    try {
      const refererUrl = new URL(referer);
      returnOrigin = refererUrl.origin;
    } catch (e) {
      // If referer is invalid, fall back to request origin
    }
  }

  // Encode user session ID and return origin in state for retrieval in callback
  const state = Buffer.from(JSON.stringify({
    sessionId: authReq.session!.id,
    userId: authReq.user!.id,
    timestamp: Date.now(),
    returnOrigin, // Store where the user came from
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
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      res.redirect(getFrontendUrl('/login?error=missing_params'));
      return;
    }

    // Decode and validate state parameter
    let stateData: {
      sessionId: string;
      userId: string;
      timestamp: number;
      returnOrigin?: string; // Optional for backwards compatibility
    };
    try {
      stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    } catch (error) {
      res.redirect(getFrontendUrl('/login?error=invalid_state'));
      return;
    }

    // Check if state is not too old (prevent replay attacks) - 10 minute timeout
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

    // Update user with GitHub info using userId from state
    await db
      .update(users)
      .set({
        githubId: String(githubUser.id),
        githubAccessToken: accessToken,
      })
      .where(eq(users.id, stateData.userId));

    res.redirect(getFrontendUrl('/settings?success=github_connected', stateData.returnOrigin));
  } catch (error) {
    console.error('GitHub OAuth error:', error);
    res.redirect(getFrontendUrl('/settings?error=oauth_failed'));
  }
});

// Get user's repositories
router.get('/repos', requireAuth, async (req, res) => {
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
    console.error('GitHub repos error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch repositories' });
  }
});

// Get repository branches
router.get('/repos/:owner/:repo/branches', requireAuth, async (req, res) => {
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
    console.error('GitHub branches error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch branches' });
  }
});

// Create a new branch
router.post('/repos/:owner/:repo/branches', requireAuth, async (req, res) => {
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

    // Get the SHA of the base branch
    const base = baseBranch || 'main';
    const { data: baseBranchData } = await octokit.repos.getBranch({
      owner,
      repo,
      branch: base,
    });

    // Create the new branch
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseBranchData.commit.sha,
    });

    console.log(`[GitHub] Created branch ${branchName} from ${base} in ${owner}/${repo}`);

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
    console.error('GitHub create branch error:', error);

    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'Branch already exists' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to create branch' });
  }
});

// Get repository file tree
// Note: Using wildcard (*) for branch because branch names can contain slashes
router.get('/repos/:owner/:repo/tree/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const branch = req.params[0]; // The branch name (can contain slashes)
    const { recursive } = req.query;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Get the tree SHA from the branch
    const { data: branchData } = await octokit.repos.getBranch({
      owner,
      repo,
      branch,
    });
    const treeSha = branchData.commit.commit.tree.sha;

    // Get the tree
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: treeSha,
      recursive: recursive === 'true' ? 'true' : undefined,
    });

    console.log(`[GitHub] Fetched tree for ${owner}/${repo}/${branch} (${tree.tree.length} items)`);

    res.json({
      success: true,
      data: {
        sha: tree.sha,
        tree: tree.tree.map((item) => ({
          path: item.path,
          type: item.type, // 'blob' for files, 'tree' for directories
          sha: item.sha,
          size: item.size,
        })),
        truncated: tree.truncated,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    console.error('GitHub get tree error:', error);

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Branch or repository not found' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to fetch file tree' });
  }
});

// Get file contents
// Note: Using wildcard (*) for the file path
router.get('/repos/:owner/:repo/contents/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const path = req.params[0]; // The file path
    const { ref } = req.query; // Branch/commit ref

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

    // Handle file content (not directory)
    if (!Array.isArray(data) && data.type === 'file') {
      // Check if this is a binary file (image, etc.) based on extension
      const ext = data.name.split('.').pop()?.toLowerCase() || '';
      const binaryExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'svg', 'pdf', 'zip', 'tar', 'gz', 'woff', 'woff2', 'ttf', 'eot', 'mp3', 'mp4', 'wav', 'ogg', 'webm'];
      const isBinary = binaryExtensions.includes(ext);

      if (isBinary && data.encoding === 'base64' && data.content) {
        // Keep base64 encoding for binary files
        // Remove any whitespace/newlines that GitHub adds to the base64 content
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
        // Decode base64 content to UTF-8 for text files
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
      // Directory listing
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
    console.error('GitHub get contents error:', error);

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'File or path not found' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to fetch file contents' });
  }
});

// Delete a branch
// Note: Using wildcard (*) for branch because branch names can contain slashes (e.g., "user/feature-branch")
router.delete('/repos/:owner/:repo/branches/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    // Express stores the wildcard match in params[0]
    const branch = req.params[0];

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Delete the branch using the git references API
    await octokit.git.deleteRef({
      owner,
      repo,
      ref: `heads/${branch}`,
    });

    console.log(`[GitHub] Deleted branch ${owner}/${repo}/${branch}`);
    res.json({ success: true, data: { message: 'Branch deleted' } });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // 422 means the branch doesn't exist (already deleted or never existed)
    if (err.status === 422 || err.status === 404) {
      console.log(`[GitHub] Branch ${req.params.owner}/${req.params.repo}/${req.params.branch} not found (already deleted)`);
      res.json({ success: true, data: { message: 'Branch already deleted or does not exist' } });
      return;
    }
    console.error('GitHub delete branch error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete branch' });
  }
});

// Get pull request for a branch
router.get('/repos/:owner/:repo/pulls', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const { head, base } = req.query;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // List PRs filtered by head branch
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
      mergeable: (pr as any).mergeable ?? null,
      merged: (pr as any).merged ?? false,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
    }));

    res.json({ success: true, data: formattedPulls });
  } catch (error) {
    console.error('GitHub get pulls error:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch pull requests' });
  }
});

// Generate PR title and description
router.post('/repos/:owner/:repo/generate-pr-content', requireAuth, async (req, res) => {
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

    // Get the comparison between base and head to fetch commits and changes
    const { data: comparison } = await octokit.repos.compareCommits({
      owner,
      repo,
      base,
      head,
    });

    // Generate title
    let title = userRequest || `Merge ${head} into ${base}`;

    // Truncate title if too long (GitHub recommends max 72 chars for PR titles)
    if (title.length > 72) {
      title = title.substring(0, 69) + '...';
    }

    // Generate description
    const commits = comparison.commits || [];
    const files = comparison.files || [];

    let body = '';

    // Add user request summary if available
    if (userRequest) {
      body += `## Summary\n\n${userRequest}\n\n`;
    }

    // Add commits section
    if (commits.length > 0) {
      body += `## Commits (${commits.length})\n\n`;
      commits.forEach(commit => {
        const message = commit.commit.message.split('\n')[0]; // First line only
        const sha = commit.sha.substring(0, 7);
        const author = commit.commit.author?.name || 'Unknown';
        body += `- \`${sha}\` ${message} - ${author}\n`;
      });
      body += '\n';
    }

    // Add changes summary
    if (files.length > 0) {
      const additions = files.reduce((sum, file) => sum + (file.additions || 0), 0);
      const deletions = files.reduce((sum, file) => sum + (file.deletions || 0), 0);

      body += `## Changes\n\n`;
      body += `**${files.length}** files changed, **${additions}** insertions(+), **${deletions}** deletions(-)\n\n`;

      // Group files by status
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

    // Add footer
    body += `---\n\n*This pull request was generated automatically*`;

    console.log(`[GitHub] Generated PR content for ${owner}/${repo}: ${head} -> ${base}`);

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
    console.error('GitHub generate PR content error:', error);

    res.status(err.status || 500).json({
      success: false,
      error: err.message || 'Failed to generate PR content'
    });
  }
});

// Create a pull request (via github-worker)
router.post('/repos/:owner/:repo/pulls', requireAuth, async (req, res) => {
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

    const githubWorkerUrl = process.env.GITHUB_WORKER_URL || 'http://localhost:5002';

    console.log(`[GitHub] Forwarding create PR request to github-worker: ${owner}/${repo} ${head} -> ${base}`);

    // Call github-worker with SSE streaming
    const response = await fetch(`${githubWorkerUrl}/create-pull-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        owner,
        repo,
        title: title || `Merge ${head} into ${base}`,
        head,
        base,
        body: body || '',
        githubAccessToken: authReq.user.githubAccessToken,
      }),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      console.error(`[GitHub] github-worker create PR error: ${response.status} ${errorText}`);
      res.status(response.status || 500).json({ success: false, error: errorText || 'Failed to create pull request' });
      return;
    }

    // Parse SSE response from github-worker
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: any = null;
    let errorData: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const eventData = JSON.parse(line.substring(5).trim());
            if (eventData.type === 'completed' && eventData.data) {
              result = eventData.data;
            } else if (eventData.type === 'error') {
              errorData = eventData;
            }
          } catch (e) {
            // Non-JSON data, skip
          }
        }
      }
    }

    if (errorData) {
      console.error(`[GitHub] github-worker create PR error: ${errorData.error}`);
      const statusCode = errorData.code === 'PR_EXISTS' ? 409 : 500;
      res.status(statusCode).json({ success: false, error: errorData.error });
      return;
    }

    if (result) {
      console.log(`[GitHub] Created PR #${result.number} via github-worker for ${owner}/${repo}: ${head} -> ${base}`);
      res.json({ success: true, data: result });
    } else {
      res.status(500).json({ success: false, error: 'No response from github-worker' });
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('GitHub create PR error:', error);
    res.status(500).json({ success: false, error: err.message || 'Failed to create pull request' });
  }
});

// Merge a pull request (via github-worker)
router.post('/repos/:owner/:repo/pulls/:pull_number/merge', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, pull_number } = req.params;
    const { merge_method, commit_title, commit_message } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    const githubWorkerUrl = process.env.GITHUB_WORKER_URL || 'http://localhost:5002';

    console.log(`[GitHub] Forwarding merge PR request to github-worker: ${owner}/${repo} PR #${pull_number}`);

    // Call github-worker with SSE streaming
    const response = await fetch(`${githubWorkerUrl}/merge-pull-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        owner,
        repo,
        pullNumber: parseInt(pull_number, 10),
        mergeMethod: merge_method || 'merge',
        commitTitle: commit_title,
        commitMessage: commit_message,
        githubAccessToken: authReq.user.githubAccessToken,
      }),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      console.error(`[GitHub] github-worker merge PR error: ${response.status} ${errorText}`);
      res.status(response.status || 500).json({ success: false, error: errorText || 'Failed to merge pull request' });
      return;
    }

    // Parse SSE response from github-worker
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: any = null;
    let errorData: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const eventData = JSON.parse(line.substring(5).trim());
            if (eventData.type === 'completed' && eventData.data) {
              result = eventData.data;
            } else if (eventData.type === 'error') {
              errorData = eventData;
            }
          } catch (e) {
            // Non-JSON data, skip
          }
        }
      }
    }

    if (errorData) {
      console.error(`[GitHub] github-worker merge PR error: ${errorData.error}`);
      let statusCode = 500;
      if (errorData.code === 'PR_NOT_MERGEABLE') statusCode = 405;
      if (errorData.code === 'MERGE_CONFLICT') statusCode = 409;
      res.status(statusCode).json({ success: false, error: errorData.error });
      return;
    }

    if (result) {
      console.log(`[GitHub] Merged PR #${pull_number} via github-worker for ${owner}/${repo}`);
      res.json({ success: true, data: result });
    } else {
      res.status(500).json({ success: false, error: 'No response from github-worker' });
    }
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('GitHub merge PR error:', error);
    res.status(500).json({ success: false, error: err.message || 'Failed to merge pull request' });
  }
});

// Merge base branch into feature branch (update branch)
// Note: Using wildcard (*) for branch because branch names can contain slashes (e.g., "user/feature-branch")
router.post('/repos/:owner/:repo/branches/*/merge-base', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    // Express stores the wildcard match in params[0]
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

    // Use the merge API to merge base into the feature branch
    const { data: result } = await octokit.repos.merge({
      owner,
      repo,
      base: branch, // The branch to merge into (feature branch)
      head: base,   // The branch to merge from (base branch like main)
      commit_message: `Merge ${base} into ${branch}`,
    });

    console.log(`[GitHub] Merged ${base} into ${branch} for ${owner}/${repo}`);

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
    console.error('GitHub merge base error:', error);

    // 204 means nothing to merge (already up to date)
    if (err.status === 204) {
      res.json({ success: true, data: { message: 'Branch is already up to date', sha: null } });
      return;
    }
    // 409 means merge conflict
    if (err.status === 409) {
      res.status(409).json({ success: false, error: 'Merge conflict - manual resolution required' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to merge base branch' });
  }
});

// Helper function to save auto PR log to database
async function saveAutoPrLog(
  sessionId: string | undefined,
  step: string,
  data: Record<string, any>
): Promise<void> {
  if (!sessionId) return;

  try {
    await db.insert(events).values({
      chatSessionId: sessionId,
      eventType: 'auto_pr_progress',
      eventData: {
        step,
        ...data,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    // Log error but don't fail the auto PR process
    console.error(`[GitHub] Failed to save auto PR log for session ${sessionId}:`, error);
  }
}

// Auto PR: Create PR, merge base branch, wait for mergeable, merge PR, and soft-delete session (via github-worker)
// Note: Using wildcard (*) for branch because branch names can contain slashes (e.g., "user/feature-branch")
router.post('/repos/:owner/:repo/branches/*/auto-pr', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    // Express stores the wildcard match in params[0]
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

    const githubWorkerUrl = process.env.GITHUB_WORKER_URL || 'http://localhost:5002';

    console.log(`[GitHub] Forwarding auto PR request to github-worker: ${owner}/${repo} ${branch} -> ${base}`);

    // Log the start of auto PR process
    await saveAutoPrLog(sessionId, 'started', {
      owner,
      repo,
      branch,
      base,
      title,
      userId: authReq.user!.id,
    });

    // Call github-worker with SSE streaming
    const response = await fetch(`${githubWorkerUrl}/auto-pull-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        owner,
        repo,
        branch,
        base,
        title: title || `Merge ${branch} into ${base}`,
        body: body || '',
        githubAccessToken: authReq.user.githubAccessToken,
      }),
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      console.error(`[GitHub] github-worker auto PR error: ${response.status} ${errorText}`);

      await saveAutoPrLog(sessionId, 'error', {
        error: errorText || 'Failed to complete auto PR',
        status: response.status,
      });

      res.status(response.status || 500).json({ success: false, error: errorText || 'Failed to complete auto PR' });
      return;
    }

    // Parse SSE response from github-worker
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: any = null;
    let errorData: any = null;
    let lastProgress: any = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data:')) {
          try {
            const eventData = JSON.parse(line.substring(5).trim());

            // Log progress events to database
            if (eventData.type === 'progress') {
              lastProgress = eventData;
              await saveAutoPrLog(sessionId, eventData.stage, {
                message: eventData.message,
              });
            }

            if (eventData.type === 'completed' && eventData.data) {
              result = eventData.data;
            } else if (eventData.type === 'error') {
              errorData = eventData;
            }
          } catch (e) {
            // Non-JSON data, skip
          }
        }
      }
    }

    if (errorData) {
      console.error(`[GitHub] github-worker auto PR error: ${errorData.error}`);

      await saveAutoPrLog(sessionId, 'error', {
        error: errorData.error,
        code: errorData.code,
      });

      let statusCode = 500;
      if (errorData.code === 'NO_COMMITS') statusCode = 422;
      if (errorData.code === 'MERGE_CONFLICT') statusCode = 409;
      if (errorData.code === 'PR_NOT_MERGEABLE') statusCode = 409;
      if (errorData.code === 'TIMEOUT') statusCode = 408;

      res.status(statusCode).json({ success: false, error: errorData.error });
      return;
    }

    if (!result) {
      res.status(500).json({ success: false, error: 'No response from github-worker' });
      return;
    }

    console.log(`[GitHub] Auto PR completed via github-worker for ${owner}/${repo}: ${branch} -> ${base}`);

    // Step 6: Soft-delete the session (if sessionId provided) - this stays on the website server
    if (sessionId) {
      try {
        // Verify session ownership before deleting
        const [session] = await db
          .select()
          .from(chatSessions)
          .where(
            and(
              eq(chatSessions.id, sessionId),
              isNull(chatSessions.deletedAt)
            )
          )
          .limit(1);

        if (session && session.userId === authReq.user!.id) {
          // Soft delete the session (branch already deleted by github-worker)
          await db
            .update(chatSessions)
            .set({ deletedAt: new Date() })
            .where(eq(chatSessions.id, sessionId));

          console.log(`[GitHub] Soft-deleted session ${sessionId} after Auto PR`);
          result.progress = 'Session moved to trash';

          await saveAutoPrLog(sessionId, 'session_deleted', {
            message: 'Session moved to trash after successful merge',
          });
        } else {
          console.log(`[GitHub] Session ${sessionId} not found or access denied - skipping deletion`);

          await saveAutoPrLog(sessionId, 'session_deletion_skipped', {
            reason: 'Session not found or access denied',
          });
        }
      } catch (deleteError) {
        // Log error but don't fail the entire operation - PR was already merged successfully
        console.error(`[GitHub] Failed to soft-delete session ${sessionId}:`, deleteError);
        result.progress = 'Session cleanup skipped (non-critical error)';
      }
    }

    await saveAutoPrLog(sessionId, 'completed', {
      prNumber: result.pr?.number,
      prUrl: result.pr?.htmlUrl,
      message: 'Auto PR completed successfully!',
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error: unknown) {
    const err = error as { message?: string };
    console.error('GitHub auto PR error:', error);

    const { sessionId } = req.body;
    await saveAutoPrLog(sessionId, 'error', {
      error: err.message || 'Failed to complete auto PR',
    });

    res.status(500).json({ success: false, error: err.message || 'Failed to complete auto PR' });
  }
});

// Delete a file
// Note: Using wildcard (*) for the file path
router.delete('/repos/:owner/:repo/contents/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const path = req.params[0]; // The file path
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

    // If sha is not provided, fetch it first
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

    // Delete the file
    await octokit.repos.deleteFile({
      owner,
      repo,
      path,
      message: message || `Delete ${path}`,
      sha: fileSha!,
      branch,
    });

    console.log(`[GitHub] Deleted file ${path} in ${owner}/${repo}/${branch}`);

    res.json({
      success: true,
      data: { message: 'File deleted successfully' },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    console.error('GitHub delete file error:', error);

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

// Rename/move a file (create new file with contents, delete old file)
// Note: Using wildcard (*) for the file path
router.post('/repos/:owner/:repo/rename/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const oldPath = req.params[0]; // The original file path
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

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Get the current file content
    let fileContent: string;
    let fileSha: string;
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path: oldPath,
        ref: branch,
      });
      if (Array.isArray(data) || data.type !== 'file') {
        res.status(400).json({ success: false, error: 'Cannot rename a directory directly' });
        return;
      }
      fileContent = data.content || '';
      fileSha = data.sha;
    } catch (error: unknown) {
      const err = error as { status?: number };
      if (err.status === 404) {
        res.status(404).json({ success: false, error: 'File not found' });
        return;
      }
      throw error;
    }

    // Create the new file with the same content
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: newPath,
      message: message || `Rename ${oldPath} to ${newPath}`,
      content: fileContent, // Already base64 encoded from getContent
      branch,
    });

    // Delete the old file
    await octokit.repos.deleteFile({
      owner,
      repo,
      path: oldPath,
      message: message || `Rename ${oldPath} to ${newPath} (delete old)`,
      sha: fileSha,
      branch,
    });

    console.log(`[GitHub] Renamed file ${oldPath} to ${newPath} in ${owner}/${repo}/${branch}`);

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
    console.error('GitHub rename file error:', error);

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'File or repository not found' });
      return;
    }
    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'A file already exists at the new path' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to rename file' });
  }
});

// Update/Create a file
// Note: Using wildcard (*) for the file path
router.put('/repos/:owner/:repo/contents/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const path = req.params[0]; // The file path
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

    // Convert content to base64
    const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');

    // If sha is not provided, try to get the current file's sha (for updates)
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
        // 404 is fine - it means we're creating a new file
        if (err.status !== 404) {
          throw error;
        }
      }
    }

    // Create or update the file
    const result = await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path,
      message: message || `Update ${path}`,
      content: contentBase64,
      branch,
      sha: fileSha, // Will be undefined for new files
    });

    console.log(`[GitHub] Updated file ${path} in ${owner}/${repo}/${branch}`);

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
    console.error('GitHub update file error:', error);

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

// Delete a folder (delete all files recursively)
// Note: Using wildcard (*) for the folder path
router.delete('/repos/:owner/:repo/folder/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const folderPath = req.params[0]; // The folder path
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

    // Get the tree for this branch to find all files in the folder
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
      recursive: 'true',
    });

    // Find all files in the folder
    const filesToDelete = tree.tree.filter(item =>
      item.type === 'blob' && item.path?.startsWith(folderPath + '/')
    );

    if (filesToDelete.length === 0) {
      res.status(404).json({ success: false, error: 'Folder is empty or not found' });
      return;
    }

    // Delete files one by one (GitHub doesn't support batch delete)
    // We need to delete in reverse order to handle nested structures
    const sortedFiles = filesToDelete.sort((a, b) =>
      (b.path?.length || 0) - (a.path?.length || 0)
    );

    for (const file of sortedFiles) {
      if (!file.path || !file.sha) continue;

      try {
        await octokit.repos.deleteFile({
          owner,
          repo,
          path: file.path,
          message: message || `Delete ${file.path} (part of folder deletion)`,
          sha: file.sha,
          branch,
        });
      } catch (deleteError: unknown) {
        const delErr = deleteError as { status?: number };
        // Continue if file already deleted
        if (delErr.status !== 404) {
          throw deleteError;
        }
      }
    }

    console.log(`[GitHub] Deleted folder ${folderPath} (${filesToDelete.length} files) in ${owner}/${repo}/${branch}`);

    res.json({
      success: true,
      data: {
        message: 'Folder deleted successfully',
        filesDeleted: filesToDelete.length,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    console.error('GitHub delete folder error:', error);

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Folder or repository not found' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to delete folder' });
  }
});

// Rename a folder (rename all files in it)
// Note: Using wildcard (*) for the folder path
router.post('/repos/:owner/:repo/rename-folder/*', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo } = req.params;
    const oldFolderPath = req.params[0]; // The original folder path
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

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    // Get the tree for this branch to find all files in the folder
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
      recursive: 'true',
    });

    // Find all files in the folder
    const filesToRename = tree.tree.filter(item =>
      item.type === 'blob' && item.path?.startsWith(oldFolderPath + '/')
    );

    if (filesToRename.length === 0) {
      res.status(404).json({ success: false, error: 'Folder is empty or not found' });
      return;
    }

    // Process files: create new, then delete old
    for (const file of filesToRename) {
      if (!file.path || !file.sha) continue;

      const newPath = file.path.replace(oldFolderPath, newFolderPath);

      // Get file content
      const { data: fileData } = await octokit.repos.getContent({
        owner,
        repo,
        path: file.path,
        ref: branch,
      });

      if (Array.isArray(fileData) || fileData.type !== 'file') continue;

      // Create file at new location
      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: newPath,
        message: message || `Rename folder: move ${file.path} to ${newPath}`,
        content: fileData.content || '',
        branch,
      });

      // Delete old file
      await octokit.repos.deleteFile({
        owner,
        repo,
        path: file.path,
        message: message || `Rename folder: delete old ${file.path}`,
        sha: file.sha,
        branch,
      });
    }

    console.log(`[GitHub] Renamed folder ${oldFolderPath} to ${newFolderPath} (${filesToRename.length} files) in ${owner}/${repo}/${branch}`);

    res.json({
      success: true,
      data: {
        message: 'Folder renamed successfully',
        filesRenamed: filesToRename.length,
        oldPath: oldFolderPath,
        newPath: newFolderPath,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    console.error('GitHub rename folder error:', error);

    if (err.status === 404) {
      res.status(404).json({ success: false, error: 'Folder or repository not found' });
      return;
    }
    if (err.status === 422) {
      res.status(422).json({ success: false, error: 'A folder already exists at the new path' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to rename folder' });
  }
});

// Disconnect GitHub
router.post('/disconnect', requireAuth, async (req, res) => {
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
    console.error('GitHub disconnect error:', error);
    res.status(500).json({ success: false, error: 'Failed to disconnect GitHub' });
  }
});

export default router;
