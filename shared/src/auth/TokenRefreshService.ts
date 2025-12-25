import { db, users, eq } from '../db/index.js';
import { logger } from '../utils/logging/logger.js';

import { ATokenRefreshService } from './ATokenRefreshService.js';
import { ensureValidToken, shouldRefreshClaudeToken } from './claudeAuth.js';

import type { ClaudeAuth } from './claudeAuth.js';

export class TokenRefreshService extends ATokenRefreshService {
  async ensureValidTokenForUser(
    userId: string,
    claudeAuth: ClaudeAuth
  ): Promise<ClaudeAuth> {
    const refreshedAuth = await this.refreshTokenIfNeeded(claudeAuth);

    if (refreshedAuth.accessToken !== claudeAuth.accessToken) {
      await db
        .update(users)
        .set({ claudeAuth: refreshedAuth as unknown as typeof users.$inferInsert['claudeAuth'] })
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
