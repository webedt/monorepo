import { db, users, eq } from '../db/index.js';
import { logger } from '../utils/logging/logger.js';

import { ATokenRefreshService } from './ATokenRefreshService.js';
import { ensureValidToken, shouldRefreshClaudeToken, isClaudeAuthDb } from './claudeAuth.js';

import type { ClaudeAuth } from './claudeAuth.js';

export class TokenRefreshService extends ATokenRefreshService {
  async ensureValidTokenForUser(
    userId: string,
    claudeAuth: ClaudeAuth
  ): Promise<ClaudeAuth> {
    const refreshedAuth = await this.refreshTokenIfNeeded(claudeAuth);

    if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
      // Validate that refreshed auth has required fields for database storage
      if (!isClaudeAuthDb(refreshedAuth)) {
        logger.warn('Refreshed token missing required fields for database storage', {
          component: 'TokenRefreshService',
          userId,
          hasRefreshToken: !!refreshedAuth.refreshToken,
          hasExpiresAt: !!refreshedAuth.expiresAt,
        });
        // Return the refreshed auth without persisting (will use in-memory only)
        return refreshedAuth;
      }

      await db
        .update(users)
        .set({ claudeAuth: refreshedAuth })
        .where(eq(users.id, userId));

      logger.info('Token refreshed and saved to database', {
        component: 'TokenRefreshService',
        userId,
      });
    }

    return refreshedAuth;
  }

  async refreshTokenIfNeeded(claudeAuth: ClaudeAuth): Promise<ClaudeAuth> {
    return ensureValidToken(claudeAuth);
  }

  shouldRefresh(claudeAuth: ClaudeAuth): boolean {
    return shouldRefreshClaudeToken(claudeAuth);
  }
}

export const tokenRefreshService = new TokenRefreshService();
