import { AService } from '../services/abstracts/AService.js';

import type { ClaudeAuth } from './claudeAuth.js';
import type { GeminiAuth } from './lucia.js';

export abstract class ATokenRefreshService extends AService {
  readonly order = -30;

  abstract ensureValidTokenForUser(
    userId: string,
    claudeAuth: ClaudeAuth
  ): Promise<ClaudeAuth>;

  abstract ensureValidGeminiTokenForUser(
    userId: string,
    geminiAuth: GeminiAuth
  ): Promise<GeminiAuth>;

  abstract refreshTokenIfNeeded(claudeAuth: ClaudeAuth): Promise<ClaudeAuth>;

  abstract refreshGeminiTokenIfNeeded(geminiAuth: GeminiAuth): Promise<GeminiAuth>;

  abstract shouldRefresh(claudeAuth: ClaudeAuth): boolean;

  abstract shouldRefreshGemini(geminiAuth: GeminiAuth): boolean;
}
