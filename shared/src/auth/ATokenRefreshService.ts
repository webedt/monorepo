import { AService } from '../services/abstracts/AService.js';

import type { ClaudeAuth } from './claudeAuth.js';

export abstract class ATokenRefreshService extends AService {
  readonly order = -30;

  abstract ensureValidTokenForUser(
    userId: string,
    claudeAuth: ClaudeAuth
  ): Promise<ClaudeAuth>;

  abstract refreshTokenIfNeeded(claudeAuth: ClaudeAuth): Promise<ClaudeAuth>;

  abstract shouldRefresh(claudeAuth: ClaudeAuth): boolean;
}
