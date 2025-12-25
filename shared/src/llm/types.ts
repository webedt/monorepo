/**
 * LLM module types
 */

export interface LlmExecuteParams {
  prompt: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface LlmExecuteResult {
  content: string;
  provider: string;
  model: string;
  cost?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export type LlmProvider = 'openrouter' | 'claude-web';
