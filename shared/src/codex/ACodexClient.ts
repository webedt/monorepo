import { AService } from '../services/abstracts/AService.js';
import type { CodexAuth } from '../auth/codexAuth.js';
import type { CodexClientConfig } from './types.js';
import type { CreateCodexSessionParams } from './types.js';
import type { CreateCodexSessionResult } from './types.js';
import type { CodexSession } from './types.js';
import type { CodexSessionResult } from './types.js';
import type { CodexEventCallback } from './types.js';
import type { CodexPollOptions } from './types.js';
import type { CodexContentBlock } from './types.js';

export abstract class ACodexClient extends AService {
  override readonly order: number = 51;

  abstract configure(
    config: CodexClientConfig
  ): void;

  abstract setAuth(
    auth: CodexAuth
  ): void;

  abstract createSession(
    params: CreateCodexSessionParams
  ): Promise<CreateCodexSessionResult>;

  abstract getSession(
    sessionId: string
  ): Promise<CodexSession>;

  abstract sendMessage(
    sessionId: string,
    message: string | CodexContentBlock[]
  ): Promise<void>;

  abstract execute(
    params: CreateCodexSessionParams,
    onEvent: CodexEventCallback,
    options?: CodexPollOptions
  ): Promise<CodexSessionResult>;

  abstract resume(
    sessionId: string,
    message: string | CodexContentBlock[],
    onEvent: CodexEventCallback,
    options?: CodexPollOptions
  ): Promise<CodexSessionResult>;

  abstract cancelSession(
    sessionId: string
  ): Promise<void>;

  abstract isComplete(
    sessionId: string
  ): Promise<{ isComplete: boolean; status?: string }>;
}
