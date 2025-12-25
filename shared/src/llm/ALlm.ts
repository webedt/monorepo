/**
 * Abstract LLM class for one-off requests
 */

import type { LlmExecuteParams, LlmExecuteResult } from './types.js';

export abstract class ALlm {
  readonly order: number = 0;

  async initialize(): Promise<void> {}
  async dispose(): Promise<void> {}

  abstract execute(params: LlmExecuteParams): Promise<LlmExecuteResult>;
}
