/**
 * GitHub Route Helpers
 * Shared utilities for GitHub route handlers
 */

import { Request } from 'express';
import { ServiceProvider, AClaudeWebClient, withClaudeRemoteResilience, ensureValidToken, CLAUDE_ENVIRONMENT_ID, CLAUDE_API_BASE_URL, logger } from '@webedt/shared';
import type { ClaudeAuth } from '@webedt/shared';

/**
 * Helper function to get the frontend URL for redirects
 */
export function getFrontendUrl(path: string, storedOrigin?: string): string {
  if (storedOrigin) {
    return `${storedOrigin}${path}`;
  }
  const origin = process.env.ALLOWED_ORIGINS?.split(',')[0];
  if (origin) {
    return `${origin}${path}`;
  }
  return path;
}

/**
 * Helper to extract origin from request
 */
export function getRequestOrigin(req: Request): string {
  const protocol = req.protocol || 'https';
  const host = req.get('host') || req.get('x-forwarded-host') || '';
  return `${protocol}://${host}`;
}

/**
 * Helper function to archive Claude Remote session
 */
export async function archiveClaudeRemoteSession(
  remoteSessionId: string,
  claudeAuth: ClaudeAuth,
  environmentId?: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Refresh token if needed
    const refreshedAuth = await ensureValidToken(claudeAuth);

    const client = ServiceProvider.get(AClaudeWebClient);
    client.configure({
      accessToken: refreshedAuth.accessToken,
      environmentId: environmentId || CLAUDE_ENVIRONMENT_ID,
      baseUrl: CLAUDE_API_BASE_URL,
    });

    await withClaudeRemoteResilience(
      () => client.archiveSession(remoteSessionId),
      'archiveSession'
    );
    logger.info(`Archived Claude Remote session ${remoteSessionId}`, { component: 'GitHub' });
    return { success: true, message: 'Remote session archived' };
  } catch (error: unknown) {
    const err = error as { status?: number; message?: string };
    // 404 means session doesn't exist (already archived or never existed)
    if (err.status === 404) {
      logger.info(`Claude Remote session ${remoteSessionId} not found (already archived)`, { component: 'GitHub' });
      return { success: true, message: 'Remote session already archived or does not exist' };
    }
    // Handle circuit breaker rejection gracefully
    if (err.message?.includes('circuit breaker')) {
      logger.warn(`Claude Remote API unavailable for archiving session ${remoteSessionId}`, { component: 'GitHub' });
      return { success: false, message: 'Claude Remote API temporarily unavailable' };
    }
    logger.error(`Failed to archive Claude Remote session ${remoteSessionId}`, error as Error, { component: 'GitHub' });
    return { success: false, message: 'Failed to archive remote session' };
  }
}
