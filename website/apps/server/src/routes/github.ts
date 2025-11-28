import { Router } from 'express';
import type express from 'express';
import { Octokit } from '@octokit/rest';
import { db } from '../db/index';
import { users, chatSessions } from '../db/index';
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

// Delete a branch
router.delete('/repos/:owner/:repo/branches/:branch', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, branch } = req.params;

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

// Create a pull request
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

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });

    const { data: pr } = await octokit.pulls.create({
      owner,
      repo,
      title: title || `Merge ${head} into ${base}`,
      head,
      base,
      body: body || '',
    });

    console.log(`[GitHub] Created PR #${pr.number} for ${owner}/${repo}: ${head} -> ${base}`);

    res.json({
      success: true,
      data: {
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
        mergeable: pr.mergeable,
        merged: pr.merged,
      },
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; response?: { data?: { errors?: Array<{ message?: string }>; message?: string } } };
    console.error('GitHub create PR error:', error);

    // Handle case where PR already exists
    if (err.status === 422 && err.response?.data?.errors?.some((e: { message?: string }) => e.message?.includes('already exists'))) {
      res.status(409).json({ success: false, error: 'A pull request already exists for this branch' });
      return;
    }

    // Extract detailed error message from GitHub API response
    let errorMessage = 'Failed to create pull request';
    if (err.response?.data?.message) {
      errorMessage = err.response.data.message;
    } else if (err.response?.data?.errors && err.response.data.errors.length > 0) {
      const errorMessages = err.response.data.errors
        .map((e: { message?: string }) => e.message)
        .filter(Boolean)
        .join('; ');
      if (errorMessages) {
        errorMessage = errorMessages;
      }
    } else if (err.message) {
      errorMessage = err.message;
    }

    res.status(err.status || 500).json({ success: false, error: errorMessage });
  }
});

// Merge a pull request
router.post('/repos/:owner/:repo/pulls/:pull_number/merge', requireAuth, async (req, res) => {
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

    console.log(`[GitHub] Merged PR #${pull_number} for ${owner}/${repo}`);

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
    console.error('GitHub merge PR error:', error);

    if (err.status === 405) {
      res.status(405).json({ success: false, error: 'Pull request is not mergeable' });
      return;
    }
    if (err.status === 409) {
      res.status(409).json({ success: false, error: 'Merge conflict - head branch must be updated' });
      return;
    }

    res.status(500).json({ success: false, error: 'Failed to merge pull request' });
  }
});

// Merge base branch into feature branch (update branch)
router.post('/repos/:owner/:repo/branches/:branch/merge-base', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, branch } = req.params;
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

// Auto PR: Create PR, merge base branch, wait for mergeable, merge PR, and soft-delete session
router.post('/repos/:owner/:repo/branches/:branch/auto-pr', requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthRequest;
    const { owner, repo, branch } = req.params;
    const { base, title, body, sessionId } = req.body;

    if (!authReq.user?.githubAccessToken) {
      res.status(400).json({ success: false, error: 'GitHub not connected' });
      return;
    }

    if (!base) {
      res.status(400).json({ success: false, error: 'Base branch is required' });
      return;
    }

    const octokit = new Octokit({ auth: authReq.user.githubAccessToken });
    const results: {
      step: string;
      progress?: string;
      pr?: { number: number; htmlUrl: string };
      mergeBase?: { sha: string | null; message: string };
      mergePr?: { merged: boolean; sha: string };
    } = { step: 'started', progress: 'Starting Auto PR process...' };

    // Step 1: Check if PR already exists
    let prNumber: number | null = null;
    let prUrl: string | null = null;

    results.step = 'checking_pr';
    results.progress = 'Checking for existing pull request...';

    const { data: existingPulls } = await octokit.pulls.list({
      owner,
      repo,
      head: `${owner}:${branch}`,
      base,
      state: 'open',
    });

    if (existingPulls.length > 0) {
      prNumber = existingPulls[0].number;
      prUrl = existingPulls[0].html_url;
      console.log(`[GitHub] Using existing PR #${prNumber} for ${owner}/${repo}`);
      results.progress = `Found existing PR #${prNumber}`;
    } else {
      // Create new PR
      results.step = 'creating_pr';
      results.progress = 'Creating pull request...';

      try {
        const { data: pr } = await octokit.pulls.create({
          owner,
          repo,
          title: title || `Merge ${branch} into ${base}`,
          head: branch,
          base,
          body: body || '',
        });
        prNumber = pr.number;
        prUrl = pr.html_url;
        console.log(`[GitHub] Created PR #${prNumber} for ${owner}/${repo}`);
        results.progress = `Created PR #${prNumber}`;
      } catch (createError: unknown) {
        const createErr = createError as { status?: number; message?: string };
        // If no commits between branches, cannot create PR
        if (createErr.status === 422) {
          res.status(422).json({
            success: false,
            error: 'No commits between branches - nothing to merge'
          });
          return;
        }
        throw createError;
      }
    }

    results.step = 'pr_created';
    results.pr = { number: prNumber!, htmlUrl: prUrl! };

    // Step 2: Try to merge base into the feature branch (update branch)
    results.step = 'merging_base';
    results.progress = `Merging ${base} into ${branch}...`;

    try {
      const { data: mergeResult } = await octokit.repos.merge({
        owner,
        repo,
        base: branch,
        head: base,
        commit_message: `Merge ${base} into ${branch}`,
      });
      results.step = 'base_merged';
      results.mergeBase = { sha: mergeResult.sha, message: `Merged ${base} into ${branch}` };
      results.progress = `Successfully merged ${base} into ${branch}`;
      console.log(`[GitHub] Merged ${base} into ${branch}`);
    } catch (mergeError: unknown) {
      const mergeErr = mergeError as { status?: number; message?: string };
      // 204 = already up to date, 409 = conflict
      if (mergeErr.status === 204) {
        results.step = 'base_merged';
        results.mergeBase = { sha: null, message: 'Branch already up to date' };
        results.progress = `Branch ${branch} is already up to date with ${base}`;
      } else if (mergeErr.status === 409) {
        // Return partial success - PR created but needs manual conflict resolution
        res.status(409).json({
          success: false,
          error: 'Merge conflict when updating branch - manual resolution required',
          data: results,
        });
        return;
      } else {
        throw mergeError;
      }
    }

    // Step 3: Wait for PR to become mergeable
    results.step = 'waiting_mergeable';
    results.progress = 'Waiting for PR to be ready to merge...';

    let mergeable: boolean | null = null;
    let pollAttempts = 0;
    const maxPollAttempts = 30; // 30 seconds max (30 attempts * 1 second)

    while (pollAttempts < maxPollAttempts) {
      const { data: prStatus } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber!,
      });

      mergeable = prStatus.mergeable;

      if (mergeable === true) {
        results.progress = 'PR is ready to merge!';
        console.log(`[GitHub] PR #${prNumber} is mergeable after ${pollAttempts + 1} attempts`);
        break;
      } else if (mergeable === false) {
        // PR is explicitly not mergeable
        res.status(409).json({
          success: false,
          error: 'PR has merge conflicts or branch protection rules prevent merging',
          data: results,
        });
        return;
      }

      // mergeable is null - GitHub is still calculating
      pollAttempts++;
      results.progress = `Waiting for PR status... (${pollAttempts}/${maxPollAttempts})`;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (mergeable !== true) {
      res.status(408).json({
        success: false,
        error: 'Timeout waiting for PR to become mergeable - please try merging manually',
        data: results,
      });
      return;
    }

    // Step 4: Merge the PR
    results.step = 'merging_pr';
    results.progress = `Merging PR #${prNumber}...`;

    try {
      const { data: prMergeResult } = await octokit.pulls.merge({
        owner,
        repo,
        pull_number: prNumber!,
        merge_method: 'merge',
      });
      results.step = 'pr_merged';
      results.mergePr = { merged: prMergeResult.merged, sha: prMergeResult.sha };
      results.progress = `Successfully merged PR #${prNumber} into ${base}`;
      console.log(`[GitHub] Merged PR #${prNumber} for ${owner}/${repo}`);
    } catch (prMergeError: unknown) {
      const prMergeErr = prMergeError as { status?: number; message?: string };
      if (prMergeErr.status === 405) {
        res.status(405).json({
          success: false,
          error: 'PR is not mergeable - check branch protection rules',
          data: results,
        });
        return;
      }
      if (prMergeErr.status === 409) {
        res.status(409).json({
          success: false,
          error: 'Merge conflict when merging PR',
          data: results,
        });
        return;
      }
      throw prMergeError;
    }

    // Step 5: Soft-delete the session (if sessionId provided)
    if (sessionId) {
      results.step = 'deleting_session';
      results.progress = 'Cleaning up session...';

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
          // Soft delete the session
          await db
            .update(chatSessions)
            .set({ deletedAt: new Date() })
            .where(eq(chatSessions.id, sessionId));

          console.log(`[GitHub] Soft-deleted session ${sessionId} after Auto PR`);
          results.progress = 'Session moved to trash';
        } else {
          console.log(`[GitHub] Session ${sessionId} not found or access denied - skipping deletion`);
        }
      } catch (deleteError) {
        // Log error but don't fail the entire operation - PR was already merged successfully
        console.error(`[GitHub] Failed to soft-delete session ${sessionId}:`, deleteError);
        results.progress = 'Session cleanup skipped (non-critical error)';
      }
    }

    results.step = 'completed';
    results.progress = 'Auto PR completed successfully!';

    res.json({
      success: true,
      data: results,
    });
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string; response?: { data?: { errors?: Array<{ message?: string }>; message?: string } } };
    console.error('GitHub auto PR error:', error);

    // Extract detailed error message from GitHub API response
    let errorMessage = 'Failed to complete auto PR';
    if (err.response?.data?.message) {
      errorMessage = err.response.data.message;
    } else if (err.response?.data?.errors && err.response.data.errors.length > 0) {
      const errorMessages = err.response.data.errors
        .map((e: { message?: string }) => e.message)
        .filter(Boolean)
        .join('; ');
      if (errorMessages) {
        errorMessage = errorMessages;
      }
    } else if (err.message) {
      errorMessage = err.message;
    }

    res.status(err.status || 500).json({ success: false, error: errorMessage });
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
