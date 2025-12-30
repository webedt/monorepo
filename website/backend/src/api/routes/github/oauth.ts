/**
 * GitHub OAuth Routes
 * Handles GitHub OAuth flow for connecting user accounts
 */

import { Router, Request, Response } from 'express';
import { Octokit } from '@octokit/rest';
import { db, users, eq, logger } from '@webedt/shared';
import { requireAuth } from '../../middleware/auth.js';
import type { AuthRequest } from '../../middleware/auth.js';
import { getFrontendUrl, getRequestOrigin } from './helpers.js';

const router = Router();

/**
 * @openapi
 * /github/oauth:
 *   get:
 *     tags:
 *       - GitHub
 *     summary: Initiate GitHub OAuth
 *     description: Redirects user to GitHub for OAuth authorization. Returns user to the origin page after completion.
 *     responses:
 *       302:
 *         description: Redirect to GitHub OAuth page
 *       401:
 *         $ref: '#/components/responses/Unauthorized'
 */
router.get('/oauth', requireAuth, (req: Request, res: Response) => {
  const authReq = req as AuthRequest;

  const referer = req.get('referer') || req.get('origin');
  let returnOrigin = getRequestOrigin(req);
  let returnPath = '/settings'; // Default to settings page

  if (referer) {
    try {
      const refererUrl = new URL(referer);
      returnOrigin = refererUrl.origin;
      // Extract the hash path (e.g., #/settings -> /settings)
      if (refererUrl.hash) {
        returnPath = refererUrl.hash.slice(1); // Remove the # prefix
      }
    } catch {
      // Fall back to request origin
    }
  }

  const state = Buffer.from(JSON.stringify({
    sessionId: authReq.authSession!.id,
    userId: authReq.user!.id,
    timestamp: Date.now(),
    returnOrigin,
    returnPath,
  })).toString('base64');

  // Build redirect URI dynamically based on returnOrigin
  const redirectUri = `${returnOrigin}/api/github/oauth/callback`;

  const params = new URLSearchParams({
    client_id: process.env.GITHUB_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: 'repo workflow user:email',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
});

/**
 * GitHub OAuth callback
 */
router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      res.redirect(getFrontendUrl('/#/login?error=missing_params'));
      return;
    }

    let stateData: {
      sessionId: string;
      userId: string;
      timestamp: number;
      returnOrigin?: string;
      returnPath?: string;
    };
    try {
      stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    } catch {
      res.redirect(getFrontendUrl('/#/login?error=invalid_state'));
      return;
    }

    // Check if state is not too old (10 minute timeout)
    if (Date.now() - stateData.timestamp > 10 * 60 * 1000) {
      res.redirect(getFrontendUrl('/#/login?error=state_expired', stateData.returnOrigin));
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
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
      }),
    });

    const tokenData = (await tokenResponse.json()) as {
      access_token?: string;
      error?: string;
    };

    if (tokenData.error) {
      const errorReturnPath = stateData.returnPath || '/settings';
      // Use hash-based routing: /#/path?query
      res.redirect(getFrontendUrl(`/#${errorReturnPath}?error=${tokenData.error}`, stateData.returnOrigin));
      return;
    }

    const accessToken = tokenData.access_token;

    // Get GitHub user info
    const octokit = new Octokit({ auth: accessToken });
    const { data: githubUser } = await octokit.users.getAuthenticated();

    const githubIdStr = String(githubUser.id);

    // First, remove GitHub connection from any existing user with this GitHub ID
    // This allows transferring GitHub connection between accounts
    await db
      .update(users)
      .set({
        githubId: null,
        githubAccessToken: null,
      })
      .where(eq(users.githubId, githubIdStr));

    // Update current user with GitHub info
    await db
      .update(users)
      .set({
        githubId: githubIdStr,
        githubAccessToken: accessToken,
      })
      .where(eq(users.id, stateData.userId));

    const returnPath = stateData.returnPath || '/settings';
    // Use hash-based routing: /#/path?query
    res.redirect(getFrontendUrl(`/#${returnPath}?success=github_connected`, stateData.returnOrigin));
  } catch (error) {
    logger.error('GitHub OAuth error', error as Error, { component: 'GitHub' });
    // Use hash-based routing for error redirect
    res.redirect(getFrontendUrl('/#/settings?error=oauth_failed'));
  }
});

/**
 * Disconnect GitHub
 */
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

export default router;
