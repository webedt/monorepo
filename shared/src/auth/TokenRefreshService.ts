import { db, users, eq } from '../db/index.js';
import { logger } from '../utils/logging/logger.js';

import { ATokenRefreshService } from './ATokenRefreshService.js';
import { ensureValidToken, shouldRefreshClaudeToken, isClaudeAuthDb } from './claudeAuth.js';
import { ensureValidGeminiToken, shouldRefreshGeminiToken } from './geminiAuth.js';

import type { ClaudeAuth } from './claudeAuth.js';
import type { GeminiAuth } from './lucia.js';

export class TokenRefreshService extends ATokenRefreshService {
  /**
   * Ensure Claude token is valid for a user, refreshing and persisting if needed.
   * This is the single source of truth for Claude token refresh with database persistence.
   *
   * @param userId - The user ID to update in the database
   * @param claudeAuth - The current Claude authentication credentials
   * @returns The valid (possibly refreshed) Claude authentication credentials
   */
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

      logger.info('Claude token refreshed and saved to database', {
        component: 'TokenRefreshService',
        userId,
      });
    }

    return refreshedAuth;
  }

  /**
   * Ensure Gemini token is valid for a user, refreshing and persisting if needed.
   * This is the single source of truth for Gemini token refresh with database persistence.
   *
   * @param userId - The user ID to update in the database
   * @param geminiAuth - The current Gemini authentication credentials
   * @returns The valid (possibly refreshed) Gemini authentication credentials
   */
  async ensureValidGeminiTokenForUser(
    userId: string,
    geminiAuth: GeminiAuth
  ): Promise<GeminiAuth> {
    const refreshedAuth = await this.refreshGeminiTokenIfNeeded(geminiAuth);

    if (refreshedAuth.accessToken !== geminiAuth.accessToken) {
      await db
        .update(users)
        .set({ geminiAuth: refreshedAuth as unknown as typeof users.$inferInsert['geminiAuth'] })
        .where(eq(users.id, userId));

      logger.info('Gemini token refreshed and saved to database', {
        component: 'TokenRefreshService',
        userId,
      });
    }

    return refreshedAuth;
  }

  async refreshTokenIfNeeded(claudeAuth: ClaudeAuth): Promise<ClaudeAuth> {
    return ensureValidToken(claudeAuth);
  }

  async refreshGeminiTokenIfNeeded(geminiAuth: GeminiAuth): Promise<GeminiAuth> {
    return ensureValidGeminiToken(geminiAuth);
  }

  shouldRefresh(claudeAuth: ClaudeAuth): boolean {
    return shouldRefreshClaudeToken(claudeAuth);
  }

  shouldRefreshGemini(geminiAuth: GeminiAuth): boolean {
    return shouldRefreshGeminiToken(geminiAuth);
  }
}

export const tokenRefreshService = new TokenRefreshService();
